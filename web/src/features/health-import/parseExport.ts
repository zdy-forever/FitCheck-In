/**
 * Apple Health "Export All Health Data" → FitCheck-In upload samples, entirely on the device.
 *
 * Produces the same samples the iOS FitCheck-In Sync module uploads (same metric names, units,
 * multipliers, sleep stages, workout kinds and deterministic bucket ids), so everything
 * downstream — validation, snapshot, scores — is shared.
 *
 * Streaming: the zip is inflated in chunks (fflate) and the XML is scanned element by element,
 * so memory stays bounded regardless of export size (exports are often hundreds of MB).
 * Only Record and Workout elements whose type we use, within the lookback window, are kept.
 *
 * Differences from HealthKit queries, handled explicitly:
 *  - Cumulative metrics (steps, energy, distance…) can be recorded by several sources at once
 *    (iPhone and Watch both count steps). HealthKit de-duplicates them; the export doesn't.
 *    Per day and metric we keep the single source with the largest total — never a sum of
 *    sources — which matches HealthKit's result whenever one device carried the day.
 *  - Heart rate is reduced to hourly averages (like the iOS module) for the last 7 days.
 *  - Export Records have no UUID. Their id is a stable hash of (type, source, start, end), so
 *    re-importing the same data updates rows in place instead of duplicating them.
 *  - Anything that can't be read is skipped and counted, never invented.
 */
import { Unzip, UnzipInflate } from 'fflate'
import { METRICS, type MetricType, type WorkoutMetadata } from '@shared/metrics/health-schema.ts'
import { fromLocal, localDateKey, localParts } from '@shared/metrics/calendar.ts'

export interface ImportSample {
  sampleId: string
  metricType: MetricType
  value: number
  unit: string
  startAt: string
  measuredAt: string
  category?: string
  metadata?: WorkoutMetadata
  sourceName?: string
}

export interface ParseStats {
  bytesRead: number
  records: number
  used: number
  skippedOld: number
  skippedInvalid: number
  types: Partial<Record<MetricType, number>>
  oldest: string | null
  newest: string | null
}

export interface ParseOptions {
  /** Days of history to import (slow metrics like VO₂ max / body use the same window). */
  lookbackDays?: number
  /** Days of workout history (default 365; the server accepts up to 400). Workouts are few, so a longer window is cheap. */
  workoutLookbackDays?: number
  timeZone: string
  nowMs?: number
  onProgress?: (p: { bytesRead: number; totalBytes: number | null; records: number }) => void
  signal?: AbortSignal
}

// ── Mapping (mirrors FitCheckInHealthReader.swift) ─────────────────────────────

type Conv = (value: number, unit: string) => number | null

const pct: Conv = (v, u) => (u === '%' ? (v <= 1 ? v * 100 : v) : null)
const ms: Conv = (v, u) => (u === 'ms' ? v : null)
const bpm: Conv = (v, u) => (u === 'count/min' ? v : null)
const kg: Conv = (v, u) => (u === 'kg' ? v : u === 'lb' ? v * 0.45359237 : u === 'g' ? v / 1000 : null)
const km: Conv = (v, u) => (u === 'km' ? v : u === 'm' ? v / 1000 : u === 'mi' ? v * 1.609344 : null)
const meters: Conv = (v, u) => (u === 'm' ? v : u === 'km' ? v * 1000 : u === 'yd' ? v * 0.9144 : u === 'mi' ? v * 1609.344 : null)
const kcal: Conv = (v, u) => (u === 'kcal' || u === 'Cal' ? v : u === 'kJ' ? v / 4.184 : null)
const minutes: Conv = (v, u) => (u === 'min' ? v : u === 's' ? v / 60 : u === 'hr' ? v * 60 : null)
const celsius: Conv = (v, u) => (u === 'degC' ? v : u === 'degF' ? ((v - 32) * 5) / 9 : null)
const mps: Conv = (v, u) => (u === 'm/s' ? v : u === 'km/hr' ? v / 3.6 : u === 'mi/hr' ? v * 0.44704 : null)
const stepLen: Conv = (v, u) => (u === 'm' ? v : u === 'cm' ? v / 100 : u === 'in' ? v * 0.0254 : u === 'ft' ? v * 0.3048 : null)
const count: Conv = (v, u) => (u === 'count' ? v : null)

