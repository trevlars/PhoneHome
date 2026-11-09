import Foundation
import UIKit
import WebKit
import CallKit
import PushKit
import AVFoundation
import UserNotifications
import Capacitor
import WebRTC
import Intents

@objc public class PhoneHomeCallKit: NSObject, CXProviderDelegate, PKPushRegistryDelegate, UNUserNotificationCenterDelegate {
    public static let shared = PhoneHomeCallKit()

    private let controller = CXCallController()
    private var provider: CXProvider!
    private var registry: PKPushRegistry?
    private var activeUuid: UUID?
    private var activeCallId: String?
    /// Remote handle from the active CallKit call (line id for Recents redial).
    private var activeHandle: String?
    private var activeFromLineId: String?
    private var activeToLineId: String?
    private var reportedCallIds = Set<String>()
    /// Recents/Favorites start a random CallKit UUID — map server callId → that UUID for end/hangup.
    private var uuidOverrides: [String: UUID] = [:]
    private weak var plugin: CAPPlugin?
    /// True after CXAnswerCallAction until end/reset — survives JS listener gaps.
    private var callAnswered = false
    /// Canonical connection instant shared with JS. Set once per call so repeated
    /// ICE connected/completed callbacks cannot reset CallKit's duration clock.
    private var activeConnectedAt: Date?
    private var audioSessionActive = false
    /// 1:1 defaults to earpiece. Loudspeaker is opt-in via the Speaker button.
    private var speakerOn = false
    /// Re-apply earpiece when WKWebView WebRTC resets the session to speaker.
    private var routeObserver: NSObjectProtocol?
    private var interruptionObserver: NSObjectProtocol?
    private var routeGuardOn = false
    private var reassertWork: DispatchWorkItem?
    private var routeTimer: Timer?
    /// Events emitted before Capacitor attaches the plugin (VoIP wake race).
    private var pendingEmits: [(String, [String: Any])] = []
    /// App-process WebRTC for CallKit inbound (replaces WKWebView gum on that path).
    private var nativePeer: PhoneHomeNativePeer?
    private var nativePeerGeneration: UInt64 = 0
    private let nativeTerminationState = PhoneHomeNativeTerminationState()
    private var nativeDisconnectWork: DispatchWorkItem?
    private let nativeDisconnectGrace: TimeInterval = 3
    /// True once JS started a native media session for the current CallKit call.
    private var nativeMediaActive = false
    private var nativeAudioWatchdog: Timer?
    /// Behind the lock screen WKWebView sleeps once native events stop, leaving the
    /// hub's call.hold / call.hangup unread on its WebSocket until ICE times out.
    private var webViewSignalWake: Timer?
    private let webViewSignalWakeInterval: TimeInterval = 0.5
    /// Local/system hold is distinct from remote hold: CallKit may deactivate its
    /// session for this state, while remote hold keeps it active for native MOH.
    private var localHeld = false
    private let endState = PhoneHomeCallEndState()
    private var holdTransactionUuid: UUID?
    private var deferredEndUuid: UUID?
    private var endTransactionsInFlight = Set<UUID>()
    private var endTransactionAttempts: [UUID: Int] = [:]

    /// UserDefaults / Info.plist key. Lock-screen Answer is **required** (always on).
    /// Apple requires CallKit report on every PushKit VoIP push.
    public static let callKitFlagKey = "kl_callkit"
    public static let callKitPlistKey = "PhoneHomeCallKitEnabled"
    /// Persisted when Phone Recents/Favorites delivers CXStartCallAction before JS is ready.
    public static let pendingOutgoingHandleKey = "kl_pending_outgoing_handle"
    public static let pendingOutgoingAtKey = "kl_pending_outgoing_at"

    /// Whether system CallKit / PushKit VoIP UI ownership is active.
    /// Always true — Lock-screen Answer is required for every install.
    @objc public func isCallKitEnabled() -> Bool {
        return true
    }

    @objc public func setCallKitEnabled(_ enabled: Bool) {
        // Product requirement: never allow CallKit/PushKit off. Old clients may
        // still call with enabled=false — ignore and keep PushKit armed.
        if !enabled {
            print("[PhoneHomeCallKit] ignore CallKit disable — Lock-screen Answer is required")
        }
        UserDefaults.standard.set(true, forKey: Self.callKitFlagKey)
        startPushKit()
    }

