import { clsx } from 'clsx'
import { ArrowLeft, Copy, Dumbbell, FlaskConical, LogIn, User } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import * as z from 'zod/mini'
import { Wordmark } from '@/components/layout/Logo'
import { LanguageSwitcher, ThemeSwitcher } from '@/components/layout/Preferences'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/features/auth/AuthProvider'
import { homeFor } from '@/features/auth/guards'
import { normalizeLanguage } from '@/i18n'
import { env, isConfigured } from '@/lib/env'
import { errorKey } from '@/lib/errors'
import { browserTimeZone } from '@/lib/format'
import { supabase, type Enums } from '@/lib/supabase'

type Role = Enums<'user_role'>

function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="relative flex min-h-dvh flex-col">
      <div className="ambient" aria-hidden />
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <Link to="/" aria-label={t('a11y.home')}>
          <Wordmark />
        </Link>
        <div className="flex items-center">
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center sm:pt-0">
        {children}
      </main>
    </div>
  )
}

function NotConfigured() {
  const { t } = useTranslation()
  return isConfigured ? null : <p className="mb-4 rounded-2xl bg-warn-soft p-3 text-sm text-warn">{t('errors.notConfigured')}</p>
}

/** /auth — choose trainer or client portal. */
export function ChooseRolePage() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const [params] = useSearchParams()
  if (profile) return <Navigate to={homeFor(profile.role)} replace />
  const qs = params.toString() ? `?${params.toString()}` : ''
  const roles: { role: Role; Icon: typeof User; desc: string }[] = [
    { role: 'trainer', Icon: Dumbbell, desc: t('auth.trainerDesc') },
    { role: 'client', Icon: User, desc: t('auth.clientDesc') },
  ]
  return (
    <AuthLayout>
      <div className="w-full max-w-2xl">
        <NotConfigured />
        <h1 className="mb-8 text-center font-display text-4xl font-semibold tracking-tight text-ink">{t('auth.chooseRole')}</h1>
        <div className="grid gap-4 sm:grid-cols-2">
          {roles.map(({ role, Icon, desc }, i) => (
            <motion.div key={role} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
              <Link to={`/auth/${role}${qs}`} className="glass group lift flex h-full flex-col gap-4 rounded-[28px] p-7" data-testid={`portal-${role}`}>
                <div className="pop-icon grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent">
                  <Icon className="size-7" aria-hidden />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-ink">{t(role === 'trainer' ? 'nav.trainerPortal' : 'nav.clientPortal')}</h2>
                  <p className="mt-1 text-ink-2">{desc}</p>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
        {env.demoMode && <DemoBox autoOpen={params.get('demo') === '1'} />}
      </div>
    </AuthLayout>
  )
}

/** /auth/:role — sign in / sign up for one portal. */
export function RoleAuthPage() {
  const { t, i18n } = useTranslation()
  const { role: roleParam } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { profile, loading: authLoading } = useAuth()
  const role: Role | null = roleParam === 'trainer' || roleParam === 'client' ? roleParam : null
  const mode = params.get('mode') === 'signup' ? 'signup' : 'signin'
  const next = params.get('next')

  const [email, setEmail] = useState(params.get('email') ?? '')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Redirect once the profile (role from the DATABASE) is known.
  useEffect(() => {
    if (authLoading || !profile) return
    if (profile.role !== role) {
      toast.info(t('auth.wrongPortal', { actual: t(`auth.${profile.role}`) }))
      navigate(homeFor(profile.role), { replace: true })
      return
    }
    const safeNext = next && next.startsWith(`/${profile.role === 'trainer' ? 'trainer' : 'client'}`) ? next : null
    const invite = sessionStorage.getItem('fitcheckin.pendingInvite')
    navigate(invite && profile.role === 'client' ? `/client/join?code=${invite}` : (safeNext ?? homeFor(profile.role)), { replace: true })
  }, [profile, authLoading, role, next, navigate, t, toast])

  if (!role) return <Navigate to="/auth" replace />

  const schema = z.object({
    email: z.string().check(z.trim(), z.email(t('validation.email'))),
    password: z.string().check(z.minLength(8, t('validation.passwordMin'))),
    name: mode === 'signup' ? z.string().check(z.trim(), z.minLength(1, t('validation.nameLength')), z.maxLength(80, t('validation.nameLength'))) : z.optional(z.string()),
  })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    const parsed = schema.safeParse({ email, password, name })
    if (!parsed.success) {
      const errs: Record<string, string> = {}
      for (const issue of parsed.error.issues) errs[String(issue.path[0])] ??= issue.message
      setErrors(errs)
      setFormError(t('validation.fixErrors'))
      return
    }
    setErrors({})
    setSubmitting(true)
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: parsed.data.email,
          password: parsed.data.password,
          options: {
            data: { role, display_name: parsed.data.name, locale: normalizeLanguage(i18n.language), time_zone: browserTimeZone() },
            emailRedirectTo: `${window.location.origin}/auth/${role}`,
          },
        })
        if (error) throw error
        if (!data.session) toast.info(t('auth.checkEmail'))
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password })
        if (error) throw error
      }
    } catch (err) {
      setFormError(t(errorKey(err)))
    } finally {
      setSubmitting(false)
    }
  }

  const switchMode = () => {
    const p = new URLSearchParams(params)
    if (mode === 'signup') p.delete('mode')
    else p.set('mode', 'signup')
    setParams(p, { replace: true })
    setErrors({})
    setFormError(null)
  }

  const portal = t(role === 'trainer' ? 'nav.trainerPortal' : 'nav.clientPortal')
  return (
    <AuthLayout>
      <motion.div key={`${role}-${mode}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <Link to="/auth" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden />
          {t('auth.chooseRole')}
        </Link>
        <div className="glass-strong rounded-[32px] p-6 sm:p-8">
          <NotConfigured />
          <div className="mb-6 flex items-center gap-3">
            <div className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">
              {role === 'trainer' ? <Dumbbell className="size-6" aria-hidden /> : <User className="size-6" aria-hidden />}
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-ink">{mode === 'signup' ? t('auth.signUpTitle') : t('auth.signInTitle')}</h1>
              <p className="text-sm text-ink-3">{mode === 'signup' ? t('auth.signUpSubtitle', { role: t(`auth.${role}`) }) : t('auth.signInSubtitle', { portal })}</p>
            </div>
          </div>
          {sessionStorage.getItem('fitcheckin.pendingInvite') && role === 'client' && <p className="mb-4 rounded-2xl bg-accent-soft p-3 text-sm text-accent">{t('auth.acceptInviteAfter')}</p>}
          <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4" data-testid="auth-form">
            {mode === 'signup' && <TextField label={t('auth.displayName')} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} autoComplete="name" maxLength={80} />}
            <TextField label={t('auth.email')} type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} autoComplete="email" />
            <TextField
              label={t('auth.password')}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
              hint={mode === 'signup' ? t('auth.passwordHint') : undefined}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
            {formError && (
              <p role="alert" className="rounded-xl bg-bad-soft px-3 py-2.5 text-sm font-medium text-bad" data-testid="form-error">
                {formError}
              </p>
            )}
            <Button type="submit" size="lg" loading={submitting} className="mt-1 w-full" icon={<LogIn className="size-5" aria-hidden />}>
              {submitting ? (mode === 'signup' ? t('auth.signingUp') : t('auth.signingIn')) : mode === 'signup' ? t('auth.signUp') : t('auth.signIn')}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-ink-3">
            {mode === 'signup' ? t('auth.haveAccount') : t('auth.noAccount')}{' '}
            <button type="button" onClick={switchMode} className="font-semibold text-accent hover:underline">
              {mode === 'signup' ? t('auth.switchToSignIn') : t('auth.switchToSignUp')}
            </button>
          </p>
        </div>
      </motion.div>
    </AuthLayout>
  )
}

interface DemoCreds {
  trainer: { email: string; password: string }
  client: { email: string; password: string }
}

function DemoBox({ autoOpen }: { autoOpen: boolean }) {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const [creds, setCreds] = useState<DemoCreds | null>(() => {
    try {
      const v = sessionStorage.getItem('fitcheckin.demo')
      return v ? (JSON.parse(v) as DemoCreds) : null
    } catch {
      return null
    }
  })
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    setCreating(true)
    setError(null)
    try {
      const { data, error: fnErr } = await supabase.functions.invoke<DemoCreds & { error?: string }>('demo-session', {
        body: { locale: normalizeLanguage(i18n.language), timeZone: browserTimeZone() },
      })
      if (fnErr || !data || data.error) throw new Error(data?.error ?? 'demo_failed')
      setCreds(data)
      sessionStorage.setItem('fitcheckin.demo', JSON.stringify(data))
    } catch (e) {
      setError(t(errorKey(e)))
    } finally {
      setCreating(false)
    }
  }

  const signInAs = async (which: 'trainer' | 'client') => {
    if (!creds) return
    const { error: err } = await supabase.auth.signInWithPassword(creds[which])
    if (err) toast.error(t(errorKey(err)))
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('common.copied'))
    } catch {
      /* clipboard denied */
    }
  }

  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className={clsx('mt-6 rounded-[28px] border border-dashed border-demo/40 bg-demo-soft p-6', autoOpen && 'ring-4 ring-demo/20')} aria-labelledby="demo-title">
      <div className="flex items-start gap-3">
        <FlaskConical className="mt-0.5 size-6 shrink-0 text-demo" aria-hidden />
        <div className="flex-1">
          <h2 id="demo-title" className="font-semibold text-ink">
            {t('auth.demo.title')}
          </h2>
          <p className="mt-1 text-sm text-ink-2">{t('auth.demo.body')}</p>
          {!creds ? (
            <Button className="mt-4" variant="secondary" loading={creating} onClick={() => void create()} data-testid="create-demo">
              {creating ? t('auth.demo.creating') : t('auth.demo.button')}
            </Button>
          ) : (
            <div className="mt-4 space-y-3" data-testid="demo-ready">
              <p className="text-sm font-semibold text-demo">{t('auth.demo.ready')}</p>
              {(['trainer', 'client'] as const).map((which) => (
                <div key={which} className="grid gap-2 rounded-2xl bg-surface-strong p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-ink-3">
                      {t(`auth.demo.${which}Login`)}
                      <button type="button" onClick={() => void copy(`${creds[which].email}\n${creds[which].password}`)} className="grid size-7 place-items-center rounded-lg hover:bg-sunken" aria-label={t('common.copy')}>
                        <Copy className="size-3.5" />
                      </button>
                    </div>
                    <code className="block truncate text-sm text-ink">{creds[which].email}</code>
                    <code className="block truncate text-xs text-ink-3">{creds[which].password}</code>
                  </div>
                  <Button size="sm" className="w-full sm:w-auto" onClick={() => void signInAs(which)} data-testid={`demo-signin-${which}`}>
                    {t(which === 'trainer' ? 'auth.demo.useTrainer' : 'auth.demo.useClient')}
                  </Button>
                </div>
              ))}
              <p className="text-xs text-ink-3">{t('auth.demo.tip')}</p>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm font-medium text-bad">
              {error}
            </p>
          )}
        </div>
      </div>
    </motion.section>
  )
}

/** After any successful sign-in on /auth, route by DB role. */
export function AuthRedirect() {
  const { profile } = useAuth()
  return profile ? <Navigate to={homeFor(profile.role)} replace /> : null
}
