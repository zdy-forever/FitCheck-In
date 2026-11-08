/**
 * Shared storage path for Apple Health uploads (iOS module via health-ingest, iPhone-browser
 * import via health-import): validate every sample, upsert idempotently, recompute the snapshot,
 * record device sync status. Health values are never logged.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { recomputeSnapshot } from './snapshot.ts'
import { type HealthCategory, type HealthUploadResponse, validateSample } from './metrics/health-schema.ts'

export async function storeSamples(
  admin: SupabaseClient,
  opts: {
    userId: string
    deviceId: string
    timeZone: string
    enabledCategories: HealthCategory[]
    samples: unknown[]
    /** Recompute today's snapshot after storing (the import does it once, on the last batch). */
    recompute: boolean
  },
): Promise<{ ok: true; response: HealthUploadResponse } | { ok: false; error: string }> {
  const { userId, deviceId } = opts
  const nowMs = Date.now()
  const receivedAt = new Date(nowMs).toISOString()
  const enabled = new Set<HealthCategory>(opts.enabledCategories)
  const rejected: HealthUploadResponse['rejected'] = []
  const rows: Record<string, unknown>[] = []
  const seen = new Set<string>()
  let duplicates = 0

  opts.samples.forEach((raw, index) => {
    const res = validateSample(raw, index, enabled, nowMs)
    if (!res.ok) {
      rejected.push(res.issue)
      return
    }
    const s = res.sample
    const key = `${s.metricType}|${s.sampleId}`
    if (seen.has(key)) {
      duplicates++
      return
    }
    seen.add(key)
    rows.push({
      user_id: userId,
      device_id: deviceId,
      sample_id: s.sampleId,
      metric_type: s.metricType,
      value: s.value,
      unit: s.unit,
      start_at: s.startAt,
      measured_at: s.measuredAt,
      received_at: receivedAt,
      category: s.category ?? null,
      metadata: s.metadata ?? {},
      source_name: s.sourceName ?? null,
      source_bundle: s.sourceBundle ?? null,
      origin: 'healthkit',
    })
  })

  // Count which keys already exist so the response can report duplicates honestly.
  let alreadyStored = 0
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const ids = chunk.map((r) => r.sample_id as string)
    const { count } = await admin
      .from('health_samples')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('sample_id', ids)
    alreadyStored += count ?? 0
    const { error } = await admin.from('health_samples').upsert(chunk, { onConflict: 'user_id,metric_type,sample_id' })
    if (error) {
      await admin
        .from('health_sync_devices')
        .update({ last_sync_at: receivedAt, last_sync_status: 'error', last_sync_error: 'storage_failed' })
        .eq('id', deviceId)
      return { ok: false, error: 'storage_failed' }
    }
  }

  let snapshot: HealthUploadResponse['snapshot'] = null
  if (opts.recompute) {
    try {
      snapshot = await recomputeSnapshot(admin, userId, opts.timeZone, nowMs, 'healthkit')
    } catch {
      snapshot = null
    }
  }

  await admin
    .from('health_sync_devices')
    .update({
      last_sync_at: receivedAt,
      last_sync_status: rejected.length > 0 || (opts.recompute && snapshot === null) ? 'partial' : 'success',
      last_sync_error: rejected.length > 0 ? `${rejected.length}_samples_rejected` : opts.recompute && snapshot === null ? 'snapshot_failed' : null,
      last_sample_count: rows.length,
    })
    .eq('id', deviceId)

  // Keep the profile time zone in step with the phone (used for day bucketing).
  await admin.from('profiles').update({ time_zone: opts.timeZone }).eq('id', userId)

  return {
    ok: true,
    response: {
      accepted: rows.length - alreadyStored,
      duplicates: duplicates + alreadyStored,
      rejected: rejected.slice(0, 50),
      snapshot,
      receivedAt,
    },
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
