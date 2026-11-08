import { describe, expect, it } from 'vitest'
import { computeReadinessV2, MIN_HISTORY_DAYS, type V2Input } from '@shared/metrics/readiness-v2.ts'

const hist = (vals: number[]) => vals.map((value, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, value }))
const wiggle = (m: number, a: number, n = 14) => Array.from({ length: n }, (_, i) => m + a * Math.sin(i * 1.7))
function person(hrv: number, rhr: number, sleep = 7.4): V2Input['history'] {
  return { hrv: hist(wiggle(hrv, hrv * 0.08)), rhr: hist(wiggle(rhr, 2)), sleepHours: hist(wiggle(sleep, 0.4)) }
}
const normalDay = (hrv: number, rhr: number) => computeReadinessV2({ today: { hrv, rhr, sleepHours: 7.4 }, history: person(hrv, rhr) })

describe('readiness v2 — fixes to the health+ composite', () => {
  it('a normal day reads as normal: readiness/recovery ≈ 65, stress ≈ 35 (was 56 with the +34 constant)', () => {
    const r = normalDay(50, 56)
    expect(r.recovery.value).toBeGreaterThanOrEqual(62)
    expect(r.recovery.value).toBeLessThanOrEqual(68)
    expect(r.stress.value).toBeGreaterThanOrEqual(30)
    expect(r.stress.value).toBeLessThanOrEqual(40)
  })

  it('people are compared only with themselves (low- and high-HRV people at their own normal score the same)', () => {
    const low = normalDay(25, 64)
    const high = normalDay(85, 46)
    expect(low.readiness.value).toBe(high.readiness.value)
    expect(low.stress.value).toBe(high.stress.value)
  })

  it('a clearly worse day lowers recovery and raises stress, with each signal listed as a driver', () => {
    const r = computeReadinessV2({ today: { hrv: 35, rhr: 62, sleepHours: 5.5 }, history: person(50, 56) })
    expect(r.recovery.value!).toBeLessThan(40)
    expect(r.stress.value!).toBeGreaterThan(65)
    expect(r.drivers.map((d) => d.key).sort()).toEqual(['hrv', 'rhr', 'sleep'])
    expect(r.drivers.every((d) => d.impact < 0)).toBe(true)
  })

  it('a better day raises recovery; stress never reaches 0', () => {
    const r = computeReadinessV2({ today: { hrv: 70, rhr: 50, sleepHours: 9 }, history: person(50, 56) })
    expect(r.recovery.value!).toBeGreaterThan(80)
    expect(r.stress.value).toBe(10)
  })

  it('extra sleep helps only a little; short sleep hurts more', () => {
    const more = computeReadinessV2({ today: { hrv: 50, rhr: 56, sleepHours: 9.4 }, history: person(50, 56) })
    const less = computeReadinessV2({ today: { hrv: 50, rhr: 56, sleepHours: 5.4 }, history: person(50, 56) })
    const sleepImpact = (r: typeof more) => r.drivers.find((d) => d.key === 'sleep')!.impact
    expect(sleepImpact(more)).toBeGreaterThan(0)
    expect(Math.abs(sleepImpact(less))).toBeGreaterThan(Math.abs(sleepImpact(more)) * 2)
  })

  it('uses only measured signals and never invents values', () => {
    const two = computeReadinessV2({ today: { hrv: 50, sleepHours: 7.4 }, history: person(50, 56) })
    expect(two.recovery.status).toBe('limited')
    expect(two.signals.find((s) => s.key === 'rhr')!.z).toBeNull()
    const one = computeReadinessV2({ today: { hrv: 50 }, history: person(50, 56) })
    expect(one.recovery).toEqual({ value: null, status: 'insufficient' })
    expect(one.readiness).toEqual({ value: null, status: 'insufficient' })
  })

  it(`requires at least ${MIN_HISTORY_DAYS} days of personal history`, () => {
    const short = { hrv: hist([50, 52, 49]), rhr: hist([56, 57, 55]), sleepHours: hist([7, 7.5, 7.2]) }
    expect(computeReadinessV2({ today: { hrv: 50, rhr: 56, sleepHours: 7.3 }, history: short }).readiness.value).toBeNull()
  })

  it('a very stable baseline does not turn a tiny change into an extreme score (SD floors)', () => {
    const flat = { hrv: hist(Array(14).fill(50)), rhr: hist(Array(14).fill(56)), sleepHours: hist(Array(14).fill(7.5)) }
    const r = computeReadinessV2({ today: { hrv: 49, rhr: 57, sleepHours: 7.3 }, history: flat })
    expect(r.recovery.value!).toBeGreaterThan(55)
  })

  it('one outlier day in the history does not distort the baseline', () => {
    const vals = wiggle(50, 4)
    vals[3] = 150 // artefact
    const r = computeReadinessV2({ today: { hrv: 50, rhr: 56, sleepHours: 7.4 }, history: { ...person(50, 56), hrv: hist(vals) } })
    expect(Math.abs(r.signals.find((s) => s.key === 'hrv')!.z!)).toBeLessThan(0.5)
  })

  it('a training-load spike lowers readiness but not recovery; normal progression is not penalised', () => {
    const base = { today: { hrv: 50, rhr: 56, sleepHours: 7.4 }, history: person(50, 56) }
    const spike = computeReadinessV2({ ...base, load: { acute7: 360, chronicWeekly: 200 } })
    const steady = computeReadinessV2({ ...base, load: { acute7: 240, chronicWeekly: 200 } })
    expect(spike.recovery.value).toBe(steady.recovery.value)
    expect(spike.readiness.value!).toBeLessThan(steady.readiness.value! - 10)
    expect(steady.drivers.some((d) => d.key === 'load')).toBe(false)
  })

  it('the client’s own check-in adjusts readiness and is listed as drivers', () => {
    const base = { today: { hrv: 50, rhr: 56, sleepHours: 7.4 }, history: person(50, 56) }
    const r = computeReadinessV2({ ...base, checkin: { energy: 2, sleepQuality: 3, soreness: 7, pain: 5 } })
    expect(r.readiness.value!).toBeLessThan(r.recovery.value! - 10)
    expect(r.drivers.map((d) => d.key)).toEqual(expect.arrayContaining(['checkinPain', 'checkinSoreness', 'checkinEnergy']))
    expect(r.usedCheckin).toBe(true)
  })

  it('answers pre-filled from the watch (null) do not re-count HRV/sleep; soreness and pain still count', () => {
    const base = { today: { hrv: 50, rhr: 56, sleepHours: 7.4 }, history: person(50, 56) }
    const self = computeReadinessV2({ ...base, checkin: { energy: 5, sleepQuality: 5, soreness: 0, pain: 0 } })
    const watch = computeReadinessV2({ ...base, checkin: { energy: null, sleepQuality: null, soreness: 0, pain: 0 } })
    expect(watch.readiness.value).toBe(watch.recovery.value)
    expect(self.readiness.value!).toBeGreaterThan(watch.readiness.value!)
    expect(watch.drivers.map((d) => d.key)).not.toEqual(expect.arrayContaining(['checkinEnergy']))
    const hurt = computeReadinessV2({ ...base, checkin: { energy: null, sleepQuality: null, soreness: 8, pain: 6 } })
    expect(hurt.readiness.value!).toBeLessThan(hurt.recovery.value!)
  })

  it('with no wearable data, a check-in alone gives a clearly limited readiness', () => {
    const r = computeReadinessV2({ today: {}, history: { hrv: [], rhr: [], sleepHours: [] }, checkin: { energy: 4, sleepQuality: 4, soreness: 2, pain: 0 } })
    expect(r.readiness.status).toBe('limited')
    expect(r.recovery.value).toBeNull()
  })

  it('all scores stay within 0–100 for extreme inputs', () => {
    for (const today of [{ hrv: 1, rhr: 200, sleepHours: 0.5 }, { hrv: 400, rhr: 20, sleepHours: 23 }]) {
      const r = computeReadinessV2({ today, history: person(50, 56), load: { acute7: 9999, chronicWeekly: 1 }, checkin: { energy: 1, sleepQuality: 1, soreness: 10, pain: 10 } })
      for (const s of [r.readiness, r.recovery, r.stress]) {
        expect(s.value!).toBeGreaterThanOrEqual(0)
        expect(s.value!).toBeLessThanOrEqual(100)
      }
    }
  })
})
