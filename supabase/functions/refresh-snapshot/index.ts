/**
 * POST /functions/v1/refresh-snapshot
 * Recomputes the caller's own daily health snapshot (e.g. right after a check-in, so the
 * subjective answers feed into readiness). Authenticated; a user can only refresh themselves.
 * No-op (204) if the user has never synced health data.
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

  const { data: profile } = await admin.from('profiles').select('role, is_demo, time_zone').eq('id', u.user.id).single()
  if (!profile || profile.role !== 'client') return json(403, { error: 'only_clients' })

  const { count } = await admin.from('health_samples').select('id', { count: 'exact', head: true }).eq('user_id', u.user.id)
  if (!count) return new Response(null, { status: 204, headers: cors })

  const tz = isValidTimeZone(profile.time_zone) ? profile.time_zone : 'UTC'
  try {
    const snap = await recomputeSnapshot(admin, u.user.id, tz, Date.now(), profile.is_demo ? 'demo' : 'healthkit')
    return json(200, snap)
  } catch {
    return json(500, { error: 'snapshot_failed' })
  }
})