/** Point-in-time quantity samples, stored one row per sample. */
const POINT: Record<string, [MetricType, Conv]> = {
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: ['hrv_sdnn', ms],
  HKQuantityTypeIdentifierRestingHeartRate: ['resting_heart_rate', bpm],
  HKQuantityTypeIdentifierVO2Max: ['vo2_max', (v, u) => (u.startsWith('mL/') || u === 'mL/min·kg' ? v : null)],
  HKQuantityTypeIdentifierWalkingHeartRateAverage: ['walking_heart_rate', bpm],
  HKQuantityTypeIdentifierHeartRateRecoveryOneMinute: ['heart_rate_recovery', bpm],
  HKQuantityTypeIdentifierOxygenSaturation: ['oxygen_saturation', pct],
  HKQuantityTypeIdentifierRespiratoryRate: ['respiratory_rate', bpm],
  HKQuantityTypeIdentifierAppleSleepingWristTemperature: ['wrist_temperature', celsius],
  HKQuantityTypeIdentifierWalkingSpeed: ['walking_speed', mps],
  HKQuantityTypeIdentifierAppleWalkingSteadiness: ['walking_steadiness', pct],
  HKQuantityTypeIdentifierWalkingAsymmetryPercentage: ['walking_asymmetry', pct],
  HKQuantityTypeIdentifierWalkingDoubleSupportPercentage: ['walking_double_support', pct],
  HKQuantityTypeIdentifierWalkingStepLength: ['walking_step_length', stepLen],
  HKQuantityTypeIdentifierSixMinuteWalkTestDistance: ['six_minute_walk', meters],
  HKQuantityTypeIdentifierBodyMass: ['body_mass', kg],
  HKQuantityTypeIdentifierBodyFatPercentage: ['body_fat', pct],
  HKQuantityTypeIdentifierLeanBodyMass: ['lean_body_mass', kg],
}

/** Cumulative quantities, uploaded as one daily total per local day (best single source). */
const DAILY: Record<string, [MetricType, Conv]> = {
  HKQuantityTypeIdentifierStepCount: ['step_count', count],
  HKQuantityTypeIdentifierActiveEnergyBurned: ['active_energy', kcal],
  HKQuantityTypeIdentifierBasalEnergyBurned: ['basal_energy', kcal],
  HKQuantityTypeIdentifierAppleExerciseTime: ['exercise_time', minutes],
  HKQuantityTypeIdentifierDistanceWalkingRunning: ['distance_walking_running', km],
  HKQuantityTypeIdentifierDistanceCycling: ['distance_cycling', km],
  HKQuantityTypeIdentifierDistanceSwimming: ['distance_swimming', meters],
  HKQuantityTypeIdentifierFlightsClimbed: ['flights_climbed', count],
}

/** Dense signals only used to enrich workouts (kept in a compact time index). */
const WORKOUT_SIGNALS: Record<string, [keyof WorkoutMetadata, Conv]> = {
  HKQuantityTypeIdentifierRunningPower: ['runningPowerW', (v, u) => (u === 'W' ? v : null)],
  HKQuantityTypeIdentifierRunningSpeed: ['runningSpeedMS', mps],
  HKQuantityTypeIdentifierRunningGroundContactTime: ['groundContactMS', ms],
  HKQuantityTypeIdentifierRunningVerticalOscillation: ['verticalOscillationCM', (v, u) => (u === 'cm' ? v : u === 'mm' ? v / 10 : null)],
  HKQuantityTypeIdentifierRunningStrideLength: ['strideLengthM', stepLen],
  HKQuantityTypeIdentifierCyclingPower: ['cyclingPowerW', (v, u) => (u === 'W' ? v : null)],
  HKQuantityTypeIdentifierCyclingCadence: ['cyclingCadenceRPM', (v, u) => (u === 'count/min' ? v : null)],
  HKQuantityTypeIdentifierWorkoutEffortScore: ['appleEffort', (v, u) => (u === 'appleEffortScore' || u === 'count' || u === '' ? v : null)],
  HKQuantityTypeIdentifierEstimatedWorkoutEffortScore: ['appleEffort', (v, u) => (u === 'appleEffortScore' || u === 'count' || u === '' ? v : null)],
}

