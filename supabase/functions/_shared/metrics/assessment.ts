/**
 * FitCheck-In data-sufficiency layer on top of the ported health+ engine.
 *
 * Why this exists
 * ---------------
 * The original DerivedMetricsEngine always returns a number. When an input is
 * missing it substitutes a neutral constant (HRV score 60, RHR score 60, sleep 55,
 * nutrition 55, mobility 60, cardio 45, energy availability 60 …). With zero data
 * it reports Readiness ≈ 57 and Recovery ≈ 60 (see golden case "all-missing").
 * That is fine inside a personal app with a "calibrating" banner, but on a coach
 * platform a trainer would read it as a real measurement.
 *
 * Policy (FitCheck-In algorithm `fitcheck-readiness@1.0.0`)
 * ---------------------------------------------------------
 *  - Core inputs for Recovery / Readiness / Stress: last-night sleep duration,
 *    HRV (SDNN) and resting heart rate, each with a 7-day baseline.
 *  - A core input only counts if its sample is fresh (≤ 36 h old by default).
 *  - If < 2 of the 3 core *current* values are present → status `insufficient`,
 *    score `null`. Never a number.
 *  - If 2 of 3 are present, or baselines are missing → status `limited`;
 *    the score is shown with an explicit "limited data" badge and the list of
 *    inputs that used the engine's default value.
 *  - All 3 present and fresh with baselines → status `ok`.
 *  - Secondary inputs (nutrition, mobility, VO2max, energy) are reported as
 *    `defaulted` so the UI can say e.g. "nutrition not tracked — neutral value used".
 *
 * These scores are algorithmic estimates for coaching conversations. They are not
 * medical assessments, do not diagnose anything, and must not be used to decide
 * automatically whether someone may train.
 */

import { ENGINE_SOURCE, buildDerivedMetrics, type EngineContext } from './engine.ts'
import type { EngineInput, EngineOutput } from './types.ts'

import { computeReadinessV2, READINESS_V2_VERSION, type Driver, type SignalDetail, type V2Input } from './readiness-v2.ts'
import { TRAINING_LOAD_VERSION, type LoadSession, type TrainingLoadResult } from './training-load.ts'

/** Primary scores: FitCheck-In v2 (personal-baseline model). health+ port kept under `legacy`. */
export const ALGORITHM_VERSION = READINESS_V2_VERSION
export const LEGACY_ALGORITHM_VERSION = 'fitcheck-readiness@1.0.0+healthplus.668b85d'
export const DEFAULT_MAX_SAMPLE_AGE_HOURS = 36

export type ScoreStatus = 'ok' | 'limited' | 'insufficient'

export type InputKey =
  | 'sleep'
  | 'sleepStages'
  | 'hrv'
  | 'hrvBaseline'
  | 'restingHeartRate'
  | 'restingHeartRateBaseline'
  | 'sleepBaseline'
  | 'workouts'
  | 'activity'
  | 'energy'
  | 'nutrition'
  | 'mobility'
  | 'vo2Max'
  | 'bodyComposition'

export interface ScoreResult {
  /** Rounded 0-100, or null when withheld. */
  value: number | null
  status: ScoreStatus
}

export interface ReadinessAssessment {
  algorithmVersion: string
  engineSource: typeof ENGINE_SOURCE
  computedAt: string
  /** 0-1 share of core inputs (3 current values + 3 baselines) that were available & fresh. */
  completeness: number
  presentInputs: InputKey[]
  /** Inputs that were missing; the engine substituted a neutral default for them. */
  defaultedInputs: InputKey[]
  /** Core inputs present but older than the freshness window. */
  staleInputs: InputKey[]
  scores: {
    readiness: ScoreResult
    recovery: ScoreResult
    stress: ScoreResult
    sleep: ScoreResult
    hrvVsBaseline: ScoreResult
    restingHeartRateVsBaseline: ScoreResult
    fatigue: ScoreResult
    bodyBattery: ScoreResult
  }
  baselineComparison: {
    hrvDeltaPercent: number | null
    restingHeartRateDeltaBpm: number | null
    sleepDeltaHours: number | null
  }
  training: {
    /** Session-RPE load model version. */
    loadModel: string
    /** Share of load whose RPE was actually rated (client / trainer / Apple Effort), 0–1. */
    ratedShare: number
    /** Sessions in the last 28 days (newest first) with RPE source, for transparency. */
    sessions: Array<Pick<LoadSession, 'startMs' | 'durationMinutes' | 'modality' | 'rpe' | 'rpeSource' | 'load' | 'sources'>>
    load7Day: number
    load28Day: number
    acuteChronicRatio: number | null
    loadStatus: EngineOutput['loadStatus'] | null
    loadFocus: EngineOutput['loadFocus'] | null
  }
  calibration: {
    observedDays: number
    confidence: number
    personalized: boolean
  }
  /** What moved readiness, largest first (points). */
  drivers: Driver[]
  /** Per-signal comparison with the person's own history. */
  signals: SignalDetail[]
  usedCheckin: boolean
  /** Original health+ composite (for comparison only; not displayed as primary). */
  legacy: {
    algorithmVersion: string
    readiness: number | null
    recovery: number | null
    stress: number | null
    bodyBattery: number | null
  }
}

