import UIKit
import Capacitor

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
        window?.backgroundColor = UIColor(red: 22 / 255, green: 36 / 255, blue: 30 / 255, alpha: 1)
        window?.makeKeyAndVisible()

        normalizeWebViewInsets()
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        normalizeWebViewInsets()
    }

    func sceneDidDisconnect(_ scene: UIScene) {}
    func sceneWillResignActive(_ scene: UIScene) {}
    func sceneWillEnterForeground(_ scene: UIScene) {}
    func sceneDidEnterBackground(_ scene: UIScene) {}

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let url = URLContexts.first?.url else { return }
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared,
            continue: userActivity,
            restorationHandler: { _ in }
        )
    }

    /// Keep WKWebView from adding its own safe-area insets on top of CSS env(safe-area-*).
    private func normalizeWebViewInsets() {
        guard let root = window?.rootViewController as? CAPBridgeViewController else { return }
        root.additionalSafeAreaInsets = .zero
        root.view.insetsLayoutMarginsFromSafeArea = false
        if let webView = root.webView {
            webView.scrollView.contentInsetAdjustmentBehavior = .never
            webView.scrollView.contentInset = .zero
            webView.scrollView.scrollIndicatorInsets = .zero
            webView.scrollView.automaticallyAdjustsScrollIndicatorInsets = false
            webView.backgroundColor = UIColor(red: 22 / 255, green: 36 / 255, blue: 30 / 255, alpha: 1)
            webView.isOpaque = true
        }
    }
}
