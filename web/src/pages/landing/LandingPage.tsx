import {
  ArrowRight,
  BedDouble,
  ChevronDown,
  ClipboardCheck,
  FlaskConical,
  HeartPulse,
  History,
  LayoutDashboard,
  MessagesSquare,
  ShieldCheck,
  Smartphone,
  EyeOff,
  Watch,
  Activity,
  NotebookPen,
  Menu,
  X,
} from 'lucide-react'
import { motion, useReducedMotion, useScroll, useTransform, type Variants } from 'motion/react'
import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Wordmark } from '@/components/layout/Logo'
import { LanguageSwitcher, ThemeSwitcher } from '@/components/layout/Preferences'
import { buttonClass } from '@/components/ui/Button'
import { useAuth } from '@/features/auth/AuthProvider'
import { homeFor } from '@/features/auth/guards'
import { env } from '@/lib/env'
import { useSpotlight } from '@/hooks/useSpotlight'
import { DashboardPreview } from './DashboardPreview'

const reveal: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } },
}

function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div className={className} variants={reveal} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-80px' }} transition={{ delay }}>
      {children}
    </motion.div>
  )
}

/** Card with a pointer-following spotlight. */
function SpotCard({ className, children }: { className?: string; children: ReactNode }) {
  const spot = useSpotlight<HTMLDivElement>()
  return (
    <div className={`spotlight ${className ?? ''}`} {...spot}>
      {children}
    </div>
  )
}

function SectionHead({ kicker, title, body, center = true }: { kicker: string; title: string; body?: string; center?: boolean }) {
  return (
    <Reveal className={center ? 'mx-auto max-w-3xl text-center' : 'max-w-xl'}>
      <p className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-accent">{kicker}</p>
      <h2 className="font-display text-5xl font-semibold tracking-tight text-ink">{title}</h2>
      {body && <p className="mt-5 text-lg leading-relaxed text-ink-2">{body}</p>}
    </Reveal>
  )
}

function LandingNav() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const links = [
    { href: '#features', label: t('nav.features') },
    { href: '#how', label: t('nav.howItWorks') },
    { href: '#health', label: t('nav.appleHealth') },
  ]
  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5">
      <div className="glass mx-auto flex h-16 max-w-6xl items-center justify-between rounded-[22px] pl-4 pr-2">
        <Link to="/" aria-label={t('a11y.home')}>
          <Wordmark />
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label={t('a11y.sections')}>
          {links.map((l) => (
            <a key={l.href} href={l.href} className="rounded-full px-3.5 py-2 text-sm font-medium text-ink-2 transition hover:bg-sunken hover:text-ink">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-0.5">
          <LanguageSwitcher />
          <ThemeSwitcher />
          <span className="ml-1 hidden sm:block">
            <Link to={profile ? homeFor(profile.role) : '/auth'} className={buttonClass('primary', 'sm')}>
              {profile ? t('nav.dashboard') : t('nav.signIn')}
            </Link>
          </span>
          <button type="button" className="grid size-10 place-items-center rounded-full text-ink-2 md:hidden" aria-label={t('nav.menu')} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>
      {open && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="glass-strong mx-auto mt-2 flex max-w-6xl flex-col gap-1 rounded-[22px] p-2 md:hidden">
          {links.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="rounded-xl px-4 py-3 font-medium text-ink hover:bg-sunken">
              {l.label}
            </a>
          ))}
          <Link to={profile ? homeFor(profile.role) : '/auth'} className={buttonClass('primary', 'md', 'mt-1')}>
            {profile ? t('nav.dashboard') : t('nav.signIn')}
          </Link>
        </motion.div>
      )}
    </header>
  )
}

