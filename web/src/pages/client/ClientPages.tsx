import { clsx } from 'clsx'
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Dumbbell,
  MessageSquareText,
  NotebookPen,
  Smartphone,
  UserPlus,
  Users,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/Badge'
import { Button, buttonClass } from '@/components/ui/Button'
import { Card, CardHeader, PageHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorNotice } from '@/components/ui/ErrorNotice'
import { ConfirmModal } from '@/components/ui/Modal'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { useProfile } from '@/features/auth/AuthProvider'
import { CheckinCard } from '@/features/checkins/CheckinCard'
import { CheckinForm } from '@/features/checkins/CheckinForm'
import { HealthView } from '@/features/health/HealthView'
import { FeedbackModal } from '@/features/sessions/FeedbackForm'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { api, type SessionWithDetails } from '@/lib/api'
import { errorKey } from '@/lib/errors'
import { isSameLocalDay, useFormatters } from '@/lib/format'

function useClientData(clientId: string) {
  return useLiveQuery(
    `client-home:${clientId}`,
    async () => {
      const [relationships, sessions, checkins, notes, devices] = await Promise.all([
        api.myRelationships('client'),
        api.sessions({ clientId, limit: 100 }),
        api.checkins({ clientId, limit: 60 }),
        api.notes({ clientId }),
        api.devices(),
      ])
      return { relationships, sessions, checkins, notes, devices }
    },
    ['training_sessions', 'pre_session_checkins', 'trainer_notes', 'trainer_client_relationships', 'post_session_feedback', 'health_sync_devices'],
  )
}

export function ClientDashboard() {
  const { t, i18n } = useTranslation()
  const f = useFormatters(i18n.language)
  const me = useProfile()
  const q = useClientData(me.id)

  if (q.loading)
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton lines={5} />
      </div>
    )
  if (q.error || !q.data) return <ErrorNotice error={q.error} onRetry={() => void q.reload()} />
  const { relationships, sessions, checkins, devices } = q.data
  const active = relationships.filter((r) => r.status === 'active')
  const now = Date.now()
  const next = sessions.filter((s) => s.status === 'planned' && new Date(s.scheduled_at).getTime() > now - 2 * 3_600_000).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0]
  const latest = checkins[0]
  const todayDone = latest && isSameLocalDay(latest.created_at)
  const device = devices.find((d) => !d.revoked_at)

  return (
    <div>
      <PageHeader title={t('client.greeting', { name: me.display_name })} subtitle={f.date(new Date(), { weekday: 'long', month: 'long', day: 'numeric' })} />
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Today */}
        <Card className="lg:col-span-2">
          <CardHeader title={t('client.todayTitle')} icon={<CalendarClock className="size-5" />} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-sunken p-4">
              <div className="text-xs font-medium uppercase tracking-wider text-ink-3">{t('client.nextSession')}</div>
              {next ? (
                <>
                  <div className="mt-1 text-lg font-semibold text-ink">{next.title ?? t(`sessions.types.${next.session_type}`)}</div>
                  <div className="text-sm text-ink-2">
                    {f.dateTime(next.scheduled_at)} · {relationships.find((r) => r.trainer_id === next.trainer_id)?.peer?.display_name}
                  </div>
                </>
              ) : (
                <div className="mt-1 text-sm text-ink-3">{t('client.noSession')}</div>
              )}
            </div>
            <div className={clsx('flex flex-col justify-between gap-3 rounded-2xl p-4', todayDone ? 'bg-good-soft' : 'bg-accent-soft')}>
              {todayDone ? (
                <div className="flex items-center gap-2 font-semibold text-good">
                  <CheckCircle2 className="size-5" aria-hidden />
                  {t('client.checkedInToday')}
                </div>
              ) : (
                <div className="text-sm text-ink-2">{t('checkin.subtitle')}</div>
              )}
              {active.length > 0 ? (
                <Link to="/client/check-in" className={buttonClass(todayDone ? 'secondary' : 'primary', 'md', 'w-full')} data-testid="cta-checkin">
                  <ClipboardCheck className="size-5" aria-hidden />
                  {t('client.checkInCta')}
                </Link>
              ) : (
                <p className="text-sm text-ink-3">{t('checkin.noTrainer')}</p>
              )}
            </div>
          </div>
          {latest && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-ink">{t('checkin.latest')}</h3>
              <CheckinCard checkin={latest} />
            </div>
          )}
        </Card>

        {/* Apple Health status */}
        <Card>
          <CardHeader title={t('client.healthStatus')} icon={<Smartphone className="size-5" />} />
          {device?.last_sync_at ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-semibold text-ink">
                <span className={clsx('size-2.5 rounded-full', device.last_sync_status === 'error' ? 'bg-bad' : 'bg-good')} aria-hidden />
                {device.device_name}
              </div>
              <p className="text-sm text-ink-2">{t('client.lastSync', { time: f.relative(device.last_sync_at) })}</p>
            </div>
          ) : (
            <p className="text-sm text-ink-3">{t('client.neverSynced')}</p>
          )}
          <Link to="/client/health" className={buttonClass('secondary', 'sm', 'mt-4')}>
            <Activity className="size-4" aria-hidden />
            {t('nav.health')}
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        </Card>

        <TrainersCard relationships={relationships} onChanged={() => void q.reload()} />
      </div>
      <div className="mt-4">
        <HealthView userId={me.id} timeZone={me.time_zone} />
      </div>
    </div>
  )
}

