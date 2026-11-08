/**
 * POST /functions/v1/health-import
 *
 * Apple Health import from the iPhone browser (the "Export All Health Data" file, parsed
 * on the phone). No user session is involved on the phone:
 *
 *   { action: "pair", code }                 → { token, clientName, deviceId }
 *       Exchanges a one-time pairing code (QR, 10 min, single use) for a long-lived
 *       upload-only import token tied to a health_sync_devices row (platform 'web_import').
 *   { action: "status" }   + X-Import-Token  → { clientName, lastSyncAt, lastSampleCount }
 *   { action: "upload", timeZone, enabledCategories, samples, final }
 *                          + X-Import-Token  → HealthUploadResponse
 *
 * Security
 *  - Only SHA-256 hashes of the code and token are stored; tokens are 256-bit random.
 *  - The token can only upload for its own user and device; it cannot read anything.
 *  - Revoking the device ("Unlink device"), deleting health data or the account invalidates it.
 *  - Same validation/storage path as health-ingest (whitelisted metrics, units, ranges).
 *  - Health values are never logged.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { sha256Hex, storeSamples } from '../_shared/ingest.ts'
import { isValidTimeZone } from '../_shared/metrics/calendar.ts'
import { HEALTH_CATEGORIES, type HealthCategory, MAX_SAMPLES_PER_REQUEST } from '../_shared/metrics/health-schema.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-import-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const MAX_BODY_BYTES = 2_000_000
const CODE_RE = /^[A-HJ-NP-Z2-9]{16}$/

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function randomToken(): string {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function deviceForToken(admin: SupabaseClient, token: string) {
  if (!token || token.length < 32 || token.length > 128) return null
  const { data } = await admin
    .from('health_sync_devices')
    .select('id, user_id, revoked_at, last_sync_at, last_sample_count, profiles!inner(display_name, role, is_demo)')
    .eq('import_token_hash', await sha256Hex(token))
    .maybeSingle()
  if (!data || data.revoked_at) return null
  const p = (Array.isArray(data.profiles) ? data.profiles[0] : data.profiles) as { display_name: string; role: string; is_demo: boolean }
  if (p.role !== 'client' || p.is_demo) return null
  return { id: data.id as string, userId: data.user_id as string, name: p.display_name, lastSyncAt: data.last_sync_at as string | null, lastSampleCount: data.last_sample_count as number | null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return json(500, { error: 'server_misconfigured' })
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  const length = Number(req.headers.get('content-length') ?? '0')
  if (length > MAX_BODY_BYTES) return json(413, { error: 'payload_too_large' })
  let body: Record<string, unknown>
  try {
    const text = await req.text()
    if (text.length > MAX_BODY_BYTES) return json(413, { error: 'payload_too_large' })
    body = JSON.parse(text)
    if (typeof body !== 'object' || body === null) throw new Error()
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  // ── pair: one-time code → import token ──
  if (body.action === 'pair') {
    const code = typeof body.code === 'string' ? body.code.toUpperCase() : ''
    if (!CODE_RE.test(code)) return json(400, { error: 'invalid_code' })
    const codeHash = await sha256Hex(code)
    // Atomically claim the code (single use, unexpired).
    const { data: pairing } = await admin
      .from('health_import_pairings')
      .update({ used_at: new Date().toISOString() })
      .eq('code_hash', codeHash)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('id, user_id')
      .maybeSingle()
    if (!pairing) return json(410, { error: 'code_expired_or_used' })

    const { data: profile } = await admin.from('profiles').select('display_name, role, is_demo').eq('id', pairing.user_id).single()
    if (!profile || profile.role !== 'client' || profile.is_demo) return json(403, { error: 'not_allowed' })

    const token = randomToken()
    const ua = req.headers.get('user-agent') ?? ''
    const name = /iPhone/.test(ua) ? 'iPhone (Health export)' : /iPad/.test(ua) ? 'iPad (Health export)' : 'Browser (Health export)'
    const { data: device, error } = await admin
      .from('health_sync_devices')
      .insert({
        user_id: pairing.user_id,
        installation_id: crypto.randomUUID(),
        device_name: name,
        platform: 'web_import',
        enabled_categories: HEALTH_CATEGORIES,
        import_token_hash: await sha256Hex(token),
      })
      .select('id')
      .single()
    if (error || !device) return json(500, { error: 'device_register_failed' })
    await admin.from('health_import_pairings').update({ device_id: device.id }).eq('id', pairing.id)
    return json(200, { token, clientName: profile.display_name, deviceId: device.id })
  }

  // Everything else needs a valid import token.
  const device = await deviceForToken(admin, req.headers.get('x-import-token') ?? '')
  if (!device) return json(401, { error: 'invalid_import_token' })

  if (body.action === 'status') {
    return json(200, { clientName: device.name, lastSyncAt: device.lastSyncAt, lastSampleCount: device.lastSampleCount })
  }

  if (body.action === 'upload') {
    const timeZone = typeof body.timeZone === 'string' ? body.timeZone : ''
    if (!isValidTimeZone(timeZone)) return json(400, { error: 'invalid_time_zone' })
    const cats = Array.isArray(body.enabledCategories) ? body.enabledCategories : []
    if (!cats.every((c) => (HEALTH_CATEGORIES as unknown[]).includes(c))) return json(400, { error: 'invalid_categories' })
    if (!Array.isArray(body.samples)) return json(400, { error: 'invalid_samples' })
    if (body.samples.length > MAX_SAMPLES_PER_REQUEST) return json(400, { error: 'too_many_samples' })
    const stored = await storeSamples(admin, {
      userId: device.userId,
      deviceId: device.id,
      timeZone,
      enabledCategories: [...new Set(cats as HealthCategory[])],
      samples: body.samples,
      recompute: body.final === true,
    })
    if (!stored.ok) return json(500, { error: stored.error })
    return json(200, stored.response)
  }

  return json(400, { error: 'unknown_action' })
})
