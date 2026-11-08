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
import { recomputeSnapshot } from '../_shared/snapshot.ts'
import {
  type HealthCategory,
  type HealthUploadResponse,
  validateRequestEnvelope,
  validateSample,
} from '../_shared/metrics/health-schema.ts'

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

  const nowMs = Date.now()
  const receivedAt = new Date(nowMs).toISOString()

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

  const enabled = new Set<HealthCategory>(request.enabledCategories)
  const rejected: HealthUploadResponse['rejected'] = []
  const rows: Record<string, unknown>[] = []
  const seen = new Set<string>()
  let duplicates = 0

  request.samples.forEach((raw, index) => {
    const res = validateSample(raw, index, enabled, nowMs)
    if (!res.ok) {
      rejected.push(res.issue)
      return
    }
    const s = res.sample
    const key = `${s.metricType}|${s.sampleId}`
    if (seen.has(key)) {
      duplicates++
      return
    }
    seen.add(key)
    rows.push({
      user_id: userId,
      device_id: device.id,
      sample_id: s.sampleId,
      metric_type: s.metricType,
      value: s.value,
      unit: s.unit,
      start_at: s.startAt,
      measured_at: s.measuredAt,
      received_at: receivedAt,
      category: s.category ?? null,
      metadata: s.metadata ?? {},
      source_name: s.sourceName ?? null,
      source_bundle: s.sourceBundle ?? null,
      origin: 'healthkit',
    })
  })

  // Count which keys already exist so the response can report duplicates honestly.
  let alreadyStored = 0
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const ids = chunk.map((r) => r.sample_id as string)
    const { count } = await admin
      .from('health_samples')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('sample_id', ids)
    alreadyStored += count ?? 0
    const { error } = await admin.from('health_samples').upsert(chunk, { onConflict: 'user_id,metric_type,sample_id' })
    if (error) {
      await admin
        .from('health_sync_devices')
        .update({ last_sync_at: receivedAt, last_sync_status: 'error', last_sync_error: 'storage_failed' })
        .eq('id', device.id)
      return json(500, { error: 'storage_failed' })
    }
  }

  let snapshot: HealthUploadResponse['snapshot'] = null
  try {
    snapshot = await recomputeSnapshot(admin, userId, request.timeZone, nowMs, 'healthkit')
  } catch {
    snapshot = null
  }

  await admin
    .from('health_sync_devices')
    .update({
      last_sync_at: receivedAt,
      last_sync_status: rejected.length > 0 || snapshot === null ? 'partial' : 'success',
      last_sync_error: rejected.length > 0 ? `${rejected.length}_samples_rejected` : snapshot === null ? 'snapshot_failed' : null,
      last_sample_count: rows.length,
    })
    .eq('id', device.id)

  // Keep the profile time zone in step with the phone (used for day bucketing).
  await admin.from('profiles').update({ time_zone: request.timeZone }).eq('id', userId)

  const response: HealthUploadResponse = {
    accepted: rows.length - alreadyStored,
    duplicates: duplicates + alreadyStored,
    rejected: rejected.slice(0, 50),
    snapshot,
    receivedAt,
  }
  return json(200, response)
})
