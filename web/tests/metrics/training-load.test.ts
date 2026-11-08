import { describe, expect, it } from 'vitest'
import { computeTrainingLoad, modalityForSessionType, personalMaxHeartRate, rpeFromHeartRate, type PlatformSession, type WatchWorkout } from '@shared/metrics/training-load.ts'
import { estimateWorkoutLoad } from '@shared/metrics/engine.ts'

const NOW = Date.UTC(2026, 10, 8, 3)
const H = 3_600_000
const D = 24 * H
const session = (o: Partial<PlatformSession> = {}): PlatformSession => ({ id: Math.random().toString(36), startMs: NOW - 3 * H, durationMinutes: 60, sessionType: 'strength', status: 'completed', plannedIntensity: null, actualIntensity: null, clientRpe: null, ...o })
const watch = (o: Partial<WatchWorkout> = {}): WatchWorkout => ({ id: Math.random().toString(36), startMs: NOW - 3 * H, endMs: NOW - 2 * H, kind: 'strength', ...o })
const one = (platform: PlatformSession[], w: WatchWorkout[] = []) => computeTrainingLoad({ nowMs: NOW, platform, watch: w, restingHeartRate: 56 })

describe('session-RPE training load', () => {
  it('fixes the original under-count: hard lifting is no longer equal to an easy walk', () => {
    // Original heart-rate formula (health+): lifting 42.7 vs walk 41.7.
    expect(Math.abs(estimateWorkoutLoad({ durationMinutes: 60, averageHeartRate: 125, maxHeartRate: 160, calories: 350 }) - estimateWorkoutLoad({ durationMinutes: 60, averageHeartRate: 105, maxHeartRate: 115, calories: 250 }))).toBeLessThan(2)
    const lift = one([], [watch({ kind: 'strength', averageHeartRate: 125, maxHeartRate: 160, appleEffort: 8 })]).sessions[0]!
    const walk = one([], [watch({ kind: 'walking', averageHeartRate: 105, maxHeartRate: 115 })]).sessions[0]!
    expect(lift.load).toBeGreaterThan(walk.load * 1.5)
  })

  it('heart rate is never used to rate strength work', () => {
    const s = one([], [watch({ kind: 'strength', averageHeartRate: 110, maxHeartRate: 140 })]).sessions[0]!
    expect(s.rpeSource).toBe('typical')
    expect(s.rpe).toBe(6)
  })

  it('counts coach-logged sessions without any wearable data', () => {
    const r = one([session({ clientRpe: 8 })])
    expect(r.sessions).toHaveLength(1)
    expect(r.sessions[0]).toMatchObject({ rpe: 8, rpeSource: 'client_rpe', load: 480, sources: ['fitcheckin'] })
  })

  it('RPE source priority: client > trainer actual > Apple Effort > heart rate (cardio) > planned > typical', () => {
    const w = watch({ kind: 'running', averageHeartRate: 150, maxHeartRate: 175, appleEffort: 5 })
    expect(one([session({ clientRpe: 9, actualIntensity: 7, plannedIntensity: 6, sessionType: 'endurance' })], [w]).sessions[0]!.rpeSource).toBe('client_rpe')
    expect(one([session({ actualIntensity: 7, plannedIntensity: 6, sessionType: 'endurance' })], [w]).sessions[0]!.rpeSource).toBe('trainer_rpe')
    expect(one([session({ plannedIntensity: 6, sessionType: 'endurance' })], [w]).sessions[0]!.rpeSource).toBe('apple_effort')
    expect(one([session({ plannedIntensity: 6, sessionType: 'endurance' })], [watch({ kind: 'running', averageHeartRate: 150 })]).sessions[0]!.rpeSource).toBe('heart_rate')
    expect(one([session({ plannedIntensity: 6 })]).sessions[0]!.rpeSource).toBe('trainer_planned')
    expect(one([session()]).sessions[0]!.rpeSource).toBe('typical')
  })

  it('a coach session and an overlapping watch workout are counted once', () => {
    const r = one([session({ clientRpe: 8 })], [watch({ startMs: NOW - 3 * H + 5 * 60_000 })])
    expect(r.sessions).toHaveLength(1)
    expect(r.sessions[0]!.sources).toEqual(['fitcheckin', 'apple_health'])
  })

  it('non-overlapping watch workouts (trained alone) are still counted', () => {
    const r = one([session({ clientRpe: 8 })], [watch({ startMs: NOW - 30 * H, endMs: NOW - 29 * H, kind: 'running', averageHeartRate: 150 })])
    expect(r.sessions).toHaveLength(2)
  })

  it('ignores cancelled and future sessions; planned sessions only count once they have a rating', () => {
    expect(one([session({ status: 'cancelled', clientRpe: 8 })]).sessions).toHaveLength(0)
    expect(one([session({ startMs: NOW + 2 * H, status: 'planned' })]).sessions).toHaveLength(0)
    expect(one([session({ status: 'planned' })]).sessions).toHaveLength(0)
    expect(one([session({ status: 'planned', clientRpe: 7 })]).sessions).toHaveLength(1)
  })

  it('heart-rate RPE uses the person’s HRmax, not the session peak (easy walk ≠ maximal)', () => {
    expect(personalMaxHeartRate([watch({ maxHeartRate: 115 })])).toBeCloseTo(183.5)
    expect(rpeFromHeartRate(105, 183.5, 56)).toBe(4)
    expect(rpeFromHeartRate(165, 183.5, 56)).toBe(9)
  })

  it('acute:chronic ratio needs ≥ 2 earlier sessions and reflects a spike', () => {
    expect(one([session({ clientRpe: 7 })]).acuteChronicRatio).toBeNull()
    const steady = [1, 2, 3].flatMap((w) => [0, 2, 4].map((d) => session({ startMs: NOW - (w * 7 + d + 1) * D, clientRpe: 6 })))
    const thisWeekSame = [0, 2, 4].map((d) => session({ startMs: NOW - (d + 0.2) * D, clientRpe: 6 }))
    const thisWeekHeavy = [0, 1, 2, 3, 4].map((d) => session({ startMs: NOW - (d + 0.2) * D, clientRpe: 9, durationMinutes: 75 }))
    expect(one([...steady, ...thisWeekSame]).acuteChronicRatio!).toBeCloseTo(1, 1)
    expect(one([...steady, ...thisWeekHeavy]).acuteChronicRatio!).toBeGreaterThan(2)
  })

  it('reports how much of the load is from real ratings', () => {
    expect(one([session({ clientRpe: 8 }), session({ startMs: NOW - 2 * D })]).ratedShare).toBeCloseTo(480 / 840, 2)
  })

  it('maps FitCheck-In session types to modalities', () => {
    expect(modalityForSessionType('hypertrophy')).toBe('resistance')
    expect(modalityForSessionType('endurance')).toBe('cardio')
    expect(modalityForSessionType('recovery')).toBe('mobility')
    expect(modalityForSessionType('conditioning')).toBe('mixed')
  })
})
