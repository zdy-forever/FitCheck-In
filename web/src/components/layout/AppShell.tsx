import { clsx } from 'clsx'
import {
  Activity,
  CalendarDays,
  ClipboardCheck,
  FlaskConical,
  History,
  LayoutDashboard,
  LogOut,
  Mail,
  Settings,
  Users,
  WifiOff,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useEffect } from 'react'
import { useAuth, useProfile } from '@/features/auth/AuthProvider'
import { useOnline } from '@/hooks/useOnline'
import { useToast } from '@/components/ui/Toast'
import { Wordmark } from './Logo'
import { LanguageSwitcher, ThemeSwitcher } from './Preferences'

interface Item {
  to: string
  label: string
  Icon: typeof Users
  end?: boolean
}

export function AppShell() {
  const { t } = useTranslation()
  const profile = useProfile()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const online = useOnline()
  const toast = useToast()

  useEffect(() => {
    const wrong = (location.state as { wrongPortal?: string } | null)?.wrongPortal
    if (wrong) {
      toast.info(t('auth.wrongPortal', { actual: t(`auth.${wrong}`) }))
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location.state, location.pathname, navigate, t, toast])

  const items: Item[] =
    profile.role === 'trainer'
      ? [
          { to: '/trainer', label: t('nav.dashboard'), Icon: LayoutDashboard, end: true },
          { to: '/trainer/clients', label: t('nav.clients'), Icon: Users },
          { to: '/trainer/sessions', label: t('nav.sessions'), Icon: CalendarDays },
          { to: '/trainer/invitations', label: t('nav.invitations'), Icon: Mail },
          { to: '/trainer/settings', label: t('nav.settings'), Icon: Settings },
        ]
      : [
          { to: '/client', label: t('nav.dashboard'), Icon: LayoutDashboard, end: true },
          { to: '/client/check-in', label: t('nav.checkIn'), Icon: ClipboardCheck },
          { to: '/client/history', label: t('nav.history'), Icon: History },
          { to: '/client/health', label: t('nav.health'), Icon: Activity },
          { to: '/client/settings', label: t('nav.settings'), Icon: Settings },
        ]

  const doSignOut = async () => {
    // While signingOut is true the route guard sends us to "/" (not the sign-in page).
    await signOut()
    toast.info(t('auth.signedOut'))
  }

  return (
    <div className="min-h-dvh">
      <div className="ambient" aria-hidden />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-xl focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-contrast">
        {t('common.skipToContent')}
      </a>

      {/* Top glass bar */}
      <header className="sticky top-0 z-40 px-3 pt-3 sm:px-5">
        <div className="glass mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 rounded-[22px] pl-4 pr-2">
          <Link to={profile.role === 'trainer' ? '/trainer' : '/client'} aria-label={t('a11y.home')} className="shrink-0">
            <Wordmark />
          </Link>
          <nav className="hidden items-center gap-1 lg:flex" aria-label={t('a11y.primaryNav')}>
            {items.map(({ to, label, Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => clsx('group relative flex h-10 items-center gap-2 rounded-full px-3.5 text-sm font-medium transition-colors', isActive ? 'text-ink' : 'text-ink-3 hover:bg-sunken/70 hover:text-ink')}>
                {({ isActive }) => (
                  <>
                    {isActive && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-full bg-surface-strong shadow-sm" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                    <Icon className="pop-icon relative size-4" aria-hidden />
                    <span className="relative">{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-0.5">
            {profile.is_demo && (
              <span className="mr-1 hidden items-center gap-1 rounded-full bg-demo-soft px-2.5 py-1 text-xs font-semibold text-demo sm:inline-flex" title={t('common.demoDataLong')}>
                <FlaskConical className="size-3.5" aria-hidden />
                {t('common.demoData')}
              </span>
            )}
            <LanguageSwitcher />
            <ThemeSwitcher />
            <span className="mx-1 hidden max-w-36 truncate text-sm text-ink-2 md:inline" title={profile.display_name}>
              {profile.display_name}
            </span>
            <button type="button" onClick={() => void doSignOut()} className="grid size-10 place-items-center rounded-full text-ink-2 hover:bg-sunken hover:text-ink" aria-label={t('nav.signOut')} title={t('nav.signOut')} data-testid="sign-out">
              <LogOut className="size-[18px]" aria-hidden />
            </button>
          </div>
        </div>
        {profile.is_demo && (
          <p className="mx-auto mt-2 flex max-w-7xl items-center justify-center gap-1.5 rounded-xl bg-demo-soft px-3 py-1.5 text-center text-xs font-medium text-demo sm:hidden">
            <FlaskConical className="size-3.5" aria-hidden />
            {t('common.demoDataLong')}
          </p>
        )}
        {!online && (
          <p role="status" className="mx-auto mt-2 flex max-w-7xl items-center justify-center gap-2 rounded-xl bg-warn-soft px-3 py-2 text-sm font-medium text-warn">
            <WifiOff className="size-4" aria-hidden />
            {t('errors.offline')}
          </p>
        )}
      </header>

      <main id="main" className="mx-auto max-w-7xl px-4 pb-32 pt-6 sm:px-6 sm:pt-10 lg:pb-16">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={location.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mobile floating tab bar */}
      <nav className="fixed inset-x-3 bottom-3 z-40 lg:hidden" aria-label={t('a11y.primaryNav')}>
        <div className="glass-strong mx-auto flex max-w-md items-stretch justify-between rounded-[26px] p-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))]">
          {items.map(({ to, label, Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => clsx('relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-[20px] text-2xs font-medium transition-[color,transform] duration-200 active:scale-90', isActive ? 'text-accent' : 'text-ink-3')}>
              {({ isActive }) => (
                <>
                  {isActive && <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-[20px] bg-accent-soft" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                  <Icon className="relative size-5" aria-hidden />
                  <span className="relative max-w-full truncate px-1">{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
