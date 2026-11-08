import { clsx } from 'clsx'
import { Activity, AlertTriangle, BedDouble, CheckCircle2, CircleSlash, FlaskConical, HeartPulse, Info, Lock, Smartphone, Table2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge } from '@/components/ui/Badge'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Card, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import type { HealthSample, Snapshot } from '@/lib/api'
import { useFormatters } from '@/lib/format'
import type { ScoreResult, ScoreStatus } from '@shared/metrics/assessment.ts'

const STALE_MS = 36 * 3_600_000

export function StatusBadge({ status }: { status: ScoreStatus }) {
  const { t } = useTranslation()
  const map = {
    ok: { tone: 'good' as const, Icon: CheckCircle2 },
    limited: { tone: 'warn' as const, Icon: AlertTriangle },
    insufficient: { tone: 'neutral' as const, Icon: CircleSlash },
  }
  const { tone, Icon } = map[status]
  return (
    <Badge tone={tone} icon={<Icon className="size-3" aria-hidden />}>
      {t(`health.status.${status}`)}
    </Badge>
  )
}

export function DemoBadge({ show }: { show: boolean }) {
  const { t } = useTranslation()
  if (!show) return null
  return (
    <Badge tone="demo" icon={<FlaskConical className="size-3" aria-hidden />} title={t('common.demoDataLong')}>
      {t('common.demoData')}
    </Badge>
  )
}

function Explain({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <button type="button" className="grid size-5 place-items-center rounded-full text-ink-3 hover:text-ink focus-visible:text-ink" aria-label={text}>
        <Info className="size-3.5" aria-hidden />
      </button>
      <span role="tooltip" className="glass-strong pointer-events-none absolute bottom-7 left-1/2 z-30 w-64 -translate-x-1/2 rounded-xl p-3 text-xs font-normal leading-relaxed text-ink-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        {text}
      </span>
    </span>
  )
}

