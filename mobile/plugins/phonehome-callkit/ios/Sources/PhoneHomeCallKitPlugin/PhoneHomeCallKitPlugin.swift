import Foundation
import Capacitor

/**
 * CallKit + PushKit bridge for PhoneHome.
 * JS listens for voipToken / incomingPush / callAnswered / callEnded.
 */
@objc(PhoneHomeCallKitPlugin)
public class PhoneHomeCallKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PhoneHomeCallKitPlugin"
    public let jsName = "PhoneHomeCallKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "registerVoIP", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reportIncoming", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startOutgoing", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endCall", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setConnected", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        PhoneHomeCallKit.shared.attach(plugin: self)
    }

    @objc func registerVoIP(_ call: CAPPluginCall) {
        PhoneHomeCallKit.shared.startPushKit()
        call.resolve()
    }

    @objc func reportIncoming(_ call: CAPPluginCall) {
        let callId = call.getString("callId") ?? UUID().uuidString
        let handle = call.getString("handle") ?? "PhoneHome"
        let callerName = call.getString("callerName") ?? "Family"
        do {
            try PhoneHomeCallKit.shared.reportIncoming(callId: callId, handle: handle, callerName: callerName)
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
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
}