    private override init() {
        super.init()
        let config = CXProviderConfiguration(localizedName: "PhoneHome")
        config.supportsVideo = false
        config.maximumCallGroups = 1
        config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.generic]
        config.includesCallsInRecents = true
        // Don't set iconTemplateImageData from SF Symbols — wrong format can upset CallKit.
        provider = CXProvider(configuration: config)
        provider.setDelegate(self, queue: nil)
        // Arm PushKit as early as AppDelegate touches `.shared` — before WebView/JS.
        UserDefaults.standard.set(true, forKey: Self.callKitFlagKey)
        startPushKit()
    }

    public func attach(plugin: CAPPlugin) {
        self.plugin = plugin
        // Always arm PushKit before WebView finishes — Lock-screen Answer is required.
        // Clear any legacy UserDefaults=false so killed-app launches still report CallKit.
        UserDefaults.standard.set(true, forKey: Self.callKitFlagKey)
        startPushKit()
        print("[PhoneHomeCallKit] CallKit/PushKit armed")
        // Flush events that arrived before Capacitor attached the plugin.
        let pending = pendingEmits
        pendingEmits.removeAll()
        for item in pending {
            emit(item.0, data: item.1, retain: true)
        }
        // WebView often registers listeners after lock-screen Answer — re-emit sticky state.
        if callAnswered {
            let live = controller.callObserver.calls.filter { !$0.hasEnded }
            let outgoing = live.first(where: { $0.uuid == activeUuid })?.isOutgoing == true
                || live.contains(where: { $0.isOutgoing })
            if outgoing {
                var started: [String: Any] = ["replay": true]
                if let uuid = activeUuid { started["callUUID"] = uuid.uuidString }
                if let callId = activeCallId { started["callId"] = callId }
                if let handle = activeHandle { started["handle"] = handle }
                if let connectedAtMs { started["connectedAtMs"] = connectedAtMs }
                emit("callStarted", data: started, retain: true)
            } else {
                var replay: [String: Any] = ["replay": true]
                if let uuid = activeUuid { replay["callUUID"] = uuid.uuidString }
                if let callId = activeCallId { replay["callId"] = callId }
                if let fromLineId = activeFromLineId { replay["fromLineId"] = fromLineId }
                if let toLineId = activeToLineId { replay["toLineId"] = toLineId }
                if let connectedAtMs { replay["connectedAtMs"] = connectedAtMs }
                emit("callAnswered", data: replay, retain: true)
            }
        }
        if audioSessionActive {
            emit("audioActivated", data: ["replay": true, "nativeMedia": nativeMediaActive], retain: true)
        }
        if localHeld {
            emit("callHeld", data: ["onHold": true, "replay": true], retain: true)
        }
        // Recents may have stored a handle before the WebView existed.
        if let pending = Self.peekPendingOutgoingHandle() {
            kickWebViewDial(handle: pending.handle)
            var started: [String: Any] = [
                "replay": true,
                "fromRecents": true,
                "handle": pending.handle
            ]
            if let uuid = activeUuid { started["callUUID"] = uuid.uuidString }
            emit("callStarted", data: started, retain: true)
        }
        armAudioInterruptionObserver()
    }

    /// Secondary safety net when CallKit skips didDeactivate/didActivate on some interruptions.
    private func armAudioInterruptionObserver() {
        guard interruptionObserver == nil else { return }
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] note in
            guard let self, self.nativeMediaActive, self.callAnswered else { return }
            let typeVal = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            guard let typeVal, let type = AVAudioSession.InterruptionType(rawValue: typeVal) else { return }
            let session = AVAudioSession.sharedInstance()
            switch type {
            case .began:
                // Do not disable RTCAudioSession mid-call — CallKit owns lifecycle via
                // didActivate/didDeactivate. Forcing disable here caused permanent mute.
                print("[PhoneHomeCallKit] interruption began (native stays armed)")
            case .ended:
                let optsVal = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
                let opts = AVAudioSession.InterruptionOptions(rawValue: optsVal)
                print("[PhoneHomeCallKit] interruption ended shouldResume=\(opts.contains(.shouldResume))")
                if self.audioSessionActive &&
                    !self.localHeld &&
                    (opts.contains(.shouldResume) || self.callAnswered) {
                    self.nativePeer?.enableCallKitAudio(session: session)
                }
            @unknown default:
                break
            }
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

    private var connectedAtMs: Int64? {
        guard let activeConnectedAt else { return nil }
        return Int64(activeConnectedAt.timeIntervalSince1970 * 1000)
    }

    /// JS polls this after boot / on offer — recovers missed callAnswered/audioActivated.
    public func callState() -> [String: Any] {
        let live = controller.callObserver.calls.filter {
            !$0.hasEnded && !endState.isEnding($0.uuid)
        }
        let cxAnswered = live.contains { $0.hasConnected }
        let systemHasCall = !live.isEmpty
        let outgoing = live.contains { $0.isOutgoing }
        var out: [String: Any] = [
            "answered": callAnswered || cxAnswered,
            "audioActive": audioSessionActive,
            "speakerOn": speakerOn,
            "localHeld": localHeld,
            "remoteHeld": nativePeer?.isRemotelyHeld == true,
            "ringing": systemHasCall && !cxAnswered,
            "systemHasCall": systemHasCall,
            "isOutgoing": outgoing
        ]
        if let uuid = activeUuid { out["callUUID"] = uuid.uuidString }
        if let callId = activeCallId { out["callId"] = callId }
        if let handle = activeHandle { out["handle"] = handle }
        if let fromLineId = activeFromLineId { out["fromLineId"] = fromLineId }
        if let toLineId = activeToLineId { out["toLineId"] = toLineId }
        if let connectedAtMs { out["connectedAtMs"] = connectedAtMs }
        if let pending = Self.peekPendingOutgoingHandle() {
            out["pendingOutgoingHandle"] = pending.handle
            out["pendingOutgoingAgeMs"] = pending.ageMs
        }
        return out
    }

    /// Recents tap may arrive before Capacitor/JS — persist until placeCall consumes it.
    public static func storePendingOutgoingHandle(_ handle: String) {
        let trimmed = handle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        UserDefaults.standard.set(trimmed, forKey: pendingOutgoingHandleKey)
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: pendingOutgoingAtKey)
        print("[PhoneHomeCallKit] pending outgoing handle=\(trimmed)")
    }

    public static func peekPendingOutgoingHandle(maxAgeSec: TimeInterval = 120) -> (handle: String, ageMs: Int)? {
        guard let handle = UserDefaults.standard.string(forKey: pendingOutgoingHandleKey)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !handle.isEmpty
        else { return nil }
        let at = UserDefaults.standard.double(forKey: pendingOutgoingAtKey)
        let age = at > 0 ? Date().timeIntervalSince1970 - at : 0
        if age > maxAgeSec {
            clearPendingOutgoingHandle()
            return nil
        }
        return (handle, Int(age * 1000))
    }

    public static func clearPendingOutgoingHandle() {
        UserDefaults.standard.removeObject(forKey: pendingOutgoingHandleKey)
        UserDefaults.standard.removeObject(forKey: pendingOutgoingAtKey)
    }

    public func consumePendingOutgoing() -> [String: Any] {
        guard let pending = Self.peekPendingOutgoingHandle() else {
            return ["handle": "", "ageMs": 0]
        }
        Self.clearPendingOutgoingHandle()
        return ["handle": pending.handle, "ageMs": pending.ageMs]
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
        fromLineId: String? = nil,
        toLineId: String? = nil,
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
            if let fromLineId, !fromLineId.isEmpty { activeFromLineId = fromLineId }
            if let toLineId, !toLineId.isEmpty { activeToLineId = toLineId }
            completion?(nil)
            return
        }
        endNativeMedia()
        reportedCallIds.insert(callId)
        let uuid = uuidFor(callId: callId)
        endState.prepareForNewCall(uuid)
        activeUuid = uuid
        activeCallId = callId
        activeFromLineId = (fromLineId?.isEmpty == false ? fromLineId : nil) ?? handle
        activeToLineId = (toLineId?.isEmpty == false ? toLineId : nil)
        callAnswered = false
        activeConnectedAt = nil
        audioSessionActive = false
        localHeld = false
        // 1:1 defaults to earpiece; JS setSpeaker(true) for TreeHouse / Speaker button.
        speakerOn = false
        enableProximityIfInCall()
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: handle)
        update.localizedCallerName = callerName
        update.hasVideo = false
        update.supportsHolding = true
        update.supportsGrouping = false
        update.supportsUngrouping = false
        activeHandle = handle
        provider.reportNewIncomingCall(with: uuid, update: update) { error in
            if let error = error {
                print("[PhoneHomeCallKit] report incoming failed: \(error)")
                self.reportedCallIds.remove(callId)
                completion?(error)
                return
            }
            self.donateStartCallIntent(handle: handle, displayName: callerName, direction: .incoming)
            completion?(nil)
        }
    }

    public func startOutgoing(callId: String, handle: String) {
        guard isCallKitEnabled() else {
            print("[PhoneHomeCallKit] startOutgoing skipped — CallKit disabled (in-app UI)")
            return
        }
        // Phone Recents / Favorites already ran CXStartCallAction with a system UUID.
        // Bind the server callId to that UUID — do not request a second CallKit call.
        if let existing = activeUuid,
           let sys = CXCallObserver().calls.first(where: { $0.uuid == existing }),
           sys.isOutgoing {
            activeCallId = callId
            uuidOverrides[callId] = existing
            reportedCallIds.insert(callId)
            print("[PhoneHomeCallKit] bound outgoing callId=\(callId) to Recents uuid=\(existing.uuidString)")
            return
        }
        endNativeMedia()
        let uuid = uuidFor(callId: callId)
        endState.prepareForNewCall(uuid)
        activeUuid = uuid
        activeCallId = callId
        activeHandle = handle
        callAnswered = false
        activeConnectedAt = nil
        audioSessionActive = false
        localHeld = false
        speakerOn = false
        enableProximityIfInCall()
        let handleObj = CXHandle(type: .generic, value: handle)
        let action = CXStartCallAction(call: uuid, handle: handleObj)
        controller.request(CXTransaction(action: action)) { error in
            if let error = error {
                print("[PhoneHomeCallKit] start outgoing failed: \(error)")
            }
        }
    }

    public func endCall(callId: String?) {
        // activeUuid is authoritative. A supplied callId is only a signaling hint;
        // hashing a stale id can target the wrong Recents-created CallKit UUID.
        var uuids = Set<UUID>()
        if let activeUuid { uuids.insert(activeUuid) }
        for call in controller.callObserver.calls where !call.hasEnded {
            uuids.insert(call.uuid)
        }
        if uuids.isEmpty, let callId, let overridden = uuidOverrides[callId] {
            uuids.insert(overridden)
        }

        guard !uuids.isEmpty else {
            // Duplicate/local-only cleanup remains safe even after CallKit forgot the UUID.
            localHeld = false
            endNativeMedia()
            return
        }
        for uuid in uuids {
            _ = beginImmediateEnd(uuid: uuid)
            submitEndTransaction(uuid: uuid)
        }
    }

    private func currentEndSnapshot(uuid: UUID) -> PhoneHomeCallEndSnapshot {
        if let existing = endState.snapshot(for: uuid) {
            return existing
        }
        let cxCall = controller.callObserver.calls.first(where: { $0.uuid == uuid })
        return PhoneHomeCallEndSnapshot(
            callUUID: uuid,
            callId: activeCallId,
            fromLineId: activeFromLineId ?? activeHandle,
            toLineId: activeToLineId,
            answered: callAnswered || cxCall?.hasConnected == true,
            outgoing: cxCall?.isOutgoing == true,
            localHeld: localHeld,
            remoteHeld: nativePeer?.isRemotelyHeld == true
        )
    }

    @discardableResult
    private func beginImmediateEnd(uuid: UUID) -> PhoneHomeCallEndSnapshot {
        let result = endState.begin(currentEndSnapshot(uuid: uuid))
        let snapshot = result.snapshot
        guard result.isFirst else { return snapshot }

        // Signal first, but never wait on WKWebView before stopping local held media.
        kickWebViewHangup(
            callId: snapshot.callId,
            fromLineId: snapshot.fromLineId,
            toLineId: snapshot.toLineId,
            reason: snapshot.hangupReason
        )
        finishImmediateTeardown(
            snapshot: snapshot,
            event: "callEnded",
            nativeKickRequested: true
        )
        return snapshot
    }

    private func finishImmediateTeardown(
        snapshot: PhoneHomeCallEndSnapshot,
        event: String,
        nativeKickRequested: Bool,
        remoteConnectionState: String? = nil
    ) {
        callAnswered = false
        activeConnectedAt = nil
        audioSessionActive = false
        localHeld = false
        speakerOn = false
        stopRouteGuard()
        disableProximity()
        endNativeMedia()
        deactivateAudioSession()

        if let callId = snapshot.callId {
            reportedCallIds.remove(callId)
        } else {
            reportedCallIds.removeAll()
        }
        if activeUuid == snapshot.callUUID {
            activeUuid = nil
            activeCallId = nil
            activeHandle = nil
            activeFromLineId = nil
            activeToLineId = nil
            uuidOverrides.removeAll()
        }

        var endedData: [String: Any] = [
            "callUUID": snapshot.callUUID.uuidString,
            "answered": snapshot.answered,
            "localHeld": snapshot.localHeld,
            "remoteHeld": snapshot.remoteHeld,
            "nativeKickRequested": nativeKickRequested,
        ]
        if let callId = snapshot.callId { endedData["callId"] = callId }
        if let fromLineId = snapshot.fromLineId { endedData["fromLineId"] = fromLineId }
        if let toLineId = snapshot.toLineId { endedData["toLineId"] = toLineId }
        if let reason = snapshot.hangupReason { endedData["reason"] = reason }
        if let remoteConnectionState {
            endedData["remoteEnded"] = true
            endedData["connectionState"] = remoteConnectionState
        }
        emit(event, data: endedData, retain: true)
    }

    private func submitEndTransaction(uuid: UUID) {
        guard isCallKitEnabled(), !endTransactionsInFlight.contains(uuid) else { return }
        if holdTransactionUuid == uuid {
            deferredEndUuid = uuid
            return
        }
        endTransactionsInFlight.insert(uuid)
        endTransactionAttempts[uuid, default: 0] += 1
        controller.request(CXTransaction(action: CXEndCallAction(call: uuid))) { [weak self] error in
            DispatchQueue.main.async {
                guard let self else { return }
                self.endTransactionsInFlight.remove(uuid)
                guard let error else {
                    self.endTransactionAttempts.removeValue(forKey: uuid)
                    return
                }
                let attempts = self.endTransactionAttempts[uuid] ?? 1
                print("[PhoneHomeCallKit] endCall request failed attempt=\(attempts): \(error.localizedDescription)")
                let callStillLive = self.controller.callObserver.calls.contains {
                    $0.uuid == uuid && !$0.hasEnded
                }
                guard callStillLive, attempts < 3 else { return }
                DispatchQueue.main.asyncAfter(deadline: .now() + (attempts == 1 ? 0.15 : 0.45)) {
                    self.submitEndTransaction(uuid: uuid)
                }
            }
        }
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
        if enabled {
            disableProximity()
        } else {
            enableProximityIfInCall()
        }
        if !audioSessionActive { return }
        if nativeMediaActive {
            nativePeer?.setSpeaker(enabled)
            // RTCAudioSession often steals the port back to speaker — reassert briefly.
            for delay in [0.25, 0.8, 1.6] as [TimeInterval] {
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                    guard let self, self.audioSessionActive, self.nativeMediaActive else { return }
                    self.nativePeer?.setSpeaker(self.speakerOn)
                }
            }
            return
        }
        startRouteGuard()
        assertAudioRoute()
    }

    // MARK: - Native WebRTC (CallKit path)

    /// Answer an inbound offer with native WebRTC. Completes with `{ type, sdp }`.
    public func setNativeRemoteOffer(
        callId: String,
        offerSdp: String,
        iceServers: [[String: Any]],
        completion: @escaping (Result<[String: String], Error>) -> Void
    ) {
        guard activeCallId == callId, activeUuid != nil else {
            completion(.failure(NSError(
                domain: "PhoneHomeCallKit",
                code: 5,
                userInfo: [NSLocalizedDescriptionKey: "Native offer is not for the active call"]
            )))
            return
        }
        let peer = nativePeer ?? PhoneHomeNativePeer()
        nativePeer = peer
        nativeMediaActive = true
        nativePeerGeneration &+= 1
        let peerGeneration = PhoneHomeNativePeerGeneration(
            callId: callId,
            generation: nativePeerGeneration
        )
        let callUuid = activeUuid
        cancelNativeDisconnectGrace()
        nativeTerminationState.begin(peerGeneration)
        // Only a real provider didActivate may authorize WebRTC's manual audio
        // activation. If the offer wins the race, tracks stay disabled until then.
        if audioSessionActive {
            peer.enableCallKitAudio(session: AVAudioSession.sharedInstance())
            peer.setSpeaker(speakerOn)
        }
        peer.onIceCandidate = { [weak self, weak peer] cand in
            guard let self, let peer,
                  self.nativePeer === peer,
                  self.nativePeerGeneration == peerGeneration.generation
            else { return }
            var data = cand
            data["callId"] = callId
            self.emit("nativeIceCandidate", data: data, retain: false)
        }
        peer.onConnectionState = { [weak self, weak peer] ice, conn in
            DispatchQueue.main.async {
                guard let self, let peer else { return }
                self.handleNativeConnectionState(
                    peer: peer,
                    peerGeneration: peerGeneration,
                    callUuid: callUuid,
                    ice: ice,
                    connection: conn
                )
            }
        }
        peer.onAudioLevels = { [weak self] levels in
            var data = levels
            data["callId"] = callId
            let inLvl = (levels["inLevel"] as? Double) ?? 0
            let outLvl = (levels["outLevel"] as? Double) ?? 0
            let rtcOn = (levels["rtcEnabled"] as? Bool) ?? false
            self?.emit(
                "nativeMediaStat",
                data: [
                    "callId": callId,
                    "ice": rtcOn ? "connected" : "new",
                    "conn": rtcOn ? "connected" : "new",
                    "senders": outLvl > 0.001 ? 1 : 0,
                    "receivers": inLvl > 0.001 ? 1 : 0,
                    "reason": "lvl-\(levels["reason"] ?? "x")-i\(String(format: "%.2f", inLvl))-o\(String(format: "%.2f", outLvl))-r\(rtcOn ? 1 : 0)"
                ],
                retain: false
            )
            self?.emit("nativeAudioLevels", data: data, retain: false)
        }
        peer.answerOffer(callId: callId, offerSdp: offerSdp, iceServers: iceServers) { [weak self] result in
            switch result {
            case .success(let sdp):
                var payload: [String: Any] = sdp
                payload["callId"] = callId
                self?.emit("nativeLocalAnswer", data: payload, retain: true)
                // Offer creation can finish after didActivate. The persisted
                // provider state is the sole authority for arming WebRTC audio.
                if self?.audioSessionActive == true {
                    self?.nativePeer?.enableCallKitAudio(session: AVAudioSession.sharedInstance())
                    self?.armNativeAudioWatchdog()
                    self?.armWebViewSignalWake()
                }
                completion(.success(sdp))
            case .failure(let error):
                completion(.failure(error))
            }
        }
    }

    private func handleNativeConnectionState(
        peer: PhoneHomeNativePeer,
        peerGeneration: PhoneHomeNativePeerGeneration,
        callUuid: UUID?,
        ice: String,
        connection: String
    ) {
        guard nativePeer === peer,
              nativePeerGeneration == peerGeneration.generation,
              activeCallId == peerGeneration.callId,
              activeUuid == callUuid
        else { return }

        emit(
            "nativeConnectionState",
            data: ["callId": peerGeneration.callId, "ice": ice, "conn": connection],
            retain: false
        )

        let action = nativeTerminationState.connectionChanged(
            peer: peerGeneration,
            ice: ice,
            connection: connection
        )
        switch action {
        case .cancelDisconnectGrace:
            cancelNativeDisconnectGrace()
        case .scheduleDisconnectGrace:
            guard let callUuid else { return }
            scheduleNativeDisconnectGrace(
                peer: peer,
                peerGeneration: peerGeneration,
                callUuid: callUuid
            )
        case .endRemote:
            guard let callUuid else { return }
            endNativeCallFromRemote(
                peer: peer,
                peerGeneration: peerGeneration,
                callUuid: callUuid,
                connectionState: terminalNativeState(ice: ice, connection: connection)
            )
        case .none:
            break
        }

        let connected = connection == "connected" || ice == "connected" || ice == "completed"
        guard connected, action != .endRemote else { return }
        if callAnswered {
            nativePeer?.ensureAudioUnitRunning()
            nativePeer?.reportAudioLevels(reason: "connected")
        }
        emit(
            "nativeMediaStat",
            data: [
                "callId": peerGeneration.callId,
                "ice": ice,
                "conn": connection,
                "senders": 1,
                "receivers": 1,
                "reason": "native-connected"
            ],
            retain: false
        )
    }

    private func scheduleNativeDisconnectGrace(
        peer: PhoneHomeNativePeer,
        peerGeneration: PhoneHomeNativePeerGeneration,
        callUuid: UUID
    ) {
        cancelNativeDisconnectGrace()
        let work = DispatchWorkItem { [weak self, weak peer] in
            guard let self, let peer,
                  self.nativePeer === peer,
                  self.nativePeerGeneration == peerGeneration.generation,
                  self.activeCallId == peerGeneration.callId,
                  self.activeUuid == callUuid,
                  self.nativeTerminationState.disconnectGraceExpired(peer: peerGeneration) == .endRemote
            else { return }
            self.nativeDisconnectWork = nil
            self.endNativeCallFromRemote(
                peer: peer,
                peerGeneration: peerGeneration,
                callUuid: callUuid,
                connectionState: "disconnected-timeout"
            )
        }
        nativeDisconnectWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + nativeDisconnectGrace, execute: work)
    }

    private func cancelNativeDisconnectGrace() {
        nativeDisconnectWork?.cancel()
        nativeDisconnectWork = nil
    }

    private func endNativeCallFromRemote(
        peer: PhoneHomeNativePeer,
        peerGeneration: PhoneHomeNativePeerGeneration,
        callUuid: UUID,
        connectionState: String
    ) {
        guard nativePeer === peer,
              nativePeerGeneration == peerGeneration.generation,
              activeCallId == peerGeneration.callId,
              activeUuid == callUuid
        else { return }

        cancelNativeDisconnectGrace()
        let result = endState.begin(currentEndSnapshot(uuid: callUuid))
        guard result.isFirst else { return }

        // A remote media terminal is not a user End action. Report it directly
        // to CallKit; submitting CXEndCallAction here races the system UI.
        provider.reportCall(with: callUuid, endedAt: Date(), reason: .remoteEnded)
        finishImmediateTeardown(
            snapshot: result.snapshot,
            event: "nativeRemoteEnded",
            nativeKickRequested: false,
            remoteConnectionState: connectionState
        )
        print(
            "[PhoneHomeCallKit] native remote end callId=\(peerGeneration.callId) " +
            "state=\(connectionState)"
        )
    }

    private func terminalNativeState(ice: String, connection: String) -> String {
        if connection == "closed" || connection == "failed" { return connection }
        if ice == "closed" || ice == "failed" { return ice }
        return connection
    }

    /// Keep RTCAudioSession matched to CallKit for the first seconds of a call.
    private func armNativeAudioWatchdog() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.nativeAudioWatchdog?.invalidate()
            var ticks = 0
            self.nativeAudioWatchdog = Timer.scheduledTimer(withTimeInterval: 0.6, repeats: true) { [weak self] timer in
                guard let self else {
                    timer.invalidate()
                    return
                }
                ticks += 1
                if !self.callAnswered || !self.nativeMediaActive || ticks > 20 {
                    timer.invalidate()
                    self.nativeAudioWatchdog = nil
                    return
                }
            let session = AVAudioSession.sharedInstance()
            let rtc = RTCAudioSession.sharedInstance()
            // Only soft-rearm if the unit dropped — never spam audioSessionDidActivate.
            if !self.localHeld && !rtc.isAudioEnabled {
                self.nativePeer?.ensureAudioUnitRunning()
            }
            if ticks == 3 || ticks == 8 || ticks == 15 {
                self.nativePeer?.reportAudioLevels(reason: "watch-\(ticks)")
                print("[PhoneHomeCallKit] watchdog tick=\(ticks) rtcOn=\(rtc.isAudioEnabled) input=\(session.isInputAvailable) cat=\(session.category.rawValue)")
            }
            }
        }
    }

    private func stopNativeAudioWatchdog() {
        nativeAudioWatchdog?.invalidate()
        nativeAudioWatchdog = nil
    }

    /// Native media keeps the app running but not the WebView, and signaling lives in
    /// the WebView. An evaluateJavaScript round trip resumes it so queued messages run.
    private func armWebViewSignalWake() {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.webViewSignalWake == nil else { return }
            self.webViewSignalWake = Timer.scheduledTimer(
                withTimeInterval: self.webViewSignalWakeInterval,
                repeats: true
            ) { [weak self] timer in
                guard let self, self.callAnswered, self.nativeMediaActive else {
                    timer.invalidate()
                    self?.webViewSignalWake = nil
                    return
                }
                self.plugin?.webView?.evaluateJavaScript("0") { _, _ in }
            }
        }
    }

    private func stopWebViewSignalWake() {
        webViewSignalWake?.invalidate()
        webViewSignalWake = nil
    }

    public func addNativeIceCandidate(_ candidate: [String: Any]?) {
        nativePeer?.addRemoteIceCandidate(candidate)
    }

    public func endNativeMedia() {
        stopNativeAudioWatchdog()
        stopWebViewSignalWake()
        cancelNativeDisconnectGrace()
        nativeTerminationState.clear()
        nativeMediaActive = false
        nativePeerGeneration &+= 1
        let closingPeer = nativePeer
        nativePeer = nil
        closingPeer?.onIceCandidate = nil
        closingPeer?.onConnectionState = nil
        closingPeer?.onAudioLevels = nil
        closingPeer?.onMediaReady = nil
        closingPeer?.close()
        localHeld = false
    }

    public func isNativeMediaActive() -> Bool { nativeMediaActive && nativePeer?.hasActivePeer == true }

    public func isSpeakerOn() -> Bool { speakerOn }

    public func requestHeld(
        _ onHold: Bool,
        muted: Bool,
        completion: @escaping (Error?) -> Void
    ) {
        guard let uuid = activeUuid else {
            completion(NSError(
                domain: "PhoneHomeCallKit",
                code: 3,
                userInfo: [NSLocalizedDescriptionKey: "No active CallKit call"]
            ))
            return
        }
        guard !endState.isEnding(uuid) else {
            completion(NSError(
                domain: "PhoneHomeCallKit",
                code: 4,
                userInfo: [NSLocalizedDescriptionKey: "Call is ending"]
            ))
            return
        }
        nativePeer?.setMuted(muted)
        let action = CXSetHeldCallAction(call: uuid, onHold: onHold)
        holdTransactionUuid = uuid
        controller.request(CXTransaction(action: action)) { [weak self] error in
            DispatchQueue.main.async {
                guard let self else {
                    completion(error)
                    return
                }
                if self.holdTransactionUuid == uuid {
                    self.holdTransactionUuid = nil
                }
                completion(error)
                if self.deferredEndUuid == uuid {
                    self.deferredEndUuid = nil
                    self.submitEndTransaction(uuid: uuid)
                }
            }
        }
    }

    public func setRemoteHeld(_ onHold: Bool, muted: Bool) {
        nativePeer?.setMuted(muted)
        nativePeer?.setRemoteHeld(onHold)
    }

    public func setNativeMuted(_ muted: Bool) {
        nativePeer?.setMuted(muted)
    }

    @discardableResult
    public func setConnected(callId: String?, connectedAtMs requestedMs: Double? = nil) -> Int64? {
        // Incoming CallKit calls are already connected after CXAnswerCallAction.
        // reportOutgoingCall(connectedAt:) is only valid for CXStartCallAction flows —
        // calling it on an inbound UUID can disturb CallKit audio routing.
        let uuid = callId.flatMap { self.uuidFor(callId: $0) } ?? activeUuid
        guard let uuid, activeUuid == uuid else { return connectedAtMs }
        let firstConnection = activeConnectedAt == nil
        if firstConnection {
            let nowMs = Date().timeIntervalSince1970 * 1000
            let validRequested = requestedMs.flatMap { ms -> Date? in
                guard ms.isFinite, abs(ms - nowMs) < 300_000 else { return nil }
                return Date(timeIntervalSince1970: ms / 1000)
            }
            activeConnectedAt = validRequested ?? Date()
        }
        guard let connectedAt = activeConnectedAt else { return nil }
        if firstConnection,
           CXCallObserver().calls.first(where: { $0.uuid == uuid })?.isOutgoing == true {
            provider.reportOutgoingCall(with: uuid, connectedAt: connectedAt)
        }
        if firstConnection {
            var data: [String: Any] = ["connectedAtMs": Int64(connectedAt.timeIntervalSince1970 * 1000)]
            if let callId = activeCallId { data["callId"] = callId }
            emit("callConnected", data: data, retain: true)
        }
        return Int64(connectedAt.timeIntervalSince1970 * 1000)
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
        if let overridden = uuidOverrides[callId] { return overridden }
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
        activeHandle = nil
        activeFromLineId = nil
        activeToLineId = nil
        uuidOverrides.removeAll()
        callAnswered = false
        activeConnectedAt = nil
        audioSessionActive = false
        localHeld = false
        speakerOn = false
        stopRouteGuard()
        disableProximity()
        endNativeMedia()
        deactivateAudioSession()
        reportedCallIds.removeAll()
        holdTransactionUuid = nil
        deferredEndUuid = nil
        endTransactionsInFlight.removeAll()
        endTransactionAttempts.removeAll()
        endState.removeAll()
        emit("callEnded", data: ["reason": "reset"], retain: true)
    }

    public func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        // Category only — CallKit activates in didActivate. Do not setActive here.
        // Keep earpiece unless the softphone already asked for speaker.
        endState.prepareForNewCall(action.callUUID)
        if !speakerOn { enableProximityIfInCall() } else { disableProximity() }
        configureAudioSession(activate: false)
        callAnswered = true
        localHeld = false
        if activeConnectedAt == nil { activeConnectedAt = Date() }
        // Prefer native media for inbound CallKit — create the peer in setNativeRemoteOffer
        // after CallKit activates so the VoIP unit is already live when tracks attach.
        nativeMediaActive = true
        stopRouteGuard()
        activeUuid = action.callUUID
        action.fulfill()
        print("[PhoneHomeCallKit] answered uuid=\(action.callUUID.uuidString) callId=\(activeCallId ?? "?") nativeReady=1 speaker=\(speakerOn)")
        var answeredData: [String: Any] = [
            "callUUID": action.callUUID.uuidString,
            "nativeMedia": true,
            "speakerOn": speakerOn,
        ]
        if let callId = activeCallId { answeredData["callId"] = callId }
        if let fromLineId = activeFromLineId { answeredData["fromLineId"] = fromLineId }
        if let toLineId = activeToLineId { answeredData["toLineId"] = toLineId }
        if let connectedAtMs { answeredData["connectedAtMs"] = connectedAtMs }
        emit("callAnswered", data: answeredData, retain: true)
        // Do NOT emit audioActivated here — wait for didActivate.
    }

    public func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        // CallKit must never wait for JS, held-media teardown, or another transaction.
        action.fulfill()
        _ = beginImmediateEnd(uuid: action.callUUID)
        if deferredEndUuid == action.callUUID { deferredEndUuid = nil }
        endTransactionsInFlight.remove(action.callUUID)
        endTransactionAttempts.removeValue(forKey: action.callUUID)
    }

    public func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        // Outbound 1:1 starts on earpiece (same as Phone). Speaker is opt-in.
        endState.prepareForNewCall(action.callUUID)
        if !speakerOn { enableProximityIfInCall() } else { disableProximity() }
        configureAudioSession(activate: false)
        // Outbound is live for audio/mic purposes once CallKit accepts the start —
        // keeps JS from hard-releasing the mic while the system call is up.
        callAnswered = true
        let handleValue = action.handle.value
        // Recents uses a system UUID — drop a stale hashed callId so hangup uses activeUuid.
        let systemInitiated: Bool = {
            guard let cid = activeCallId else { return true }
            return uuidFor(callId: cid) != action.callUUID
        }()
        if systemInitiated {
            activeCallId = nil
            // Persist before JS boots — Phone Recents often launches a cold WebView.
            Self.storePendingOutgoingHandle(handleValue)
            kickWebViewDial(handle: handleValue)
        }
        activeUuid = action.callUUID
        activeHandle = handleValue
        // Outbound Recents: remote is the handle we are calling.
        activeToLineId = handleValue
        activeFromLineId = nil
        activeConnectedAt = nil
        localHeld = false
        action.fulfill()
        provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: Date())
        let update = CXCallUpdate()
        update.supportsHolding = true
        update.supportsGrouping = false
        update.supportsUngrouping = false
        provider.reportCall(with: action.callUUID, updated: update)
        var started: [String: Any] = [
            "callUUID": action.callUUID.uuidString,
            "handle": handleValue,
            "fromRecents": systemInitiated
        ]
        if let callId = activeCallId { started["callId"] = callId }
        print("[PhoneHomeCallKit] startCall handle=\(handleValue) uuid=\(action.callUUID.uuidString) recents=\(systemInitiated)")
        emit("callStarted", data: started, retain: true)
    }

    public func provider(_ provider: CXProvider, perform action: CXSetHeldCallAction) {
        // A queued Hold can arrive after in-app Hang Up began. Fulfill the stale
        // action so it cannot block End, but never resurrect media or held state.
        if endState.isEnding(action.callUUID) {
            localHeld = false
            action.fulfill()
            print("[PhoneHomeCallKit] ignore held action for ending uuid=\(action.callUUID.uuidString)")
            return
        }
        localHeld = action.isOnHold
        nativePeer?.setLocalHeld(action.isOnHold)
        action.fulfill()
        var data: [String: Any] = [
            "onHold": action.isOnHold,
            "callUUID": action.callUUID.uuidString,
        ]
        if let activeCallId { data["callId"] = activeCallId }
        emit("callHeld", data: data, retain: true)
        kickWebViewHeld(
            onHold: action.isOnHold,
            callId: activeCallId,
            fromLineId: activeFromLineId,
            toLineId: activeToLineId
        )
        print("[PhoneHomeCallKit] held=\(action.isOnHold) uuid=\(action.callUUID.uuidString)")
    }

    public func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        audioSessionActive = true
        let useNative = nativeMediaActive || nativePeer != nil
        print("[PhoneHomeCallKit] audioActivated (didActivate) speaker=\(speakerOn) native=\(useNative)")
        if useNative {
            nativeMediaActive = true
            stopRouteGuard()
            // Peer may not exist yet (created in setNativeRemoteOffer) — stash session.
            if let peer = nativePeer {
                peer.enableCallKitAudio(session: audioSession)
                peer.setSpeaker(speakerOn)
            } else {
                // Mark session active so setNativeRemoteOffer can arm immediately.
                audioSessionActive = true
            }
            // WebRTC often flips to speaker after the unit starts — pin preferred route.
            for delay in [0.3, 1.0, 2.0] as [TimeInterval] {
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                    guard let self, self.audioSessionActive, self.nativeMediaActive else { return }
                    self.nativePeer?.setSpeaker(self.speakerOn)
                }
            }
            armNativeAudioWatchdog()
            armWebViewSignalWake()
            emit("audioActivated", data: ["speakerOn": speakerOn, "nativeMedia": true], retain: true)
            return
        }
        // CallKit already owns an active session here. Configure category/route,
        // but never call setActive(true) from inside its lifecycle callback.
        configureAudioSession(activate: false)
        applyAudioRoute()
        emit("audioActivated", data: ["speakerOn": speakerOn], retain: true)
        kickWebViewMic(reason: "didActivate")
        for delay in [0.45, 1.2, 2.5, 4.0] as [TimeInterval] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let self, self.audioSessionActive, self.callAnswered, !self.nativeMediaActive else { return }
                self.configureAudioSession(activate: false)
                self.applyAudioRoute()
                self.emit(
                    "audioActivated",
                    data: ["speakerOn": self.speakerOn, "rekick": true, "delayMs": Int(delay * 1000)],
                    retain: true
                )
                self.kickWebViewMic(reason: "rekick-\(Int(delay * 1000))")
            }
        }
    }

    /// Bypass Cap event queue — run mic attach JS even when timers/listeners are starved.
    private func kickWebViewMic(reason: String) {
        DispatchQueue.main.async { [weak self] in
            guard let plugin = self?.plugin else {
                print("[PhoneHomeCallKit] kickMic skip — no plugin (\(reason))")
                return
            }
            guard let webView = plugin.webView else {
                print("[PhoneHomeCallKit] kickMic skip — no webView (\(reason))")
                return
            }
            let escaped = reason
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "'", with: "\\'")
            let js = "try{window.__phoneHomeCallKitKickMic&&window.__phoneHomeCallKitKickMic('\(escaped)');}catch(e){}"
            webView.evaluateJavaScript(js) { _, err in
                if let err {
                    print("[PhoneHomeCallKit] kickMic JS err (\(reason)): \(err.localizedDescription)")
                } else {
                    print("[PhoneHomeCallKit] kickMic JS ok (\(reason))")
                }
            }
        }
    }

    /// Lock-screen End must notify the hub before WKWebView Cap listeners wake (~seconds).
    private func kickWebViewHangup(callId: String?, fromLineId: String?, toLineId: String?, reason: String? = nil) {
        var payload: [String: String] = [:]
        if let callId, !callId.isEmpty { payload["callId"] = callId }
        if let fromLineId, !fromLineId.isEmpty { payload["fromLineId"] = fromLineId }
        if let toLineId, !toLineId.isEmpty { payload["toLineId"] = toLineId }
        if let reason, !reason.isEmpty { payload["reason"] = reason }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8)
        else { return }
        let run: () -> Void = { [weak self] in
            guard let plugin = self?.plugin else {
                print("[PhoneHomeCallKit] hangup kick skip — no plugin")
                return
            }
            guard let webView = plugin.webView else {
                print("[PhoneHomeCallKit] hangup kick skip — no webView")
                return
            }
            let js = "try{window.__phoneHomeCallKitHangup&&window.__phoneHomeCallKitHangup(\(json));}catch(e){}"
            webView.evaluateJavaScript(js) { _, err in
                if let err {
                    print("[PhoneHomeCallKit] hangup kick JS err: \(err.localizedDescription)")
                } else {
                    print("[PhoneHomeCallKit] hangup kick JS ok callId=\(callId ?? "?")")
                }
            }
        }
        if Thread.isMainThread { run() }
        else { DispatchQueue.main.async(execute: run) }
    }

    /// System Hold/Resume must reach signaling even when retained Capacitor events
    /// are delayed behind the lock screen.
    private func kickWebViewHeld(
        onHold: Bool,
        callId: String?,
        fromLineId: String?,
        toLineId: String?
    ) {
        var payload: [String: Any] = ["onHold": onHold]
        if let callId, !callId.isEmpty { payload["callId"] = callId }
        if let fromLineId, !fromLineId.isEmpty { payload["fromLineId"] = fromLineId }
        if let toLineId, !toLineId.isEmpty { payload["toLineId"] = toLineId }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8)
        else { return }
        let run: () -> Void = { [weak self] in
            guard let webView = self?.plugin?.webView else { return }
            let js = "try{window.__phoneHomeCallKitHeld&&window.__phoneHomeCallKitHeld(\(json));}catch(e){}"
            webView.evaluateJavaScript(js) { _, err in
                if let err {
                    print("[PhoneHomeCallKit] held kick JS err: \(err.localizedDescription)")
                }
            }
        }
        if Thread.isMainThread { run() }
        else { DispatchQueue.main.async(execute: run) }
    }

    /// Phone Recents → CXStartCallAction: dial even when Cap listeners are not attached yet.
    private func kickWebViewDial(handle: String) {
        let trimmed = handle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let data = try? JSONSerialization.data(withJSONObject: ["handle": trimmed]),
              let json = String(data: data, encoding: .utf8)
        else { return }
        let run: () -> Void = { [weak self] in
            guard let plugin = self?.plugin else {
                print("[PhoneHomeCallKit] dial kick skip — no plugin")
                return
            }
            guard let webView = plugin.webView else {
                print("[PhoneHomeCallKit] dial kick skip — no webView")
                return
            }
            let js = "try{window.__phoneHomeCallKitDial&&window.__phoneHomeCallKitDial(\(json));}catch(e){}"
            webView.evaluateJavaScript(js) { _, err in
                if let err {
                    print("[PhoneHomeCallKit] dial kick JS err: \(err.localizedDescription)")
                } else {
                    print("[PhoneHomeCallKit] dial kick JS ok handle=\(trimmed)")
                }
            }
        }
        if Thread.isMainThread { run() }
        else { DispatchQueue.main.async(execute: run) }
        // Retry — cold WebView often attaches after the first kick.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8, execute: run)
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0, execute: run)
    }

    /// Donate INStartCallIntent so Phone Recents can relaunch us with the line handle.
    private func donateStartCallIntent(handle: String, displayName: String, direction: INInteractionDirection) {
        let personHandle = INPersonHandle(value: handle, type: .unknown)
        let person = INPerson(
            personHandle: personHandle,
            nameComponents: nil,
            displayName: displayName,
            image: nil,
            contactIdentifier: nil,
            customIdentifier: handle
        )
        let intent = INStartCallIntent(
            callRecordFilter: nil,
            callRecordToCallBack: nil,
            audioRoute: .unknown,
            destinationType: .normal,
            contacts: [person],
            callCapability: .audioCall
        )
        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = direction
        interaction.donate { err in
            if let err {
                print("[PhoneHomeCallKit] donate INStartCallIntent failed: \(err.localizedDescription)")
            } else {
                print("[PhoneHomeCallKit] donated INStartCallIntent handle=\(handle)")
            }
        }
    }

    /// Phone Recents / Siri may deliver INStartCallIntent instead of (or before) CXStartCallAction.
    @objc public func handleStartCallIntent(_ intent: INStartCallIntent) -> Bool {
        let handle =
            intent.contacts?.first?.customIdentifier
            ?? intent.contacts?.first?.personHandle?.value
            ?? ""
        let trimmed = handle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("line_") else {
            print("[PhoneHomeCallKit] INStartCallIntent ignored handle=\(handle)")
            return false
        }
        Self.storePendingOutgoingHandle(trimmed)
        activeHandle = trimmed
        activeToLineId = trimmed
        callAnswered = true
        kickWebViewDial(handle: trimmed)
        emit(
            "callStarted",
            data: ["handle": trimmed, "fromRecents": true, "fromIntent": true],
            retain: true
        )
        // Recents often only delivers the Intent (no CXStartCallAction). Request
        // CallKit ourselves so the system in-call UI appears and dial kicks stick.
        if activeUuid == nil {
            let uuid = UUID()
            let start = CXStartCallAction(call: uuid, handle: CXHandle(type: .generic, value: trimmed))
            start.isVideo = false
            let tx = CXTransaction(action: start)
            controller.request(tx) { err in
                if let err {
                    print("[PhoneHomeCallKit] Intent→CXStartCall failed: \(err.localizedDescription)")
                } else {
                    print("[PhoneHomeCallKit] Intent→CXStartCall ok handle=\(trimmed)")
                }
            }
        }
        return true
    }

    public func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        audioSessionActive = false
        disableProximity()
        if nativeMediaActive {
            // Always tell WebRTC — leaving isAudioEnabled=true after CallKit tears down
            // the OS session yields silent send=1/recv=1. didActivate + watchdog re-arm.
            nativePeer?.disableCallKitAudio(session: audioSession)
            emit("audioDeactivated", data: ["nativeMedia": true, "callAnswered": callAnswered], retain: false)
            // Do not synthesize activation after a route blip. A subsequent real
            // provider didActivate is the only event allowed to re-arm WebRTC.
            return
        }
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
            reportIncoming(
                callId: callId,
                handle: handle,
                callerName: callerName,
                fromLineId: fromLineId,
                toLineId: toLineId.isEmpty ? nil : toLineId,
                force: true
            ) { _ in
                self.endCall(callId: callId)
                completion()
            }
            return
        }
        // Apple: report to CallKit and wait for *that* completion before
        // calling the PushKit completion, or iOS can kill / revoke VoIP.
        reportIncoming(
            callId: callId,
            handle: handle,
            callerName: callerName,
            fromLineId: fromLineId,
            toLineId: toLineId.isEmpty ? nil : toLineId
        ) { error in
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
        if type == "voicemail" {
            var data: [String: Any] = [
                "voicemailId": (userInfo["callId"] as? String) ?? "",
                "fromLabel": (userInfo["callerName"] as? String) ?? "Family",
                "fromLineId": (userInfo["fromLineId"] as? String) ?? "",
                "source": source
            ]
            if let to = userInfo["toLineId"] as? String, !to.isEmpty {
                data["toLineId"] = to
            }
            emit("voicemailAlert", data: data, retain: true)
            print("[PhoneHomeCallKit] voicemailAlert \(source)")
            return
        }
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
