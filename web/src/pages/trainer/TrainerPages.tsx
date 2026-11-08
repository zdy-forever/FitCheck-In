import { clsx } from 'clsx'
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Link2,
  Lock,
  Mail,
  Pencil,
  Plus,
  Radio,
  Search,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Badge } from '@/components/ui/Badge'
import { Button, buttonClass } from '@/components/ui/Button'
import { Card, CardHeader, PageHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorNotice } from '@/components/ui/ErrorNotice'
import { TextArea, TextField } from '@/components/ui/Field'
import { ConfirmModal, Modal } from '@/components/ui/Modal'
import { Segmented } from '@/components/ui/Segmented'
import { CardSkeleton, Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { useProfile } from '@/features/auth/AuthProvider'
import { attentionReasons, CheckinCard } from '@/features/checkins/CheckinCard'
import { HealthGlance, HealthView } from '@/features/health/HealthView'
import { NoteEditor } from '@/features/sessions/NoteEditor'
import { SessionEditor } from '@/features/sessions/SessionEditor'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { api, type Note, type SessionWithDetails } from '@/lib/api'
import { appUrl } from '@/lib/env'
import { errorKey } from '@/lib/errors'
import { isSameLocalDay, useFormatters } from '@/lib/format'
import { SessionCard } from '../client/ClientPages'

type OverviewRow = Awaited<ReturnType<typeof api.trainerOverview>>[number]

function useOverview(trainerId: string) {
  return useLiveQuery(
    `overview:${trainerId}`,
    async () => {
      const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
      const [clients, sessions, recentCheckins] = await Promise.all([
        api.trainerOverview(),
        api.sessions({ from: new Date(Date.now() - 14 * 86_400_000).toISOString(), limit: 100 }),
        api.checkins({ trainerId, limit: 50 }),
      ])
      return { clients, sessions, recentCheckins: recentCheckins.filter((c) => c.created_at >= weekAgo || !c.reviewed_at) }
    },
    ['pre_session_checkins', 'training_sessions', 'trainer_client_relationships', 'health_sharing_permissions', 'post_session_feedback'],
  )
}

function LivePulse({ at }: { at: number | null }) {
  const { t } = useTranslation()
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-good-soft px-2.5 py-1 text-xs font-semibold text-good" title={t('trainer.liveBadge')}>
      <span className="relative flex size-2">
        <span key={at ?? 0} className="absolute inline-flex size-full animate-ping rounded-full bg-good opacity-75" />
        <span className="relative inline-flex size-2 rounded-full bg-good" />
      </span>
      {t('trainer.liveBadge')}
    </span>
  )
}

