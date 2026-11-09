import { fromLocal, localDateKey, localParts, startOfWeek } from '@shared/metrics/calendar.ts'
import { overlaps, sessionEndMs } from '@shared/metrics/training-load.ts'
import type { HealthSample, SessionWithDetails } from '@/lib/api'

/**
 * Training history: coach sessions (FitCheck-In) + Apple Watch workouts (Health export / iOS).
 *
 * A coach session and a watch workout are the same training when their time ranges overlap
 * (same rule and slack as the training-load model, so the page and the scores always agree).
 * Each session and each workout pairs at most once; among all overlapping pairs the closest
 * start times are paired first. Unpaired workouts are solo training. Cancelled sessions never pair.
 */

export interface WatchWorkout {
  id: string
  kind: string
  startMs: number
  endMs: number
  minutes: number
  avgHr?: number
  maxHr?: number
  kcal?: number
  km?: number
  effort?: number
  source: string | null
  simulated: boolean
}

export type TrainingEntry =
  | { type: 'session'; at: number; session: SessionWithDetails; watch: WatchWorkout | null }
  | { type: 'solo'; at: number; watch: WatchWorkout }

export function toWatchWorkout(s: HealthSample): WatchWorkout {
  const m = (s.metadata ?? {}) as Record<string, number | undefined>
  return {
    id: String(s.id),
    kind: s.category ?? 'mixed',
    startMs: Date.parse(s.start_at),
    endMs: Date.parse(s.measured_at),
    minutes: s.value,
    avgHr: m.averageHeartRate,
    maxHr: m.maxHeartRate,
    kcal: m.energyKCal,
    km: m.distanceKM,
    effort: m.appleEffort,
    source: s.source_name,
    simulated: s.origin === 'demo',
  }
}

export function buildTrainingLog(sessions: SessionWithDetails[], workouts: HealthSample[], nowMs = Date.now()): TrainingEntry[] {
  const watch = workouts.filter((w) => w.metric_type === 'workout').map(toWatchWorkout)
  const past = sessions.filter((s) => Date.parse(s.scheduled_at) <= nowMs) // upcoming sessions are not history

  // All overlapping (session, workout) pairs, closest start first, then assigned greedily.
  const pairs: { s: SessionWithDetails; w: WatchWorkout; gap: number }[] = []
  for (const s of past) {
    if (s.status === 'cancelled') continue
    const startMs = Date.parse(s.scheduled_at)
    const end = sessionEndMs({ startMs, durationMinutes: s.duration_minutes, sessionType: s.session_type })
    for (const w of watch) if (overlaps(startMs, end, w.startMs, w.endMs)) pairs.push({ s, w, gap: Math.abs(w.startMs - startMs) })
  }
  pairs.sort((a, b) => a.gap - b.gap)
  const bySession = new Map<string, WatchWorkout>()
  const used = new Set<string>()
  for (const { s, w } of pairs) {
    if (bySession.has(s.id) || used.has(w.id)) continue
    bySession.set(s.id, w)
    used.add(w.id)
  }

  const entries: TrainingEntry[] = past.map((s) => ({ type: 'session' as const, at: Date.parse(s.scheduled_at), session: s, watch: bySession.get(s.id) ?? null }))
  for (const w of watch) if (!used.has(w.id) && w.startMs <= nowMs) entries.push({ type: 'solo', at: w.startMs, watch: w })
  return entries.sort((a, b) => b.at - a.at)
}

/** Minutes an entry counts for: the watch's measured duration, else the session's planned one. */
export function entryMinutes(e: TrainingEntry): number {
  if (e.watch) return e.watch.minutes
  return e.type === 'session' ? (e.session.duration_minutes ?? 0) : 0
}

/** Did it actually happen? Cancelled sessions and past "planned" ones with no evidence don't count. */
export function entryHappened(e: TrainingEntry): boolean {
  if (e.type === 'solo') return true
  if (e.session.status === 'cancelled') return false
  return e.session.status === 'completed' || e.watch !== null
}

export interface PeriodBucket {
  key: string
  /** Epoch ms of the period start (local midnight on Monday / the 1st). */
  startMs: number
  coachMinutes: number
  soloMinutes: number
  coachCount: number
  soloCount: number
  kcal: number
}

/**
 * Totals per week (Mon–Sun) or calendar month in the person's time zone, oldest → newest,
 * including empty periods so gaps show as gaps. `count` periods ending with the current one.
 */
export function periodTotals(entries: TrainingEntry[], period: 'week' | 'month', count: number, timeZone: string, nowMs = Date.now()): PeriodBucket[] {
  const startOf = (t: number) => periodStart(t, period, timeZone)
  const buckets: PeriodBucket[] = []
  let cursor = startOf(nowMs)
  for (let i = 0; i < count; i++) {
    buckets.unshift({ key: localDateKey(cursor, timeZone), startMs: cursor, coachMinutes: 0, soloMinutes: 0, coachCount: 0, soloCount: 0, kcal: 0 })
    cursor = startOf(cursor - 3_600_000) // an hour before this period's start is in the previous one
  }
  const byKey = new Map(buckets.map((b) => [b.key, b]))
  for (const e of entries) {
    if (!entryHappened(e)) continue
    const b = byKey.get(localDateKey(startOf(e.at), timeZone))
    if (!b) continue
    const min = entryMinutes(e)
    if (e.type === 'session') {
      b.coachMinutes += min
      b.coachCount++
    } else {
      b.soloMinutes += min
      b.soloCount++
    }
    b.kcal += e.watch?.kcal ?? 0
  }
  return buckets
}

/** Local midnight on Monday of that week, or on the 1st of that month. */
export function periodStart(t: number, period: 'week' | 'month', timeZone: string): number {
  if (period === 'week') return startOfWeek(t, timeZone, 2) // Foundation weekdays: 1 = Sunday, 2 = Monday
  const p = localParts(t, timeZone)
  return fromLocal(p.year, p.month, 1, 0, 0, 0, 0, timeZone)
}
