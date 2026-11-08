/**
 * FitCheck-In fitness & health metrics (`fitcheck-fitness@1.0.0`).
 *
 * Additional scores built from the extra Apple Health data. Each returns null (never a
 * made-up number) when its inputs are missing, reports its inputs, and uses published
 * reference ranges cited inline. These are coaching estimates, not medical assessments;
 * vitals "out of usual range" flags are prompts to ask the client, not diagnoses.
 *
 *  - cardio     VO₂max level vs age/sex norms (ACSM GETP 11th ed. percentile tables, treadmill)
 *               + 90-day trend. Apple's VO₂max estimate is itself approximate.
 *  - vitals     SpO₂, respiratory rate and wrist temperature during sleep vs the person's own
 *               baseline (deviations, like the Vitals app). Absolute SpO₂ < 95 % is also noted.
 *  - hrr        1-minute heart-rate recovery (Cole et al., NEJM 1999: ≤ 12 bpm abnormal after
 *               exercise testing; higher = better autonomic recovery). Trend vs own baseline.
 *  - activity   WHO 2020: 150–300 min/week moderate activity (vigorous counts double);
 *               daily steps, flights, distance.
 *  - monotony   Foster (1998) training monotony = mean daily load / SD daily load over 7 days;
 *               strain = weekly load × monotony. Monotony > 2 is a common caution threshold.
 *  - running    Running economy proxy (speed per watt) and form (ground contact, vertical
 *               oscillation, stride) vs the person's own recent runs.
 *  - mobility   health+ `scoreMobility` (steadiness, speed, 6MW, asymmetry, double support),
 *               reused as-is, plus Apple's walking-steadiness classification.
 *  - body       trends only (weight, body fat, lean mass, 28 days). No score: body
 *               composition is not a fitness quality measure.
 */

export const FITNESS_VERSION = 'fitcheck-fitness@1.0.0'

export type Status = 'ok' | 'limited' | 'insufficient'
export interface Dated {
  t: number
  v: number
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}
const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d
const latest = (xs: Dated[]) => (xs.length ? xs.reduce((a, b) => (b.t > a.t ? b : a)) : undefined)
const DAY = 86_400_000

/**
 * Least-squares slope per 30 days — reported only when it is a real trend, not noise.
 * Requires ≥ 4 points over ≥ 21 days, and the slope must be statistically distinguishable
 * from zero (|t| ≥ 2, roughly 95 %). Otherwise null: the UI shows no direction rather than
 * turning day-to-day noise into a "trend".
 */
export function trendPer30d(xs: Dated[]): number | null {
  if (xs.length < 4) return null
  const t0 = Math.min(...xs.map((x) => x.t))
  if (Math.max(...xs.map((x) => x.t)) - t0 < 21 * DAY) return null
  const X = xs.map((x) => (x.t - t0) / DAY)
  const Y = xs.map((x) => x.v)
  const mx = mean(X)
  const my = mean(Y)
  const sxx = X.reduce((a, x) => a + (x - mx) ** 2, 0)
  if (sxx === 0) return null
  const slope = X.reduce((a, x, i) => a + (x - mx) * (Y[i]! - my), 0) / sxx
  const intercept = my - slope * mx
  const sse = X.reduce((a, x, i) => a + (Y[i]! - (intercept + slope * x)) ** 2, 0)
  const se = Math.sqrt(sse / (xs.length - 2) / sxx)
  if (se > 0 && Math.abs(slope / se) < 2) return null // indistinguishable from noise
  return slope * 30
}

// ───────────────────────────── cardio fitness ─────────────────────────────

/**
 * ACSM percentile cut-offs (mL/kg/min) for 20th / 40th / 60th / 80th percentiles,
 * by age band and sex. Source: ACSM's Guidelines for Exercise Testing and Prescription,
 * 11th ed., Table 4.7 (treadmill). Rounded to integers.
 */
