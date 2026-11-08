// Golden-vector generator for the TypeScript port of DerivedMetricsEngine.
//
// Compiles the ORIGINAL health_monitor_ios sources (DomainModels.swift +
// DerivedMetricsEngine.swift at a pinned commit). The only transformation applied
// by generate.sh is `private static func` -> `static func` in a scratch copy so
// intermediate sub-scores (HRV score, RHR score, ...) can be recorded too.
// No numeric logic is changed.
//
// Output: JSON array of { name, nowMs, input, output } cases.

import Foundation

// Deterministic LCG so the vectors are reproducible.
struct LCG {
    var state: UInt64
    mutating func next() -> Double {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return Double(state >> 11) / Double(1 << 53)
    }
    mutating func range(_ lo: Double, _ hi: Double) -> Double { lo + (hi - lo) * next() }
    mutating func maybe(_ p: Double, _ v: Double) -> Double? { next() < p ? v : nil }
    mutating func int(_ lo: Int, _ hi: Int) -> Int { lo + Int(next() * Double(hi - lo + 1)) % (hi - lo + 1) }
}

// Fixed clock. generate.sh rewrites every `Date()` inside the engine copy to `GoldenClock.now`
// (time-source injection only) so outputs are exactly reproducible.
enum GoldenClock {
    static let now = Date(timeIntervalSince1970: Double(ProcessInfo.processInfo.environment["GOLDEN_NOW"] ?? "1794107550") ?? 1794107550)
}
let now = GoldenClock.now
let calendar = Calendar.current

func roundTo(_ v: Double, _ digits: Int = 2) -> Double {
    let p = pow(10.0, Double(digits)); return (v * p).rounded() / p
}

func makeWorkout(_ rng: inout LCG, daysAgo: Double, age: Int?) -> WorkoutSummary {
    let kinds: [WorkoutKind] = [.running, .walking, .cycling, .strength, .yoga, .swimming, .mixed]
    let kind = kinds[rng.int(0, kinds.count - 1)]
    let duration = roundTo(rng.range(15, 95), 1)
    let avgHR: Double? = rng.next() < 0.85 ? roundTo(rng.range(95, 172), 0) : nil
    let maxHR: Double? = avgHR.map { roundTo($0 * rng.range(1.05, 1.22), 0) }
    let calories: Double? = rng.next() < 0.8 ? roundTo(duration * rng.range(4, 12), 0) : nil
    let load = DerivedMetricsEngine.estimateWorkoutLoad(durationMinutes: duration, averageHeartRate: avgHR, maxHeartRate: maxHR, calories: calories, age: age)
    let zones = DerivedMetricsEngine.estimateZoneDistribution(durationMinutes: duration, averageHeartRate: avgHR, maxHeartRate: maxHR, age: age, kind: kind)
    let date = now.addingTimeInterval(-(daysAgo * 86_400).rounded())
    return WorkoutSummary(
        id: UUID(), date: date, activityName: kind.rawValue, kind: kind, durationMinutes: duration,
        calories: calories, distanceKM: nil, averageHeartRate: avgHR, maxHeartRate: maxHR,
        source: .appleHealth, effortScore: min(100, load * 1.6), estimatedLoad: load,
        zoneDistribution: zones, muscleGroup: nil, strengthVolumeKG: kind == .strength && rng.next() < 0.5 ? roundTo(rng.range(800, 6000), 0) : nil
    )
}

func makeTrends(_ rng: inout LCG, workouts: [WorkoutSummary], days: Int, density: Double) -> [DailyTrendPoint] {
    (0..<days).reversed().compactMap { offset -> DailyTrendPoint? in
        guard let date = calendar.date(byAdding: .day, value: -offset, to: calendar.startOfDay(for: now)) else { return nil }
        let dayWorkouts = workouts.filter { calendar.isDate($0.date, inSameDayAs: date) }
        return DailyTrendPoint(
            date: date,
            steps: rng.maybe(density, roundTo(rng.range(2_000, 16_000), 0)),
            activeEnergyKCal: rng.maybe(density, roundTo(rng.range(150, 1_100), 0)),
            sleepHours: rng.maybe(density, roundTo(rng.range(4.8, 9.6), 2)),
            activityLoad: dayWorkouts.map(\.estimatedLoad).reduce(0, +),
            journalImpact: 0,
            moveCompletion: rng.maybe(density, roundTo(rng.range(0.2, 1.6), 2)),
            exerciseCompletion: rng.maybe(density, roundTo(rng.range(0.0, 1.8), 2)),
            standCompletion: rng.maybe(density, roundTo(rng.range(0.3, 1.2), 2))
        )
    }
}