/** One measured metric with value, baseline comparison and provenance. */
function MeasuredTile({
  icon,
  label,
  explain,
  value,
  unit,
  digits = 0,
  baseline,
  delta,
  measuredAt,
  color,
  shared = true,
}: {
  icon: ReactNode
  label: string
  explain: string
  value: number | null | undefined
  unit: string
  digits?: number
  baseline?: number | null
  delta?: string | null
  measuredAt?: number | string | null
  color: string
  shared?: boolean
}) {
  const { t, i18n } = useTranslation()
  const f = useFormatters(i18n.language)
  const stale = measuredAt ? Date.now() - new Date(measuredAt).getTime() > STALE_MS : false
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface-strong p-4">
      <div className="flex items-center gap-2 text-sm text-ink-2">
        <span style={{ color }}>{icon}</span>
        <span className="font-medium">{label}</span>
        <Explain text={explain} />
      </div>
      {!shared ? (
        <div className="flex items-center gap-1.5 py-1 text-sm text-ink-3">
          <Lock className="size-4" aria-hidden />
          {t('health.notShared')}
        </div>
      ) : value === null || value === undefined ? (
        <div className="py-1 text-sm text-ink-3">{t('health.missing')}</div>
      ) : (
        <div className="flex items-baseline gap-1.5">
          <span className={clsx('font-display text-3xl font-semibold tracking-tight', stale ? 'text-ink-3' : 'text-ink')}>
            <AnimatedNumber value={value} format={(v) => f.num(v, digits)} />
          </span>
          <span className="text-sm text-ink-3">{unit}</span>
          {stale && <Badge tone="warn">{t('health.stale')}</Badge>}
        </div>
      )}
      {shared && value !== null && value !== undefined && (
        <div className="space-y-0.5 text-xs text-ink-3">
          {baseline !== null && baseline !== undefined && (
            <div className="tabular">
              {t('health.baseline')}: {f.num(baseline, digits)} {unit}
              {delta && <span className="ml-1 font-medium text-ink-2">({delta})</span>}
            </div>
          )}
          {measuredAt && (
            <div>
              {t('health.measuredAt')}: {f.relative(measuredAt)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ScoreTile({ label, explain, score, inverted }: { label: string; explain: string; score: ScoreResult | undefined; inverted?: boolean }) {
  const { t } = useTranslation()
  const s = score ?? { value: null, status: 'insufficient' as const }
  const pct = s.value ?? 0
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-strong p-4" data-testid={`score-${label}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-sm font-medium text-ink-2">
          {label}
          <Explain text={explain} />
        </span>
        <StatusBadge status={s.status} />
      </div>
      {s.value === null ? (
        <p className="text-sm text-ink-3">{t('health.insufficientBody')}</p>
      ) : (
        <>
          <div className="font-display text-4xl font-semibold tracking-tight text-ink">
            <AnimatedNumber value={s.value} />
            <span className="ml-1 text-base font-normal text-ink-3">/100</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
            <div className={clsx('h-full rounded-full transition-[width] duration-1000', inverted ? 'bg-[var(--series-2)]' : 'bg-accent')} style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Full health panel. `shared` lists which categories the viewer may see
 * (always all for the owner). Measured values and estimates are visually separated.
 */
export function HealthSummary({
  snapshot,
  shared,
  lastSyncAt,
  isOwner,
}: {
  snapshot: Snapshot | null
  shared: Set<string>
  lastSyncAt?: string | null
  isOwner: boolean
}) {
  const { t, i18n } = useTranslation()
  const f = useFormatters(i18n.language)

  if (!snapshot) {
    return (
      <Card>
        <CardHeader title={t('health.title')} icon={<HeartPulse className="size-5" />} />
        <EmptyState icon={<Smartphone className="size-6" />} title={t('health.noData')} body={isOwner ? t('health.noDataBody') : undefined} />
      </Card>
    )
  }

  const a = snapshot.assessment
  const raw = a.rawSummary
  const isDemo = snapshot.origin === 'demo'
  const pct = (v: number | null | undefined) => (v === null || v === undefined ? null : `${v > 0 ? '+' : ''}${f.num(v, 0)}%`)
  const bpm = (v: number | null | undefined) => (v === null || v === undefined ? null : `${v > 0 ? '+' : ''}${f.num(v, 0)} ${t('health.units.bpm')}`)
  const hrs = (v: number | null | undefined) => (v === null || v === undefined ? null : `${v > 0 ? '+' : ''}${f.num(v, 1)} ${t('health.units.h')}`)
  const defaulted = a.defaultedInputs.filter((k) => ['sleep', 'hrv', 'restingHeartRate', 'hrvBaseline', 'restingHeartRateBaseline', 'sleepBaseline', 'workouts'].includes(k))

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title={t('health.measured')}
          subtitle={lastSyncAt ? `${t('health.syncedAt')}: ${f.relative(lastSyncAt)}` : undefined}
          icon={<HeartPulse className="size-5" />}
          action={<DemoBadge show={isDemo} />}
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <MeasuredTile
            icon={<HeartPulse className="size-4" />}
            label={t('health.hrv')}
            explain={t('health.hrvExplain')}
            value={a.latest?.hrv?.value}
            unit={t('health.units.ms')}
            baseline={raw?.baselines.hrv}
            delta={pct(a.baselineComparison.hrvDeltaPercent)}
            measuredAt={a.latest?.hrv?.measuredAt}
            color="var(--series-1)"
            shared={shared.has('hrv')}
          />
          <MeasuredTile
            icon={<Activity className="size-4" />}
            label={t('health.rhr')}
            explain={t('health.rhrExplain')}
            value={a.latest?.restingHeartRate?.value}
            unit={t('health.units.bpm')}
            baseline={raw?.baselines.restingHeartRate}
            delta={bpm(a.baselineComparison.restingHeartRateDeltaBpm)}
            measuredAt={a.latest?.restingHeartRate?.measuredAt}
            color="var(--series-2)"
            shared={shared.has('resting_heart_rate')}
          />
          <MeasuredTile
            icon={<BedDouble className="size-4" />}
            label={t('health.sleep')}
            explain={t('health.sleepExplain')}
            value={raw?.sleepHours}
            unit={t('health.units.h')}
            digits={1}
            baseline={raw?.baselines.sleepHours}
            delta={hrs(a.baselineComparison.sleepDeltaHours)}
            measuredAt={raw?.sleepEndAt}
            color="var(--series-3)"
            shared={shared.has('sleep')}
          />
        </div>
        {shared.has('sleep') && raw && raw.sleepHours !== null && (raw.sleepStages.deep !== null || raw.sleepStages.rem !== null) && <SleepStagesBar stages={raw.sleepStages} />}
        {shared.has('activity') && raw && (raw.stepsToday !== null || raw.activeEnergyToday !== null) && (
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-2">
            {raw.stepsToday !== null && (
              <span>
                {t('health.steps')}: <b className="tabular text-ink">{f.num(raw.stepsToday)}</b>
              </span>
            )}
            {raw.activeEnergyToday !== null && (
              <span>
                {t('health.activeEnergy')}: <b className="tabular text-ink">{f.num(raw.activeEnergyToday)}</b> {t('health.units.kcal')}
              </span>
            )}
          </div>
        )}
      </Card>

      <Card className="border-dashed">
        <CardHeader title={t('health.estimates')} icon={<Info className="size-5" />} action={<DemoBadge show={isDemo} />} />
        {shared.has('scores') ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <ScoreTile label={t('health.readiness')} explain={t('health.readinessExplain')} score={a.scores.readiness} />
              <ScoreTile label={t('health.recovery')} explain={t('health.recoveryExplain')} score={a.scores.recovery} />
              <ScoreTile label={t('health.stress')} explain={t('health.stressExplain')} score={a.scores.stress} inverted />
            </div>
            <div className="mt-4 grid gap-x-6 gap-y-2 text-sm text-ink-2 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-2">
                <span>{t('health.completeness')}</span>
                <span className="font-medium tabular text-ink">{f.num(a.completeness * 100)}%</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>{t('health.load')}</span>
                <span className="font-medium tabular text-ink">
                  {a.training.loadStatus ? `${f.num(a.training.load7Day)} · ${t(`health.loadStatus.${a.training.loadStatus}`)}` : t('health.missing')}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>{t('health.algorithm')}</span>
                <code className="truncate text-xs text-ink-3" title={a.algorithmVersion}>
                  {a.algorithmVersion.split('+')[0]}
                </code>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>{t('health.lastSample')}</span>
                <span className="text-ink-3">{f.dateTime(a.computedAt)}</span>
              </div>
            </div>
            {a.drivers && a.drivers.length > 0 && a.scores.readiness.value !== null && (
              <div className="mt-4" data-testid="score-drivers">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">{t('health.drivers')}</h3>
                  <span className="text-xs text-ink-3">
                    {t('health.normalLine')}
                    {a.signals?.[0] ? ` · ${t('health.personalBaseline', { days: Math.max(...a.signals.map((s) => s.baselineDays)) })}` : ''}
                  </span>
                </div>
                <ul className="flex flex-col gap-1.5">
                  {a.drivers.map((d) => {
                    const width = d.impact === 0 ? 0 : Math.max(Math.min(Math.abs(d.impact) * 3, 50), 4)
                    return (
                      <li key={d.key} className="grid grid-cols-[minmax(0,1fr)_120px_36px] items-center gap-3 text-sm sm:grid-cols-[minmax(0,1fr)_200px_40px]">
                        <span className="truncate text-ink-2">{t(`health.driverKeys.${d.key}`)}</span>
                        <span className="relative h-2 rounded-full bg-sunken" aria-hidden>
                          <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
                          {d.impact !== 0 && (
                            <span
                              className={clsx('absolute inset-y-0 rounded-full', d.impact > 0 ? 'left-1/2 bg-accent' : 'right-1/2 bg-[var(--series-2)]')}
                              style={{ width: `${width}%` }}
                            />
                          )}
                        </span>
                        <span className={clsx('text-right font-medium tabular', d.impact > 0 ? 'text-accent' : d.impact < 0 ? 'text-[var(--series-2)]' : 'text-ink-3')}>
                          {d.impact > 0 ? '+' : ''}
                          {d.impact}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {defaulted.length > 0 && <p className="mt-3 text-xs text-ink-3">{t('health.defaulted', { list: f.list(defaulted.map((k) => t(`health.inputs.${k}`))) })}</p>}
            {a.legacy && a.legacy.readiness !== null && (
              <p className="mt-2 text-xs text-ink-3">{t('health.legacyNote', { readiness: a.legacy.readiness, stress: a.legacy.stress ?? '—' })}</p>
            )}
          </>
        ) : (
          <EmptyState icon={<Lock className="size-6" />} title={t('health.notShared')} body={t('health.notSharedBody')} />
        )}
        <p className="mt-4 rounded-xl bg-sunken p-3 text-xs leading-relaxed text-ink-3">{t('health.estimatesDisclaimer')}</p>
      </Card>
    </div>
  )
}

function SleepStagesBar({ stages }: { stages: { deep: number | null; rem: number | null; core: number | null; awake: number | null } }) {
  const { t, i18n } = useTranslation()
  const f = useFormatters(i18n.language)
  const parts = [
    { k: 'deep', v: stages.deep ?? 0, c: 'var(--series-1)' },
    { k: 'core', v: stages.core ?? 0, c: 'var(--series-3)' },
    { k: 'rem', v: stages.rem ?? 0, c: '#6250d6' },
    { k: 'awake', v: stages.awake ?? 0, c: 'var(--series-2)' },
  ].filter((p) => p.v > 0)
  const total = parts.reduce((s, p) => s + p.v, 0)
  if (total === 0) return null
  return (
    <div className="mt-4">
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => `${t(`health.stages.${p.k}`)} ${f.num(p.v, 1)} h`).join(', ')}>
        {parts.map((p) => (
          <div key={p.k} style={{ width: `${(p.v / total) * 100}%`, background: p.c }} className="first:rounded-l-full last:rounded-r-full" />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        {parts.map((p) => (
          <span key={p.k} className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: p.c }} aria-hidden />
            {t(`health.stages.${p.k}`)} <span className="tabular text-ink">{f.num(p.v, 1)} h</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/** Per-day series for trend charts (daily mean for HRV/RHR, nightly total for sleep). */
export function dailySeries(samples: HealthSample[], metric: string, timeZone: string): { day: string; value: number }[] {
  const keyOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
  const map = new Map<string, number[]>()
  for (const s of samples) {
    if (s.metric_type !== metric) continue
    if (metric === 'sleep_analysis' && (s.category === 'inBed' || s.category === 'awake')) continue
    const k = keyOf(s.measured_at)
    map.set(k, [...(map.get(k) ?? []), s.value])
  }
  return [...map.entries()]
    .map(([day, vals]) => ({ day, value: metric === 'sleep_analysis' ? vals.reduce((a, b) => a + b, 0) : vals.reduce((a, b) => a + b, 0) / vals.length }))
    .sort((a, b) => a.day.localeCompare(b.day))
}

/** Single-series trend with baseline reference, hover tooltip and table toggle. */
export function TrendChart({ title, data, unit, digits = 0, color, baseline, testId }: { title: string; data: { day: string; value: number }[]; unit: string; digits?: number; color: string; baseline?: number | null; testId?: string }) {
  const { t, i18n } = useTranslation()
  const f = useFormatters(i18n.language)
  const [table, setTable] = useState(false)
  const domain = useMemo(() => {
    if (data.length === 0) return [0, 1]
    const vals = data.map((d) => d.value).concat(baseline ? [baseline] : [])
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const pad = Math.max((max - min) * 0.2, 1)
    return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)]
  }, [data, baseline])
  const fmtDay = (d: string) => f.date(`${d}T12:00:00`, { month: 'short', day: 'numeric' })

  return (
    <Card data-testid={testId}>
      <CardHeader
        title={title}
        action={
          <button type="button" onClick={() => setTable((v) => !v)} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-ink-3 hover:bg-sunken hover:text-ink" aria-pressed={table}>
            <Table2 className="size-3.5" aria-hidden />
            {table ? t('health.hideTable') : t('health.showTable')}
          </button>
        }
      />
      {data.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-3">{t('health.missing')}</p>
      ) : table ? (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-strong text-left text-xs text-ink-3">
              <tr>
                <th className="py-1.5 font-medium">{t('health.date')}</th>
                <th className="py-1.5 text-right font-medium">
                  {t('health.value')} ({unit})
                </th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.day} className="border-t border-line">
                  <td className="py-1.5 text-ink-2">{fmtDay(d.day)}</td>
                  <td className="py-1.5 text-right tabular text-ink">{f.num(d.value, digits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-52 w-full" role="img" aria-label={`${title}: ${data.length} ${t('health.date')}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid vertical={false} strokeDasharray="0" />
              <XAxis dataKey="day" tickFormatter={fmtDay} tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis domain={domain} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => f.num(v, digits)} />
              {baseline !== null && baseline !== undefined && (
                <ReferenceLine y={baseline} stroke="var(--chart-axis)" strokeDasharray="4 4" label={{ value: t('health.usual'), position: 'insideTopRight', fontSize: 10, fill: 'var(--chart-axis)' }} />
              )}
              <Tooltip
                cursor={{ stroke: 'var(--line-strong)' }}
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className="glass-strong rounded-xl px-3 py-2 text-xs">
                      <div className="text-ink-3">{fmtDay(String(label))}</div>
                      <div className="font-semibold tabular text-ink">
                        {f.num(Number(payload[0]!.value), digits)} {unit}
                      </div>
                    </div>
                  ) : null
                }
              />
              <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface-strong)' }} animationDuration={900} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}
