/**
 * Typed data-access functions. Every call runs as the signed-in user, so
 * Postgres RLS decides what is visible; nothing here relies on client-side filtering
 * for security.
 */
import type { ReadinessAssessment } from '@shared/metrics/assessment.ts'
import type { FitnessAssessment } from '@shared/metrics/fitness.ts'
import { unwrap } from '@/hooks/useLiveQuery'
import { supabase, type Enums, type Tables } from './supabase'

export type Checkin = Tables<'pre_session_checkins'>
export type Session = Tables<'training_sessions'>
export type Exercise = Tables<'session_exercises'>
export type Feedback = Tables<'post_session_feedback'>
export type Note = Tables<'trainer_notes'>
export type Invitation = Tables<'trainer_invitations'>
export type Relationship = Tables<'trainer_client_relationships'>
export type SharingPermission = Tables<'health_sharing_permissions'>
export type HealthCategory = Enums<'health_category'>
export type HealthSample = Tables<'health_samples'>
export type SyncDevice = Tables<'health_sync_devices'>

export interface StoredAssessment extends ReadinessAssessment {
  fitness?: Partial<FitnessAssessment>
  latest?: Partial<Record<'hrv' | 'restingHeartRate' | 'vo2Max', { value: number; measuredAt: number }>>
  rawSummary?: {
    sleepHours: number | null
    sleepStages: { deep: number | null; rem: number | null; core: number | null; awake: number | null; inBed: number | null }
    sleepEndAt: string | null
    stepsToday: number | null
    activeEnergyToday: number | null
    exerciseMinutesToday: number | null
    baselines: { hrv: number | null; restingHeartRate: number | null; sleepHours: number | null }
    workouts28Day: number
  }
}
export type Snapshot = Omit<Tables<'health_snapshots'>, 'assessment'> & { assessment: StoredAssessment }

export type RelationshipWithPeer = Relationship & { peer: Pick<Tables<'profiles'>, 'id' | 'display_name' | 'is_demo'> | null }
export type SessionWithDetails = Session & {
  session_exercises: Exercise[]
  post_session_feedback: Feedback[]
  client?: { display_name: string } | null
}

/** Best-effort recompute of a client's readiness/load after data that feeds it changes. */
function refreshSnapshot(clientId?: string) {
  void supabase.functions.invoke('refresh-snapshot', { body: clientId ? { clientId } : {} }).catch(() => undefined)
}

