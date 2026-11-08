import Foundation
import HealthKit

/// Reads Apple Health samples for upload.
///
/// Reuse from the existing app (health_monitor_ios):
///  - same HealthKit units as `HealthKitService` (bpm = count/min, HRV in ms, VO₂ in mL/(kg·min))
///  - same sleep-stage semantics as `HealthKitService.fetchSleepSummary` (inBed/awake are not "asleep")
///  - same `HKWorkoutActivityType` → `WorkoutKind` mapping as `HealthKitService.workoutKind(for:)`
///  - `HealthPermissionState` from DomainModels
///
/// Difference from `HealthKitService`: that service reads *aggregates* (latest/sum/avg), which
/// have no stable identity. For an idempotent upload we read individual samples with
/// `HKAnchoredObjectQuery` (each has a UUID) and persist the anchor, so later syncs only send
/// new samples. Additive metrics (steps, energy, exercise time) are uploaded as daily
/// `HKStatisticsCollectionQuery` buckets with deterministic ids so overlapping sources
/// (iPhone + Watch) are de-duplicated by HealthKit itself, exactly like the existing app's sums.
struct FitCheckInHealthReader {
    private let store: HKHealthStore
    private let calendar = Calendar.current
    private let anchorDefaults = UserDefaults.standard
    private static let anchorKeyPrefix = "fitcheckin.anchor."

    init(store: HKHealthStore = HKHealthStore()) {
        self.store = store
    }

    var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    // MARK: Authorization (HealthKit system permission — separate from platform sharing grants)

    func readTypes(for categories: Set<FitCheckInCategory>) -> Set<HKObjectType> {
        var types = Set<HKObjectType>()
        func q(_ id: HKQuantityTypeIdentifier) { if let t = HKObjectType.quantityType(forIdentifier: id) { types.insert(t) } }
        if categories.contains(.hrv) { q(.heartRateVariabilitySDNN) }
        if categories.contains(.restingHeartRate) { q(.restingHeartRate) }
        if categories.contains(.heartRate) { q(.heartRate) }
        if categories.contains(.vo2Max) { q(.vo2Max) }
        if categories.contains(.activity) { q(.stepCount); q(.activeEnergyBurned); q(.basalEnergyBurned); q(.appleExerciseTime) }
        if categories.contains(.sleep), let s = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { types.insert(s) }
        if categories.contains(.heartRate) { q(.walkingHeartRateAverage); q(.heartRateRecoveryOneMinute) }
        if categories.contains(.activity) { q(.distanceWalkingRunning); q(.distanceCycling); q(.distanceSwimming); q(.flightsClimbed) }
        if categories.contains(.vitals) { q(.oxygenSaturation); q(.respiratoryRate); q(.appleSleepingWristTemperature) }
        if categories.contains(.mobility) {
            q(.walkingSpeed); q(.appleWalkingSteadiness); q(.walkingAsymmetryPercentage)
            q(.walkingDoubleSupportPercentage); q(.walkingStepLength); q(.sixMinuteWalkTestDistance)
        }
        if categories.contains(.body) { q(.bodyMass); q(.bodyFatPercentage); q(.leanBodyMass) }
        if categories.contains(.workouts) {
            q(.runningPower); q(.runningSpeed); q(.runningGroundContactTime); q(.runningVerticalOscillation); q(.runningStrideLength)
            q(.cyclingPower); q(.cyclingCadence)
        }
        if categories.contains(.workouts) {
            types.insert(HKObjectType.workoutType())
            q(.heartRate)
            if #available(iOS 18.0, macOS 15.0, *) { q(.workoutEffortScore); q(.estimatedWorkoutEffortScore) }
        }
        return types
    }

    /// HealthKit never reveals whether *read* access was granted (privacy). `success == true`
    /// only means the prompt was handled; denied types simply return no samples.
    func requestAuthorization(for categories: Set<FitCheckInCategory>) async -> HealthPermissionState {
        guard isAvailable else { return .unavailable }
        let types = readTypes(for: categories)
        guard !types.isEmpty else { return .unknown }
        do {
            try await store.requestAuthorization(toShare: [], read: types)
            return .authorized
        } catch {
            return .denied
        }
    }

    // MARK: Read