const VO2_NORMS: Record<'female' | 'male', Array<{ maxAge: number; p: [number, number, number, number] }>> = {
  male: [
    { maxAge: 29, p: [38, 44, 48, 55] },
    { maxAge: 39, p: [34, 39, 43, 49] },
    { maxAge: 49, p: [31, 35, 39, 45] },
    { maxAge: 59, p: [27, 31, 35, 40] },
    { maxAge: 69, p: [23, 27, 30, 35] },
    { maxAge: 200, p: [20, 23, 26, 30] },
  ],
  female: [
    { maxAge: 29, p: [30, 35, 39, 44] },
    { maxAge: 39, p: [27, 31, 34, 39] },
    { maxAge: 49, p: [24, 28, 31, 35] },
    { maxAge: 59, p: [21, 24, 27, 31] },
    { maxAge: 69, p: [19, 21, 24, 27] },
    { maxAge: 200, p: [17, 19, 21, 24] },
  ],
}
export type Vo2Level = 'low' | 'belowAverage' | 'average' | 'aboveAverage' | 'high'

export function vo2Level(vo2: number, age: number, sex: 'female' | 'male'): { level: Vo2Level; percentile: number } {
  const band = VO2_NORMS[sex].find((b) => age <= b.maxAge)!
  const [p20, p40, p60, p80] = band.p
  // Piecewise-linear percentile estimate between the cut-offs (clamped 5–95).
  const pts: Array<[number, number]> = [
    [p20 - (p40 - p20), 0],
    [p20, 20],
    [p40, 40],
    [p60, 60],
    [p80, 80],
    [p80 + (p80 - p60), 100],
  ]
  let pct = 50
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i]!
    const [x1, y1] = pts[i + 1]!
    if (vo2 <= x0 && i === 0) pct = 0
    else if (vo2 >= x0 && vo2 <= x1) pct = y0 + ((vo2 - x0) / (x1 - x0)) * (y1 - y0)
    else if (vo2 > x1 && i === pts.length - 2) pct = 100
  }
  pct = clamp(Math.round(pct), 5, 95)
  const level: Vo2Level = vo2 < p20 ? 'low' : vo2 < p40 ? 'belowAverage' : vo2 < p60 ? 'average' : vo2 < p80 ? 'aboveAverage' : 'high'
  return { level, percentile: pct }
}

export interface CardioResult {
  status: Status
  vo2Max: number | null
  measuredAt: number | null
  /** Population percentile (needs birth year + sex), else null. */
  percentile: number | null
  level: Vo2Level | null
  /** mL/kg/min change per 30 days over the last 90 days. */
  trendPer30d: number | null
  /** Score 0–100: the percentile when norms are available. */
  score: number | null
}

export function cardioFitness(vo2: Dated[], profile: { age?: number; sex?: 'female' | 'male' }): CardioResult {
  const last = latest(vo2)
  if (!last) return { status: 'insufficient', vo2Max: null, measuredAt: null, percentile: null, level: null, trendPer30d: null, score: null }
  const trend = trendPer30d(vo2)
  if (profile.age === undefined || !profile.sex) {
    return { status: 'limited', vo2Max: round(last.v, 1), measuredAt: last.t, percentile: null, level: null, trendPer30d: trend === null ? null : round(trend, 2), score: null }
  }
  const { level, percentile } = vo2Level(last.v, profile.age, profile.sex)
  return { status: 'ok', vo2Max: round(last.v, 1), measuredAt: last.t, percentile, level, trendPer30d: trend === null ? null : round(trend, 2), score: percentile }
}

// ────────────────────────────── vitals check ──────────────────────────────

export interface VitalSignal {
  key: 'spo2' | 'respiratoryRate' | 'wristTemperature'
  latest: number | null
  measuredAt: number | null
  baseline: number | null
  baselineDays: number
  /** latest − baseline (unit of the signal). */
  delta: number | null
  /** Outside the person's usual range (or SpO₂ < 95 %). */
  outOfRange: boolean
}