export function TrainerDashboard() {
  const reduceMotion = useReducedMotion()
  const { t, i18n } = useTranslation()
  const f = useFormatters(i18n.language)
  const me = useProfile()
  const q = useOverview(me.id)

  if (q.loading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <CardSkeleton lines={5} />
      </div>
    )
  if (q.error || !q.data) return <ErrorNotice error={q.error} onRetry={() => void q.reload()} />

  const { clients, sessions, recentCheckins } = q.data
  const todaySessions = sessions.filter((s) => isSameLocalDay(s.scheduled_at) && s.status !== 'cancelled')
  const pending = recentCheckins.filter((c) => !c.reviewed_at)
  const reviewed7 = recentCheckins.filter((c) => c.reviewed_at && Date.now() - new Date(c.reviewed_at).getTime() < 7 * 86_400_000)
  const nameOf = (id: string) => clients.find((c) => c.client_id === id)?.display_name ?? ''
  const attention = clients
    .filter((c) => c.latest_checkin_at && Date.now() - new Date(c.latest_checkin_at).getTime() < 3 * 86_400_000)
    .map((c) => ({
      c,
      reasons: attentionReasons({ pain_level: c.latest_checkin_pain, energy_level: c.latest_checkin_energy, sleep_quality: c.latest_checkin_sleep, muscle_soreness: c.latest_checkin_soreness }),
    }))
    .filter((x) => x.reasons.length > 0)

  const stats = [
    { label: t('trainer.stats.clients'), value: clients.length, Icon: Users },
    { label: t('trainer.stats.today'), value: new Set(todaySessions.map((s) => s.client_id)).size, Icon: CalendarDays },
    { label: t('trainer.stats.pending'), value: pending.length, Icon: ClipboardCheck, accent: pending.length > 0 },
    { label: t('trainer.stats.reviewed'), value: reviewed7.length, Icon: CheckCircle2 },
  ]

  return (
    <div>
      <PageHeader title={t('trainer.overviewTitle', { name: me.display_name })} subtitle={t('trainer.overviewSubtitle')} action={<LivePulse at={q.liveAt} />} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(({ label, value, Icon, accent }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            // Motion owns this element's transform (entrance), so hover/tap lift is done here too.
            whileHover={reduceMotion ? undefined : { y: -4, boxShadow: 'var(--shadow-lg)' }}
            whileTap={reduceMotion ? undefined : { scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 26, delay: i * 0.05 }}
            className={clsx('group card p-4 transition-colors hover:border-accent-ring sm:p-5', accent && 'ring-2 ring-accent/40')}
            data-testid={`stat-${i}`}
          >
            <div className="flex items-center justify-between text-sm text-ink-3">
              <span className="truncate">{label}</span>
              <Icon className={clsx('pop-icon size-4 shrink-0', accent ? 'text-accent' : '')} aria-hidden />
            </div>
            <div className="mt-2 font-display text-4xl font-semibold tracking-tight text-ink">
              <AnimatedNumber value={value} />
            </div>
          </motion.div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={t('trainer.recentCheckins')} icon={<ClipboardCheck className="size-5" />} />
          {recentCheckins.length === 0 ? (
            <p className="text-sm text-ink-3">{t('checkin.noneYet')}</p>
          ) : (
            <ul className="stagger flex flex-col gap-3" data-testid="recent-checkins">
              {recentCheckins.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <Link to={`/trainer/clients/${c.client_id}?tab=checkins`} className="group mb-1 inline-flex items-center gap-1 text-sm font-semibold text-ink transition-colors hover:text-accent">
                    {nameOf(c.client_id)}
                    <ChevronRight className="nudge-x size-4" aria-hidden />
                  </Link>
                  <CheckinCard checkin={c} canReview compact highlight={q.liveAt !== null && Date.now() - new Date(c.created_at).getTime() < 60_000} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title={t('trainer.attention')} icon={<AlertTriangle className="size-5" />} />
            {attention.length === 0 ? (
              <p className="text-sm text-ink-3">{t('trainer.attentionNone')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {attention.map(({ c, reasons }) => (
                  <li key={c.client_id}>
                    <Link to={`/trainer/clients/${c.client_id}`} className="lift block rounded-2xl border border-line bg-surface-strong p-3">
                      <div className="font-medium text-ink">{c.display_name}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {reasons.map((r) => (
                          <Badge key={r.key} tone="warn">
                            {t(`trainer.attentionReasons.${r.key}`, { value: r.value })}
                          </Badge>
                        ))}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title={t('trainer.recent')} icon={<CalendarDays className="size-5" />} />
            {sessions.length === 0 ? (
              <p className="text-sm text-ink-3">{t('sessions.none')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {sessions.slice(0, 6).map((s) => (
                  <li key={s.id} className="row-hover -mx-2 flex items-center justify-between gap-2 rounded-xl px-2 py-2.5 text-sm">
                    <Link to={`/trainer/clients/${s.client_id}?tab=sessions`} className="min-w-0">
                      <div className="truncate font-medium text-ink">{s.client?.display_name}</div>
                      <div className="truncate text-xs text-ink-3">{s.title ?? t(`sessions.types.${s.session_type}`)}</div>
                    </Link>
                    <span className="shrink-0 text-xs text-ink-3">{f.weekdayShort(s.scheduled_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

type Filter = 'all' | 'pending' | 'attention'
type Sort = 'name' | 'recent' | 'session'

export function TrainerClientsPage() {
  const { t, i18n } = useTranslation()
  const f = useFormatters(i18n.language)
  const me = useProfile()
  const q = useOverview(me.id)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('recent')

  const rows = useMemo(() => {
    let list: OverviewRow[] = q.data?.clients ?? []
    const s = search.trim().toLowerCase()
    if (s) list = list.filter((c) => c.display_name.toLowerCase().includes(s))
    if (filter === 'pending') list = list.filter((c) => c.unreviewed_checkins > 0)
    if (filter === 'attention')
      list = list.filter((c) => c.latest_checkin_at && attentionReasons({ pain_level: c.latest_checkin_pain, energy_level: c.latest_checkin_energy, sleep_quality: c.latest_checkin_sleep, muscle_soreness: c.latest_checkin_soreness }).length > 0)
    const by = (k: 'latest_checkin_at' | 'last_session_at') => (a: OverviewRow, b: OverviewRow) => (b[k] ?? '').localeCompare(a[k] ?? '')
    return [...list].sort(sort === 'name' ? (a, b) => a.display_name.localeCompare(b.display_name, f.locale) : sort === 'recent' ? by('latest_checkin_at') : by('last_session_at'))
  }, [q.data, search, filter, sort, f.locale])

  return (
    <div>
      <PageHeader
        title={t('trainer.clientList')}
        action={
          <Link to="/trainer/invitations" className={buttonClass('primary')}>
            <UserPlus className="size-5" aria-hidden />
            {t('invitations.create')}
          </Link>
        }
      />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <label className="relative block w-full lg:max-w-sm">
          <span className="sr-only">{t('common.search')}</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('trainer.searchPlaceholder')} className="h-11 w-full rounded-2xl border border-line bg-surface-strong pl-10 pr-4 text-md outline-none focus:border-accent focus:ring-4 focus:ring-accent-soft" data-testid="client-search" />
        </label>
        <div className="flex flex-wrap gap-2">
          <Segmented label="filter" value={filter} onChange={setFilter} options={[{ value: 'all', label: t('trainer.filterAll') }, { value: 'pending', label: t('trainer.filterPending') }, { value: 'attention', label: t('trainer.filterAttention') }]} size="sm" />
          <Segmented label="sort" value={sort} onChange={setSort} options={[{ value: 'recent', label: t('trainer.sortRecent') }, { value: 'session', label: t('trainer.sortSession') }, { value: 'name', label: t('trainer.sortName') }]} size="sm" />
        </div>
      </div>
      {q.loading ? (
        <CardSkeleton lines={6} />
      ) : q.error || !q.data ? (
        <ErrorNotice error={q.error} onRetry={() => void q.reload()} />
      ) : q.data.clients.length === 0 ? (
        <EmptyState
          icon={<Users className="size-6" />}
          title={t('trainer.noClients')}
          body={t('trainer.noClientsBody')}
          action={
            <Link to="/trainer/invitations" className={buttonClass('primary')}>
              {t('invitations.create')}
            </Link>
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="card hidden overflow-hidden md:block">
            <table className="w-full text-sm" data-testid="client-table">
              <thead className="border-b border-line bg-sunken/60 text-left text-xs uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-5 py-3 font-medium">{t('trainer.columns.name')}</th>
                  <th className="px-3 py-3 font-medium">{t('trainer.columns.lastSession')}</th>
                  <th className="px-3 py-3 font-medium">{t('trainer.columns.latestCheckin')}</th>
                  <th className="px-3 py-3 font-medium">{t('trainer.columns.state')}</th>
                  <th className="px-3 py-3 font-medium">{t('trainer.columns.health')}</th>
                  <th className="px-3 py-3 font-medium">{t('trainer.columns.reviewed')}</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="stagger">
                {rows.map((c) => (
                  <ClientRow key={c.client_id} c={c} />
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile cards */}
          <ul className="stagger flex flex-col gap-2 md:hidden">
            {rows.map((c) => (
              <li key={c.client_id}>
                <Link to={`/trainer/clients/${c.client_id}`} className="group card lift flex items-center gap-3 p-4">
                  <div className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft font-semibold text-accent">{c.display_name[0]}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-semibold text-ink">
                      <span className="truncate">{c.display_name}</span>
                      {c.unreviewed_checkins > 0 && <span className="size-2 shrink-0 rounded-full bg-accent" aria-label={t('checkin.pending')} />}
                    </div>
                    <div className="truncate text-xs text-ink-3">
                      {c.latest_checkin_at ? `${t('trainer.columns.latestCheckin')}: ${f.relative(c.latest_checkin_at)}` : t('checkin.noneYet')}
                    </div>
                    <StateChips c={c} />
                  </div>
                  <ChevronRight className="nudge-x size-5 text-ink-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function StateChips({ c }: { c: OverviewRow }) {
  const { t } = useTranslation()
  if (!c.latest_checkin_at) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1 text-2xs">
      <span className="rounded-md bg-sunken px-1.5 py-0.5 text-ink-2">
        {t('checkin.energy')} {c.latest_checkin_energy}/5
      </span>
      <span className="rounded-md bg-sunken px-1.5 py-0.5 text-ink-2">
        {t('checkin.sleepQuality')} {c.latest_checkin_sleep}/5
      </span>
      <span className={clsx('rounded-md px-1.5 py-0.5', c.latest_checkin_pain >= 4 ? 'bg-warn-soft text-warn' : 'bg-sunken text-ink-2')}>
        {t('checkin.pain')} {c.latest_checkin_pain}/10
      </span>
    </div>
  )
}

function ClientRow({ c }: { c: OverviewRow }) {
  const { t, i18n } = useTranslation()
  const f = useFormatters(i18n.language)
  const navigate = useNavigate()
  return (
    <tr className="group row-hover cursor-pointer border-b border-line last:border-0" onClick={() => navigate(`/trainer/clients/${c.client_id}`)}>
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-3">
          <div className="pop-icon grid size-9 place-items-center rounded-full bg-accent-soft font-semibold text-accent">{c.display_name[0]}</div>
          <span className="font-medium text-ink transition-colors group-hover:text-accent">{c.display_name}</span>
        </div>
      </td>
      <td className="px-3 py-3.5 text-ink-2">{c.last_session_at ? f.date(c.last_session_at) : '—'}</td>
      <td className="px-3 py-3.5 text-ink-2">{c.latest_checkin_at ? f.relative(c.latest_checkin_at) : '—'}</td>
      <td className="px-3 py-3.5">
        <StateChips c={c} />
      </td>
      <td className="px-3 py-3.5 text-xs">
        {c.health_shared ? (
          <span className="text-ink-2">{c.health_last_sync_at ? t('trainer.healthShared', { time: f.relative(c.health_last_sync_at) }) : t('trainer.healthSharedNever')}</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-ink-3">
            <Lock className="size-3" aria-hidden />
            {t('trainer.healthNotShared')}
          </span>
        )}
      </td>
      <td className="px-3 py-3.5">
        {!c.latest_checkin_id ? (
          <span className="text-ink-3">—</span>
        ) : c.unreviewed_checkins > 0 ? (
          <Badge tone="accent">
            {t('checkin.pending')} · {c.unreviewed_checkins}
          </Badge>
        ) : (
          <Badge tone="good">{t('checkin.reviewed')}</Badge>
        )}
      </td>
      <td className="px-5 py-3.5 text-right">
        <Link to={`/trainer/clients/${c.client_id}`} className="text-sm font-medium text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
          {t('common.viewDetails')}
        </Link>
      </td>
    </tr>
  )
}

type Tab = 'overview' | 'checkins' | 'health' | 'sessions' | 'notes'

export function TrainerClientDetail() {
  const { t, i18n } = useTranslation()
  const f = useFormatters(i18n.language)
  const { clientId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const me = useProfile()
  const toast = useToast()
  const navigate = useNavigate()
  const tab = (params.get('tab') as Tab) || 'overview'
  const setTab = (v: Tab) => setParams({ tab: v }, { replace: true })
  const [editing, setEditing] = useState<SessionWithDetails | null | 'new'>(null)
  const [editingNote, setEditingNote] = useState<Note | null>(null)
  const [ending, setEnding] = useState(false)
  const [busy, setBusy] = useState(false)

  const q = useLiveQuery(
    `client-detail:${clientId}`,
    async () => {
      const [profile, overview, checkins, sessions, notes] = await Promise.all([
        api.peerProfile(clientId),
        api.trainerOverview(),
        api.checkins({ clientId, trainerId: me.id, limit: 100 }),
        api.sessions({ clientId, limit: 100 }),
        api.notes({ clientId }),
      ])
      return { profile, rel: overview.find((r) => r.client_id === clientId) ?? null, checkins, sessions, notes }
    },
    ['pre_session_checkins', 'training_sessions', 'trainer_notes', 'post_session_feedback', 'trainer_client_relationships', 'health_sharing_permissions'],
  )

  useEffect(() => {
    if (q.data && !q.data.rel) navigate('/trainer/clients', { replace: true })
  }, [q.data, navigate])

  if (q.loading) return <CardSkeleton lines={6} />
  if (q.error || !q.data) return <ErrorNotice error={q.error} onRetry={() => void q.reload()} />
  const { profile, rel, checkins, sessions, notes } = q.data
  if (!rel) return null

  const endRel = async () => {
    setBusy(true)
    try {
      await api.endRelationship(rel.relationship_id)
      toast.success(t('trainer.ended'))
      navigate('/trainer/clients', { replace: true })
    } catch (e) {
      toast.error(t(errorKey(e)))
    } finally {
      setBusy(false)
    }
  }

  const tabs: { value: Tab; label: string }[] = (['overview', 'checkins', 'health', 'sessions', 'notes'] as const).map((v) => ({ value: v, label: t(`trainer.tabs.${v}`) }))

  return (
    <div>
      <Link to="/trainer/clients" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        {t('trainer.clientList')}
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="grid size-16 place-items-center rounded-[22px] bg-accent-soft font-display text-2xl font-semibold text-accent">{profile.display_name[0]}</div>
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-ink" data-testid="client-name">
              {profile.display_name}
            </h1>
            <p className="text-sm text-ink-3">
              {t('trainer.clientSince', { date: f.date(rel.started_at) })} · {profile.time_zone}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')} data-testid="new-session">
            {t('sessions.new')}
          </Button>
          <Button variant="ghost" icon={<UserMinus className="size-4" />} onClick={() => setEnding(true)}>
            <span className="hidden sm:inline">{t('trainer.endRelationship')}</span>
          </Button>
        </div>
      </div>
      {profile.bio && <p className="mb-4 max-w-2xl text-ink-2">{profile.bio}</p>}
      <div className="mb-5">
        <Segmented label={t('trainer.profileTitle')} value={tab} onChange={setTab} options={tabs} />
      </div>

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title={t('checkin.latest')} icon={<ClipboardCheck className="size-5" />} />
            {checkins[0] ? <CheckinCard checkin={checkins[0]} canReview /> : <p className="text-sm text-ink-3">{t('checkin.noneYet')}</p>}
          </Card>
          <Card>
            <CardHeader title={t('notes.new')} icon={<Pencil className="size-5" />} />
            <NoteEditor trainerId={me.id} clientId={clientId} sessions={sessions} onSaved={() => void q.reload()} />
          </Card>
          <div className="lg:col-span-2">
            <HealthGlance userId={clientId} viewerTrainerId={me.id} healthHref={`/trainer/clients/${clientId}?tab=health`} />
          </div>
        </div>
      )}
      {tab === 'checkins' && (
        <div className="flex flex-col gap-3">
          {checkins.length === 0 ? <EmptyState icon={<ClipboardCheck className="size-6" />} title={t('checkin.noneYet')} /> : checkins.map((c) => <CheckinCard key={c.id} checkin={c} canReview />)}
        </div>
      )}
      {tab === 'health' && <HealthView userId={clientId} timeZone={profile.time_zone} viewerTrainerId={me.id} lastSyncAt={rel.health_last_sync_at} />}
      {tab === 'sessions' && (
        <div className="flex flex-col gap-3">
          {sessions.length === 0 ? (
            <EmptyState icon={<CalendarDays className="size-6" />} title={t('sessions.none')} />
          ) : (
            sessions.map((s) => (
              <SessionCard key={s.id} session={s} onEdit={() => setEditing(s)} />
            ))
          )}
        </div>
      )}
      {tab === 'notes' && (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <Card>
            <CardHeader title={editingNote ? t('common.edit') : t('notes.new')} icon={<Pencil className="size-5" />} />
            <NoteEditor key={editingNote?.id ?? 'new'} trainerId={me.id} clientId={clientId} sessions={sessions} note={editingNote} onSaved={() => { setEditingNote(null); void q.reload() }} onCancel={editingNote ? () => setEditingNote(null) : undefined} />
          </Card>
          <div className="stagger flex flex-col gap-3" data-testid="notes-list">
            {notes.length === 0 ? (
              <EmptyState title={t('notes.none')} />
            ) : (
              notes.map((n) => (
                <article key={n.id} className="card lift p-4">
                  <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-ink-3">{f.dateTime(n.created_at)}</span>
                    <div className="flex items-center gap-1">
                      <Badge tone={n.visibility === 'shared' ? 'accent' : 'neutral'}>{t(`notes.${n.visibility}`)}</Badge>
                      {n.performance_rating && <Badge>★ {n.performance_rating}/5</Badge>}
                      <button type="button" onClick={() => setEditingNote(n)} className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-sunken hover:text-ink" aria-label={t('common.edit')}>
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await api.deleteNote(n.id)
                            toast.success(t('notes.deleted'))
                            void q.reload()
                          } catch (e) {
                            toast.error(t(errorKey(e)))
                          }
                        }}
                        className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-bad-soft hover:text-bad"
                        aria-label={t('common.delete')}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </header>
                  <p className="whitespace-pre-wrap text-ink">{n.body}</p>
                  {n.recommendations && <p className="mt-2 rounded-xl bg-sunken p-3 text-sm text-ink-2">{n.recommendations}</p>}
                </article>
              ))
            )}
          </div>
        </div>
      )}

      {editing && (
        <SessionEditor open onClose={() => setEditing(null)} trainerId={me.id} clients={[{ id: clientId, name: profile.display_name }]} session={editing === 'new' ? null : editing} defaultClientId={clientId} onSaved={() => void q.reload()} />
      )}
      <ConfirmModal open={ending} onClose={() => setEnding(false)} onConfirm={() => void endRel()} title={t('trainer.endRelationship')} body={t('trainer.endConfirm', { name: profile.display_name })} confirmLabel={t('trainer.endRelationship')} loading={busy} />
    </div>
  )
}

export function TrainerSessionsPage() {
  const { t } = useTranslation()
  const me = useProfile()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<SessionWithDetails | null>(null)
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming')
  const q = useLiveQuery(
    `trainer-sessions:${me.id}`,
    async () => {
      const [sessions, clients] = await Promise.all([api.sessions({ limit: 200 }), api.trainerOverview()])
      return { sessions, clients }
    },
    ['training_sessions', 'post_session_feedback'],
  )
  const now = Date.now()
  const list = (q.data?.sessions ?? []).filter((s) => (view === 'upcoming' ? new Date(s.scheduled_at).getTime() >= now - 3_600_000 : new Date(s.scheduled_at).getTime() < now - 3_600_000))
  if (view === 'upcoming') list.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
  const clients = (q.data?.clients ?? []).map((c) => ({ id: c.client_id, name: c.display_name }))

  return (
    <div>
      <PageHeader
        title={t('sessions.title')}
        action={
          <Button icon={<Plus className="size-5" />} onClick={() => setCreating(true)} disabled={clients.length === 0}>
            {t('sessions.new')}
          </Button>
        }
      />
      <div className="mb-4">
        <Segmented label={t('sessions.title')} value={view} onChange={setView} options={[{ value: 'upcoming', label: t('sessions.upcoming') }, { value: 'past', label: t('sessions.past') }]} />
      </div>
      {q.loading ? (
        <CardSkeleton lines={5} />
      ) : q.error ? (
        <ErrorNotice error={q.error} onRetry={() => void q.reload()} />
      ) : list.length === 0 ? (
        <EmptyState icon={<CalendarDays className="size-6" />} title={t('sessions.none')} />
      ) : (
        <div className="stagger grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {list.map((s) => (
            <SessionCard key={s.id} session={s} trainerName={s.client?.display_name ?? undefined} onEdit={() => setEditing(s)} />
          ))}
        </div>
      )}
      {(creating || editing) && <SessionEditor open onClose={() => { setCreating(false); setEditing(null) }} trainerId={me.id} clients={clients} session={editing} onSaved={() => void q.reload()} />}
    </div>
  )
}

export function TrainerInvitationsPage() {
  const { t, i18n } = useTranslation()
  const f = useFormatters(i18n.language)
  const me = useProfile()
  const toast = useToast()
  const q = useLiveQuery(`invitations:${me.id}`, () => api.invitations(), ['trainer_client_relationships'])
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [emailErr, setEmailErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ code: string } | null>(null)

  const linkFor = (code: string) => appUrl(`/invite/${code}`)
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('common.copied'))
    } catch {
      /* ignore */
    }
  }

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setEmailErr(t('validation.email'))
      return
    }
    setEmailErr(null)
    setBusy(true)
    try {
      const inv = await api.createInvitation(me.id, { invitee_email: email.trim() || null, note: note.trim() || null })
      setCreated({ code: inv.code })
      setEmail('')
      setNote('')
      toast.success(t('invitations.created'))
      void q.reload()
    } catch (er) {
      toast.error(t(errorKey(er)))
    } finally {
      setBusy(false)
    }
  }

  const statusOf = (i: { status: string; expires_at: string }) => (i.status === 'pending' && new Date(i.expires_at).getTime() < Date.now() ? 'expired' : i.status)

  return (
    <div>
      <PageHeader
        title={t('invitations.title')}
        action={
          <Button icon={<UserPlus className="size-5" />} onClick={() => { setCreated(null); setOpen(true) }} data-testid="create-invite">
            {t('invitations.create')}
          </Button>
        }
      />
      {q.loading ? (
        <CardSkeleton />
      ) : q.error || !q.data ? (
        <ErrorNotice error={q.error} onRetry={() => void q.reload()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={<Mail className="size-6" />} title={t('invitations.none')} body={t('trainer.noClientsBody')} />
      ) : (
        <ul className="stagger grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="invite-list">
          {q.data.map((i) => {
            const st = statusOf(i)
            return (
              <li key={i.id} className="card lift flex flex-col gap-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <code className="font-mono text-xl font-semibold tracking-[0.2em] text-ink" data-testid="invite-code-value">
                    {i.code}
                  </code>
                  <Badge tone={st === 'pending' ? 'accent' : st === 'accepted' ? 'good' : 'neutral'}>{t(`invitations.statuses.${st}`)}</Badge>
                </div>
                <div className="text-xs text-ink-3">
                  {i.invitee_email && <div>{i.invitee_email}</div>}
                  {st === 'pending' && <div>{t('invitations.expires', { date: f.date(i.expires_at) })}</div>}
                </div>
                {st === 'pending' && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" icon={<Copy className="size-4" />} onClick={() => void copy(i.code)}>
                      {t('invitations.code')}
                    </Button>
                    <Button size="sm" variant="secondary" icon={<Link2 className="size-4" />} onClick={() => void copy(linkFor(i.code))}>
                      {t('invitations.link')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await api.revokeInvitation(i.id)
                          toast.success(t('invitations.revoked'))
                          void q.reload()
                        } catch (e) {
                          toast.error(t(errorKey(e)))
                        }
                      }}
                    >
                      {t('invitations.revoke')}
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('invitations.create')}>
        {created ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <Radio className="size-10 text-accent" aria-hidden />
            <code className="font-mono text-3xl font-semibold tracking-[0.25em] text-ink" data-testid="new-invite-code">
              {created.code}
            </code>
            <p className="break-all text-sm text-ink-3">{linkFor(created.code)}</p>
            <div className="flex gap-2">
              <Button variant="secondary" icon={<Copy className="size-4" />} onClick={() => void copy(created.code)}>
                {t('invitations.code')}
              </Button>
              <Button icon={<Link2 className="size-4" />} onClick={() => void copy(linkFor(created.code))}>
                {t('invitations.link')}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void create(e)} noValidate className="flex flex-col gap-4">
            <TextField label={t('invitations.email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} hint={t('invitations.emailHint')} error={emailErr} />
            <TextArea label={t('invitations.note')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} rows={2} />
            <Button type="submit" loading={busy} data-testid="invite-submit">
              {t('invitations.create')}
            </Button>
          </form>
        )}
      </Modal>
    </div>
  )
}
