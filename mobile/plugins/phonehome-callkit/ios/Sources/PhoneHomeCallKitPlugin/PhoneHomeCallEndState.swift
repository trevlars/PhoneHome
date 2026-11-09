import Foundation

struct PhoneHomeCallEndSnapshot: Equatable {
    let callUUID: UUID
    let callId: String?
    let fromLineId: String?
    let toLineId: String?
    let answered: Bool
    let outgoing: Bool
    let localHeld: Bool
    let remoteHeld: Bool

    var hangupReason: String? {
        !outgoing && !answered ? "no-answer" : nil
    }
}

final class PhoneHomeCallEndState {
    private var snapshots: [UUID: PhoneHomeCallEndSnapshot] = [:]
    private var order: [UUID] = []

    func begin(_ snapshot: PhoneHomeCallEndSnapshot) -> (
        snapshot: PhoneHomeCallEndSnapshot,
        isFirst: Bool
    ) {
        if let existing = snapshots[snapshot.callUUID] {
            return (existing, false)
        }
        snapshots[snapshot.callUUID] = snapshot
        order.append(snapshot.callUUID)
        while order.count > 8 {
            let expired = order.removeFirst()
            snapshots.removeValue(forKey: expired)
        }
        return (snapshot, true)
    }

    func snapshot(for uuid: UUID) -> PhoneHomeCallEndSnapshot? {
        snapshots[uuid]
    }

    func isEnding(_ uuid: UUID) -> Bool {
        snapshots[uuid] != nil
    }

    func prepareForNewCall(_ uuid: UUID) {
        snapshots.removeValue(forKey: uuid)
        order.removeAll { $0 == uuid }
    }

    func removeAll() {
        snapshots.removeAll()
        order.removeAll()
    }
}
