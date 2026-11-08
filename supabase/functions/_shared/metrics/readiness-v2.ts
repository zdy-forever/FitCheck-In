/**
 * FitCheck-In readiness model v2 (`fitcheck-readiness@2.0.0`).
 *
 * Replaces the health+ composite for display. The faithful health+ port stays in
 * `engine.ts` (and its golden tests) for reference and comparison.
 *
 * Problems in the original composite that v2 fixes
 * ------------------------------------------------
 *  1. Stress had a +34 constant: a perfectly normal day scored ~56/100 ("elevated").
 *     → v2 stress is centred on the person's own normal; a typical day ≈ 30–40 ("low").
 *  2. Absolute HRV/RHR thresholds compared people with each other (HRV 25 ms scored worse
 *     than 85 ms even when both were exactly at their own normal) — penalising age/genetics.
 *     → v2 uses only within-person deviations (z-scores vs the person's own history).
 *  3. The 7-day baseline included today's value, shrinking every deviation.
 *     → v2 baseline = the previous days only (today excluded).
 *  4. Missing inputs were replaced by neutral constants (sleep 55, HRV 60, nutrition 55…),
 *     and missing food intake was assumed to be 82 % of expenditure.
 *     → v2 uses only measured signals and re-normalises weights over what exists.
 *  5. VO₂ "cardio score" could reach 125 and dominate a weighted sum.
 *     → VO₂ max is a long-term fitness marker, not a daily readiness signal; v2 omits it.
 *  6. Sleep debt was measured against a fixed 8 h for everyone.
 *     → v2 compares with the person's own typical sleep (bounded to 7–9 h).
 *  7. Readiness included Body Battery, which included Recovery, which included sleep/HRV,
 *     so the same signals were counted three or four times.
 *     → v2: readiness = recovery (each signal once) adjusted by training load and the
 *       client's own check-in. No nested composites.
 *
 * Method
 * ------
 *  - For each signal, z = (today − personal mean) / max(personal SD, floor), using the
 *    previous 28 days (at least MIN_HISTORY_DAYS). Floors stop a very stable person from
 *    getting extreme z-scores from tiny changes.
 *  - Sign so that positive = better (HRV up, RHR down, more sleep up to need).
 *  - Recovery = 65 + 12 × weighted mean z, clamped to 0–100 (z = 0, i.e. "your normal",
 *    displays as 65 — a neutral-good day; ±1 SD moves it 12 points).
 *  - Stress (physiological strain) = 100 − recovery-like scale built from HRV↓ and RHR↑ only
 *    (sleep excluded so it is not double-counted): 35 − 15 × z, floored at 10.
 *  - Readiness = recovery, minus a load penalty when the acute:chronic ratio is high,
 *    nudged by the subjective check-in (energy, soreness, pain, sleep quality) when present.
 *
 * Every output lists its drivers so the UI can explain the number.
 * These are coaching estimates, not medical assessments.
 */

export const READINESS_V2_VERSION = 'fitcheck-readiness@2.0.0'

export const MIN_HISTORY_DAYS = 4
const HISTORY_DAYS = 28
const NORMAL_DISPLAY = 65 // score shown for "exactly your normal"
const POINTS_PER_Z = 12

/** Minimum SDs so a very stable baseline does not exaggerate tiny changes. */
const SD_FLOOR = { hrvPercent: 0.07, rhrBpm: 2.0, sleepHours: 0.5 } as const

/** Relative importance of each signal for recovery (re-normalised over what is present). */
const WEIGHTS = { hrv: 0.45, rhr: 0.3, sleep: 0.25 } as const

export type SignalKey = 'hrv' | 'rhr' | 'sleep'
export type V2Status = 'ok' | 'limited' | 'insufficient'

export interface DailyValue {
  /** Local calendar date YYYY-MM-DD. */
  day: string
  value: number
}

export interface V2Input {
  /** Today's values (undefined = not measured / stale). */
  today: { hrv?: number; rhr?: number; sleepHours?: number }
  /** One value per previous day (today must NOT be included). */
  history: { hrv: DailyValue[]; rhr: DailyValue[]; sleepHours: DailyValue[] }
  /** Training load from workouts, if any were recorded in the last 28 days. */
  load?: { acute7: number; chronicWeekly: number } | null
  /** Most recent same-day pre-session check-in, if any. */
  checkin?: { energy: number; sleepQuality: number; soreness: number; pain: number } | null
}

export interface SignalDetail {
  key: SignalKey
  today: number | null
  baselineMean: number | null
  baselineDays: number
  /** Positive = better than your normal. null when not computable. */
  z: number | null
  /** today − mean, in the signal's unit. */
  delta: number | null
}

export interface V2Score {
  value: number | null
  status: V2Status
}

export interface Driver {
  key: 'hrv' | 'rhr' | 'sleep' | 'load' | 'checkinEnergy' | 'checkinSoreness' | 'checkinPain' | 'checkinSleep'
  /** Points this driver moved the score (+ up, − down), rounded. */
  impact: number
}

export interface V2Result {
  version: typeof READINESS_V2_VERSION
  recovery: V2Score
  stress: V2Score
  readiness: V2Score
  signals: SignalDetail[]
  drivers: Driver[]
  acuteChronicRatio: number | null
  usedCheckin: boolean
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}

/** Trim the single most extreme value on each side when there is enough history (robust mean/SD). */
function robust(values: number[]): number[] {
  if (values.length < 7) return values
  const s = [...values].sort((a, b) => a - b)
  return s.slice(1, -1)
}

