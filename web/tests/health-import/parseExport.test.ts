import { zipSync } from 'fflate'

// jsdom's TextEncoder returns a Uint8Array from another realm, which fflate's zipSync mistakes
// for a folder; build fixture bytes with Node's Buffer (a same-realm Uint8Array subclass).
const strToU8 = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'))
import { describe, expect, it } from 'vitest'
import { ExportAggregator, ExportScanner, parseExportDate, parseHealthExport, stableId, workoutKind } from '@/features/health-import/parseExport'
import { HEALTH_CATEGORIES, METRICS, validateSample, WORKOUT_KINDS } from '@shared/metrics/health-schema.ts'

const TZ = 'Australia/Sydney'
const NOW = Date.parse('2026-11-08T08:00:00Z') // 19:00 local
const d = (local: string) => `${local} +1100`

const rec = (type: string, start: string, end: string, value: string | number, extra = '') =>
  `<Record type="${type}" sourceName="${extra.includes('sourceName') ? '' : 'Sam’s Apple Watch'}" ${extra} startDate="${d(start)}" endDate="${d(end)}" value="${value}"/>`.replace('sourceName="" ', '')

/** A small but realistic export.xml (structure as written by the iOS Health app). */
function exportXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
<!ELEMENT HealthData (ExportDate,Me,(Record|Correlation|Workout|ActivitySummary|ClinicalRecord|Audiogram|VisionPrescription)*)>
<!ATTLIST Record type CDATA #REQUIRED unit CDATA #IMPLIED value CDATA #IMPLIED>
]>
<HealthData locale="zh_CN">
 <ExportDate value="2026-11-08 18:30:00 +1100"/>
 <Me HKCharacteristicTypeIdentifierDateOfBirth="1995-04-02" HKCharacteristicTypeIdentifierBiologicalSex="HKBiologicalSexMale"/>
 ${rec('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', '2026-11-08 06:10:00', '2026-11-08 06:11:00', 52.4, 'unit="ms"')}
 ${rec('HKQuantityTypeIdentifierRestingHeartRate', '2026-11-08 00:00:00', '2026-11-08 18:00:00', 55, 'unit="count/min"')}
 ${rec('HKQuantityTypeIdentifierOxygenSaturation', '2026-11-08 03:00:00', '2026-11-08 03:00:00', 0.97, 'unit="%"')}
 ${rec('HKQuantityTypeIdentifierBodyMass', '2026-11-07 07:00:00', '2026-11-07 07:00:00', 165.3, 'unit="lb"')}
 ${rec('HKQuantityTypeIdentifierVO2Max', '2026-11-05 07:00:00', '2026-11-05 07:00:00', 44.5, 'unit="mL/min·kg"')}
 ${rec('HKQuantityTypeIdentifierAppleSleepingWristTemperature', '2026-11-08 01:00:00', '2026-11-08 06:00:00', 93.2, 'unit="degF"')}
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Sam’s Apple Watch" unit="count" startDate="${d('2026-11-08 08:00:00')}" endDate="${d('2026-11-08 08:10:00')}" value="1200"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Sam’s Apple Watch" unit="count" startDate="${d('2026-11-08 12:00:00')}" endDate="${d('2026-11-08 12:10:00')}" value="800"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Sam’s iPhone" unit="count" startDate="${d('2026-11-08 08:00:00')}" endDate="${d('2026-11-08 08:10:00')}" value="1100"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="Sam’s iPhone" unit="count" startDate="${d('2026-11-07 09:00:00')}" endDate="${d('2026-11-07 09:30:00')}" value="5000"/>
 <Record type="HKQuantityTypeIdentifierDistanceWalkingRunning" sourceName="Sam’s Apple Watch" unit="mi" startDate="${d('2026-11-08 08:00:00')}" endDate="${d('2026-11-08 08:10:00')}" value="0.5"/>
 <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Sam’s Apple Watch" unit="count/min" startDate="${d('2026-11-08 17:05:00')}" endDate="${d('2026-11-08 17:05:00')}" value="140"/>
 <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Sam’s Apple Watch" unit="count/min" startDate="${d('2026-11-08 17:25:00')}" endDate="${d('2026-11-08 17:25:00')}" value="160"/>
 <Record type="HKQuantityTypeIdentifierRunningPower" sourceName="Sam’s Apple Watch" unit="W" startDate="${d('2026-11-08 17:10:00')}" endDate="${d('2026-11-08 17:10:00')}" value="250"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Sam’s Apple Watch" startDate="${d('2026-11-07 23:00:00')}" endDate="${d('2026-11-08 01:00:00')}" value="HKCategoryValueSleepAnalysisAsleepCore"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Sam’s Apple Watch" startDate="${d('2026-11-08 01:00:00')}" endDate="${d('2026-11-08 02:30:00')}" value="HKCategoryValueSleepAnalysisAsleepDeep"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Sam’s Apple Watch" startDate="${d('2026-11-08 02:30:00')}" endDate="${d('2026-11-08 02:40:00')}" value="HKCategoryValueSleepAnalysisAwake"/>
 <Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Old Watch" unit="count/min" startDate="2025-01-01 00:00:00 +1100" endDate="2025-01-01 18:00:00 +1100" value="60"/>
 <Record type="HKQuantityTypeIdentifierDietaryWater" sourceName="Water app" unit="mL" startDate="${d('2026-11-08 09:00:00')}" endDate="${d('2026-11-08 09:00:00')}" value="250"/>
 <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="Sam’s Apple Watch" unit="ms" startDate="${d('2026-11-08 05:00:00')}" endDate="${d('2026-11-08 05:01:00')}" value="52">
  <HeartRateVariabilityMetadataList>
   <InstantaneousBeatsPerMinute bpm="58" time="5:00:01.00 AM"/>
  </HeartRateVariabilityMetadataList>
 </Record>
 <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30.5" durationUnit="min" sourceName="Sam’s Apple Watch" sourceVersion="11.0" creationDate="${d('2026-11-08 17:31:00')}" startDate="${d('2026-11-08 17:00:00')}" endDate="${d('2026-11-08 17:30:30')}">
  <MetadataEntry key="HKIndoorWorkout" value="0"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" startDate="${d('2026-11-08 17:00:00')}" endDate="${d('2026-11-08 17:30:30')}" sum="1300" unit="kJ"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" startDate="${d('2026-11-08 17:00:00')}" endDate="${d('2026-11-08 17:30:30')}" sum="5.2" unit="km"/>
  <WorkoutRoute sourceName="Sam’s Apple Watch"><FileReference path="/workout-routes/route_2026-11-08_5.30pm.gpx"/></WorkoutRoute>
 </Workout>
 <Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" duration="45" durationUnit="min" sourceName="Sam’s Apple Watch" startDate="${d('2026-11-07 18:00:00')}" endDate="${d('2026-11-07 18:45:00')}" totalEnergyBurned="210" totalEnergyBurnedUnit="kcal"/>
 <ActivitySummary dateComponents="2026-11-08" activeEnergyBurned="512"/>
