/**
 * Integration tests against a running local Supabase stack:
 *   npx supabase start && npx supabase functions serve --env-file supabase/functions/.env.local
 *   npm --prefix web run test:integration
 *
 * Uses only the publishable/anon key, exactly like the web app and iOS bridge.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from "vitest"

const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON = process.env.SUPABASE_ANON_KEY ?? ''
const FN = `${URL}/functions/v1/health-ingest`

const uid = () => Math.random().toString(36).slice(2, 10)
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()
const H = 3_600_000

async function signUp(role: 'trainer' | 'client', tz = 'Australia/Sydney') {
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const email = `${role}-${uid()}@int.test`
  const { data, error } = await client.auth.signUp({
    email,
    password: 'Integration-Test-1!',
    options: { data: { role, display_name: `${role} ${uid()}`, time_zone: tz } },
  })
  if (error || !data.session) throw new Error(`signup failed: ${error?.message}`)
  return { client, token: data.session.access_token, userId: data.user!.id }
}

async function ingest(token: string | null, body: unknown) {
  const res = await fetch(FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

const device = { installationId: '6f1c1d8e-2b1e-4d0e-9a5a-0c0a5c1e9b01', name: 'Test iPhone', osVersion: '26.1', appVersion: '1.0' }

function corePayload(enabled = ['hrv', 'resting_heart_rate', 'sleep', 'activity', 'workouts', 'scores']) {
  const samples = [] as Record<string, unknown>[]
  // 7 days of HRV + RHR for baselines
  for (let d = 0; d < 7; d++) {
    samples.push({ sampleId: `hrv-${d}`, metricType: 'hrv_sdnn', value: 50 + d, unit: 'ms', startAt: iso(d * 24 * H + 2 * H), measuredAt: iso(d * 24 * H + 2 * H) })
    samples.push({ sampleId: `rhr-${d}`, metricType: 'resting_heart_rate', value: 55 + (d % 3), unit: 'bpm', startAt: iso(d * 24 * H + 2 * H), measuredAt: iso(d * 24 * H + 2 * H) })
  }
  // Last night: sleep stages ending 3 h ago
  samples.push({ sampleId: 'sl-core', metricType: 'sleep_analysis', value: 4, unit: 'h', startAt: iso(10 * H), measuredAt: iso(6 * H), category: 'asleepCore' })
  samples.push({ sampleId: 'sl-deep', metricType: 'sleep_analysis', value: 1.2, unit: 'h', startAt: iso(6 * H), measuredAt: iso(4.8 * H), category: 'asleepDeep' })
  samples.push({ sampleId: 'sl-rem', metricType: 'sleep_analysis', value: 1.8, unit: 'h', startAt: iso(4.8 * H), measuredAt: iso(3 * H), category: 'asleepREM' })
  samples.push({ sampleId: 'wk-1', metricType: 'workout', value: 50, unit: 'min', startAt: iso(30 * H), measuredAt: iso(29 * H), category: 'strength', metadata: { averageHeartRate: 128, maxHeartRate: 160, energyKCal: 320 } })
  return { schemaVersion: 1, device, timeZone: 'Australia/Sydney', enabledCategories: enabled, samples }
}

describe.skipIf(!ANON)('health-ingest Edge Function (live local stack)', () => {
  let client: Awaited<ReturnType<typeof signUp>>

  beforeAll(async () => {
    client = await signUp('client')
  })

  it('rejects requests without a token', async () => {
    const r = await ingest(null, corePayload())
    expect(r.status).toBe(401)
  })

  it('rejects forged tokens', async () => {
    const r = await ingest('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad', corePayload())
    expect(r.status).toBe(401)
  })

  it('rejects trainer uploads', async () => {
    const trainer = await signUp('trainer')
    const r = await ingest(trainer.token, corePayload())
    expect(r.status).toBe(403)
    expect(r.body.error).toBe('only_clients_can_upload')
  })

  it('stores samples and computes a snapshot', async () => {
    const r = await ingest(client.token, corePayload())
    expect(r.status).toBe(200)
    expect(r.body.accepted).toBe(18)
    expect(r.body.duplicates).toBe(0)
    expect(r.body.rejected).toEqual([])
    const snap = r.body.snapshot as { completeness: number; algorithmVersion: string }
    expect(snap.algorithmVersion).toMatch(/^fitcheck-readiness@/)
    expect(snap.completeness).toBe(1)

    const { data } = await client.client.auth.setSession({ access_token: client.token, refresh_token: 'x' }).then(() =>
      client.client.from('health_snapshots').select('assessment').single(),
    )
    const a = (data as { assessment: { scores: { readiness: { value: number | null; status: string } } } }).assessment
    // 7 days of HRV/RHR history but only one night of sleep → v2 has 2 of 3 signals with enough history.
    expect(a.scores.readiness.status).toBe('limited')
    expect(typeof a.scores.readiness.value).toBe('number')
  })

  it('is idempotent: re-uploading the same samples creates no duplicates', async () => {
    const r = await ingest(client.token, corePayload())
    expect(r.status).toBe(200)
    expect(r.body.accepted).toBe(0)
    expect(r.body.duplicates).toBe(18)
    const authed = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${client.token}` } }, auth: { persistSession: false } })
    const { count } = await authed.from('health_samples').select('id', { count: 'exact', head: true })
    expect(count).toBe(18)
  })

  it('rejects invalid samples individually without failing the batch', async () => {
    const p = corePayload()
    p.samples = [
      { sampleId: 'bad-unit', metricType: 'hrv_sdnn', value: 0.05, unit: 's', startAt: iso(H), measuredAt: iso(H) },
      { sampleId: 'bad-range', metricType: 'resting_heart_rate', value: 900, unit: 'bpm', startAt: iso(H), measuredAt: iso(H) },
      { sampleId: 'future', metricType: 'hrv_sdnn', value: 40, unit: 'ms', startAt: iso(-5 * H), measuredAt: iso(-5 * H) },
      { sampleId: 'not-enabled', metricType: 'vo2_max', value: 45, unit: 'mL/kg/min', startAt: iso(H), measuredAt: iso(H) },
      { sampleId: 'ok-new', metricType: 'hrv_sdnn', value: 61, unit: 'ms', startAt: iso(H), measuredAt: iso(H) },
    ]
    const r = await ingest(client.token, p)
    expect(r.status).toBe(200)
    expect(r.body.accepted).toBe(1)
    expect((r.body.rejected as Array<{ reason: string }>).map((x) => x.reason)).toEqual([
      'unit_mismatch',
      'value_out_of_range',
      'time_in_future',
      'category_not_enabled',
    ])
  })

  it('rejects unsupported schema versions', async () => {
    const r = await ingest(client.token, { ...corePayload(), schemaVersion: 99 })
    expect(r.status).toBe(400)
  })

  it('withholds scores when core inputs are missing (no fake precision)', async () => {
    const fresh = await signUp('client')
    const r = await ingest(fresh.token, {
      schemaVersion: 1,
      device: { ...device, installationId: '6f1c1d8e-2b1e-4d0e-9a5a-0c0a5c1e9b02' },
      timeZone: 'Australia/Sydney',
      enabledCategories: ['activity', 'scores'],
      samples: [{ sampleId: 'steps-today', metricType: 'step_count', value: 4000, unit: 'count', startAt: iso(5 * H), measuredAt: iso(H) }],
    })
    expect(r.status).toBe(200)
    const authed = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${fresh.token}` } }, auth: { persistSession: false } })
    const { data } = await authed.from('health_snapshots').select('assessment').single()
    const a = (data as { assessment: { scores: Record<string, { value: number | null; status: string }>; defaultedInputs: string[] } }).assessment
    expect(a.scores.readiness).toEqual({ value: null, status: 'insufficient' })
    expect(a.scores.recovery?.value).toBeNull()
    expect(a.scores.stress?.value).toBeNull()
    expect(a.defaultedInputs).toContain('hrv')
  })

  it('trainer sees only granted categories, and loses access when revoked', async () => {
    const trainer = await signUp('trainer')
    const tc = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${trainer.token}` } }, auth: { persistSession: false } })
    const cc = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${client.token}` } }, auth: { persistSession: false } })

    const { data: inv, error: invErr } = await tc.from('trainer_invitations').insert({ trainer_id: trainer.userId }).select('code').single()
    expect(invErr).toBeNull()
    const { error: accErr } = await cc.rpc('accept_invitation', { p_code: inv!.code, p_share: ['hrv', 'scores'] })
    expect(accErr).toBeNull()

    const { data: visible } = await tc.from('health_samples').select('metric_type').eq('user_id', client.userId)
    expect(new Set(visible!.map((v) => v.metric_type))).toEqual(new Set(['hrv_sdnn']))
    const { data: snap } = await tc.rpc('client_health_snapshot', { p_client: client.userId })
    expect(snap).not.toBeNull()

    await cc.from('health_sharing_permissions').update({ granted: false }).eq('trainer_id', trainer.userId)
    const { data: after } = await tc.from('health_samples').select('metric_type').eq('user_id', client.userId)
    expect(after).toEqual([])
    const { data: snapAfter } = await tc.rpc('client_health_snapshot', { p_client: client.userId })
    expect(snapAfter).toBeNull()
  })

  it('client can delete all stored health data', async () => {
    const cc = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${client.token}` } }, auth: { persistSession: false } })
    const { data, error } = await cc.rpc('delete_my_health_data')
    expect(error).toBeNull()
    expect((data as { samples: number }).samples).toBeGreaterThan(0)
    const { count } = await cc.from('health_samples').select('id', { count: 'exact', head: true })
    expect(count).toBe(0)
  })
})

describe.skipIf(!ANON)('demo-session Edge Function', () => {
  let demo: { trainer: { email: string; password: string }; client: { email: string; password: string } }

  it('creates an isolated demo workspace', async () => {
    const res = await fetch(`${URL}/functions/v1/demo-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON },
      body: JSON.stringify({ locale: 'en', timeZone: 'Australia/Sydney' }),
    })
    expect(res.status).toBe(200)
    demo = await res.json()
    expect(demo.trainer.email).toMatch(/@demo\.fitcheck-in\.invalid$/)
  })

  it('demo trainer sees demo client data, labelled as demo', async () => {
    const c = createClient(URL, ANON, { auth: { persistSession: false } }) as SupabaseClient
    const { error } = await c.auth.signInWithPassword(demo.trainer)
    expect(error).toBeNull()
    const { data: overview } = await c.rpc('trainer_client_overview')
    expect(overview).toHaveLength(1)
    const { data: overviewRows } = await c.rpc('trainer_client_overview')
    const { data: snap } = await c.rpc('client_health_snapshot', { p_client: (overviewRows as { client_id: string }[])[0]!.client_id })
    expect((snap as { origin: string }).origin).toBe('demo')
    const { data: samples } = await c.from('health_samples').select('origin').limit(5)
    expect(samples!.every((s) => s.origin === 'demo')).toBe(true)
  })

  it('a real client cannot accept a demo trainer invitation', async () => {
    const c = createClient(URL, ANON, { auth: { persistSession: false } })
    await c.auth.signInWithPassword(demo.trainer)
    const { data: inv } = await c.from('trainer_invitations').select('code').eq('status', 'pending').limit(1).single()
    const real = await signUp('client')
    const rc = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${real.token}` } }, auth: { persistSession: false } })
    const { error } = await rc.rpc('accept_invitation', { p_code: inv!.code })
    expect(error?.message).toBe('demo_mismatch')
  })

  it('demo accounts cannot upload real HealthKit data', async () => {
    const c = createClient(URL, ANON, { auth: { persistSession: false } })
    const { data } = await c.auth.signInWithPassword(demo.client)
    const r = await ingest(data.session!.access_token, corePayload())
    expect(r.status).toBe(403)
    expect(r.body.error).toBe('demo_accounts_cannot_upload')
  })
})

describe.skipIf(!ANON)('Swift-encoded upload (bytes produced by the iOS models)', () => {
  it('the Edge Function accepts the exact JSON the iOS app sends', async () => {
    const { readFileSync } = await import('node:fs')
    const raw = JSON.parse(readFileSync(new globalThis.URL('../fixtures/swift-upload-request.json', import.meta.url), 'utf8'))
    // Shift sample times to "now" so they pass the freshness window, keep everything else byte-for-byte.
    const shift = Date.now() - Date.parse('2026-11-08T03:00:00Z')
    for (const s of raw.samples) {
      s.startAt = new Date(Date.parse(s.startAt) + shift).toISOString()
      s.measuredAt = new Date(Date.parse(s.measuredAt) + shift).toISOString()
    }
    const c = await signUp('client')
    const r = await ingest(c.token, raw)
    expect(r.status).toBe(200)
    expect(r.body.accepted).toBe(raw.samples.length)
    expect(r.body.rejected).toEqual([])
  })
})

describe.skipIf(!ANON)('readiness v2 end-to-end', () => {
  it('uses personal history, and a same-day check-in lowers readiness via refresh-snapshot', async () => {
    const c = await signUp('client')
    const t = await signUp('trainer')
    const tc = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${t.token}` } }, auth: { persistSession: false } })
    const cc = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${c.token}` } }, auth: { persistSession: false } })
    const { data: inv } = await tc.from('trainer_invitations').insert({ trainer_id: t.userId }).select('code').single()
    await cc.rpc('accept_invitation', { p_code: inv!.code })

    // 10 days of history + today, all near the person's normal.
    const samples: Record<string, unknown>[] = []
    for (let d = 0; d <= 10; d++) {
      const at = iso(d * 24 * H + 3 * H)
      samples.push({ sampleId: `h${d}`, metricType: 'hrv_sdnn', value: 48 + (d % 3) * 2, unit: 'ms', startAt: at, measuredAt: at })
      samples.push({ sampleId: `r${d}`, metricType: 'resting_heart_rate', value: 55 + (d % 2), unit: 'bpm', startAt: at, measuredAt: at })
      samples.push({ sampleId: `s${d}`, metricType: 'sleep_analysis', value: 7.3, unit: 'h', startAt: iso(d * 24 * H + 11 * H), measuredAt: iso(d * 24 * H + 3.7 * H), category: 'asleepCore' })
    }
    const up = await ingest(c.token, { schemaVersion: 1, device: { ...device, installationId: '6f1c1d8e-2b1e-4d0e-9a5a-0c0a5c1e9b09' }, timeZone: 'Australia/Sydney', enabledCategories: ['hrv', 'resting_heart_rate', 'sleep', 'scores'], samples })
    expect(up.status).toBe(200)

    type A = { algorithmVersion: string; scores: { readiness: { value: number | null; status: string }; stress: { value: number | null } }; drivers: { key: string }[] }
    const read = async () => ((await cc.from('health_snapshots').select('assessment').single()).data as { assessment: A }).assessment
    const before = await read()
    expect(before.algorithmVersion).toMatch(/^fitcheck-readiness@2\./)
    expect(before.scores.readiness.status).toBe('ok')
    expect(before.scores.readiness.value!).toBeGreaterThan(50)
    expect(before.scores.stress.value!).toBeLessThan(50) // normal day is NOT "elevated stress"

    await cc.from('pre_session_checkins').insert({ client_id: c.userId, trainer_id: t.userId, sleep_quality: 2, energy_level: 1, muscle_soreness: 8, pain_level: 6, mental_state: 3, training_goal: 'test' })
    const res = await fetch(`${URL}/functions/v1/refresh-snapshot`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(200)
    const after = await read()
    expect(after.scores.readiness.value!).toBeLessThan(before.scores.readiness.value! - 10)
    expect(after.drivers.map((d) => d.key)).toEqual(expect.arrayContaining(['checkinPain', 'checkinEnergy']))
  })

  it('refresh-snapshot requires a token and only refreshes the caller', async () => {
    const r = await fetch(`${URL}/functions/v1/refresh-snapshot`, { method: 'POST', headers: { apikey: ANON } })
    expect(r.status).toBe(401)
  })
})

describe.skipIf(!ANON)('session-RPE training load end-to-end', () => {
  it('a coach-logged strength session with client RPE counts as load — no watch needed; trainer refresh is relationship-checked', async () => {
    const c = await signUp('client')
    const t = await signUp('trainer')
    const stranger = await signUp('trainer')
    const tc = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${t.token}` } }, auth: { persistSession: false } })
    const cc = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${c.token}` } }, auth: { persistSession: false } })
    const { data: inv } = await tc.from('trainer_invitations').insert({ trainer_id: t.userId }).select('code').single()
    await cc.rpc('accept_invitation', { p_code: inv!.code, p_share: ['workouts', 'scores'] })

    // Some HRV so a snapshot exists (no workouts uploaded from a watch).
    const at = iso(2 * H)
    await ingest(c.token, { schemaVersion: 1, device: { ...device, installationId: '6f1c1d8e-2b1e-4d0e-9a5a-0c0a5c1e9b10' }, timeZone: 'Australia/Sydney', enabledCategories: ['hrv'], samples: [{ sampleId: 'h', metricType: 'hrv_sdnn', value: 50, unit: 'ms', startAt: at, measuredAt: at }] })

    const sid = crypto.randomUUID()
    await tc.from('training_sessions').insert({ id: sid, trainer_id: t.userId, client_id: c.userId, scheduled_at: iso(5 * H), duration_minutes: 60, session_type: 'strength', status: 'completed' })
    await cc.from('post_session_feedback').insert({ session_id: sid, client_id: c.userId, trainer_id: c.userId, session_rpe: 8, enjoyment: 4, pain_level: 0 })

    const call = (token: string, body: unknown) => fetch(`${URL}/functions/v1/refresh-snapshot`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    expect((await call(stranger.token, { clientId: c.userId })).status).toBe(403) // not this client's trainer
    expect((await call(c.token, { clientId: t.userId })).status).toBe(403) // client cannot refresh someone else
    const ok = await call(t.token, { clientId: c.userId })
    expect(ok.status).toBe(200)
    expect(Object.keys(await ok.json()).sort()).toEqual(['completeness', 'date']) // status only, no health data

    const { data } = await tc.rpc('client_health_snapshot', { p_client: c.userId })
    const training = (data as { assessment: { training: { load7Day: number; sessions: { rpe: number; rpeSource: string; load: number; modality: string }[] } } }).assessment.training
    expect(training.load7Day).toBe(480)
    expect(training.sessions[0]).toMatchObject({ rpe: 8, rpeSource: 'client_rpe', load: 480, modality: 'resistance' })
  })
})

describe.skipIf(!ANON)('extra Apple Health data + fitness scores', () => {
  it('server catalogue matches the database for every metric (unit + category)', async () => {
    const { METRICS } = await import('@shared/metrics/health-schema.ts')
    const c = await signUp('client')
    const now = Date.now()
    const samples = Object.entries(METRICS).map(([metric, def], i) => ({
      sampleId: `cat-${i}`,
      metricType: metric,
      value: metric === 'sleep_analysis' ? 1 : metric === 'workout' ? 30 : (def.min + def.max) / 2,
      unit: def.unit,
      startAt: new Date(now - 2 * H).toISOString(),
      measuredAt: new Date(now - H).toISOString(),
      ...(metric === 'sleep_analysis' ? { category: 'asleepCore' } : metric === 'workout' ? { category: 'running' } : {}),
    }))
    const all = ['hrv', 'resting_heart_rate', 'heart_rate', 'sleep', 'activity', 'workouts', 'vo2_max', 'vitals', 'mobility', 'body', 'scores']
    const r = await ingest(c.token, { schemaVersion: 1, device: { ...device, installationId: '6f1c1d8e-2b1e-4d0e-9a5a-0c0a5c1e9b20' }, timeZone: 'Australia/Sydney', enabledCategories: all, samples })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.rejected).toEqual([])
    expect(r.body.accepted).toBe(samples.length)
  })

  it('trainer only receives snapshot sections for granted categories (privacy fix)', async () => {
    const c = await signUp('client')
    const t = await signUp('trainer')
    const tc = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${t.token}` } }, auth: { persistSession: false } })
    const cc = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${c.token}` } }, auth: { persistSession: false } })
    const { data: inv } = await tc.from('trainer_invitations').insert({ trainer_id: t.userId }).select('code').single()
    await cc.rpc('accept_invitation', { p_code: inv!.code, p_share: ['scores'] }) // only estimates

    const at = (h: number) => new Date(Date.now() - h * H).toISOString()
    const samples: Record<string, unknown>[] = []
    for (let d = 0; d < 8; d++) {
      samples.push({ sampleId: `h${d}`, metricType: 'hrv_sdnn', value: 50 + d, unit: 'ms', startAt: at(d * 24 + 2), measuredAt: at(d * 24 + 2) })
      samples.push({ sampleId: `o${d}`, metricType: 'oxygen_saturation', value: 97, unit: '%', startAt: at(d * 24 + 4), measuredAt: at(d * 24 + 4) })
      samples.push({ sampleId: `r${d}`, metricType: 'resting_heart_rate', value: 56, unit: 'bpm', startAt: at(d * 24 + 2), measuredAt: at(d * 24 + 2) })
    }
    samples.push({ sampleId: 'vo2', metricType: 'vo2_max', value: 45, unit: 'mL/kg/min', startAt: at(5), measuredAt: at(5) })
    await ingest(c.token, { schemaVersion: 1, device: { ...device, installationId: '6f1c1d8e-2b1e-4d0e-9a5a-0c0a5c1e9b21' }, timeZone: 'Australia/Sydney', enabledCategories: ['hrv', 'vitals', 'resting_heart_rate', 'vo2_max', 'scores'], samples })

    // Direct table read is no longer possible for trainers.
    const { data: direct } = await tc.from('health_snapshots').select('assessment').eq('user_id', c.userId)
    expect(direct).toEqual([])

    const { data: red } = await tc.rpc('client_health_snapshot', { p_client: c.userId })
    const a = (red as { assessment: Record<string, any> }).assessment
    expect(a.scores.readiness).toBeDefined() // granted
    expect(a.latest?.hrv).toBeUndefined() // raw HRV not granted
    expect(a.rawSummary?.baselines?.hrv).toBeUndefined()
    expect(a.baselineComparison?.hrvDeltaPercent).toBeUndefined()
    expect(a.signals).toBeUndefined()
    expect(a.fitness?.vitals).toBeUndefined()
    expect(a.fitness?.cardio).toBeUndefined()

    // Owner gets everything, including the new fitness section.
    const { data: own } = await cc.rpc('client_health_snapshot', { p_client: c.userId })
    const o = (own as { assessment: Record<string, any> }).assessment
    expect(o.latest.hrv.value).toBeGreaterThan(0)
    expect(o.fitness.vitals.signals[0].latest).toBe(97)
    expect(o.fitness.cardio.vo2Max).toBe(45)

    // Granting vitals reveals exactly that section.
    const { data: perm } = await cc.from('health_sharing_permissions').select('id').eq('trainer_id', t.userId).eq('category', 'vitals').single()
    await cc.from('health_sharing_permissions').update({ granted: true }).eq('id', perm!.id)
    const { data: red2 } = await tc.rpc('client_health_snapshot', { p_client: c.userId })
    const a2 = (red2 as { assessment: Record<string, any> }).assessment
    expect(a2.fitness.vitals.signals[0].latest).toBe(97)
    expect(a2.fitness.cardio).toBeUndefined()

    // Unrelated trainer gets nothing.
    const stranger = await signUp('trainer')
    const sc = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${stranger.token}` } }, auth: { persistSession: false } })
    const { data: none } = await sc.rpc('client_health_snapshot', { p_client: c.userId })
    expect(none).toBeNull()
  })
})
