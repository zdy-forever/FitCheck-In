/**
 * Synthetic demo data generator. Every value produced here is SIMULATED and is
 * stored with `origin = 'demo'` on `is_demo` profiles only. Deterministic per seed.
 */

import { addDays, fromLocal, localDateKey, localParts, startOfDay } from './metrics/calendar.ts'
import { METRICS, type MetricType } from './metrics/health-schema.ts'

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

/**
 * Days (offsets from today, negative = past) with a coach-led session in the demo:
 * three sessions a week for four weeks. demo-session schedules them at the current time of
 * day; the simulated watch records a workout at the same time (it pairs with the session and
 * is counted once). On other days the client does some solo cardio.
 */
export const DEMO_COACH_DAY_OFFSETS = [-26, -24, -22, -19, -17, -15, -12, -10, -8, -6, -3, -1] as const

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const UNITS = Object.fromEntries(Object.entries(METRICS).map(([k, d]) => [k, d.unit])) as Record<MetricType, string>

/** 30 days of plausible simulated data ending "now". */
export function generateDemoSamples(nowMs: number, timeZone: string, seed = 42): DemoSample[] {
  const r = rng(seed)
  const out: DemoSample[] = []
  const iso = (ms: number) => new Date(ms).toISOString()
  const push = (id: string, metric: MetricType, value: number, start: number, end: number, category: string | null = null, metadata: Record<string, number> = {}) => {
    // Nothing can have been measured in the future (and measured_at >= start_at is enforced).
    if (start > nowMs) return
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
  }

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
      push(`exercise:${key}`, 'exercise_time', (12 + r() * 22) * dayFraction, at(0), endOfDay)
    }
    // Solo cardio on ~2 non-coach days per week (coach sessions are created by demo-session).
    const coachDay = (DEMO_COACH_DAY_OFFSETS as readonly number[]).includes(-i)
    if (!coachDay && (i % 7 === 2 || i % 7 === 5) && r() < 0.85) {
      const start = at(18, 0)
      const duration = 35 + Math.round(r() * 20)
      const end = start + duration * 60_000
      if (end <= nowMs) {
        const avg = 140 + r() * 15
        const speed = 3.1 + r() * 0.3 + (29 - i) * 0.004 // slowly getting faster (simulated)
        push(`workout:${key}`, 'workout', duration, start, end, 'running', {
          averageHeartRate: Math.round(avg),
          maxHeartRate: Math.round(avg * 1.15),
          energyKCal: Math.round(duration * 10),
          distanceKM: Math.round(speed * duration * 0.06 * 10) / 10,
          // Power tracks speed (≈ 80 W per m/s here); efficiency improves slightly over time.
          runningPowerW: Math.round(speed * (82 - (29 - i) * 0.05) + (r() - 0.5) * 4),
          runningSpeedMS: Math.round(speed * 100) / 100,
          groundContactMS: Math.round(250 - (29 - i) * 0.3 + r() * 6),
          verticalOscillationCM: Math.round((8.2 + r() * 0.8) * 10) / 10,
          strideLengthM: Math.round((1.08 + r() * 0.06) * 100) / 100,
        })
        push(`hrr:${key}`, 'heart_rate_recovery', 26 + (29 - i) * 0.08 + (r() - 0.5) * 4, end, end + 60_000)
      }
    }
    // VO₂max: weekly, slowly improving (simulated) — 90 days handled by the loop below.
    // Overnight vitals (Apple Watch Series 6+/8+): SpO₂, respiratory rate, wrist temp deviation.
    if (at(6) <= nowMs) {
      push(`spo2:${key}`, 'oxygen_saturation', 96.5 + r() * 1.8, at(3), at(3))
      push(`resp:${key}`, 'respiratory_rate', 14 + r() * 1.2 + fatigue * 0.8, at(4), at(4))
      push(`temp:${key}`, 'wrist_temperature', 34.6 + (r() - 0.5) * 0.3 + fatigue * 0.2, at(5), at(5))
      push(`walkhr:${key}`, 'walking_heart_rate', 98 + r() * 6, at(12), at(12))
    }
    if (dayFraction > 0.05) {
      push(`dist:${key}`, 'distance_walking_running', (4.5 + r() * 4) * dayFraction, at(0), endOfDay)
      push(`flights:${key}`, 'flights_climbed', Math.round((6 + r() * 10) * dayFraction), at(0), endOfDay)
    }
    if (i % 3 === 0 && at(13) <= nowMs) {
      push(`wspeed:${key}`, 'walking_speed', 1.28 + r() * 0.1, at(13), at(13))
      push(`wsteady:${key}`, 'walking_steadiness', 88 + r() * 6, at(13), at(13))
      push(`wasym:${key}`, 'walking_asymmetry', 2 + r() * 2, at(13), at(13))
      push(`wdbl:${key}`, 'walking_double_support', 25 + r() * 3, at(13), at(13))
      push(`wstep:${key}`, 'walking_step_length', 0.72 + r() * 0.05, at(13), at(13))
    }
    if (i % 4 === 0 && at(7) <= nowMs) {
      push(`mass:${key}`, 'body_mass', 74.5 - (29 - i) * 0.03 + (r() - 0.5) * 0.4, at(7), at(7))
      push(`fat:${key}`, 'body_fat', 18.5 - (29 - i) * 0.03 + (r() - 0.5) * 0.3, at(7), at(7))
    }
  }
  // The watch also recorded each coach session (same time as demo-session schedules it).
  // demo-session: the last three are full sessions (the third is conditioning); earlier ones
  // are conditioning every third.
  const DAY = 86_400_000
  DEMO_COACH_DAY_OFFSETS.forEach((offset, j) => {
    const lastThree = j >= DEMO_COACH_DAY_OFFSETS.length - 3
    const conditioning = lastThree ? j === DEMO_COACH_DAY_OFFSETS.length - 1 : j % 3 === 2
    const start = nowMs + offset * DAY + 3 * 60_000
    const duration = 52 + Math.round(r() * 6)
    const avg = conditioning ? 142 + r() * 10 : 118 + r() * 12
    push(`coach-workout:${offset}`, 'workout', duration, start, start + duration * 60_000, conditioning ? 'hiit' : 'strength', {
      averageHeartRate: Math.round(avg),
      maxHeartRate: Math.round(avg * (conditioning ? 1.2 : 1.32)),
      energyKCal: Math.round(duration * (conditioning ? 9.5 : 6.5)),
    })
  })

  // About a year of earlier solo training (beyond the 30 detailed days), so the training
  // history has months to show. Older than every scoring window, so scores are unaffected.
  const OLDER_KINDS = ['running', 'running', 'cycling', 'walking', 'swimming', 'hiit', 'yoga', 'racket_sports'] as const
  for (let i = 360; i >= 31; i--) {
    const dow = i % 7
    if (!(dow === 1 || dow === 4 || (dow === 6 && r() < 0.6))) continue
    if (r() < 0.12) continue // skipped week days happen
    const day = addDays(today, -i, timeZone)
    const p = localParts(day, timeZone)
    const kind = OLDER_KINDS[Math.floor(r() * OLDER_KINDS.length)]!
    const start = fromLocal(p.year, p.month, p.day, dow === 6 ? 9 : 18, 0, 0, 0, timeZone)
    const duration = kind === 'walking' ? 45 + Math.round(r() * 30) : kind === 'yoga' ? 50 + Math.round(r() * 15) : 30 + Math.round(r() * 30)
    const cardio = kind === 'running' || kind === 'cycling' || kind === 'swimming' || kind === 'walking'
    const avg = kind === 'yoga' ? 96 + r() * 10 : kind === 'walking' ? 104 + r() * 10 : 136 + r() * 16
    const kmPerMin = kind === 'running' ? 0.17 : kind === 'cycling' ? 0.4 : kind === 'swimming' ? 0.035 : 0.09
    push(`older-workout:${localDateKey(day, timeZone)}`, 'workout', duration, start, start + duration * 60_000, kind, {
      averageHeartRate: Math.round(avg),
      maxHeartRate: Math.round(avg * 1.15),
      energyKCal: Math.round(duration * (kind === 'yoga' ? 3.5 : kind === 'walking' ? 5 : 9)),
      ...(cardio ? { distanceKM: Math.round(duration * kmPerMin * (0.9 + r() * 0.2) * 10) / 10 } : {}),
    })
  }

  // 13 weekly VO₂max estimates over 90 days, slowly improving (simulated).
  for (let w = 12; w >= 0; w--) {
    const t = addDays(today, -w * 7, timeZone) + 9 * 3_600_000
    if (t <= nowMs) push(`vo2w:${w}`, 'vo2_max', 43.2 + (12 - w) * 0.12 + (r() - 0.5) * 0.4, t, t)
  }
  return out
}