const SLEEP_STAGE: Record<string, string> = {
  HKCategoryValueSleepAnalysisInBed: 'inBed',
  HKCategoryValueSleepAnalysisAwake: 'awake',
  HKCategoryValueSleepAnalysisAsleepCore: 'asleepCore',
  HKCategoryValueSleepAnalysisAsleepDeep: 'asleepDeep',
  HKCategoryValueSleepAnalysisAsleepREM: 'asleepREM',
  HKCategoryValueSleepAnalysisAsleepUnspecified: 'asleepUnspecified',
  HKCategoryValueSleepAnalysisAsleep: 'asleepUnspecified', // pre-iOS 16 exports
}

/**
 * HKWorkoutActivityType → workout kind. The health+ kinds (running … swimming) are unchanged
 * from the iOS module; activities it filed under 'mixed' get a more specific kind here so the
 * training history can tell HIIT from tennis. Anything unknown stays 'mixed'.
 */
const KIND_BY_ACTIVITY: Record<string, string> = {
  Running: 'running',
  Walking: 'walking',
  Hiking: 'hiking',
  Cycling: 'cycling',
  HandCycling: 'cycling',
  TraditionalStrengthTraining: 'strength',
  FunctionalStrengthTraining: 'strength',
  Yoga: 'yoga',
  Pilates: 'yoga',
  MindAndBody: 'yoga',
  TaiChi: 'yoga',
  Swimming: 'swimming',
  WaterFitness: 'swimming',
  HighIntensityIntervalTraining: 'hiit',
  CrossTraining: 'hiit',
  MixedCardio: 'hiit',
  JumpRope: 'hiit',
  CoreTraining: 'core',
  Dance: 'dance',
  CardioDance: 'dance',
  SocialDance: 'dance',
  Barre: 'dance',
  Rowing: 'rowing',
  Paddling: 'rowing',
  Elliptical: 'elliptical',
  StairClimbing: 'stairs',
  Stairs: 'stairs',
  StepTraining: 'stairs',
  Soccer: 'team_sports',
  Basketball: 'team_sports',
  Volleyball: 'team_sports',
  AmericanFootball: 'team_sports',
  AustralianFootball: 'team_sports',
  Rugby: 'team_sports',
  Hockey: 'team_sports',
  Handball: 'team_sports',
  Baseball: 'team_sports',
  Softball: 'team_sports',
  Cricket: 'team_sports',
  Lacrosse: 'team_sports',
  Tennis: 'racket_sports',
  Badminton: 'racket_sports',
  TableTennis: 'racket_sports',
  Squash: 'racket_sports',
  Racquetball: 'racket_sports',
  Pickleball: 'racket_sports',
  Boxing: 'combat',
  Kickboxing: 'combat',
  MartialArts: 'combat',
  Wrestling: 'combat',
  Fencing: 'combat',
  Climbing: 'climbing',
  Flexibility: 'flexibility',
  Cooldown: 'cooldown',
  PreparationAndRecovery: 'cooldown',
}
export function workoutKind(activityType: string): string {
  return KIND_BY_ACTIVITY[activityType.replace('HKWorkoutActivityType', '')] ?? 'mixed'
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** "2026-11-08 07:15:00 +1100" → epoch ms. */
export function parseExportDate(s: string | undefined): number | null {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(s.trim())
  if (!m) {
    const t = Date.parse(s)
    return Number.isFinite(t) ? t : null
  }
  const [, y, mo, d, h, mi, se, sign, oh, om] = m
  const utc = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +se!)
  const off = (+oh! * 60 + +om!) * 60_000 * (sign === '-' ? -1 : 1)
  return utc - off
}

/** Small, fast, stable string hash (FNV-1a 64-bit as hex) for deterministic sample ids. */
export function stableId(...parts: string[]): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  const s = parts.join('|')
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

const ATTR_RE = /([A-Za-z_:][\w:.-]*)="([^"]*)"/g
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  ATTR_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ATTR_RE.exec(tag))) out[m[1]!] = decodeXml(m[2]!)
  return out
}
function decodeXml(s: string): string {
  if (s.indexOf('&') < 0) return s
  return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) => {
    switch (e.toLowerCase()) {
      case 'amp':
        return '&'
      case 'lt':
        return '<'
      case 'gt':
        return '>'
      case 'quot':
        return '"'
      case 'apos':
        return "'"
      default:
        return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    }
  })
}