function signal(key: SignalKey, today: number | undefined, history: DailyValue[]): SignalDetail {
  const vals = robust(history.slice(-HISTORY_DAYS).map((d) => d.value).filter((v) => Number.isFinite(v)))
  const n = history.slice(-HISTORY_DAYS).length
  if (today === undefined || !Number.isFinite(today)) return { key, today: null, baselineMean: vals.length ? mean(vals) : null, baselineDays: n, z: null, delta: null }
  if (n < MIN_HISTORY_DAYS || vals.length === 0) return { key, today, baselineMean: vals.length ? mean(vals) : null, baselineDays: n, z: null, delta: null }

  const m = mean(vals)
  const s = sd(vals)
  let z: number
  if (key === 'hrv') {
    // HRV is roughly log-normal: compare on a relative scale.
    const floor = SD_FLOOR.hrvPercent * m
    z = (today - m) / Math.max(s, floor)
  } else if (key === 'rhr') {
    z = -(today - m) / Math.max(s, SD_FLOOR.rhrBpm) // lower RHR = better
  } else {
    // Sleep: shortfall vs personal need hurts; extra sleep helps only a little (and not beyond +1 z).
    const need = clamp(m, 7, 9)
    const raw = (today - need) / Math.max(s, SD_FLOOR.sleepHours)
    z = raw >= 0 ? Math.min(raw * 0.5, 1) : raw
  }
  return { key, today, baselineMean: m, baselineDays: n, z: clamp(z, -3, 3), delta: today - m }
}

export function computeReadinessV2(input: V2Input): V2Result {
  const signals: SignalDetail[] = [
    signal('hrv', input.today.hrv, input.history.hrv),
    signal('rhr', input.today.rhr, input.history.rhr),
    signal('sleep', input.today.sleepHours, input.history.sleepHours),
  ]
  const usable = signals.filter((s) => s.z !== null)
  const drivers: Driver[] = []

  // ── Recovery ──
  let recovery: V2Score = { value: null, status: 'insufficient' }
  let recoveryValue: number | null = null
  if (usable.length >= 2) {
    const wSum = usable.reduce((a, s) => a + WEIGHTS[s.key], 0)
    const zMean = usable.reduce((a, s) => a + WEIGHTS[s.key] * s.z!, 0) / wSum
    recoveryValue = clamp(NORMAL_DISPLAY + POINTS_PER_Z * zMean, 0, 100)
    for (const s of usable) drivers.push({ key: s.key, impact: Math.round((POINTS_PER_Z * WEIGHTS[s.key] * s.z!) / wSum) })
    recovery = { value: Math.round(recoveryValue), status: usable.length === 3 ? 'ok' : 'limited' }
  }

  // ── Stress (physiological strain from autonomic signals only) ──
  const auto = usable.filter((s) => s.key === 'hrv' || s.key === 'rhr')
  let stress: V2Score = { value: null, status: 'insufficient' }
  if (auto.length >= 1 && usable.length >= 2) {
    const wSum = auto.reduce((a, s) => a + WEIGHTS[s.key], 0)
    const zMean = auto.reduce((a, s) => a + WEIGHTS[s.key] * s.z!, 0) / wSum
    // Normal day (z=0) → 35 ("low"); 2 SD worse → 65; floor 10 (zero strain is not a real state).
    stress = { value: Math.round(clamp(35 - 15 * zMean, 10, 100)), status: auto.length === 2 ? 'ok' : 'limited' }
  }

  // ── Training load ──
  let acr: number | null = null
  let loadPenalty = 0
  if (input.load && input.load.chronicWeekly > 0) {
    acr = input.load.acute7 / input.load.chronicWeekly
    // No penalty up to 1.3 (normal progression); then 25 points per +1.0 of ratio, capped at 15.
    loadPenalty = clamp((acr - 1.3) * 25, 0, 15)
  }

  // ── Subjective check-in (the client's own report is a valid, first-class signal) ──
  let checkinAdj = 0
  const c = input.checkin
  if (c) {
    const parts: Driver[] = [
      { key: 'checkinEnergy', impact: (c.energy - 3) * 3 }, // 1..5 → −6..+6
      { key: 'checkinSleep', impact: (c.sleepQuality - 3) * 2 }, // −4..+4
      { key: 'checkinSoreness', impact: -Math.max(0, c.soreness - 3) * 1.2 }, // 0..−8.4
      { key: 'checkinPain', impact: -Math.max(0, c.pain - 1) * 1.5 }, // 0..−13.5
    ]
    for (const p of parts) {
      if (Math.round(p.impact) !== 0) drivers.push({ key: p.key, impact: Math.round(p.impact) })
      checkinAdj += p.impact
    }
  }

  // ── Readiness ──
  let readiness: V2Score = { value: null, status: 'insufficient' }
  if (recoveryValue !== null) {
    if (loadPenalty > 0) drivers.push({ key: 'load', impact: -Math.round(loadPenalty) })
    readiness = { value: Math.round(clamp(recoveryValue - loadPenalty + checkinAdj, 0, 100)), status: recovery.status }
  } else if (c) {
    // No usable wearable data: a check-in alone gives a clearly-limited estimate.
    readiness = { value: Math.round(clamp(NORMAL_DISPLAY - loadPenalty + checkinAdj, 0, 100)), status: 'limited' }
    if (loadPenalty > 0) drivers.push({ key: 'load', impact: -Math.round(loadPenalty) })
  }

  drivers.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
  return { version: READINESS_V2_VERSION, recovery, stress, readiness, signals, drivers, acuteChronicRatio: acr, usedCheckin: Boolean(c) }
}
