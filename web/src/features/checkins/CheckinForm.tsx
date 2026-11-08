import { clsx } from 'clsx'
import { AlertTriangle, CheckCircle2, Send } from 'lucide-react'
import { motion } from 'motion/react'
import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { SelectField, TextArea } from '@/components/ui/Field'
import { Scale } from '@/components/ui/Scale'
import { useToast } from '@/components/ui/Toast'
import { api, type RelationshipWithPeer, type SessionWithDetails } from '@/lib/api'
import { errorKey } from '@/lib/errors'
import { useFormatters } from '@/lib/format'

export const PAIN_AREAS = ['neck', 'shoulder_left', 'shoulder_right', 'upper_back', 'lower_back', 'elbow', 'wrist', 'hip', 'knee_left', 'knee_right', 'ankle', 'other'] as const

export interface CheckinValues {
  trainerId: string
  sessionId: string
  sleep: number | null
  energy: number | null
  soreness: number | null
  pain: number | null
  painAreas: string[]
  mental: number | null
  goal: string
  notes: string
}

/** Pure validation (unit-tested). Returns i18n keys + params per field. */
export function validateCheckin(v: CheckinValues): Partial<Record<keyof CheckinValues, { key: string; params?: Record<string, number> }>> {
  const e: Partial<Record<keyof CheckinValues, { key: string; params?: Record<string, number> }>> = {}
  const inRange = (x: number | null, min: number, max: number) => x !== null && Number.isInteger(x) && x >= min && x <= max
  if (!v.trainerId) e.trainerId = { key: 'validation.required' }
  if (!inRange(v.sleep, 1, 5)) e.sleep = { key: 'validation.range', params: { min: 1, max: 5 } }
  if (!inRange(v.energy, 1, 5)) e.energy = { key: 'validation.range', params: { min: 1, max: 5 } }
  if (!inRange(v.soreness, 0, 10)) e.soreness = { key: 'validation.range', params: { min: 0, max: 10 } }
  if (!inRange(v.pain, 0, 10)) e.pain = { key: 'validation.range', params: { min: 0, max: 10 } }
  if (!inRange(v.mental, 1, 5)) e.mental = { key: 'validation.range', params: { min: 1, max: 5 } }
  if (v.goal.trim().length === 0) e.goal = { key: 'validation.required' }
  else if (v.goal.trim().length > 300) e.goal = { key: 'validation.maxLength', params: { max: 300 } }
  if (v.notes.length > 1000) e.notes = { key: 'validation.maxLength', params: { max: 1000 } }
  if (v.painAreas.length > 12) e.painAreas = { key: 'validation.maxLength', params: { max: 12 } }
  return e
}

