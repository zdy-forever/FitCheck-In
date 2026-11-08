import { Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { api, type SessionWithDetails } from '@/lib/api'
import { errorKey } from '@/lib/errors'
import { toLocalInputValue } from '@/lib/format'
import type { Enums } from '@/lib/supabase'

export const SESSION_TYPES = ['strength', 'hypertrophy', 'conditioning', 'mobility', 'endurance', 'technique', 'recovery', 'other'] as const

interface ExerciseRow {
  key: string
  name: string
  sets: string
  reps: string
  weight: string
  notes: string
}

const blankRow = (): ExerciseRow => ({ key: crypto.randomUUID(), name: '', sets: '', reps: '', weight: '', notes: '' })

/** Parses an optional numeric field. Returns undefined for empty, NaN for invalid. */
export function parseOptionalNumber(s: string, { integer = false, min = 0, max = Infinity } = {}): number | null | typeof Number.NaN {
  if (s.trim() === '') return null
  const n = Number(s.replace(',', '.'))
  if (!Number.isFinite(n) || n < min || n > max) return Number.NaN
  if (integer && !Number.isInteger(n)) return Number.NaN
  return n
}

export function SessionEditor({
  open,
  onClose,
  trainerId,
  clients,
  session,
  defaultClientId,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  trainerId: string
  clients: { id: string; name: string }[]
  session?: SessionWithDetails | null
  defaultClientId?: string
  onSaved?: (id: string) => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const [clientId, setClientId] = useState(session?.client_id ?? defaultClientId ?? clients[0]?.id ?? '')
  const [scheduledAt, setScheduledAt] = useState(toLocalInputValue(session?.scheduled_at ?? new Date(Math.ceil(Date.now() / 1_800_000) * 1_800_000)))
  const [duration, setDuration] = useState(String(session?.duration_minutes ?? 60))
  const [type, setType] = useState(session?.session_type ?? 'strength')
  const [status, setStatus] = useState<Enums<'session_status'>>(session?.status ?? 'planned')
  const [title, setTitle] = useState(session?.title ?? '')
  const [location, setLocation] = useState(session?.location ?? '')
  const [planned, setPlanned] = useState(session?.planned_intensity ? String(session.planned_intensity) : '')
  const [actual, setActual] = useState(session?.actual_intensity ? String(session.actual_intensity) : '')
  const [rows, setRows] = useState<ExerciseRow[]>(
    session?.session_exercises.length
      ? session.session_exercises.map((e) => ({ key: e.id, name: e.name, sets: e.sets?.toString() ?? '', reps: e.reps?.toString() ?? '', weight: e.weight_kg?.toString() ?? '', notes: e.notes ?? '' }))
      : [blankRow()],
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const updateRow = (key: string, patch: Partial<ExerciseRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!clientId) errs.client = t('validation.required')
    if (!scheduledAt || Number.isNaN(new Date(scheduledAt).getTime())) errs.scheduledAt = t('validation.required')
    const dur = parseOptionalNumber(duration, { integer: true, min: 5, max: 600 })
    if (Number.isNaN(dur)) errs.duration = t('validation.range', { min: 5, max: 600 })
    const pI = parseOptionalNumber(planned, { integer: true, min: 1, max: 10 })
    if (Number.isNaN(pI)) errs.planned = t('validation.range', { min: 1, max: 10 })
    const aI = parseOptionalNumber(actual, { integer: true, min: 1, max: 10 })
    if (Number.isNaN(aI)) errs.actual = t('validation.range', { min: 1, max: 10 })
    const exercises = rows
      .filter((r) => r.name.trim() || r.sets || r.reps || r.weight)
      .map((r) => {
        const sets = parseOptionalNumber(r.sets, { integer: true, max: 100 })
        const reps = parseOptionalNumber(r.reps, { integer: true, max: 1000 })
        const weight = parseOptionalNumber(r.weight, { max: 1000 })
        if (!r.name.trim()) errs[`name-${r.key}`] = t('validation.required')
        if (Number.isNaN(sets)) errs[`sets-${r.key}`] = t('validation.integer')
        if (Number.isNaN(reps)) errs[`reps-${r.key}`] = t('validation.integer')
        if (Number.isNaN(weight)) errs[`weight-${r.key}`] = t('validation.positive')
        return { name: r.name.trim(), sets: sets as number | null, reps: reps as number | null, weight_kg: weight as number | null, notes: r.notes.trim() || null }
      })
    setErrors(errs)
    if (Object.keys(errs).length) {
      toast.error(t('validation.fixErrors'))
      return
    }
    setSaving(true)
    try {
      const id = await api.saveSession(
        {
          id: session?.id,
          trainer_id: trainerId,
          client_id: clientId,
          scheduled_at: new Date(scheduledAt).toISOString(),
          duration_minutes: dur as number | null,
          session_type: type,
          status,
          title: title.trim() || null,
          location: location.trim() || null,
          planned_intensity: pI as number | null,
          actual_intensity: aI as number | null,
        },
        exercises,
      )
      toast.success(t('sessions.saved'))
      onSaved?.(id)
      onClose()
    } catch (er) {
      toast.error(t(errorKey(er)))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={session ? t('sessions.edit') : t('sessions.new')} wide>
      <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4" data-testid="session-form">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label={t('sessions.client')} value={clientId} onChange={(e) => setClientId(e.target.value)} error={errors.client} disabled={Boolean(session)}>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
          <TextField label={t('sessions.scheduledAt')} type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} error={errors.scheduledAt} />
          <TextField label={t('sessions.titleField')} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} optionalLabel={t('common.optional')} />
          <SelectField label={t('sessions.type')} value={type} onChange={(e) => setType(e.target.value)}>
            {SESSION_TYPES.map((s) => (
              <option key={s} value={s}>
                {t(`sessions.types.${s}`)}
              </option>
            ))}
          </SelectField>
          <TextField label={t('sessions.duration')} inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} error={errors.duration} />
          <SelectField label={t('sessions.status')} value={status} onChange={(e) => setStatus(e.target.value as Enums<'session_status'>)}>
            {(['planned', 'completed', 'cancelled'] as const).map((s) => (
              <option key={s} value={s}>
                {t(`sessions.statuses.${s}`)}
              </option>
            ))}
          </SelectField>
          <TextField label={t('sessions.plannedIntensity')} inputMode="numeric" value={planned} onChange={(e) => setPlanned(e.target.value)} error={errors.planned} optionalLabel={t('common.optional')} />
          <TextField label={t('sessions.actualIntensity')} inputMode="numeric" value={actual} onChange={(e) => setActual(e.target.value)} error={errors.actual} optionalLabel={t('common.optional')} data-testid="actual-intensity" />
          <TextField className="sm:col-span-2" label={t('sessions.location')} value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} optionalLabel={t('common.optional')} />
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink">{t('sessions.exercises')}</h3>
          <div className="flex flex-col gap-3">
            {rows.map((r, i) => (
              <div key={r.key} className="rounded-2xl border border-line bg-sunken/60 p-3" data-testid="exercise-row">
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <TextField label={`${t('sessions.exerciseName')} ${i + 1}`} value={r.name} onChange={(e) => updateRow(r.key, { name: e.target.value })} error={errors[`name-${r.key}`]} maxLength={120} />
                  <button type="button" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blankRow()]))} className="mt-7 grid size-11 place-items-center rounded-xl text-ink-3 hover:bg-bad-soft hover:text-bad" aria-label={t('sessions.removeExercise')}>
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <TextField label={t('sessions.sets')} inputMode="numeric" value={r.sets} onChange={(e) => updateRow(r.key, { sets: e.target.value })} error={errors[`sets-${r.key}`]} />
                  <TextField label={t('sessions.reps')} inputMode="numeric" value={r.reps} onChange={(e) => updateRow(r.key, { reps: e.target.value })} error={errors[`reps-${r.key}`]} />
                  <TextField label={t('sessions.weight')} inputMode="decimal" value={r.weight} onChange={(e) => updateRow(r.key, { weight: e.target.value })} error={errors[`weight-${r.key}`]} />
                </div>
              </div>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="mt-2" icon={<Plus className="size-4" />} onClick={() => setRows((rs) => [...rs, blankRow()])}>
            {t('sessions.addExercise')}
          </Button>
        </div>

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={saving} data-testid="session-save">
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