func emptyRaw() -> RawHealthData { HealthSnapshot.placeholder().raw }

func randomRaw(_ rng: inout LCG, p: Double) -> RawHealthData {
    var raw = emptyRaw()
    raw.age = rng.next() < p ? rng.int(19, 68) : nil
    raw.biologicalSex = rng.next() < p ? (rng.next() < 0.5 ? "female" : "male") : nil
    raw.stepsToday = rng.maybe(p, roundTo(rng.range(500, 15_000), 0))
    raw.activeEnergyKCal = rng.maybe(p, roundTo(rng.range(60, 1_000), 0))
    raw.basalEnergyKCal = rng.maybe(p, roundTo(rng.range(1_200, 2_000), 0))
    raw.dietaryEnergyKCal = rng.maybe(p * 0.6, roundTo(rng.range(1_200, 3_400), 0))
    raw.exerciseMinutes = rng.maybe(p, roundTo(rng.range(0, 90), 0))
    raw.vo2Max = rng.maybe(p, roundTo(rng.range(28, 60), 1))
    raw.restingHeartRate = rng.maybe(p, roundTo(rng.range(40, 82), 0))
    raw.heartRateVariabilitySDNN = rng.maybe(p, roundTo(rng.range(14, 120), 1))
    raw.bodyMassKG = rng.maybe(p, roundTo(rng.range(48, 110), 1))
    raw.bodyFatPercent = rng.maybe(p * 0.7, roundTo(rng.range(8, 38), 1))
    raw.leanBodyMassKG = raw.bodyMassKG.flatMap { m in rng.maybe(p * 0.6, roundTo(m * rng.range(0.6, 0.88), 1)) }
    raw.bodyMassIndex = rng.maybe(p, roundTo(rng.range(17, 34), 1))
    let total = rng.maybe(p, roundTo(rng.range(4.0, 10.4), 2))
    raw.sleep = SleepSummary(
        totalHours: total,
        inBedHours: total.flatMap { t in rng.maybe(p, roundTo(t + rng.range(0.1, 1.6), 2)) },
        deepHours: total.flatMap { _ in rng.maybe(p, roundTo(rng.range(0.3, 2.0), 2)) },
        remHours: total.flatMap { _ in rng.maybe(p, roundTo(rng.range(0.4, 2.4), 2)) },
        coreHours: total.flatMap { _ in rng.maybe(p, roundTo(rng.range(2.0, 5.0), 2)) },
        awakeHours: total.flatMap { _ in rng.maybe(p, roundTo(rng.range(0.0, 1.0), 2)) }
    )
    raw.nutrients = NutrientSummary(
        proteinG: rng.maybe(p * 0.5, roundTo(rng.range(30, 220), 0)),
        carbohydratesG: rng.maybe(p * 0.5, roundTo(rng.range(60, 420), 0)),
        fatG: rng.maybe(p * 0.5, roundTo(rng.range(20, 140), 0)),
        sugarG: rng.maybe(p * 0.5, roundTo(rng.range(5, 120), 0)),
        waterL: rng.maybe(p * 0.5, roundTo(rng.range(0.5, 4.2), 2)),
        caffeineMG: rng.maybe(p * 0.5, roundTo(rng.range(0, 600), 0))
    )
    raw.mobility.walkingSteadinessPercent = rng.maybe(p * 0.6, roundTo(rng.range(40, 100), 0))
    raw.mobility.walkingSpeedMS = rng.maybe(p * 0.6, roundTo(rng.range(0.8, 1.7), 2))
    raw.mobility.sixMinuteWalkDistanceM = rng.maybe(p * 0.4, roundTo(rng.range(350, 700), 0))
    raw.mobility.walkingAsymmetryPercent = rng.maybe(p * 0.6, roundTo(rng.range(0, 12), 1))
    raw.mobility.walkingDoubleSupportPercent = rng.maybe(p * 0.6, roundTo(rng.range(20, 36), 1))
    return raw
}

