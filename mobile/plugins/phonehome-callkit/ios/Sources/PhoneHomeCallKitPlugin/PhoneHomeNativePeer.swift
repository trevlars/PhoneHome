import Foundation
import AVFoundation
import WebRTC

enum PhoneHomeNativeAudioActivationAction: Equatable {
    case none
    case requestPermission
    case activateAndEnable
    case enableOnly
    case deactivateAndDisable
    case disableOnly
}

/// Main-queue state machine for CallKit's manual WebRTC audio handoff.
/// It deduplicates repeated didActivate and permission callbacks, and invalidates
/// an in-flight callback when CallKit deactivates before permission returns.
final class PhoneHomeNativeAudioActivationState {
    private(set) var audioUnitArmed = false
    private(set) var permissionRequestInFlight = false
    private var activationRequested = false

    func requestEnable() -> PhoneHomeNativeAudioActivationAction {
        activationRequested = true
        if audioUnitArmed { return .enableOnly }
        if permissionRequestInFlight { return .none }
        permissionRequestInFlight = true
        return .requestPermission
    }

    func permissionCompleted() -> PhoneHomeNativeAudioActivationAction {
        guard permissionRequestInFlight else { return .none }
        permissionRequestInFlight = false
        guard activationRequested else { return .none }
        if audioUnitArmed { return .enableOnly }
        audioUnitArmed = true
        return .activateAndEnable
    }

    func deactivate() -> PhoneHomeNativeAudioActivationAction {
        activationRequested = false
        permissionRequestInFlight = false
        if audioUnitArmed {
            audioUnitArmed = false
            return .deactivateAndDisable
        }
        return .disableOnly
    }

    func reset() {
        activationRequested = false
        permissionRequestInFlight = false
        audioUnitArmed = false
    }
}

/// App-process WebRTC for CallKit inbound calls.
/// WKWebView getUserMedia cannot join CallKit's AVAudioSession (separate process).
final class PhoneHomeNativePeer: NSObject, RTCPeerConnectionDelegate {
    private static var sslReady = false
    private static let holdMusicData: Data = makeHoldMusicWav()

    private let factory: RTCPeerConnectionFactory
    private var peerConnection: RTCPeerConnection?
    private var localAudioTrack: RTCAudioTrack?
    private var callId: String = ""
    private var pendingRemoteCandidates: [RTCIceCandidate] = []
    private var remoteDescriptionSet = false
    private var localHeld = false
    private var remoteHeld = false
    private var muted = false
    private var holdMusicPlayer: AVAudioPlayer?

    var onIceCandidate: (([String: Any]) -> Void)?
    var onConnectionState: ((String, String) -> Void)? // ice, conn
    var onAudioLevels: (([String: Any]) -> Void)?
    var onMediaReady: (() -> Void)?

    override init() {
        if !Self.sslReady {
            RTCInitializeSSL()
            Self.sslReady = true
        }
        let encoder = RTCDefaultVideoEncoderFactory()
        let decoder = RTCDefaultVideoDecoderFactory()
        factory = RTCPeerConnectionFactory(encoderFactory: encoder, decoderFactory: decoder)

        let audio = RTCAudioSession.sharedInstance()
        audio.useManualAudio = true
        audio.isAudioEnabled = false

        super.init()
    }

    // No deinit teardown: close() forms weak references to self, which abort the app
    // during deallocation. PhoneHomeCallKit.endNativeMedia() closes every peer it releases.