export interface VitalsResult {
  status: Status
  signals: VitalSignal[]
  outOfRangeCount: number
  /** 100 = all in usual range; −30 per flagged signal; null without ≥ 2 signals with baseline. */
  score: number | null
}

/** Usual-range half-widths when SD is small (like Apple's Vitals app: deviation from typical). */
const VITAL_RULES = {
  spo2: { minSpread: 1.5, k: 2, absoluteLow: 95 },
  respiratoryRate: { minSpread: 1.5, k: 2 },
  wristTemperature: { minSpread: 0.5, k: 2 },
} as const

export function vitalsCheck(series: { spo2: Dated[]; respiratoryRate: Dated[]; wristTemperature: Dated[] }, nowMs: number): VitalsResult {
  const signals: VitalSignal[] = (['spo2', 'respiratoryRate', 'wristTemperature'] as const).map((key) => {
    const xs = series[key]
    const last = latest(xs)
    // Baseline from the previous 28 days, excluding the last 24 h.
    const base = xs.filter((x) => x.t < nowMs - DAY && x.t >= nowMs - 29 * DAY).map((x) => x.v)
    if (!last || nowMs - last.t > 2 * DAY) return { key, latest: null, measuredAt: null, baseline: null, baselineDays: base.length, delta: null, outOfRange: false }
    if (base.length < 5) return { key, latest: round(last.v, 2), measuredAt: last.t, baseline: null, baselineDays: base.length, delta: null, outOfRange: key === 'spo2' && last.v < VITAL_RULES.spo2.absoluteLow }
    const m = mean(base)
    const rule = VITAL_RULES[key]
    const half = Math.max(rule.k * sd(base), rule.minSpread)
    const delta = last.v - m
    const out = Math.abs(delta) > half || (key === 'spo2' && last.v < VITAL_RULES.spo2.absoluteLow)
    return { key, latest: round(last.v, 2), measuredAt: last.t, baseline: round(m, 2), baselineDays: base.length, delta: round(delta, 2), outOfRange: out }
  })
  const withBase = signals.filter((s) => s.baseline !== null)
  const outOfRangeCount = signals.filter((s) => s.outOfRange).length
  const present = signals.filter((s) => s.latest !== null).length
  if (withBase.length < 2) return { status: present > 0 ? 'limited' : 'insufficient', signals, outOfRangeCount, score: null }
  return { status: withBase.length === 3 ? 'ok' : 'limited', signals, outOfRangeCount, score: clamp(100 - 30 * outOfRangeCount, 0, 100) }
}

// ───────────────────────── heart-rate recovery (1 min) ─────────────────────────

export type HrrLevel = 'low' | 'fair' | 'good' | 'excellent'
export interface HrrResult {
  status: Status
  latest: number | null
  measuredAt: number | null
  average28d: number | null
  level: HrrLevel | null
  trendPer30d: number | null
  /** 0–100 mapped from the 28-day average: 12 bpm → 30, 25 → 70, 40+ → 100. */
  score: number | null
}

export function heartRateRecovery(xs: Dated[], nowMs: number): HrrResult {
  const recent = xs.filter((x) => x.t >= nowMs - 28 * DAY)
  const last = latest(xs)
  if (!last || recent.length === 0) return { status: 'insufficient', latest: null, measuredAt: null, average28d: null, level: null, trendPer30d: null, score: null }
  const avg = mean(recent.map((x) => x.v))
  const level: HrrLevel = avg <= 12 ? 'low' : avg < 20 ? 'fair' : avg < 30 ? 'good' : 'excellent'
  const score = avg <= 12 ? clamp(avg * 2.5, 0, 30) : avg <= 25 ? 30 + ((avg - 12) / 13) * 40 : clamp(70 + ((avg - 25) / 15) * 30, 70, 100)
  const trend = trendPer30d(xs.filter((x) => x.t >= nowMs - 90 * DAY))
  return {
    status: recent.length >= 3 ? 'ok' : 'limited',
    latest: round(last.v),
    measuredAt: last.t,
    average28d: round(avg, 1),
    level,
    trendPer30d: trend === null ? null : round(trend, 1),
    score: Math.round(score),
  }
}

