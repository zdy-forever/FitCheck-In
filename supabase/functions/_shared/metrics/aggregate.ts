/**
 * Builds engine inputs from stored samples, mirroring how
 * `HealthKitService.swift` (health_monitor_ios @ 668b85d) assembles them:
 *
 *  - sleep window: previous local noon → local noon of the given day (`sleepWindow(endingAt:)`)
 *  - sleep stages: core/deep/REM/unspecified count as asleep, inBed/awake do not
 *  - latest HRV / RHR / VO2max: most recent sample (`latestQuantity`)
 *  - baselines: 7-day averages (`fetchBaselines`); steps/active energy = 7-day sum / 7
 *  - workouts: last 28 days, load via `estimateWorkoutLoad`, effort = min(100, load*1.6)
 *  - daily trends: 28 local days (`fetchDailyTrends`)
 *
 * Only the metrics FitCheck-In syncs are populated; everything else stays
 * undefined so the assessment layer can report it as not provided.
 */

import { addDays, fromLocal, localDateKey, localParts, startOfDay, wholeDaysBetween } from './calendar.ts'
import { estimateWorkoutLoad, estimateZoneDistribution } from './engine.ts'
import type { SampleTimes } from './assessment.ts'
import type { MetricType } from './health-schema.ts'
import type { DailyTrendPoint, EngineInput, SleepSummary, WorkoutKind, WorkoutSummary } from './types.ts'

export interface StoredSample {
  sampleId: string
  metricType: MetricType
  value: number
  /** epoch ms */
  startAt: number
  /** epoch ms */
  measuredAt: number
  category?: string | null
  metadata?: { averageHeartRate?: number; maxHeartRate?: number; energyKCal?: number; distanceKM?: number } | null
}

export interface AggregateResult {
  input: EngineInput
  sampleTimes: SampleTimes
  /** Per-day personal history for v2 (previous days only — today excluded). */
  history: { hrv: { day: string; value: number }[]; rhr: { day: string; value: number }[]; sleepHours: { day: string; value: number }[] }
  /** Acute (7-day) and chronic (prior 21 days, weekly-equivalent) training load; null without workouts. */
  load: { acute7: number; chronicWeekly: number } | null
  /** Latest values for display with their timestamps. */
  latest: Partial<Record<'hrv' | 'restingHeartRate' | 'vo2Max', { value: number; measuredAt: number }>>
}

function noonOf(dayInstant: number, timeZone: string): number {
  const p = localParts(dayInstant, timeZone)
  return fromLocal(p.year, p.month, p.day, 12, 0, 0, 0, timeZone)
}

/** `sleepWindow(endingAt:)`: previous local noon → local noon. */
export function sleepWindow(dayInstant: number, timeZone: string): { start: number; end: number } {
  const noon = noonOf(dayInstant, timeZone)
  return { start: addDays(noon, -1, timeZone), end: noon }
}

/**
 * Port of `fetchSleepSummary`. HealthKit's predicate `predicateForSamples(withStart:end:)`
 * matches samples that overlap the window; the original sums each matching sample's full
 * duration, and so do we.
 */
export function summarizeSleep(samples: StoredSample[], window: { start: number; end: number }): { summary: SleepSummary; lastEnd?: number } {
  let total = 0
  let inBed = 0
  let deep = 0
  let rem = 0
  let core = 0
  let awake = 0
  let lastEnd: number | undefined
  for (const s of samples) {
    if (s.metricType !== 'sleep_analysis') continue
    if (!(s.measuredAt > window.start && s.startAt < window.end)) continue
    const duration = (s.measuredAt - s.startAt) / 3_600_000
    switch (s.category) {
      case 'inBed':
        inBed += duration
        break
      case 'awake':
        awake += duration
        break
      case 'asleepCore':
        core += duration
        total += duration
        break
      case 'asleepDeep':
        deep += duration
        total += duration
        break
      case 'asleepREM':
        rem += duration
        total += duration
        break
      default:
        total += duration
    }
    if (s.category !== 'inBed' && s.category !== 'awake') lastEnd = Math.max(lastEnd ?? 0, s.measuredAt)
  }
  const nz = (v: number) => (v === 0 ? undefined : v)
  return {
    summary: {
      totalHours: nz(total),
      inBedHours: nz(inBed),
      deepHours: nz(deep),
      remHours: nz(rem),
      coreHours: nz(core),
      awakeHours: nz(awake),
    },
    lastEnd,
  }
}