// ── Aggregator (pure; fed element by element — unit-testable without a zip) ─────────────

interface PendingWorkout {
  a: Record<string, string>
  stats: Record<string, string>[]
  meta: Record<string, string>
}

export class ExportAggregator {
  private readonly cutoff: number
  private readonly workoutCutoff: number
  private readonly hrCutoff: number
  private readonly tz: string
  private readonly nowMs: number
  readonly stats: ParseStats = { bytesRead: 0, records: 0, used: 0, skippedOld: 0, skippedInvalid: 0, types: {}, oldest: null, newest: null }
  private points: ImportSample[] = []
  /** metric → day → source → {sum, start, end} */
  private daily = new Map<MetricType, Map<string, Map<string, { sum: number; start: number; end: number }>>>()
  /** hour bucket key → {sum, n, start} */
  private hr = new Map<string, { sum: number; n: number; start: number }>()
  /** Compact signal index for workout enrichment: key → [time, value][] */
  private signals = new Map<keyof WorkoutMetadata | 'hr', number[]>()
  private workouts: PendingWorkout[] = []

  constructor(opts: { lookbackDays: number; workoutLookbackDays?: number; timeZone: string; nowMs: number }) {
    this.tz = opts.timeZone
    this.nowMs = opts.nowMs
    this.cutoff = opts.nowMs - opts.lookbackDays * 86_400_000
    this.workoutCutoff = opts.nowMs - Math.max(opts.lookbackDays, opts.workoutLookbackDays ?? 365) * 86_400_000
    this.hrCutoff = opts.nowMs - 7 * 86_400_000
  }

  private seen(t: number) {
    const iso = new Date(t).toISOString()
    if (!this.stats.oldest || iso < this.stats.oldest) this.stats.oldest = iso
    if (!this.stats.newest || iso > this.stats.newest) this.stats.newest = iso
  }
  private count(m: MetricType) {
    this.stats.used++
    this.stats.types[m] = (this.stats.types[m] ?? 0) + 1
  }
  private pushSignal(key: keyof WorkoutMetadata | 'hr', t: number, v: number) {
    let arr = this.signals.get(key)
    if (!arr) this.signals.set(key, (arr = []))
    arr.push(t, v)
  }

  record(a: Record<string, string>) {
    this.stats.records++
    const type = a.type ?? ''
    const start = parseExportDate(a.startDate)
    const end = parseExportDate(a.endDate)
    if (start === null || end === null || end < start) {
      if (POINT[type] || DAILY[type] || type === 'HKCategoryTypeIdentifierSleepAnalysis' || type === 'HKQuantityTypeIdentifierHeartRate') this.stats.skippedInvalid++
      return
    }
    if (end < this.cutoff || end > this.nowMs + 10 * 60_000) {
      this.stats.skippedOld++
      return
    }
    const source = a.sourceName ?? 'Apple Health'
    const raw = Number(a.value)
    const unit = a.unit ?? ''

    if (type === 'HKCategoryTypeIdentifierSleepAnalysis') {
      const stage = SLEEP_STAGE[a.value ?? '']
      if (!stage) return void this.stats.skippedInvalid++
      this.points.push({
        sampleId: stableId('sleep', source, a.startDate!, a.endDate!, stage),
        metricType: 'sleep_analysis',
        value: (end - start) / 3_600_000,
        unit: METRICS.sleep_analysis.unit,
        startAt: new Date(start).toISOString(),
        measuredAt: new Date(end).toISOString(),
        category: stage,
        sourceName: source,
      })
      this.count('sleep_analysis')
      this.seen(end)
      return
    }
    if (!Number.isFinite(raw)) return

