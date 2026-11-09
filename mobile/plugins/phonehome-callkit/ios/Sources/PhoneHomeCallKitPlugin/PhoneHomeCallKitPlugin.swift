import Foundation
import UIKit
import Capacitor
import SafariServices
import StoreKit

/**
 * CallKit + PushKit + alert-APNs bridge for PhoneHome.
 *
 * Default: CallKit OFF — register alert APNs; JS shows in-app softphone UI.
 * When CallKit enabled (`kl_callkit=1` / PhoneHomeCallKitEnabled): VoIP + system Answer UI.
 * Lock-screen Answer is required — disable requests are ignored.
 * JS listens for voipToken / apnsToken / incomingPush / incomingAlert / callAnswered / callEnded.
 */
public extension Notification.Name {
    static let phoneHomeHideLaunchCover = Notification.Name("PhoneHomeHideLaunchCover")
}

@objc(PhoneHomeCallKitPlugin)
public class PhoneHomeCallKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PhoneHomeCallKitPlugin"
    public let jsName = "PhoneHomeCallKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "registerVoIP", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "registerAlertPush", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCallKitEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isCallKitEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reportIncoming", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startOutgoing", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endCall", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setConnected", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSpeaker", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setHeld", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRemoteHeld", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setNativeMuted", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCallState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumePendingOutgoing", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestBadgePermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBadge", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearBadge", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveLogin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hasSavedLogin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLogin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearLogin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setNativeRemoteOffer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addNativeIceCandidate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endNativeCall", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readClipboard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStorefront", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clipboardHasUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openInAppBrowser", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumeInviteLink", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getMothershipUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMothershipUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearMothershipUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hideLaunchCover", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getOnboarding", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setOnboarding", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getMigrateTransfer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMigrateTransfer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearMigrateTransfer", returnType: CAPPluginReturnPromise),
    ]

    override public func load() {
        PhoneHomeCallKit.shared.attach(plugin: self)
        PhoneHomeInviteLink.plugin = self
    }

    @objc func registerVoIP(_ call: CAPPluginCall) {
        PhoneHomeCallKit.shared.startPushKit()
        call.resolve()
    }

    @objc func registerAlertPush(_ call: CAPPluginCall) {
        PhoneHomeCallKit.shared.registerAlertPush { granted in
            call.resolve(["granted": granted])
        }
    }

    @objc func setCallKitEnabled(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        PhoneHomeCallKit.shared.setCallKitEnabled(enabled)
        call.resolve(["enabled": PhoneHomeCallKit.shared.isCallKitEnabled()])
    }

    @objc func isCallKitEnabled(_ call: CAPPluginCall) {
        call.resolve(["enabled": PhoneHomeCallKit.shared.isCallKitEnabled()])
    }

    @objc func reportIncoming(_ call: CAPPluginCall) {
        let callId = call.getString("callId") ?? UUID().uuidString
        let handle = call.getString("handle") ?? "PhoneHome"
        let callerName = call.getString("callerName") ?? "Family"
        let fromLineId = call.getString("fromLineId")
        let toLineId = call.getString("toLineId")
        PhoneHomeCallKit.shared.reportIncoming(
            callId: callId,
            handle: handle,
            callerName: callerName,
            fromLineId: fromLineId,
            toLineId: toLineId
        ) { error in
            if let error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve()
            }
        }
    }

    @objc func startOutgoing(_ call: CAPPluginCall) {
        let callId = call.getString("callId") ?? UUID().uuidString
        let handle = call.getString("handle") ?? "PhoneHome"
        PhoneHomeCallKit.shared.startOutgoing(callId: callId, handle: handle)
        call.resolve(["callId": callId])
    }

    @objc func endCall(_ call: CAPPluginCall) {
        PhoneHomeCallKit.shared.endCall(callId: call.getString("callId"))
        call.resolve()
    }

    @objc func setConnected(_ call: CAPPluginCall) {
        let connectedAtMs = call.getDouble("connectedAtMs")
        let actual = PhoneHomeCallKit.shared.setConnected(
            callId: call.getString("callId"),
            connectedAtMs: connectedAtMs
        )
        if let actual {
            call.resolve(["connectedAtMs": actual])
        } else {
            call.resolve()
        }
    }

    @objc func setSpeaker(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        PhoneHomeCallKit.shared.setSpeaker(enabled)
        call.resolve(["enabled": PhoneHomeCallKit.shared.isSpeakerOn()])
    }

    @objc func setHeld(_ call: CAPPluginCall) {
        let onHold = call.getBool("onHold") ?? false
        let muted = call.getBool("muted") ?? false
        PhoneHomeCallKit.shared.requestHeld(onHold, muted: muted) { error in
            if let error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve(["onHold": onHold])
            }
        }
    }

    @objc func setRemoteHeld(_ call: CAPPluginCall) {
        let onHold = call.getBool("onHold") ?? false
        let muted = call.getBool("muted") ?? false
        PhoneHomeCallKit.shared.setRemoteHeld(onHold, muted: muted)
        call.resolve(["onHold": onHold])
    }

    @objc func setNativeMuted(_ call: CAPPluginCall) {
        let muted = call.getBool("muted") ?? false
        PhoneHomeCallKit.shared.setNativeMuted(muted)
        call.resolve(["muted": muted])
    }

    @objc func getCallState(_ call: CAPPluginCall) {
        call.resolve(PhoneHomeCallKit.shared.callState())
    }

    @objc func consumePendingOutgoing(_ call: CAPPluginCall) {
        call.resolve(PhoneHomeCallKit.shared.consumePendingOutgoing())
    }

    @objc func requestBadgePermission(_ call: CAPPluginCall) {
        PhoneHomeCallKit.shared.requestBadgePermission { granted in
            call.resolve(["granted": granted])
        }
    }

    @objc func setBadge(_ call: CAPPluginCall) {
        let count = call.getInt("count") ?? 0
        PhoneHomeCallKit.shared.setBadgeCount(count) { error in
            if let error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve()
            }
        }
    }

    @objc func clearBadge(_ call: CAPPluginCall) {
        PhoneHomeCallKit.shared.setBadgeCount(0) { error in
            if let error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve()
            }
        }
    }

    @objc func saveLogin(_ call: CAPPluginCall) {
        let username = call.getString("username") ?? ""
        let password = call.getString("password") ?? ""
        do {
            try PhoneHomeAuth.saveLogin(username: username, password: password)
            call.resolve(["saved": true])
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func hasSavedLogin(_ call: CAPPluginCall) {
        let info = PhoneHomeAuth.hasSavedLogin()
        call.resolve([
            "saved": info.saved,
            "username": info.username,
            "biometry": info.biometry,
        ])
    }

    @objc func getLogin(_ call: CAPPluginCall) {
        let reason = call.getString("reason") ?? "Sign in to PhoneHome"
        PhoneHomeAuth.unlockLogin(reason: reason) { result in
            switch result {
            case .success(let creds):
                call.resolve(["username": creds.0, "password": creds.1])
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func clearLogin(_ call: CAPPluginCall) {
        PhoneHomeAuth.clearLogin()
        call.resolve(["cleared": true])
    }

    @objc func saveSession(_ call: CAPPluginCall) {
        let sessionId = call.getString("sessionId") ?? ""
        do {
            try PhoneHomeAuth.saveSession(sessionId)
            call.resolve(["saved": true])
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func getSession(_ call: CAPPluginCall) {
        call.resolve(["sessionId": PhoneHomeAuth.loadSession()])
    }

    @objc func clearSession(_ call: CAPPluginCall) {
        PhoneHomeAuth.clearSession()
        call.resolve(["cleared": true])
    }

    @objc func setNativeRemoteOffer(_ call: CAPPluginCall) {
        let callId = call.getString("callId") ?? ""
        guard !callId.isEmpty else {
            call.reject("callId required")
            return
        }
        var offerSdp = ""
        if let sdpObj = call.getObject("sdp") {
            offerSdp = (sdpObj["sdp"] as? String) ?? ""
        }
        if offerSdp.isEmpty {
            offerSdp = call.getString("offerSdp") ?? ""
        }
        guard !offerSdp.isEmpty else {
            call.reject("sdp required")
            return
        }
        var iceServers: [[String: Any]] = []
        if let arr = call.getArray("iceServers") as? [[String: Any]] {
            iceServers = arr
        } else if let arr = call.getArray("iceServers") {
            for item in arr {
                if let dict = item as? [String: Any] {
                    iceServers.append(dict)
                } else if let dict = item as? JSObject {
                    var mapped: [String: Any] = [:]
                    for (k, v) in dict { mapped[k] = v }
                    iceServers.append(mapped)
                }
            }
        }
        PhoneHomeCallKit.shared.setNativeRemoteOffer(
            callId: callId,
            offerSdp: offerSdp,
            iceServers: iceServers
        ) { result in
            switch result {
            case .success(let sdp):
                call.resolve(sdp)
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func addNativeIceCandidate(_ call: CAPPluginCall) {
        let candidate = call.getObject("candidate")
        PhoneHomeCallKit.shared.addNativeIceCandidate(candidate)
        call.resolve()
    }

    @objc func endNativeCall(_ call: CAPPluginCall) {
        PhoneHomeCallKit.shared.endNativeMedia()
        call.resolve()
    }

    @objc func readClipboard(_ call: CAPPluginCall) {
        let text = UIPasteboard.general.string ?? ""
        call.resolve(["text": text])
    }

    /// App Store storefront (ISO 3166-1 alpha-3, e.g. "USA"); empty when unknown.
    @objc func getStorefront(_ call: CAPPluginCall) {
        Task {
            let code = await Storefront.current?.countryCode ?? ""
            call.resolve(["countryCode": code])
        }
    }

    /// SFSafariViewController: Done + back/forward + share, without leaving PhoneHome.
    @objc func openInAppBrowser(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw),
              url.scheme == "https" else {
            call.reject("https URL required")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let presenter = self?.bridge?.viewController else {
                call.reject("No view controller")
                return
            }
            let safari = SFSafariViewController(url: url)
            safari.preferredBarTintColor = UIColor(red: 0.055, green: 0.102, blue: 0.082, alpha: 1)
            safari.preferredControlTintColor = UIColor(red: 0.941, green: 0.706, blue: 0.161, alpha: 1)
            safari.dismissButtonStyle = .done
            safari.modalPresentationStyle = .pageSheet
            presenter.present(safari, animated: true)
            call.resolve()
        }
    }

    /// Pattern check only — never reads the string, so iOS shows no paste prompt.
    @objc func clipboardHasUrl(_ call: CAPPluginCall) {
        let board = UIPasteboard.general
        guard board.hasStrings || board.hasURLs else {
            call.resolve(["hasUrl": false])
            return
        }
        board.detectPatterns(for: [\.probableWebURL]) { result in
            let hasUrl = (try? result.get())?.contains(\.probableWebURL) ?? false
            call.resolve(["hasUrl": hasUrl])
        }
    }

    @objc func consumeInviteLink(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["url": PhoneHomeInviteLink.consume()])
        }
    }

    @objc func getMothershipUrl(_ call: CAPPluginCall) {
        call.resolve(["url": PhoneHomeMothership.load() ?? ""])
    }

    @objc func setMothershipUrl(_ call: CAPPluginCall) {
        let raw = call.getString("url") ?? ""
        let shouldReload = call.getBool("reload") ?? true
        let openPath = call.getString("openPath")?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        do {
            let normalized = try PhoneHomeMothership.save(raw)
            if shouldReload {
                let loadUrl = Self.mothershipLoadURL(origin: normalized, openPath: openPath)
                reloadWebView(to: loadUrl)
            }
            call.resolve(["url": normalized])
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func clearMothershipUrl(_ call: CAPPluginCall) {
        let shouldReload = call.getBool("reload") ?? true
        PhoneHomeMothership.clear()
        if shouldReload {
            reloadWebViewToBundled()
        }
        call.resolve(["cleared": true])
    }

    /// Web calls this once its first real screen has painted; the host VC fades
    /// the launch-mark cover it holds across the bundled → Mothership reload.
    @objc func hideLaunchCover(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: .phoneHomeHideLaunchCover, object: nil)
        }
        call.resolve(["hidden": true])
    }

    @objc func getOnboarding(_ call: CAPPluginCall) {
        call.resolve(["howItWorksDone": PhoneHomeOnboarding.howItWorksDone])
    }

    @objc func setOnboarding(_ call: CAPPluginCall) {
        if call.getBool("howItWorksDone") == true {
            PhoneHomeOnboarding.setHowItWorksDone(true)
        } else if call.getBool("howItWorksDone") == false {
            PhoneHomeOnboarding.setHowItWorksDone(false)
        }
        call.resolve(["howItWorksDone": PhoneHomeOnboarding.howItWorksDone])
    }

    @objc func getMigrateTransfer(_ call: CAPPluginCall) {
        call.resolve(["json": PhoneHomeOnboarding.migrateTransferJson ?? ""])
    }

    @objc func setMigrateTransfer(_ call: CAPPluginCall) {
        let json = call.getString("json") ?? ""
        PhoneHomeOnboarding.setMigrateTransferJson(json.isEmpty ? nil : json)
        call.resolve(["saved": true])
    }

    @objc func clearMigrateTransfer(_ call: CAPPluginCall) {
        PhoneHomeOnboarding.clearMigrateTransfer()
        call.resolve(["cleared": true])
    }

    /// Persist origin only; optionally open `/?join=` / `/?gp=` / `/?invite=` once.
    private static func mothershipLoadURL(origin: String, openPath: String) -> String {
        guard !openPath.isEmpty else { return origin }
        var path = openPath
        if !path.hasPrefix("/") {
            path = "/\(path)"
        }
        // Reject anything that isn't a relative path+query (no scheme / host injection).
        if path.contains("://") || path.contains("\\") {
            return origin
        }
        return origin + path
    }

    private func reloadWebView(to urlString: String) {
        guard let url = URL(string: urlString) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.bridge?.webView?.load(URLRequest(url: url))
        }
    }

    private func reloadWebViewToBundled() {
        DispatchQueue.main.async { [weak self] in
            guard let bridge = self?.bridge else { return }
            // Bundled assets use Cap localURL / appStartServerURL (capacitor://…)
            let url = bridge.config.appStartServerURL
            bridge.webView?.load(URLRequest(url: url))
        }
    }
}
