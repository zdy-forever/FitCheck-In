/** Recomputes and stores the daily health snapshot for one user (server-side only). */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { aggregateForEngine, type StoredSample } from './metrics/aggregate.ts'
import { ALGORITHM_VERSION, assessReadiness } from './metrics/assessment.ts'
import { localDateKey } from './metrics/calendar.ts'

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
  const assessment = assessReadiness(agg.input, { nowMs, timeZone }, agg.sampleTimes)
  const date = localDateKey(nowMs, timeZone)

  const { error: upErr } = await admin.from('health_snapshots').upsert(
    {
      user_id: userId,
      snapshot_date: date,
      time_zone: timeZone,
      computed_at: new Date(nowMs).toISOString(),
      algorithm_version: ALGORITHM_VERSION,
      completeness: assessment.completeness,
      assessment: { ...assessment, latest: agg.latest, rawSummary: summarizeRaw(agg) },
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
