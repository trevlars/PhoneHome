import Foundation
import UIKit
import CallKit
import PushKit
import AVFoundation
import UserNotifications
import Capacitor

@objc public class PhoneHomeCallKit: NSObject, CXProviderDelegate, PKPushRegistryDelegate, UNUserNotificationCenterDelegate {
    public static let shared = PhoneHomeCallKit()

    private let controller = CXCallController()
    private var provider: CXProvider!
    private var registry: PKPushRegistry?
    private var activeUuid: UUID?
    private var activeCallId: String?
    private var reportedCallIds = Set<String>()
    private weak var plugin: CAPPlugin?
    /// True after CXAnswerCallAction until end/reset — survives JS listener gaps.
    private var callAnswered = false
    private var audioSessionActive = false
    /// 1:1 defaults to earpiece. Loudspeaker is opt-in via the Speaker button.
    private var speakerOn = false
    /// Re-apply earpiece when WKWebView WebRTC resets the session to speaker.
    private var routeObserver: NSObjectProtocol?
    private var routeGuardOn = false
    private var reassertWork: DispatchWorkItem?
    private var routeTimer: Timer?
    /// Events emitted before Capacitor attaches the plugin (VoIP wake race).
    private var pendingEmits: [(String, [String: Any])] = []

    /// UserDefaults / Info.plist key. Default **false** — in-app softphone + alert APNs only.
    /// Apple requires CallKit report on every PushKit VoIP push; with CallKit tabled we must
    /// not register VoIP. Killed-app wake is less reliable than VoIP+CallKit.
    public static let callKitFlagKey = "kl_callkit"
    public static let callKitPlistKey = "PhoneHomeCallKitEnabled"

    /// Whether system CallKit / PushKit VoIP UI ownership is active.
    @objc public func isCallKitEnabled() -> Bool {
        // Runtime toggle (JS setCallKitEnabled / localStorage sync) wins.
        if UserDefaults.standard.object(forKey: Self.callKitFlagKey) != nil {
            return UserDefaults.standard.bool(forKey: Self.callKitFlagKey)
        }
        if let plist = Bundle.main.object(forInfoDictionaryKey: Self.callKitPlistKey) as? Bool {
            return plist
        }
        if let raw = Bundle.main.object(forInfoDictionaryKey: Self.callKitPlistKey) as? NSNumber {
            return raw.boolValue
        }
        // Default OFF — table CallKit; prefer alert notification → in-app answer card.
        return false
    }

