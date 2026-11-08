import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { TextArea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Scale } from '@/components/ui/Scale'
import { useToast } from '@/components/ui/Toast'
import { api, type Feedback } from '@/lib/api'
import { errorKey } from '@/lib/errors'

export function FeedbackModal({ open, onClose, sessionId, clientId, existing, onSaved }: { open: boolean; onClose: () => void; sessionId: string; clientId: string; existing?: Feedback | null; onSaved?: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [rpe, setRpe] = useState<number | null>(existing?.session_rpe ?? null)
  const [enjoyment, setEnjoyment] = useState<number | null>(existing?.enjoyment ?? null)
  const [pain, setPain] = useState<number | null>(existing?.pain_level ?? null)
  const [comments, setComments] = useState(existing?.comments ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (rpe === null) errs.rpe = t('validation.range', { min: 1, max: 10 })
    if (enjoyment === null) errs.enjoyment = t('validation.range', { min: 1, max: 5 })
    if (pain === null) errs.pain = t('validation.range', { min: 0, max: 10 })
    setErrors(errs)
    if (Object.keys(errs).length) return
    setSaving(true)
    try {
      await api.submitFeedback({ session_id: sessionId, client_id: clientId, session_rpe: rpe!, enjoyment: enjoyment!, pain_level: pain!, pain_areas: [], comments: comments.trim() || null }, existing?.id)
      toast.success(t('feedback.success'))
      onSaved?.()
      onClose()
    } catch (er) {
      toast.error(t(errorKey(er)))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('feedback.title')}>
      <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-6" data-testid="feedback-form">
        <Scale name="rpe" tone="severity" label={t('feedback.rpe')} min={1} max={10} value={rpe} onChange={setRpe} hint={t('feedback.rpeHint')} error={errors.rpe} />
        <Scale name="enjoyment" label={t('feedback.enjoyment')} min={1} max={5} value={enjoyment} onChange={setEnjoyment} error={errors.enjoyment} />
        <Scale name="fpain" tone="severity" label={t('feedback.pain')} min={0} max={10} value={pain} onChange={setPain} hint={t('checkin.scale.pain')} error={errors.pain} />
        <TextArea label={t('feedback.comments')} value={comments} onChange={(e) => setComments(e.target.value)} optionalLabel={t('common.optional')} maxLength={1000} />
        <Button type="submit" loading={saving} size="lg" data-testid="feedback-submit">
          {t('feedback.submit')}
        </Button>
      </form>
    </Modal>
  )
}