function TrainersCard({ relationships, onChanged }: { relationships: Awaited<ReturnType<typeof api.myRelationships>>; onChanged: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [ending, setEnding] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const active = relationships.filter((r) => r.status === 'active')
  const confirm = async () => {
    if (!ending) return
    setBusy(true)
    try {
      await api.endRelationship(ending.id)
      toast.success(t('client.disconnected'))
      setEnding(null)
      onChanged()
    } catch (e) {
      toast.error(t(errorKey(e)))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="lg:col-span-3">
      <CardHeader
        title={t('client.trainers')}
        icon={<Users className="size-5" />}
        action={
          <Link to="/client/join" className={buttonClass('secondary', 'sm')} data-testid="join-trainer">
            <UserPlus className="size-4" aria-hidden />
            {t('client.joinTrainer')}
          </Link>
        }
      />
      {active.length === 0 ? (
        <EmptyState icon={<UserPlus className="size-6" />} title={t('client.noTrainers')} />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface-strong p-3">
              <div className="grid size-10 place-items-center rounded-full bg-accent-soft font-semibold text-accent">{r.peer?.display_name?.[0] ?? '?'}</div>
              <span className="flex-1 truncate font-medium text-ink">{r.peer?.display_name}</span>
              <Button size="sm" variant="ghost" onClick={() => setEnding({ id: r.id, name: r.peer?.display_name ?? '' })}>
                {t('client.disconnect')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmModal open={Boolean(ending)} onClose={() => setEnding(null)} onConfirm={() => void confirm()} title={t('client.disconnect')} body={t('client.disconnectConfirm', { name: ending?.name })} confirmLabel={t('client.disconnect')} loading={busy} />
    </Card>
  )
}

export function ClientCheckInPage() {
  const { t } = useTranslation()
  const me = useProfile()
  const q = useLiveQuery(`client-checkin:${me.id}`, async () => {
    const [relationships, sessions] = await Promise.all([api.myRelationships('client'), api.sessions({ clientId: me.id, limit: 50 })])
    return { relationships, sessions }
  })
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t('checkin.title')} subtitle={t('checkin.subtitle')} />
      {q.loading ? (
        <CardSkeleton lines={6} />
      ) : q.error || !q.data ? (
        <ErrorNotice error={q.error} onRetry={() => void q.reload()} />
      ) : q.data.relationships.filter((r) => r.status === 'active').length === 0 ? (
        <EmptyState
          icon={<UserPlus className="size-6" />}
          title={t('checkin.noTrainer')}
          action={
            <Link to="/client/join" className={buttonClass('primary')}>
              {t('client.joinTrainer')}
            </Link>
          }
        />
      ) : (
        <CheckinForm clientId={me.id} relationships={q.data.relationships} sessions={q.data.sessions} />
      )}
    </div>
  )
}

type TimelineItem =
  | { kind: 'session'; at: string; session: SessionWithDetails }
  | { kind: 'checkin'; at: string; checkin: Awaited<ReturnType<typeof api.checkins>>[number] }
  | { kind: 'note'; at: string; note: Awaited<ReturnType<typeof api.notes>>[number] }

export function ClientHistoryPage() {
  const { t, i18n } = useTranslation()
  const f = useFormatters(i18n.language)
  const me = useProfile()
  const q = useClientData(me.id)
  const [feedbackFor, setFeedbackFor] = useState<SessionWithDetails | null>(null)

  const items = useMemo<TimelineItem[]>(() => {
    if (!q.data) return []
    const now = Date.now()
    return [
      ...q.data.sessions.filter((s) => new Date(s.scheduled_at).getTime() <= now + 86_400_000).map((s) => ({ kind: 'session' as const, at: s.scheduled_at, session: s })),
      ...q.data.checkins.map((c) => ({ kind: 'checkin' as const, at: c.created_at, checkin: c })),
      ...q.data.notes.map((n) => ({ kind: 'note' as const, at: n.created_at, note: n })),
    ].sort((a, b) => b.at.localeCompare(a.at))
  }, [q.data])

  const trainerName = (id: string) => q.data?.relationships.find((r) => r.trainer_id === id)?.peer?.display_name ?? ''

  return (
    <div>
      <PageHeader title={t('client.historyTitle')} subtitle={t('client.historySubtitle')} />
      {q.loading ? (
        <CardSkeleton lines={6} />
      ) : q.error || !q.data ? (
        <ErrorNotice error={q.error} onRetry={() => void q.reload()} />
      ) : items.length === 0 ? (
        <EmptyState icon={<CalendarClock className="size-6" />} title={t('sessions.none')} />
      ) : (
        <ol className="relative ml-3 border-l border-line pl-6 sm:ml-4 sm:pl-8" data-testid="timeline">
          {items.map((it) => (
            <li key={`${it.kind}-${it.kind === 'session' ? it.session.id : it.kind === 'checkin' ? it.checkin.id : it.note.id}`} className="relative mb-5">
              <span className={clsx('absolute -left-[38px] top-4 grid size-7 place-items-center rounded-full ring-4 ring-[var(--bg)] sm:-left-[46px]', it.kind === 'session' ? 'bg-accent text-accent-contrast' : it.kind === 'checkin' ? 'bg-surface-strong text-ink-2 border border-line' : 'bg-demo-soft text-demo')} aria-hidden>
                {it.kind === 'session' ? <Dumbbell className="size-3.5" /> : it.kind === 'checkin' ? <ClipboardCheck className="size-3.5" /> : <NotebookPen className="size-3.5" />}
              </span>
              {it.kind === 'checkin' && <CheckinCard checkin={it.checkin} />}
              {it.kind === 'note' && (
                <article className="rounded-2xl border border-line bg-surface-strong p-4">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-ink">{t('notes.fromCoach')}</span>
                    <span className="text-ink-3">
                      · {trainerName(it.note.trainer_id)} · {f.dateTime(it.note.created_at)}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-ink-2">{it.note.body}</p>
                  {it.note.recommendations && <p className="mt-2 rounded-xl bg-sunken p-3 text-sm text-ink-2">{it.note.recommendations}</p>}
                </article>
              )}
              {it.kind === 'session' && <SessionCard session={it.session} trainerName={trainerName(it.session.trainer_id)} onFeedback={() => setFeedbackFor(it.session)} />}
            </li>
          ))}
        </ol>
      )}
      {feedbackFor && (
        <FeedbackModal open onClose={() => setFeedbackFor(null)} sessionId={feedbackFor.id} clientId={me.id} existing={feedbackFor.post_session_feedback[0]} onSaved={() => void q.reload()} />
      )}
    </div>
  )
}

export function SessionCard({ session, trainerName, onFeedback }: { session: SessionWithDetails; trainerName?: string; onFeedback?: () => void }) {
  const { t, i18n } = useTranslation()
  const f = useFormatters(i18n.language)
  const fb = session.post_session_feedback[0]
  const past = new Date(session.scheduled_at).getTime() < Date.now()
  const volume = session.session_exercises.reduce((s, e) => s + (e.sets ?? 0) * (e.reps ?? 0) * Number(e.weight_kg ?? 0), 0)
  return (
    <article className="rounded-2xl border border-line bg-surface-strong p-4" data-testid="session-card">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-ink">{session.title ?? t(`sessions.types.${session.session_type}`)}</div>
          <div className="text-sm text-ink-3">
            {f.dateTime(session.scheduled_at)}
            {trainerName ? ` · ${trainerName}` : ''}
            {session.duration_minutes ? ` · ${session.duration_minutes} ${t('health.units.min')}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={session.status === 'completed' ? 'good' : session.status === 'cancelled' ? 'neutral' : 'accent'}>{t(`sessions.statuses.${session.status}`)}</Badge>
          {session.actual_intensity && <Badge>RPE {session.actual_intensity}</Badge>}
        </div>
      </header>
      {session.session_exercises.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[280px] text-sm">
            <thead className="text-left text-xs text-ink-3">
              <tr>
                <th className="py-1 font-medium">{t('sessions.exerciseName')}</th>
                <th className="py-1 text-right font-medium">{t('sessions.sets')}</th>
                <th className="py-1 text-right font-medium">{t('sessions.reps')}</th>
                <th className="py-1 text-right font-medium">{t('sessions.weight')}</th>
              </tr>
            </thead>
            <tbody>
              {session.session_exercises.map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td className="py-1.5 text-ink">{e.name}</td>
                  <td className="py-1.5 text-right tabular text-ink-2">{e.sets ?? '—'}</td>
                  <td className="py-1.5 text-right tabular text-ink-2">{e.reps ?? '—'}</td>
                  <td className="py-1.5 text-right tabular text-ink-2">{e.weight_kg ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {volume > 0 && (
            <p className="mt-1 text-xs text-ink-3">
              {t('sessions.volume')}: <span className="tabular">{f.num(volume)}</span> kg
            </p>
          )}
        </div>
      )}
      {fb ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-sunken p-3 text-sm">
          <MessageSquareText className="size-4 text-ink-3" aria-hidden />
          <span className="font-medium text-ink">{t('feedback.given')}</span>
          <span className="text-ink-2">
            RPE {fb.session_rpe}/10 · {t('feedback.enjoyment')} {fb.enjoyment}/5 · {t('feedback.pain')} {fb.pain_level}/10
          </span>
          {fb.comments && <p className="w-full text-ink-2">{fb.comments}</p>}
          {onFeedback && (
            <button type="button" className="ml-auto text-xs font-medium text-accent hover:underline" onClick={onFeedback}>
              {t('common.edit')}
            </button>
          )}
        </div>
      ) : (
        past &&
        onFeedback &&
        session.status !== 'cancelled' && (
          <Button size="sm" variant="secondary" className="mt-3" icon={<MessageSquareText className="size-4" />} onClick={onFeedback} data-testid="give-feedback">
            {t('feedback.give')}
          </Button>
        )
      )}
    </article>
  )
}

export function ClientHealthPage() {
  const { t } = useTranslation()
  const me = useProfile()
  return (
    <div>
      <PageHeader title={t('health.title')} subtitle={t('health.subtitle')} />
      <div className="flex flex-col gap-4">
        <HealthView userId={me.id} timeZone={me.time_zone} />
        <Card>
          <CardHeader title={t('health.howToConnect')} icon={<Smartphone className="size-5" />} />
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink-2">
            {(t('health.howSteps', { returnObjects: true }) as string[]).map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-ink-3">{t('health.webNote')}</p>
        </Card>
      </div>
    </div>
  )
}
