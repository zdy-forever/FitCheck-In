import { ArrowLeft } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { Wordmark } from '@/components/layout/Logo'
import { LanguageSwitcher, ThemeSwitcher } from '@/components/layout/Preferences'
import { buttonClass } from '@/components/ui/Button'
import { useAuth } from '@/features/auth/AuthProvider'
import { useFormatters } from '@/lib/format'

/** Public /invite/:code landing — stores the code and routes to client auth. */
export function InviteLanding() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const code = window.location.pathname.split('/').pop() ?? ''
  useEffect(() => {
    if (profile?.role === 'client') navigate(`/client/join?code=${code}`, { replace: true })
    else {
      sessionStorage.setItem('fitcheckin.pendingInvite', code)
      navigate('/auth/client?mode=signup', { replace: true })
    }
  }, [profile, code, navigate])
  return null
}

export function PrivacyPage() {
  const { t, i18n } = useTranslation()
  const f = useFormatters(i18n.language)
  const sections = t('privacy.sections', { returnObjects: true }) as { h: string; p: string }[]
  return (
    <div className="relative min-h-dvh">
      <div className="ambient" aria-hidden />
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <Link to="/">
          <Wordmark />
        </Link>
        <div className="flex">
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl px-4 pb-20">
        <Link to="/" className="mb-6 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden />
          {t('common.back')}
        </Link>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-ink">{t('privacy.title')}</h1>
        <p className="mt-2 text-sm text-ink-3">{t('privacy.updated', { date: f.date('2026-11-08') })}</p>
        <div className="card mt-8 space-y-6 p-6 sm:p-8">
          {sections.map((s) => (
            <section key={s.h}>
              <h2 className="text-lg font-semibold text-ink">{s.h}</h2>
              <p className="mt-1.5 leading-relaxed text-ink-2">{s.p}</p>
            </section>
          ))}
        </div>
      </main>
    </div>
  )
}

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="ambient" aria-hidden />
      <div className="text-center">
        <p className="font-display text-7xl font-semibold text-accent">404</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">{t('errors.pageNotFound')}</h1>
        <p className="mt-1 text-ink-3">{t('errors.pageNotFoundBody')}</p>
        <Link to="/" className={buttonClass('primary', 'md', 'mt-6')}>
          {t('errors.goHome')}
        </Link>
      </div>
    </div>
  )
}