    if (type === 'HKQuantityTypeIdentifierHeartRate') {
      if (unit !== 'count/min') return void this.stats.skippedInvalid++
      this.pushSignal('hr', end, raw)
      if (end >= this.hrCutoff) {
        const p = localHour(start, this.tz)
        const b = this.hr.get(p.key) ?? { sum: 0, n: 0, start: p.start }
        b.sum += raw
        b.n++
        this.hr.set(p.key, b)
      }
      return
    }
    const sig = WORKOUT_SIGNALS[type]
    if (sig) {
      const v = sig[1](raw, unit)
      if (v !== null) this.pushSignal(sig[0], end, v)
      return
    }
    const point = POINT[type]
    if (point) {
      const [metric, conv] = point
      const v = conv(raw, unit)
      const def = METRICS[metric]
      if (v === null || v < def.min || v > def.max) return void this.stats.skippedInvalid++
      this.points.push({
        sampleId: stableId(metric, source, a.startDate!, a.endDate!),
        metricType: metric,
        value: v,
        unit: def.unit,
        startAt: new Date(start).toISOString(),
        measuredAt: new Date(end).toISOString(),
        sourceName: source,
      })
      this.count(metric)
      this.seen(end)
      return
    }
    const daily = DAILY[type]
    if (daily) {
      const [metric, conv] = daily
      const v = conv(raw, unit)
      if (v === null || v < 0) return void this.stats.skippedInvalid++
      const day = localDateKey(start, this.tz)
      let byDay = this.daily.get(metric)
      if (!byDay) this.daily.set(metric, (byDay = new Map()))
      let bySource = byDay.get(day)
      if (!bySource) byDay.set(day, (bySource = new Map()))
      const agg = bySource.get(source) ?? { sum: 0, start, end }
      agg.sum += v
      agg.start = Math.min(agg.start, start)
      agg.end = Math.max(agg.end, end)
      bySource.set(source, agg)
      this.seen(end)
    }
  }

  workout(a: Record<string, string>, stats: Record<string, string>[], meta: Record<string, string>) {
    this.workouts.push({ a, stats, meta })
  }

  /** Average of a signal within [start, end]. */
  private avg(key: keyof WorkoutMetadata | 'hr', start: number, end: number, fn: 'avg' | 'max' = 'avg'): number | undefined {
    const arr = this.signals.get(key)
    if (!arr) return undefined
    let s = 0
    let n = 0
    let mx = -Infinity
    for (let i = 0; i < arr.length; i += 2) {
      const t = arr[i]!
      if (t < start || t > end) continue
      s += arr[i + 1]!
      mx = Math.max(mx, arr[i + 1]!)
      n++
    }
    if (n === 0) return undefined
    return fn === 'max' ? mx : s / n
  }

