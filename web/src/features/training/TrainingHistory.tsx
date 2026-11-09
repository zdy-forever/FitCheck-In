import { clsx } from 'clsx'
import { ChevronDown, Dumbbell, Flame, HeartPulse, Lock, Route, Table2, Timer, Watch } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorNotice } from '@/components/ui/ErrorNotice'
import { Segmented } from '@/components/ui/Segmented'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { DemoBadge } from '@/features/health/HealthPanels'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { api } from '@/lib/api'
import { useFormatters } from '@/lib/format'
import { buildTrainingLog, entryHappened, entryMinutes, periodTotals, type TrainingEntry, type WatchWorkout } from './trainingLog'

type Filter = 'all' | 'coach' | 'solo'
type Period = 'week' | 'month'

/**
 * Training history for one client: coach sessions merged with Apple Watch workouts.
 * For a trainer, workouts only appear when the client shares "Workouts" (RLS returns none
 * otherwise) and only sessions with this trainer are listed (RLS on training_sessions).
 */
export function TrainingHistory({ clientId, timeZone, viewerTrainerId }: { clientId: string; timeZone: string; viewerTrainerId?: string }) {
  const { t, i18n } = useTranslation()
  const f = useFormatters(i18n.language)
  const [period, setPeriod] = useState<Period>('week')
  const [filter, setFilter] = useState<Filter>('all')
  const [kind, setKind] = useState<string>('all')
  const [table, setTable] = useState(false)
  const [shown, setShown] = useState(30)

  const q = useLiveQuery(
    `training:${clientId}:${viewerTrainerId ?? 'self'}`,
    async () => {
      const [sessions, workouts, sharing] = await Promise.all([
        api.sessions({ clientId, limit: 1000, from: new Date(Date.now() - 400 * 86_400_000).toISOString() }),
        api.workouts(clientId),
        viewerTrainerId ? api.sharing({ clientId, trainerId: viewerTrainerId }) : Promise.resolve(null),
      ])
      return { sessions, workouts, sharing }
    },
    ['training_sessions', 'post_session_feedback', 'health_snapshots', 'health_sharing_permissions'],
  )

  const log = useMemo(() => (q.data ? buildTrainingLog(q.data.sessions, q.data.workouts) : []), [q.data])
  const buckets = useMemo(() => periodTotals(log, period, 12, timeZone), [log, period, timeZone])

  if (q.loading) return <CardSkeleton lines={6} />
  if (q.error || !q.data) return <ErrorNotice error={q.error} onRetry={() => void q.reload()} />

  const workoutsShared = !q.data.sharing || q.data.sharing.some((s) => s.category === 'workouts' && s.granted)
  const isDemo = q.data.workouts.some((w) => w.origin === 'demo')
  const kindOf = (e: TrainingEntry) => e.watch?.kind ?? (e.type === 'session' ? `session:${e.session.session_type}` : 'mixed')
  const kinds = [...new Set(log.filter((e) => e.watch).map((e) => e.watch!.kind))].sort()
  const visible = log.filter((e) => (filter === 'all' || (filter === 'coach' ? e.type === 'session' : e.type === 'solo')) && (kind === 'all' || kindOf(e) === kind))

  // Headline numbers for the last 4 weeks (what a coach asks first: how often, how long).
  const since = Date.now() - 28 * 86_400_000
  const recent = log.filter((e) => e.at >= since && entryHappened(e))
  const recentMin = recent.reduce((a, e) => a + entryMinutes(e), 0)
  const coach4 = recent.filter((e) => e.type === 'session').length
  const solo4 = recent.filter((e) => e.type === 'solo').length
  const paired = log.filter((e) => e.type === 'session' && e.watch).length

  if (log.length === 0) {
    return (
      <EmptyState
        icon={<Dumbbell className="size-6" />}
        title={t('training.empty')}
        body={workoutsShared ? t('training.emptyBody') : t('training.notSharedBody')}
      />
    )
  }

  const fmtPeriod = (key: string) => (period === 'week' ? f.date(`${key}T12:00:00`, { month: 'short', day: 'numeric' }) : f.date(`${key}T12:00:00`, { month: 'short' }))
  const chartData = buckets.map((b) => ({ key: b.key, coach: Math.round(b.coachMinutes), solo: Math.round(b.soloMinutes), coachCount: b.coachCount, soloCount: b.soloCount }))

  return (
    <div className="flex flex-col gap-4" data-testid="training-history">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('training.stat.sessions4w')} value={f.num(recent.length)} sub={t('training.stat.split', { coach: coach4, solo: solo4 })} />
        <Stat label={t('training.stat.minutes4w')} value={f.num(recentMin)} sub={t('training.stat.perWeek', { min: f.num(recentMin / 4) })} />
        <Stat label={t('training.stat.withWatch')} value={`${f.num(paired)} / ${f.num(log.filter((e) => e.type === 'session').length)}`} sub={t('training.stat.withWatchSub')} />
        <Stat label={t('training.stat.solo')} value={f.num(log.filter((e) => e.type === 'solo').length)} sub={t('training.stat.soloSub')} />
      </div>

      {!workoutsShared && (
        <p className="flex items-start gap-2 rounded-2xl border border-line p-3 text-sm text-ink-2" data-testid="workouts-not-shared">
          <Lock className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
          {t('training.notSharedBody')}
        </p>
      )}

      <Card data-testid="training-chart">
        <CardHeader
          title={period === 'week' ? t('training.chartWeekly') : t('training.chartMonthly')}
          icon={<Timer className="size-5" />}
          action={
            <div className="flex items-center gap-2">
              <DemoBadge show={isDemo} />
              <Segmented label={t('training.period')} size="sm" value={period} onChange={setPeriod} options={[{ value: 'week', label: t('training.week') }, { value: 'month', label: t('training.month') }]} />
            </div>
          }
        />
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-2">
          <div className="flex flex-wrap items-center gap-4" aria-hidden={table}>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-[var(--series-1)]" />{t('training.coach')}</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-[var(--series-3)]" />{t('training.solo')}</span>
          </div>
          <button type="button" onClick={() => setTable((v) => !v)} className="flex items-center gap-1.5 rounded-lg px-2 py-1 font-medium text-ink-3 hover:bg-sunken hover:text-ink" aria-pressed={table}>
            <Table2 className="size-3.5" aria-hidden />
            {table ? t('health.hideTable') : t('health.showTable')}
          </button>
        </div>
        {table ? (
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-strong text-left text-xs text-ink-3">
                <tr>
                  <th className="py-1.5 font-medium">{period === 'week' ? t('training.weekOf') : t('training.month')}</th>
                  <th className="py-1.5 text-right font-medium">{t('training.coach')} ({t('health.units.min')})</th>
                  <th className="py-1.5 text-right font-medium">{t('training.solo')} ({t('health.units.min')})</th>
                </tr>
              </thead>
              <tbody>
                {[...chartData].reverse().map((d) => (
                  <tr key={d.key} className="border-t border-line">
                    <td className="py-1.5 text-ink-2">{fmtPeriod(d.key)}</td>
                    <td className="py-1.5 text-right tabular text-ink">{f.num(d.coach)} <span className="text-ink-3">({d.coachCount})</span></td>
                    <td className="py-1.5 text-right tabular text-ink">{f.num(d.solo)} <span className="text-ink-3">({d.soloCount})</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-56 w-full" role="img" aria-label={t('training.chartAria', { count: chartData.length })}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barCategoryGap="24%">
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="key" tickFormatter={fmtPeriod} tickLine={false} axisLine={false} minTickGap={16} tick={{ fill: 'var(--chart-axis)', fontSize: 11 }} />
                <YAxis tickLine={false} axisLine={false} width={44} allowDecimals={false} tick={{ fill: 'var(--chart-axis)', fontSize: 11 }} tickFormatter={(v: number) => f.num(v)} />
                <Tooltip
                  cursor={{ fill: 'var(--sunken)' }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0]!.payload as (typeof chartData)[number]
                    return (
                      <div className="glass-strong rounded-xl px-3 py-2 text-xs">
                        <div className="mb-1 text-ink-3">{period === 'week' ? t('training.weekOfDate', { date: fmtPeriod(String(label)) }) : fmtPeriod(String(label))}</div>
                        <div className="flex items-center gap-1.5 text-ink"><span className="size-2 rounded-[2px] bg-[var(--series-1)]" />{t('training.coach')}: <b className="tabular">{f.num(d.coach)}</b> {t('health.units.min')} · {d.coachCount}×</div>
                        <div className="flex items-center gap-1.5 text-ink"><span className="size-2 rounded-[2px] bg-[var(--series-3)]" />{t('training.solo')}: <b className="tabular">{f.num(d.solo)}</b> {t('health.units.min')} · {d.soloCount}×</div>
                      </div>
                    )
                  }}
                />
                {/* Stacked: 2px surface gap between segments, 4px rounded top, square at the baseline. */}
                <Bar dataKey="coach" stackId="m" fill="var(--series-1)" maxBarSize={24} stroke="var(--surface-strong)" strokeWidth={2} animationDuration={700} />
                <Bar dataKey="solo" stackId="m" fill="var(--series-3)" maxBarSize={24} radius={[4, 4, 0, 0]} stroke="var(--surface-strong)" strokeWidth={2} animationDuration={700} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title={t('training.listTitle')} icon={<Dumbbell className="size-5" />} action={<DemoBadge show={isDemo} />} />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Segmented
            label={t('training.listTitle')}
            size="sm"
            value={filter}
            onChange={(v) => { setFilter(v); setShown(30) }}
            options={(['all', 'coach', 'solo'] as const).map((v) => ({ value: v, label: t(`training.filter.${v}`) }))}
          />
          {kinds.length > 1 && (
            <select
              value={kind}
              onChange={(e) => { setKind(e.target.value); setShown(30) }}
              className="h-9 rounded-xl border border-line bg-surface-strong px-3 text-sm text-ink"
              aria-label={t('training.kindFilter')}
              data-testid="kind-filter"
            >
              <option value="all">{t('training.allKinds')}</option>
              {kinds.map((k) => <option key={k} value={k}>{t(`training.kinds.${k}`, { defaultValue: k })}</option>)}
            </select>
          )}
        </div>
        {visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-3">{t('training.noneFiltered')}</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="training-list">
            {visible.slice(0, shown).map((e) => <EntryRow key={e.type === 'session' ? `s-${e.session.id}` : `w-${e.watch.id}`} entry={e} />)}
          </ul>
        )}
        {visible.length > shown && (
          <button type="button" onClick={() => setShown((n) => n + 30)} className="mt-3 w-full rounded-xl py-2 text-sm font-medium text-accent hover:bg-accent-soft">
            {t('training.showMore', { count: visible.length - shown })}
          </button>
        )}
        <p className="mt-3 text-xs text-ink-3">{t('training.matchNote')}</p>
      </Card>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold tabular text-ink">{value}</div>
      <div className="mt-0.5 truncate text-2xs text-ink-3">{sub}</div>
    </div>
  )
}

function EntryRow({ entry: e }: { entry: TrainingEntry }) {
  const { t, i18n } = useTranslation()
  const f = useFormatters(i18n.language)
  const [open, setOpen] = useState(false)
  const w = e.watch
  const title = e.type === 'session' ? (e.session.title ?? t(`sessions.types.${e.session.session_type}`)) : t(`training.kinds.${w!.kind}`, { defaultValue: w!.kind })
  const happened = entryHappened(e)
  const minutes = entryMinutes(e)
  return (
    <li className="py-2.5" data-testid={e.type === 'session' ? 'training-entry-session' : 'training-entry-solo'}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 text-left" aria-expanded={open}>
        <span className={clsx('grid size-9 shrink-0 place-items-center rounded-xl', e.type === 'session' ? 'bg-accent-soft text-accent' : 'bg-sunken text-ink-2')} aria-hidden>
          {e.type === 'session' ? <Dumbbell className="size-4" /> : <Watch className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={clsx('font-medium', happened ? 'text-ink' : 'text-ink-3 line-through')}>{title}</span>
            {e.type === 'session' && <Badge tone="accent">{t('training.coach')}</Badge>}
            {e.type === 'session' && w && <Badge tone="good" icon={<Watch className="size-3" aria-hidden />}>{t('training.watchRecorded')}</Badge>}
            {e.type === 'session' && e.session.status === 'cancelled' && <Badge>{t('sessions.statuses.cancelled')}</Badge>}
          </span>
          <span className="block truncate text-xs text-ink-3">
            {f.weekdayShort(e.at)} · {f.time(e.at)}
            {minutes > 0 ? ` · ${f.num(minutes)} ${t('health.units.min')}` : ''}
            {w?.avgHr ? ` · ${f.num(w.avgHr)} ${t('health.units.bpm')}` : ''}
            {w?.kcal ? ` · ${f.num(w.kcal)} ${t('health.units.kcal')}` : ''}
          </span>
        </span>
        <ChevronDown className={clsx('size-4 shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="mt-2 ml-12 grid gap-2 rounded-xl bg-sunken p-3 text-sm sm:grid-cols-2" data-testid="training-detail">
          {e.type === 'session' && (
            <div className="sm:col-span-2 text-ink-2">
              {t(`sessions.types.${e.session.session_type}`)} · {t(`sessions.statuses.${e.session.status}`)}
              {e.session.duration_minutes ? ` · ${t('training.planned')} ${f.num(e.session.duration_minutes)} ${t('health.units.min')}` : ''}
              {e.session.post_session_feedback[0] ? ` · RPE ${e.session.post_session_feedback[0].session_rpe}/10` : ''}
              {e.session.session_exercises.length > 0 && <span className="block text-xs text-ink-3">{e.session.session_exercises.map((x) => x.name).join(' · ')}</span>}
            </div>
          )}
          {w ? <WatchDetail w={w} /> : <p className="sm:col-span-2 text-xs text-ink-3">{t('training.noWatch')}</p>}
        </div>
      )}
    </li>
  )
}

function WatchDetail({ w }: { w: WatchWorkout }) {
  const { t, i18n } = useTranslation()
  const f = useFormatters(i18n.language)
  const rows: { icon: ReactNode; label: string; value: string }[] = [
    { icon: <Watch className="size-3.5" />, label: t('training.kind'), value: t(`training.kinds.${w.kind}`, { defaultValue: w.kind }) },
    { icon: <Timer className="size-3.5" />, label: t('training.measured'), value: `${f.time(w.startMs)}–${f.time(w.endMs)} · ${f.num(w.minutes)} ${t('health.units.min')}` },
  ]
  if (w.avgHr) rows.push({ icon: <HeartPulse className="size-3.5" />, label: t('training.hr'), value: `${f.num(w.avgHr)}${w.maxHr ? ` / ${f.num(w.maxHr)}` : ''} ${t('health.units.bpm')}` })
  if (w.kcal) rows.push({ icon: <Flame className="size-3.5" />, label: t('training.energy'), value: `${f.num(w.kcal)} ${t('health.units.kcal')}` })
  if (w.km) rows.push({ icon: <Route className="size-3.5" />, label: t('training.distance'), value: `${f.num(w.km, 2)} km` })
  if (w.effort) rows.push({ icon: <Dumbbell className="size-3.5" />, label: t('training.effort'), value: `${f.num(w.effort, 1)} / 10` })
  return (
    <>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-ink-2">
          <span className="text-ink-3" aria-hidden>{r.icon}</span>
          <span className="text-ink-3">{r.label}</span>
          <span className="ml-auto tabular text-ink">{r.value}</span>
        </div>
      ))}
      <p className="sm:col-span-2 text-2xs text-ink-3">{t('health.source')}: {w.source ?? 'Apple Health'}</p>
    </>
  )
}
