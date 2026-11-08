/**
 * Faithful TypeScript port of `DerivedMetricsEngine.swift`
 * (https://github.com/zdy-forever/health_monitor_ios, commit 668b85d).
 *
 * Porting rules:
 *  - Every formula, constant, weight, clamp range and fallback is copied verbatim.
 *    Do not "improve" numbers here — that would break equivalence with the iOS app.
 *    Equivalence is enforced by `web/tests/metrics/engine.golden.test.ts`, which
 *    replays vectors produced by compiling the original Swift source.
 *  - `Date()` / `Calendar.current` are replaced by explicit `nowMs` + IANA `timeZone`.
 *  - Text outputs (Chinese strings) are replaced by language-neutral keys so the web
 *    app can localise them.
 *  - Journal/supplement analysis (health+ only) is not ported; FitCheck-In passes a
 *    journal impact of 0 unless supplied.
 *
 * IMPORTANT: this engine intentionally reproduces the original behaviour of returning
 * neutral fallback values (e.g. HRV score 60) when an input is missing. Product code
 * must NOT display these numbers directly — use `assessReadiness()` in
 * `assessment.ts`, which withholds scores when core inputs are missing.
 */

import { isSameDay, startOfDay, startOfWeek, wholeDaysBetween } from './calendar.ts'
import type {
  BaselineMetrics,
  CalibrationProfile,
  DailyTrendPoint,
  DerivedMetrics,
  EngineInput,
  EngineOutput,
  HeartRateZoneDistribution,
  LoadFocus,
  LoadStatus,
  RawHealthData,
  SleepSummary,
  WorkoutKind,
  WorkoutSummary,
} from './types.ts'

export const ENGINE_SOURCE = {
  repo: 'https://github.com/zdy-forever/health_monitor_ios',
  file: 'HealthMonitor/Sources/Services/DerivedMetricsEngine.swift',
  commit: '668b85d7b00832bf80e4568aaadd069f875e9f4e',
} as const

export interface EngineContext {
  nowMs: number
  timeZone: string
  /** Foundation `Calendar.firstWeekday`; 1 = Sunday (en_US / zh_CN default). */
  firstWeekday?: number
}

// ───────────────────────────── helpers (verbatim) ─────────────────────────────

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  return values.reduce((a, b) => a + b, 0) / values.length
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2
  return sorted[mid]
}

function trimmedAverage(values: number[], trimFraction = 0.15): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const trim = Math.floor(sorted.length * trimFraction)
  const upperBound = Math.max(trim, sorted.length - trim)
  const trimmed = sorted.slice(trim, upperBound)
  return average(trimmed.length === 0 ? sorted : trimmed)
}

function topBandAverage(values: number[], fraction: number): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => b - a)
  const count = Math.max(1, Math.ceil(sorted.length * fraction))
  return average(sorted.slice(0, count))
}

function normalize(value: number | undefined, target: number): number {
  if (value === undefined || !(target > 0)) return 0.45
  return clamp(value / target, 0, 1.25)
}

export function sleepEfficiency(sleep: SleepSummary): number | undefined {
  if (sleep.totalHours === undefined || sleep.inBedHours === undefined || !(sleep.inBedHours > 0)) return undefined
  return sleep.totalHours / sleep.inBedHours
}

export function sleepDebtHours(sleep: SleepSummary): number | undefined {
  if (sleep.totalHours === undefined) return undefined
  return Math.max(0, 8 - sleep.totalHours)
}

const ZERO_ZONES: HeartRateZoneDistribution = { zone1: 0, zone2: 0, zone3: 0, zone4: 0, zone5: 0 }

function mergeZones(a: HeartRateZoneDistribution, b: HeartRateZoneDistribution): HeartRateZoneDistribution {
  return {
    zone1: a.zone1 + b.zone1,
    zone2: a.zone2 + b.zone2,
    zone3: a.zone3 + b.zone3,
    zone4: a.zone4 + b.zone4,
    zone5: a.zone5 + b.zone5,
  }
}

