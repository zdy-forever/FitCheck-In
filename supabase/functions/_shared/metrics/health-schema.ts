/**
 * Wire format between the iOS FitCheck-In Sync module and the `health-ingest`
 * Edge Function. Shared by the server, the web app and the tests.
 *
 * Mirrors `ios/FitCheckInSync/HealthUploadModels.swift`.
 */

export const PAYLOAD_SCHEMA_VERSION = 1
export const MAX_SAMPLES_PER_REQUEST = 2_000

export type HealthCategory =
  | 'scores'
  | 'hrv'
  | 'resting_heart_rate'
  | 'heart_rate'
  | 'sleep'
  | 'activity'
  | 'workouts'
  | 'vo2_max'
  | 'vitals'
  | 'mobility'
  | 'body'

export const HEALTH_CATEGORIES: HealthCategory[] = [
  'scores',
  'hrv',
  'resting_heart_rate',
  'heart_rate',
  'sleep',
  'activity',
  'workouts',
  'vo2_max',
  'vitals',
  'mobility',
  'body',
]

export type MetricType =
  | 'hrv_sdnn'
  | 'resting_heart_rate'
  | 'heart_rate'
  | 'sleep_analysis'
  | 'step_count'
  | 'active_energy'
  | 'basal_energy'
  | 'exercise_time'
  | 'workout'
  | 'vo2_max'
  | 'walking_heart_rate'
  | 'heart_rate_recovery'
  | 'distance_walking_running'
  | 'distance_cycling'
  | 'distance_swimming'
  | 'flights_climbed'
  | 'oxygen_saturation'
  | 'respiratory_rate'
  | 'wrist_temperature'
  | 'walking_speed'
  | 'walking_steadiness'
  | 'walking_asymmetry'
  | 'walking_double_support'
  | 'walking_step_length'
  | 'six_minute_walk'
  | 'body_mass'
  | 'body_fat'
  | 'lean_body_mass'

export interface MetricDefinition {
  category: HealthCategory
  unit: string
  /** Inclusive physiological plausibility range. Values outside are rejected, not clamped. */
  min: number
  max: number
  /** HealthKit identifier on the iOS side. */
  healthKit: string
}