function latestOf(samples: StoredSample[], metric: MetricType): StoredSample | undefined {
  let best: StoredSample | undefined
  for (const s of samples) if (s.metricType === metric && (!best || s.measuredAt > best.measuredAt)) best = s
  return best
}

function averageIn(samples: StoredSample[], metric: MetricType, start: number, end: number): number | undefined {
  const vals = samples.filter((s) => s.metricType === metric && s.measuredAt >= start && s.measuredAt <= end).map((s) => s.value)
  if (vals.length === 0) return undefined
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function sumIn(samples: StoredSample[], metric: MetricType, start: number, end: number): number | undefined {
  const vals = samples.filter((s) => s.metricType === metric && s.measuredAt > start && s.measuredAt <= end).map((s) => s.value)
  if (vals.length === 0) return undefined
  return vals.reduce((a, b) => a + b, 0)
}

export function aggregateForEngine(
  samples: StoredSample[],
  ctx: { nowMs: number; timeZone: string; age?: number; biologicalSex?: string },
): AggregateResult {
  const { nowMs, timeZone } = ctx
  const todayStart = startOfDay(nowMs, timeZone)
  const tomorrowStart = addDays(todayStart, 1, timeZone)

  // Last night's sleep.
  const lastNight = summarizeSleep(samples, sleepWindow(nowMs, timeZone))

  // 7-day sleep average (`averageSleepHours(days: 7)` — nights with data only).
  const sleepNights: number[] = []
  for (let i = 0; i < 7; i++) {
    const total = summarizeSleep(samples, sleepWindow(addDays(nowMs, -i, timeZone), timeZone)).summary.totalHours
    if (total !== undefined) sleepNights.push(total)
  }

  const hrv = latestOf(samples, 'hrv_sdnn')
  const rhr = latestOf(samples, 'resting_heart_rate')
  const vo2 = latestOf(samples, 'vo2_max')
  const start7 = addDays(nowMs, -7, timeZone)

  const stepsToday = sumIn(samples, 'step_count', todayStart - 1, tomorrowStart)
  const activeToday = sumIn(samples, 'active_energy', todayStart - 1, tomorrowStart)
  const basalToday = sumIn(samples, 'basal_energy', todayStart - 1, tomorrowStart)
  const exerciseToday = sumIn(samples, 'exercise_time', todayStart - 1, tomorrowStart)
  const steps7 = sumIn(samples, 'step_count', start7, nowMs)
  const active7 = sumIn(samples, 'active_energy', start7, nowMs)

  // Workouts in the last 28 days.
  const start28 = addDays(nowMs, -28, timeZone)
  const workouts: WorkoutSummary[] = samples
    .filter((s) => s.metricType === 'workout' && s.measuredAt >= start28 && s.measuredAt <= nowMs)
    .map((s) => {
      const kind = (s.category ?? 'mixed') as WorkoutKind
      const durationMinutes = s.value
      const avg = s.metadata?.averageHeartRate
      const max = s.metadata?.maxHeartRate ?? (avg !== undefined ? avg * 1.12 : undefined)
      const calories = s.metadata?.energyKCal
      const load = estimateWorkoutLoad({ durationMinutes, averageHeartRate: avg, maxHeartRate: max, calories, age: ctx.age })
      return {
        id: s.sampleId,
        date: s.measuredAt,
        activityName: kind,
        kind,
        durationMinutes,
        calories,
        distanceKM: s.metadata?.distanceKM,
        averageHeartRate: avg,
        maxHeartRate: max,
        source: 'appleHealth' as const,
        effortScore: Math.min(100, load * 1.6),
        estimatedLoad: load,
        zoneDistribution: estimateZoneDistribution({ durationMinutes, averageHeartRate: avg, maxHeartRate: max, age: ctx.age, kind }),
      }
    })
    .sort((a, b) => b.date - a.date)

  // 28 daily trend points, oldest first.
  const longTermTrends: DailyTrendPoint[] = []
  for (let i = 27; i >= 0; i--) {
    const day = addDays(todayStart, -i, timeZone)
    const next = addDays(day, 1, timeZone)
    const dayWorkouts = workouts.filter((w) => w.date >= day && w.date < next)
    longTermTrends.push({
      date: day,
      steps: sumIn(samples, 'step_count', day - 1, next - 1),
      activeEnergyKCal: sumIn(samples, 'active_energy', day - 1, next - 1),
      sleepHours: summarizeSleep(samples, sleepWindow(day, timeZone)).summary.totalHours,
      activityLoad: dayWorkouts.reduce((a, w) => a + w.estimatedLoad, 0),
      journalImpact: 0,
    })
  }

  const load7 = workouts.filter((w) => wholeDaysBetween(w.date, nowMs, timeZone) <= 7).reduce((a, w) => a + w.estimatedLoad, 0)
  const load28 = workouts.reduce((a, w) => a + w.estimatedLoad, 0)

  const input: EngineInput = {
    raw: {
      age: ctx.age,
      biologicalSex: ctx.biologicalSex,
      stepsToday,
      activeEnergyKCal: activeToday,
      basalEnergyKCal: basalToday,
      exerciseMinutes: exerciseToday,
      vo2Max: vo2?.value,
      restingHeartRate: rhr?.value,
      heartRateVariabilitySDNN: hrv?.value,
      sleep: lastNight.summary,
      nutrients: {},
      mobility: {},
    },
    baselines: {
      averageSleepHours7Day: sleepNights.length ? sleepNights.reduce((a, b) => a + b, 0) / sleepNights.length : undefined,
      averageHRV7Day: averageIn(samples, 'hrv_sdnn', start7, nowMs),
      averageRestingHeartRate7Day: averageIn(samples, 'resting_heart_rate', start7, nowMs),
      averageSteps7Day: steps7 !== undefined ? steps7 / 7 : undefined,
      averageActiveEnergy7Day: active7 !== undefined ? active7 / 7 : undefined,
      trainingLoad7Day: load7,
      trainingLoad28Day: load28,
    },
    workouts,
    dailyTrends: longTermTrends.slice(-7),
    longTermTrends,
  }

  // ── v2 personal history: one value per previous local day (today excluded) ──
  const history: AggregateResult['history'] = { hrv: [], rhr: [], sleepHours: [] }
  for (let i = 28; i >= 1; i--) {
    const day = addDays(todayStart, -i, timeZone)
    const next = addDays(day, 1, timeZone)
    const key = localDateKey(day, timeZone)
    const dayMean = (metric: MetricType) => {
      const v = samples.filter((x) => x.metricType === metric && x.measuredAt >= day && x.measuredAt < next).map((x) => x.value)
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined
    }
    const h = dayMean('hrv_sdnn')
    const r = dayMean('resting_heart_rate')
    const sl = summarizeSleep(samples, sleepWindow(day, timeZone)).summary.totalHours
    if (h !== undefined) history.hrv.push({ day: key, value: h })
    if (r !== undefined) history.rhr.push({ day: key, value: r })
    if (sl !== undefined) history.sleepHours.push({ day: key, value: sl })
  }
  const acute7 = workouts.filter((w) => w.date > addDays(nowMs, -7, timeZone)).reduce((a, w) => a + w.estimatedLoad, 0)
  const prior21 = workouts.filter((w) => w.date <= addDays(nowMs, -7, timeZone)).reduce((a, w) => a + w.estimatedLoad, 0)
  const load = workouts.length > 0 && prior21 > 0 ? { acute7, chronicWeekly: prior21 / 3 } : null

  return {
    input,
    history,
    load,
    sampleTimes: { sleepEndMs: lastNight.lastEnd, hrvMs: hrv?.measuredAt, restingHeartRateMs: rhr?.measuredAt },
    latest: {
      ...(hrv ? { hrv: { value: hrv.value, measuredAt: hrv.measuredAt } } : {}),
      ...(rhr ? { restingHeartRate: { value: rhr.value, measuredAt: rhr.measuredAt } } : {}),
      ...(vo2 ? { vo2Max: { value: vo2.value, measuredAt: vo2.measuredAt } } : {}),
    },
  }
}

export { localDateKey }
