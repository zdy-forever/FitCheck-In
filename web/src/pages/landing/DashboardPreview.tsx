import { clsx } from 'clsx'
import { Activity, BedDouble, CheckCircle2, Clock, HeartPulse, Waves } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Static, clearly-labelled product preview for the landing page. Values are
 * illustrative sample values, not anyone's data.
 */
const CLIENTS = [
  { name: 'Mia L.', energy: 4, sleep: 4, pain: 0, hrv: [48, 51, 50, 53, 55, 54, 57], state: 'good' as const, reviewed: true },
  { name: 'Jordan K.', energy: 2, sleep: 2, pain: 5, hrv: [52, 50, 47, 44, 42, 41, 39], state: 'attention' as const, reviewed: false },
  { name: 'Wei Z.', energy: 3, sleep: 4, pain: 1, hrv: [61, 60, 62, 59, 61, 63, 62], state: 'good' as const, reviewed: false },
]

function Spark({ values, tone }: { values: number[]; tone: 'good' | 'attention' }) {
  const min = Math.min(...values) - 2
  const max = Math.max(...values) + 2
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - min) / (max - min)) * 30}`).join(' ')
  return (
    <svg viewBox="0 0 100 30" className="h-8 w-24" preserveAspectRatio="none" aria-hidden>
      <motion.polyline
        points={pts}
        fill="none"
        stroke={tone === 'good' ? 'var(--series-1)' : 'var(--series-2)'}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
      />
    </svg>
  )
}

export function DashboardPreview({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState(1)
  const c = CLIENTS[selected]!
  return (
    <div className="glass-strong relative overflow-hidden rounded-[28px] p-3 sm:p-4" role="img" aria-label={t('landing.previewLabel')}>
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </div>
        <span className="rounded-full bg-sunken px-2.5 py-0.5 text-2xs font-medium uppercase tracking-wider text-ink-3">{t('landing.previewLabel')}</span>
      </div>
      <div className={clsx('grid gap-3', compact ? 'grid-cols-1' : 'md:grid-cols-[1.1fr_1fr]')}>
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-2">
            {[
              { k: t('trainer.stats.clients'), v: '12' },
              { k: t('trainer.stats.today'), v: '5' },
              { k: t('trainer.stats.pending'), v: '2' },
            ].map((s) => (
              <div key={s.k} className="rounded-2xl bg-surface-strong p-3 shadow-sm">
                <div className="truncate text-2xs text-ink-3">{s.k}</div>
                <div className="font-display text-2xl font-semibold tabular text-ink">{s.v}</div>
              </div>
            ))}
          </div>
          {CLIENTS.map((cl, i) => (
            <button
              key={cl.name}
              type="button"
              tabIndex={-1}
              onMouseEnter={() => setSelected(i)}
              onClick={() => setSelected(i)}
              className={clsx('flex items-center gap-3 rounded-2xl p-3 text-left transition-all', selected === i ? 'bg-surface-strong shadow-md' : 'hover:bg-surface-strong/60')}
            >
              <div className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">{cl.name[0]}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                  {cl.name}
                  {!cl.reviewed && <span className="size-2 rounded-full bg-accent" aria-hidden />}
                </div>
                <div className="text-xs text-ink-3">
                  {t('checkin.energy')} {cl.energy}/5 · {t('checkin.pain')} {cl.pain}/10
                </div>
              </div>
              <Spark values={cl.hrv} tone={cl.state} />
            </button>
          ))}
        </div>
        {!compact && (
          <motion.div key={selected} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3 }} className="flex flex-col gap-2 rounded-2xl bg-surface-strong p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-ink">{c.name}</span>
              <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium', c.state === 'good' ? 'bg-good-soft text-good' : 'bg-warn-soft text-warn')}>
                {c.state === 'good' ? <CheckCircle2 className="size-3" /> : <Clock className="size-3" />}
                {c.state === 'good' ? t('health.status.ok') : t('trainer.attention')}
              </span>
            </div>
            <div className="text-2xs font-medium uppercase tracking-wider text-ink-3">{t('checkin.subjective')}</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { l: t('checkin.sleepQuality'), v: `${c.sleep}/5`, I: BedDouble },
                { l: t('checkin.energy'), v: `${c.energy}/5`, I: Activity },
                { l: t('checkin.pain'), v: `${c.pain}/10`, I: Waves },
              ].map(({ l, v, I }) => (
                <div key={l} className="rounded-xl bg-sunken p-2">
                  <I className="mx-auto mb-1 size-4 text-ink-3" aria-hidden />
                  <div className="text-sm font-semibold tabular text-ink">{v}</div>
                  <div className="truncate text-2xs text-ink-3">{l}</div>
                </div>
              ))}
            </div>
            <div className="mt-1 text-2xs font-medium uppercase tracking-wider text-ink-3">{t('health.measured')}</div>
            <div className="flex items-center gap-3 rounded-xl bg-sunken p-3">
              <HeartPulse className="size-5 text-[var(--series-1)]" aria-hidden />
              <div className="flex-1">
                <div className="text-xs text-ink-3">{t('health.hrv')}</div>
                <div className="font-display text-xl font-semibold tabular text-ink">
                  {c.hrv.at(-1)} <span className="text-xs font-normal text-ink-3">ms</span>
                </div>
              </div>
              <Spark values={c.hrv} tone={c.state} />
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}