</HealthData>`
}

function parse(xml: string, chunk = 97) {
  const agg = new ExportAggregator({ lookbackDays: 90, timeZone: TZ, nowMs: NOW })
  const sc = new ExportScanner(agg)
  // Feed in awkward chunk sizes to exercise tags split across chunk boundaries.
  for (let i = 0; i < xml.length; i += chunk) sc.push(xml.slice(i, i + chunk))
  return { samples: agg.finish(), stats: agg.stats }
}

describe('Apple Health export parser', () => {
  const { samples, stats } = parse(exportXml())
  const by = (m: string) => samples.filter((s) => s.metricType === m)

  it('parses Apple export dates with offsets', () => {
    expect(parseExportDate('2026-11-08 07:15:00 +1100')).toBe(Date.parse('2026-11-07T20:15:00Z'))
    expect(parseExportDate('2026-03-01 01:00:00 -0530')).toBe(Date.parse('2026-03-01T06:30:00Z'))
    expect(parseExportDate('nonsense')).toBeNull()
  })

  it('maps point metrics with the same units/multipliers as the iOS module', () => {
    expect(by('hrv_sdnn').map((s) => s.value).sort()).toEqual([52, 52.4])
    expect(by('resting_heart_rate')).toHaveLength(1) // the 2025 one is outside the 90-day window
    expect(by('oxygen_saturation')[0]!.value).toBeCloseTo(97) // fraction ×100, like HealthKit .percent()
    expect(by('body_mass')[0]!.value).toBeCloseTo(74.98, 1) // lb → kg
    expect(by('vo2_max')[0]!.value).toBe(44.5)
    expect(by('wrist_temperature')[0]!.value).toBeCloseTo(34, 0) // °F → °C
  })

  it('daily totals use the best single source per day — never iPhone + Watch summed', () => {
    const steps = by('step_count')
    const today = steps.find((s) => s.sampleId === 'step_count:2026-11-08')!
    expect(today.value).toBe(2000) // Watch 1200+800, not 2000+1100
    expect(today.sourceName).toContain('Apple Watch')
    expect(steps.find((s) => s.sampleId === 'step_count:2026-11-07')!.value).toBe(5000)
    // Bucket starts at local midnight (Sydney) — same id format as HKStatisticsCollectionQuery buckets.
    expect(today.startAt).toBe('2026-11-07T13:00:00.000Z')
    expect(by('distance_walking_running')[0]!.value).toBeCloseTo(0.8047, 3) // mi → km
  })

  it('sleep stages become hours with the iOS stage names', () => {
    const sleep = by('sleep_analysis')
    expect(sleep.map((s) => s.category).sort()).toEqual(['asleepCore', 'asleepDeep', 'awake'])
    expect(sleep.find((s) => s.category === 'asleepDeep')!.value).toBe(1.5)
  })

  it('heart rate becomes hourly averages (last 7 days) with deterministic ids', () => {
    const hr = by('heart_rate')
    expect(hr).toHaveLength(1)
    expect(hr[0]!.sampleId).toBe('heart_rate:2026-11-08T17')
    expect(hr[0]!.value).toBe(150)
  })

  it('workouts: kind, duration, energy (kJ→kcal), distance, HR and running power from the scan', () => {
    const w = by('workout')
    expect(w).toHaveLength(2)
    const run = w.find((x) => x.category === 'running')!
    expect(run.value).toBe(30.5)
    expect(run.metadata!.energyKCal).toBeCloseTo(310.7, 0)
    expect(run.metadata!.distanceKM).toBe(5.2)
    expect(run.metadata!.averageHeartRate).toBe(150)
    expect(run.metadata!.maxHeartRate).toBe(160)
    expect(run.metadata!.runningPowerW).toBe(250)
    const lift = w.find((x) => x.category === 'strength')!
    expect(lift.metadata!.energyKCal).toBe(210) // legacy totalEnergyBurned attribute
    expect(lift.metadata!.averageHeartRate).toBeUndefined() // nothing measured → absent, not invented
  })

  it('ignores types we do not use, and counts what was skipped', () => {
    expect(samples.some((s) => (s.sourceName ?? '').includes('Water'))).toBe(false)
    expect(stats.skippedOld).toBeGreaterThanOrEqual(1)
    expect(stats.records).toBeGreaterThan(15)
  })

  it('every produced sample passes the server validation (same rules as health-ingest)', () => {
    const enabled = new Set(HEALTH_CATEGORIES)
    const bad = samples.map((s, i) => validateSample(s, i, enabled, NOW)).filter((r) => !r.ok)
    expect(bad).toEqual([])
    for (const s of samples) expect(s.unit).toBe(METRICS[s.metricType].unit)
  })

  it('is deterministic: re-importing the same export yields the same ids (updates, not duplicates)', () => {
    const again = parse(exportXml(), 13).samples.map((s) => s.sampleId).sort()
    expect(again).toEqual(samples.map((s) => s.sampleId).sort())
    expect(new Set(again).size).toBe(again.length)
    expect(stableId('a', 'b')).toBe(stableId('a', 'b'))
    expect(stableId('a', 'b')).not.toBe(stableId('a', 'c'))
  })

  it('workout kinds: health+ kinds unchanged, the old "mixed" bucket refined, unknown stays mixed', () => {
    expect(workoutKind('HKWorkoutActivityTypeRunning')).toBe('running')
    expect(workoutKind('HKWorkoutActivityTypeFunctionalStrengthTraining')).toBe('strength')
    expect(workoutKind('HKWorkoutActivityTypePilates')).toBe('yoga')
    expect(workoutKind('HKWorkoutActivityTypeHiking')).toBe('hiking')
    expect(workoutKind('HKWorkoutActivityTypeHighIntensityIntervalTraining')).toBe('hiit')
    expect(workoutKind('HKWorkoutActivityTypeSoccer')).toBe('team_sports')
    expect(workoutKind('HKWorkoutActivityTypeTennis')).toBe('racket_sports')
    expect(workoutKind('HKWorkoutActivityTypeBoxing')).toBe('combat')
    expect(workoutKind('HKWorkoutActivityTypeCurling')).toBe('mixed')
    // Every kind the parser can produce is accepted by the server.
    for (const t of ['Hiking', 'HighIntensityIntervalTraining', 'CoreTraining', 'Dance', 'Rowing', 'Elliptical', 'StairClimbing', 'Soccer', 'Tennis', 'Boxing', 'Climbing', 'Flexibility', 'Cooldown', 'Curling'])
      expect(WORKOUT_KINDS as readonly string[]).toContain(workoutKind(`HKWorkoutActivityType${t}`))
  })

  it('keeps a year of workouts while other metrics stay at the 90-day window', () => {
    const old = (days: number) => new Date(NOW - days * 86_400_000)
    const fmt = (t: Date) => `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')} 08:00:00 +0000`
    const fmtEnd = (t: Date) => fmt(t).replace('08:00:00', '08:40:00')
    const xml = `<?xml version="1.0"?><HealthData>
 <Workout workoutActivityType="HKWorkoutActivityTypeTennis" duration="40" durationUnit="min" sourceName="Watch" startDate="${fmt(old(200))}" endDate="${fmtEnd(old(200))}"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="40" durationUnit="min" sourceName="Watch" startDate="${fmt(old(380))}" endDate="${fmtEnd(old(380))}"/>
 <Record type="HKQuantityTypeIdentifierRestingHeartRate" sourceName="Watch" unit="count/min" startDate="${fmt(old(200))}" endDate="${fmt(old(200))}" value="55"/>
</HealthData>`
    const r = parse(xml)
    expect(r.samples.map((s) => s.category)).toEqual(['racket_sports']) // 200 d kept; 380 d and the 200-d resting HR dropped
    const enabled = new Set(HEALTH_CATEGORIES)
    expect(validateSample(r.samples[0], 0, enabled, NOW).ok).toBe(true) // within the server's 400-day limit
  })
})

