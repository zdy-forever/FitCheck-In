import { clsx } from 'clsx'
import { Activity, AlertTriangle, CheckCircle2, Footprints, Gauge, HeartPulse, Info, Lock, Repeat, Scale, Wind, type LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import type { Snapshot } from '@/lib/api'
import { useFormatters } from '@/lib/format'
import type { FitnessAssessment, Status } from '@shared/metrics/fitness.ts'
import { DemoBadge, StatusBadge } from './HealthPanels'

type Fit = Partial<FitnessAssessment>

function Explain({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <button type="button" className="grid size-5 place-items-center rounded-full text-ink-3 hover:text-ink" aria-label={text}>
        <Info className="size-3.5" aria-hidden />
      </button>
      <span role="tooltip" className="glass-strong pointer-events-none absolute bottom-7 left-1/2 z-30 w-[min(17rem,calc(100vw-2rem))] -translate-x-1/2 translate-y-1 rounded-xl p-3 text-xs font-normal leading-relaxed text-ink-2 opacity-0 transition-all duration-200 group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100 max-sm:left-auto max-sm:right-[-0.5rem] max-sm:translate-x-0">
        {text}
      </span>
    </span>
  )
}

/** Ring gauge for a 0–100 score; animates in when scrolled into view. */
function Ring({ value, color = 'var(--accent)' }: { value: number; color?: string }) {
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <div className="relative size-16 shrink-0" aria-hidden>
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--surface-sunken)" strokeWidth="6" />
        <motion.circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          whileInView={{ strokeDashoffset: c * (1 - value / 100) }}
          viewport={{ once: true }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-semibold tabular text-ink">
        <AnimatedNumber value={value} />
      </span>
    </div>
  )
}

function FitCard({ Icon, title, explain, status, score, headline, children, testId, color }: { Icon: LucideIcon; title: string; explain: string; status: Status; score: number | null; headline?: ReactNode; children?: ReactNode; testId: string; color?: string }) {
  const { t } = useTranslation()
  return (
    <div className="group lift flex flex-col gap-3 rounded-2xl border border-line bg-surface-strong p-4" data-testid={testId}>
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium text-ink-2">
          <Icon className="pop-icon size-4 shrink-0" style={{ color: color ?? 'var(--accent)' }} aria-hidden />
          {title}
          <Explain text={explain} />
        </span>
        <StatusBadge status={status} />
      </div>
      {status === 'insufficient' ? (
        <div className="text-sm text-ink-3">
          <div className="font-medium">{t('health.fit.noData')}</div>
          <div className="text-xs">{t('health.fit.noDataHint')}</div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4">
            {score !== null && <Ring value={score} color={color} />}
            <div className="min-w-0 flex-1">{headline}</div>
          </div>
          {children && <div className="space-y-1 text-xs text-ink-3">{children}</div>}
        </>
      )}
    </div>
  )
}

function Row({ label, value, warn }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span>{label}</span>
      <span className={clsx('font-medium tabular', warn ? 'text-warn' : 'text-ink-2')}>{value}</span>
    </div>
  )
}

function LockedCard({ Icon, title }: { Icon: LucideIcon; title: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-line-strong p-4">
      <span className="flex items-center gap-2 text-sm font-medium text-ink-3">
        <Icon className="size-4" aria-hidden />
        {title}
      </span>
      <span className="flex items-center gap-1.5 text-sm text-ink-3">
        <Lock className="size-3.5" aria-hidden />
        {t('health.notShared')}
      </span>
    </div>
  )
}

