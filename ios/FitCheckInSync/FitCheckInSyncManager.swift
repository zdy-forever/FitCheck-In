import Foundation
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Orchestrates sign-in, HealthKit authorization, reading, batched upload with retry,
/// and persisted sync status. Independent of `AppModel` so the existing health+
/// features are untouched.
@MainActor
final class FitCheckInSyncManager: ObservableObject {
    @Published private(set) var session: FitCheckInSession?
    @Published private(set) var phase: FitCheckInSyncPhase = .idle
    @Published private(set) var lastSync: FitCheckInSyncRecord?
    @Published private(set) var permissionState: HealthPermissionState = .unknown
    @Published var enabledCategories: Set<FitCheckInCategory> {
        didSet { persistCategories() }
    }
    @Published var backgroundSyncEnabled: Bool {
        didSet {
            UserDefaults.standard.set(backgroundSyncEnabled, forKey: Keys.background)
            configureBackgroundDelivery()
        }
    }

    let isConfigured: Bool
    private let api: FitCheckInAPIClient?
    private let reader = FitCheckInHealthReader()
    private static let batchSize = 1_000
    private static let maxAttempts = 4

    private enum Keys {
        static let categories = "fitcheckin.categories"
        static let lastSync = "fitcheckin.lastSync"
        static let installation = "fitcheckin.installationId"
        static let background = "fitcheckin.backgroundSync"
    }

    init(config: FitCheckInConfig? = .load()) {
        isConfigured = config != nil
        api = config.map { FitCheckInAPIClient(config: $0) }
        let saved = (UserDefaults.standard.array(forKey: Keys.categories) as? [String])?.compactMap(FitCheckInCategory.init(rawValue:))
        enabledCategories = Set(saved ?? [.scores, .hrv, .restingHeartRate, .sleep])
        backgroundSyncEnabled = UserDefaults.standard.bool(forKey: Keys.background)
        if let data = UserDefaults.standard.data(forKey: Keys.lastSync) {
            lastSync = try? JSONDecoder().decode(FitCheckInSyncRecord.self, from: data)
        }
        Task { await self.restoreSession() }
    }

    private func restoreSession() async {
        session = await api?.session
        configureBackgroundDelivery()
    }

    var installationId: String {
        if let id = UserDefaults.standard.string(forKey: Keys.installation) { return id }
        let id = UUID().uuidString.lowercased()
        UserDefaults.standard.set(id, forKey: Keys.installation)
        return id
    }

    // MARK: Account / device binding

    func signIn(email: String, password: String) async throws {
        guard let api else { throw FitCheckInError.notConfigured }
        session = try await api.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
    }

    /// Unlinks this device: signs out, forgets anchors and stops background delivery.
    /// Server data stays until the user deletes it on the web (Settings › Privacy).
    func unlinkDevice() async {
        await api?.signOut()
        reader.disableBackgroundDelivery()
        reader.resetAnchors()
        session = nil
        lastSync = nil
        UserDefaults.standard.removeObject(forKey: Keys.lastSync)
        UserDefaults.standard.removeObject(forKey: Keys.installation)
        phase = .idle
    }

    // MARK: Sync

    func requestHealthAuthorization() async {
        phase = .authorizing
        permissionState = await reader.requestAuthorization(for: enabledCategories)
        phase = permissionState == .authorized ? .idle : .failed(FitCheckInError.healthAuthorizationDenied.localizedDescription)
    }

    /// Manual sync (phase 1). `fullResync` re-sends the last 30 days, e.g. after server-side deletion.
    func syncNow(fullResync: Bool = false) async {
        if case .uploading = phase { return }
        if case .reading = phase { return }
        do {
            guard let api else { throw FitCheckInError.notConfigured }
            guard session != nil else { throw FitCheckInError.notSignedIn }
            guard reader.isAvailable else { throw FitCheckInError.healthDataUnavailable }
            if permissionState != .authorized {
                await requestHealthAuthorization()
                guard permissionState == .authorized else { throw FitCheckInError.healthAuthorizationDenied }
            }

            phase = .reading
            let result = try await reader.readNewSamples(categories: enabledCategories, fullResync: fullResync)
            let uploadable = enabledCategories
            let batches = stride(from: 0, to: max(result.samples.count, 1), by: Self.batchSize).map {
                Array(result.samples[$0..<min($0 + Self.batchSize, result.samples.count)])
            }

            var accepted = 0, duplicates = 0, rejected = 0
            var completeness: Double?
            for (i, batch) in batches.enumerated() {
                phase = .uploading(done: i, total: batches.count)
                let request = HealthUploadRequest(device: deviceInfo(), timeZone: TimeZone.current.identifier, enabledCategories: Array(uploadable), samples: batch)
                let response = try await withRetry { try await api.upload(request) }
                accepted += response.accepted
                duplicates += response.duplicates
                rejected += response.rejected.count
                completeness = response.snapshot?.completeness ?? completeness
            }
            reader.commit(result)
            record(FitCheckInSyncRecord(finishedAt: Date(), accepted: accepted, duplicates: duplicates, rejected: rejected, completeness: completeness, errorMessage: nil))
            phase = .success
        } catch {
            let message = (error as? FitCheckInError)?.localizedDescription ?? error.localizedDescription
            record(FitCheckInSyncRecord(finishedAt: Date(), accepted: 0, duplicates: 0, rejected: 0, completeness: nil, errorMessage: message))
            if case FitCheckInError.notSignedIn = error { session = nil }
            phase = .failed(message)
        }
    }

    /// Exponential backoff (1 s, 2 s, 4 s) for network errors and 5xx/429 only.
    private func withRetry<T>(_ operation: () async throws -> T) async throws -> T {
        var attempt = 0
        while true {
            do {
                return try await operation()
            } catch let error as FitCheckInError where error.isRetryable && attempt < Self.maxAttempts - 1 {
                attempt += 1
                try await Task.sleep(nanoseconds: UInt64(pow(2.0, Double(attempt - 1)) * 1_000_000_000))
            }
        }
    }

    private func deviceInfo() -> HealthUploadRequest.Device {
        #if canImport(UIKit)
        let name = UIDevice.current.model
        let os = "\(UIDevice.current.systemName) \(UIDevice.current.systemVersion)"
        #else
        let name = "iPhone"
        let os = ProcessInfo.processInfo.operatingSystemVersionString
        #endif
        let app = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        return .init(installationId: installationId, name: name, osVersion: os, appVersion: app)
    }

    private func record(_ r: FitCheckInSyncRecord) {
        lastSync = r
        if let data = try? JSONEncoder().encode(r) { UserDefaults.standard.set(data, forKey: Keys.lastSync) }
    }

    private func persistCategories() {
        UserDefaults.standard.set(enabledCategories.map(\.rawValue), forKey: Keys.categories)
        permissionState = .unknown // new types may need a new HealthKit prompt
    }

    private func configureBackgroundDelivery() {
        reader.disableBackgroundDelivery()
        guard backgroundSyncEnabled, session != nil else { return }
        reader.enableBackgroundDelivery(for: enabledCategories) { [weak self] in
            await self?.syncNow()
        }
    }
}
