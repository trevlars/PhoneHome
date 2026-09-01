import Foundation
import Capacitor

/**
 * CallKit + PushKit + alert-APNs bridge for PhoneHome.
 *
 * Default: CallKit OFF — register alert APNs; JS shows in-app softphone UI.
 * When CallKit enabled (`kl_callkit=1` / PhoneHomeCallKitEnabled): VoIP + system Answer UI.
 * JS listens for voipToken / apnsToken / incomingPush / incomingAlert / callAnswered / callEnded.
 */
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
        CAPPluginMethod(name: "getCallState", returnType: CAPPluginReturnPromise),
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
    ]

    override public func load() {
        PhoneHomeCallKit.shared.attach(plugin: self)
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
        PhoneHomeCallKit.shared.reportIncoming(callId: callId, handle: handle, callerName: callerName) { error in
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
        PhoneHomeCallKit.shared.setConnected(callId: call.getString("callId"))
        call.resolve()
    }

    @objc func setSpeaker(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        PhoneHomeCallKit.shared.setSpeaker(enabled)
        call.resolve(["enabled": PhoneHomeCallKit.shared.isSpeakerOn()])
    }

    @objc func getCallState(_ call: CAPPluginCall) {
        call.resolve(PhoneHomeCallKit.shared.callState())
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
}