  finish(): ImportSample[] {
    const out = [...this.points]

    // Daily totals: best single source per day (never a sum across sources).
    for (const [metric, byDay] of this.daily) {
      const def = METRICS[metric]
      for (const [day, bySource] of byDay) {
        let best: { sum: number; start: number; end: number; source: string } | null = null
        for (const [source, agg] of bySource) if (!best || agg.sum > best.sum) best = { ...agg, source }
        if (!best || best.sum > def.max) {
          this.stats.skippedInvalid++
          continue
        }
        const dayStart = dayStartMs(day, this.tz)
        out.push({
          // Same id format as the iOS module's HKStatisticsCollectionQuery buckets.
          sampleId: `${metric}:${day}`,
          metricType: metric,
          value: Math.round(best.sum * 1000) / 1000,
          unit: def.unit,
          startAt: new Date(dayStart).toISOString(),
          measuredAt: new Date(Math.min(best.end, this.nowMs)).toISOString(),
          sourceName: `${best.source} (Health export)`,
        })
        this.count(metric)
      }
    }

    // Hourly heart-rate averages (last 7 days), same id format as the iOS module.
    for (const [key, b] of this.hr) {
      const v = b.sum / b.n
      if (v < METRICS.heart_rate.min || v > METRICS.heart_rate.max) continue
      out.push({
        sampleId: `heart_rate:${key}`,
        metricType: 'heart_rate',
        value: Math.round(v * 10) / 10,
        unit: METRICS.heart_rate.unit,
        startAt: new Date(b.start).toISOString(),
        measuredAt: new Date(Math.min(b.start + 3_600_000, this.nowMs)).toISOString(),
        sourceName: 'Apple Health (aggregated)',
      })
      this.count('heart_rate')
    }

    // Workouts, enriched from the signals collected during the scan.
    for (const { a, stats, meta } of this.workouts) {
      const start = parseExportDate(a.startDate)
      const end = parseExportDate(a.endDate)
      if (start === null || end === null || end < start) {
        this.stats.skippedInvalid++
        continue
      }
      if (end < this.workoutCutoff || end > this.nowMs + 10 * 60_000) {
        this.stats.skippedOld++
        continue
      }
      const kind = workoutKind(a.workoutActivityType ?? '')
      const durMin = minutes(Number(a.duration), a.durationUnit ?? 'min') ?? (end - start) / 60_000
      if (!Number.isFinite(durMin) || durMin <= 0 || durMin > METRICS.workout.max) {
        this.stats.skippedInvalid++
        continue
      }
      const stat = (type: string) => stats.find((s) => s.type === type)
      const hrStat = stat('HKQuantityTypeIdentifierHeartRate')
      const energy = stat('HKQuantityTypeIdentifierActiveEnergyBurned')
      const dist = stat('HKQuantityTypeIdentifierDistanceWalkingRunning') ?? stat('HKQuantityTypeIdentifierDistanceCycling') ?? stat('HKQuantityTypeIdentifierDistanceSwimming')
      const m: WorkoutMetadata = {
        averageHeartRate: num(hrStat?.average) ?? this.avg('hr', start, end),
        maxHeartRate: num(hrStat?.maximum) ?? this.avg('hr', start, end, 'max'),
        energyKCal: (energy ? kcal(Number(energy.sum), energy.unit ?? '') : null) ?? (a.totalEnergyBurned ? kcal(Number(a.totalEnergyBurned), a.totalEnergyBurnedUnit ?? 'kcal') : null) ?? undefined,
        distanceKM: (dist ? km(Number(dist.sum), dist.unit ?? '') : null) ?? (a.totalDistance ? km(Number(a.totalDistance), a.totalDistanceUnit ?? 'km') : null) ?? undefined,
        appleEffort: this.avg('appleEffort', start - 60_000, end + 6 * 3_600_000),
      }
      if (kind === 'running') {
        m.runningPowerW = this.avg('runningPowerW', start, end)
        m.runningSpeedMS = this.avg('runningSpeedMS', start, end)
        m.groundContactMS = this.avg('groundContactMS', start, end)
        m.verticalOscillationCM = this.avg('verticalOscillationCM', start, end)
        m.strideLengthM = this.avg('strideLengthM', start, end)
      } else if (kind === 'cycling') {
        m.cyclingPowerW = this.avg('cyclingPowerW', start, end)
        m.cyclingCadenceRPM = this.avg('cyclingCadenceRPM', start, end)
      }
      // Drop anything implausible rather than clamping (the server would reject the sample).
      for (const k of Object.keys(m) as Array<keyof WorkoutMetadata>) if (m[k] === undefined || !Number.isFinite(m[k]!)) delete m[k]
      const source = a.sourceName ?? 'Apple Health'
      out.push({
        sampleId: meta.HKExternalUUID && /^[0-9a-fA-F-]{36}$/.test(meta.HKExternalUUID) ? meta.HKExternalUUID : stableId('workout', source, a.startDate!, a.endDate!),
        metricType: 'workout',
        value: Math.round(durMin * 100) / 100,
        unit: METRICS.workout.unit,
        startAt: new Date(start).toISOString(),
        measuredAt: new Date(end).toISOString(),
        category: kind,
        metadata: m,
        sourceName: source,
      })
      this.count('workout')
      this.seen(end)
    }
    this.signals.clear()
    return out
  }
}

function num(s: string | undefined): number | undefined {
  if (s === undefined) return undefined
  const v = Number(s)
  return Number.isFinite(v) ? v : undefined
}

