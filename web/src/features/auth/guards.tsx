import { Navigate, Outlet, useLocation } from 'react-router'
import { FullPageLoader } from '@/components/layout/FullPageLoader'
import { ErrorNotice } from '@/components/ui/ErrorNotice'
import type { Enums } from '@/lib/supabase'
import { useAuth } from './AuthProvider'

export const homeFor = (role: Enums<'user_role'>) => (role === 'trainer' ? '/trainer' : '/client')

/**
 * Route guard. UX only — every query is also restricted by RLS in Postgres,
 * so a user who bypasses this guard still cannot read or write other data.
 */
export function RequireRole({ role }: { role: Enums<'user_role'> }) {
  const { session, profile, loading, signingOut, profileError, refreshProfile } = useAuth()
  const location = useLocation()
  if (signingOut) return <Navigate to="/" replace />
  if (loading || (session && !profile && !profileError)) return <FullPageLoader />
  if (!session) return <Navigate to={`/auth/${role}?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (profileError || !profile)
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorNotice error={profileError} onRetry={() => void refreshProfile()} />
      </div>
    )
  if (profile.role !== role) return <Navigate to={homeFor(profile.role)} replace state={{ wrongPortal: profile.role }} />
  return <Outlet />
}
