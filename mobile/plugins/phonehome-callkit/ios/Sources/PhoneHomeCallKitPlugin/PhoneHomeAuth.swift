import Foundation
import LocalAuthentication
import Security

/// On-device Keychain + Face ID/Touch ID for PhoneHome login.
/// Passwords never leave the device except over HTTPS to `/api/auth/login`.
enum PhoneHomeAuth {
    static let service = "app.phonehome.ios"
    private static let usernameAccount = "login.username"
    private static let passwordAccount = "login.password"
    private static let sessionAccount = "session"

    enum AuthError: LocalizedError {
        case notFound
        case canceled
        case unavailable
        case failed(String)

        var errorDescription: String? {
            switch self {
            case .notFound: return "No saved sign-in"
            case .canceled: return "Sign-in canceled"
            case .unavailable: return "Face ID is not available"
            case .failed(let message): return message
            }
        }
    }

    struct SavedLogin {
        var saved: Bool
        var username: String
        var biometry: String
    }

    static func biometryLabel() -> String {
        let ctx = LAContext()
        var error: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            if ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) {
                return "passcode"
            }
            return "none"
        }
        switch ctx.biometryType {
        case .faceID: return "face"
        case .touchID: return "touch"
        default:
            if #available(iOS 17.0, *), ctx.biometryType == .opticID { return "optic" }
            return "none"
        }
    }

    static func hasSavedLogin() -> SavedLogin {
        let username = (try? read(account: usernameAccount)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
        // Existence only — don't require a data read (that can fail if the item
        // is mid-unlock or protected).
        let hasPassword = itemExists(account: passwordAccount)
        return SavedLogin(
            saved: hasPassword && !username.isEmpty,
            username: username,
            biometry: biometryLabel()
        )
    }

    static func saveLogin(username: String, password: String) throws {
        let user = username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !user.isEmpty, !password.isEmpty else {
            throw AuthError.failed("Username and password required")
        }
        guard let userData = user.data(using: .utf8),
              let passData = password.data(using: .utf8)
        else {
            throw AuthError.failed("Could not encode login")
        }
        try write(account: usernameAccount, data: userData)
        try write(account: passwordAccount, data: passData)
        print("[PhoneHomeAuth] login saved for \(user)")
    }

    static func clearLogin() {
        delete(account: usernameAccount)
        delete(account: passwordAccount)
    }

    static func saveSession(_ sessionId: String) throws {
        let trimmed = sessionId.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            delete(account: sessionAccount)
            return
        }
        guard let data = trimmed.data(using: .utf8) else {
            throw AuthError.failed("Could not encode session")
        }
        try write(account: sessionAccount, data: data)
    }

    static func loadSession() -> String {
        guard let data = try? read(account: sessionAccount) else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }

    static func clearSession() {
        delete(account: sessionAccount)
    }

    /// Face ID / Touch ID / device passcode, then return the saved password.
    static func unlockLogin(reason: String, completion: @escaping (Result<(String, String), Error>) -> Void) {
        let snapshot = hasSavedLogin()
        guard snapshot.saved else {
            completion(.failure(AuthError.notFound))
            return
        }
        let ctx = LAContext()
        ctx.localizedCancelTitle = "Use password"
        var error: NSError?
        let policy: LAPolicy = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
            ? .deviceOwnerAuthenticationWithBiometrics
            : .deviceOwnerAuthentication
        guard ctx.canEvaluatePolicy(policy, error: &error) else {
            completion(.failure(AuthError.unavailable))
            return
        }
        ctx.evaluatePolicy(policy, localizedReason: reason) { success, evalError in
            if let evalError = evalError as? LAError, evalError.code == .userCancel || evalError.code == .appCancel {
                completion(.failure(AuthError.canceled))
                return
            }
            guard success else {
                completion(.failure(evalError ?? AuthError.failed("Could not verify identity")))
                return
            }
            do {
                guard let passData = try read(account: passwordAccount),
                      let password = String(data: passData, encoding: .utf8),
                      !password.isEmpty
                else {
                    throw AuthError.notFound
                }
                completion(.success((snapshot.username, password)))
            } catch {
                completion(.failure(error))
            }
        }
    }

    private static func write(account: String, data: Data) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw AuthError.failed("Keychain save failed")
        }
    }

    private static func read(account: String) throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw AuthError.failed("Keychain read failed")
        }
        return out as? Data
    }

    private static func itemExists(account: String) -> Bool {
        var result: CFTypeRef?
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        return SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess
    }

    private static func delete(account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