// ───────────────────────────── weekly activity ─────────────────────────────

export interface ActivityResult {
  status: Status
  /** Apple exercise minutes over the last 7 days (moderate-or-higher). */
  exerciseMinutes7d: number | null
  /** Of which vigorous (from workouts with RPE ≥ 7 or HR reserve ≥ 60 %), counted double for WHO. */
  vigorousMinutes7d: number
  /** WHO-equivalent moderate minutes (moderate + 2 × vigorous) / 150, as %. */
  whoPercent: number | null
  stepsPerDay7d: number | null
  flightsPerDay7d: number | null
  distanceKm7d: { walkingRunning: number | null; cycling: number | null; swimmingM: number | null }
  activeDays7d: number | null
  score: number | null
}

export function weeklyActivity(input: {
  dailyExerciseMin: Dated[]
  dailySteps: Dated[]
  dailyFlights: Dated[]
  distanceWalkRun: Dated[]
  distanceCycling: Dated[]
  distanceSwimming: Dated[]
  vigorousMinutes7d: number
  nowMs: number
}): ActivityResult {
  const since = input.nowMs - 7 * DAY
  const win = (xs: Dated[]) => xs.filter((x) => x.t > since)
  const sum = (xs: Dated[]) => (xs.length ? xs.reduce((a, x) => a + x.v, 0) : null)
  const ex = win(input.dailyExerciseMin)
  const exerciseMinutes = sum(ex)
  const steps = win(input.dailySteps)
  const flights = win(input.dailyFlights)
  const vig = Math.min(input.vigorousMinutes7d, exerciseMinutes ?? input.vigorousMinutes7d)
  const whoMinutes = exerciseMinutes === null ? null : exerciseMinutes + vig // vigorous counted twice
  const whoPercent = whoMinutes === null ? null : Math.round((whoMinutes / 150) * 100)
  const stepsPerDay = steps.length ? mean(steps.map((x) => x.v)) : null
  // Score: 70 % WHO minutes (capped at 300 min = 100), 30 % steps (10k/day = 100).
  let score: number | null = null
  if (whoMinutes !== null) {
    const minPart = clamp((whoMinutes / 300) * 100, 0, 100)
    const stepPart = stepsPerDay === null ? null : clamp((stepsPerDay / 10_000) * 100, 0, 100)
    score = Math.round(stepPart === null ? minPart : minPart * 0.7 + stepPart * 0.3)
  }
  return {
    status: exerciseMinutes === null ? (steps.length ? 'limited' : 'insufficient') : ex.length >= 5 ? 'ok' : 'limited',
    exerciseMinutes7d: exerciseMinutes === null ? null : Math.round(exerciseMinutes),
    vigorousMinutes7d: Math.round(vig),
    whoPercent,
    stepsPerDay7d: stepsPerDay === null ? null : Math.round(stepsPerDay),
    flightsPerDay7d: flights.length ? round(mean(flights.map((x) => x.v)), 1) : null,
    distanceKm7d: {
      walkingRunning: sum(win(input.distanceWalkRun)) === null ? null : round(sum(win(input.distanceWalkRun))!, 1),
      cycling: sum(win(input.distanceCycling)) === null ? null : round(sum(win(input.distanceCycling))!, 1),
      swimmingM: sum(win(input.distanceSwimming)) === null ? null : Math.round(sum(win(input.distanceSwimming))!),
    },
    activeDays7d: ex.length ? ex.filter((x) => x.v >= 30).length : null,
    score,
  }
}

