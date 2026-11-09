import UIKit
import Capacitor
import PhonehomeCallkit
import Intents

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }

        // Storyboard usually creates the window; if not, build one full-screen.
        if window == nil {
            let w = UIWindow(windowScene: windowScene)
            let storyboard = UIStoryboard(name: "Main", bundle: nil)
            w.rootViewController = storyboard.instantiateInitialViewController()
            self.window = w
        }
        window?.frame = windowScene.coordinateSpace.bounds
        window?.backgroundColor = UIColor(red: 12 / 255, green: 24 / 255, blue: 20 / 255, alpha: 1)
        window?.makeKeyAndVisible()

        normalizeWebViewInsets()
        handleConnectionActivities(connectionOptions.userActivities)
        if let url = connectionOptions.urlContexts.first?.url {
            PhoneHomeInviteLink.receive(url)
        }
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        normalizeWebViewInsets()
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        normalizeWebViewInsets()
    }

    func sceneDidDisconnect(_ scene: UIScene) {}
    func sceneWillResignActive(_ scene: UIScene) {}
    func sceneDidEnterBackground(_ scene: UIScene) {}

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let url = URLContexts.first?.url else { return }
        if PhoneHomeInviteLink.receive(url) { return }
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        if let intent = userActivity.interaction?.intent as? INStartCallIntent {
            if PhoneHomeCallKit.shared.handleStartCallIntent(intent) {
                return
            }
        }
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared,
            continue: userActivity,
            restorationHandler: { _ in }
        )
    }

    private func handleConnectionActivities(_ activities: Set<NSUserActivity>) {
        for activity in activities {
            if let intent = activity.interaction?.intent as? INStartCallIntent {
                _ = PhoneHomeCallKit.shared.handleStartCallIntent(intent)
            }
        }
    }

    /// Keep WKWebView from adding its own safe-area insets on top of CSS env(safe-area-*).
    /// Also reset zoom / negative bounce after returning from Safari (e.g. Save config file).
    private func normalizeWebViewInsets() {
        guard let root = window?.rootViewController as? CAPBridgeViewController else { return }
        root.additionalSafeAreaInsets = .zero
        root.view.insetsLayoutMarginsFromSafeArea = false
        if let webView = root.webView {
            let sv = webView.scrollView
            sv.contentInsetAdjustmentBehavior = .never
            sv.contentInset = .zero
            sv.scrollIndicatorInsets = .zero
            sv.automaticallyAdjustsScrollIndicatorInsets = false
            sv.minimumZoomScale = 1.0
            sv.maximumZoomScale = 1.0
            if abs(sv.zoomScale - 1.0) > 0.01 {
                sv.setZoomScale(1.0, animated: false)
            }
            // Negative Y after external Safari handoff slides chrome under the status bar.
            if sv.contentOffset.y < 0 {
                sv.setContentOffset(CGPoint(x: sv.contentOffset.x, y: 0), animated: false)
            }
            webView.backgroundColor = UIColor(red: 12 / 255, green: 24 / 255, blue: 20 / 255, alpha: 1)
            webView.isOpaque = true
            root.view.setNeedsLayout()
            root.view.layoutIfNeeded()
        }
    }
}