    /// Reads new samples for the enabled categories. `fullResync` ignores stored anchors
    /// (used after the user deletes server data). Anchors are only committed after a
    /// successful upload via `commit(_:)`.
    func readNewSamples(categories: Set<FitCheckInCategory>, lookbackDays: Int = 90, fullResync: Bool = false) async throws -> ReadResult {
        let start = calendar.date(byAdding: .day, value: -lookbackDays, to: Date()) ?? Date().addingTimeInterval(-Double(lookbackDays) * 86_400)
        var samples: [HealthSampleUpload] = []
        var pendingAnchors: [String: HKQueryAnchor] = [:]

        func anchored(_ type: HKSampleType, key: String, since: Date? = nil) async throws -> [HKSample] {
            let anchor = fullResync ? nil : loadAnchor(key)
            let (newSamples, newAnchor) = try await anchoredQuery(type: type, since: since ?? start, anchor: anchor)
            if let newAnchor { pendingAnchors[key] = newAnchor }
            return newSamples
        }

        let bpm = HKUnit.count().unitDivided(by: .minute())
        let mps = HKUnit.meter().unitDivided(by: .second())
        // (category, HealthKit type, metric, unit, multiplier). Percent types are stored by
        // HealthKit as 0–1 fractions; ×100 like HealthKitService.fetchRawHealthData.
        let quantityMetrics: [(FitCheckInCategory, HKQuantityTypeIdentifier, FitCheckInMetric, HKUnit, Double)] = [
            (.hrv, .heartRateVariabilitySDNN, .hrvSDNN, .secondUnit(with: .milli), 1),
            (.restingHeartRate, .restingHeartRate, .restingHeartRate, bpm, 1),
            (.vo2Max, .vo2Max, .vo2Max, HKUnit.literUnit(with: .milli).unitDivided(by: HKUnit.gramUnit(with: .kilo).unitMultiplied(by: .minute())), 1),
            (.heartRate, .walkingHeartRateAverage, .walkingHeartRate, bpm, 1),
            (.heartRate, .heartRateRecoveryOneMinute, .heartRateRecovery, bpm, 1),
            (.vitals, .oxygenSaturation, .oxygenSaturation, .percent(), 100),
            (.vitals, .respiratoryRate, .respiratoryRate, bpm, 1),
            (.vitals, .appleSleepingWristTemperature, .wristTemperature, .degreeCelsius(), 1),
            (.mobility, .walkingSpeed, .walkingSpeed, mps, 1),
            (.mobility, .appleWalkingSteadiness, .walkingSteadiness, .percent(), 100),
            (.mobility, .walkingAsymmetryPercentage, .walkingAsymmetry, .percent(), 100),
            (.mobility, .walkingDoubleSupportPercentage, .walkingDoubleSupport, .percent(), 100),
            (.mobility, .walkingStepLength, .walkingStepLength, .meter(), 1),
            (.mobility, .sixMinuteWalkTestDistance, .sixMinuteWalk, .meter(), 1),
            (.body, .bodyMass, .bodyMass, .gramUnit(with: .kilo), 1),
            (.body, .bodyFatPercentage, .bodyFat, .percent(), 100),
            (.body, .leanBodyMass, .leanBodyMass, .gramUnit(with: .kilo), 1),
        ]
        for (category, identifier, metric, unit, multiplier) in quantityMetrics where categories.contains(category) {
            guard let type = HKObjectType.quantityType(forIdentifier: identifier) else { continue }
            // Slow-moving metrics: look back 90 days on first sync (trends); others use lookbackDays.
            let slow: Set<FitCheckInMetric> = [.vo2Max, .heartRateRecovery, .bodyMass, .bodyFat, .leanBodyMass, .walkingSpeed, .walkingSteadiness, .walkingAsymmetry, .walkingDoubleSupport, .walkingStepLength, .sixMinuteWalk]
            let since = slow.contains(metric) ? max(start, Date().addingTimeInterval(-90 * 86_400)) : start
            for case let s as HKQuantitySample in try await anchored(type, key: metric.rawValue, since: since) {
                samples.append(upload(s, metric: metric, value: s.quantity.doubleValue(for: unit) * multiplier))
            }
        }

        // Heart rate is very dense on Apple Watch; upload hourly averages (deterministic ids) instead of every beat sample.
        if categories.contains(.heartRate) {
            samples += try await hourlyAverages(.heartRate, unit: bpm, metric: .heartRate, start: max(start, Date().addingTimeInterval(-7 * 86_400)))
        }

        if categories.contains(.sleep), let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
            for case let s as HKCategorySample in try await anchored(type, key: FitCheckInMetric.sleepAnalysis.rawValue) {
                guard let stage = Self.sleepStage(s.value) else { continue }
                samples.append(upload(s, metric: .sleepAnalysis, value: s.endDate.timeIntervalSince(s.startDate) / 3_600, category: stage))
            }
        }

