import { describe, expect, it } from 'vitest'
import { recoveryToEnergy, sleepScoreToQuality, watchPrefill } from '@/features/checkins/watchPrefill'
import type { Snapshot } from '@/lib/api'

describe('watch → check-in mapping (rounded half-up to the nearest whole step)', () => {
  it('sleep score 0–100 → sleep quality 1–5', () => {
    expect(sleepScoreToQuality(0)).toEqual({ exact: 1, value: 1 })
    expect(sleepScoreToQuality(50)).toEqual({ exact: 3, value: 3 })
    expect(sleepScoreToQuality(100)).toEqual({ exact: 5, value: 5 })
    expect(sleepScoreToQuality(72)).toEqual({ exact: 3.88, value: 4 })
    expect(sleepScoreToQuality(62)).toEqual({ exact: 3.48, value: 3 })
    // exactly halfway rounds up: 62.5 → 3.5 → 4
    expect(sleepScoreToQuality(62.5).value).toBe(4)
    expect(sleepScoreToQuality(37.5).value).toBe(3) // 2.5 → 3
  })

  it('recovery (65 = your normal, 12 pts per SD) → energy 1–5', () => {
    expect(recoveryToEnergy(65)).toEqual({ exact: 3, value: 3 })
    expect(recoveryToEnergy(77)).toEqual({ exact: 4, value: 4 })
    expect(recoveryToEnergy(71)).toEqual({ exact: 3.5, value: 4 }) // halfway rounds up
    expect(recoveryToEnergy(70)).toEqual({ exact: 3.42, value: 3 })
    expect(recoveryToEnergy(53)).toEqual({ exact: 2, value: 2 })
    expect(recoveryToEnergy(0).value).toBe(1) // clamped
    expect(recoveryToEnergy(100).value).toBe(5)
  })

  it('every value is an integer within the scale', () => {
    for (let x = 0; x <= 100; x += 0.5) {
      for (const r of [sleepScoreToQuality(x), recoveryToEnergy(x)]) {
        expect(Number.isInteger(r.value)).toBe(true)
        expect(r.value).toBeGreaterThanOrEqual(1)
        expect(r.value).toBeLessThanOrEqual(5)
      }
    }
  })
})

describe('watchPrefill: only offered when there is real, current data', () => {
  const now = Date.parse('2026-11-08T09:00:00Z')
  const snap = (over: Partial<Snapshot> = {}, scores: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    ({
      snapshot_date: '2026-11-08',
      time_zone: 'UTC',
      computed_at: '2026-11-08T07:00:00Z',
      origin: 'healthkit',
      assessment: {
        staleInputs: [],
        scores: { sleep: { value: 72, status: 'ok' }, recovery: { value: 77, status: 'ok' }, ...scores },
        ...extra,
      },
      ...over,
    }) as unknown as Snapshot

  it('suggests both answers from today’s scores', () => {
    const p = watchPrefill(snap(), now)!
    expect(p.suggestions).toEqual([
      { field: 'sleep', score: 72, exact: 3.88, value: 4 },
      { field: 'energy', score: 77, exact: 4, value: 4 },
    ])
    expect(p.simulated).toBe(false)
  })

  it('nothing to offer without a snapshot, for an old day, or when scores were withheld', () => {
    expect(watchPrefill(null, now)).toBeNull()
    expect(watchPrefill(snap({ snapshot_date: '2026-11-07' }), now)).toBeNull()
    expect(watchPrefill(snap({}, { sleep: { value: null, status: 'insufficient' }, recovery: { value: null, status: 'insufficient' } }), now)).toBeNull()
  })

  it('uses the client’s own time zone for “today”', () => {
    // 11:00 UTC is already 01:00 on 2026-11-09 in Kiritimati (UTC+14).
    const later = Date.parse('2026-11-08T11:00:00Z')
    expect(watchPrefill(snap(), later)).not.toBeNull()
    expect(watchPrefill(snap({ time_zone: 'Pacific/Kiritimati' }), later)).toBeNull()
    expect(watchPrefill(snap({ time_zone: 'Pacific/Kiritimati', snapshot_date: '2026-11-09' }), later)).not.toBeNull()
  })

  it('offers only what exists, skips stale sleep, and flags demo data', () => {
    expect(watchPrefill(snap({}, { recovery: { value: null, status: 'insufficient' } }), now)!.suggestions.map((s) => s.field)).toEqual(['sleep'])
    expect(watchPrefill(snap({}, {}, { staleInputs: ['sleep'] }), now)!.suggestions.map((s) => s.field)).toEqual(['energy'])
    expect(watchPrefill(snap({ origin: 'demo' }), now)!.simulated).toBe(true)
  })
})