/** Swift `Int(x)` truncates toward zero. */
const swiftInt = (x: number) => Math.trunc(x)

// ─────────────────────────── public per-workout helpers ───────────────────────

export function estimateWorkoutLoad(args: {
  durationMinutes: number
  averageHeartRate?: number
  maxHeartRate?: number
  calories?: number
  age?: number
  fallbackIntensity?: number
}): number {
  const { durationMinutes, averageHeartRate, maxHeartRate, calories, age } = args
  const fallbackIntensity = args.fallbackIntensity ?? 0.68
  const estimatedMax = maxHeartRate ?? (age !== undefined ? 208 - swiftInt(age * 0.7) : 185)
  const intensity = averageHeartRate !== undefined ? clamp(averageHeartRate / estimatedMax, 0.45, 1.1) : fallbackIntensity
  const energyFactor = calories !== undefined ? clamp(calories / Math.max(durationMinutes * 6, 1), 0.65, 1.5) : 1
  return durationMinutes * intensity * intensity * 1.2 * energyFactor
}

export function estimateZoneDistribution(args: {
  durationMinutes: number
  averageHeartRate?: number
  maxHeartRate?: number
  age?: number
  kind: WorkoutKind
}): HeartRateZoneDistribution {
  const { durationMinutes: d, averageHeartRate, maxHeartRate, age, kind } = args
  if (!(d > 0)) return { ...ZERO_ZONES }
  const estimatedMax = maxHeartRate ?? (age !== undefined ? 208 - swiftInt(age * 0.7) : 185)
  const ratio = (averageHeartRate ?? estimatedMax * 0.66) / estimatedMax

  switch (kind) {
    case 'strength':
      return { zone1: d * 0.15, zone2: d * 0.25, zone3: d * 0.35, zone4: d * 0.25, zone5: 0 }
    case 'yoga':
      return { zone1: d * 0.55, zone2: d * 0.35, zone3: d * 0.1, zone4: 0, zone5: 0 }
    default:
      if (ratio < 0.6) return { zone1: d * 0.8, zone2: d * 0.2, zone3: 0, zone4: 0, zone5: 0 }
      if (ratio < 0.7) return { zone1: d * 0.25, zone2: d * 0.65, zone3: d * 0.1, zone4: 0, zone5: 0 }
      if (ratio < 0.8) return { zone1: d * 0.05, zone2: d * 0.3, zone3: d * 0.5, zone4: d * 0.15, zone5: 0 }
      if (ratio < 0.9) return { zone1: 0, zone2: d * 0.1, zone3: d * 0.35, zone4: d * 0.4, zone5: d * 0.15 }
      return { zone1: 0, zone2: 0, zone3: d * 0.15, zone4: d * 0.4, zone5: d * 0.45 }
  }
}

// ──────────────────────────────── sub-scores ─────────────────────────────────

export function scoreSleep(sleep: SleepSummary, baselineHours: number | undefined, targetHours: number): number {
  const total = sleep.totalHours
  if (total === undefined) {
    return baselineHours !== undefined ? clamp((baselineHours / Math.max(targetHours, 7.2)) * 100, 48, 90) : 55
  }

  const durationScore = 100 - Math.abs(total - targetHours) * 18
  const efficiency = sleepEfficiency(sleep)
  const efficiencyScore = efficiency !== undefined ? clamp(((efficiency - 0.72) / 0.23) * 100, 25, 100) : 62
  const deepScore = sleep.deepHours !== undefined ? clamp((sleep.deepHours / 1.35) * 100, 35, 100) : 64
  const remScore = sleep.remHours !== undefined ? clamp((sleep.remHours / 1.65) * 100, 35, 100) : 64
  const debtPenalty = (sleepDebtHours(sleep) ?? 0) * 12
  const oversleepPenalty = Math.max(0, total - 9.4) * 8
  const baselineAdjustment = baselineHours !== undefined ? clamp((total - baselineHours) * 4.5, -10, 10) : 0

  return clamp(
    durationScore * 0.42 +
      efficiencyScore * 0.24 +
      deepScore * 0.17 +
      remScore * 0.17 +
      baselineAdjustment -
      debtPenalty -
      oversleepPenalty,
    0,
    100,
  )
}