        if categories.contains(.workouts) {
            for case let w as HKWorkout in try await anchored(HKObjectType.workoutType(), key: FitCheckInMetric.workout.rawValue) {
                let hr = await heartRateStats(start: w.startDate, end: w.endDate)
                let kcal = w.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?.doubleValue(for: .kilocalorie())
                let km = w.totalDistance?.doubleValue(for: .meterUnit(with: .kilo))
                let effort = await workoutEffort(start: w.startDate, end: w.endDate)
                let kind = Self.workoutKind(for: w.workoutActivityType)
                var item = upload(w, metric: .workout, value: w.duration / 60, category: kind.rawValue)
                var meta = HealthSampleUpload.WorkoutMetadata(averageHeartRate: hr.average, maxHeartRate: hr.maximum, energyKCal: kcal, distanceKM: km, appleEffort: effort)
                if kind == .running {
                    meta.runningPowerW = await averageDuring(.runningPower, unit: .watt(), start: w.startDate, end: w.endDate)
                    meta.runningSpeedMS = await averageDuring(.runningSpeed, unit: HKUnit.meter().unitDivided(by: .second()), start: w.startDate, end: w.endDate)
                    meta.groundContactMS = await averageDuring(.runningGroundContactTime, unit: .secondUnit(with: .milli), start: w.startDate, end: w.endDate)
                    meta.verticalOscillationCM = await averageDuring(.runningVerticalOscillation, unit: .meterUnit(with: .centi), start: w.startDate, end: w.endDate)
                    meta.strideLengthM = await averageDuring(.runningStrideLength, unit: .meter(), start: w.startDate, end: w.endDate)
                } else if kind == .cycling {
                    meta.cyclingPowerW = await averageDuring(.cyclingPower, unit: .watt(), start: w.startDate, end: w.endDate)
                    meta.cyclingCadenceRPM = await averageDuring(.cyclingCadence, unit: HKUnit.count().unitDivided(by: .minute()), start: w.startDate, end: w.endDate)
                }
                item.metadata = meta
                samples.append(item)
            }
        }

        if categories.contains(.activity) {
            let dayStart = calendar.startOfDay(for: start)
            samples += try await dailySums(.stepCount, unit: .count(), metric: .stepCount, start: dayStart)
            samples += try await dailySums(.activeEnergyBurned, unit: .kilocalorie(), metric: .activeEnergy, start: dayStart)
            samples += try await dailySums(.basalEnergyBurned, unit: .kilocalorie(), metric: .basalEnergy, start: dayStart)
            samples += try await dailySums(.appleExerciseTime, unit: .minute(), metric: .exerciseTime, start: dayStart)
            samples += try await dailySums(.distanceWalkingRunning, unit: .meterUnit(with: .kilo), metric: .distanceWalkingRunning, start: dayStart)
            samples += try await dailySums(.distanceCycling, unit: .meterUnit(with: .kilo), metric: .distanceCycling, start: dayStart)
            samples += try await dailySums(.distanceSwimming, unit: .meter(), metric: .distanceSwimming, start: dayStart)
            samples += try await dailySums(.flightsClimbed, unit: .count(), metric: .flightsClimbed, start: dayStart)
        }