export function CheckinForm({
  clientId,
  relationships,
  sessions,
  onSubmitted,
}: {
  clientId: string
  relationships: RelationshipWithPeer[]
  sessions: SessionWithDetails[]
  onSubmitted?: () => void
}) {
  const { t, i18n } = useTranslation()
  const f = useFormatters(i18n.language)
  const toast = useToast()
  const active = relationships.filter((r) => r.status === 'active')
  const upcoming = useMemo(() => {
    const now = Date.now()
    return sessions
      .filter((s) => s.status === 'planned' && new Date(s.scheduled_at).getTime() > now - 6 * 3_600_000)
      .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
  }, [sessions])

  const initialTrainer = upcoming[0]?.trainer_id ?? active[0]?.trainer_id ?? ''
  const [v, setV] = useState<CheckinValues>({
    trainerId: initialTrainer,
    sessionId: upcoming.find((s) => s.trainer_id === initialTrainer)?.id ?? '',
    sleep: null,
    energy: null,
    soreness: null,
    pain: null,
    painAreas: [],
    mental: null,
    goal: '',
    notes: '',
  })
  const [errors, setErrors] = useState<ReturnType<typeof validateCheckin>>({})
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const set = <K extends keyof CheckinValues>(k: K, val: CheckinValues[K]) => {
    setV((p) => ({ ...p, [k]: val }))
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }))
  }
  const err = (k: keyof CheckinValues) => (errors[k] ? t(errors[k]!.key, errors[k]!.params ?? {}) : null)
  const trainerName = active.find((r) => r.trainer_id === v.trainerId)?.peer?.display_name ?? ''

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const found = validateCheckin(v)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      toast.error(t('validation.fixErrors'))
      const first = document.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setSubmitting(true)
    try {
      await api.submitCheckin({
        id: crypto.randomUUID(),
        client_id: clientId,
        trainer_id: v.trainerId,
        session_id: v.sessionId || null,
        sleep_quality: v.sleep!,
        energy_level: v.energy!,
        muscle_soreness: v.soreness!,
        pain_level: v.pain!,
        pain_areas: v.pain! > 0 ? v.painAreas : [],
        mental_state: v.mental!,
        training_goal: v.goal.trim(),
        notes: v.notes.trim() || null,
      })
      toast.success(t('checkin.success', { trainer: trainerName }))
      setDone(true)
      onSubmitted?.()
    } catch (er) {
      toast.error(t(errorKey(er)))
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="card flex flex-col items-center gap-3 p-10 text-center" data-testid="checkin-done">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 0.1 }}>
          <CheckCircle2 className="size-16 text-good" aria-hidden />
        </motion.div>
        <p className="text-lg font-semibold text-ink">{t('checkin.success', { trainer: trainerName })}</p>
        <Button variant="secondary" onClick={() => setDone(false)}>
          {t('common.back')}
        </Button>
      </motion.div>
    )
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-6 pb-4" data-testid="checkin-form">
      <div className="card grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
        <SelectField label={t('checkin.trainer')} value={v.trainerId} onChange={(e) => { set('trainerId', e.target.value); set('sessionId', '') }} error={err('trainerId')}>
          {active.map((r) => (
            <option key={r.trainer_id} value={r.trainer_id}>
              {r.peer?.display_name}
            </option>
          ))}
        </SelectField>
        <SelectField label={t('checkin.session')} value={v.sessionId} onChange={(e) => set('sessionId', e.target.value)} optionalLabel={t('common.optional')}>
          <option value="">{t('checkin.noSession')}</option>
          {upcoming
            .filter((s) => s.trainer_id === v.trainerId)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {f.dateTime(s.scheduled_at)} · {s.title ?? t(`sessions.types.${s.session_type}`)}
              </option>
            ))}
        </SelectField>
      </div>

      <div className="card flex flex-col gap-7 p-5 sm:p-6">
        <Scale name="sleep" label={t('checkin.sleepQuality')} min={1} max={5} value={v.sleep} onChange={(x) => set('sleep', x)} labels={t('checkin.scale.sleep', { returnObjects: true }) as string[]} error={err('sleep')} />
        <Scale name="energy" label={t('checkin.energy')} min={1} max={5} value={v.energy} onChange={(x) => set('energy', x)} labels={t('checkin.scale.energy', { returnObjects: true }) as string[]} error={err('energy')} />
        <Scale name="mental" label={t('checkin.mental')} min={1} max={5} value={v.mental} onChange={(x) => set('mental', x)} labels={t('checkin.scale.mental', { returnObjects: true }) as string[]} error={err('mental')} />
        <Scale name="soreness" tone="severity" label={t('checkin.soreness')} min={0} max={10} value={v.soreness} onChange={(x) => set('soreness', x)} hint={t('checkin.scale.soreness')} error={err('soreness')} />
        <Scale name="pain" tone="severity" label={t('checkin.pain')} min={0} max={10} value={v.pain} onChange={(x) => set('pain', x)} hint={t('checkin.scale.pain')} error={err('pain')} />
        {v.pain !== null && v.pain > 0 && (
          <motion.fieldset initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
            <legend className="mb-2 text-sm font-medium text-ink">
              {t('checkin.painAreas')} <span className="text-xs font-normal text-ink-3">({t('common.optional')})</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {PAIN_AREAS.map((a) => {
                const on = v.painAreas.includes(a)
                return (
                  <label key={a} className={clsx('cursor-pointer rounded-full border px-3.5 py-2 text-sm transition has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-accent-soft', on ? 'border-transparent bg-bad-soft font-medium text-bad' : 'border-line bg-surface-strong text-ink-2 hover:border-line-strong')}>
                    <input type="checkbox" className="sr-only" checked={on} onChange={() => set('painAreas', on ? v.painAreas.filter((x) => x !== a) : [...v.painAreas, a])} />
                    {t(`areas.${a}`)}
                  </label>
                )
              })}
            </div>
            {v.pain >= 5 && (
              <p className="mt-3 flex items-start gap-2 rounded-xl bg-warn-soft p-3 text-sm text-warn" role="note">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t('checkin.painWarning')}
              </p>
            )}
          </motion.fieldset>
        )}
      </div>

      <div className="card flex flex-col gap-4 p-5 sm:p-6">
        <TextArea label={t('checkin.goal')} placeholder={t('checkin.goalPlaceholder')} value={v.goal} onChange={(e) => set('goal', e.target.value)} error={err('goal')} rows={2} maxLength={300} name="goal" />
        <TextArea label={t('checkin.notes')} value={v.notes} onChange={(e) => set('notes', e.target.value)} error={err('notes')} optionalLabel={t('common.optional')} rows={3} maxLength={1000} name="notes" />
      </div>

      <div className="sticky bottom-24 z-10 lg:bottom-4">
        <Button type="submit" size="lg" loading={submitting} className="w-full shadow-[var(--shadow-lg)]" icon={<Send className="size-5" aria-hidden />} data-testid="checkin-submit">
          {submitting ? t('checkin.submitting') : t('checkin.submit')}
        </Button>
      </div>
    </form>
  )
}