describe('parseHealthExport (file)', () => {
  it('reads export.zip as exported by the iPhone (streamed), ignoring the CDA file and routes', async () => {
    // Same layout as the iPhone's export.zip (fflate takes a nested tree for folders).
    const zip = zipSync({
      apple_health_export: {
        'export.xml': strToU8(exportXml()),
        'export_cda.xml': strToU8('<ClinicalDocument><Record type="HKQuantityTypeIdentifierBodyMass" value="999"/></ClinicalDocument>'),
        'workout-routes': { 'route_1.gpx': strToU8('<gpx/>') },
      },
    })
    const progress: number[] = []
    const { samples, stats } = await parseHealthExport(new Blob([zip as Uint8Array<ArrayBuffer>]), { timeZone: TZ, nowMs: NOW, onProgress: (p) => progress.push(p.bytesRead) })
    expect(samples.filter((s) => s.metricType === 'body_mass')).toHaveLength(1)
    expect(samples.find((s) => s.metricType === 'body_mass')!.value).toBeLessThan(100)
    expect(stats.used).toBeGreaterThan(10)
    expect(progress.at(-1)).toBe(zip.length)
  })

  it('also accepts a bare export.xml', async () => {
    const { samples } = await parseHealthExport(new Blob([exportXml()]), { timeZone: TZ, nowMs: NOW })
    expect(samples.length).toBeGreaterThan(10)
  })

  it('a zip without an export.xml is reported, not silently empty', async () => {
    const zip = zipSync({ photos: { 'a.txt': strToU8('hi') } })
    await expect(parseHealthExport(new Blob([zip as Uint8Array<ArrayBuffer>]), { timeZone: TZ, nowMs: NOW })).rejects.toThrow('no_export_xml')
  })
})
