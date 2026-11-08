import { describe, expect, it } from 'vitest'
import { aggregateForEngine, sleepWindow, summarizeSleep, type StoredSample } from '@shared/metrics/aggregate.ts'
import { ALGORITHM_VERSION, assessReadiness } from '@shared/metrics/assessment.ts'
import { addDays, startOfDay, wholeDaysBetween } from '@shared/metrics/calendar.ts'
import { validateSample } from '@shared/metrics/health-schema.ts'
import type { EngineInput } from '@shared/metrics/types.ts'

const NOW = Date.UTC(2026, 10, 8, 3, 0, 0) // 14:00 AEDT
const TZ = 'Australia/Sydney'
const ctx = { nowMs: NOW, timeZone: TZ }
const H = 3_600_000

const empty: EngineInput = {
  raw: { sleep: {}, nutrients: {}, mobility: {} },
  baselines: { trainingLoad7Day: 0, trainingLoad28Day: 0 },
  workouts: [],
  dailyTrends: [],
  longTermTrends: [],
}

function withCore(overrides: Partial<EngineInput['raw']> = {}, baselines = true): EngineInput {
  return {
    ...empty,
    raw: {
      ...empty.raw,
      heartRateVariabilitySDNN: 52,
      restingHeartRate: 57,
      sleep: { totalHours: 7.3, inBedHours: 7.9, deepHours: 1.1, remHours: 1.5 },
      ...overrides,
    },
    baselines: baselines
      ? { trainingLoad7Day: 0, trainingLoad28Day: 0, averageHRV7Day: 58, averageRestingHeartRate7Day: 55, averageSleepHours7Day: 7.1 }
      : empty.baselines,
  }
}

describe('assessReadiness — no fake precision', () => {
  it('withholds every composite score when there is no data at all', () => {
    const a = assessReadiness(empty, ctx)
    // The original engine would report readiness ≈ 57 here (golden case "all-missing").
    expect(a.scores.readiness).toEqual({ value: null, status: 'insufficient' })
    expect(a.scores.recovery.value).toBeNull()
    expect(a.scores.stress.value).toBeNull()
    expect(a.scores.bodyBattery.value).toBeNull()
    expect(a.scores.hrvVsBaseline.value).toBeNull()
    expect(a.scores.fatigue.value).toBeNull()
    expect(a.completeness).toBe(0)
    expect(a.defaultedInputs).toEqual(expect.arrayContaining(['sleep', 'hrv', 'restingHeartRate', 'nutrition', 'mobility']))
  })

  it('withholds composites with only one of three core signals', () => {
    const a = assessReadiness({ ...empty, raw: { ...empty.raw, heartRateVariabilitySDNN: 48 } }, ctx)
    expect(a.scores.readiness.value).toBeNull()
    expect(a.scores.hrvVsBaseline).toEqual({ value: expect.any(Number), status: 'limited' })
  })

  it('reports "limited" with 2 of 3 core signals', () => {
    const a = assessReadiness(withCore({ restingHeartRate: undefined }), ctx)
    expect(a.scores.readiness.status).toBe('limited')
    expect(typeof a.scores.readiness.value).toBe('number')
    expect(a.defaultedInputs).toContain('restingHeartRate')
  })

  it('reports "limited" when baselines are missing', () => {
    const a = assessReadiness(withCore({}, false), ctx)
    expect(a.scores.readiness.status).toBe('limited')
    expect(a.baselineComparison.hrvDeltaPercent).toBeNull()
  })

  it('reports "ok" with all core signals and baselines, and computes deltas', () => {
    const a = assessReadiness(withCore(), ctx)
    expect(a.scores.readiness.status).toBe('ok')
    expect(a.completeness).toBe(1)
    expect(a.baselineComparison.hrvDeltaPercent).toBeCloseTo(((52 - 58) / 58) * 100, 1)
    expect(a.baselineComparison.restingHeartRateDeltaBpm).toBe(2)
    expect(a.algorithmVersion).toBe(ALGORITHM_VERSION)
  })

  it('treats stale samples as missing instead of "today"', () => {
    const stale = NOW - 3 * 24 * H
    const a = assessReadiness(withCore(), ctx, { hrvMs: stale, restingHeartRateMs: stale, sleepEndMs: NOW - 4 * H })
    expect(a.staleInputs).toEqual(['hrv', 'restingHeartRate'])
    expect(a.scores.readiness).toEqual({ value: null, status: 'insufficient' })
    expect(a.scores.sleep.status).not.toBe('insufficient')
  })

  it('fatigue/load fields are null without workouts', () => {
    const a = assessReadiness(withCore(), ctx)
    expect(a.scores.fatigue.value).toBeNull()
    expect(a.training.acuteChronicRatio).toBeNull()
    expect(a.training.loadStatus).toBeNull()
  })

  it('never returns a score outside 0–100', () => {
    const extremes = [
      withCore({ heartRateVariabilitySDNN: 1, restingHeartRate: 200, sleep: { totalHours: 0.5 } }),
      withCore({ heartRateVariabilitySDNN: 400, restingHeartRate: 20, sleep: { totalHours: 23 } }),
    ]
    for (const input of extremes) {
      for (const s of Object.values(assessReadiness(input, ctx).scores)) {
        if (s.value !== null) {
          expect(s.value).toBeGreaterThanOrEqual(0)
          expect(s.value).toBeLessThanOrEqual(100)
        }
      }
    }
  })
})

