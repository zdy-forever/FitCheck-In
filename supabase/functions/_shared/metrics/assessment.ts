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

export const ALGORITHM_VERSION = 'fitcheck-readiness@1.0.0+healthplus.668b85d'
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
    workouts: input.workouts.length > 0,
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

  return {
    algorithmVersion: ALGORITHM_VERSION,
    engineSource: ENGINE_SOURCE,
    computedAt: new Date(ctx.nowMs).toISOString(),
    completeness,
    presentInputs,
    defaultedInputs,
    staleInputs: stale,
    scores: {
      readiness: score(d.readinessScore, compositeStatus),
      recovery: score(d.recoveryScore, compositeStatus),
      stress: score(d.stressScore, compositeStatus),
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
      load7Day: roundTo(out.totalLoad7Day, 1),
      load28Day: roundTo(out.totalLoad28Day, 1),
      acuteChronicRatio: has.workouts ? roundTo(out.acuteChronicRatio, 2) : null,
      loadStatus: has.workouts ? out.loadStatus : null,
      loadFocus: has.workouts ? out.loadFocus : null,
    },
    calibration: {
      observedDays: out.calibration.observedDays,
      confidence: roundTo(out.calibration.confidence, 2),
      personalized: out.calibration.observedDays >= 14 && out.calibration.confidence >= 0.55,
    },
  }
}
