/**
 * POST /functions/v1/health-ingest
 *
 * Receives Apple Health samples from the FitCheck-In Sync iOS module.
 *
 * Security
 *  - Requires a valid Supabase user JWT (Authorization: Bearer <access_token>).
 *    The user id is taken from the verified token, never from the body.
 *  - Only `client` accounts can upload; demo accounts cannot.
 *  - The service-role key is used server-side only (Edge Function secret).
 *  - Samples are validated (metric whitelist, unit, plausibility range, time window,
 *    enabled category) before storage. Health values are never logged.
 *  - Idempotent: (user_id, metric_type, sample_id) is unique; re-uploads update in place.
 *
 * After storing, the function recomputes today's health snapshot with the ported
 * health+ DerivedMetricsEngine + FitCheck-In sufficiency rules.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { isValidTimeZone } from '../_shared/metrics/calendar.ts'
import { storeSamples } from '../_shared/ingest.ts'
import { type HealthUploadResponse, validateRequestEnvelope } from '../_shared/metrics/health-schema.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MAX_BODY_BYTES = 2_000_000

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function env(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`missing_env_${name}`)
  return v
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return json(401, { error: 'missing_token' })

  let admin: SupabaseClient
  try {
    admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  } catch {
    return json(500, { error: 'server_misconfigured' })
  }

  // Verify the JWT with Supabase Auth (signature + expiry + revocation).
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData?.user) return json(401, { error: 'invalid_token' })
  const userId = userData.user.id

  const { data: profile, error: profErr } = await admin.from('profiles').select('role, is_demo').eq('id', userId).single()
  if (profErr || !profile) return json(403, { error: 'profile_not_found' })
  if (profile.role !== 'client') return json(403, { error: 'only_clients_can_upload' })
  if (profile.is_demo) return json(403, { error: 'demo_accounts_cannot_upload' })

  const length = Number(req.headers.get('content-length') ?? '0')
  if (length > MAX_BODY_BYTES) return json(413, { error: 'payload_too_large' })
  let body: unknown
  try {
    const text = await req.text()
    if (text.length > MAX_BODY_BYTES) return json(413, { error: 'payload_too_large' })
    body = JSON.parse(text)
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  const envelope = validateRequestEnvelope(body)
  if (!envelope.ok) return json(400, { error: envelope.error })
  const request = envelope.request
  if (!isValidTimeZone(request.timeZone)) return json(400, { error: 'invalid_time_zone' })

  // Register / refresh the device.
  const { data: device, error: devErr } = await admin
    .from('health_sync_devices')
    .upsert(
      {
        user_id: userId,
        installation_id: request.device.installationId,
        device_name: request.device.name,
        os_version: request.device.osVersion ?? null,
        app_version: request.device.appVersion ?? null,
        enabled_categories: request.enabledCategories,
        revoked_at: null,
      },
      { onConflict: 'user_id,installation_id' },
    )
    .select('id')
    .single()
  if (devErr || !device) return json(500, { error: 'device_register_failed' })

  const stored = await storeSamples(admin, {
    userId,
    deviceId: device.id,
    timeZone: request.timeZone,
    enabledCategories: request.enabledCategories,
    samples: request.samples,
    recompute: true,
  })
  if (!stored.ok) return json(500, { error: stored.error })
  const response: HealthUploadResponse = stored.response
  return json(200, response)
})