function Hero() {
  const { t } = useTranslation()
  const ref = useRef<HTMLElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const textY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -80])
  const textOpacity = useTransform(scrollYProgress, [0, 0.6], [1, reduce ? 1 : 0])
  const previewY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -160])
  const previewRotate = useTransform(scrollYProgress, [0, 1], [reduce ? 0 : 8, 0])
  const orbY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 120])

  const words1 = t('landing.heroTitle1')
  const words2 = t('landing.heroTitle2')

  return (
    <section ref={ref} className="relative isolate flex min-h-[100svh] flex-col items-center overflow-hidden px-4 pt-32 sm:pt-36">
      {/* Aurora */}
      <motion.div style={{ y: orbY }} className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
        <div className="orb orb-a left-[-10%] top-[-10%] h-[55vmax] w-[55vmax] bg-[radial-gradient(circle,var(--glow-1),transparent_65%)]" />
        <div className="orb orb-b right-[-15%] top-[5%] h-[50vmax] w-[50vmax] bg-[radial-gradient(circle,var(--glow-2),transparent_65%)]" />
        <div className="orb orb-a bottom-[-25%] left-[20%] h-[45vmax] w-[45vmax] bg-[radial-gradient(circle,var(--glow-3),transparent_65%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_60%,var(--bg))]" />
      </motion.div>

      <motion.div style={{ y: textY, opacity: textOpacity }} className="mx-auto flex max-w-4xl flex-col items-center text-center">
        <motion.span initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="glass mb-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium text-ink-2">
          <HeartPulse className="size-4 text-accent" aria-hidden />
          {t('landing.eyebrow')}
        </motion.span>
        <h1 className="font-display text-7xl font-semibold tracking-[-0.035em] text-ink">
          <motion.span className="block" initial={{ opacity: 0, y: 30, filter: 'blur(8px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}>
            {words1}
          </motion.span>
          <motion.span
            className="block bg-gradient-to-r from-[#0a84a6] via-[#38bdf8] to-[#8b5cf6] bg-clip-text pb-2 text-transparent dark:from-[#3cc3e6] dark:via-[#7dd3fc] dark:to-[#a78bfa]"
            initial={{ opacity: 0, y: 30, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.18 }}
          >
            {words2}
          </motion.span>
        </h1>
        <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.35 }} className="mt-6 max-w-2xl text-xl leading-relaxed text-ink-2">
          {t('landing.heroSubtitle')}
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.5 }} className="mt-9 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
          <Link to="/auth?mode=signup" className={buttonClass('primary', 'lg', 'group w-full sm:w-auto')} data-testid="hero-start">
            {t('landing.ctaStart')}
            <ArrowRight className="size-5 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
          <a href="#problem" className={buttonClass('glass', 'lg', 'w-full sm:w-auto')}>
            {t('landing.ctaLearn')}
            <ChevronDown className="size-5" aria-hidden />
          </a>
        </motion.div>
        {env.demoMode && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}>
            <Link to="/auth?demo=1" className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 underline-offset-4 hover:text-accent hover:underline">
              <FlaskConical className="size-4" aria-hidden />
              {t('landing.ctaDemo')}
            </Link>
          </motion.div>
        )}
      </motion.div>

      <motion.div style={{ y: previewY, rotateX: previewRotate, transformPerspective: 1400 }} initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.1, delay: 0.55, ease: [0.22, 1, 0.36, 1] }} className="mt-14 w-full max-w-5xl pb-10 sm:mt-16">
        <DashboardPreview />
      </motion.div>
    </section>
  )
}