export function FitnessPanel({ snapshot, shared }: { snapshot: Snapshot; shared: Set<string> }) {
  const { t, i18n } = useTranslation()
  const f = useFormatters(i18n.language)
  const fit: Fit = snapshot.assessment.fitness ?? {}
  const signed = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${f.num(Math.abs(v), d)}`
  const pace = (ms: number) => {
    const sPerKm = 1000 / ms
    return `${Math.floor(sPerKm / 60)}:${String(Math.round(sPerKm % 60)).padStart(2, '0')} /km`
  }

  const cards: ReactNode[] = []

  // Cardio fitness
  const ca = fit.cardio
  if (!shared.has('vo2_max')) cards.push(<LockedCard key="cardio" Icon={HeartPulse} title={t('health.fit.cardio')} />)
  else if (ca)
    cards.push(
      <FitCard
        key="cardio"
        testId="fit-cardio"
        Icon={HeartPulse}
        color="var(--series-2)"
        title={t('health.fit.cardio')}
        explain={t('health.fit.cardioExplain')}
        status={ca.status}
        score={ca.score}
        headline={
          <>
            <div className="font-display text-2xl font-semibold tabular text-ink">
              {f.num(ca.vo2Max, 1)} <span className="text-xs font-normal text-ink-3">mL/kg/min</span>
            </div>
            {ca.level ? (
              <div className="text-sm text-ink-2">
                {t(`health.fit.vo2Levels.${ca.level}`)} · {t('health.fit.percentile', { pct: ca.percentile })}
              </div>
            ) : (
              <div className="text-xs text-ink-3">{t('health.fit.needsProfile')}</div>
            )}
          </>
        }
      >
        {ca.trendPer30d !== null && <Row label={t('health.fit.trend90')} value={t('health.fit.trend', { sign: ca.trendPer30d >= 0 ? '+' : '−', value: f.num(Math.abs(ca.trendPer30d), 1) })} />}
        {ca.measuredAt && <Row label={t('health.measuredAt')} value={f.relative(ca.measuredAt)} />}
      </FitCard>,
    )

  // Vitals
  const vi = fit.vitals
  if (!shared.has('vitals')) cards.push(<LockedCard key="vitals" Icon={Wind} title={t('health.fit.vitals')} />)
  else if (vi) {
    const label = { spo2: t('health.fit.spo2'), respiratoryRate: t('health.fit.respiratoryRate'), wristTemperature: t('health.fit.wristTemperature') }
    const unit = { spo2: '%', respiratoryRate: '/min', wristTemperature: '°C' }
    cards.push(
      <FitCard
        key="vitals"
        testId="fit-vitals"
        Icon={Wind}
        color="var(--series-3)"
        title={t('health.fit.vitals')}
        explain={t('health.fit.vitalsExplain')}
        status={vi.status}
        score={vi.score}
        headline={
          vi.outOfRangeCount > 0 ? (
            <Badge tone="warn" icon={<AlertTriangle className="size-3" aria-hidden />}>
              {t('health.fit.vitalsFlags', { count: vi.outOfRangeCount })}
            </Badge>
          ) : vi.score !== null ? (
            <span className="text-sm text-ink-2">{t('health.fit.vitalsAllNormal')}</span>
          ) : null
        }
      >
        {vi.signals
          .filter((s) => s.latest !== null)
          .map((s) => (
            <Row
              key={s.key}
              label={label[s.key]}
              warn={s.outOfRange}
              value={`${f.num(s.latest, s.key === 'spo2' ? 0 : 1)}${unit[s.key]}${s.baseline !== null ? ` · ${t('health.fit.usualRange', { value: f.num(s.baseline, s.key === 'spo2' ? 0 : 1) })}` : ''}`}
            />
          ))}
      </FitCard>,
    )
  }

  // Heart-rate recovery
  const hr = fit.hrr
  if (!shared.has('heart_rate')) cards.push(<LockedCard key="hrr" Icon={Gauge} title={t('health.fit.hrr')} />)
  else if (hr)
    cards.push(
      <FitCard
        key="hrr"
        testId="fit-hrr"
        Icon={Gauge}
        color="var(--series-1)"
        title={t('health.fit.hrr')}
        explain={t('health.fit.hrrExplain')}
        status={hr.status}
        score={hr.score}
        headline={
          <>
            <div className="font-display text-2xl font-semibold tabular text-ink">
              {f.num(hr.average28d, 0)} <span className="text-xs font-normal text-ink-3">bpm</span>
            </div>
            {hr.level && <div className="text-sm text-ink-2">{t(`health.fit.hrrLevels.${hr.level}`)} · {t('health.fit.avg28')}</div>}
          </>
        }
      >
        {hr.trendPer30d !== null && <Row label={t('health.fit.trend90')} value={t('health.fit.trend', { sign: hr.trendPer30d >= 0 ? '+' : '−', value: f.num(Math.abs(hr.trendPer30d), 1) })} />}
      </FitCard>,
    )

  // Weekly activity
  const ac = fit.activity
  if (!shared.has('activity')) cards.push(<LockedCard key="activity" Icon={Activity} title={t('health.fit.activity')} />)
  else if (ac)
    cards.push(
      <FitCard
        key="activity"
        testId="fit-activity"
        Icon={Activity}
        title={t('health.fit.activity')}
        explain={t('health.fit.activityExplain')}
        status={ac.status}
        score={ac.score}
        headline={
          ac.whoPercent !== null ? (
            <>
              <div className="text-xs text-ink-3">{t('health.fit.whoGoal')}</div>
              {ac.whoPercent >= 100 ? (
                <div className="flex items-center gap-1.5 font-display text-xl font-semibold text-good">
                  <CheckCircle2 className="size-5" aria-hidden />
                  {t('health.fit.goalReached')}
                </div>
              ) : (
                <div className="font-display text-2xl font-semibold tabular text-ink">{f.num(ac.whoPercent)}%</div>
              )}
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
                <motion.div className="h-full rounded-full bg-accent" initial={{ width: 0 }} whileInView={{ width: `${Math.min(ac.whoPercent, 100)}%` }} viewport={{ once: true }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} />
              </div>
            </>
          ) : null
        }
      >
        {ac.exerciseMinutes7d !== null && <Row label={t('health.fit.exerciseMin')} value={`${f.num(ac.exerciseMinutes7d)} min`} />}
        {ac.stepsPerDay7d !== null && <Row label={t('health.fit.stepsDay')} value={f.num(ac.stepsPerDay7d)} />}
        {ac.flightsPerDay7d !== null && <Row label={t('health.fit.flightsDay')} value={f.num(ac.flightsPerDay7d, 1)} />}
        {ac.distanceKm7d.walkingRunning !== null && <Row label={t('health.fit.distance')} value={`${f.num(ac.distanceKm7d.walkingRunning, 1)} km`} />}
        {ac.activeDays7d !== null && <Row label={t('health.fit.activeDays')} value={`${ac.activeDays7d}/7`} />}
      </FitCard>,
    )

  // Monotony & strain
  const mo = fit.monotony
  if (!shared.has('workouts')) cards.push(<LockedCard key="monotony" Icon={Repeat} title={t('health.fit.monotony')} />)
  else if (mo)
    cards.push(
      <FitCard
        key="monotony"
        testId="fit-monotony"
        Icon={Repeat}
        color="var(--series-2)"
        title={t('health.fit.monotony')}
        explain={t('health.fit.monotonyExplain')}
        status={mo.status}
        score={null}
        headline={
          mo.monotony !== null ? (
            <div className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-semibold tabular text-ink">{f.num(mo.monotony, 2)}</span>
              {mo.level && <Badge tone={mo.level === 'high' ? 'warn' : mo.level === 'moderate' ? 'neutral' : 'good'}>{t(`health.fit.monotonyLevels.${mo.level}`)}</Badge>}
            </div>
          ) : null
        }
      >
        {mo.strain !== null && <Row label={t('health.fit.strain')} value={f.num(mo.strain)} />}
        {mo.weeklyLoad !== null && <Row label={t('health.fit.weeklyLoad')} value={f.num(mo.weeklyLoad)} />}
        <Row label={t('health.fit.trainingDays')} value={`${mo.trainingDays7d}/7`} />
      </FitCard>,
    )

  // Running form (only if the client runs)
  const ru = fit.running
  if (shared.has('workouts') && ru && ru.status !== 'insufficient') {
    const l = ru.latest
    cards.push(
      <FitCard
        key="running"
        testId="fit-running"
        Icon={Footprints}
        color="var(--series-3)"
        title={t('health.fit.running')}
        explain={t('health.fit.runningExplain')}
        status={ru.status}
        score={null}
        headline={
          ru.economyChangePercent !== null ? (
            <>
              <div className="text-xs text-ink-3">{t('health.fit.economy')}</div>
              {ru.economyChangePercent === 0 ? (
                <div className="text-md font-semibold text-ink-2">{t('health.fit.noChange')}</div>
              ) : (
                <div className={clsx('font-display text-2xl font-semibold tabular', ru.economyChangePercent > 0 ? 'text-good' : 'text-warn')}>{signed(ru.economyChangePercent)}%</div>
              )}
            </>
          ) : (
            <span className="text-sm text-ink-2">{t('health.fit.runs28', { count: ru.runs28d })}</span>
          )
        }
      >
        {l?.speedMS && <Row label={t('health.fit.pace')} value={pace(l.speedMS)} />}
        {l?.powerW && <Row label={t('health.fit.power')} value={`${f.num(l.powerW)} W`} />}
        {l?.groundContactMS && <Row label={t('health.fit.groundContact')} value={`${f.num(l.groundContactMS)} ms`} />}
        {ru.verticalRatio !== null && <Row label={t('health.fit.verticalRatio')} value={`${f.num(ru.verticalRatio, 1)}%`} />}
      </FitCard>,
    )
  }

  // Mobility
  const mb = fit.mobility
  if (!shared.has('mobility')) cards.push(<LockedCard key="mobility" Icon={Footprints} title={t('health.fit.mobility')} />)
  else if (mb)
    cards.push(
      <FitCard
        key="mobility"
        testId="fit-mobility"
        Icon={Footprints}
        title={t('health.fit.mobility')}
        explain={t('health.fit.mobilityExplain')}
        status={mb.status}
        score={mb.score}
        headline={mb.steadinessLevel ? <Badge tone={mb.steadinessLevel === 'ok' ? 'good' : 'warn'}>{t(`health.fit.steadinessLevels.${mb.steadinessLevel}`)}</Badge> : null}
      >
        {mb.inputs.walkingSpeed !== null && <Row label={t('health.fit.walkingSpeed')} value={`${f.num(mb.inputs.walkingSpeed, 2)} m/s`} />}
        {mb.inputs.asymmetry !== null && <Row label={t('health.fit.asymmetry')} value={`${f.num(mb.inputs.asymmetry, 1)}%`} />}
        {mb.inputs.doubleSupport !== null && <Row label={t('health.fit.doubleSupport')} value={`${f.num(mb.inputs.doubleSupport, 1)}%`} />}
        {mb.inputs.stepLength !== null && <Row label={t('health.fit.stepLength')} value={`${f.num(mb.inputs.stepLength, 2)} m`} />}
      </FitCard>,
    )

  // Body (trends only)
  const bo = fit.body
  if (!shared.has('body')) cards.push(<LockedCard key="body" Icon={Scale} title={t('health.fit.body')} />)
  else if (bo && bo.status !== 'insufficient')
    cards.push(
      <FitCard key="body" testId="fit-body" Icon={Scale} title={t('health.fit.body')} explain={t('health.fit.bodyExplain')} status={bo.status} score={null}>
        {(
          [
            ['weight', bo.weight, 'kg'],
            ['bodyFat', bo.bodyFat, '%'],
            ['leanMass', bo.leanMass, 'kg'],
          ] as const
        )
          .filter(([, v]) => v.latest !== null)
          .map(([k, v, u]) => (
            <Row key={k} label={t(`health.fit.${k}`)} value={`${f.num(v.latest, 1)} ${u}${v.change28d !== null ? ` · ${t('health.fit.change28', { sign: v.change28d >= 0 ? '+' : '−', value: f.num(Math.abs(v.change28d), 1) })}` : ''}`} />
          ))}
      </FitCard>,
    )

  if (cards.length === 0) return null
  return (
    <Card data-testid="fitness-panel">
      <CardHeader title={t('health.fit.title')} icon={<HeartPulse className="size-5" />} action={<DemoBadge show={snapshot.origin === 'demo'} />} />
      <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards}</div>
    </Card>
  )
}
