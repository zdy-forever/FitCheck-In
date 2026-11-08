import { describe, expect, it } from 'vitest'
import { generateDemoSamples } from '@shared/demo-data.ts'
import { METRICS } from '@shared/metrics/health-schema.ts'

describe('demo data generator', () => {
  const now = Date.UTC(2026, 10, 8, 3, 0, 0)
  const samples = generateDemoSamples(now, 'Australia/Sydney', 7)

  it('produces unique (metric, sampleId) keys — matches the DB unique constraint', () => {
    const keys = samples.map((s) => `${s.metric_type}|${s.sample_id}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('only produces values inside the ingest plausibility ranges and correct units', () => {
    for (const s of samples) {
      const def = METRICS[s.metric_type]
      expect(s.unit).toBe(def.unit)
      expect(s.value).toBeGreaterThanOrEqual(def.min)
      expect(s.value).toBeLessThanOrEqual(def.max)
      expect(Date.parse(s.measured_at)).toBeGreaterThanOrEqual(Date.parse(s.start_at))
      expect(Date.parse(s.measured_at)).toBeLessThanOrEqual(now)
    }
  })

  it('labels every sample as simulated', () => {
    expect(samples.every((s) => s.sample_id.startsWith('demo:') && /simulated/.test(s.source_name))).toBe(true)
  })

  it('never starts in the future or ends before it starts, at any hour of the day (DB check measured_at >= start_at)', () => {
    for (const tz of ['Australia/Sydney', 'Asia/Shanghai', 'UTC', 'America/Los_Angeles']) {
      for (let h = 0; h < 24; h++) {
        const t = Date.UTC(2026, 10, 8, h, 30, 0)
        for (const s of generateDemoSamples(t, tz, 7)) {
          expect(Date.parse(s.start_at), `${tz} ${h}h ${s.sample_id}`).toBeLessThanOrEqual(t)
          expect(Date.parse(s.measured_at), `${tz} ${h}h ${s.sample_id}`).toBeGreaterThanOrEqual(Date.parse(s.start_at))
        }
      }
    }
  })
})
