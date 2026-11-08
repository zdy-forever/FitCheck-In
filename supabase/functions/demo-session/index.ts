/**
 * POST /functions/v1/demo-session  { "locale": "en" | "zh-CN" | "zh-TW", "timeZone": "Australia/Sydney" }
 *
 * Creates an isolated demo workspace for one visitor:
 *   - a demo trainer and a demo client (profiles.is_demo = true)
 *   - an active relationship with all health categories shared
 *   - SIMULATED Apple Health samples (origin = 'demo'), sessions, check-ins, notes
 * Returns the two sets of credentials so the visitor can sign in to either side
 * (e.g. trainer on a laptop, client on a phone) and run the full flow.
 *
 * Demo data is isolated by database constraints: demo users can never be linked to
 * real users, and `origin = 'demo'` rows can only belong to demo profiles.
 * Disable in production by not setting DEMO_MODE_ENABLED=true.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import { DEMO_COACH_DAY_OFFSETS, generateDemoSamples } from '../_shared/demo-data.ts'
import { isValidTimeZone } from '../_shared/metrics/calendar.ts'
import { HEALTH_CATEGORIES } from '../_shared/metrics/health-schema.ts'
import { recomputeSnapshot } from '../_shared/snapshot.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

function randomToken(bytes = 12): string {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

const TEXT = {
  en: {
    trainer: 'Demo Coach Alex',
    client: 'Demo Client Sam',
    sessions: ['Lower body strength', 'Upper body push/pull', 'Conditioning intervals'],
    goals: ['Improve squat depth', 'Keep shoulders happy on presses', 'Hold pace on intervals'],
    note: 'Solid bracing on squats. Keep the tempo on the eccentric. (demo note)',
    privateNote: 'Monitor left knee if soreness rises. (demo private note)',
    exercises: [['Back squat', 5, 5, 80], ['Romanian deadlift', 3, 8, 70], ['Walking lunge', 3, 12, 16]] as const,
  },
  'zh-CN': {
    trainer: '演示教练 Alex',
    client: '演示学员 Sam',
    sessions: ['下肢力量', '上肢推拉', '体能间歇'],
    goals: ['改善深蹲深度', '推举时保护肩部', '间歇训练保持配速'],
    note: '深蹲核心收紧很好，离心阶段继续控制节奏。（演示笔记）',
    privateNote: '如果酸痛加重，关注左膝情况。（演示私密笔记）',
    exercises: [['杠铃深蹲', 5, 5, 80], ['罗马尼亚硬拉', 3, 8, 70], ['行走箭步蹲', 3, 12, 16]] as const,
  },
  'zh-TW': {
    trainer: '示範教練 Alex',
    client: '示範學員 Sam',
    sessions: ['下肢肌力', '上肢推拉', '體能間歇'],
    goals: ['改善深蹲深度', '推舉時保護肩膀', '間歇訓練維持配速'],
    note: '深蹲核心收得很好，離心階段繼續控制節奏。（示範筆記）',
    privateNote: '如果痠痛加劇，留意左膝狀況。（示範私人筆記）',
    exercises: [['槓鈴深蹲', 5, 5, 80], ['羅馬尼亞硬舉', 3, 8, 70], ['行進弓箭步', 3, 12, 16]] as const,
  },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  if (Deno.env.get('DEMO_MODE_ENABLED') !== 'true') return json(403, { error: 'demo_disabled' })

  let body: { locale?: string; timeZone?: string } = {}
  try {
    body = await req.json()
  } catch {
    /* empty body is fine */
  }
  const locale = body.locale === 'zh-CN' || body.locale === 'zh-TW' ? body.locale : 'en'
  const timeZone = body.timeZone && isValidTimeZone(body.timeZone) ? body.timeZone : 'UTC'
  const t = TEXT[locale]

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const id = randomToken(5)
  const password = `Demo-${randomToken(10)}`
  const trainerEmail = `demo-trainer-${id}@demo.fitcheck-in.invalid`
  const clientEmail = `demo-client-${id}@demo.fitcheck-in.invalid`

  const mk = async (email: string, role: 'trainer' | 'client', name: string) => {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role, display_name: name, locale, time_zone: timeZone, demo: true },
    })
    if (error || !data.user) throw new Error('create_user_failed')
    const { error: pErr } = await admin.from('profiles').update({ is_demo: true }).eq('id', data.user.id)
    if (pErr) throw new Error('flag_demo_failed')
    return data.user.id
  }

  try {
    const trainerId = await mk(trainerEmail, 'trainer', t.trainer)
    const clientId = await mk(clientEmail, 'client', t.client)

    const { data: rel, error: relErr } = await admin
      .from('trainer_client_relationships')
      .insert({ trainer_id: trainerId, client_id: clientId, status: 'active' })
      .select('id')
      .single()
    if (relErr || !rel) throw new Error('relationship_failed')
    // Demo client shares every category (single source of truth, so new categories are included).
    const categories = HEALTH_CATEGORIES
    await admin.from('health_sharing_permissions').insert(
      categories.map((category) => ({ relationship_id: rel.id, client_id: clientId, trainer_id: trainerId, category, granted: true })),
    )

    // One pending invitation so the trainer UI shows how invites look.
    await admin.from('trainer_invitations').insert({ trainer_id: trainerId, note: 'demo' })

    const now = Date.now()
    const samples = generateDemoSamples(now, timeZone, Number.parseInt(id.slice(0, 6), 16))
    for (let i = 0; i < samples.length; i += 500) {
      const { error } = await admin
        .from('health_samples')
        .insert(samples.slice(i, i + 500).map((s) => ({ ...s, user_id: clientId, origin: 'demo', received_at: new Date(now).toISOString() })))
      if (error) {
        // Log the constraint/code only — never row contents.
        console.error('demo samples insert failed', error.code, error.message)
        throw new Error('samples_failed')
      }
    }
    await admin.from('health_sync_devices').insert({
      user_id: clientId,
      installation_id: crypto.randomUUID(),
      device_name: 'Demo iPhone (simulated)',
      enabled_categories: categories,
      last_sync_at: new Date(now - 20 * 60_000).toISOString(),
      last_sync_status: 'success',
      last_sample_count: samples.length,
    })

    const day = 86_400_000
    // Four weeks of earlier coach sessions (RPE feedback on most) — the training-load baseline.
    const history = DEMO_COACH_DAY_OFFSETS.slice(0, -3).map((offset, k) => ({
      trainer_id: trainerId,
      client_id: clientId,
      scheduled_at: new Date(now + offset * day).toISOString(),
      duration_minutes: 55 + (k % 3) * 5,
      status: 'completed' as const,
      session_type: k % 3 === 2 ? 'conditioning' : 'strength',
      title: t.sessions[k % 3],
      planned_intensity: 7,
      actual_intensity: k % 4 === 0 ? 7 : null,
    }))
    const { data: older, error: hErr } = await admin.from('training_sessions').insert(history).select('id')
    if (hErr || !older) throw new Error('sessions_failed')
    await admin.from('post_session_feedback').insert(
      older.filter((_, k) => k % 4 !== 3).map((s, k) => ({ session_id: s.id, client_id: clientId, trainer_id: clientId, session_rpe: [6, 7, 6, 7][k % 4], enjoyment: 4, pain_level: 0 })),
    )

    // The last three sessions get full detail: check-ins, feedback and notes. Plus one upcoming session.
    const sessionRows = DEMO_COACH_DAY_OFFSETS.slice(-3).map((offset, i) => ({
      trainer_id: trainerId,
      client_id: clientId,
      scheduled_at: new Date(now + offset * day).toISOString(),
      duration_minutes: 60,
      status: 'completed',
      session_type: i === 2 ? 'conditioning' : 'strength',
      title: t.sessions[i],
      planned_intensity: 7,
      actual_intensity: 6 + i,
    }))
    const { data: past, error: sErr } = await admin.from('training_sessions').insert(sessionRows).select('id, scheduled_at')
    if (sErr || !past) throw new Error('sessions_failed')

    await admin.from('session_exercises').insert(
      t.exercises.map(([name, sets, reps, weight], position) => ({ session_id: past[0]!.id, position, name, sets, reps, weight_kg: weight })),
    )
    for (const [i, s] of past.entries()) {
      const created = new Date(Date.parse(s.scheduled_at) - 2 * 3_600_000).toISOString()
      await admin.from('pre_session_checkins').insert({
        client_id: clientId,
        trainer_id: trainerId,
        session_id: s.id,
        sleep_quality: [4, 3, 4][i],
        energy_level: [4, 3, 4][i],
        muscle_soreness: [2, 5, 3][i],
        pain_level: [0, 2, 0][i],
        pain_areas: i === 1 ? ['knee_left'] : [],
        mental_state: [4, 3, 5][i],
        training_goal: t.goals[i],
        reviewed_at: new Date(Date.parse(s.scheduled_at) - 3_600_000).toISOString(),
        created_at: created,
      })
      await admin.from('post_session_feedback').insert({
        session_id: s.id,
        client_id: clientId,
        session_rpe: [7, 6, 8][i],
        enjoyment: [4, 4, 5][i],
        pain_level: [1, 2, 0][i],
      })
    }
    await admin.from('trainer_notes').insert([
      { trainer_id: trainerId, client_id: clientId, session_id: past[0]!.id, body: t.note, performance_rating: 4, visibility: 'shared' },
      { trainer_id: trainerId, client_id: clientId, session_id: past[1]!.id, body: t.privateNote, visibility: 'private' },
    ])
    await admin.from('training_sessions').insert({
      trainer_id: trainerId,
      client_id: clientId,
      scheduled_at: new Date(now + 2 * 3_600_000).toISOString(),
      duration_minutes: 60,
      status: 'planned',
      session_type: 'strength',
      title: t.sessions[0],
      planned_intensity: 7,
    })

    // Compute last: sessions + feedback RPE feed the training-load model.
    await recomputeSnapshot(admin, clientId, timeZone, now, 'demo')

    return json(200, {
      trainer: { email: trainerEmail, password },
      client: { email: clientEmail, password },
      sampleCount: samples.length,
      notice: 'All data in this workspace is simulated demo data.',
    })
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : 'demo_failed' })
  }
})