        return ReadResult(samples: samples, pendingAnchors: pendingAnchors)
    }

    struct ReadResult {
        var samples: [HealthSampleUpload]
        fileprivate var pendingAnchors: [String: HKQueryAnchor]
    }

    /// Persist anchors only after the server accepted the batch, so a failed upload is retried next time.
    func commit(_ result: ReadResult) {
        for (key, anchor) in result.pendingAnchors { saveAnchor(anchor, key: key) }
    }

    func resetAnchors() {
        for key in anchorDefaults.dictionaryRepresentation().keys where key.hasPrefix(Self.anchorKeyPrefix) {
            anchorDefaults.removeObject(forKey: key)
        }
    }

    // MARK: Mapping (mirrors HealthKitService)

    /// Same semantics as `HealthKitService.fetchSleepSummary`.
    static func sleepStage(_ raw: Int) -> String? {
        guard let value = HKCategoryValueSleepAnalysis(rawValue: raw) else { return nil }
        switch value {
        case .inBed: return "inBed"
        case .awake: return "awake"
        case .asleepCore: return "asleepCore"
        case .asleepDeep: return "asleepDeep"
        case .asleepREM: return "asleepREM"
        case .asleepUnspecified: return "asleepUnspecified"
        @unknown default: return "asleepUnspecified"
        }
    }

    /// Same mapping as `HealthKitService.workoutKind(for:)`.
    static func workoutKind(for activityType: HKWorkoutActivityType) -> WorkoutKind {
        switch activityType {
        case .running: return .running
        case .walking, .hiking: return .walking
        case .cycling: return .cycling
        case .traditionalStrengthTraining, .functionalStrengthTraining: return .strength
        case .yoga, .pilates: return .yoga
        case .swimming: return .swimming
        default: return .mixed
        }
    }

    private func upload(_ s: HKSample, metric: FitCheckInMetric, value: Double, category: String? = nil) -> HealthSampleUpload {
        HealthSampleUpload(
            sampleId: s.uuid.uuidString,
            metricType: metric,
            value: value,
            unit: metric.unit,
            startAt: s.startDate,
            measuredAt: s.endDate,
            category: category,
            metadata: nil,
            sourceName: s.sourceRevision.source.name,
            sourceBundle: s.sourceRevision.source.bundleIdentifier
        )
    }

    // MARK: Queries

    private func anchoredQuery(type: HKSampleType, since: Date, anchor: HKQueryAnchor?) async throws -> ([HKSample], HKQueryAnchor?) {
        try await withCheckedThrowingContinuation { cont in
            let predicate = HKQuery.predicateForSamples(withStart: since, end: nil)
            let query = HKAnchoredObjectQuery(type: type, predicate: predicate, anchor: anchor, limit: HKObjectQueryNoLimit) { _, samples, _, newAnchor, error in
                if let error = error as? HKError, error.code == .errorAuthorizationDenied || error.code == .errorAuthorizationNotDetermined {
                    cont.resume(returning: ([], nil))
                } else if let error {
                    cont.resume(throwing: error)
                } else {
                    cont.resume(returning: (samples ?? [], newAnchor))
                }
            }
            store.execute(query)
        }
    }

    private func dailySums(_ id: HKQuantityTypeIdentifier, unit: HKUnit, metric: FitCheckInMetric, start: Date) async throws -> [HealthSampleUpload] {
        try await collection(id, unit: unit, metric: metric, start: start, interval: DateComponents(day: 1), options: .cumulativeSum, idFormat: "yyyy-MM-dd")
    }

    private func hourlyAverages(_ id: HKQuantityTypeIdentifier, unit: HKUnit, metric: FitCheckInMetric, start: Date) async throws -> [HealthSampleUpload] {
        try await collection(id, unit: unit, metric: metric, start: start, interval: DateComponents(hour: 1), options: .discreteAverage, idFormat: "yyyy-MM-dd'T'HH")
    }

    private func collection(_ id: HKQuantityTypeIdentifier, unit: HKUnit, metric: FitCheckInMetric, start: Date, interval: DateComponents, options: HKStatisticsOptions, idFormat: String) async throws -> [HealthSampleUpload] {
        guard let type = HKObjectType.quantityType(forIdentifier: id) else { return [] }
        let now = Date()
        let fmt = DateFormatter()
        fmt.calendar = Calendar(identifier: .gregorian)
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.timeZone = calendar.timeZone
        fmt.dateFormat = idFormat
        return try await withCheckedThrowingContinuation { cont in
            let query = HKStatisticsCollectionQuery(
                quantityType: type,
                quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: now),
                options: options,
                anchorDate: calendar.startOfDay(for: start),
                intervalComponents: interval
            )
            query.initialResultsHandler = { _, collection, error in
                if let error = error as? HKError, error.code == .errorAuthorizationDenied {
                    cont.resume(returning: [])
                    return
                }
                if let error {
                    cont.resume(throwing: error)
                    return
                }
                var out: [HealthSampleUpload] = []
                collection?.enumerateStatistics(from: start, to: now) { stats, _ in
                    let q = options.contains(.cumulativeSum) ? stats.sumQuantity() : stats.averageQuantity()
                    guard let value = q?.doubleValue(for: unit) else { return }
                    // Bucket id is the local day/hour, so re-uploads of today's growing total update in place.
                    out.append(HealthSampleUpload(
                        sampleId: "\(metric.rawValue):\(fmt.string(from: stats.startDate))",
                        metricType: metric,
                        value: value,
                        unit: metric.unit,
                        startAt: stats.startDate,
                        measuredAt: min(stats.endDate, now),
                        category: nil,
                        metadata: nil,
                        sourceName: "Apple Health (aggregated)",
                        sourceBundle: nil
                    ))
                }
                cont.resume(returning: out)
            }
            store.execute(query)
        }
    }

    /// Apple Workout Effort for a workout's time range (iOS 18+): the user's own rating if they
    /// set one in the Fitness app, otherwise Apple's estimate. nil on older iOS or when absent.
    private func workoutEffort(start: Date, end: Date) async -> Double? {
        guard #available(iOS 18.0, macOS 15.0, *) else { return nil }
        let predicate = HKQuery.predicateForSamples(withStart: start.addingTimeInterval(-60), end: end.addingTimeInterval(15 * 60))
        for identifier in [HKQuantityTypeIdentifier.workoutEffortScore, .estimatedWorkoutEffortScore] {
            guard let type = HKObjectType.quantityType(forIdentifier: identifier) else { continue }
            let value: Double? = await withCheckedContinuation { cont in
                let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
                let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: 1, sortDescriptors: [sort]) { _, samples, _ in
                    let v = (samples?.first as? HKQuantitySample)?.quantity.doubleValue(for: .appleEffortScore())
                    cont.resume(returning: v)
                }
                store.execute(query)
            }
            if let value, (1...10).contains(value) { return value }
        }
        return nil
    }

    /// Discrete average of a quantity type during a workout (running/cycling dynamics).
    private func averageDuring(_ identifier: HKQuantityTypeIdentifier, unit: HKUnit, start: Date, end: Date) async -> Double? {
        guard let type = HKObjectType.quantityType(forIdentifier: identifier) else { return nil }
        return await withCheckedContinuation { cont in
            let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: end), options: .discreteAverage) { _, result, _ in
                cont.resume(returning: result?.averageQuantity()?.doubleValue(for: unit))
            }
            store.execute(query)
        }
    }

    /// Same statistics query as `HealthKitService.fetchHeartRateStats`.
    private func heartRateStats(start: Date, end: Date) async -> (average: Double?, maximum: Double?) {
        guard let type = HKObjectType.quantityType(forIdentifier: .heartRate) else { return (nil, nil) }
        let bpm = HKUnit.count().unitDivided(by: .minute())
        return await withCheckedContinuation { cont in
            let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: end), options: [.discreteAverage, .discreteMax]) { _, result, _ in
                cont.resume(returning: (result?.averageQuantity()?.doubleValue(for: bpm), result?.maximumQuantity()?.doubleValue(for: bpm)))
            }
            store.execute(query)
        }
    }

    private func loadAnchor(_ key: String) -> HKQueryAnchor? {
        guard let data = anchorDefaults.data(forKey: Self.anchorKeyPrefix + key) else { return nil }
        return try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
    }

    private func saveAnchor(_ anchor: HKQueryAnchor, key: String) {
        if let data = try? NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true) {
            anchorDefaults.set(data, forKey: Self.anchorKeyPrefix + key)
        }
    }

    // MARK: Background delivery (best effort — iOS decides when to wake the app)

    func enableBackgroundDelivery(for categories: Set<FitCheckInCategory>, handler: @escaping @Sendable () async -> Void) {
        let ids: [HKQuantityTypeIdentifier] = categories.contains(.hrv) ? [.heartRateVariabilitySDNN] : []
        var types: [HKSampleType] = ids.compactMap { HKObjectType.quantityType(forIdentifier: $0) }
        if categories.contains(.restingHeartRate), let t = HKObjectType.quantityType(forIdentifier: .restingHeartRate) { types.append(t) }
        if categories.contains(.sleep), let t = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { types.append(t) }
        for type in types {
            let query = HKObserverQuery(sampleType: type, predicate: nil) { _, completion, error in
                guard error == nil else { completion(); return }
                Task {
                    await handler()
                    completion()
                }
            }
            store.execute(query)
            store.enableBackgroundDelivery(for: type, frequency: .hourly) { _, _ in }
        }
    }

    func disableBackgroundDelivery() {
        store.disableAllBackgroundDelivery { _, _ in }
    }
}
