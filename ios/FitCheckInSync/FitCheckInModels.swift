import Foundation

// MARK: - Wire format (mirror of supabase/functions/_shared/metrics/health-schema.ts)

/// Data categories the user can enable for upload. Raw values match the server enum `public.health_category`.
enum FitCheckInCategory: String, Codable, CaseIterable, Identifiable {
    case scores
    case hrv
    case restingHeartRate = "resting_heart_rate"
    case heartRate = "heart_rate"
    case sleep
    case activity
    case workouts
    case vo2Max = "vo2_max"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .scores: "准备度 / 恢复度估计 · Readiness estimates"
        case .hrv: "HRV (SDNN)"
        case .restingHeartRate: "静息心率 · Resting HR"
        case .heartRate: "心率 · Heart rate"
        case .sleep: "睡眠 · Sleep"
        case .activity: "步数与能量 · Steps & energy"
        case .workouts: "体能训练 · Workouts"
        case .vo2Max: "最大摄氧量 · VO₂ max"
        }
    }

    /// `scores` is computed server-side from other categories; it has no HealthKit type.
    var isUploadable: Bool { self != .scores }
}

/// Metric identifiers + units accepted by the `health-ingest` Edge Function.
enum FitCheckInMetric: String, Codable {
    case hrvSDNN = "hrv_sdnn"
    case restingHeartRate = "resting_heart_rate"
    case heartRate = "heart_rate"
    case sleepAnalysis = "sleep_analysis"
    case stepCount = "step_count"
    case activeEnergy = "active_energy"
    case basalEnergy = "basal_energy"
    case exerciseTime = "exercise_time"
    case workout
    case vo2Max = "vo2_max"

    var unit: String {
        switch self {
        case .hrvSDNN: "ms"
        case .restingHeartRate, .heartRate: "bpm"
        case .sleepAnalysis: "h"
        case .stepCount: "count"
        case .activeEnergy, .basalEnergy: "kcal"
        case .exerciseTime, .workout: "min"
        case .vo2Max: "mL/kg/min"
        }
    }
}

struct HealthSampleUpload: Codable, Equatable {
    /// HealthKit UUID, or a deterministic bucket id for daily aggregates ("steps:2026-11-08").
    var sampleId: String
    var metricType: FitCheckInMetric
    var value: Double
    var unit: String
    /// Sample start (ISO-8601).
    var startAt: Date
    /// Sample end = measurement time (ISO-8601). Distinct from the server's `receivedAt`.
    var measuredAt: Date
    /// Sleep stage (sleep_analysis) or `WorkoutKind` raw value (workout).
    var category: String?
    var metadata: WorkoutMetadata?
    var sourceName: String?
    var sourceBundle: String?

    struct WorkoutMetadata: Codable, Equatable {
        var averageHeartRate: Double?
        var maxHeartRate: Double?
        var energyKCal: Double?
        var distanceKM: Double?
    }
}

struct HealthUploadRequest: Codable {
    var schemaVersion = 1
    var device: Device
    var timeZone: String
    var enabledCategories: [FitCheckInCategory]
    var samples: [HealthSampleUpload]

    struct Device: Codable {
        var installationId: String
        var name: String
        var osVersion: String?
        var appVersion: String?
    }
}

struct HealthUploadResponse: Codable {
    var accepted: Int
    var duplicates: Int
    var rejected: [Rejection]
    var snapshot: Snapshot?
    var receivedAt: String

    struct Rejection: Codable { var index: Int; var reason: String }
    struct Snapshot: Codable { var date: String; var completeness: Double; var algorithmVersion: String }
}

// MARK: - Sync state shown in the UI

enum FitCheckInSyncPhase: Equatable {
    case idle
    case authorizing
    case reading
    case uploading(done: Int, total: Int)
    case success
    case failed(String)
}

struct FitCheckInSyncRecord: Codable, Equatable {
    var finishedAt: Date
    var accepted: Int
    var duplicates: Int
    var rejected: Int
    var completeness: Double?
    var errorMessage: String?
}

enum FitCheckInError: LocalizedError, Equatable {
    case notConfigured
    case notSignedIn
    case invalidCredentials
    case healthDataUnavailable
    case healthAuthorizationDenied
    case network(String)
    case server(status: Int, code: String)
    case decoding

    var errorDescription: String? {
        switch self {
        case .notConfigured: "FitCheck-In 未配置（Info.plist 缺少 FitCheckInSupabaseURL / FitCheckInSupabaseAnonKey）。"
        case .notSignedIn: "请先登录 FitCheck-In 账号。"
        case .invalidCredentials: "邮箱或密码不正确。"
        case .healthDataUnavailable: "此设备不支持 Apple 健康。"
        case .healthAuthorizationDenied: "未获得 Apple 健康读取授权。请在“设置 › 健康 › 数据访问与设备”中允许。"
        case .network(let m): "网络异常：\(m)"
        case .server(let status, let code):
            switch code {
            case "only_clients_can_upload": "只有客户账号可以上传健康数据。"
            case "demo_accounts_cannot_upload": "演示账号不能上传真实健康数据。"
            case "invalid_token", "missing_token": "登录已过期，请重新登录。"
            default: "服务器错误（\(status)：\(code)）。"
            }
        case .decoding: "服务器返回了无法解析的数据。"
        }
    }

    /// Transient errors are retried with backoff; others are surfaced immediately.
    var isRetryable: Bool {
        switch self {
        case .network: true
        case .server(let status, _): status >= 500 || status == 429
        default: false
        }
    }
}
