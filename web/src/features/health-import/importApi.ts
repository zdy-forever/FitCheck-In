/**
 * Phone-side client for the health-import Edge Function. The phone never holds a login session:
 * it exchanges the one-time QR code for an upload-only import token, stored on this device.
 */
import { HEALTH_CATEGORIES, MAX_SAMPLES_PER_REQUEST, type HealthUploadResponse } from '@shared/metrics/health-schema.ts'
import { env } from '@/lib/env'
import type { ImportSample, ParseStats } from './parseExport'

const TOKEN_KEY = 'fitcheckin.importToken'
const NAME_KEY = 'fitcheckin.importName'

export function savedImport(): { token: string; name: string } | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    return token ? { token, name: localStorage.getItem(NAME_KEY) ?? '' } : null
  } catch {
    return null
  }
}
export function forgetImport() {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(NAME_KEY)
  } catch {
    /* ignore */
  }
}

export class ImportError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

async function call<T>(body: unknown, token?: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${env.supabaseUrl}/functions/v1/health-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: env.supabaseAnonKey, ...(token ? { 'X-Import-Token': token } : {}) },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ImportError('network')
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new ImportError(data.error ?? `http_${res.status}`)
  return data as T
}

/**
 * One request per code, even if called twice (React StrictMode re-runs effects in development;
 * a double tap could do the same). A second call gets the first call's result instead of
 * burning the single-use code twice.
 */
const pairing = new Map<string, Promise<{ token: string; clientName: string }>>()
export function pair(code: string) {
  let p = pairing.get(code)
  if (!p) {
    p = pairOnce(code)
    pairing.set(code, p)
  }
  return p
}

async function pairOnce(code: string) {
  const r = await call<{ token: string; clientName: string }>({ action: 'pair', code })
  try {
    localStorage.setItem(TOKEN_KEY, r.token)
    localStorage.setItem(NAME_KEY, r.clientName)
  } catch {
    /* private mode: token lives for this page only */
  }
  return r
}

export function status(token: string) {
  return call<{ clientName: string; lastSyncAt: string | null; lastSampleCount: number | null }>({ action: 'status' }, token)
}

export interface UploadResult {
  accepted: number
  duplicates: number
  rejected: number
  snapshotDate: string | null
}

/** Uploads in batches (server limit 2000 per request); recomputes scores on the last batch. */
export async function upload(token: string, samples: ImportSample[], timeZone: string, onBatch?: (done: number, total: number) => void): Promise<UploadResult> {
  const total = samples.length
  const out: UploadResult = { accepted: 0, duplicates: 0, rejected: 0, snapshotDate: null }
  const size = Math.min(MAX_SAMPLES_PER_REQUEST, 1000)
  if (total === 0) {
    // Still record the attempt and refresh scores.
    const r = await call<HealthUploadResponse>({ action: 'upload', timeZone, enabledCategories: HEALTH_CATEGORIES, samples: [], final: true }, token)
    out.snapshotDate = r.snapshot?.date ?? null
    return out
  }
  for (let i = 0; i < total; i += size) {
    const batch = samples.slice(i, i + size)
    const final = i + size >= total
    const r = await call<HealthUploadResponse>({ action: 'upload', timeZone, enabledCategories: HEALTH_CATEGORIES, samples: batch, final }, token)
    out.accepted += r.accepted
    out.duplicates += r.duplicates
    out.rejected += r.rejected.length
    if (final) out.snapshotDate = r.snapshot?.date ?? null
    onBatch?.(Math.min(total, i + size), total)
  }
  return out
}

export function parseInWorker(file: File, timeZone: string, lookbackDays: number, onProgress: (p: { bytesRead: number; totalBytes: number | null; records: number }) => void, signal?: AbortSignal): Promise<{ samples: ImportSample[]; stats: ParseStats }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' })
    const stop = () => worker.terminate()
    signal?.addEventListener('abort', () => {
      stop()
      reject(new DOMException('aborted', 'AbortError'))
    })
    worker.onmessage = (e) => {
      const m = e.data
      if (m.type === 'progress') onProgress(m)
      else if (m.type === 'done') {
        stop()
        resolve({ samples: m.samples, stats: m.stats })
      } else if (m.type === 'error') {
        stop()
        reject(new ImportError(m.message))
      }
    }
    worker.onerror = () => {
      stop()
      reject(new ImportError('parse_failed'))
    }
    worker.postMessage({ file, timeZone, lookbackDays })
  })
}
