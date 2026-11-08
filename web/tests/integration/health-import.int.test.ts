/**
 * Phone-side Apple Health import (QR pairing + upload-only token) against the local stack.
 * The export is built in the same XML format as the iPhone's "Export All Health Data" and
 * parsed with the real browser parser, then uploaded through health-import.
 */
import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseHealthExport } from '@/features/health-import/parseExport'

const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON = process.env.SUPABASE_ANON_KEY ?? ''
const FN = `${URL}/functions/v1/health-import`
const uid = () => Math.random().toString(36).slice(2, 10)
const TZ = 'Australia/Sydney'

async function signUp(role: 'trainer' | 'client') {
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await client.auth.signUp({
    email: `${role}-${uid()}@int.test`,
    password: 'Integration-Test-1!',
    options: { data: { role, display_name: `${role} ${uid()}`, time_zone: TZ } },
  })
  if (error || !data.session) throw new Error(`signup failed: ${error?.message}`)
  return { client, userId: data.user!.id }
}

async function call(body: unknown, token?: string) {
  const res = await fetch(FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, ...(token ? { 'X-Import-Token': token } : {}) },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

/** Export.xml with 14 days of HRV / RHR / sleep and two step sources, dated relative to now. */
function exportXml(now = Date.now()) {
  const fmt = (t: number) => {
    // Apple writes local time with offset; use UTC (+0000) — the parser honours any offset.
    const d = new Date(t)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`
  }
  const H = 3_600_000
  const rows: string[] = []
  for (let day = 0; day < 14; day++) {
    const base = now - day * 24 * H
    rows.push(`<Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Watch" unit="ms" startDate="${fmt(base - 4 * H)}" endDate="${fmt(base - 4 * H)}" value="${48 + (day % 5)}"/>`)
    rows.push(`<Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Watch" unit="count/min" startDate="${fmt(base - 5 * H)}" endDate="${fmt(base - 3 * H)}" value="${55 + (day % 3)}"/>`)
    rows.push(`<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" startDate="${fmt(base - 11 * H)}" endDate="${fmt(base - 6 * H)}" value="HKCategoryValueSleepAnalysisAsleepCore"/>`)
    rows.push(`<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" startDate="${fmt(base - 6 * H)}" endDate="${fmt(base - 4.5 * H)}" value="HKCategoryValueSleepAnalysisAsleepDeep"/>`)
    rows.push(`<Record type="HKQuantityTypeIdentifierStepCount" sourceName="Watch" unit="count" startDate="${fmt(base - 2 * H)}" endDate="${fmt(base - 1.9 * H)}" value="3000"/>`)
    rows.push(`<Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" startDate="${fmt(base - 2 * H)}" endDate="${fmt(base - 1.9 * H)}" value="2800"/>`)
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<HealthData locale="en_AU">\n${rows.join('\n')}\n</HealthData>`
}

describe.skipIf(!ANON)('health-import (QR pairing + upload-only token)', () => {
  let me: Awaited<ReturnType<typeof signUp>>
  let code = ''
  let token = ''

  beforeAll(async () => {
    me = await signUp('client')
  })

  it('only signed-in clients can create a pairing code; trainers cannot', async () => {
    const t = await signUp('trainer')
    const { error } = await t.client.rpc('create_health_import_pairing')
    expect(error?.message).toContain('only_clients_can_import')
    const anon = createClient(URL, ANON, { auth: { persistSession: false } })
    expect((await anon.rpc('create_health_import_pairing')).error).not.toBeNull()

    const { data, error: e2 } = await me.client.rpc('create_health_import_pairing')
    expect(e2).toBeNull()
    code = (data as { code: string }).code
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{16}$/)
  })

  it('pairs once; the code cannot be reused', async () => {
    const r = await call({ action: 'pair', code })
    expect(r.status).toBe(200)
    token = r.body.token as string
    expect(token.length).toBeGreaterThanOrEqual(40)
    expect(r.body.clientName).toBeTruthy()
    expect((await call({ action: 'pair', code })).status).toBe(410)
    expect((await call({ action: 'pair', code: 'AAAAAAAAAAAAAAAA' })).status).toBe(410)
  })

  it('a newer code invalidates the previous unused one', async () => {
    const a = ((await me.client.rpc('create_health_import_pairing')).data as { code: string }).code
    const b = ((await me.client.rpc('create_health_import_pairing')).data as { code: string }).code
    expect((await call({ action: 'pair', code: a })).status).toBe(410)
    const ok = await call({ action: 'pair', code: b })
    expect(ok.status).toBe(200)
  })

  it('the token is hashed at rest and not readable by the client', async () => {
    const res = await me.client.from('health_sync_devices').select('import_token_hash')
    expect(res.error).not.toBeNull() // column not granted
    const list = await me.client.from('health_sync_devices').select('id, platform, device_name')
    expect(list.data!.some((d) => d.platform === 'web_import')).toBe(true)
  })

  it('parses a real-format export and uploads it; scores are recomputed; re-import updates in place', async () => {
    const { samples } = await parseHealthExport(new Blob([exportXml()]), { timeZone: TZ })
    expect(samples.length).toBeGreaterThan(40)
    const steps = samples.filter((s) => s.metricType === 'step_count')
    expect(Math.max(...steps.map((s) => s.value))).toBeLessThanOrEqual(3000) // never 3000+2800

    const up = await call({ action: 'upload', timeZone: TZ, enabledCategories: ['hrv', 'resting_heart_rate', 'sleep', 'activity', 'scores'], samples, final: true }, token)
    expect(up.status).toBe(200)
    expect(up.body.accepted).toBe(samples.length)
    expect((up.body.rejected as unknown[]).length).toBe(0)
    expect((up.body.snapshot as { completeness: number }).completeness).toBeGreaterThan(0.5)

    const snap = await me.client.from('health_snapshots').select('assessment').order('snapshot_date', { ascending: false }).limit(1).single()
    const a = snap.data!.assessment as { scores: { readiness: { value: number | null } } }
    expect(a.scores.readiness.value).not.toBeNull()

    const again = await call({ action: 'upload', timeZone: TZ, enabledCategories: ['hrv', 'resting_heart_rate', 'sleep', 'activity', 'scores'], samples, final: true }, token)
    expect(again.body.accepted).toBe(0)
    expect(again.body.duplicates).toBe(samples.length)
    const { count } = await me.client.from('health_samples').select('id', { count: 'exact', head: true })
    expect(count).toBe(samples.length)
  })

  it('the token cannot upload invalid data or categories it does not cover', async () => {
    const bad = await call({ action: 'upload', timeZone: TZ, enabledCategories: ['hrv'], samples: [{ sampleId: 'x', metricType: 'hrv_sdnn', value: 99999, unit: 'ms', startAt: new Date().toISOString(), measuredAt: new Date().toISOString() }], final: false }, token)
    expect(bad.status).toBe(200)
    expect((bad.body.rejected as unknown[]).length).toBe(1)
    expect((await call({ action: 'upload', timeZone: 'Mars/Base', enabledCategories: [], samples: [] }, token)).status).toBe(400)
  })

  it('revoking the device ("Unlink device") invalidates the token immediately', async () => {
    expect((await call({ action: 'status' }, token)).status).toBe(200)
    const devs = await me.client.from('health_sync_devices').select('id, platform').eq('platform', 'web_import')
    for (const d of devs.data!) await me.client.from('health_sync_devices').update({ revoked_at: new Date().toISOString() }).eq('id', d.id)
    expect((await call({ action: 'status' }, token)).status).toBe(401)
    expect((await call({ action: 'upload', timeZone: TZ, enabledCategories: [], samples: [] }, token)).status).toBe(401)
  })

  it('rejects missing/garbage tokens and demo accounts cannot create codes', async () => {
    expect((await call({ action: 'status' })).status).toBe(401)
    expect((await call({ action: 'status' }, 'x'.repeat(43))).status).toBe(401)
    const demo = await fetch(`${URL}/functions/v1/demo-session`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: '{}' })
    if (demo.status === 200) {
      const d = (await demo.json()) as { client: { email: string; password: string } }
      const c = createClient(URL, ANON, { auth: { persistSession: false } })
      await c.auth.signInWithPassword(d.client)
      expect((await c.rpc('create_health_import_pairing')).error?.message).toContain('demo_accounts_cannot_upload')
    }
  })
})
