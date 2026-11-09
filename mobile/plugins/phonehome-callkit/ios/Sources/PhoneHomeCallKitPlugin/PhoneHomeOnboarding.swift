import Foundation

/// Walkthrough completion that must survive Cap bundled → remote Mothership hop
/// (WKWebView localStorage does not).
enum PhoneHomeOnboarding {
    private static let howItWorksKey = "ph_how_it_works_done_v1"
    /// Device-scoped Pod migrate transfer (JSON). Survives Change Mothership.
    private static let migrateTransferKey = "ph_migrate_transfer_v1"

    static var howItWorksDone: Bool {
        UserDefaults.standard.bool(forKey: howItWorksKey)
    }

    static func setHowItWorksDone(_ done: Bool) {
        UserDefaults.standard.set(done, forKey: howItWorksKey)
    }

    static var migrateTransferJson: String? {
        UserDefaults.standard.string(forKey: migrateTransferKey)
    }

    static func setMigrateTransferJson(_ json: String?) {
        if let json, !json.isEmpty {
            UserDefaults.standard.set(json, forKey: migrateTransferKey)
        } else {
            UserDefaults.standard.removeObject(forKey: migrateTransferKey)
        }
    }

    static func clearMigrateTransfer() {
        UserDefaults.standard.removeObject(forKey: migrateTransferKey)
    }
}
