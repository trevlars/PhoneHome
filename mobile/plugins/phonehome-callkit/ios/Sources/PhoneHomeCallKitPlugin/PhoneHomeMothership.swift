import Foundation
import Capacitor

/// Persisted self-hosted Mothership HTTPS origin for the Cap WebView.
/// Survives DDNS / hostname changes without rebuilding the app.
public enum PhoneHomeMothership {
    public static let urlKey = "ph_mothership_url"
    /// Once we seed from build-time server.url, don't overwrite a cleared preference.
    private static let seededKey = "ph_mothership_url_seeded"

    public enum MothershipError: LocalizedError {
        case empty
        case notHttps
        case invalid

        public var errorDescription: String? {
            switch self {
            case .empty: return "Enter your Mothership HTTPS address"
            case .notHttps: return "Mothership address must start with https://"
            case .invalid: return "That doesn’t look like a valid HTTPS URL"
            }
        }
    }

    /// Normalize to origin (scheme + host + optional port), no trailing slash/path.
    public static func normalize(_ raw: String) throws -> String {
        var trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw MothershipError.empty }
        if !trimmed.contains("://") {
            trimmed = "https://\(trimmed)"
        }
        guard let url = URL(string: trimmed), let scheme = url.scheme?.lowercased() else {
            throw MothershipError.invalid
        }
        guard scheme == "https" else { throw MothershipError.notHttps }
        guard let host = url.host, !host.isEmpty else { throw MothershipError.invalid }
        var origin = "https://\(host)"
        if let port = url.port {
            origin += ":\(port)"
        }
        return origin
    }

    public static func load() -> String? {
        let value = UserDefaults.standard.string(forKey: urlKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? nil : value
    }

    @discardableResult
    public static func save(_ raw: String) throws -> String {
        let normalized = try normalize(raw)
        UserDefaults.standard.set(normalized, forKey: urlKey)
        UserDefaults.standard.set(true, forKey: seededKey)
        return normalized
    }

    public static func clear() {
        UserDefaults.standard.removeObject(forKey: urlKey)
        UserDefaults.standard.set(true, forKey: seededKey)
    }

    /// Record first-launch migration only — do not auto-save `server.url` as the Mothership.
    /// Parents choose their hub on the bundled Connect screen; lab seeds use PHONEHOME_CAP_URL at build time
    /// only when explicitly requested (still entered via Connect, not silently injected here).
    public static func seedFromBuildConfigIfNeeded(serverUrl: String?) {
        if load() != nil { return }
        if UserDefaults.standard.bool(forKey: seededKey) { return }
        _ = serverUrl
        UserDefaults.standard.set(true, forKey: seededKey)
    }

    public static func loadURL() -> URL? {
        guard let s = load() else { return nil }
        return URL(string: s)
    }
}
