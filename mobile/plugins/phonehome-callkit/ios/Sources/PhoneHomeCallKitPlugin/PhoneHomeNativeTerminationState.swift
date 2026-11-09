import Foundation

struct PhoneHomeNativePeerGeneration: Equatable {
    let callId: String
    let generation: UInt64
}

enum PhoneHomeNativeTerminationAction: Equatable {
    case none
    case cancelDisconnectGrace
    case scheduleDisconnectGrace
    case endRemote
}

/// Pure state gate for native WebRTC terminal callbacks. CallKit owns the timer
/// and teardown side effects; this type makes generation and duplicate handling
/// deterministic and independently testable.
final class PhoneHomeNativeTerminationState {
    private var current: PhoneHomeNativePeerGeneration?
    private var disconnected: PhoneHomeNativePeerGeneration?
    private var remoteEndDelivered = false

    func begin(_ peer: PhoneHomeNativePeerGeneration) {
        current = peer
        disconnected = nil
        remoteEndDelivered = false
    }

    func connectionChanged(
        peer: PhoneHomeNativePeerGeneration,
        ice: String,
        connection: String
    ) -> PhoneHomeNativeTerminationAction {
        guard current == peer, !remoteEndDelivered else { return .none }

        let states = [ice, connection]
        if states.contains("closed") || states.contains("failed") {
            disconnected = nil
            remoteEndDelivered = true
            return .endRemote
        }
        if states.contains("disconnected") {
            guard disconnected != peer else { return .none }
            disconnected = peer
            return .scheduleDisconnectGrace
        }
        if states.contains("connected") || states.contains("completed") {
            disconnected = nil
            return .cancelDisconnectGrace
        }
        return .none
    }

    func disconnectGraceExpired(
        peer: PhoneHomeNativePeerGeneration
    ) -> PhoneHomeNativeTerminationAction {
        guard current == peer, disconnected == peer, !remoteEndDelivered else {
            return .none
        }
        disconnected = nil
        remoteEndDelivered = true
        return .endRemote
    }

    func clear() {
        current = nil
        disconnected = nil
        remoteEndDelivered = false
    }
}