export function scoreHeartRateVariability(current: number | undefined, baseline: number | undefined): number {
  if (current === undefined) return 60
  const absoluteScore = clamp(((current - 18) / 62) * 100, 22, 98)
  if (baseline === undefined || !(baseline > 0)) return absoluteScore
  const ratio = current / baseline
  const relativeScore = clamp(68 + (ratio - 1) * 130, 0, 100)
  return clamp(relativeScore * 0.65 + absoluteScore * 0.35, 0, 100)
}

export function scoreRestingHeartRate(current: number | undefined, baseline: number | undefined): number {
  if (current === undefined) return 60
  let absoluteScore: number
  if (current < 46) {
    absoluteScore = clamp(90 - (46 - current) * 2.2, 55, 95)
  } else if (current >= 46 && current <= 56) {
    absoluteScore = 96 - Math.abs(current - 52) * 1.6
  } else {
    absoluteScore = clamp(96 - (current - 52) * 2.25, 20, 96)
  }
  if (baseline === undefined || !(baseline > 0)) return clamp(absoluteScore, 0, 100)
  const relativeScore = clamp(70 + (baseline - current) * 6.5, 0, 100)
  return clamp(relativeScore * 0.62 + absoluteScore * 0.38, 0, 100)
}

function scoreBodyComposition(raw: RawHealthData): number {
  let score = 78.0
  if (raw.bodyMassIndex !== undefined) score -= Math.abs(raw.bodyMassIndex - 22.5) * 4
  if (raw.bodyFatPercent !== undefined) {
    const target = raw.biologicalSex === 'female' ? 26.0 : 18.0
    score -= Math.abs(raw.bodyFatPercent - target) * 1.4
  }
  if (raw.leanBodyMassKG !== undefined && raw.bodyMassKG !== undefined && raw.bodyMassKG > 0) {
    const leanRatio = raw.leanBodyMassKG / raw.bodyMassKG
    score += (leanRatio - 0.72) * 55
  }
  return clamp(score, 0, 100)
}

function scoreNutrition(raw: RawHealthData, baselines: BaselineMetrics): number {
  const parts: number[] = []
  const n = raw.nutrients
  if (n.proteinG !== undefined && raw.bodyMassKG !== undefined && raw.bodyMassKG > 0) {
    parts.push(clamp((n.proteinG / raw.bodyMassKG / 1.2) * 100, 0, 100))
  }
  if (n.waterL !== undefined) {
    parts.push(clamp((n.waterL / Math.max(baselines.averageWaterL7Day ?? 2.2, 2.2)) * 100, 0, 100))
  }
  if (n.sugarG !== undefined) parts.push(clamp(100 - Math.max(0, n.sugarG - 35) * 1.7, 0, 100))
  if (n.caffeineMG !== undefined) parts.push(clamp(100 - Math.max(0, n.caffeineMG - 250) * 0.2, 0, 100))
  if (n.fatG !== undefined && n.carbohydratesG !== undefined) {
    const ratio = n.carbohydratesG / Math.max(n.fatG, 1)
    parts.push(clamp(65 + Math.min(ratio, 4) * 8, 0, 100))
  }
  if (parts.length === 0) return 55
  return sum(parts) / parts.length
}

