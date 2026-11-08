/**
 * Maps Supabase/Postgres/network errors to i18n keys under `errors.*`.
 * Raw server messages are never shown to users (they can leak internals).
 */
const KNOWN = new Set([
  'invitation_not_found',
  'invitation_not_pending',
  'invitation_expired',
  'invitation_email_mismatch',
  'only_clients_can_accept',
  'demo_mismatch',
  'no_active_relationship',
  'session_mismatch',
  'checkin_not_found',
  'relationship_not_found',
  'role_required',
  'invalid_time_zone',
  'demo_account_protected',
  'demo_disabled',
])

export function errorKey(err: unknown): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'errors.offline'
  if (!err) return 'errors.generic'
  const e = err as { message?: string; code?: string; status?: number; name?: string }
  const msg = (e.message ?? '').trim()
  if (KNOWN.has(msg)) return `errors.${msg}`
  if (/invalid login credentials/i.test(msg)) return 'errors.invalidCredentials'
  if (/user already registered|already been registered/i.test(msg)) return 'errors.emailTaken'
  if (/password should be|weak password/i.test(msg)) return 'errors.weakPassword'
  if (/email not confirmed/i.test(msg)) return 'errors.emailNotConfirmed'
  if (/rate limit/i.test(msg) || e.status === 429) return 'errors.rateLimited'
  if (/failed to fetch|networkerror|load failed/i.test(msg) || e.name === 'TypeError') return 'errors.network'
  if (e.code === '42501' || e.status === 401 || e.status === 403) return 'errors.forbidden'
  if (e.code === '23514' || e.code === '22023') return 'errors.validation'
  if (e.code === 'PGRST116') return 'errors.notFound'
  return 'errors.generic'
}
