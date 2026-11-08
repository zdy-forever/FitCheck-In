/// <reference lib="webworker" />
/**
 * Parses the Apple Health export off the main thread so the page stays responsive on the
 * phone while hundreds of MB are scanned. Messages:
 *   in:  { file: File, timeZone: string, lookbackDays: number }
 *   out: { type: 'progress', bytesRead, totalBytes, records }
 *        { type: 'done', samples, stats } | { type: 'error', message }
 */
import { parseHealthExport } from './parseExport'

self.onmessage = async (e: MessageEvent<{ file: File; timeZone: string; lookbackDays: number }>) => {
  try {
    const { samples, stats } = await parseHealthExport(e.data.file, {
      timeZone: e.data.timeZone,
      lookbackDays: e.data.lookbackDays,
      onProgress: (p) => self.postMessage({ type: 'progress', ...p }),
    })
    self.postMessage({ type: 'done', samples, stats })
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : 'parse_failed' })
  }
}