function scoreMobility(raw: RawHealthData): number {
  const parts: number[] = []
  const m = raw.mobility
  if (m.walkingSteadinessPercent !== undefined) parts.push(clamp(m.walkingSteadinessPercent, 0, 100))
  if (m.walkingSpeedMS !== undefined) parts.push(clamp((m.walkingSpeedMS / 1.25) * 100, 0, 100))
  if (m.sixMinuteWalkDistanceM !== undefined) parts.push(clamp((m.sixMinuteWalkDistanceM / 550) * 100, 0, 100))
  if (m.walkingAsymmetryPercent !== undefined) parts.push(clamp(100 - m.walkingAsymmetryPercent * 8, 0, 100))
  if (m.walkingDoubleSupportPercent !== undefined) {
    parts.push(clamp(100 - Math.max(0, m.walkingDoubleSupportPercent - 24) * 3, 0, 100))
  }
  if (parts.length === 0) return 60
  return sum(parts) / parts.length
}

function scoreConsistency(dailyTrends: DailyTrendPoint[]): number {
  if (dailyTrends.length === 0) return 50
  const sleepValues = dailyTrends.flatMap((d) => (d.sleepHours !== undefined ? [d.sleepHours] : []))
  const moveValues = dailyTrends.flatMap((d) => (d.moveCompletion !== undefined ? [d.moveCompletion] : []))
  const exerciseValues = dailyTrends.flatMap((d) => (d.exerciseCompletion !== undefined ? [d.exerciseCompletion] : []))
  const trainingDays = dailyTrends.filter((d) => d.activityLoad > 0).length
  const negativeImpactDays = dailyTrends.filter((d) => d.journalImpact < -2).length
  const positiveImpactDays = dailyTrends.filter((d) => d.journalImpact > 1).length

  const sleepConsistency =
    sleepValues.length === 0 ? 55.0 : (sleepValues.filter((v) => v >= 7).length / sleepValues.length) * 100
  const moveConsistency =
    moveValues.length === 0 ? 55.0 : (average(moveValues.map((v) => clamp(v, 0, 1) * 100)) ?? 55)
  const exerciseConsistency =
    exerciseValues.length === 0 ? 55.0 : (average(exerciseValues.map((v) => clamp(v, 0, 1) * 100)) ?? 55)
  const trainingRhythm = clamp((trainingDays / 4.0) * 100, 35, 100)

  return clamp(
    sleepConsistency * 0.34 +
      moveConsistency * 0.26 +
      exerciseConsistency * 0.14 +
      trainingRhythm * 0.18 +
      positiveImpactDays * 2.2 -
      negativeImpactDays * 6.5,
    0,
    100,
  )
}

function estimateHealthAge(a: {
  actualAge?: number
  sleepScore: number
  bodyScore: number
  cardioReserveScore: number
  stressScore: number
  nutritionScore: number
  mobilityScore: number
  restingHeartRate?: number
}): number {
  const baseAge = a.actualAge ?? 35
  let modifier = 0.0
  modifier -= (a.cardioReserveScore - 60) / 14
  modifier -= (a.sleepScore - 65) / 18
  modifier -= (a.bodyScore - 65) / 18
  modifier -= (a.nutritionScore - 65) / 22
  modifier -= (a.mobilityScore - 65) / 20
  modifier += (a.stressScore - 50) / 16
  modifier += ((a.restingHeartRate ?? 60) - 58) / 11
  return clamp(baseAge + modifier, 18, 85)
}

function energyBalance(raw: RawHealthData): number | undefined {
  if (raw.activeEnergyKCal === undefined || raw.basalEnergyKCal === undefined) return undefined
  const intake = raw.dietaryEnergyKCal ?? 0
  return intake - raw.activeEnergyKCal - raw.basalEnergyKCal
}

function scoreEnergyAvailability(raw: RawHealthData): number {
  if (raw.activeEnergyKCal === undefined || raw.basalEnergyKCal === undefined) return 60
  const estimatedNeed = raw.basalEnergyKCal + raw.activeEnergyKCal
  const intake = raw.dietaryEnergyKCal ?? estimatedNeed * 0.82
  const balance = intake - estimatedNeed
  if (balance >= -250 && balance <= 250) return 90 - (Math.abs(balance) / 250) * 10
  if (balance < -250) return clamp(82 - (Math.abs(balance) - 250) / 12, 12, 82)
  return clamp(86 - (balance - 250) / 20, 35, 86)
}

