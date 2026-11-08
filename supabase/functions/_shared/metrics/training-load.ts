/**
 * FitCheck-In training load (`fitcheck-load@1.0.0`) — session-RPE model.
 *
 * Why
 * ---
 * health+'s `estimateWorkoutLoad` is heart-rate based. That works for steady cardio but
 * systematically under-counts resistance training: heart rate stays moderate while the
 * muscular/neural strain is high. Measured with the original formula:
 *   60 min hard lifting (avg 125 / peak 160 bpm) → 42.7
 *   60 min easy walk    (avg 105 / peak 115 bpm) → 41.7
 *   60 min lifting without heart rate           → 33.3
 * and sessions logged by the trainer in FitCheck-In (no watch) were not counted at all.
 *
 * Model
 * -----
 * Session-RPE (Foster et al., 2001): load = RPE (CR-10, 1–10) × duration (min).
 * It is the standard way to quantify load across resistance and endurance training
 * because it captures internal effort regardless of modality.
 *
 * RPE source, best first (each session records which one was used):
 *   1. `client_rpe`      — the client's post-session feedback (session_rpe)
 *   2. `trainer_rpe`     — the trainer's recorded actual intensity (1–10)
 *   3. `apple_effort`    — Apple Workout Effort score (iOS 18+, user-rated or estimated, 1–10)
 *   4. `heart_rate`      — from heart-rate reserve vs the person's HRmax, **cardio only**
 *                          (heart rate under-reads muscular strain, so never used for lifting)
 *   5. `trainer_planned` — the trainer's planned intensity
 *   6. `typical`         — typical RPE for the training type; flagged as an estimate
 *
 * Merging: a FitCheck-In session and an Apple Watch workout whose time ranges overlap are
 * the same session and counted once (FitCheck-In RPE wins, watch duration used when the
 * session has none).
 *
 * Acute:chronic: acute = last 7 days; chronic = previous 21 days ÷ 3 (weekly equivalent).
 * Needs ≥ 2 sessions in the chronic window, otherwise the ratio is null (not enough history).
 */

export const TRAINING_LOAD_VERSION = 'fitcheck-load@1.0.0'

export type RpeSource = 'client_rpe' | 'trainer_rpe' | 'apple_effort' | 'heart_rate' | 'trainer_planned' | 'typical'
export type LoadModality = 'resistance' | 'cardio' | 'mixed' | 'mobility'

/** Typical session RPE when nothing better is known (conservative mid values). */
const TYPICAL_RPE: Record<LoadModality, number> = { resistance: 6, cardio: 5, mixed: 6, mobility: 3 }
const DEFAULT_DURATION_MIN: Record<LoadModality, number> = { resistance: 60, cardio: 45, mixed: 50, mobility: 40 }

/** FitCheck-In `training_sessions.session_type` → modality. */
export function modalityForSessionType(type: string | null | undefined): LoadModality {
  switch (type) {
    case 'strength':
    case 'hypertrophy':
    case 'technique':
      return 'resistance'
    case 'endurance':
      return 'cardio'
    case 'mobility':
    case 'recovery':
      return 'mobility'
    default:
      return 'mixed' // conditioning, other
  }
}

/** Apple Health `WorkoutKind` (health+) → modality. */
export function modalityForWorkoutKind(kind: string | null | undefined): LoadModality {
  switch (kind) {
    case 'strength':
      return 'resistance'
    case 'running':
    case 'walking':
    case 'cycling':
    case 'swimming':
      return 'cardio'
    case 'yoga':
      return 'mobility'
    default:
      return 'mixed'
  }
}

export interface PlatformSession {
  id: string
  startMs: number
  durationMinutes: number | null
  sessionType: string
  status: 'planned' | 'completed' | 'cancelled'
  plannedIntensity: number | null
  actualIntensity: number | null
  clientRpe: number | null
}

export interface WatchWorkout {
  id: string
  startMs: number
  endMs: number
  kind: string
  averageHeartRate?: number
  maxHeartRate?: number
  /** Apple Workout Effort (1–10), user-rated preferred over estimated. */
  appleEffort?: number
}

export interface LoadSession {
  id: string
  startMs: number
  durationMinutes: number
  modality: LoadModality
  rpe: number
  rpeSource: RpeSource
  load: number
  sources: Array<'fitcheckin' | 'apple_health'>
}

