/**
 * Synthetic demo data generator. Every value produced here is SIMULATED and is
 * stored with `origin = 'demo'` on `is_demo` profiles only. Deterministic per seed.
 */

import { addDays, fromLocal, localParts, startOfDay } from './metrics/calendar.ts'
import type { MetricType } from './metrics/health-schema.ts'

export interface DemoSample {
  sample_id: string
  metric_type: MetricType
  value: number
  unit: string
  start_at: string
  measured_at: string
  category: string | null
  metadata: Record<string, number>
  source_name: string
}

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const UNITS: Record<MetricType, string> = {
  hrv_sdnn: 'ms',
  resting_heart_rate: 'bpm',
  heart_rate: 'bpm',
  sleep_analysis: 'h',
  step_count: 'count',
  active_energy: 'kcal',
  basal_energy: 'kcal',
  exercise_time: 'min',
  workout: 'min',
  vo2_max: 'mL/kg/min',
}

/** 30 days of plausible simulated data ending "now". */
export function generateDemoSamples(nowMs: number, timeZone: string, seed = 42): DemoSample[] {
  const r = rng(seed)
  const out: DemoSample[] = []
  const iso = (ms: number) => new Date(ms).toISOString()
  const push = (id: string, metric: MetricType, value: number, start: number, end: number, category: string | null = null, metadata: Record<string, number> = {}) =>
    out.push({
      sample_id: `demo:${id}`,
      metric_type: metric,
      value: Math.round(value * 100) / 100,
      unit: UNITS[metric],
      start_at: iso(start),
      measured_at: iso(Math.min(end, nowMs)),
      category,
      metadata,
      source_name: 'FitCheck-In Demo Data (simulated)',
    })

  const today = startOfDay(nowMs, timeZone)
  for (let i = 29; i >= 0; i--) {
    const day = addDays(today, -i, timeZone)
    const p = localParts(day, timeZone)
    const at = (h: number, m = 0) => fromLocal(p.year, p.month, p.day, h, m, 0, 0, timeZone)
    const key = `${p.year}-${p.month}-${p.day}`
    // A mild "hard week" dip 8–10 days ago makes the trend charts meaningful.
    const fatigue = i >= 8 && i <= 10 ? 1 : 0

    // Sleep (stages) — previous night 23:00 → 06:45ish.
    const bed = at(-1 + 24, 0) - 86_400_000 + Math.round(r() * 40) * 60_000 // previous day ~23:00
    const deepH = 1.0 + r() * 0.6 - fatigue * 0.3
    const remH = 1.3 + r() * 0.6 - fatigue * 0.3
    const coreH = 3.6 + r() * 1.0 - fatigue * 0.5
    const awakeH = 0.2 + r() * 0.3
    let t = bed
    let segment = 0
    const stage = (name: string, hours: number) => {
      const end = t + hours * 3_600_000
      // Segment index keeps ids unique when a stage occurs more than once per night.
      if (end <= nowMs) push(`sleep:${key}:${segment}:${name}`, 'sleep_analysis', hours, t, end, name)
      segment += 1
      t = end
    }
    stage('asleepCore', coreH / 2)
    stage('asleepDeep', deepH)
    stage('asleepREM', remH / 2)
    stage('awake', awakeH)
    stage('asleepCore', coreH / 2)
    stage('asleepREM', remH / 2)

    if (at(7) <= nowMs) {
      push(`hrv:${key}`, 'hrv_sdnn', 52 + (r() - 0.5) * 14 - fatigue * 12, at(6, 55), at(7))
      push(`rhr:${key}`, 'resting_heart_rate', 56 + (r() - 0.5) * 4 + fatigue * 5, at(7), at(7))
    }
    const endOfDay = Math.min(at(23, 59), nowMs)
    const dayFraction = Math.max(0, Math.min(1, (endOfDay - at(0)) / 86_400_000))
    if (dayFraction > 0.05) {
      push(`steps:${key}`, 'step_count', (6500 + r() * 6000) * dayFraction, at(0), endOfDay)
      push(`active:${key}`, 'active_energy', (380 + r() * 380) * dayFraction, at(0), endOfDay)
      push(`basal:${key}`, 'basal_energy', 1650 * dayFraction, at(0), endOfDay)
      push(`exercise:${key}`, 'exercise_time', (18 + r() * 40) * dayFraction, at(0), endOfDay)
    }
    // Workouts on ~3-4 days per week.
    if ([1, 3, 5].includes(new Date(day).getUTCDay()) || r() < 0.12) {
      const start = at(18, 0)
      const duration = 45 + Math.round(r() * 30)
      const end = start + duration * 60_000
      if (end <= nowMs) {
        const kind = r() < 0.6 ? 'strength' : 'running'
        const avg = kind === 'strength' ? 118 + r() * 15 : 145 + r() * 15
        push(`workout:${key}`, 'workout', duration, start, end, kind, {
          averageHeartRate: Math.round(avg),
          maxHeartRate: Math.round(avg * 1.18),
          energyKCal: Math.round(duration * (kind === 'strength' ? 6.5 : 10)),
        })
      }
    }
    if (i % 7 === 0 && at(9) <= nowMs) push(`vo2:${key}`, 'vo2_max', 44 + r() * 2, at(9), at(9))
  }
  return out
}
