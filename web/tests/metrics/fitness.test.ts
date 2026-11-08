import { describe, expect, it } from 'vitest'
import { buildDerivedMetrics } from '@shared/metrics/engine.ts'
import { cardioFitness, heartRateRecovery, mobility, monotonyAndStrain, runningForm, trendPer30d, vitalsCheck, vo2Level, weeklyActivity, bodyTrends, type Dated } from '@shared/metrics/fitness.ts'

const NOW = Date.UTC(2026, 10, 8, 3)
const D = 86_400_000
const series = (vals: number[], stepDays = 1): Dated[] => vals.map((v, i) => ({ t: NOW - (vals.length - 1 - i) * stepDays * D, v }))
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10)

describe('cardio fitness (VO₂max vs ACSM norms)', () => {
  it('classifies against age/sex percentile tables', () => {
    expect(vo2Level(50, 25, 'male').level).toBe('aboveAverage')
    expect(vo2Level(56, 25, 'male').level).toBe('high')
    expect(vo2Level(30, 45, 'female').level).toBe('average')
    expect(vo2Level(18, 65, 'female').level).toBe('low')
    // same VO₂ is "better" for an older person
    expect(vo2Level(40, 55, 'male').percentile).toBeGreaterThan(vo2Level(40, 25, 'male').percentile)
  })
  it('without age/sex it shows the value and trend but no population score', () => {
    const r = cardioFitness(series([44, 44.5, 45, 45.5, 46, 46.4], 7), {})
    expect(r).toMatchObject({ status: 'limited', vo2Max: 46.4, score: null, level: null })
    expect(r.trendPer30d!).toBeGreaterThan(1.5)
  })
  it('no VO₂ data → insufficient, no number', () => {
    expect(cardioFitness([], { age: 30, sex: 'male' })).toMatchObject({ status: 'insufficient', score: null })
  })
})

describe('vitals check (deviation from own baseline)', () => {
  const base = (m: number, a: number) => series(Array.from({ length: 14 }, (_, i) => m + a * Math.sin(i)))
  it('all in usual range → 100', () => {
    const r = vitalsCheck({ spo2: base(97, 0.5), respiratoryRate: base(14, 0.4), wristTemperature: base(0, 0.1) }, NOW)
    expect(r).toMatchObject({ status: 'ok', outOfRangeCount: 0, score: 100 })
  })
  it('flags respiratory rate and temperature deviations', () => {
    const rr = base(14, 0.4); rr[rr.length - 1] = { t: NOW - 3_600_000, v: 19 }
    const tw = base(0, 0.1); tw[tw.length - 1] = { t: NOW - 3_600_000, v: 1.2 }
    const r = vitalsCheck({ spo2: base(97, 0.5), respiratoryRate: rr, wristTemperature: tw }, NOW)
    expect(r.outOfRangeCount).toBe(2)
    expect(r.score).toBe(40)
  })
  it('SpO₂ below 95 % is always flagged, even without a baseline', () => {
    const r = vitalsCheck({ spo2: [{ t: NOW - 3_600_000, v: 92 }], respiratoryRate: [], wristTemperature: [] }, NOW)
    expect(r.signals[0]!.outOfRange).toBe(true)
    expect(r.score).toBeNull()
  })
  it('readings older than 2 days are not treated as current', () => {
    const r = vitalsCheck({ spo2: [{ t: NOW - 5 * D, v: 97 }], respiratoryRate: [], wristTemperature: [] }, NOW)
    expect(r.signals[0]!.latest).toBeNull()
    expect(r.status).toBe('insufficient')
  })
})

describe('heart-rate recovery', () => {
  it('maps the 28-day average to levels (≤ 12 bpm = low, Cole 1999)', () => {
    expect(heartRateRecovery(series([10, 11, 12]), NOW)).toMatchObject({ level: 'low' })
    expect(heartRateRecovery(series([28, 32, 35]), NOW)).toMatchObject({ level: 'excellent', status: 'ok' })
    expect(heartRateRecovery(series([25, 25, 25]), NOW).score).toBe(70)
  })
  it('no data → null', () => expect(heartRateRecovery([], NOW).score).toBeNull())
})

describe('weekly activity (WHO 150–300 min)', () => {
  const daily = (v: number) => series(Array(7).fill(v))
  it('vigorous minutes count double; 150 WHO-minutes = 100 %', () => {
    const r = weeklyActivity({ dailyExerciseMin: daily(15), dailySteps: daily(8000), dailyFlights: daily(10), distanceWalkRun: daily(5), distanceCycling: [], distanceSwimming: [], vigorousMinutes7d: 45, nowMs: NOW })
    expect(r.exerciseMinutes7d).toBe(105)
    expect(r.whoPercent).toBe(100) // 105 + 45
    expect(r.stepsPerDay7d).toBe(8000)
    expect(r.distanceKm7d.walkingRunning).toBe(35)
    expect(r.distanceKm7d.cycling).toBeNull()
  })
  it('score rewards reaching 300 min and 10k steps', () => {
    const lo = weeklyActivity({ dailyExerciseMin: daily(5), dailySteps: daily(3000), dailyFlights: [], distanceWalkRun: [], distanceCycling: [], distanceSwimming: [], vigorousMinutes7d: 0, nowMs: NOW })
    const hi = weeklyActivity({ dailyExerciseMin: daily(45), dailySteps: daily(11000), dailyFlights: [], distanceWalkRun: [], distanceCycling: [], distanceSwimming: [], vigorousMinutes7d: 0, nowMs: NOW })
    expect(lo.score!).toBeLessThan(25)
    expect(hi.score).toBe(100)
  })
})