func randomBaselines(_ rng: inout LCG, p: Double, workouts: [WorkoutSummary]) -> BaselineMetrics {
    BaselineMetrics(
        averageSleepHours7Day: rng.maybe(p, roundTo(rng.range(5.5, 9.0), 2)),
        averageHRV7Day: rng.maybe(p, roundTo(rng.range(18, 110), 1)),
        averageRestingHeartRate7Day: rng.maybe(p, roundTo(rng.range(42, 78), 1)),
        averageSteps7Day: rng.maybe(p, roundTo(rng.range(3_000, 14_000), 0)),
        averageActiveEnergy7Day: rng.maybe(p, roundTo(rng.range(200, 900), 0)),
        averageWaterL7Day: rng.maybe(p * 0.5, roundTo(rng.range(1.0, 3.5), 2)),
        trainingLoad7Day: 0,
        trainingLoad28Day: 0
    )
}

struct CaseInput: Codable {
    var raw: RawHealthData
    var baselines: BaselineMetrics
    var workouts: [WorkoutSummary]
    var dailyTrends: [DailyTrendPoint]
    var longTermTrends: [DailyTrendPoint]
}

struct Intermediates: Codable {
    var hrvScore: Double
    var restingHeartScore: Double
    var energyAvailabilityScore: Double
    var activityPaceScore: Double
    var cardioScore: Double
    var cardioReserveScore: Double
    var loadCapacityScore: Double
    var chronicWeeklyLoad: Double
    var loadStatus: String
}

struct CaseOutput: Codable {
    var derived: DerivedMetrics
    var calibration: CalibrationProfile
    var totalLoad7Day: Double
    var totalLoad28Day: Double
    var acuteChronicRatio: Double
    var fatigueScore: Double
    var loadFocus: String
    var intermediates: Intermediates
}

struct WorkoutLoadCase: Codable {
    var durationMinutes: Double
    var averageHeartRate: Double?
    var maxHeartRate: Double?
    var calories: Double?
    var age: Int?
    var kind: WorkoutKind
    var load: Double
    var zones: HeartRateZoneDistribution
}

struct GoldenCase: Codable {
    var name: String
    var input: CaseInput
    var output: CaseOutput
}

struct GoldenFile: Codable {
    var generator: String
    var sourceRepo: String
    var sourceCommit: String
    var timeZone: String
    var firstWeekday: Int
    var nowMs: Double
    var cases: [GoldenCase]
    var workoutLoadCases: [WorkoutLoadCase]
}

func run(_ name: String, _ input: CaseInput) -> GoldenCase {
    let result = DerivedMetricsEngine.build(
        raw: input.raw, baselines: input.baselines, workouts: input.workouts,
        journalEntries: [], dailyTrends: input.dailyTrends, longTermTrends: input.longTermTrends
    )
    let derived = result.0, training = result.1, calibration = result.4

    // Recompute intermediates exactly like build() does (functions made internal in the scratch copy).
    let priorLoad = input.workouts.filter {
        let d = calendar.dateComponents([.day], from: $0.date, to: GoldenClock.now).day ?? 99
        return (8...28).contains(d)
    }.map(\.estimatedLoad).reduce(0, +)
    let chronic = DerivedMetricsEngine.chronicWeeklyLoad(acuteLoad: training.totalLoad7Day, priorLoad: priorLoad, totalLoad28Day: training.totalLoad28Day)
    let hrv = DerivedMetricsEngine.scoreHeartRateVariability(current: input.raw.heartRateVariabilitySDNN, baseline: calibration.hrvBaseline ?? input.baselines.averageHRV7Day)
    let rhr = DerivedMetricsEngine.scoreRestingHeartRate(current: input.raw.restingHeartRate, baseline: calibration.restingHeartRateBaseline ?? input.baselines.averageRestingHeartRate7Day)
    let cardio = DerivedMetricsEngine.normalize(input.raw.vo2Max, target: DerivedMetricsEngine.expectedVO2Max(age: input.raw.age, sex: input.raw.biologicalSex)) * 100
    let analysis = DerivedMetricsEngine.buildLoadAnalysis(totalLoad7Day: training.totalLoad7Day, chronicWeeklyLoad: chronic, acuteChronicRatio: training.acuteChronicRatio, loadFocus: training.loadFocus, calibration: calibration)

    let inter = Intermediates(
        hrvScore: hrv,
        restingHeartScore: rhr,
        energyAvailabilityScore: DerivedMetricsEngine.scoreEnergyAvailability(raw: input.raw),
        activityPaceScore: DerivedMetricsEngine.scoreTodayActivityPace(raw: input.raw, baselines: input.baselines, calibration: calibration),
        cardioScore: cardio,
        cardioReserveScore: DerivedMetricsEngine.compositeCardioReserveScore(cardioScore: cardio, restingHeartScore: rhr, hrvScore: hrv),
        loadCapacityScore: DerivedMetricsEngine.scoreLoadCapacity(workouts: input.workouts, totalLoad7Day: training.totalLoad7Day, chronicWeeklyLoad: chronic, calibration: calibration),
        chronicWeeklyLoad: chronic,
        loadStatus: analysis.status
    )

    return GoldenCase(name: name, input: input, output: CaseOutput(
        derived: derived, calibration: calibration,
        totalLoad7Day: training.totalLoad7Day, totalLoad28Day: training.totalLoad28Day,
        acuteChronicRatio: training.acuteChronicRatio, fatigueScore: training.fatigueScore,
        loadFocus: training.loadFocus, intermediates: inter
    ))
}

