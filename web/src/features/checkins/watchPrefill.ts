import { localDateKey } from '@shared/metrics/calendar.ts'
import type { Snapshot } from '@/lib/api'

/**
 * Suggests check-in answers from today's Apple Watch snapshot.
 *
 * Only two answers have a measured counterpart; the rest (mental state, soreness, pain,
 * goal) are subjective and are never pre-filled.
 *
 *  - Sleep quality (1–5) ← sleep score (0–100, health+ formula: duration vs need, efficiency,
 *    deep/REM, sleep debt). Linear: 1 + 4 × score / 100, so 0 → 1, 50 → 3, 100 → 5.
 *  - Energy (1–5) ← recovery score (readiness v2: 65 = "your normal", ±12 per SD of your own
 *    HRV / resting HR / sleep). 3 + (recovery − 65) / 12, so your normal → 3 "Normal", one SD
 *    better → 4, two → 5. Recovery, not readiness: readiness already includes the check-in.
 *
 * Both are rounded half-up to the nearest whole step (Math.round) and clamped to 1–5. The
 * raw score is returned too so the UI can show exactly what was rounded.
 *
 * A suggestion is offered only when the snapshot is for the client's current local day and
 * the score was actually computed (not withheld for missing/stale data).
 */
export interface WatchSuggestion {
  field: 'sleep' | 'energy'
  /** Rounded 1–5 answer. */
  value: number
  /** Source score 0–100 it came from. */
  score: number
  /** Unrounded mapping, e.g. 3.88 → value 4. */
  exact: number
}

export interface WatchPrefill {
  suggestions: WatchSuggestion[]
  computedAt: string
  simulated: boolean
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const round2 = (x: number) => Math.round(x * 100) / 100

export function sleepScoreToQuality(score: number) {
  const exact = clamp(1 + (4 * score) / 100, 1, 5)
  return { exact: round2(exact), value: Math.round(exact) }
}

export function recoveryToEnergy(recovery: number) {
  const exact = clamp(3 + (recovery - 65) / 12, 1, 5)
  return { exact: round2(exact), value: Math.round(exact) }
}

export function watchPrefill(snapshot: Snapshot | null | undefined, nowMs = Date.now()): WatchPrefill | null {
  if (!snapshot) return null
  if (snapshot.snapshot_date !== localDateKey(nowMs, snapshot.time_zone)) return null
  const a = snapshot.assessment
  const scores = a?.scores
  if (!scores) return null
  const suggestions: WatchSuggestion[] = []

  const sleep = scores.sleep
  if (sleep && sleep.status !== 'insufficient' && sleep.value !== null && !a.staleInputs?.includes('sleep')) {
    suggestions.push({ field: 'sleep', score: sleep.value, ...sleepScoreToQuality(sleep.value) })
  }
  const recovery = scores.recovery
  if (recovery && recovery.status !== 'insufficient' && recovery.value !== null) {
    suggestions.push({ field: 'energy', score: recovery.value, ...recoveryToEnergy(recovery.value) })
  }
  if (suggestions.length === 0) return null
  return { suggestions, computedAt: snapshot.computed_at, simulated: snapshot.origin === 'demo' }
}
