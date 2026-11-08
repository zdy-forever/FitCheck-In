/**
 * TypeScript mirror of the subset of `HealthMonitor/Sources/Models/DomainModels.swift`
 * (health_monitor_ios @ 668b85d) that DerivedMetricsEngine consumes.
 *
 * Swift `Optional` → optional property (`?: number`). Swift encodes nil optionals by
 * omitting the key, so `undefined` and "missing" are the same thing here.
 * Dates are epoch milliseconds (the golden vectors use `.millisecondsSince1970`).
 */

export type WorkoutKind =
  | 'running'
  | 'walking'
  | 'cycling'
  | 'strength'
  | 'yoga'
  | 'swimming'
  | 'mixed'
  | 'other'

export type WorkoutDataSource = 'appleHealth' | 'journal'

export interface SleepSummary {
  totalHours?: number
  inBedHours?: number
  deepHours?: number
  remHours?: number
  coreHours?: number
  awakeHours?: number
}

export interface NutrientSummary {
  proteinG?: number
  carbohydratesG?: number
  fatG?: number
  sugarG?: number
  waterL?: number
  caffeineMG?: number
}

export interface MobilitySummary {
  walkingSteadinessPercent?: number
  sixMinuteWalkDistanceM?: number
  walkingSpeedMS?: number
  walkingAsymmetryPercent?: number
  walkingDoubleSupportPercent?: number
  stairAscentSpeedMS?: number
  stairDescentSpeedMS?: number
  runningPowerW?: number
  runningStrideLengthM?: number
  runningGroundContactTimeMS?: number
  runningVerticalOscillationCM?: number
}

export interface ActivityRingSummary {
  moveKCal?: number
  moveGoalKCal?: number
  moveTimeMinutes?: number
  moveTimeGoalMinutes?: number
  exerciseMinutes?: number
  exerciseGoalMinutes?: number
  standHours?: number
  standGoalHours?: number
}

export interface RawHealthData {
  age?: number
  biologicalSex?: string
  stepsToday?: number
  distanceWalkingRunningKM?: number
  activeEnergyKCal?: number
  basalEnergyKCal?: number
  dietaryEnergyKCal?: number
  exerciseMinutes?: number
  standHours?: number
  vo2Max?: number
  restingHeartRate?: number
  heartRateVariabilitySDNN?: number
  walkingHeartRateAverage?: number
  respiratoryRate?: number
  oxygenSaturationPercent?: number
  bodyMassKG?: number
  bodyFatPercent?: number
  leanBodyMassKG?: number
  bodyMassIndex?: number
  heightCM?: number
  sleepingWristTemperatureCelsius?: number
  sleep: SleepSummary
  nutrients: NutrientSummary
  mobility: MobilitySummary
  activityRings?: ActivityRingSummary
}

export interface BaselineMetrics {
  averageSleepHours7Day?: number
  averageHRV7Day?: number
  averageRestingHeartRate7Day?: number
  averageSteps7Day?: number
  averageActiveEnergy7Day?: number
  averageWaterL7Day?: number
  trainingLoad7Day: number
  trainingLoad28Day: number
}

export interface HeartRateZoneDistribution {
  zone1: number
  zone2: number
  zone3: number
  zone4: number
  zone5: number
}

export interface WorkoutSummary {
  id: string
  /** End date of the workout, epoch ms. */
  date: number
  activityName: string
  kind: WorkoutKind
  durationMinutes: number
  calories?: number
  distanceKM?: number
  averageHeartRate?: number
  maxHeartRate?: number
  source: WorkoutDataSource
  effortScore: number
  estimatedLoad: number
  zoneDistribution: HeartRateZoneDistribution
  muscleGroup?: string
  strengthVolumeKG?: number
}

export interface DailyTrendPoint {
  /** Local start of day, epoch ms. */
  date: number
  steps?: number
  activeEnergyKCal?: number
  sleepHours?: number
  activityLoad: number
  journalImpact: number
  moveCompletion?: number
  exerciseCompletion?: number
  standCompletion?: number
}

export interface DerivedMetrics {
  sleepScore: number
  bodyBattery: number
  stressScore: number
  readinessScore: number
  physicalOutputScore: number
  bodyCompositionScore: number
  nutritionScore: number
  mobilityScore: number
  consistencyScore: number
  energyBalanceKCal?: number
  healthAge?: number
  recoveryScore: number
}

export interface CalibrationProfile {
  observedDays: number
  confidence: number
  sleepNeedHours: number
  hrvBaseline?: number
  restingHeartRateBaseline?: number
  activeEnergyTarget: number
  stepsTarget: number
  weeklyLoadTarget: number
  loadRampTolerance: number
  sessionsPerWeekTarget: number
}

/** Language-neutral keys for the Chinese status strings of `buildLoadAnalysis`. */
export type LoadStatus = 'underloaded' | 'balanced' | 'controlledRamp' | 'overreaching'

/** Language-neutral keys for `determineLoadFocus` ("基础有氧" / "阈值耐力" / "无氧冲击"). */
export type LoadFocus = 'aerobicBase' | 'thresholdEndurance' | 'anaerobic'

export interface EngineInput {
  raw: RawHealthData
  baselines: BaselineMetrics
  workouts: WorkoutSummary[]
  dailyTrends: DailyTrendPoint[]
  longTermTrends: DailyTrendPoint[]
  /**
   * Average journal impact today. The original engine reads this from the health+
   * journal; FitCheck-In has no journal, so it is 0 unless supplied.
   */
  journalImpactToday?: number
}

export interface EngineIntermediates {
  hrvScore: number
  restingHeartScore: number
  energyAvailabilityScore: number
  activityPaceScore: number
  cardioScore: number
  cardioReserveScore: number
  loadCapacityScore: number
  chronicWeeklyLoad: number
}

export interface EngineOutput {
  derived: DerivedMetrics
  calibration: CalibrationProfile
  totalLoad7Day: number
  totalLoad28Day: number
  acuteChronicRatio: number
  fatigueScore: number
  loadFocus: LoadFocus
  loadStatus: LoadStatus
  zoneDistribution: HeartRateZoneDistribution
  intermediates: EngineIntermediates
}