    @objc public func setCallKitEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: Self.callKitFlagKey)
        if enabled {
            startPushKit()
        } else {
            // Must unregister — leftover VoIP pushes without a CallKit report get the app killed.
            stopPushKit()
            print("[PhoneHomeCallKit] CallKit disabled — VoIP PushKit stopped")
        }
    }

    private override init() {
        super.init()
        let config = CXProviderConfiguration(localizedName: "PhoneHome")
        config.supportsVideo = false
        config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.generic]
        // Don't set iconTemplateImageData from SF Symbols — wrong format can upset CallKit.
        provider = CXProvider(configuration: config)
        provider.setDelegate(self, queue: nil)
    }

    public func attach(plugin: CAPPlugin) {
        self.plugin = plugin
        if isCallKitEnabled() {
            // VoIP pushes must be handled before the WebView finishes booting.
            startPushKit()
            print("[PhoneHomeCallKit] CallKit/PushKit armed")
        } else {
            // Table CallKit: do NOT register PushKit. Alert APNs wakes / opens the app instead.
            // Claim notification center early so tap-to-open isn't lost before JS registerAlertPush.
            UNUserNotificationCenter.current().delegate = self
            refreshAlertPushRegistration()
            print("[PhoneHomeCallKit] CallKit OFF (default) — in-app softphone + alert APNs only")
        }
        // Flush events that arrived before Capacitor attached the plugin.
        let pending = pendingEmits
        pendingEmits.removeAll()
        for item in pending {
            emit(item.0, data: item.1, retain: true)
        }
        // WebView often registers listeners after lock-screen Answer — re-emit sticky state.
        if callAnswered {
            var replay: [String: Any] = ["replay": true]
            if let uuid = activeUuid { replay["callUUID"] = uuid.uuidString }
            if let callId = activeCallId { replay["callId"] = callId }
            emit("callAnswered", data: replay, retain: true)
        }
        if audioSessionActive {
            emit("audioActivated", data: ["replay": true], retain: true)
        }
    }

    /// Sticky notify: queue until JS addListener (lock-screen / cold WebView race).
    private func emit(_ event: String, data: [String: Any] = [:], retain: Bool = true) {
        guard let plugin else {
            print("[PhoneHomeCallKit] defer \(event) — plugin not attached yet")
            pendingEmits.append((event, data))
            // Cap buffer — keep newest answer/audio/push signals.
            if pendingEmits.count > 16 {
                pendingEmits.removeFirst(pendingEmits.count - 16)
            }
            return
        }
        var payload: [String: Any] = [:]
        for (k, v) in data {
            // Skip nil optionals — Capacitor NSDictionary rejects them.
            if case Optional<Any>.none = v as Any? { continue }
            if v is NSNull { continue }
            payload[k] = v
        }
        payload["ts"] = Int(Date().timeIntervalSince1970 * 1000)
        plugin.notifyListeners(event, data: payload, retainUntilConsumed: retain)
    }

    /// JS polls this after boot / on offer — recovers missed callAnswered/audioActivated.
    public func callState() -> [String: Any] {
        let live = controller.callObserver.calls.filter { !$0.hasEnded }
        let cxAnswered = live.contains { $0.hasConnected }
        let systemHasCall = !live.isEmpty
        var out: [String: Any] = [
            "answered": callAnswered || cxAnswered,
            "audioActive": audioSessionActive,
            "speakerOn": speakerOn,
            "ringing": systemHasCall && !cxAnswered,
            "systemHasCall": systemHasCall
        ]
        if let uuid = activeUuid { out["callUUID"] = uuid.uuidString }
        if let callId = activeCallId { out["callId"] = callId }
        return out
    }

    public func startPushKit() {
        guard isCallKitEnabled() else {
            print("[PhoneHomeCallKit] skip PushKit — CallKit disabled")
            return
        }
        if registry != nil { return }
        let reg = PKPushRegistry(queue: DispatchQueue.main)
        reg.delegate = self
        reg.desiredPushTypes = [.voIP]
        registry = reg
        print("[PhoneHomeCallKit] PushKit registry started")
    }

    /// Drop the PushKit registry so iOS stops delivering VoIP while CallKit is off.
    private func stopPushKit() {
        guard registry != nil else { return }
        registry?.delegate = nil
        registry?.desiredPushTypes = []
        registry = nil
        print("[PhoneHomeCallKit] PushKit registry stopped")
    }

    /// Re-register APNs if the user already allowed alerts (don't wait on the WebView).
    private func refreshAlertPushRegistration() {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            DispatchQueue.main.async {
                switch settings.authorizationStatus {
                case .authorized, .provisional, .ephemeral:
                    UIApplication.shared.registerForRemoteNotifications()
                default:
                    break
                }
            }
        }
    }

    /// Register for standard APNs alert/sound/badge (not VoIP). Used when CallKit is tabled.
    public func registerAlertPush(completion: @escaping (Bool) -> Void) {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, err in
            if let err {
                print("[PhoneHomeCallKit] alert push auth error: \(err)")
            }
            DispatchQueue.main.async {
                if granted {
                    UIApplication.shared.registerForRemoteNotifications()
                }
                completion(granted)
            }
        }
    }

    @objc public func didRegisterForRemoteNotifications(deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        print("[PhoneHomeCallKit] APNs alert token …\(token.suffix(8))")
        emit("apnsToken", data: ["token": token], retain: true)
    }

    @objc public func didFailToRegisterForRemoteNotifications(error: Error) {
        print("[PhoneHomeCallKit] APNs register failed: \(error)")
        emit("apnsTokenInvalid", data: ["error": error.localizedDescription], retain: false)
    }

    /// Report a system incoming call. Completion fires after CallKit accepts (or rejects)
    /// the report — PushKit must wait for this before finishing its own completion.
    public func reportIncoming(
        callId: String,
        handle: String,
        callerName: String,
        force: Bool = false,
        completion: ((Error?) -> Void)? = nil
    ) {
        guard force || isCallKitEnabled() else {
            print("[PhoneHomeCallKit] reportIncoming skipped — CallKit disabled (in-app UI)")
            completion?(nil)
            return
        }
        // Same callId from PushKit + JS must not double-report (duplicate system UI).
        if reportedCallIds.contains(callId) {
            // Keep sticky id fresh without wiping an in-progress Answer.
            if activeCallId != callId { activeCallId = callId }
            completion?(nil)
            return
        }
        reportedCallIds.insert(callId)
        let uuid = uuidFor(callId: callId)
        activeUuid = uuid
        activeCallId = callId
        callAnswered = false
        audioSessionActive = false
        speakerOn = true
        disableProximity()
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: handle)
        update.localizedCallerName = callerName
        update.hasVideo = false
        provider.reportNewIncomingCall(with: uuid, update: update) { error in
            if let error = error {
                print("[PhoneHomeCallKit] report incoming failed: \(error)")
                self.reportedCallIds.remove(callId)
                completion?(error)
                return
            }
            completion?(nil)
        }
    }

    public func startOutgoing(callId: String, handle: String) {
        guard isCallKitEnabled() else {
            print("[PhoneHomeCallKit] startOutgoing skipped — CallKit disabled (in-app UI)")
            return
        }
        let uuid = uuidFor(callId: callId)
        activeUuid = uuid
        activeCallId = callId
        callAnswered = false
        audioSessionActive = false
        speakerOn = true
        disableProximity()
        let handleObj = CXHandle(type: .generic, value: handle)
        let action = CXStartCallAction(call: uuid, handle: handleObj)
        controller.request(CXTransaction(action: action)) { error in
            if let error = error {
                print("[PhoneHomeCallKit] start outgoing failed: \(error)")
            }
        }
    }

    public func endCall(callId: String?) {
        let uuid = callId.flatMap { self.uuidFor(callId: $0) } ?? activeUuid
        if let callId {
            reportedCallIds.remove(callId)
        } else {
            reportedCallIds.removeAll()
        }
        callAnswered = false
        audioSessionActive = false
        speakerOn = true
        stopRouteGuard()
        disableProximity()
        // CallKit off: WebRTC owns AVAudioSession. Deactivating it silences the next call.
        if isCallKitEnabled() {
            deactivateAudioSession()
        }
        activeCallId = nil
        guard isCallKitEnabled(), let uuid else {
            activeUuid = nil
            return
        }
        let action = CXEndCallAction(call: uuid)
        controller.request(CXTransaction(action: action)) { _ in }
        activeUuid = nil
    }

    /// Route to loudspeaker (`true`) or earpiece (`false`).
    /// CallKit: apply only after didActivate.
    /// In-app (CallKit off): no-op. WKWebView WebRTC already plays on speaker;
    /// touching AVAudioSession here makes the call silent.
    public func setSpeaker(_ enabled: Bool) {
        if !isCallKitEnabled() {
            speakerOn = true
            return
        }
        speakerOn = enabled
        if !audioSessionActive { return }
        startRouteGuard()
        assertAudioRoute()
    }

    public func isSpeakerOn() -> Bool { speakerOn }

    public func setConnected(callId: String?) {
        // Incoming CallKit calls are already connected after CXAnswerCallAction.
        // reportOutgoingCall(connectedAt:) is only valid for CXStartCallAction flows —
        // calling it on an inbound UUID can disturb CallKit audio routing.
        let uuid = callId.flatMap { self.uuidFor(callId: $0) } ?? activeUuid
        guard let uuid, activeUuid == uuid else { return }
        if CXCallObserver().calls.first(where: { $0.uuid == uuid })?.isOutgoing == true {
            provider.reportOutgoingCall(with: uuid, connectedAt: Date())
        }
    }

    // MARK: - App icon badge (missed calls / unread voicemail)

    public func requestBadgePermission(completion: @escaping (Bool) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                // `.notSupported` / `.enabled` → allow; only `.disabled` blocks.
                DispatchQueue.main.async { completion(settings.badgeSetting != .disabled) }
            case .notDetermined:
                UNUserNotificationCenter.current().requestAuthorization(options: [.badge]) { granted, _ in
                    DispatchQueue.main.async { completion(granted) }
                }
            default:
                DispatchQueue.main.async { completion(false) }
            }
        }
    }

    public func setBadgeCount(_ count: Int, completion: ((Error?) -> Void)? = nil) {
        let n = max(0, count)
        DispatchQueue.main.async {
            // Always mirror to applicationIconBadgeNumber for older paths.
            UIApplication.shared.applicationIconBadgeNumber = n
            if #available(iOS 16.0, *) {
                UNUserNotificationCenter.current().setBadgeCount(n) { _ in
                    completion?(nil)
                }
            } else {
                completion?(nil)
            }
        }
    }

    private func uuidFor(callId: String) -> UUID {
        // Stable UUID from callId so push + JS agree.
        let data = Data(callId.utf8)
        var bytes = [UInt8](repeating: 0, count: 16)
        for (i, b) in data.enumerated() {
            bytes[i % 16] ^= b
        }
        bytes[6] = (bytes[6] & 0x0f) | 0x40
        bytes[8] = (bytes[8] & 0x3f) | 0x80
        return UUID(uuid: (
            bytes[0], bytes[1], bytes[2], bytes[3],
            bytes[4], bytes[5], bytes[6], bytes[7],
            bytes[8], bytes[9], bytes[10], bytes[11],
            bytes[12], bytes[13], bytes[14], bytes[15]
        ))
    }

    /// Known-good CallKit handoff: category on answer, activate only in didActivate.
    /// Avoid forcing a route until the session is owned (silent WebRTC on receiver).
    private func configureAudioSession(activate: Bool) {
        let session = AVAudioSession.sharedInstance()
        do {
            // Voice calls: HFP Bluetooth only — A2DP is play-only and breaks CallKit mic.
            var opts: AVAudioSession.CategoryOptions = [.allowBluetooth]
            if speakerOn { opts.insert(.defaultToSpeaker) }
            try session.setCategory(
                .playAndRecord,
                mode: .voiceChat,
                options: opts
            )
            try session.setPreferredIOBufferDuration(0.02)
            if activate {
                try session.setActive(true, options: [])
                applyAudioRoute()
            }
        } catch {
            print("[PhoneHomeCallKit] audio session: \(error)")
        }
    }

    /// In-app softphone (CallKit off): take playAndRecord so we can pick earpiece vs speaker.
    private func configureInAppAudioSession() {
        assertAudioRoute()
    }

    private func startRouteGuard() {
        routeGuardOn = true
        if routeObserver == nil {
            routeObserver = NotificationCenter.default.addObserver(
                forName: AVAudioSession.routeChangeNotification,
                object: AVAudioSession.sharedInstance(),
                queue: .main
            ) { [weak self] _ in
                self?.enforcePreferredRoute()
            }
        }
        routeTimer?.invalidate()
        routeTimer = nil
        enforcePreferredRoute()
    }

    private func stopRouteGuard() {
        routeGuardOn = false
        reassertWork?.cancel()
        reassertWork = nil
        routeTimer?.invalidate()
        routeTimer = nil
        if let routeObserver {
            NotificationCenter.default.removeObserver(routeObserver)
            self.routeObserver = nil
        }
    }

    /// WKWebView WebRTC uses `.videoChat`, which Apple routes to the speaker.
    private func routeMatchesPreference() -> Bool {
        let session = AVAudioSession.sharedInstance()
        let onSpeaker = outputsAreSpeaker()
        if speakerOn { return onSpeaker }
        return !onSpeaker && session.mode == .voiceChat
    }

    private func enforcePreferredRoute() {
        guard routeGuardOn else { return }
        if routeMatchesPreference() { return }
        assertAudioRoute()
    }

    private func outputsAreSpeaker() -> Bool {
        AVAudioSession.sharedInstance().currentRoute.outputs.contains {
            $0.portType == .builtInSpeaker
        }
    }

    /// CallKit can use voiceChat + receiver. In-app WKWebView WebRTC only emits
    /// audio in videoChat (Apple routes that to the speaker). Forcing voiceChat
    /// or `.none` disconnects the WebRTC graph → complete silence.
    private func assertAudioRoute() {
        let session = AVAudioSession.sharedInstance()
        do {
            let inApp = !isCallKitEnabled()
            let mode: AVAudioSession.Mode = inApp ? .videoChat : .voiceChat
            let useSpeaker = speakerOn || inApp
            var opts: AVAudioSession.CategoryOptions = [.allowBluetooth]
            if useSpeaker { opts.insert(.defaultToSpeaker) }
            try session.setCategory(.playAndRecord, mode: mode, options: opts)
            try session.setMode(mode)
            try session.setPreferredIOBufferDuration(0.02)
            try session.setActive(true, options: [])
            try session.overrideOutputAudioPort(useSpeaker ? .speaker : .none)
            audioSessionActive = true
            let ports = session.currentRoute.outputs.map(\.portType.rawValue).joined(separator: ",")
            print("[PhoneHomeCallKit] route speakerOn=\(speakerOn) mode=\(session.mode.rawValue) ports=\(ports)")
        } catch {
            print("[PhoneHomeCallKit] assert route: \(error)")
        }
        if speakerOn || !isCallKitEnabled() {
            disableProximity()
        } else {
            enableProximityIfInCall()
        }
    }

    /// Release CallKit's AVAudioSession so WKWebView TCC/capture can recover after hangup/background.
    /// Errors are swallowed — session may already be inactive.
    private func deactivateAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
        } catch {
            // Already inactive or contested — fine.
        }
    }

    private func applyAudioRoute() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.overrideOutputAudioPort(speakerOn ? .speaker : .none)
        } catch {
            print("[PhoneHomeCallKit] audio route: \(error)")
        }
    }

    private func disableProximity() {
        DispatchQueue.main.async {
            UIDevice.current.isProximityMonitoringEnabled = false
        }
    }

    private func enableProximityIfInCall() {
        let want = (callAnswered || audioSessionActive) && !speakerOn
        DispatchQueue.main.async {
            UIDevice.current.isProximityMonitoringEnabled = want
        }
    }

    // MARK: - CXProviderDelegate

    public func providerDidReset(_ provider: CXProvider) {
        activeUuid = nil
        activeCallId = nil
        callAnswered = false
        audioSessionActive = false
        speakerOn = false
        stopRouteGuard()
        disableProximity()
        deactivateAudioSession()
        reportedCallIds.removeAll()
        emit("callEnded", data: ["reason": "reset"], retain: false)
    }

    public func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        // Configure category only — CallKit activates the session in didActivate.
        // Early setActive() here races CallKit and often yields silent WebRTC in WKWebView.
        speakerOn = true
        disableProximity()
        configureAudioSession(activate: false)
        callAnswered = true
        activeUuid = action.callUUID
        action.fulfill()
        print("[PhoneHomeCallKit] answered uuid=\(action.callUUID.uuidString) callId=\(activeCallId ?? "?")")
        var answeredData: [String: Any] = ["callUUID": action.callUUID.uuidString]
        if let callId = activeCallId { answeredData["callId"] = callId }
        emit("callAnswered", data: answeredData, retain: true)
        // Do NOT emit audioActivated here — wait for didActivate.
    }

    public func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        action.fulfill()
        let endedId = activeCallId
        activeUuid = nil
        activeCallId = nil
        callAnswered = false
        audioSessionActive = false
        speakerOn = false
        stopRouteGuard()
        disableProximity()
        deactivateAudioSession()
        reportedCallIds.removeAll()
        var endedData: [String: Any] = ["callUUID": action.callUUID.uuidString]
        if let endedId { endedData["callId"] = endedId }
        emit("callEnded", data: endedData, retain: false)
    }

    public func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        speakerOn = true
        disableProximity()
        configureAudioSession(activate: false)
        // Outbound is live for audio/mic purposes once CallKit accepts the start —
        // keeps JS from hard-releasing the mic while the system call is up.
        callAnswered = true
        activeUuid = action.callUUID
        action.fulfill()
        provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: Date())
        var started: [String: Any] = [
            "callUUID": action.callUUID.uuidString,
            "handle": action.handle.value
        ]
        if let callId = activeCallId { started["callId"] = callId }
        emit("callStarted", data: started, retain: true)
    }

    public func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        // CallKit owns activation now — re-apply voice category so WKWebView WebRTC can play.
        // Do not touch proximity or fight the session before WebRTC attaches.
        configureAudioSession(activate: true)
        audioSessionActive = true
        print("[PhoneHomeCallKit] audioActivated (didActivate) speaker=\(speakerOn)")
        emit("audioActivated", data: ["speakerOn": speakerOn], retain: true)
    }

    public func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        audioSessionActive = false
        disableProximity()
        // iOS fires this on route changes (speaker / BT). Extra setActive(false)
        // while the call is still answered tears down the session WKWebView WebRTC
        // is using — silent two-way audio. Wait for CXEndCallAction / reset.
        if !callAnswered {
            deactivateAudioSession()
        }
        emit("audioDeactivated", data: [:], retain: false)
    }

    // MARK: - PKPushRegistryDelegate

    public func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        guard type == .voIP else { return }
        let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        emit("voipToken", data: ["token": token], retain: true)
    }

    public func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        emit("voipTokenInvalid", data: [:], retain: false)
    }

    public func pushRegistry(
        _ registry: PKPushRegistry,
        didReceiveIncomingPushWith payload: PKPushPayload,
        for type: PKPushType,
        completion: @escaping () -> Void
    ) {
        guard type == .voIP else {
            completion()
            return
        }
        let root = payload.dictionaryPayload
        let callId = (root["callId"] as? String) ?? UUID().uuidString
        let handle = (root["handle"] as? String) ?? "PhoneHome"
        let callerName = (root["callerName"] as? String) ?? "Family"
        // Line ids (no SDP) so JS can send call.accepted before pending offer lands.
        let fromLineId = (root["fromLineId"] as? String) ?? handle
        let toLineId = (root["toLineId"] as? String) ?? ""
        // Stale VoIP after the toggle is off: still report (Apple requirement), then end.
        if !isCallKitEnabled() {
            print("[PhoneHomeCallKit] unexpected VoIP while CallKit off — report+end")
            reportIncoming(callId: callId, handle: handle, callerName: callerName, force: true) { _ in
                self.endCall(callId: callId)
                completion()
            }
            return
        }
        // Apple: report to CallKit and wait for *that* completion before
        // calling the PushKit completion, or iOS can kill / revoke VoIP.
        reportIncoming(callId: callId, handle: handle, callerName: callerName) { error in
            if let error {
                print("[PhoneHomeCallKit] push report failed: \(error)")
            }
            // Privacy: callId + display + line ids only — never SDP / media keys.
            var pushData: [String: Any] = [
                "callId": callId,
                "handle": handle,
                "callerName": callerName,
                "fromLineId": fromLineId
            ]
            if !toLineId.isEmpty { pushData["toLineId"] = toLineId }
            self.emit("incomingPush", data: pushData, retain: true)
            completion()
        }
    }

    // MARK: - UNUserNotificationCenterDelegate (alert APNs when CallKit tabled)

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let userInfo = notification.request.content.userInfo
        emitIncomingAlert(from: userInfo, source: "foreground")
        // Still show banner while softphone may be painting the in-app card.
        if #available(iOS 14.0, *) {
            completionHandler([.banner, .sound, .badge, .list])
        } else {
            completionHandler([.alert, .sound, .badge])
        }
    }

    public func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        emitIncomingAlert(from: response.notification.request.content.userInfo, source: "tap")
        completionHandler()
    }

    private func emitIncomingAlert(from userInfo: [AnyHashable: Any], source: String) {
        let type = (userInfo["type"] as? String) ?? ""
        // Accept PhoneHome incoming_call payloads; ignore unrelated notifications.
        if !type.isEmpty && type != "incoming_call" { return }
        let callId = (userInfo["callId"] as? String) ?? ""
        guard !callId.isEmpty || type == "incoming_call" else { return }
        var data: [String: Any] = [
            "callId": callId.isEmpty ? UUID().uuidString : callId,
            "handle": (userInfo["handle"] as? String) ?? "PhoneHome",
            "callerName": (userInfo["callerName"] as? String) ?? "Family",
            "fromLineId": (userInfo["fromLineId"] as? String) ?? (userInfo["handle"] as? String) ?? "",
            "source": source
        ]
        if let to = userInfo["toLineId"] as? String, !to.isEmpty {
            data["toLineId"] = to
        }
        emit("incomingAlert", data: data, retain: true)
    }
}