describe('calendar port (DST-aware)', () => {
  it('counts calendar days across the New York DST change', () => {
    const tz = 'America/New_York'
    const before = Date.UTC(2026, 9, 31, 16) // Oct 31 12:00 EDT
    const after = Date.UTC(2026, 10, 2, 17) // Nov 2 12:00 EST
    expect(wholeDaysBetween(before, after, tz)).toBe(2)
    expect(addDays(before, 2, tz)).toBe(after)
    expect(startOfDay(after, tz)).toBe(Date.UTC(2026, 10, 2, 5))
  })
})

describe('aggregateForEngine (HealthKitService semantics)', () => {
  const s = (p: Partial<StoredSample> & Pick<StoredSample, 'metricType' | 'value'>): StoredSample => ({
    sampleId: Math.random().toString(36),
    startAt: NOW - H,
    measuredAt: NOW - H,
    ...p,
  })

  it('uses the previous-noon → noon sleep window and counts only asleep stages', () => {
    const w = sleepWindow(NOW, TZ)
    expect(new Date(w.end).toISOString()).toBe('2026-11-08T01:00:00.000Z') // 12:00 AEDT
    const samples = [
      s({ metricType: 'sleep_analysis', value: 0, category: 'inBed', startAt: NOW - 12 * H, measuredAt: NOW - 4 * H }),
      s({ metricType: 'sleep_analysis', value: 0, category: 'asleepCore', startAt: NOW - 11 * H, measuredAt: NOW - 8 * H }),
      s({ metricType: 'sleep_analysis', value: 0, category: 'asleepDeep', startAt: NOW - 8 * H, measuredAt: NOW - 7 * H }),
      s({ metricType: 'sleep_analysis', value: 0, category: 'awake', startAt: NOW - 7 * H, measuredAt: NOW - 6.5 * H }),
      s({ metricType: 'sleep_analysis', value: 0, category: 'asleepREM', startAt: NOW - 6.5 * H, measuredAt: NOW - 5 * H }),
    ]
    const { summary } = summarizeSleep(samples, w)
    expect(summary.totalHours).toBeCloseTo(5.5)
    expect(summary.inBedHours).toBeCloseTo(8)
    expect(summary.deepHours).toBeCloseTo(1)
    expect(summary.awakeHours).toBeCloseTo(0.5)
  })

  it('takes the most recent HRV/RHR and 7-day averages as baselines', () => {
    const samples = [
      s({ metricType: 'hrv_sdnn', value: 40, measuredAt: NOW - 3 * 24 * H }),
      s({ metricType: 'hrv_sdnn', value: 60, measuredAt: NOW - 2 * H }),
      s({ metricType: 'hrv_sdnn', value: 99, measuredAt: NOW - 10 * 24 * H }), // outside 7 days
      s({ metricType: 'resting_heart_rate', value: 55, measuredAt: NOW - 2 * H }),
    ]
    const r = aggregateForEngine(samples, ctx)
    expect(r.input.raw.heartRateVariabilitySDNN).toBe(60)
    expect(r.input.baselines.averageHRV7Day).toBe(50)
    expect(r.latest.hrv?.measuredAt).toBe(NOW - 2 * H)
    expect(r.input.raw.vo2Max).toBeUndefined()
  })

  it('leaves untracked metrics undefined (never zero-filled)', () => {
    const r = aggregateForEngine([], ctx)
    expect(r.input.raw.stepsToday).toBeUndefined()
    expect(r.input.raw.sleep.totalHours).toBeUndefined()
    expect(r.input.longTermTrends).toHaveLength(28)
    expect(r.input.longTermTrends.every((d) => d.sleepHours === undefined && d.steps === undefined)).toBe(true)
  })

  it('computes workout load with the original estimateWorkoutLoad', () => {
    const r = aggregateForEngine(
      [s({ metricType: 'workout', value: 60, category: 'strength', metadata: { averageHeartRate: 130, maxHeartRate: 170, energyKCal: 400 } })],
      ctx,
    )
    const w = r.input.workouts[0]!
    // 60 * (130/170)^2 * 1.2 * clamp(400/360, .65, 1.5)
    expect(w.estimatedLoad).toBeCloseTo(60 * (130 / 170) ** 2 * 1.2 * (400 / 360), 9)
    expect(w.effortScore).toBe(Math.min(100, w.estimatedLoad * 1.6))
  })
})

describe('validateSample', () => {
  const enabled = new Set(['hrv', 'sleep'] as const)
  const base = { sampleId: 'a', metricType: 'hrv_sdnn', value: 50, unit: 'ms', startAt: new Date(NOW - H).toISOString(), measuredAt: new Date(NOW - H).toISOString() }

  it('accepts a valid sample and normalises timestamps', () => {
    const r = validateSample(base, 0, new Set(enabled), NOW)
    expect(r.ok).toBe(true)
  })
  it.each([
    [{ value: Number.NaN }, 'invalid_value'],
    [{ value: 0 }, 'value_out_of_range'],
    [{ unit: 's' }, 'unit_mismatch'],
    [{ metricType: 'blood_glucose' }, 'unknown_metric'],
    [{ metricType: 'step_count', unit: 'count' }, 'category_not_enabled'],
    [{ measuredAt: new Date(NOW - 2 * H).toISOString() }, 'end_before_start'],
    [{ metricType: 'sleep_analysis', unit: 'h', value: 1, category: 'napping' }, 'invalid_sleep_stage'],
    [{ category: 'asleepCore' }, 'unexpected_category'],
    [{ sampleId: '' }, 'invalid_sample_id'],
  ])('rejects %o with %s', (patch, reason) => {
    const r = validateSample({ ...base, ...patch }, 3, new Set(enabled), NOW)
    expect(r).toEqual({ ok: false, issue: { index: 3, reason } })
  })
})
