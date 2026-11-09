import UIKit
import Capacitor
import PhonehomeCallkit

/// Cap bridge — always boot bundled assets first so splash → How it works → Connect work offline.
/// Navigation to a saved Mothership HTTPS URL is handled by JS (`setMothershipUrl`) after Connect.
final class PhoneHomeBridgeViewController: CAPBridgeViewController {
    private var launchCover: UIView?

    override public func capacitorDidLoad() {
        super.capacitorDidLoad()
        installLaunchCover()
        // Mark build-time server.url as seen; never auto-navigate away from bundled UI here.
        let configured = bridge?.config.serverURL.absoluteString
        let seedCandidate: String? = {
            guard let configured,
                  let url = URL(string: configured),
                  url.scheme?.lowercased() == "https"
            else { return nil }
            return configured
        }()
        PhoneHomeMothership.seedFromBuildConfigIfNeeded(serverUrl: seedCandidate)

        if let scrollView = webView?.scrollView {
            scrollView.minimumZoomScale = 1
            scrollView.maximumZoomScale = 1
            scrollView.bouncesZoom = false
            scrollView.pinchGestureRecognizer?.isEnabled = false
        }
    }

    /// Picks up from LaunchScreen.storyboard (same LaunchPhone art, centered,
    /// 180pt incl. baked shadow) and plays the web onboarding hero — frameless
    /// rotary phone rattling as rings leave (`phoneRing` / `ringOut` in app.css,
    /// scaled 1.5×) — over the WebView through the bundled → Mothership reload,
    /// until JS calls `hideLaunchCover` from its first real screen.
    private func installLaunchCover() {
        guard launchCover == nil else { return }
        let cover = UIView(frame: view.bounds)
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        cover.backgroundColor = UIColor(red: 12 / 255, green: 24 / 255, blue: 20 / 255, alpha: 1)
        cover.isUserInteractionEnabled = false

        let side: CGFloat = 180
        let hero = UIView(frame: CGRect(
            x: (cover.bounds.width - side) / 2,
            y: (cover.bounds.height - side) / 2,
            width: side,
            height: side
        ))
        hero.autoresizingMask = [.flexibleLeftMargin, .flexibleRightMargin, .flexibleTopMargin, .flexibleBottomMargin]
        cover.addSubview(hero)

        let animate = !UIAccessibility.isReduceMotionEnabled
        let ringSide: CGFloat = 150
        let ringFrame = CGRect(x: (side - ringSide) / 2, y: (side - ringSide) / 2, width: ringSide, height: ringSide)
        for delay in [0.0, 0.85] {
            let ring = UIView(frame: ringFrame)
            ring.layer.cornerRadius = ringSide / 2
            ring.layer.borderWidth = 1.5
            ring.layer.borderColor = UIColor(red: 239 / 255, green: 192 / 255, blue: 74 / 255, alpha: 0.34).cgColor
            ring.layer.opacity = 0
            hero.addSubview(ring)
            if animate { ring.layer.add(Self.ringOutAnimation(delay: delay), forKey: "ringOut") }
        }

        let phone = UIImageView(image: UIImage(named: "LaunchPhone"))
        phone.contentMode = .scaleAspectFit
        // Rotate around 70% down the 132pt phone (24pt baked padding each side).
        let pivotY = (24 + 132 * 0.7) / side
        phone.layer.anchorPoint = CGPoint(x: 0.5, y: pivotY)
        phone.frame = hero.bounds
        hero.addSubview(phone)
        if animate { phone.layer.add(Self.phoneRingAnimation(), forKey: "phoneRing") }

        view.addSubview(cover)
        launchCover = cover
        NotificationCenter.default.addObserver(
            self, selector: #selector(hideLaunchCover), name: Notification.Name.phoneHomeHideLaunchCover, object: nil
        )
        // Failsafe: never trap the user behind the cover if JS never reports ready.
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            self?.hideLaunchCover()
        }
    }

    @objc private func hideLaunchCover() {
        guard let cover = launchCover else { return }
        launchCover = nil
        NotificationCenter.default.removeObserver(self, name: Notification.Name.phoneHomeHideLaunchCover, object: nil)
        let hero = cover.subviews.first
        UIView.animate(withDuration: 0.42, delay: 0, options: [.curveEaseOut, .beginFromCurrentState]) {
            cover.alpha = 0
            hero?.transform = CGAffineTransform(scaleX: 1.08, y: 1.08)
        } completion: { _ in
            cover.removeFromSuperview()
        }
    }

    private static let heroCycle: CFTimeInterval = 2.6

    private static func ringOutAnimation(delay: CFTimeInterval) -> CAAnimation {
        let scale = CABasicAnimation(keyPath: "transform.scale")
        scale.fromValue = 0.55
        scale.toValue = 1.35
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 0.7
        fade.toValue = 0
        let group = CAAnimationGroup()
        group.animations = [scale, fade]
        group.duration = heroCycle
        group.timingFunction = CAMediaTimingFunction(name: .easeOut)
        group.repeatCount = .infinity
        group.beginTime = CACurrentMediaTime() + delay
        group.isRemovedOnCompletion = false
        return group
    }

    private static func phoneRingAnimation() -> CAAnimation {
        let deg = { (d: Double) in d * .pi / 180 }
        let rotate = CAKeyframeAnimation(keyPath: "transform.rotation.z")
        rotate.keyTimes = [0, 0.02, 0.05, 0.08, 0.11, 0.14, 0.17, 0.20, 0.24, 0.28, 1]
        rotate.values = [0, -9, 8, -8, 7, -6, 5, -3, 1.5, 0, 0].map(deg)
        let lift = CAKeyframeAnimation(keyPath: "transform.translation.y")
        lift.keyTimes = [0, 0.02, 0.05, 0.08, 1]
        lift.values = [0, -1.5, -1.5, 0, 0]
        for anim in [rotate, lift] {
            anim.timingFunctions = Array(
                repeating: CAMediaTimingFunction(name: .easeInEaseOut),
                count: (anim.keyTimes?.count ?? 2) - 1
            )
        }
        let group = CAAnimationGroup()
        group.animations = [rotate, lift]
        group.duration = heroCycle
        group.repeatCount = .infinity
        group.isRemovedOnCompletion = false
        return group
    }
}