export function LandingPage() {
  const { t } = useTranslation()
  const year = new Date().getFullYear()

  const problems = [
    { Icon: MessagesSquare, key: 'scattered' },
    { Icon: EyeOff, key: 'invisible' },
    { Icon: History, key: 'noHistory' },
  ] as const
  const features = [
    { Icon: ClipboardCheck, key: 'checkin' },
    { Icon: HeartPulse, key: 'health' },
    { Icon: LayoutDashboard, key: 'dashboard' },
    { Icon: NotebookPen, key: 'history' },
  ] as const
  const steps = [
    { Icon: Smartphone, key: 'step1' },
    { Icon: Watch, key: 'step2' },
    { Icon: LayoutDashboard, key: 'step3' },
    { Icon: NotebookPen, key: 'step4' },
  ] as const

  return (
    <div className="relative">
      <div className="ambient" aria-hidden />
      <LandingNav />
      <main>
        <Hero />

        {/* Problem */}
        <section id="problem" className="scroll-mt-24 px-4 py-24 sm:py-32">
          <SectionHead kicker={t('landing.problem.kicker')} title={t('landing.problem.title')} body={t('landing.problem.body')} />
          <div className="mx-auto mt-14 grid max-w-6xl gap-4 md:grid-cols-3">
            {problems.map(({ Icon, key }, i) => (
              <Reveal key={key} delay={i * 0.08}>
                <div className="group card lift h-full p-7">
                  <Icon className="pop-icon mb-5 size-7 text-ink-3 transition-colors group-hover:text-accent" aria-hidden />
                  <h3 className="text-lg font-semibold text-ink">{t(`landing.problem.items.${key}.title`)}</h3>
                  <p className="mt-2 text-ink-2">{t(`landing.problem.items.${key}.body`)}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Solution + features */}
        <section id="features" className="scroll-mt-24 px-4 py-24 sm:py-32">
          <SectionHead kicker={t('landing.solution.kicker')} title={t('landing.solution.title')} body={t('landing.solution.body')} />
          <div className="mx-auto mt-14 grid max-w-6xl gap-4 sm:grid-cols-2">
            {features.map(({ Icon, key }, i) => (
              <Reveal key={key} delay={i * 0.06}>
                <SpotCard className="group card lift relative h-full overflow-hidden p-7 sm:p-8">
                  <div className="absolute -right-16 -top-16 size-48 rounded-full bg-[radial-gradient(circle,var(--glow-1),transparent_70%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100" aria-hidden />
                  <div className="pop-icon relative mb-5 grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">
                    <Icon className="size-6" aria-hidden />
                  </div>
                  <h3 className="relative text-xl font-semibold text-ink">{t(`landing.features.${key}.title`)}</h3>
                  <p className="relative mt-2 text-ink-2">{t(`landing.features.${key}.body`)}</p>
                </SpotCard>
              </Reveal>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-24 px-4 py-24 sm:py-32">
          <SectionHead kicker={t('landing.how.kicker')} title={t('landing.how.title')} />
          <ol className="relative mx-auto mt-16 grid max-w-6xl gap-4 md:grid-cols-4">
            <div className="absolute left-0 right-0 top-8 hidden h-px bg-gradient-to-r from-transparent via-line-strong to-transparent md:block" aria-hidden />
            {steps.map(({ Icon, key }, i) => (
              <Reveal key={key} delay={i * 0.1}>
                <li className="group relative flex flex-col items-center text-center md:px-2">
                  <div className="pop-icon glass relative z-10 mb-5 grid size-16 place-items-center rounded-[22px] text-accent">
                    <Icon className="size-7" aria-hidden />
                    <span className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-accent text-xs font-bold text-accent-contrast">{i + 1}</span>
                  </div>
                  <h3 className="font-semibold text-ink">{t(`landing.how.${key}.title`)}</h3>
                  <p className="mt-1.5 text-sm text-ink-2">{t(`landing.how.${key}.body`)}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </section>

        {/* Apple Health */}
        <section id="health" className="scroll-mt-24 px-4 py-24 sm:py-32">
          <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
            <div>
              <SectionHead center={false} kicker={t('landing.healthSection.kicker')} title={t('landing.healthSection.title')} body={t('landing.healthSection.body')} />
              <Reveal delay={0.1}>
                <p className="mt-6 flex items-start gap-2 rounded-2xl bg-sunken p-4 text-sm text-ink-2">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                  {t('landing.healthSection.note')}
                </p>
              </Reveal>
            </div>
            <div className="grid gap-3">
              {[
                { Icon: HeartPulse, label: t('landing.healthSection.hrv'), value: '54', unit: 'ms', delta: '+6%', color: 'var(--series-1)' },
                { Icon: Activity, label: t('landing.healthSection.rhr'), value: '56', unit: 'bpm', delta: '−1', color: 'var(--series-2)' },
                { Icon: BedDouble, label: t('landing.healthSection.sleep'), value: '7.4', unit: 'h', delta: '+0.3 h', color: 'var(--series-3)' },
              ].map(({ Icon, label, value, unit, delta, color }, i) => (
                <Reveal key={label} delay={i * 0.1}>
                  <div className="group glass lift flex items-center gap-4 rounded-3xl p-5">
                    <div className="grid size-12 place-items-center rounded-2xl bg-surface-strong shadow-sm">
                      <Icon className="size-6" style={{ color }} aria-hidden />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm text-ink-2">{label}</div>
                      <div className="font-display text-3xl font-semibold tabular text-ink">
                        {value} <span className="text-base font-normal text-ink-3">{unit}</span>
                      </div>
                    </div>
                    <span className="rounded-full bg-sunken px-2.5 py-1 text-xs font-medium tabular text-ink-2">
                      {delta} {t('health.vsBaseline')}
                    </span>
                  </div>
                </Reveal>
              ))}
              <p className="px-2 text-xs text-ink-3">{t('landing.previewLabel')}</p>
            </div>
          </div>
        </section>

        {/* Dashboard preview */}
        <section className="px-4 py-24 sm:py-32">
          <SectionHead kicker={t('landing.previewSection.kicker')} title={t('landing.previewSection.title')} />
          <Reveal className="mx-auto mt-14 max-w-5xl">
            <DashboardPreview />
          </Reveal>
        </section>

        {/* Final CTA */}
        <section className="px-4 pb-24 pt-8 sm:pb-32">
          <Reveal className="glass-strong relative mx-auto max-w-5xl overflow-hidden rounded-[36px] px-6 py-16 text-center sm:px-16 sm:py-20">
            <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_80%_at_50%_0%,var(--glow-1),transparent)]" aria-hidden />
            <h2 className="font-display text-5xl font-semibold tracking-tight text-ink">{t('landing.finalCta.title')}</h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-ink-2">{t('landing.finalCta.body')}</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link to="/auth/trainer?mode=signup" className={buttonClass('primary', 'lg')}>
                {t('auth.trainer')} · {t('auth.signUp')}
              </Link>
              <Link to="/auth/client?mode=signup" className={buttonClass('glass', 'lg')}>
                {t('auth.client')} · {t('auth.signUp')}
              </Link>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-line px-4 py-12">
        <div className="mx-auto grid max-w-6xl gap-10 sm:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <Wordmark />
            <p className="mt-3 max-w-xs text-sm text-ink-3">{t('brand.tagline')}</p>
          </div>
          <div>
            <h3 className="mb-3 text-sm font-semibold text-ink">{t('landing.footer.product')}</h3>
            <ul className="space-y-2 text-sm text-ink-2">
              <li>
                <a href="#features" className="transition-colors hover:text-accent">
                  {t('nav.features')}
                </a>
              </li>
              <li>
                <a href="#how" className="transition-colors hover:text-accent">
                  {t('nav.howItWorks')}
                </a>
              </li>
              <li>
                <a href="#health" className="transition-colors hover:text-accent">
                  {t('nav.appleHealth')}
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="mb-3 text-sm font-semibold text-ink">{t('landing.footer.legal')}</h3>
            <ul className="space-y-2 text-sm text-ink-2">
              <li>
                <Link to="/privacy" className="transition-colors hover:text-accent">
                  {t('landing.footer.privacy')}
                </Link>
              </li>
              <li>
                <span className="text-ink-3">{t('landing.footer.terms')}</span>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="mb-3 text-sm font-semibold text-ink">{t('landing.footer.contact')}</h3>
            <p className="text-sm text-ink-2">{t('landing.footer.email')}</p>
          </div>
        </div>
        <div className="mx-auto mt-10 max-w-6xl space-y-1 border-t border-line pt-6 text-xs text-ink-3">
          <p>{t('landing.footer.rights', { year })}</p>
          <p>{t('landing.footer.disclaimer')}</p>
          <p>{t('landing.footer.appleNote')}</p>
        </div>
      </footer>
    </div>
  )
}
