import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import i18n, { LANGUAGE_STORAGE_KEY, normalizeLanguage } from '@/i18n'
import { supabase, type Tables } from '@/lib/supabase'

export type Profile = Tables<'profiles'>

interface AuthState {
  session: Session | null
  profile: Profile | null
  /** true until the initial session + profile have been resolved */
  loading: boolean
  /** true while an intentional sign-out is in progress */
  signingOut: boolean
  profileError: unknown
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState<unknown>(null)

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null)
      return
    }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', s.user.id).single()
    if (error) {
      setProfileError(error)
      setProfile(null)
      return
    }
    setProfileError(null)
    setProfile(data)
    // The account's language preference wins over the browser default once signed in,
    // unless the user explicitly switched language on this device.
    let explicit: string | null = null
    try {
      explicit = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    } catch {
      /* ignore */
    }
    if (!explicit && normalizeLanguage(i18n.language) !== data.locale) void i18n.changeLanguage(data.locale)
  }, [])

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      await loadProfile(data.session)
      if (active) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'SIGNED_OUT') {
        // Defer to avoid calling Supabase inside the auth callback (documented deadlock).
        window.setTimeout(() => void loadProfile(s), 0)
      }
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const refreshProfile = useCallback(() => loadProfile(session), [loadProfile, session])
  const [signingOut, setSigningOut] = useState(false)
  const signOut = useCallback(async () => {
    setSigningOut(true)
    try {
      await supabase.removeAllChannels()
      await supabase.auth.signOut()
      setProfile(null)
    } finally {
      setSigningOut(false)
    }
  }, [])

  const value = useMemo(
    () => ({ session, profile, loading, signingOut, profileError, refreshProfile, signOut }),
    [session, profile, loading, signingOut, profileError, refreshProfile, signOut],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}

/** Profile is guaranteed inside role-guarded routes. */
export function useProfile(): Profile {
  const { profile } = useAuth()
  if (!profile) throw new Error('useProfile used outside a guarded route')
  return profile
}