/** Keep in sync with `public.health_metric_category()` / `health_metric_unit()` (pgTAP-checked). */
export const METRICS: Record<MetricType, MetricDefinition> = {
  hrv_sdnn: { category: 'hrv', unit: 'ms', min: 1, max: 400, healthKit: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN' },
  resting_heart_rate: { category: 'resting_heart_rate', unit: 'bpm', min: 20, max: 200, healthKit: 'HKQuantityTypeIdentifierRestingHeartRate' },
  heart_rate: { category: 'heart_rate', unit: 'bpm', min: 20, max: 250, healthKit: 'HKQuantityTypeIdentifierHeartRate' },
  sleep_analysis: { category: 'sleep', unit: 'h', min: 0, max: 24, healthKit: 'HKCategoryTypeIdentifierSleepAnalysis' },
  step_count: { category: 'activity', unit: 'count', min: 0, max: 200_000, healthKit: 'HKQuantityTypeIdentifierStepCount' },
  active_energy: { category: 'activity', unit: 'kcal', min: 0, max: 20_000, healthKit: 'HKQuantityTypeIdentifierActiveEnergyBurned' },
  basal_energy: { category: 'activity', unit: 'kcal', min: 0, max: 10_000, healthKit: 'HKQuantityTypeIdentifierBasalEnergyBurned' },
  exercise_time: { category: 'activity', unit: 'min', min: 0, max: 1_440, healthKit: 'HKQuantityTypeIdentifierAppleExerciseTime' },
  workout: { category: 'workouts', unit: 'min', min: 0, max: 1_440, healthKit: 'HKWorkoutType' },
  vo2_max: { category: 'vo2_max', unit: 'mL/kg/min', min: 5, max: 100, healthKit: 'HKQuantityTypeIdentifierVO2Max' },
  walking_heart_rate: { category: 'heart_rate', unit: 'bpm', min: 30, max: 200, healthKit: 'HKQuantityTypeIdentifierWalkingHeartRateAverage' },
  heart_rate_recovery: { category: 'heart_rate', unit: 'bpm', min: 1, max: 100, healthKit: 'HKQuantityTypeIdentifierHeartRateRecoveryOneMinute' },
  distance_walking_running: { category: 'activity', unit: 'km', min: 0, max: 300, healthKit: 'HKQuantityTypeIdentifierDistanceWalkingRunning' },
  distance_cycling: { category: 'activity', unit: 'km', min: 0, max: 1000, healthKit: 'HKQuantityTypeIdentifierDistanceCycling' },
  distance_swimming: { category: 'activity', unit: 'm', min: 0, max: 50_000, healthKit: 'HKQuantityTypeIdentifierDistanceSwimming' },
  flights_climbed: { category: 'activity', unit: 'count', min: 0, max: 2_000, healthKit: 'HKQuantityTypeIdentifierFlightsClimbed' },
  oxygen_saturation: { category: 'vitals', unit: '%', min: 50, max: 100, healthKit: 'HKQuantityTypeIdentifierOxygenSaturation' },
  respiratory_rate: { category: 'vitals', unit: 'breaths/min', min: 4, max: 60, healthKit: 'HKQuantityTypeIdentifierRespiratoryRate' },
  wrist_temperature: { category: 'vitals', unit: 'degC', min: 25, max: 45, healthKit: 'HKQuantityTypeIdentifierAppleSleepingWristTemperature' },
  walking_speed: { category: 'mobility', unit: 'm/s', min: 0.1, max: 4, healthKit: 'HKQuantityTypeIdentifierWalkingSpeed' },
  walking_steadiness: { category: 'mobility', unit: '%', min: 0, max: 100, healthKit: 'HKQuantityTypeIdentifierAppleWalkingSteadiness' },
  walking_asymmetry: { category: 'mobility', unit: '%', min: 0, max: 100, healthKit: 'HKQuantityTypeIdentifierWalkingAsymmetryPercentage' },
  walking_double_support: { category: 'mobility', unit: '%', min: 0, max: 100, healthKit: 'HKQuantityTypeIdentifierWalkingDoubleSupportPercentage' },
  walking_step_length: { category: 'mobility', unit: 'm', min: 0.1, max: 2, healthKit: 'HKQuantityTypeIdentifierWalkingStepLength' },
  six_minute_walk: { category: 'mobility', unit: 'm', min: 50, max: 1_200, healthKit: 'HKQuantityTypeIdentifierSixMinuteWalkTestDistance' },
  body_mass: { category: 'body', unit: 'kg', min: 20, max: 400, healthKit: 'HKQuantityTypeIdentifierBodyMass' },
  body_fat: { category: 'body', unit: '%', min: 2, max: 75, healthKit: 'HKQuantityTypeIdentifierBodyFatPercentage' },
  lean_body_mass: { category: 'body', unit: 'kg', min: 10, max: 200, healthKit: 'HKQuantityTypeIdentifierLeanBodyMass' },
}

export const SLEEP_STAGES = ['inBed', 'awake', 'asleepCore', 'asleepDeep', 'asleepREM', 'asleepUnspecified'] as const
export type SleepStage = (typeof SLEEP_STAGES)[number]

/**
 * Workout kinds. The first eight are the health+ / iOS module kinds (scoring depends on them);
 * the rest only refine what the browser import used to file under 'mixed'.
 */
export const WORKOUT_KINDS = [
  'running', 'walking', 'cycling', 'strength', 'yoga', 'swimming', 'mixed', 'other',
  'hiking', 'hiit', 'core', 'dance', 'rowing', 'elliptical', 'stairs', 'team_sports', 'racket_sports', 'combat', 'climbing', 'flexibility', 'cooldown',
] as const

/** One sample as uploaded by the iOS bridge. */
export interface HealthSampleUpload {
  /** HealthKit sample UUID, or deterministic bucket id for daily aggregates (e.g. "steps:2026-11-08"). */
  sampleId: string
  metricType: MetricType
  value: number
  unit: string
  /** ISO-8601 sample start. */
  startAt: string
  /** ISO-8601 sample end = measurement time. */
  measuredAt: string
  /** Sleep stage (sleep_analysis) or workout kind (workout). */
  category?: string
  /** Small, whitelisted metadata (workout avg/max HR, kcal, distance). */
  metadata?: WorkoutMetadata
  sourceName?: string
  sourceBundle?: string
}

/** Per-workout averages; running/cycling fields only for those workout kinds. */
export interface WorkoutMetadata {
  averageHeartRate?: number
  maxHeartRate?: number
  energyKCal?: number
  distanceKM?: number
  appleEffort?: number
  runningPowerW?: number
  runningSpeedMS?: number
  groundContactMS?: number
  verticalOscillationCM?: number
  strideLengthM?: number
  cyclingPowerW?: number
  cyclingCadenceRPM?: number
}

/** Allowed metadata keys with plausibility ranges (rejected, never clamped). */
export const WORKOUT_METADATA_RANGES: Record<keyof WorkoutMetadata, [number, number]> = {
  averageHeartRate: [30, 250],
  maxHeartRate: [30, 250],
  energyKCal: [0, 20_000],
  distanceKM: [0, 1_000],
  appleEffort: [1, 10],
  runningPowerW: [10, 1_500],
  runningSpeedMS: [0.5, 12],
  groundContactMS: [100, 500],
  verticalOscillationCM: [2, 25],
  strideLengthM: [0.3, 3],
  cyclingPowerW: [10, 2_500],
  cyclingCadenceRPM: [10, 250],
}

export interface HealthUploadRequest {
  schemaVersion: number
  device: {
    installationId: string
    name: string
    osVersion?: string
    appVersion?: string
  }
  /** IANA zone of the phone, used to bucket days for snapshots. */
  timeZone: string
  /** Categories the user enabled in the iOS app. Samples outside these are rejected. */
  enabledCategories: HealthCategory[]
  samples: HealthSampleUpload[]
}

export interface HealthUploadResponse {
  accepted: number
  duplicates: number
  rejected: Array<{ index: number; reason: string }>
  snapshot: { date: string; completeness: number; algorithmVersion: string } | null
  receivedAt: string
}

const UUIDish = /^[0-9a-fA-F-]{36}$/

export interface ValidationIssue {
  index: number
  reason: string
}

export function validateSample(
  s: unknown,
  index: number,
  enabled: Set<HealthCategory>,
  nowMs: number,
): { ok: true; sample: HealthSampleUpload } | { ok: false; issue: ValidationIssue } {
  const fail = (reason: string) => ({ ok: false as const, issue: { index, reason } })
  if (typeof s !== 'object' || s === null) return fail('not_an_object')
  const o = s as Record<string, unknown>
  if (typeof o.sampleId !== 'string' || o.sampleId.length < 1 || o.sampleId.length > 128) return fail('invalid_sample_id')
  if (typeof o.metricType !== 'string' || !(o.metricType in METRICS)) return fail('unknown_metric')
  const def = METRICS[o.metricType as MetricType]
  if (!enabled.has(def.category)) return fail('category_not_enabled')
  if (typeof o.value !== 'number' || !Number.isFinite(o.value)) return fail('invalid_value')
  if (o.unit !== def.unit) return fail('unit_mismatch')
  if (o.value < def.min || o.value > def.max) return fail('value_out_of_range')
  if (typeof o.startAt !== 'string' || typeof o.measuredAt !== 'string') return fail('invalid_time')
  const start = Date.parse(o.startAt)
  const end = Date.parse(o.measuredAt)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return fail('invalid_time')
  if (end < start) return fail('end_before_start')
  if (end > nowMs + 10 * 60_000) return fail('time_in_future')
  if (end < nowMs - 400 * 86_400_000) return fail('time_too_old')
  if (o.metricType === 'sleep_analysis') {
    if (typeof o.category !== 'string' || !(SLEEP_STAGES as readonly string[]).includes(o.category)) return fail('invalid_sleep_stage')
  } else if (o.metricType === 'workout') {
    if (typeof o.category !== 'string' || !(WORKOUT_KINDS as readonly string[]).includes(o.category)) return fail('invalid_workout_kind')
  } else if (o.category !== undefined && o.category !== null) {
    return fail('unexpected_category')
  }
  if (o.metricType !== 'workout' && o.metadata !== undefined && o.metadata !== null) return fail('unexpected_metadata')

  let metadata: HealthSampleUpload['metadata']
  if (o.metadata !== undefined && o.metadata !== null) {
    if (typeof o.metadata !== 'object') return fail('invalid_metadata')
    const m = o.metadata as Record<string, unknown>
    metadata = {}
    for (const key of Object.keys(WORKOUT_METADATA_RANGES) as Array<keyof WorkoutMetadata>) {
      const v = m[key]
      if (v === undefined || v === null) continue
      const [lo, hi] = WORKOUT_METADATA_RANGES[key]
      if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) return fail('invalid_metadata')
      metadata[key] = v
    }
  }
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined)
  return {
    ok: true,
    sample: {
      sampleId: o.sampleId,
      metricType: o.metricType as MetricType,
      value: o.value,
      unit: def.unit,
      startAt: new Date(start).toISOString(),
      measuredAt: new Date(end).toISOString(),
      category: typeof o.category === 'string' ? o.category : undefined,
      metadata,
      sourceName: str(o.sourceName, 120),
      sourceBundle: str(o.sourceBundle, 200),
    },
  }
}