// ────────────────────── training monotony & strain (Foster) ──────────────────────

export interface MonotonyResult {
  status: Status
  weeklyLoad: number | null
  monotony: number | null
  strain: number | null
  /** 'low' < 1.5 ≤ 'moderate' < 2.0 ≤ 'high' */
  level: 'low' | 'moderate' | 'high' | null
  trainingDays7d: number
}

/** `sessionLoads` = session-RPE loads with start times (from training-load.ts). */
export function monotonyAndStrain(sessionLoads: Dated[], nowMs: number, timeZoneDayKey: (t: number) => string): MonotonyResult {
  const days = new Map<string, number>()
  for (let i = 0; i < 7; i++) days.set(timeZoneDayKey(nowMs - i * DAY), 0)
  for (const s of sessionLoads) {
    const k = timeZoneDayKey(s.t)
    if (days.has(k)) days.set(k, days.get(k)! + s.v)
  }
  const daily = [...days.values()]
  const trainingDays = daily.filter((v) => v > 0).length
  if (trainingDays < 2) return { status: trainingDays === 0 ? 'insufficient' : 'limited', weeklyLoad: trainingDays ? Math.round(daily.reduce((a, b) => a + b, 0)) : null, monotony: null, strain: null, level: null, trainingDays7d: trainingDays }
  const weekly = daily.reduce((a, b) => a + b, 0)
  const s = sd(daily)
  const monotony = s === 0 ? 10 : mean(daily) / s
  return {
    status: 'ok',
    weeklyLoad: Math.round(weekly),
    monotony: round(monotony, 2),
    strain: Math.round(weekly * monotony),
    level: monotony < 1.5 ? 'low' : monotony < 2 ? 'moderate' : 'high',
    trainingDays7d: trainingDays,
  }
}

// ──────────────────────────────── running ────────────────────────────────

export interface RunSample {
  t: number
  powerW?: number
  speedMS?: number
  groundContactMS?: number
  verticalOscillationCM?: number
  strideLengthM?: number
}

export interface RunningResult {
  status: Status
  runs28d: number
  latest: RunSample | null
  /** Running economy proxy: speed (m/s) per 100 W of running power. Higher = more economical. */
  economy: number | null
  economyBaseline: number | null
  economyChangePercent: number | null
  /** Vertical ratio (%) = vertical oscillation / stride length. Lower is generally better. */
  verticalRatio: number | null
  groundContactBaseline: number | null
}

export function runningForm(runs: RunSample[], nowMs: number): RunningResult {
  const recent = runs.filter((r) => r.t >= nowMs - 28 * DAY).sort((a, b) => b.t - a.t)
  if (recent.length === 0) return { status: 'insufficient', runs28d: 0, latest: null, economy: null, economyBaseline: null, economyChangePercent: null, verticalRatio: null, groundContactBaseline: null }
  const econ = (r: RunSample) => (r.powerW && r.speedMS ? (r.speedMS / r.powerW) * 100 : undefined)
  const last = recent[0]!
  const lastEcon = econ(last)
  const prior = recent.slice(1).map(econ).filter((x): x is number => x !== undefined)
  const baseEcon = prior.length >= 2 ? mean(prior) : null
  const vr = last.verticalOscillationCM && last.strideLengthM ? (last.verticalOscillationCM / (last.strideLengthM * 100)) * 100 : null
  const gcts = recent.slice(1).map((r) => r.groundContactMS).filter((x): x is number => x !== undefined)
  return {
    status: lastEcon !== undefined && baseEcon !== null ? 'ok' : 'limited',
    runs28d: recent.length,
    latest: last,
    economy: lastEcon === undefined ? null : round(lastEcon, 3),
    economyBaseline: baseEcon === null ? null : round(baseEcon, 3),
    // Only report a change larger than normal run-to-run variation (2 SD of prior runs).
    economyChangePercent:
      lastEcon !== undefined && baseEcon && Math.abs(lastEcon - baseEcon) > 2 * sd(prior) ? round(((lastEcon - baseEcon) / baseEcon) * 100, 1) : lastEcon !== undefined && baseEcon ? 0 : null,
    verticalRatio: vr === null ? null : round(vr, 1),
    groundContactBaseline: gcts.length >= 2 ? Math.round(mean(gcts)) : null,
  }
}

