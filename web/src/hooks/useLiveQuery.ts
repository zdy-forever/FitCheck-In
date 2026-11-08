import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

type LiveTable =
  | 'pre_session_checkins'
  | 'post_session_feedback'
  | 'trainer_notes'
  | 'training_sessions'
  | 'trainer_client_relationships'
  | 'health_sharing_permissions'
  | 'health_snapshots'
  | 'health_sync_devices'

export interface QueryState<T> {
  data: T | undefined
  error: unknown
  loading: boolean
  /** true while re-fetching after a realtime event (data stays visible) */
  refreshing: boolean
  reload: () => Promise<void>
  /** timestamp of the last realtime-triggered refresh, for "updated" pulses */
  liveAt: number | null
}

let channelSeq = 0

/**
 * Runs `fetcher`, then re-runs it whenever Postgres reports a change on any of
 * `tables` (Supabase Realtime `postgres_changes`, RLS-filtered on the server).
 * Refetching (instead of patching) keeps results consistent with RLS and joins.
 */
export function useLiveQuery<T>(key: string, fetcher: () => Promise<T>, tables: LiveTable[] = [], enabled = true): QueryState<T> {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(enabled)
  const [refreshing, setRefreshing] = useState(false)
  const [liveAt, setLiveAt] = useState<number | null>(null)
  const fetchRef = useRef(fetcher)
  fetchRef.current = fetcher
  const reqId = useRef(0)

  const run = useCallback(async (background: boolean) => {
    const id = ++reqId.current
    if (background) setRefreshing(true)
    else setLoading(true)
    try {
      const result = await fetchRef.current()
      if (id === reqId.current) {
        setData(result)
        setError(null)
      }
    } catch (e) {
      if (id === reqId.current) setError(e)
    } finally {
      if (id === reqId.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    void run(false)
  }, [key, enabled, run])

  const tablesKey = tables.join(',')
  useEffect(() => {
    if (!enabled || tablesKey === '') return
    let timer: number | undefined
    const channel = supabase.channel(`live:${key}:${++channelSeq}`)
    for (const table of tablesKey.split(',')) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        window.clearTimeout(timer)
        timer = window.setTimeout(() => {
          setLiveAt(Date.now())
          void run(true)
        }, 150)
      })
    }
    channel.subscribe()
    // Refetch when the tab becomes visible again or connectivity returns.
    const onWake = () => document.visibilityState === 'visible' && void run(true)
    window.addEventListener('online', onWake)
    document.addEventListener('visibilitychange', onWake)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('online', onWake)
      document.removeEventListener('visibilitychange', onWake)
      void supabase.removeChannel(channel)
    }
  }, [key, tablesKey, enabled, run])

  const reload = useCallback(() => run(true), [run])
  return { data, error, loading, refreshing, reload, liveAt }
}

/** Throws the Supabase error so useLiveQuery captures it. Non-null unless the query can legitimately return null. */
export function unwrap<R extends { data: unknown; error: unknown }>(res: R): NonNullable<Extract<R, { error: null }>['data']> {
  if (res.error) throw res.error
  return res.data as NonNullable<Extract<R, { error: null }>['data']>
}