describe('training monotony & strain (Foster 1998)', () => {
  it('varied week → low monotony; identical daily load → high monotony', () => {
    const varied = [600, 0, 300, 0, 500, 100, 0].map((v, i) => ({ t: NOW - i * D, v })).filter((x) => x.v > 0)
    const same = Array.from({ length: 7 }, (_, i) => ({ t: NOW - i * D, v: 300 }))
    expect(monotonyAndStrain(varied, NOW, dayKey).level).toBe('low')
    const m = monotonyAndStrain(same, NOW, dayKey)
    expect(m.level).toBe('high')
    expect(m.strain).toBeGreaterThan(m.weeklyLoad!)
  })
  it('fewer than 2 training days → no monotony value', () => {
    expect(monotonyAndStrain([{ t: NOW, v: 400 }], NOW, dayKey)).toMatchObject({ monotony: null, status: 'limited' })
  })
})

describe('running form', () => {
  it('economy (speed per 100 W) compared with own recent runs', () => {
    const runs = [
      { t: NOW - 1 * D, powerW: 250, speedMS: 3.3, groundContactMS: 245, verticalOscillationCM: 8, strideLengthM: 1.1 },
      { t: NOW - 4 * D, powerW: 260, speedMS: 3.2, groundContactMS: 250 },
      { t: NOW - 8 * D, powerW: 258, speedMS: 3.15, groundContactMS: 252 },
    ]
    const r = runningForm(runs, NOW)
    expect(r.status).toBe('ok')
    expect(r.economyChangePercent!).toBeGreaterThan(0)
    expect(r.verticalRatio).toBeCloseTo(7.3, 1)
  })
})

describe('mobility reuses the health+ formula exactly', () => {
  it('matches DerivedMetricsEngine.scoreMobility', () => {
    const m = { walkingSpeed: 1.18, steadiness: 82, asymmetry: 3.5, doubleSupport: 27, sixMinuteWalk: 520 }
    const ours = mobility(m).score
    const ctx = { nowMs: NOW, timeZone: 'UTC' }
    const engine = buildDerivedMetrics({
      raw: { sleep: {}, nutrients: {}, mobility: { walkingSpeedMS: m.walkingSpeed, walkingSteadinessPercent: m.steadiness, walkingAsymmetryPercent: m.asymmetry, walkingDoubleSupportPercent: m.doubleSupport, sixMinuteWalkDistanceM: m.sixMinuteWalk } },
      baselines: { trainingLoad7Day: 0, trainingLoad28Day: 0 }, workouts: [], dailyTrends: [], longTermTrends: [],
    }, ctx).derived.mobilityScore
    expect(ours).toBe(Math.round(engine))
  })
  it('steadiness classification follows Apple (OK ≥ 40, Low 20–40, Very low < 20)', () => {
    expect(mobility({ steadiness: 45 }).steadinessLevel).toBe('ok')
    expect(mobility({ steadiness: 30 }).steadinessLevel).toBe('low')
    expect(mobility({ steadiness: 10 }).steadinessLevel).toBe('veryLow')
  })
})

describe('body trends and helpers', () => {
  it('28-day change, no score', () => {
    const r = bodyTrends({ weight: [{ t: NOW - 28 * D, v: 72 }, { t: NOW, v: 70.5 }], bodyFat: [], leanMass: [] }, NOW)
    expect(r.weight).toEqual({ latest: 70.5, change28d: -1.5 })
    expect('score' in r).toBe(false)
  })
  it('trend needs ≥ 4 points over ≥ 21 days', () => {
    expect(trendPer30d(series([1, 2, 3]))).toBeNull()
    expect(trendPer30d(series([1, 2, 3, 4], 1))).toBeNull()
    expect(trendPer30d(series([40, 41, 42, 43], 10))).toBeCloseTo(3, 5)
  })
  it('reports a real trend but not noise', () => {
    // steady improvement with small noise → trend
    expect(trendPer30d(series([43.0, 43.5, 43.3, 44.1, 44.4, 44.9, 45.2, 45.0, 45.8], 7))!).toBeGreaterThan(1)
    // random scatter (like heart-rate recovery after different workouts) → no trend
    expect(trendPer30d(series([28, 24, 31, 25, 30, 26, 29, 24], 3))).toBeNull()
  })
})
