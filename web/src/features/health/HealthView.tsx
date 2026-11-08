import { Dumbbell } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Card, CardHeader } from '@/components/ui/Card'
import { ErrorNotice } from '@/components/ui/ErrorNotice'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import { api, type HealthCategory } from '@/lib/api'
import { useFormatters } from '@/lib/format'
import { FitnessPanel } from './FitnessPanel'
import { dailySeries, HealthAtAGlance, HealthSummary, TrendChart } from './HealthPanels'

const ALL: HealthCategory[] = ['scores', 'hrv', 'resting_heart_rate', 'heart_rate', 'sleep', 'activity', 'workouts', 'vo2_max', 'vitals', 'mobility', 'body']

/**
 * Health view for a user. For trainers, `viewerTrainerId` is set and only categories
 * the client granted are shown (RLS returns nothing else anyway; this just renders
 * "not shared" instead of "no data").
 */
export function HealthView({ userId, timeZone, viewerTrainerId, lastSyncAt }: { userId: string; timeZone: string; viewerTrainerId?: string; lastSyncAt?: string | null }) {
  const { t, i18n } = useTranslation()
  const f = useFormatters(i18n.language)
  const isOwner = !viewerTrainerId

  const q = useLiveQuery(
    `health:${userId}:${viewerTrainerId ?? 'self'}`,
    async () => {
      const [snapshot, samples, sharing, devices] = await Promise.all([
        api.latestSnapshot(userId),
        api.healthSamples(userId, ['hrv_sdnn', 'resting_heart_rate', 'sleep_analysis', 'workout'], 30),
        viewerTrainerId ? api.sharing({ clientId: userId, trainerId: viewerTrainerId }) : Promise.resolve(null),
        isOwner ? api.devices() : Promise.resolve(null),
      ])
      return { snapshot, samples, sharing, devices }
    },
    ['health_snapshots', 'health_sharing_permissions', 'health_sync_devices'],
  )

  if (q.loading) return <CardSkeleton lines={5} />
  if (q.error || !q.data) return <ErrorNotice error={q.error} onRetry={() => void q.reload()} />

  const { snapshot, samples, sharing, devices } = q.data
  const shared = new Set<string>(sharing ? sharing.filter((s) => s.granted).map((s) => s.category) : ALL)
  const syncAt = lastSyncAt ?? devices?.find((d) => !d.revoked_at)?.last_sync_at ?? null
  const base = snapshot?.assessment.rawSummary?.baselines
  const workouts = samples.filter((s) => s.metric_type === 'workout').reverse().slice(0, 6)

  return (
    <div className="flex flex-col gap-4">
      <HealthSummary snapshot={snapshot} shared={shared} lastSyncAt={syncAt} isOwner={isOwner} />
      {snapshot?.assessment.fitness && <FitnessPanel snapshot={snapshot} shared={shared} />}
      {snapshot && (
        <div className="grid gap-4 lg:grid-cols-3">
          {shared.has('hrv') && <TrendChart testId="trend-hrv" title={t('health.trendHrv')} data={dailySeries(samples, 'hrv_sdnn', timeZone)} unit={t('health.units.ms')} color="var(--series-1)" baseline={base?.hrv} />}
          {shared.has('resting_heart_rate') && <TrendChart title={t('health.trendRhr')} data={dailySeries(samples, 'resting_heart_rate', timeZone)} unit={t('health.units.bpm')} color="var(--series-2)" baseline={base?.restingHeartRate} />}
          {shared.has('sleep') && <TrendChart title={t('health.trendSleep')} data={dailySeries(samples, 'sleep_analysis', timeZone)} unit={t('health.units.h')} digits={1} color="var(--series-3)" baseline={base?.sleepHours} />}
        </div>
      )}
      {snapshot && shared.has('workouts') && (
        <Card>
          <CardHeader title={t('health.workouts')} icon={<Dumbbell className="size-5" />} />
          {workouts.length === 0 ? (
            <p className="text-sm text-ink-3">{t('health.noWorkouts')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {workouts.map((w) => {
                const meta = (w.metadata ?? {}) as { averageHeartRate?: number; energyKCal?: number }
                return (
                  <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <span className="font-medium text-ink">{t(`sessions.types.${w.category === 'running' || w.category === 'walking' || w.category === 'cycling' || w.category === 'swimming' ? 'endurance' : w.category === 'yoga' ? 'mobility' : w.category === 'strength' ? 'strength' : 'other'}`)} · {w.category}</span>
                    <span className="text-ink-3">
                      {f.weekdayShort(w.measured_at)} · {f.num(w.value)} {t('health.units.min')}
                      {meta.averageHeartRate ? ` · ${f.num(meta.averageHeartRate)} ${t('health.units.bpm')}` : ''}
                      {meta.energyKCal ? ` · ${f.num(meta.energyKCal)} ${t('health.units.kcal')}` : ''}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-ink-3">
            {t('health.source')}: {workouts[0]?.source_name ?? 'Apple Health'}
          </p>
        </Card>
      )}
    </div>
  )
}

/** Dashboard health section (readiness, recovery, stress, sleep score) linking to the full view. */
export function HealthGlance({ userId, viewerTrainerId, healthHref }: { userId: string; viewerTrainerId?: string; healthHref: string }) {
  const q = useLiveQuery(
    `health-glance:${userId}:${viewerTrainerId ?? 'self'}`,
    async () => {
      const [snapshot, sharing] = await Promise.all([
        api.latestSnapshot(userId),
        viewerTrainerId ? api.sharing({ clientId: userId, trainerId: viewerTrainerId }) : Promise.resolve(null),
      ])
      return { snapshot, sharing }
    },
    ['health_snapshots', 'health_sharing_permissions'],
  )
  if (q.loading) return <CardSkeleton lines={3} />
  if (q.error || !q.data) return <ErrorNotice error={q.error} onRetry={() => void q.reload()} />
  const { snapshot, sharing } = q.data
  const shared = new Set<string>(sharing ? sharing.filter((s) => s.granted).map((s) => s.category) : ALL)
  return <HealthAtAGlance snapshot={snapshot} shared={shared} healthHref={healthHref} />
}