var cases: [GoldenCase] = []

// 1. Everything missing — documents the original engine's neutral fallbacks.
cases.append(run("all-missing", CaseInput(raw: emptyRaw(), baselines: HealthSnapshot.placeholder().baselines, workouts: [], dailyTrends: [], longTermTrends: [])))

// 2. Only the three core recovery signals.
do {
    var raw = emptyRaw()
    raw.heartRateVariabilitySDNN = 52
    raw.restingHeartRate = 57
    raw.sleep = SleepSummary(totalHours: 7.3, inBedHours: 7.9, deepHours: 1.1, remHours: 1.5, coreHours: 4.7, awakeHours: 0.4)
    var baselines = HealthSnapshot.placeholder().baselines
    baselines.averageHRV7Day = 58; baselines.averageRestingHeartRate7Day = 55; baselines.averageSleepHours7Day = 7.1
    cases.append(run("core-signals-only", CaseInput(raw: raw, baselines: baselines, workouts: [], dailyTrends: [], longTermTrends: [])))
}

// 3..N: seeded random scenarios with varying data density.
var rng = LCG(state: 20261108)
for i in 0..<60 {
    let density = [1.0, 0.85, 0.6, 0.35][i % 4]
    let raw = randomRaw(&rng, p: density)
    let workoutCount = rng.int(0, 22)
    let workouts = (0..<workoutCount)
        .map { _ in makeWorkout(&rng, daysAgo: rng.range(0.05, 27.9), age: raw.age) }
        .sorted { $0.date > $1.date }
    let long = makeTrends(&rng, workouts: workouts, days: 28, density: density)
    let daily = Array(long.suffix(7))
    let baselines = randomBaselines(&rng, p: density, workouts: workouts)
    cases.append(run("random-\(i)-density-\(density)", CaseInput(raw: raw, baselines: baselines, workouts: workouts, dailyTrends: daily, longTermTrends: long)))
}

var loadCases: [WorkoutLoadCase] = []
for _ in 0..<40 {
    let kinds = WorkoutKind.allCases
    let kind = kinds[rng.int(0, kinds.count - 1)]
    let duration = roundTo(rng.range(0, 120), 1)
    let avg = rng.maybe(0.8, roundTo(rng.range(80, 190), 0))
    let mx = rng.maybe(0.6, roundTo(rng.range(150, 200), 0))
    let cal = rng.maybe(0.7, roundTo(rng.range(20, 1200), 0))
    let age: Int? = rng.next() < 0.7 ? rng.int(18, 75) : nil
    loadCases.append(WorkoutLoadCase(
        durationMinutes: duration, averageHeartRate: avg, maxHeartRate: mx, calories: cal, age: age, kind: kind,
        load: DerivedMetricsEngine.estimateWorkoutLoad(durationMinutes: duration, averageHeartRate: avg, maxHeartRate: mx, calories: cal, age: age),
        zones: DerivedMetricsEngine.estimateZoneDistribution(durationMinutes: duration, averageHeartRate: avg, maxHeartRate: mx, age: age, kind: kind)
    ))
}

let file = GoldenFile(
    generator: "tools/swift-golden/main.swift",
    sourceRepo: "https://github.com/zdy-forever/health_monitor_ios",
    sourceCommit: ProcessInfo.processInfo.environment["SOURCE_COMMIT"] ?? "unknown",
    timeZone: TimeZone.current.identifier,
    firstWeekday: calendar.firstWeekday,
    nowMs: now.timeIntervalSince1970 * 1000,
    cases: cases,
    workoutLoadCases: loadCases
)

let encoder = JSONEncoder()
encoder.dateEncodingStrategy = .millisecondsSince1970
encoder.outputFormatting = [.sortedKeys]
FileHandle.standardOutput.write(try! encoder.encode(file))