// ──────────────────────────────── mobility ────────────────────────────────

export interface MobilityResult {
  status: Status
  inputs: { walkingSpeed: number | null; steadiness: number | null; asymmetry: number | null; doubleSupport: number | null; stepLength: number | null; sixMinuteWalk: number | null }
  /** Apple's walking steadiness classification: OK ≥ 40 %, Low 20–40 %, Very low < 20 %. */
  steadinessLevel: 'ok' | 'low' | 'veryLow' | null
  /** health+ scoreMobility, reused unchanged (average of available component scores). */
  score: number | null
}

export function mobility(latestValues: { walkingSpeed?: number; steadiness?: number; asymmetry?: number; doubleSupport?: number; stepLength?: number; sixMinuteWalk?: number }): MobilityResult {
  const v = latestValues
  // Component formulas copied from health+ DerivedMetricsEngine.scoreMobility (golden-tested via engine.ts).
  const parts: number[] = []
  if (v.steadiness !== undefined) parts.push(clamp(v.steadiness, 0, 100))
  if (v.walkingSpeed !== undefined) parts.push(clamp((v.walkingSpeed / 1.25) * 100, 0, 100))
  if (v.sixMinuteWalk !== undefined) parts.push(clamp((v.sixMinuteWalk / 550) * 100, 0, 100))
  if (v.asymmetry !== undefined) parts.push(clamp(100 - v.asymmetry * 8, 0, 100))
  if (v.doubleSupport !== undefined) parts.push(clamp(100 - Math.max(0, v.doubleSupport - 24) * 3, 0, 100))
  const n = (x?: number, d = 2) => (x === undefined ? null : round(x, d))
  return {
    status: parts.length >= 3 ? 'ok' : parts.length > 0 ? 'limited' : 'insufficient',
    inputs: { walkingSpeed: n(v.walkingSpeed), steadiness: n(v.steadiness, 0), asymmetry: n(v.asymmetry, 1), doubleSupport: n(v.doubleSupport, 1), stepLength: n(v.stepLength), sixMinuteWalk: n(v.sixMinuteWalk, 0) },
    steadinessLevel: v.steadiness === undefined ? null : v.steadiness >= 40 ? 'ok' : v.steadiness >= 20 ? 'low' : 'veryLow',
    score: parts.length ? Math.round(mean(parts)) : null,
  }
}

// ────────────────────────────────── body ──────────────────────────────────

export interface BodyResult {
  status: Status
  weight: { latest: number | null; change28d: number | null }
  bodyFat: { latest: number | null; change28d: number | null }
  leanMass: { latest: number | null; change28d: number | null }
}

export function bodyTrends(series: { weight: Dated[]; bodyFat: Dated[]; leanMass: Dated[] }, nowMs: number): BodyResult {
  const one = (xs: Dated[], d: number) => {
    const last = latest(xs)
    if (!last) return { latest: null, change28d: null }
    const old = xs.filter((x) => x.t <= nowMs - 21 * DAY && x.t >= nowMs - 35 * DAY)
    return { latest: round(last.v, d), change28d: old.length ? round(last.v - mean(old.map((x) => x.v)), d) : null }
  }
  const weight = one(series.weight, 1)
  const bodyFat = one(series.bodyFat, 1)
  const leanMass = one(series.leanMass, 1)
  const present = [weight, bodyFat, leanMass].filter((x) => x.latest !== null).length
  return { status: present === 0 ? 'insufficient' : [weight, bodyFat, leanMass].some((x) => x.change28d !== null) ? 'ok' : 'limited', weight, bodyFat, leanMass }
}

