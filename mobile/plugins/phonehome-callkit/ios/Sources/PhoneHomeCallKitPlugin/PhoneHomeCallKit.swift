import Foundation
import UIKit
import CallKit
import PushKit
import AVFoundation
import Capacitor

@objc public class PhoneHomeCallKit: NSObject, CXProviderDelegate, PKPushRegistryDelegate {
    public static let shared = PhoneHomeCallKit()

    private let controller = CXCallController()
    private var provider: CXProvider!
    private var registry: PKPushRegistry?
    private var activeUuid: UUID?
    private weak var plugin: CAPPlugin?

    private override init() {
        super.init()
        let config = CXProviderConfiguration(localizedName: "PhoneHome")
        config.supportsVideo = false
        config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.generic]
        if let icon = UIImage(systemName: "phone.fill") {
            config.iconTemplateImageData = icon.pngData()
        }
        provider = CXProvider(configuration: config)
        provider.setDelegate(self, queue: nil)
    }

    public func attach(plugin: CAPPlugin) {
        self.plugin = plugin
    }

    public func startPushKit() {
        let reg = PKPushRegistry(queue: DispatchQueue.main)
        reg.delegate = self
        reg.desiredPushTypes = [.voIP]
        registry = reg
    }

    public func reportIncoming(callId: String, handle: String, callerName: String) throws {
        let uuid = uuidFor(callId: callId)
        activeUuid = uuid
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: handle)
        update.localizedCallerName = callerName
        update.hasVideo = false
        provider.reportNewIncomingCall(with: uuid, update: update) { error in
            if let error = error {
                print("[PhoneHomeCallKit] report incoming failed: \(error)")
            }
        }
    }

    public func startOutgoing(callId: String, handle: String) {
        let uuid = uuidFor(callId: callId)
        activeUuid = uuid
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
        guard let uuid else { return }
        let action = CXEndCallAction(call: uuid)
        controller.request(CXTransaction(action: action)) { _ in }
        activeUuid = nil
    }

    public func setConnected(callId: String?) {
        let uuid = callId.flatMap { self.uuidFor(callId: $0) } ?? activeUuid
        guard let uuid else { return }
        provider.reportOutgoingCall(with: uuid, connectedAt: Date())
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

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .defaultToSpeaker])
            try session.setActive(true)
        } catch {
            print("[PhoneHomeCallKit] audio session: \(error)")
        }
    }

    // MARK: - CXProviderDelegate

    public func providerDidReset(_ provider: CXProvider) {
        activeUuid = nil
        plugin?.notifyListeners("callEnded", data: ["reason": "reset"])
    }

    public func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        configureAudioSession()
        action.fulfill()
        plugin?.notifyListeners("callAnswered", data: [
            "callUUID": action.callUUID.uuidString
        ])
    }

    public func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        action.fulfill()
        activeUuid = nil
        plugin?.notifyListeners("callEnded", data: [
            "callUUID": action.callUUID.uuidString
        ])
    }

    public func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        configureAudioSession()
        action.fulfill()
        provider.reportOutgoingCall(with: action.callUUID, startedConnectingAt: Date())
        plugin?.notifyListeners("callStarted", data: [
            "callUUID": action.callUUID.uuidString,
            "handle": action.handle.value
        ])
    }

    public func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        plugin?.notifyListeners("audioActivated", data: [:])
    }

    public func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        plugin?.notifyListeners("audioDeactivated", data: [:])
    }

    // MARK: - PKPushRegistryDelegate

    public func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        guard type == .voIP else { return }
        let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        plugin?.notifyListeners("voipToken", data: ["token": token])
    }

    public func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        plugin?.notifyListeners("voipTokenInvalid", data: [:])
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
        do {
            try reportIncoming(callId: callId, handle: handle, callerName: callerName)
        } catch {
            print("[PhoneHomeCallKit] push report failed: \(error)")
        }
        plugin?.notifyListeners("incomingPush", data: [
            "callId": callId,
            "handle": handle,
            "callerName": callerName,
            "payload": root
        ])
        completion()
    }
}
