import { Eye, EyeOff, Star } from 'lucide-react'
import { clsx } from 'clsx'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { SelectField, TextArea } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { api, type Note, type SessionWithDetails } from '@/lib/api'
import { errorKey } from '@/lib/errors'
import { useFormatters } from '@/lib/format'

export function NoteEditor({ trainerId, clientId, sessions, note, onSaved, onCancel }: { trainerId: string; clientId: string; sessions: SessionWithDetails[]; note?: Note | null; onSaved?: () => void; onCancel?: () => void }) {
  const { t, i18n } = useTranslation()
  const f = useFormatters(i18n.language)
  const toast = useToast()
  const [body, setBody] = useState(note?.body ?? '')
  const [recs, setRecs] = useState(note?.recommendations ?? '')
  const [rating, setRating] = useState<number | null>(note?.performance_rating ?? null)
  const [visibility, setVisibility] = useState<'private' | 'shared'>(note?.visibility ?? 'private')
  const [sessionId, setSessionId] = useState(note?.session_id ?? sessions[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!body.trim()) {
      setError(t('validation.required'))
      return
    }
    setError(null)
    setSaving(true)
    try {
      await api.saveNote({ id: note?.id, trainer_id: trainerId, client_id: clientId, session_id: sessionId || null, body: body.trim(), recommendations: recs.trim() || null, performance_rating: rating, visibility })
      toast.success(t('notes.saved'))
      if (!note) {
        setBody('')
        setRecs('')
        setRating(null)
      }
      onSaved?.()
    } catch (er) {
      toast.error(t(errorKey(er)))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-3" data-testid="note-form">
      <SelectField label={t('notes.linkSession')} value={sessionId} onChange={(e) => setSessionId(e.target.value)} optionalLabel={t('common.optional')}>
        <option value="">{t('common.none')}</option>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {f.dateTime(s.scheduled_at)} · {s.title ?? t(`sessions.types.${s.session_type}`)}
          </option>
        ))}
      </SelectField>
      <TextArea label={t('notes.body')} placeholder={t('notes.bodyPlaceholder')} value={body} onChange={(e) => setBody(e.target.value)} error={error} rows={4} maxLength={5000} name="note-body" />
      <TextArea label={t('notes.recommendations')} value={recs} onChange={(e) => setRecs(e.target.value)} rows={2} maxLength={2000} optionalLabel={t('common.optional')} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <fieldset className="flex items-center gap-1">
          <legend className="sr-only">{t('notes.performance')}</legend>
          <span className="mr-2 text-sm font-medium text-ink">{t('notes.performance')}</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onClick={() => setRating(rating === n ? null : n)} aria-pressed={rating !== null && n <= rating} aria-label={`${n}/5`} className="grid size-9 place-items-center rounded-lg hover:bg-sunken">
              <Star className={clsx('size-5', rating !== null && n <= rating ? 'fill-warn text-warn' : 'text-ink-3')} aria-hidden />
            </button>
          ))}
        </fieldset>
        <div role="radiogroup" aria-label={t('notes.visibility')} className="inline-flex rounded-xl bg-sunken p-1 text-sm">
          {(['private', 'shared'] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={visibility === v} onClick={() => setVisibility(v)} className={clsx('flex h-9 items-center gap-1.5 rounded-lg px-3 font-medium', visibility === v ? 'bg-surface-strong text-ink shadow-sm' : 'text-ink-3')} data-testid={`visibility-${v}`}>
              {v === 'private' ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
              {t(`notes.${v}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
        <Button type="submit" loading={saving} data-testid="note-save">
          {t('notes.save')}
        </Button>
      </div>
    </form>
  )
}
