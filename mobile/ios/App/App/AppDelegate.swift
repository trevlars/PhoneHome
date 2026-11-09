import UIKit
import Capacitor
import PhonehomeCallkit
import Intents

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    // Scene-based lifecycle (required on iOS 26+/27). Window lives on SceneDelegate.

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // CXProvider must exist before Recents/Favorites deliver CXStartCallAction.
        _ = PhoneHomeCallKit.shared
        clearStaleLaunchScreenCache()
        return true
    }

    /// iOS keeps a snapshot of the launch storyboard across updates, so new launch art
    /// can show the old art for many launches. Drop the snapshot once per build.
    private func clearStaleLaunchScreenCache() {
        let key = "ph_launch_cache_build"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
        let defaults = UserDefaults.standard
        guard defaults.string(forKey: key) != build else { return }
        let splashBoard = (NSHomeDirectory() as NSString).appendingPathComponent("Library/SplashBoard")
        try? FileManager.default.removeItem(atPath: splashBoard)
        defaults.set(build, forKey: key)
    }

    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
    }

    func application(
        _ application: UIApplication,
        didDiscardSceneSessions sceneSessions: Set<UISceneSession>
    ) {}

    func application(
        _ app: UIApplication,
        open url: URL,
        options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    ) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(
        _ application: UIApplication,
        continue userActivity: NSUserActivity,
        restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
    ) -> Bool {
        if let intent = userActivity.interaction?.intent as? INStartCallIntent {
            if PhoneHomeCallKit.shared.handleStartCallIntent(intent) {
                return true
            }
        }
        return ApplicationDelegateProxy.shared.application(
            application,
            continue: userActivity,
            restorationHandler: restorationHandler
        )
    }

    // Standard APNs (alert path when CallKit is tabled — not PushKit VoIP).
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        PhoneHomeCallKit.shared.didRegisterForRemoteNotifications(deviceToken: deviceToken)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        PhoneHomeCallKit.shared.didFailToRegisterForRemoteNotifications(error: error)
    }
}
