import { clsx } from 'clsx'
import { Activity, BedDouble, Brain, CheckCircle2, Clock, Flame, Waves } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { api, type Checkin } from '@/lib/api'
import { errorKey } from '@/lib/errors'
import { useFormatters } from '@/lib/format'

/** Attention rules used on the trainer dashboard (self-reported values only). */
export function attentionReasons(c: Pick<Checkin, 'pain_level' | 'energy_level' | 'sleep_quality' | 'muscle_soreness'>) {
  const r: { key: string; value: number }[] = []
  if (c.pain_level >= 4) r.push({ key: 'pain', value: c.pain_level })
  if (c.energy_level <= 2) r.push({ key: 'lowEnergy', value: c.energy_level })
  if (c.sleep_quality <= 2) r.push({ key: 'poorSleep', value: c.sleep_quality })
  if (c.muscle_soreness >= 7) r.push({ key: 'highSoreness', value: c.muscle_soreness })
  return r
}

export function CheckinCard({ checkin, canReview, compact, highlight }: { checkin: Checkin; canReview?: boolean; compact?: boolean; highlight?: boolean }) {
  const { t, i18n } = useTranslation()
  const f = useFormatters(i18n.language)
  const toast = useToast()
  const [reviewing, setReviewing] = useState(false)
  const [reviewedAt, setReviewedAt] = useState(checkin.reviewed_at)
  const flags = attentionReasons(checkin)

  const review = async () => {
    setReviewing(true)
    try {
      setReviewedAt(await api.markReviewed(checkin.id))
    } catch (e) {
      toast.error(t(errorKey(e)))
    } finally {
      setReviewing(false)
    }
  }

  const metrics = [
    { Icon: BedDouble, label: t('checkin.sleepQuality'), value: `${checkin.sleep_quality}/5`, sub: (t('checkin.scale.sleep', { returnObjects: true }) as string[])[checkin.sleep_quality - 1] },
    { Icon: Flame, label: t('checkin.energy'), value: `${checkin.energy_level}/5`, sub: (t('checkin.scale.energy', { returnObjects: true }) as string[])[checkin.energy_level - 1] },
    { Icon: Brain, label: t('checkin.mental'), value: `${checkin.mental_state}/5`, sub: (t('checkin.scale.mental', { returnObjects: true }) as string[])[checkin.mental_state - 1] },
    { Icon: Activity, label: t('checkin.soreness'), value: `${checkin.muscle_soreness}/10`, warn: checkin.muscle_soreness >= 7 },
    { Icon: Waves, label: t('checkin.pain'), value: `${checkin.pain_level}/10`, warn: checkin.pain_level >= 4 },
  ]

  return (
    <article className={clsx('rounded-2xl border bg-surface-strong p-4 transition-shadow', highlight ? 'border-accent shadow-[0_0_0_4px_var(--accent-soft)]' : 'border-line')} data-testid="checkin-card">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-ink">{f.dateTime(checkin.created_at)}</span>
          <span className="text-ink-3">· {f.relative(checkin.created_at)}</span>
        </div>
        <div className="flex items-center gap-2">
          {flags.length > 0 && <Badge tone="warn">{t('trainer.attention')}</Badge>}
          {reviewedAt ? (
            <Badge tone="good" icon={<CheckCircle2 className="size-3" aria-hidden />}>
              {t('checkin.reviewed')}
            </Badge>
          ) : canReview ? (
            <Button size="sm" variant="secondary" loading={reviewing} onClick={() => void review()} data-testid="mark-reviewed">
              {t('checkin.markReviewed')}
            </Button>
          ) : (
            <Badge tone="accent" icon={<Clock className="size-3" aria-hidden />}>
              {t('checkin.pending')}
            </Badge>
          )}
        </div>
      </header>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-3">{t('checkin.subjective')}</p>
      <div className={clsx('grid gap-2', compact ? 'grid-cols-5' : 'grid-cols-2 sm:grid-cols-5')}>
        {metrics.map(({ Icon, label, value, sub, warn }) => (
          <div key={label} className={clsx('rounded-xl p-2.5', warn ? 'bg-warn-soft' : 'bg-sunken')}>
            <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{label}</span>
            </div>
            <div className={clsx('mt-0.5 font-semibold tabular', warn ? 'text-warn' : 'text-ink')}>{value}</div>
            {!compact && sub && <div className="truncate text-[11px] text-ink-3">{sub}</div>}
          </div>
        ))}
      </div>
      {checkin.pain_areas.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {checkin.pain_areas.map((a) => (
            <Badge key={a} tone="bad">
              {t(`areas.${a}`, { defaultValue: a })}
            </Badge>
          ))}
        </div>
      )}
      {!compact && (
        <div className="mt-3 space-y-1 text-sm">
          <p>
            <span className="text-ink-3">{t('checkin.goal')}: </span>
            <span className="text-ink">{checkin.training_goal}</span>
          </p>
          {checkin.notes && <p className="whitespace-pre-wrap text-ink-2">{checkin.notes}</p>}
        </div>
      )}
    </article>
  )
}
