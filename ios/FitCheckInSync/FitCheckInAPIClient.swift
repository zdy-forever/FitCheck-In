import Foundation
import Security

/// Public, non-secret configuration read from Info.plist.
/// NEVER put a service-role / secret key in the app: only the anon (publishable) key.
struct FitCheckInConfig {
    let supabaseURL: URL
    let anonKey: String

    static func load(bundle: Bundle = .main) -> FitCheckInConfig? {
        guard
            let urlString = bundle.object(forInfoDictionaryKey: "FitCheckInSupabaseURL") as? String,
            let url = URL(string: urlString), url.scheme == "https" || url.host == "127.0.0.1" || url.host == "localhost",
            let key = bundle.object(forInfoDictionaryKey: "FitCheckInSupabaseAnonKey") as? String,
            !key.isEmpty, !key.hasPrefix("sb_secret_")
        else { return nil }
        return FitCheckInConfig(supabaseURL: url, anonKey: key)
    }
}

/// Minimal Keychain wrapper for the session (access + refresh token).
/// kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly: available to background delivery,
/// never migrated to other devices or backups.
enum FitCheckInKeychain {
    private static let service = "com.zdy.healthmonitor.fitcheckin"

    static func save(_ data: Data, account: String) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    static func load(account: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account,
            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else { return nil }
        return item as? Data
    }

    static func delete(account: String) {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] as CFDictionary)
    }
}

struct FitCheckInSession: Codable, Equatable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: Date
    var userId: String
    var email: String
}

/// Talks to Supabase Auth (GoTrue REST) and the `health-ingest` Edge Function over HTTPS.
actor FitCheckInAPIClient {
    private let config: FitCheckInConfig
    private let urlSession: URLSession
    private let keychainAccount = "session"
    private(set) var session: FitCheckInSession?

    init(config: FitCheckInConfig, urlSession: URLSession = .shared) {
        self.config = config
        self.urlSession = urlSession
        if let data = FitCheckInKeychain.load(account: keychainAccount) {
            session = try? JSONDecoder().decode(FitCheckInSession.self, from: data)
        }
    }

    // MARK: Auth

    func signIn(email: String, password: String) async throws -> FitCheckInSession {
        let body = try JSONSerialization.data(withJSONObject: ["email": email, "password": password])
        let data = try await post(path: "auth/v1/token?grant_type=password", body: body, bearer: nil, mapAuthErrors: true)
        let s = try decodeSession(data, fallbackEmail: email)
        store(s)
        return s
    }

    func signOut() async {
        if let token = session?.accessToken {
            _ = try? await post(path: "auth/v1/logout", body: Data("{}".utf8), bearer: token, mapAuthErrors: false)
        }
        session = nil
        FitCheckInKeychain.delete(account: keychainAccount)
    }

    /// Returns a valid access token, refreshing it if it expires within 60 s.
    func validAccessToken() async throws -> String {
        guard let s = session else { throw FitCheckInError.notSignedIn }
        if s.expiresAt.timeIntervalSinceNow > 60 { return s.accessToken }
        let body = try JSONSerialization.data(withJSONObject: ["refresh_token": s.refreshToken])
        do {
            let data = try await post(path: "auth/v1/token?grant_type=refresh_token", body: body, bearer: nil, mapAuthErrors: true)
            let refreshed = try decodeSession(data, fallbackEmail: s.email)
            store(refreshed)
            return refreshed.accessToken
        } catch FitCheckInError.invalidCredentials {
            await signOut()
            throw FitCheckInError.notSignedIn
        }
    }

    // MARK: Upload

    func upload(_ request: HealthUploadRequest) async throws -> HealthUploadResponse {
        let token = try await validAccessToken()
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try await post(path: "functions/v1/health-ingest", body: try encoder.encode(request), bearer: token, mapAuthErrors: false)
        do {
            return try JSONDecoder().decode(HealthUploadResponse.self, from: data)
        } catch {
            throw FitCheckInError.decoding
        }
    }

    // MARK: Plumbing

    private func store(_ s: FitCheckInSession) {
        session = s
        if let data = try? JSONEncoder().encode(s) { FitCheckInKeychain.save(data, account: keychainAccount) }
    }

    private func decodeSession(_ data: Data, fallbackEmail: String) throws -> FitCheckInSession {
        struct Raw: Decodable {
            let access_token: String
            let refresh_token: String
            let expires_in: Double
            let user: User
            struct User: Decodable { let id: String; let email: String? }
        }
        guard let raw = try? JSONDecoder().decode(Raw.self, from: data) else { throw FitCheckInError.decoding }
        return FitCheckInSession(
            accessToken: raw.access_token,
            refreshToken: raw.refresh_token,
            expiresAt: Date().addingTimeInterval(raw.expires_in),
            userId: raw.user.id,
            email: raw.user.email ?? fallbackEmail
        )
    }

    private func post(path: String, body: Data, bearer: String?, mapAuthErrors: Bool) async throws -> Data {
        guard let url = URL(string: path, relativeTo: config.supabaseURL.appendingPathComponent("/")) else { throw FitCheckInError.notConfigured }
        var req = URLRequest(url: url, timeoutInterval: 30)
        req.httpMethod = "POST"
        req.httpBody = body
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(config.anonKey, forHTTPHeaderField: "apikey")
        if let bearer { req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await urlSession.data(for: req)
        } catch {
            throw FitCheckInError.network((error as NSError).localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { throw FitCheckInError.network("no_response") }
        guard (200..<300).contains(http.statusCode) else {
            if mapAuthErrors, http.statusCode == 400 || http.statusCode == 401 { throw FitCheckInError.invalidCredentials }
            let code = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String ?? "http_\(http.statusCode)"
            throw FitCheckInError.server(status: http.statusCode, code: code)
        }
        return data
    }
}
