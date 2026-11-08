/** Recomputes and stores the daily health snapshot for one user (server-side only). */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { aggregateForEngine, type StoredSample } from './metrics/aggregate.ts'
import { ALGORITHM_VERSION, assessReadiness } from './metrics/assessment.ts'
import { localDateKey } from './metrics/calendar.ts'
import { computeTrainingLoad, type PlatformSession } from './metrics/training-load.ts'
import { computeFitness } from './metrics/fitness.ts'

export async function recomputeSnapshot(
  admin: SupabaseClient,
  userId: string,
  timeZone: string,
  nowMs: number,
  origin: 'healthkit' | 'demo',
): Promise<{ date: string; completeness: number; algorithmVersion: string }> {
  const since = new Date(nowMs - 36 * 86_400_000).toISOString()
  const { data, error } = await admin
    .from('health_samples')
    .select('sample_id, metric_type, value, start_at, measured_at, category, metadata')
    .eq('user_id', userId)
    .gte('measured_at', since)
    .order('measured_at', { ascending: true })
    .limit(20_000)
  if (error) throw new Error('snapshot_read_failed')

  const samples: StoredSample[] = (data ?? []).map((r) => ({
    sampleId: r.sample_id,
    metricType: r.metric_type,
    value: r.value,
    startAt: Date.parse(r.start_at),
    measuredAt: Date.parse(r.measured_at),
    category: r.category,
    metadata: r.metadata,
  }))

  const agg = aggregateForEngine(samples, { nowMs, timeZone })
  const date = localDateKey(nowMs, timeZone)

  // Today's most recent pre-session check-in (any trainer) — the client's own report is a readiness signal.
  const { data: checkins } = await admin
    .from('pre_session_checkins')
    .select('energy_level, sleep_quality, muscle_soreness, pain_level, created_at')
    .eq('client_id', userId)
    .gte('created_at', new Date(nowMs - 36 * 3_600_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(5)
  const todays = (checkins ?? []).find((c) => localDateKey(Date.parse(c.created_at), timeZone) === date)
  const checkin = todays
    ? { energy: todays.energy_level, sleepQuality: todays.sleep_quality, soreness: todays.muscle_soreness, pain: todays.pain_level }
    : null

  // Training sessions logged in FitCheck-In (all of this client's trainers) + their RPE feedback.
  const { data: sessionRows } = await admin
    .from('training_sessions')
    .select('id, scheduled_at, duration_minutes, session_type, status, planned_intensity, actual_intensity, post_session_feedback(session_rpe)')
    .eq('client_id', userId)
    .gte('scheduled_at', new Date(nowMs - 28 * 86_400_000).toISOString())
    .lte('scheduled_at', new Date(nowMs).toISOString())
  const platform: PlatformSession[] = (sessionRows ?? []).map((r) => {
    const fb = Array.isArray(r.post_session_feedback) ? r.post_session_feedback[0] : r.post_session_feedback
    return {
      id: r.id,
      startMs: Date.parse(r.scheduled_at),
      durationMinutes: r.duration_minutes,
      sessionType: r.session_type,
      status: r.status,
      plannedIntensity: r.planned_intensity,
      actualIntensity: r.actual_intensity,
      clientRpe: (fb as { session_rpe?: number } | null)?.session_rpe ?? null,
    }
  })
  const trainingLoad = computeTrainingLoad({ nowMs, platform, watch: agg.watchWorkouts, restingHeartRate: agg.input.baselines.averageRestingHeartRate7Day })

  const assessment = assessReadiness(agg.input, { nowMs, timeZone }, agg.sampleTimes, undefined, { history: agg.history, trainingLoad, checkin })

  // Slow-moving fitness metrics need a 90-day window (VO₂max / HRR trends) — separate lean query.
  const slowMetrics = ['vo2_max', 'heart_rate_recovery', 'body_mass', 'body_fat', 'lean_body_mass', 'walking_speed', 'walking_steadiness', 'walking_asymmetry', 'walking_double_support', 'walking_step_length', 'six_minute_walk']
  const { data: slow } = await admin
    .from('health_samples')
    .select('metric_type, value, start_at, measured_at')
    .eq('user_id', userId)
    .in('metric_type', slowMetrics)
    .gte('measured_at', new Date(nowMs - 90 * 86_400_000).toISOString())
    .limit(5_000)
  const { data: prof } = await admin.from('profiles').select('birth_year, sex').eq('id', userId).single()
  const fitnessSamples = [
    ...samples.filter((s) => !slowMetrics.includes(s.metricType)).map((s) => ({ metricType: s.metricType, value: s.value, startAt: s.startAt, measuredAt: s.measuredAt, category: s.category, metadata: s.metadata as Record<string, number> | null })),
    ...(slow ?? []).map((r) => ({ metricType: r.metric_type, value: r.value, startAt: Date.parse(r.start_at), measuredAt: Date.parse(r.measured_at) })),
  ]
  const fitness = computeFitness({
    samples: fitnessSamples,
    loadSessions: trainingLoad.sessions.map((s) => ({ startMs: s.startMs, load: s.load, rpe: s.rpe, durationMinutes: s.durationMinutes })),
    profile: { birthYear: prof?.birth_year, sex: (prof?.sex as 'female' | 'male' | null) ?? null },
    nowMs,
    dayKey: (t) => localDateKey(t, timeZone),
  })

  const { error: upErr } = await admin.from('health_snapshots').upsert(
    {
      user_id: userId,
      snapshot_date: date,
      time_zone: timeZone,
      computed_at: new Date(nowMs).toISOString(),
      algorithm_version: ALGORITHM_VERSION,
      completeness: assessment.completeness,
      assessment: { ...assessment, fitness, latest: agg.latest, rawSummary: summarizeRaw(agg) },
      origin,
    },
    { onConflict: 'user_id,snapshot_date' },
  )
  if (upErr) throw new Error('snapshot_write_failed')
  return { date, completeness: assessment.completeness, algorithmVersion: ALGORITHM_VERSION }
}

/** Display values (not scores) for the dashboards, each with its own provenance. */
function summarizeRaw(agg: ReturnType<typeof aggregateForEngine>) {
  const { raw, baselines } = agg.input
  return {
    sleepHours: raw.sleep.totalHours ?? null,
    sleepStages: {
      deep: raw.sleep.deepHours ?? null,
      rem: raw.sleep.remHours ?? null,
      core: raw.sleep.coreHours ?? null,
      awake: raw.sleep.awakeHours ?? null,
      inBed: raw.sleep.inBedHours ?? null,
    },
    sleepEndAt: agg.sampleTimes.sleepEndMs ? new Date(agg.sampleTimes.sleepEndMs).toISOString() : null,
    stepsToday: raw.stepsToday ?? null,
    activeEnergyToday: raw.activeEnergyKCal ?? null,
    exerciseMinutesToday: raw.exerciseMinutes ?? null,
    baselines: {
      hrv: baselines.averageHRV7Day ?? null,
      restingHeartRate: baselines.averageRestingHeartRate7Day ?? null,
      sleepHours: baselines.averageSleepHours7Day ?? null,
    },
    workouts28Day: agg.input.workouts.length,
  }
}