function scoreTodayActivityPace(
  raw: RawHealthData,
  baselines: BaselineMetrics,
  calibration: CalibrationProfile,
  ctx: EngineContext,
): number {
  const dayStart = startOfDay(ctx.nowMs, ctx.timeZone)
  const secondsSinceStart = (ctx.nowMs - dayStart) / 1000
  const dayFraction = clamp(secondsSinceStart / 86_400, 0.18, 1)

  const activeTarget = Math.max(
    (calibration.activeEnergyTarget > 0 ? calibration.activeEnergyTarget : (baselines.averageActiveEnergy7Day ?? 550)) *
      dayFraction,
    120,
  )
  const stepTarget = Math.max(
    (calibration.stepsTarget > 0 ? calibration.stepsTarget : (baselines.averageSteps7Day ?? 7_500)) * dayFraction,
    1_400,
  )
  const exerciseTarget = Math.max(22 * dayFraction, 6)

  const activeScore = normalize(raw.activeEnergyKCal, activeTarget) * 100
  const stepsScore = normalize(raw.stepsToday, stepTarget) * 100
  const exerciseScore = normalize(raw.exerciseMinutes, exerciseTarget) * 100

  return clamp(activeScore * 0.45 + stepsScore * 0.35 + exerciseScore * 0.2, 0, 100)
}

function scoreLoadCapacity(
  workouts: WorkoutSummary[],
  totalLoad7Day: number,
  chronicWeeklyLoad: number,
  calibration: CalibrationProfile,
  daysAgo: (w: WorkoutSummary) => number,
): number {
  const recent = workouts.filter((w) => daysAgo(w) <= 14)
  const recentLoads = recent.map((w) => w.estimatedLoad)
  const averageSessionLoad = recentLoads.length === 0 ? chronicWeeklyLoad / 2 : sum(recentLoads) / recentLoads.length
  const effortScore = average(recent.map((w) => w.effortScore)) ?? 60
  const weeklyTarget = Math.max(calibration.weeklyLoadTarget, chronicWeeklyLoad, 1)
  const personalizedSessionTarget = weeklyTarget / Math.max(calibration.sessionsPerWeekTarget, 2)
  const weeklyCapacityScore = clamp((chronicWeeklyLoad / Math.max(weeklyTarget, 1)) * 100, 30, 100)
  const sessionCapacityScore = clamp((averageSessionLoad / Math.max(personalizedSessionTarget, 24)) * 100, 25, 100)
  const acuteToleranceScore = clamp((totalLoad7Day / Math.max(weeklyTarget, 1)) * 92, 28, 100)

  return clamp(
    weeklyCapacityScore * 0.42 + sessionCapacityScore * 0.28 + effortScore * 0.18 + acuteToleranceScore * 0.12,
    0,
    100,
  )
}

function scoreFatigue(a: {
  acuteChronicRatio: number
  totalLoad7Day: number
  chronicWeeklyLoad: number
  sleepScore: number
  hrvScore: number
  restingHeartScore: number
  energyAvailabilityScore: number
  calibration: CalibrationProfile
}): number {
  const personalizedRamp = Math.max(a.calibration.loadRampTolerance, 1.08)
  const loadStrain = clamp(
    36 +
      (a.acuteChronicRatio - (personalizedRamp - 0.18)) * 78 +
      Math.max(0, a.totalLoad7Day - Math.max(a.chronicWeeklyLoad, a.calibration.weeklyLoadTarget)) * 0.05,
    8,
    100,
  )
  const recoveryPenalty =
    (100 - a.sleepScore) * 0.36 +
    (100 - a.hrvScore) * 0.24 +
    (100 - a.restingHeartScore) * 0.2 +
    (100 - a.energyAvailabilityScore) * 0.2
  return clamp(loadStrain * 0.68 + recoveryPenalty * 0.32, 0, 100)
}