/** v2 load bands (acute 7-day vs prior-21-day weekly average). Penalty starts above 1.3. */
export function v2LoadStatus(acr: number): EngineOutput['loadStatus'] {
  if (acr < 0.8) return 'underloaded'
  if (acr <= 1.3) return 'balanced'
  if (acr <= 1.5) return 'controlledRamp'
  return 'overreaching'
}

export interface V2Extras {
  history: V2Input['history']
  /** From computeTrainingLoad (session-RPE). */
  trainingLoad?: TrainingLoadResult | null
  checkin?: V2Input['checkin']
}

export interface SampleTimes {
  /** End time (epoch ms) of the samples feeding each core input. */
  sleepEndMs?: number
  hrvMs?: number
  restingHeartRateMs?: number
}

const round = (v: number) => Math.round(v)
const roundTo = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d

function score(value: number, status: ScoreStatus): ScoreResult {
  return { value: status === 'insufficient' ? null : round(value), status }
}

export function assessReadiness(
  input: EngineInput,
  ctx: EngineContext,
  sampleTimes: SampleTimes = {},
  maxSampleAgeHours = DEFAULT_MAX_SAMPLE_AGE_HOURS,
  v2Extras: V2Extras = { history: { hrv: [], rhr: [], sleepHours: [] } },
): ReadinessAssessment {
  const maxAgeMs = maxSampleAgeHours * 3_600_000
  const isFresh = (t: number | undefined) => t === undefined || ctx.nowMs - t <= maxAgeMs

  const stale: InputKey[] = []
  // Drop stale core values before scoring so they cannot masquerade as "today".
  const raw = { ...input.raw, sleep: { ...input.raw.sleep } }
  if (raw.sleep.totalHours !== undefined && !isFresh(sampleTimes.sleepEndMs)) {
    stale.push('sleep')
    raw.sleep = {}
  }
  if (raw.heartRateVariabilitySDNN !== undefined && !isFresh(sampleTimes.hrvMs)) {
    stale.push('hrv')
    raw.heartRateVariabilitySDNN = undefined
  }
  if (raw.restingHeartRate !== undefined && !isFresh(sampleTimes.restingHeartRateMs)) {
    stale.push('restingHeartRate')
    raw.restingHeartRate = undefined
  }

  const effectiveInput: EngineInput = { ...input, raw }
  const out = buildDerivedMetrics(effectiveInput, ctx)
  const b = input.baselines

  const has = {
    sleep: raw.sleep.totalHours !== undefined,
    sleepStages: raw.sleep.deepHours !== undefined || raw.sleep.remHours !== undefined,
    hrv: raw.heartRateVariabilitySDNN !== undefined,
    hrvBaseline: b.averageHRV7Day !== undefined,
    restingHeartRate: raw.restingHeartRate !== undefined,
    restingHeartRateBaseline: b.averageRestingHeartRate7Day !== undefined,
    sleepBaseline: b.averageSleepHours7Day !== undefined,
    workouts: input.workouts.length > 0 || (v2Extras.trainingLoad?.sessions.length ?? 0) > 0,
    activity: raw.stepsToday !== undefined || raw.activeEnergyKCal !== undefined,
    energy: raw.activeEnergyKCal !== undefined && raw.basalEnergyKCal !== undefined,
    nutrition: Object.values(raw.nutrients).some((v) => v !== undefined),
    mobility: Object.values(raw.mobility).some((v) => v !== undefined),
    vo2Max: raw.vo2Max !== undefined,
    bodyComposition: raw.bodyMassIndex !== undefined || raw.bodyFatPercent !== undefined,
  } satisfies Record<InputKey, boolean>

  const keys = Object.keys(has) as InputKey[]
  const presentInputs = keys.filter((k) => has[k])
  const defaultedInputs = keys.filter((k) => !has[k] && !stale.includes(k))

  const coreCurrent = [has.sleep, has.hrv, has.restingHeartRate].filter(Boolean).length
  const coreBaselines = [has.sleepBaseline, has.hrvBaseline, has.restingHeartRateBaseline].filter(Boolean).length
  const completeness = roundTo((coreCurrent + coreBaselines) / 6, 2)

  const compositeStatus: ScoreStatus =
    coreCurrent < 2 ? 'insufficient' : coreCurrent === 3 && coreBaselines === 3 ? 'ok' : 'limited'

  const single = (present: boolean, baseline: boolean): ScoreStatus =>
    !present ? 'insufficient' : baseline ? 'ok' : 'limited'

  const fatigueStatus: ScoreStatus = !has.workouts ? 'insufficient' : compositeStatus === 'insufficient' ? 'limited' : compositeStatus

  const s = out.intermediates
  const d = out.derived

  const v2 = computeReadinessV2({
    today: { hrv: raw.heartRateVariabilitySDNN, rhr: raw.restingHeartRate, sleepHours: raw.sleep.totalHours },
    history: v2Extras.history,
    load:
      v2Extras.trainingLoad && v2Extras.trainingLoad.chronicWeekly
        ? { acute7: v2Extras.trainingLoad.acute7, chronicWeekly: v2Extras.trainingLoad.chronicWeekly }
        : null,
    checkin: v2Extras.checkin ?? null,
  })
  const legacyVal = (x: number) => (compositeStatus === 'insufficient' ? null : round(x))

  return {
    algorithmVersion: ALGORITHM_VERSION,
    engineSource: ENGINE_SOURCE,
    computedAt: new Date(ctx.nowMs).toISOString(),
    completeness,
    presentInputs,
    defaultedInputs,
    staleInputs: stale,
    scores: {
      readiness: v2.readiness,
      recovery: v2.recovery,
      stress: v2.stress,
      bodyBattery: score(d.bodyBattery, compositeStatus),
      sleep: score(d.sleepScore, single(has.sleep, has.sleepBaseline && has.sleepStages)),
      hrvVsBaseline: score(s.hrvScore, single(has.hrv, has.hrvBaseline)),
      restingHeartRateVsBaseline: score(s.restingHeartScore, single(has.restingHeartRate, has.restingHeartRateBaseline)),
      fatigue: score(out.fatigueScore, fatigueStatus),
    },
    baselineComparison: {
      hrvDeltaPercent:
        has.hrv && has.hrvBaseline && b.averageHRV7Day! > 0
          ? roundTo(((raw.heartRateVariabilitySDNN! - b.averageHRV7Day!) / b.averageHRV7Day!) * 100, 1)
          : null,
      restingHeartRateDeltaBpm:
        has.restingHeartRate && has.restingHeartRateBaseline
          ? roundTo(raw.restingHeartRate! - b.averageRestingHeartRate7Day!, 1)
          : null,
      sleepDeltaHours:
        has.sleep && has.sleepBaseline ? roundTo(raw.sleep.totalHours! - b.averageSleepHours7Day!, 2) : null,
    },
    training: {
      loadModel: TRAINING_LOAD_VERSION,
      ratedShare: v2Extras.trainingLoad?.ratedShare ?? 0,
      sessions: (v2Extras.trainingLoad?.sessions ?? []).slice(0, 20).map(({ startMs, durationMinutes, modality, rpe, rpeSource, load, sources }) => ({ startMs, durationMinutes: Math.round(durationMinutes), modality, rpe, rpeSource, load: Math.round(load), sources })),
      load7Day: v2Extras.trainingLoad ? v2Extras.trainingLoad.acute7 : 0,
      load28Day: v2Extras.trainingLoad ? Math.round(v2Extras.trainingLoad.sessions.reduce((a, s) => a + s.load, 0)) : 0,
      // Same ratio and thresholds that drive the v2 readiness load adjustment.
      acuteChronicRatio: v2.acuteChronicRatio !== null ? roundTo(v2.acuteChronicRatio, 2) : null,
      loadStatus: v2.acuteChronicRatio === null ? null : v2LoadStatus(v2.acuteChronicRatio),
      loadFocus: has.workouts ? out.loadFocus : null,
    },
    calibration: {
      observedDays: out.calibration.observedDays,
      confidence: roundTo(out.calibration.confidence, 2),
      personalized: out.calibration.observedDays >= 14 && out.calibration.confidence >= 0.55,
    },
    drivers: v2.drivers,
    signals: v2.signals,
    usedCheckin: v2.usedCheckin,
    legacy: {
      algorithmVersion: LEGACY_ALGORITHM_VERSION,
      readiness: legacyVal(d.readinessScore),
      recovery: legacyVal(d.recoveryScore),
      stress: legacyVal(d.stressScore),
      bodyBattery: legacyVal(d.bodyBattery),
    },
  }
}