    /// Create PC from remote offer; returns local answer SDP.
    func answerOffer(
        callId: String,
        offerSdp: String,
        iceServers: [[String: Any]],
        completion: @escaping (Result<[String: String], Error>) -> Void
    ) {
        closePeerConnectionOnly()
        self.callId = callId
        remoteDescriptionSet = false
        pendingRemoteCandidates.removeAll()

        let config = RTCConfiguration()
        config.sdpSemantics = .unifiedPlan
        config.continualGatheringPolicy = .gatherContinually
        config.iceServers = Self.parseIceServers(iceServers)

        let constraints = RTCMediaConstraints(
            mandatoryConstraints: [
                "OfferToReceiveAudio": "true",
                "OfferToReceiveVideo": "false"
            ],
            optionalConstraints: nil
        )

        guard let pc = factory.peerConnection(
            with: config,
            constraints: constraints,
            delegate: self
        ) else {
            completion(.failure(NSError(
                domain: "PhoneHomeNativePeer",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Failed to create peer connection"]
            )))
            return
        }
        peerConnection = pc

        let audioSource = factory.audioSource(with: RTCMediaConstraints(
            mandatoryConstraints: nil,
            optionalConstraints: nil
        ))
        let track = factory.audioTrack(with: audioSource, trackId: "phonehome-audio")
        track.isEnabled = shouldSendAudio
        localAudioTrack = track
        _ = pc.add(track, streamIds: ["phonehome"])

        let remote = RTCSessionDescription(type: .offer, sdp: offerSdp)
        pc.setRemoteDescription(remote) { [weak self] error in
            guard let self else { return }
            if let error {
                completion(.failure(error))
                return
            }
            self.remoteDescriptionSet = true
            self.flushPendingRemoteCandidates()

            pc.answer(for: constraints) { answer, error in
                if let error {
                    completion(.failure(error))
                    return
                }
                guard let answer else {
                    completion(.failure(NSError(
                        domain: "PhoneHomeNativePeer",
                        code: 2,
                        userInfo: [NSLocalizedDescriptionKey: "Empty answer SDP"]
                    )))
                    return
                }
                pc.setLocalDescription(answer) { error in
                    if let error {
                        completion(.failure(error))
                        return
                    }
                    completion(.success(["type": "answer", "sdp": answer.sdp]))
                }
            }
        }
    }

    func addRemoteIceCandidate(_ dict: [String: Any]?) {
        guard let dict else {
            // End-of-candidates — ignore for native (optional).
            return
        }
        let sdp = (dict["candidate"] as? String) ?? ""
        guard !sdp.isEmpty else { return }
        let mid = dict["sdpMid"] as? String
        let index: Int32
        if let n = dict["sdpMLineIndex"] as? Int {
            index = Int32(n)
        } else if let n = dict["sdpMLineIndex"] as? NSNumber {
            index = n.int32Value
        } else {
            index = 0
        }
        let cand = RTCIceCandidate(sdp: sdp, sdpMLineIndex: index, sdpMid: mid)
        if !remoteDescriptionSet || peerConnection == nil {
            pendingRemoteCandidates.append(cand)
            return
        }
        peerConnection?.add(cand) { error in
            if let error {
                print("[PhoneHomeNativePeer] addIce failed: \(error.localizedDescription)")
            }
        }
    }

    private let audioActivation = PhoneHomeNativeAudioActivationState()
    private var audioUnitArmed: Bool { audioActivation.audioUnitArmed }