function chronicWeeklyLoad(acuteLoad: number, priorLoad: number, totalLoad28Day: number): number {
  const priorWeeklyEquivalent = priorLoad > 0 ? priorLoad / 3 : 0
  const rollingWeeklyEquivalent = totalLoad28Day / 4
  if (priorWeeklyEquivalent > 0) {
    return Math.max(priorWeeklyEquivalent * 0.65 + rollingWeeklyEquivalent * 0.35, 1)
  }
  return Math.max(rollingWeeklyEquivalent * 0.92 + acuteLoad * 0.08, 1)
}

function compositeCardioReserveScore(cardioScore: number, restingHeartScore: number, hrvScore: number): number {
  const blended = cardioScore * 0.52 + restingHeartScore * 0.28 + hrvScore * 0.2
  const supportSignals = Math.max(restingHeartScore, hrvScore)
  const vo2OptimismPenalty = Math.max(0, cardioScore - supportSignals - 12) * 0.35
  return clamp(blended - vo2OptimismPenalty, 20, 100)
}

function expectedVO2Max(age: number | undefined, sex: string | undefined): number {
  const a = age ?? 35
  if (sex === 'female') return Math.max(26, 38 - Math.max(0, a - 25) * 0.3)
  return Math.max(28, 45 - Math.max(0, a - 25) * 0.35)
}

function determineLoadFocus(zones: HeartRateZoneDistribution): LoadFocus {
  const lowAerobic = zones.zone1 + zones.zone2
  const threshold = zones.zone3 + zones.zone4
  const anaerobic = zones.zone5
  if (anaerobic > threshold && anaerobic > lowAerobic) return 'anaerobic'
  if (threshold > lowAerobic) return 'thresholdEndurance'
  return 'aerobicBase'
}

export function loadStatusFor(acuteChronicRatio: number, loadRampTolerance: number): LoadStatus {
  if (acuteChronicRatio < 0.75) return 'underloaded'
  if (acuteChronicRatio < Math.min(1.12, loadRampTolerance - 0.07)) return 'balanced'
  if (acuteChronicRatio < loadRampTolerance) return 'controlledRamp'
  return 'overreaching'
}

function weeklyTrainingLoads(workouts: WorkoutSummary[], ctx: EngineContext): number[] {
  const grouped = new Map<number, number>()
  for (const w of workouts) {
    const key = startOfWeek(w.date, ctx.timeZone, ctx.firstWeekday ?? 1)
    grouped.set(key, (grouped.get(key) ?? 0) + w.estimatedLoad)
  }
  return [...grouped.values()].sort((a, b) => a - b)
}

function buildCalibration(
  raw: RawHealthData,
  baselines: BaselineMetrics,
  workouts: WorkoutSummary[],
  longTermTrends: DailyTrendPoint[],
  chronic: number,
  ctx: EngineContext,
): CalibrationProfile {
  void raw
  const observedDays = longTermTrends.filter(
    (d) => d.sleepHours !== undefined || d.steps !== undefined || d.activeEnergyKCal !== undefined || d.activityLoad > 0,
  ).length

  const sleepValues = longTermTrends.flatMap((d) => (d.sleepHours !== undefined ? [d.sleepHours] : []))
  const activeValues = longTermTrends.flatMap((d) => (d.activeEnergyKCal !== undefined ? [d.activeEnergyKCal] : []))
  const stepValues = longTermTrends.flatMap((d) => (d.steps !== undefined ? [d.steps] : []))
  const weeklyLoads = weeklyTrainingLoads(workouts, ctx)
  const trainingDays = new Set(workouts.map((w) => startOfDay(w.date, ctx.timeZone))).size
  const sessionsPerWeek = clamp(trainingDays / 4.0, 1.5, 6.0)

  const typicalSleep = trimmedAverage(sleepValues) ?? baselines.averageSleepHours7Day ?? 7.6
  const restorativeSleep = topBandAverage(sleepValues, 0.3) ?? typicalSleep
  const sleepNeedHours = clamp(Math.max(7.4, typicalSleep + 0.1, restorativeSleep - 0.05), 7.2, 9.1)

  const activeEnergyTarget = clamp(trimmedAverage(activeValues) ?? baselines.averageActiveEnergy7Day ?? 550, 320, 1_500)
  const stepsTarget = clamp(trimmedAverage(stepValues) ?? baselines.averageSteps7Day ?? 7_500, 4_500, 18_000)
  const weeklyLoadTarget = clamp(median(weeklyLoads) ?? trimmedAverage(weeklyLoads) ?? chronic, 120, 900)
  const loadRampTolerance = clamp(
    1.08 + sessionsPerWeek * 0.018 + Math.max(0, sleepNeedHours - 7.4) * 0.04,
    1.08,
    1.26,
  )

  const confidence = clamp(
    (observedDays / 28.0) * 0.58 +
      Math.min(workouts.length / 12.0, 1.0) * 0.18 +
      (baselines.averageHRV7Day !== undefined ? 0.12 : 0) +
      (baselines.averageRestingHeartRate7Day !== undefined ? 0.12 : 0),
    0.2,
    1.0,
  )

  return {
    observedDays,
    confidence,
    sleepNeedHours,
    hrvBaseline: baselines.averageHRV7Day,
    restingHeartRateBaseline: baselines.averageRestingHeartRate7Day,
    activeEnergyTarget,
    stepsTarget,
    weeklyLoadTarget,
    loadRampTolerance,
    sessionsPerWeekTarget: sessionsPerWeek,
  }
}