export function validateRequestEnvelope(body: unknown):
  | { ok: true; request: Omit<HealthUploadRequest, 'samples'> & { samples: unknown[] } }
  | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'invalid_body' }
  const b = body as Record<string, unknown>
  if (b.schemaVersion !== PAYLOAD_SCHEMA_VERSION) return { ok: false, error: 'unsupported_schema_version' }
  const d = b.device as Record<string, unknown> | undefined
  if (!d || typeof d.installationId !== 'string' || !UUIDish.test(d.installationId)) return { ok: false, error: 'invalid_device' }
  if (typeof d.name !== 'string' || d.name.length < 1 || d.name.length > 80) return { ok: false, error: 'invalid_device' }
  if (typeof b.timeZone !== 'string' || b.timeZone.length > 64) return { ok: false, error: 'invalid_time_zone' }
  if (!Array.isArray(b.enabledCategories) || !b.enabledCategories.every((c) => (HEALTH_CATEGORIES as unknown[]).includes(c))) {
    return { ok: false, error: 'invalid_categories' }
  }
  if (!Array.isArray(b.samples)) return { ok: false, error: 'invalid_samples' }
  if (b.samples.length > MAX_SAMPLES_PER_REQUEST) return { ok: false, error: 'too_many_samples' }
  return {
    ok: true,
    request: {
      schemaVersion: PAYLOAD_SCHEMA_VERSION,
      device: {
        installationId: d.installationId.toLowerCase(),
        name: d.name,
        osVersion: typeof d.osVersion === 'string' ? d.osVersion.slice(0, 40) : undefined,
        appVersion: typeof d.appVersion === 'string' ? d.appVersion.slice(0, 40) : undefined,
      },
      timeZone: b.timeZone,
      enabledCategories: [...new Set(b.enabledCategories as HealthCategory[])],
      samples: b.samples,
    },
  }
}
