/**
 * Equivalence test: TypeScript port vs. the ORIGINAL Swift DerivedMetricsEngine.
 *
 * Fixtures are produced by `tools/swift-golden/generate.sh`, which compiles the
 * unmodified health_monitor_ios sources (only `private` → internal and a pinned
 * clock) and records inputs + outputs for 62 scenarios in two time zones.
 */
import { describe, expect, it } from 'vitest'
import sydney from '../fixtures/swift-golden-australia-sydney.json'
import newYork from '../fixtures/swift-golden-america-new_york.json'
import { ENGINE_SOURCE, buildDerivedMetrics, estimateWorkoutLoad, estimateZoneDistribution } from '@shared/metrics/engine.ts'
import type { EngineInput, LoadStatus, WorkoutKind } from '@shared/metrics/types.ts'

const STATUS_ZH: Record<LoadStatus, string> = {
  underloaded: '短期刺激偏低',
  balanced: '短长负荷平衡',
  controlledRamp: '可控加量期',
  overreaching: '短期超出长期承载',
}
const FOCUS_ZH = { aerobicBase: '基础有氧', thresholdEndurance: '阈值耐力', anaerobic: '无氧冲击' } as const

// Floating point: Swift Double and JS number are both IEEE-754 binary64, and the port keeps
// the operation order, so results should match to ~1e-9. We allow 1e-6 for safety.
const EPS = 1e-6

interface GoldenFile {
  sourceCommit: string
  timeZone: string
  firstWeekday: number
  nowMs: number
  cases: Array<{ name: string; input: EngineInput; output: Record<string, unknown> }>
  workoutLoadCases: Array<{
    durationMinutes: number
    averageHeartRate?: number
    maxHeartRate?: number
    calories?: number
    age?: number
    kind: WorkoutKind
    load: number
    zones: Record<string, number>
  }>
}

function close(actual: number | undefined, expected: unknown, label: string) {
  if (expected === undefined || expected === null) {
    expect(actual, label).toBeUndefined()
    return
  }
  expect(typeof actual, label).toBe('number')
  expect(Math.abs((actual as number) - (expected as number)), `${label}: ${actual} vs ${expected}`).toBeLessThan(EPS)
}

for (const fixture of [sydney, newYork] as unknown as GoldenFile[]) {
  describe(`Swift golden vectors — ${fixture.timeZone}`, () => {
    it('was generated from the pinned engine commit', () => {
      expect(fixture.sourceCommit).toBe(ENGINE_SOURCE.commit)
      expect(fixture.cases.length).toBeGreaterThanOrEqual(60)
    })

    const ctx = { nowMs: fixture.nowMs, timeZone: fixture.timeZone, firstWeekday: fixture.firstWeekday }

    for (const c of fixture.cases) {
      it(`matches build() for ${c.name}`, () => {
        const out = buildDerivedMetrics(c.input, ctx)
        const exp = c.output as {
          derived: Record<string, number | undefined>
          calibration: Record<string, number | undefined>
          intermediates: Record<string, number | string>
          totalLoad7Day: number
          totalLoad28Day: number
          acuteChronicRatio: number
          fatigueScore: number
          loadFocus: string
        }

        for (const key of Object.keys(out.derived) as Array<keyof typeof out.derived>) {
          close(out.derived[key], exp.derived[key], `derived.${key}`)
        }
        for (const key of Object.keys(out.calibration) as Array<keyof typeof out.calibration>) {
          close(out.calibration[key], exp.calibration[key], `calibration.${key}`)
        }
        close(out.totalLoad7Day, exp.totalLoad7Day, 'totalLoad7Day')
        close(out.totalLoad28Day, exp.totalLoad28Day, 'totalLoad28Day')
        close(out.acuteChronicRatio, exp.acuteChronicRatio, 'acuteChronicRatio')
        close(out.fatigueScore, exp.fatigueScore, 'fatigueScore')
        expect(FOCUS_ZH[out.loadFocus]).toBe(exp.loadFocus)

        const inter = exp.intermediates
        for (const key of Object.keys(out.intermediates) as Array<keyof typeof out.intermediates>) {
          close(out.intermediates[key], inter[key], `intermediates.${key}`)
        }
        expect(STATUS_ZH[out.loadStatus]).toBe(inter.loadStatus)
      })
    }

    it('matches estimateWorkoutLoad / estimateZoneDistribution', () => {
      for (const w of fixture.workoutLoadCases) {
        const load = estimateWorkoutLoad(w)
        close(load, w.load, 'load')
        const zones = estimateZoneDistribution(w)
        for (const z of ['zone1', 'zone2', 'zone3', 'zone4', 'zone5'] as const) close(zones[z], w.zones[z], z)
      }
    })
  })
}