// ─────────────────────────────── aggregate ───────────────────────────────

export interface FitnessAssessment {
  version: typeof FITNESS_VERSION
  cardio: CardioResult
  vitals: VitalsResult
  hrr: HrrResult
  activity: ActivityResult
  monotony: MonotonyResult
  running: RunningResult
  mobility: MobilityResult
  body: BodyResult
}

// ─────────────────────── assemble from stored samples ───────────────────────

export interface FitnessSample {
  metricType: string
  value: number
  startAt: number
  measuredAt: number
  category?: string | null
  metadata?: Record<string, number> | null
}

/**
 * Builds all fitness results from stored samples (≥ 90 days for VO₂/HRR trends) plus the
 * session-RPE load sessions. `dayKey` buckets instants into the client's local days.
 */
export function computeFitness(input: {
  samples: FitnessSample[]
  loadSessions: Array<{ startMs: number; load: number; rpe: number; durationMinutes: number }>
  profile: { birthYear?: number | null; sex?: 'female' | 'male' | null }
  nowMs: number
  dayKey: (t: number) => string
}): FitnessAssessment {
  const { samples, nowMs, dayKey } = input
  const of = (m: string): Dated[] => samples.filter((s) => s.metricType === m).map((s) => ({ t: s.measuredAt, v: s.value }))
  const latestOf = (m: string) => latest(of(m))?.v

  const age = input.profile.birthYear ? new Date(nowMs).getUTCFullYear() - input.profile.birthYear : undefined
  const vigorous = input.loadSessions.filter((s) => s.startMs > nowMs - 7 * DAY && s.rpe >= 7).reduce((a, s) => a + s.durationMinutes, 0)

  const runs: RunSample[] = samples
    .filter((s) => s.metricType === 'workout' && s.category === 'running' && s.metadata)
    .map((s) => ({
      t: s.startAt,
      powerW: s.metadata!.runningPowerW,
      speedMS: s.metadata!.runningSpeedMS,
      groundContactMS: s.metadata!.groundContactMS,
      verticalOscillationCM: s.metadata!.verticalOscillationCM,
      strideLengthM: s.metadata!.strideLengthM,
    }))

  return {
    version: FITNESS_VERSION,
    cardio: cardioFitness(of('vo2_max').filter((x) => x.t >= nowMs - 90 * DAY), { age, sex: input.profile.sex ?? undefined }),
    vitals: vitalsCheck({ spo2: of('oxygen_saturation'), respiratoryRate: of('respiratory_rate'), wristTemperature: of('wrist_temperature') }, nowMs),
    hrr: heartRateRecovery(of('heart_rate_recovery'), nowMs),
    activity: weeklyActivity({
      dailyExerciseMin: of('exercise_time'),
      dailySteps: of('step_count'),
      dailyFlights: of('flights_climbed'),
      distanceWalkRun: of('distance_walking_running'),
      distanceCycling: of('distance_cycling'),
      distanceSwimming: of('distance_swimming'),
      vigorousMinutes7d: vigorous,
      nowMs,
    }),
    monotony: monotonyAndStrain(input.loadSessions.map((s) => ({ t: s.startMs, v: s.load })), nowMs, dayKey),
    running: runningForm(runs, nowMs),
    mobility: mobility({
      walkingSpeed: latestOf('walking_speed'),
      steadiness: latestOf('walking_steadiness'),
      asymmetry: latestOf('walking_asymmetry'),
      doubleSupport: latestOf('walking_double_support'),
      stepLength: latestOf('walking_step_length'),
      sixMinuteWalk: latestOf('six_minute_walk'),
    }),
    body: bodyTrends({ weight: of('body_mass'), bodyFat: of('body_fat'), leanMass: of('lean_body_mass') }, nowMs),
  }
}