export const api = {
  // ── relationships ──
  async myRelationships(role: Enums<'user_role'>): Promise<RelationshipWithPeer[]> {
    const peer = role === 'client' ? 'peer:profiles!trainer_client_relationships_trainer_id_fkey(id, display_name, is_demo)' : 'peer:profiles!trainer_client_relationships_client_id_fkey(id, display_name, is_demo)'
    const res = await supabase.from('trainer_client_relationships').select(`*, ${peer}`).order('started_at', { ascending: false })
    return unwrap(res) as unknown as RelationshipWithPeer[]
  },
  async trainerOverview() {
    return unwrap(await supabase.rpc('trainer_client_overview'))
  },
  async endRelationship(id: string) {
    unwrap(await supabase.rpc('end_relationship', { p_relationship_id: id }))
  },

  // ── invitations ──
  async invitations(): Promise<Invitation[]> {
    return unwrap(await supabase.from('trainer_invitations').select('*').order('created_at', { ascending: false }).limit(50))
  },
  async createInvitation(trainerId: string, input: { invitee_email?: string | null; note?: string | null }) {
    return unwrap(
      await supabase
        .from('trainer_invitations')
        .insert({ trainer_id: trainerId, invitee_email: input.invitee_email || null, note: input.note || null })
        .select('*')
        .single(),
    )
  },
  async revokeInvitation(id: string) {
    unwrap(await supabase.from('trainer_invitations').update({ status: 'revoked' }).eq('id', id))
  },
  async previewInvitation(code: string) {
    const rows = unwrap(await supabase.rpc('get_invitation_preview', { p_code: code }))
    return rows[0] ?? null
  },
  async acceptInvitation(code: string, share: HealthCategory[]) {
    return unwrap(await supabase.rpc('accept_invitation', { p_code: code, p_share: share }))
  },

  // ── check-ins ──
  async checkins(filter: { clientId?: string; trainerId?: string; limit?: number } = {}): Promise<Checkin[]> {
    let q = supabase.from('pre_session_checkins').select('*').order('created_at', { ascending: false }).limit(filter.limit ?? 100)
    if (filter.clientId) q = q.eq('client_id', filter.clientId)
    if (filter.trainerId) q = q.eq('trainer_id', filter.trainerId)
    return unwrap(await q)
  },
  async submitCheckin(input: Omit<Checkin, 'created_at' | 'updated_at' | 'reviewed_at'>) {
    const row = unwrap(await supabase.from('pre_session_checkins').insert(input).select('*').single())
    // Fold the subjective answers into today's readiness. Best effort: the check-in is already saved.
    refreshSnapshot()
    return row
  },
  async markReviewed(id: string) {
    return unwrap(await supabase.rpc('mark_checkin_reviewed', { p_checkin_id: id }))
  },

  // ── sessions ──
  async sessions(filter: { clientId?: string; from?: string; to?: string; limit?: number } = {}): Promise<SessionWithDetails[]> {
    let q = supabase
      .from('training_sessions')
      .select('*, session_exercises(*), post_session_feedback(*), client:profiles!training_sessions_client_id_fkey(display_name)')
      .order('scheduled_at', { ascending: false })
      .limit(filter.limit ?? 200)
    if (filter.clientId) q = q.eq('client_id', filter.clientId)
    if (filter.from) q = q.gte('scheduled_at', filter.from)
    if (filter.to) q = q.lt('scheduled_at', filter.to)
    // post_session_feedback.session_id is UNIQUE, so PostgREST embeds it as a single
    // object (or null) rather than an array. Normalise to an array for the UI.
    const rows = unwrap(await q) as unknown as Array<Omit<SessionWithDetails, 'post_session_feedback'> & { post_session_feedback: Feedback | Feedback[] | null }>
    return rows.map((r) => ({
      ...r,
      session_exercises: [...(r.session_exercises ?? [])].sort((a, b) => a.position - b.position),
      post_session_feedback: r.post_session_feedback === null ? [] : Array.isArray(r.post_session_feedback) ? r.post_session_feedback : [r.post_session_feedback],
    }))
  },
  async saveSession(
    session: Partial<Session> & Pick<Session, 'trainer_id' | 'client_id' | 'scheduled_at'>,
    exercises: Array<Pick<Exercise, 'name' | 'sets' | 'reps' | 'weight_kg' | 'notes'>>,
  ): Promise<string> {
    const { id, trainer_id, client_id, scheduled_at, duration_minutes, status, session_type, title, location, planned_intensity, actual_intensity } = session
    const fields = { scheduled_at, duration_minutes, status, session_type, title, location, planned_intensity, actual_intensity }
    let sessionId = id
    if (sessionId) {
      unwrap(await supabase.from('training_sessions').update(fields).eq('id', sessionId))
      unwrap(await supabase.from('session_exercises').delete().eq('session_id', sessionId))
    } else {
      sessionId = crypto.randomUUID()
      unwrap(await supabase.from('training_sessions').insert({ id: sessionId, trainer_id, client_id, ...fields }))
    }
    if (exercises.length > 0) {
      unwrap(await supabase.from('session_exercises').insert(exercises.map((e, position) => ({ ...e, position, session_id: sessionId! }))))
    }
    refreshSnapshot(client_id) // session duration/intensity feed the client's training load
    return sessionId
  },
  async deleteSession(id: string) {
    unwrap(await supabase.from('training_sessions').delete().eq('id', id))
  },

  // ── feedback ──
  /**
   * Insert or update. Only answer columns are sent on update (owner/trainer columns are
   * not updatable by design); trainer_id is derived from the session by a DB trigger.
   */
  async submitFeedback(input: Pick<Feedback, 'session_id' | 'client_id' | 'session_rpe' | 'enjoyment' | 'pain_level' | 'pain_areas' | 'comments'>, existingId?: string) {
    const answers = { session_rpe: input.session_rpe, enjoyment: input.enjoyment, pain_level: input.pain_level, pain_areas: input.pain_areas, comments: input.comments }
    const row = existingId
      ? unwrap(await supabase.from('post_session_feedback').update(answers).eq('id', existingId).select('*').single())
      : // trainer_id placeholder satisfies the generated type; the trigger overwrites it from the session.
        unwrap(
          await supabase
            .from('post_session_feedback')
            .insert({ ...answers, session_id: input.session_id, client_id: input.client_id, trainer_id: input.client_id })
            .select('*')
            .single(),
        )
    refreshSnapshot() // session RPE is the primary training-load input
    return row
  },

  // ── notes ──
  async notes(filter: { clientId?: string } = {}): Promise<Note[]> {
    let q = supabase.from('trainer_notes').select('*').order('created_at', { ascending: false }).limit(200)
    if (filter.clientId) q = q.eq('client_id', filter.clientId)
    return unwrap(await q)
  },
  async saveNote(note: Partial<Note> & Pick<Note, 'trainer_id' | 'client_id' | 'body'>) {
    const { id, trainer_id, client_id, session_id, body, performance_rating, recommendations, visibility } = note
    if (id) {
      return unwrap(
        await supabase.from('trainer_notes').update({ session_id, body, performance_rating, recommendations, visibility }).eq('id', id).select('*').single(),
      )
    }
    return unwrap(
      await supabase
        .from('trainer_notes')
        .insert({ trainer_id, client_id, session_id, body, performance_rating, recommendations, visibility })
        .select('*')
        .single(),
    )
  },
  async deleteNote(id: string) {
    unwrap(await supabase.from('trainer_notes').delete().eq('id', id))
  },

  // ── health ──
  /**
   * Latest snapshot. For a trainer the server strips every section the client has not
   * granted (client_health_snapshot RPC) — the full row is never sent.
   */
  async latestSnapshot(userId: string): Promise<Snapshot | null> {
    const res = await supabase.rpc('client_health_snapshot', { p_client: userId })
    if (res.error) throw res.error
    return (res.data ?? null) as unknown as Snapshot | null
  },
  async healthSamples(userId: string, metrics: string[], sinceDays = 30): Promise<HealthSample[]> {
    const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString()
    return unwrap(
      await supabase
        .from('health_samples')
        .select('*')
        .eq('user_id', userId)
        .in('metric_type', metrics)
        .gte('measured_at', since)
        .order('measured_at', { ascending: true })
        .limit(5000),
    )
  },
  async devices(): Promise<SyncDevice[]> {
    return unwrap(await supabase.from('health_sync_devices').select('*').order('last_sync_at', { ascending: false, nullsFirst: false }))
  },
  async revokeDevice(id: string) {
    unwrap(await supabase.from('health_sync_devices').update({ revoked_at: new Date().toISOString() }).eq('id', id))
  },
  async sharing(filter: { clientId?: string; trainerId?: string } = {}): Promise<SharingPermission[]> {
    let q = supabase.from('health_sharing_permissions').select('*')
    if (filter.clientId) q = q.eq('client_id', filter.clientId)
    if (filter.trainerId) q = q.eq('trainer_id', filter.trainerId)
    return unwrap(await q)
  },
  async setSharing(id: string, granted: boolean) {
    unwrap(await supabase.from('health_sharing_permissions').update({ granted }).eq('id', id))
  },
  async deleteMyHealthData() {
    return unwrap(await supabase.rpc('delete_my_health_data')) as { samples: number; snapshots: number; devices: number }
  },
  async deleteMyAccount() {
    unwrap(await supabase.rpc('delete_my_account'))
  },

  // ── profile ──
  async updateProfile(id: string, patch: Partial<Pick<Tables<'profiles'>, 'display_name' | 'locale' | 'time_zone' | 'bio' | 'birth_year' | 'sex'>>) {
    return unwrap(await supabase.from('profiles').update(patch).eq('id', id).select('*').single())
  },
  async peerProfile(id: string) {
    return unwrap(await supabase.from('profiles').select('id, display_name, time_zone, bio, is_demo, created_at').eq('id', id).single())
  },
}