export interface TrainingLoadResult {
  version: typeof TRAINING_LOAD_VERSION
  sessions: LoadSession[]
  acute7: number
  chronicWeekly: number | null
  acuteChronicRatio: number | null
  /** Share of acute+chronic load whose RPE came from a real rating (client/trainer/Apple). */
  ratedShare: number
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const DAY = 86_400_000

/**
 * Heart rate → CR-10 RPE (cardio only), via heart-rate reserve (Karvonen):
 *   %HRR = (avg − rest) / (HRmax − rest);  RPE ≈ 10 × %HRR, clamped 1–10.
 * 40 %HRR (easy) ≈ 4, 60 % ≈ 6, 80 % (threshold) ≈ 8, 95 % ≈ 9–10.
 * HRmax is the PERSON's maximum (see personalMaxHeartRate), never the session peak —
 * using the session peak would rate an easy walk (105/115 bpm) as near-maximal.
 */
export function rpeFromHeartRate(avg: number, personalMax: number, resting = 60): number {
  const reserve = Math.max(personalMax - resting, 30)
  const pct = (avg - resting) / reserve
  return clamp(Math.round(pct * 10), 1, 10)
}

/** max(Tanaka age estimate 208 − 0.7·age, highest HR seen in recent workouts). */
export function personalMaxHeartRate(watch: WatchWorkout[], age = 35): number {
  const observed = Math.max(0, ...watch.map((w) => w.maxHeartRate ?? 0))
  return Math.max(208 - 0.7 * age, observed)
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number, slackMs = 30 * 60_000): boolean {
  return aStart - slackMs < bEnd && bStart - slackMs < aEnd
}

export function computeTrainingLoad(input: { nowMs: number; platform: PlatformSession[]; watch: WatchWorkout[]; restingHeartRate?: number; age?: number }): TrainingLoadResult {
  const { nowMs } = input
  const hrMax = personalMaxHeartRate(input.watch, input.age)
  const hrRest = input.restingHeartRate ?? 60
  const windowStart = nowMs - 28 * DAY
  const sessions: LoadSession[] = []
  const usedWatch = new Set<string>()

  // 1) FitCheck-In sessions (completed, or planned ones that have already happened and have feedback)
  for (const s of input.platform) {
    if (s.status === 'cancelled' || s.startMs > nowMs || s.startMs < windowStart) continue
    const happened = s.status === 'completed' || s.clientRpe !== null || s.actualIntensity !== null
    if (!happened) continue
    const modality = modalityForSessionType(s.sessionType)
    const sessionEnd = s.startMs + (s.durationMinutes ?? DEFAULT_DURATION_MIN[modality]) * 60_000
    const match = input.watch.find((w) => !usedWatch.has(w.id) && overlaps(s.startMs, sessionEnd, w.startMs, w.endMs))
    if (match) usedWatch.add(match.id)

    let rpe: number
    let rpeSource: RpeSource
    if (s.clientRpe !== null) [rpe, rpeSource] = [s.clientRpe, 'client_rpe']
    else if (s.actualIntensity !== null) [rpe, rpeSource] = [s.actualIntensity, 'trainer_rpe']
    else if (match?.appleEffort !== undefined) [rpe, rpeSource] = [match.appleEffort, 'apple_effort']
    else if (match?.averageHeartRate !== undefined && modality === 'cardio') [rpe, rpeSource] = [rpeFromHeartRate(match.averageHeartRate, hrMax, hrRest), 'heart_rate']
    else if (s.plannedIntensity !== null) [rpe, rpeSource] = [s.plannedIntensity, 'trainer_planned']
    else [rpe, rpeSource] = [TYPICAL_RPE[modality], 'typical']

    const duration = s.durationMinutes ?? (match ? (match.endMs - match.startMs) / 60_000 : DEFAULT_DURATION_MIN[modality])
    rpe = clamp(rpe, 1, 10)
    sessions.push({ id: s.id, startMs: s.startMs, durationMinutes: duration, modality, rpe, rpeSource, load: rpe * duration, sources: match ? ['fitcheckin', 'apple_health'] : ['fitcheckin'] })
  }

  // 2) Remaining Apple Watch workouts (trained without the coach)
  for (const w of input.watch) {
    if (usedWatch.has(w.id) || w.startMs > nowMs || w.endMs < windowStart) continue
    const modality = modalityForWorkoutKind(w.kind)
    const duration = Math.max(0, (w.endMs - w.startMs) / 60_000)
    let rpe: number
    let rpeSource: RpeSource
    if (w.appleEffort !== undefined) [rpe, rpeSource] = [w.appleEffort, 'apple_effort']
    else if (w.averageHeartRate !== undefined && modality === 'cardio') [rpe, rpeSource] = [rpeFromHeartRate(w.averageHeartRate, hrMax, hrRest), 'heart_rate']
    else [rpe, rpeSource] = [TYPICAL_RPE[modality], 'typical']
    rpe = clamp(rpe, 1, 10)
    sessions.push({ id: w.id, startMs: w.startMs, durationMinutes: duration, modality, rpe, rpeSource, load: rpe * duration, sources: ['apple_health'] })
  }

  sessions.sort((a, b) => b.startMs - a.startMs)
  const acuteSessions = sessions.filter((s) => s.startMs > nowMs - 7 * DAY)
  const chronicSessions = sessions.filter((s) => s.startMs <= nowMs - 7 * DAY)
  const acute7 = acuteSessions.reduce((a, s) => a + s.load, 0)
  const chronicWeekly = chronicSessions.length >= 2 ? chronicSessions.reduce((a, s) => a + s.load, 0) / 3 : null
  const acuteChronicRatio = chronicWeekly && chronicWeekly > 0 ? acute7 / chronicWeekly : null
  const total = sessions.reduce((a, s) => a + s.load, 0)
  const rated = sessions.filter((s) => s.rpeSource === 'client_rpe' || s.rpeSource === 'trainer_rpe' || s.rpeSource === 'apple_effort').reduce((a, s) => a + s.load, 0)

  return {
    version: TRAINING_LOAD_VERSION,
    sessions,
    acute7: Math.round(acute7),
    chronicWeekly: chronicWeekly === null ? null : Math.round(chronicWeekly),
    acuteChronicRatio,
    ratedShare: total > 0 ? Math.round((rated / total) * 100) / 100 : 0,
  }
}