    func enableCallKitAudio(session: AVAudioSession) {
        let begin = { [weak self] in
            guard let self else { return }
            let rtc = RTCAudioSession.sharedInstance()
            rtc.useManualAudio = true
            switch self.audioActivation.requestEnable() {
            case .requestPermission:
                let finish: (Bool) -> Void = { [weak self] granted in
                    DispatchQueue.main.async {
                        guard let self else { return }
                        self.finishCallKitAudioPermission(
                            granted: granted,
                            session: session
                        )
                    }
                }
                if #available(iOS 17.0, *) {
                    AVAudioApplication.requestRecordPermission { finish($0) }
                } else {
                    AVAudioSession.sharedInstance().requestRecordPermission { finish($0) }
                }
            case .enableOnly:
                self.enableArmedAudioUnit(rtc: rtc, granted: true)
            case .none:
                break
            case .activateAndEnable, .deactivateAndDisable, .disableOnly:
                assertionFailure("Unexpected native audio activation transition")
            }
        }
        if Thread.isMainThread { begin() }
        else { DispatchQueue.main.async(execute: begin) }
    }

    private func finishCallKitAudioPermission(
        granted: Bool,
        session: AVAudioSession
    ) {
        let rtc = RTCAudioSession.sharedInstance()
        rtc.useManualAudio = true
        switch audioActivation.permissionCompleted() {
        case .activateAndEnable:
            if !granted {
                print("[PhoneHomeNativePeer] mic permission DENIED — uplink will be silent")
            }
            rtc.audioSessionDidActivate(session)
            enableArmedAudioUnit(rtc: rtc, granted: granted)
        case .enableOnly:
            enableArmedAudioUnit(rtc: rtc, granted: granted)
        case .none:
            break
        case .requestPermission, .deactivateAndDisable, .disableOnly:
            assertionFailure("Unexpected native audio permission transition")
        }
    }

    private func enableArmedAudioUnit(rtc: RTCAudioSession, granted: Bool) {
        rtc.isAudioEnabled = true
        applyMediaState()
        onMediaReady?()
        let inputOk = AVAudioSession.sharedInstance().isInputAvailable
        print("[PhoneHomeNativePeer] CallKit audio enabled callId=\(callId) track=\(localAudioTrack != nil) rtcEnabled=\(rtc.isAudioEnabled) input=\(inputOk) mic=\(granted) armed=\(audioUnitArmed)")
        reportAudioLevels(reason: "audio-on")
    }

    func disableCallKitAudio(session: AVAudioSession) {
        let disable = { [weak self] in
            guard let self else { return }
            let rtc = RTCAudioSession.sharedInstance()
            let action = self.audioActivation.deactivate()
            rtc.isAudioEnabled = false
            self.stopHoldMusic()
            if action == .deactivateAndDisable {
                rtc.audioSessionDidDeactivate(session)
            }
            print("[PhoneHomeNativePeer] CallKit audio disabled callId=\(self.callId)")
        }
        if Thread.isMainThread { disable() }
        else { DispatchQueue.main.async(execute: disable) }
    }

    /// Soft re-arm: flip isAudioEnabled without re-calling audioSessionDidActivate.
    func ensureAudioUnitRunning() {
        let rtc = RTCAudioSession.sharedInstance()
        rtc.useManualAudio = true
        if audioUnitArmed && !rtc.isAudioEnabled {
            rtc.isAudioEnabled = true
            applyMediaState()
            print("[PhoneHomeNativePeer] ensureAudioUnitRunning re-enabled callId=\(callId)")
        }
    }

    /// Local/system hold: stop sending and hearing the peer. CallKit remains the
    /// owner of AVAudioSession; its didDeactivate/didActivate callbacks control the unit.
    func setLocalHeld(_ held: Bool) {
        localHeld = held
        applyMediaState()
        print("[PhoneHomeNativePeer] local hold=\(held) callId=\(callId)")
    }

    /// The far side put this call on hold. Keep CallKit audio active, suppress the
    /// peer tracks, and play in-process MOH because WKWebView audio cannot join this session.
    func setRemoteHeld(_ held: Bool) {
        remoteHeld = held
        applyMediaState()
        print("[PhoneHomeNativePeer] remote hold=\(held) callId=\(callId)")
    }

    func setMuted(_ value: Bool) {
        muted = value
        applyMediaState()
    }

    var isLocallyHeld: Bool { localHeld }
    var isRemotelyHeld: Bool { remoteHeld }

    /// Loudspeaker vs earpiece without touching category/mode (CallKit owns those).
    func setSpeaker(_ enabled: Bool) {
        do {
            try AVAudioSession.sharedInstance().overrideOutputAudioPort(
                enabled ? .speaker : .none
            )
        } catch {
            print("[PhoneHomeNativePeer] setSpeaker: \(error)")
        }
    }

    /// Emit inbound/outbound audioLevel so hub tests can detect silent-but-connected.
    func reportAudioLevels(reason: String) {
        guard let pc = peerConnection else { return }
        pc.statistics { [weak self] report in
            guard let self else { return }
            var inLevel: Double = 0
            var outLevel: Double = 0
            var bytesIn: Int = 0
            var bytesOut: Int = 0
            for (_, stat) in report.statistics {
                let v = stat.values
                if stat.type == "inbound-rtp", (v["kind"] as? String) == "audio" || (v["mediaType"] as? String) == "audio" {
                    if let lvl = Self.doubleVal(v["audioLevel"]) { inLevel = max(inLevel, lvl) }
                    if let b = Self.intVal(v["bytesReceived"]) { bytesIn = max(bytesIn, b) }
                }
                if stat.type == "outbound-rtp", (v["kind"] as? String) == "audio" || (v["mediaType"] as? String) == "audio" {
                    if let lvl = Self.doubleVal(v["audioLevel"]) { outLevel = max(outLevel, lvl) }
                    if let b = Self.intVal(v["bytesSent"]) { bytesOut = max(bytesOut, b) }
                }
                if stat.type == "track" || stat.type == "media-source" {
                    if let lvl = Self.doubleVal(v["audioLevel"]) {
                        if (v["remoteSource"] as? Bool) == true { inLevel = max(inLevel, lvl) }
                        else { outLevel = max(outLevel, lvl) }
                    }
                }
            }
            let rtcOn = RTCAudioSession.sharedInstance().isAudioEnabled
            print("[PhoneHomeNativePeer] levels reason=\(reason) in=\(String(format: "%.3f", inLevel)) out=\(String(format: "%.3f", outLevel)) bytesIn=\(bytesIn) bytesOut=\(bytesOut) rtcOn=\(rtcOn)")
            self.onAudioLevels?([
                "reason": reason,
                "inLevel": inLevel,
                "outLevel": outLevel,
                "bytesIn": bytesIn,
                "bytesOut": bytesOut,
                "rtcEnabled": rtcOn,
                "callId": self.callId
            ])
        }
    }

    private static func doubleVal(_ any: Any?) -> Double? {
        if let d = any as? Double { return d }
        if let n = any as? NSNumber { return n.doubleValue }
        if let s = any as? String { return Double(s) }
        return nil
    }

    private static func intVal(_ any: Any?) -> Int? {
        if let i = any as? Int { return i }
        if let n = any as? NSNumber { return n.intValue }
        if let s = any as? String { return Int(s) }
        return nil
    }

    func close() {
        stopHoldMusic()
        closePeerConnectionOnly()
        localAudioTrack = nil
        callId = ""
        audioActivation.reset()
        localHeld = false
        remoteHeld = false
        muted = false
        let rtc = RTCAudioSession.sharedInstance()
        rtc.isAudioEnabled = false
    }

    var hasActivePeer: Bool { peerConnection != nil }

    // MARK: - RTCPeerConnectionDelegate

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}

    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        emitConnectionState(peerConnection)
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        guard self.peerConnection === peerConnection else { return }
        var payload: [String: Any] = [
            "candidate": candidate.sdp,
            "sdpMLineIndex": candidate.sdpMLineIndex
        ]
        if let mid = candidate.sdpMid {
            payload["sdpMid"] = mid
        }
        onIceCandidate?(payload)
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {
        emitConnectionState(peerConnection)
    }

    func peerConnection(
        _ peerConnection: RTCPeerConnection,
        didAdd rtpReceiver: RTCRtpReceiver,
        streams mediaStreams: [RTCMediaStream]
    ) {
        guard self.peerConnection === peerConnection else { return }
        // Remote audio plays via WebRTC audio unit once isAudioEnabled.
        if let track = rtpReceiver.track as? RTCAudioTrack {
            track.isEnabled = shouldReceiveAudio
        }
    }

    // MARK: - Private

    private func closePeerConnectionOnly() {
        // Detach first so synchronous/asynchronous delegate callbacks from the
        // abandoned connection cannot report the state of a replacement peer.
        let closing = peerConnection
        peerConnection = nil
        closing?.close()
        remoteDescriptionSet = false
        pendingRemoteCandidates.removeAll()
    }

    private var shouldSendAudio: Bool {
        audioUnitArmed && !localHeld && !remoteHeld && !muted
    }

    private var shouldReceiveAudio: Bool {
        audioUnitArmed && !localHeld && !remoteHeld
    }

    private func applyMediaState() {
        let send = shouldSendAudio
        let receive = shouldReceiveAudio
        localAudioTrack?.isEnabled = send
        if let pc = peerConnection {
            for sender in pc.senders where sender.track?.kind == "audio" {
                sender.track?.isEnabled = send
            }
            for receiver in pc.receivers where receiver.track?.kind == "audio" {
                receiver.track?.isEnabled = receive
            }
        }
        if remoteHeld && !localHeld && audioUnitArmed && RTCAudioSession.sharedInstance().isAudioEnabled {
            startHoldMusic()
        } else {
            stopHoldMusic()
        }
    }

    private func startHoldMusic() {
        let play = { [weak self] in
            guard let self, self.remoteHeld else { return }
            if self.holdMusicPlayer?.isPlaying == true { return }
            do {
                let player = try AVAudioPlayer(data: Self.holdMusicData)
                player.numberOfLoops = -1
                player.volume = 0.32
                player.prepareToPlay()
                player.play()
                self.holdMusicPlayer = player
            } catch {
                print("[PhoneHomeNativePeer] hold music failed: \(error.localizedDescription)")
            }
        }
        if Thread.isMainThread { play() }
        else { DispatchQueue.main.async(execute: play) }
    }

    private func stopHoldMusic() {
        let stop = { [weak self] in
            self?.holdMusicPlayer?.stop()
            self?.holdMusicPlayer = nil
        }
        if Thread.isMainThread { stop() }
        else { DispatchQueue.main.sync(execute: stop) }
    }

    /// Small generated PCM loop avoids a media dependency and plays inside the
    /// active app-process CallKit AVAudioSession.
    private static func makeHoldMusicWav() -> Data {
        let sampleRate = 24_000
        let seconds = 8
        let sampleCount = sampleRate * seconds
        let chords: [[Double]] = [
            [261.63, 329.63, 392.00],
            [220.00, 261.63, 329.63],
            [174.61, 220.00, 261.63],
            [196.00, 246.94, 293.66],
        ]
        let melody: [Double] = [
            523.25, 587.33, 659.25, 587.33,
            523.25, 392.00, 440.00, 493.88,
            523.25, 493.88, 440.00, 392.00,
            349.23, 392.00, 440.00, 523.25,
        ]
        var pcm = Data(capacity: sampleCount * 2)
        for index in 0..<sampleCount {
            let t = Double(index) / Double(sampleRate)
            let chord = chords[min(Int(t / 2.0), chords.count - 1)]
            let noteIndex = min(Int(t / 0.5), melody.count - 1)
            let beatPosition = t.truncatingRemainder(dividingBy: 0.5)
            let noteEnvelope = min(1.0, beatPosition / 0.025) * min(1.0, (0.5 - beatPosition) / 0.08)
            let loopEnvelope = min(1.0, t / 0.04) * min(1.0, (Double(seconds) - t) / 0.06)
            let pad = chord.reduce(0.0) { partial, frequency in
                partial + sin(2.0 * .pi * frequency * t) * 0.045
            }
            let lead = sin(2.0 * .pi * melody[noteIndex] * t) * 0.075 * max(0.0, noteEnvelope)
            let sample = max(-0.9, min(0.9, (pad + lead) * max(0.0, loopEnvelope)))
            appendLittleEndian(Int16(sample * Double(Int16.max)), to: &pcm)
        }

        var wav = Data(capacity: 44 + pcm.count)
        wav.append(contentsOf: Array("RIFF".utf8))
        appendLittleEndian(UInt32(36 + pcm.count), to: &wav)
        wav.append(contentsOf: Array("WAVEfmt ".utf8))
        appendLittleEndian(UInt32(16), to: &wav)
        appendLittleEndian(UInt16(1), to: &wav)
        appendLittleEndian(UInt16(1), to: &wav)
        appendLittleEndian(UInt32(sampleRate), to: &wav)
        appendLittleEndian(UInt32(sampleRate * 2), to: &wav)
        appendLittleEndian(UInt16(2), to: &wav)
        appendLittleEndian(UInt16(16), to: &wav)
        wav.append(contentsOf: Array("data".utf8))
        appendLittleEndian(UInt32(pcm.count), to: &wav)
        wav.append(pcm)
        return wav
    }

    private static func appendLittleEndian<T: FixedWidthInteger>(_ value: T, to data: inout Data) {
        var little = value.littleEndian
        withUnsafeBytes(of: &little) { bytes in
            data.append(contentsOf: bytes)
        }
    }

    private func flushPendingRemoteCandidates() {
        let queued = pendingRemoteCandidates
        pendingRemoteCandidates.removeAll()
        for c in queued {
            peerConnection?.add(c) { error in
                if let error {
                    print("[PhoneHomeNativePeer] flush ice: \(error.localizedDescription)")
                }
            }
        }
    }

    private func emitConnectionState(_ pc: RTCPeerConnection) {
        guard peerConnection === pc else { return }
        let ice = Self.iceStateString(pc.iceConnectionState)
        let conn = Self.connStateString(pc.connectionState)
        onConnectionState?(ice, conn)
    }

    private static func iceStateString(_ s: RTCIceConnectionState) -> String {
        switch s {
        case .new: return "new"
        case .checking: return "checking"
        case .connected: return "connected"
        case .completed: return "completed"
        case .failed: return "failed"
        case .disconnected: return "disconnected"
        case .closed: return "closed"
        case .count: return "count"
        @unknown default: return "unknown"
        }
    }

    private static func connStateString(_ s: RTCPeerConnectionState) -> String {
        switch s {
        case .new: return "new"
        case .connecting: return "connecting"
        case .connected: return "connected"
        case .disconnected: return "disconnected"
        case .failed: return "failed"
        case .closed: return "closed"
        @unknown default: return "unknown"
        }
    }

    private static func parseIceServers(_ raw: [[String: Any]]) -> [RTCIceServer] {
        var out: [RTCIceServer] = []
        for entry in raw {
            var urls: [String] = []
            if let s = entry["urls"] as? String {
                urls = [s]
            } else if let arr = entry["urls"] as? [String] {
                urls = arr
            } else if let s = entry["url"] as? String {
                urls = [s]
            }
            guard !urls.isEmpty else { continue }
            let username = entry["username"] as? String
            let credential = entry["credential"] as? String
            if let username, let credential, !username.isEmpty {
                out.append(RTCIceServer(urlStrings: urls, username: username, credential: credential))
            } else {
                out.append(RTCIceServer(urlStrings: urls))
            }
        }
        if out.isEmpty {
            out.append(RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"]))
        }
        return out
    }
}
