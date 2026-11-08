/**
 * POST /functions/v1/refresh-snapshot   body: { "clientId"?: uuid }
 * Recomputes a client's daily health snapshot so new check-ins, session feedback (RPE) or
 * trainer-logged sessions feed into readiness / training load.
 *  - A client may refresh only themselves (clientId omitted or equal to self).
 *  - A trainer may refresh a client only while the relationship is active.
 * Returns status only (never health data). No-op (204) if the client has no health data.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import { isValidTimeZone } from '../_shared/metrics/calendar.ts'
import { recomputeSnapshot } from '../_shared/snapshot.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
  if (!token) return json(401, { error: 'missing_token' })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: u, error } = await admin.auth.getUser(token)
  if (error || !u?.user) return json(401, { error: 'invalid_token' })

  let body: { clientId?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    /* empty body */
  }
  const { data: caller } = await admin.from('profiles').select('role').eq('id', u.user.id).single()
  if (!caller) return json(403, { error: 'profile_not_found' })

  let clientId = u.user.id
  if (caller.role === 'trainer') {
    if (typeof body.clientId !== 'string') return json(400, { error: 'client_id_required' })
    const { data: rel } = await admin
      .from('trainer_client_relationships')
      .select('id')
      .eq('trainer_id', u.user.id)
      .eq('client_id', body.clientId)
      .eq('status', 'active')
      .maybeSingle()
    if (!rel) return json(403, { error: 'no_active_relationship' })
    clientId = body.clientId
  } else if (body.clientId !== undefined && body.clientId !== u.user.id) {
    return json(403, { error: 'forbidden' })
  }

  const { data: profile } = await admin.from('profiles').select('is_demo, time_zone').eq('id', clientId).single()
  if (!profile) return json(404, { error: 'not_found' })
  const { count } = await admin.from('health_samples').select('id', { count: 'exact', head: true }).eq('user_id', clientId)
  if (!count) return new Response(null, { status: 204, headers: cors })

  const tz = isValidTimeZone(profile.time_zone) ? profile.time_zone : 'UTC'
  try {
    const snap = await recomputeSnapshot(admin, clientId, tz, Date.now(), profile.is_demo ? 'demo' : 'healthkit')
    return json(200, { date: snap.date, completeness: snap.completeness })
  } catch {
    return json(500, { error: 'snapshot_failed' })
  }
})
