import { describe, expect, it } from 'vitest'
import { buildTrainingLog, entryHappened, entryMinutes, periodStart, periodTotals } from '@/features/training/trainingLog'
import type { HealthSample, SessionWithDetails } from '@/lib/api'

const TZ = 'Australia/Sydney'
const NOW = Date.parse('2026-11-09T10:00:00+11:00') // Monday morning, Sydney (DST, +11)

let n = 0
function session(at: string, over: Partial<SessionWithDetails> = {}): SessionWithDetails {
  return {
    id: `s${++n}`,
    trainer_id: 't',
    client_id: 'c',
    scheduled_at: new Date(at).toISOString(),
    duration_minutes: 60,
    status: 'completed',
    session_type: 'strength',
    title: null,
    location: null,
    planned_intensity: null,
    actual_intensity: null,
    created_at: at,
    updated_at: at,
    session_exercises: [],
    post_session_feedback: [],
    ...over,
  } as SessionWithDetails
}
function workout(start: string, minutes: number, kind = 'strength', meta: Record<string, number> = {}): HealthSample {
  const s = Date.parse(start)
  return {
    id: ++n,
    user_id: 'c',
    device_id: null,
    sample_id: `w${n}`,
    metric_type: 'workout',
    value: minutes,
    unit: 'min',
    start_at: new Date(s).toISOString(),
    measured_at: new Date(s + minutes * 60_000).toISOString(),
    category: kind,
    metadata: meta,
    source_name: 'Apple Watch',
    source_bundle: null,
    origin: 'healthkit',
    received_at: new Date(NOW).toISOString(),
  } as HealthSample
}

describe('training log: coach sessions + Apple Watch workouts', () => {
  it('pairs a session with the watch workout recorded at the same time', () => {
    const log = buildTrainingLog([session('2026-11-07T09:00:00+11:00')], [workout('2026-11-07T09:05:00+11:00', 52, 'strength', { averageHeartRate: 128, energyKCal: 340 })], NOW)
    expect(log).toHaveLength(1)
    expect(log[0]!.type).toBe('session')
    expect(log[0]!.watch?.avgHr).toBe(128)
    expect(entryMinutes(log[0]!)).toBe(52) // measured beats planned
  })

  it('a watch started a little early or late still pairs (same 30-min slack as the load model)', () => {
    const log = buildTrainingLog([session('2026-11-07T09:00:00+11:00')], [workout('2026-11-07T08:35:00+11:00', 20)], NOW)
    expect(log.map((e) => e.type)).toEqual(['session'])
  })

  it('a workout pairs with at most one session — the closest start wins', () => {
    const a = session('2026-11-07T09:00:00+11:00', { duration_minutes: 45 })
    const b = session('2026-11-07T10:00:00+11:00', { duration_minutes: 45 })
    const log = buildTrainingLog([a, b], [workout('2026-11-07T09:55:00+11:00', 50)], NOW)
    const paired = log.filter((e) => e.type === 'session' && e.watch)
    expect(paired).toHaveLength(1)
    expect(paired[0]!.type === 'session' && paired[0]!.session.id).toBe(b.id)
  })

  it('workouts at other times are solo training; cancelled and future sessions never pair', () => {
    const cancelled = session('2026-11-06T18:00:00+11:00', { status: 'cancelled' })
    const future = session('2026-11-10T18:00:00+11:00', { status: 'planned' })
    const log = buildTrainingLog([cancelled, future], [workout('2026-11-06T18:00:00+11:00', 40, 'running'), workout('2026-11-05T07:00:00+11:00', 30, 'running')], NOW)
    expect(log.filter((e) => e.type === 'solo')).toHaveLength(2)
    const c = log.find((e) => e.type === 'session')!
    expect(c.watch).toBeNull()
    expect(entryHappened(c)).toBe(false)
    expect(log.some((e) => e.type === 'session' && e.session.id === future.id)).toBe(false)
  })

  it('a past "planned" session only counts as done when the watch recorded it', () => {
    const p = session('2026-11-07T09:00:00+11:00', { status: 'planned' })
    expect(entryHappened(buildTrainingLog([p], [], NOW)[0]!)).toBe(false)
    expect(entryHappened(buildTrainingLog([p], [workout('2026-11-07T09:02:00+11:00', 55)], NOW)[0]!)).toBe(true)
  })

  it('weekly totals split coach vs solo minutes, Monday-start, local time, with empty weeks kept', () => {
    const log = buildTrainingLog(
      [session('2026-11-07T09:00:00+11:00'), session('2026-10-28T09:00:00+11:00', { duration_minutes: 50 })],
      [workout('2026-11-07T09:00:00+11:00', 58, 'strength', { energyKCal: 300 }), workout('2026-11-04T18:00:00+11:00', 30, 'running', { energyKCal: 280 }), workout('2026-11-09T07:00:00+11:00', 20, 'running')],
      NOW,
    )
    const weeks = periodTotals(log, 'week', 3, TZ, NOW)
    expect(weeks.map((w) => w.key)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09'])
    expect(weeks[0]).toMatchObject({ coachMinutes: 50, coachCount: 1, soloMinutes: 0 })
    expect(weeks[1]).toMatchObject({ coachMinutes: 58, coachCount: 1, soloMinutes: 30, soloCount: 1, kcal: 580 })
    expect(weeks[2]).toMatchObject({ coachMinutes: 0, soloMinutes: 20, soloCount: 1 }) // Monday 07:00 is this week
  })

  it('a Sunday-night workout belongs to that week even when it is already Monday in UTC… and vice versa', () => {
    // Sunday 23:30 Sydney = Sunday 12:30 UTC; Monday 00:30 Sydney = Sunday 13:30 UTC.
    const log = buildTrainingLog([], [workout('2026-11-08T23:30:00+11:00', 20), workout('2026-11-09T00:30:00+11:00', 20)], NOW)
    const weeks = periodTotals(log, 'week', 2, TZ, NOW)
    expect(weeks.map((w) => w.soloCount)).toEqual([1, 1])
  })

  it('period starts are local midnight across a DST change (Sydney DST began 4 Oct 2026)', () => {
    const wk = periodStart(Date.parse('2026-10-06T12:00:00+11:00'), 'week', TZ)
    expect(new Date(wk).toISOString()).toBe('2026-10-04T13:00:00.000Z') // Mon 5 Oct 00:00 +11 (after the change)
    const mo = periodStart(Date.parse('2026-10-20T12:00:00+11:00'), 'month', TZ)
    expect(new Date(mo).toISOString()).toBe('2026-09-30T14:00:00.000Z') // 1 Oct 00:00 +10 (before the change)
    const months = periodTotals([], 'month', 13, TZ, NOW)
    expect(months[0]!.key).toBe('2025-11-01')
    expect(months.at(-1)!.key).toBe('2026-11-01')
    expect(new Set(months.map((m) => m.key)).size).toBe(13)
  })
})