export function isCalibrationPersonalized(c: CalibrationProfile): boolean {
  return c.observedDays >= 14 && c.confidence >= 0.55
}

// ─────────────────────────────────── build ───────────────────────────────────

/** Port of `DerivedMetricsEngine.build(...)` (numeric outputs only). */
export function buildDerivedMetrics(input: EngineInput, ctx: EngineContext): EngineOutput {
  const { raw, baselines, workouts, dailyTrends, longTermTrends } = input
  const daysAgo = (w: WorkoutSummary) => wholeDaysBetween(w.date, ctx.nowMs, ctx.timeZone)

  const zoneDistribution = workouts.reduce((acc, w) => mergeZones(acc, w.zoneDistribution), { ...ZERO_ZONES })

  const recentWorkouts = workouts.filter((w) => daysAgo(w) <= 7)
  const priorWorkouts = workouts.filter((w) => {
    const d = daysAgo(w)
    return d >= 8 && d <= 28
  })
  const totalLoad7Day = sum(recentWorkouts.map((w) => w.estimatedLoad))
  const totalLoad28Day = Math.max(sum(workouts.map((w) => w.estimatedLoad)), totalLoad7Day)
  const chronicEquivalent = chronicWeeklyLoad(totalLoad7Day, sum(priorWorkouts.map((w) => w.estimatedLoad)), totalLoad28Day)
  const acuteChronicRatio = totalLoad7Day / chronicEquivalent
  const calibration = buildCalibration(raw, baselines, workouts, longTermTrends, chronicEquivalent, ctx)

  const sleepScore = scoreSleep(raw.sleep, baselines.averageSleepHours7Day, calibration.sleepNeedHours)
  const hrvScore = scoreHeartRateVariability(
    raw.heartRateVariabilitySDNN,
    calibration.hrvBaseline ?? baselines.averageHRV7Day,
  )
  const restingHeartScore = scoreRestingHeartRate(
    raw.restingHeartRate,
    calibration.restingHeartRateBaseline ?? baselines.averageRestingHeartRate7Day,
  )
  const bodyCompositionScore = scoreBodyComposition(raw)
  const nutritionScore = scoreNutrition(raw, baselines)
  const mobilityScore = scoreMobility(raw)
  const consistencyScore = scoreConsistency(dailyTrends)
  const journalImpact = input.journalImpactToday ?? 0
  const cardioScore = normalize(raw.vo2Max, expectedVO2Max(raw.age, raw.biologicalSex)) * 100
  const cardioReserveScore = compositeCardioReserveScore(cardioScore, restingHeartScore, hrvScore)
  const energyAvailabilityScore = scoreEnergyAvailability(raw)
  const activityPaceScore = scoreTodayActivityPace(raw, baselines, calibration, ctx)
  const loadCapacityScore = scoreLoadCapacity(workouts, totalLoad7Day, chronicEquivalent, calibration, daysAgo)

  const fatigueScore = scoreFatigue({
    acuteChronicRatio,
    totalLoad7Day,
    chronicWeeklyLoad: chronicEquivalent,
    sleepScore,
    hrvScore,
    restingHeartScore,
    energyAvailabilityScore,
    calibration,
  })

  const recoveryScore = clamp(
    sleepScore * 0.24 +
      hrvScore * 0.24 +
      restingHeartScore * 0.18 +
      energyAvailabilityScore * 0.12 +
      nutritionScore * 0.1 +
      mobilityScore * 0.06 +
      (100 - fatigueScore) * 0.06,
    0,
    100,
  )

  const stressScore = clamp(
    34 +
      (100 - hrvScore) * 0.33 +
      (100 - restingHeartScore) * 0.18 +
      (100 - sleepScore) * 0.2 +
      fatigueScore * 0.14 +
      (100 - energyAvailabilityScore) * 0.09 -
      nutritionScore * 0.05 -
      journalImpact * 0.9,
    0,
    100,
  )

  const bodyBattery = clamp(
    sleepScore * 0.24 +
      recoveryScore * 0.24 +
      (100 - stressScore) * 0.16 +
      energyAvailabilityScore * 0.14 +
      (100 - activityPaceScore) * 0.1 +
      nutritionScore * 0.06 +
      consistencyScore * 0.04 +
      journalImpact * 0.5,
    0,
    100,
  )

  const readinessScore = clamp(
    bodyBattery * 0.26 +
      recoveryScore * 0.24 +
      sleepScore * 0.12 +
      hrvScore * 0.14 +
      energyAvailabilityScore * 0.08 +
      nutritionScore * 0.05 +
      mobilityScore * 0.06 +
      cardioScore * 0.06 +
      consistencyScore * 0.06 -
      fatigueScore * 0.13,
    0,
    100,
  )

  const outputScore = clamp(
    readinessScore * 0.3 +
      cardioScore * 0.24 +
      loadCapacityScore * 0.16 +
      activityPaceScore * 0.14 +
      mobilityScore * 0.08 +
      consistencyScore * 0.08,
    0,
    100,
  )

  const healthAge = estimateHealthAge({
    actualAge: raw.age,
    sleepScore,
    bodyScore: bodyCompositionScore,
    cardioReserveScore,
    stressScore,
    nutritionScore,
    mobilityScore,
    restingHeartRate: raw.restingHeartRate,
  })

  const derived: DerivedMetrics = {
    sleepScore,
    bodyBattery,
    stressScore,
    readinessScore,
    physicalOutputScore: outputScore,
    bodyCompositionScore,
    nutritionScore,
    mobilityScore,
    consistencyScore,
    energyBalanceKCal: energyBalance(raw),
    healthAge,
    recoveryScore,
  }

  return {
    derived,
    calibration,
    totalLoad7Day,
    totalLoad28Day,
    acuteChronicRatio,
    fatigueScore,
    loadFocus: determineLoadFocus(zoneDistribution),
    loadStatus: loadStatusFor(acuteChronicRatio, calibration.loadRampTolerance),
    zoneDistribution,
    intermediates: {
      hrvScore,
      restingHeartScore,
      energyAvailabilityScore,
      activityPaceScore,
      cardioScore,
      cardioReserveScore,
      loadCapacityScore,
      chronicWeeklyLoad: chronicEquivalent,
    },
  }
}

/** Groups workouts/trends by local day (used by the aggregation layer). */
export function sameLocalDay(a: number, b: number, timeZone: string): boolean {
  return isSameDay(a, b, timeZone)
}