function localHour(t: number, tz: string): { key: string; start: number } {
  const p = localParts(t, tz)
  const key = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T${String(p.hour).padStart(2, '0')}`
  return { key, start: fromLocal(p.year, p.month, p.day, p.hour, 0, 0, 0, tz) }
}

function dayStartMs(day: string, tz: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return fromLocal(y!, m!, d!, 0, 0, 0, 0, tz)
}

// ── Streaming XML scanner ────────────────────────────────────────────────────

/**
 * Feeds decoded text chunks; emits Record / Workout elements. Only the tags we need are
 * parsed; everything else is skipped by scanning for the next '<'.
 */
export class ExportScanner {
  private buf = ''
  private workout: PendingWorkout | null = null
  private readonly agg: ExportAggregator
  constructor(agg: ExportAggregator) {
    this.agg = agg
  }

  push(text: string) {
    this.buf += text
    let i = 0
    const b = this.buf
    for (;;) {
      const lt = b.indexOf('<', i)
      if (lt < 0) {
        i = b.length
        break
      }
      const gt = b.indexOf('>', lt)
      if (gt < 0) {
        i = lt
        break
      }
      const tag = b.slice(lt, gt + 1)
      i = gt + 1
      this.tag(tag)
    }
    this.buf = b.slice(i)
    // Guard against pathological input (e.g. an unterminated DOCTYPE): never grow unbounded.
    if (this.buf.length > 4_000_000) this.buf = ''
  }

  private tag(tag: string) {
    const c1 = tag.charCodeAt(1)
    if (c1 === 47 /* / */) {
      if (tag.startsWith('</Workout')) {
        if (this.workout) this.agg.workout(this.workout.a, this.workout.stats, this.workout.meta)
        this.workout = null
      }
      return
    }
    if (tag.startsWith('<Record ')) {
      // Records nested in Correlations (blood pressure, food) are also top-level elsewhere.
      this.agg.record(attrs(tag))
      return
    }
    if (tag.startsWith('<Workout ')) {
      const a = attrs(tag)
      if (tag.endsWith('/>')) this.agg.workout(a, [], {})
      else this.workout = { a, stats: [], meta: {} }
      return
    }
    if (this.workout) {
      if (tag.startsWith('<WorkoutStatistics ')) this.workout.stats.push(attrs(tag))
      else if (tag.startsWith('<MetadataEntry ')) {
        const m = attrs(tag)
        if (m.key) this.workout.meta[m.key] = m.value ?? ''
      }
    }
  }
}

// ── Entry point: a File (export.zip or export.xml) → samples ─────────────────────────

const CHUNK = 1 << 20 // 1 MiB

export async function parseHealthExport(file: Blob & { name?: string }, opts: ParseOptions): Promise<{ samples: ImportSample[]; stats: ParseStats }> {
  const nowMs = opts.nowMs ?? Date.now()
  const agg = new ExportAggregator({ lookbackDays: opts.lookbackDays ?? 90, workoutLookbackDays: opts.workoutLookbackDays, timeZone: opts.timeZone, nowMs })
  const scanner = new ExportScanner(agg)
  const decoder = new TextDecoder('utf-8')
  const total = file.size
  let read = 0
  let found = false
  const report = () => opts.onProgress?.({ bytesRead: read, totalBytes: total, records: agg.stats.records })

  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  const isZip = head[0] === 0x50 && head[1] === 0x4b

  if (!isZip) {
    // A bare export.xml (e.g. unzipped on a computer).
    found = true
    for (let off = 0; off < total; off += CHUNK) {
      if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      const chunk = new Uint8Array(await file.slice(off, off + CHUNK).arrayBuffer())
      scanner.push(decoder.decode(chunk, { stream: true }))
      read = Math.min(total, off + CHUNK)
      report()
    }
    scanner.push(decoder.decode())
  } else {
    let pendingError: unknown = null
    const unzip = new Unzip((entry) => {
      // apple_health_export/export.xml (name is localized in some versions: "导出.xml", "exportar.xml"…)
      const name = entry.name.toLowerCase()
      const isMain = name.endsWith('.xml') && !name.includes('cda') && !name.includes('clinical') && !name.includes('workout-routes') && !name.includes('electrocardiograms')
      if (!isMain || found) {
        // fflate's streaming Unzip must consume every entry to find the next header; entries
        // we don't need (routes, ECGs, CDA) are inflated and discarded chunk by chunk.
        entry.ondata = (err) => {
          if (err) pendingError = err
        }
        entry.start()
        return
      }
      found = true
      entry.ondata = (err, data, final) => {
        if (err) {
          pendingError = err
          return
        }
        scanner.push(decoder.decode(data, { stream: !final }))
      }
      entry.start()
    })
    unzip.register(UnzipInflate)
    for (let off = 0; off < total; off += CHUNK) {
      if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      const chunk = new Uint8Array(await file.slice(off, off + CHUNK).arrayBuffer())
      unzip.push(chunk, off + CHUNK >= total)
      if (pendingError) throw pendingError
      read = Math.min(total, off + CHUNK)
      report()
      // Yield so the UI (or worker messages) stay responsive.
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  if (!found) throw new Error('no_export_xml')
  agg.stats.bytesRead = read
  const samples = agg.finish()
  return { samples, stats: agg.stats }
}
