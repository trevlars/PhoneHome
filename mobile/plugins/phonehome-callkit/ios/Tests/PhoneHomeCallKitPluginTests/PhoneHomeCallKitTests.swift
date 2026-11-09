import XCTest
@testable import PhoneHomeCallKitPlugin

class PhoneHomeCallKitTests: XCTestCase {
    func testNativeHoldRolesRemainIndependent() {
        let peer = PhoneHomeNativePeer()

        peer.setLocalHeld(true)
        XCTAssertTrue(peer.isLocallyHeld)
        XCTAssertFalse(peer.isRemotelyHeld)

        peer.setRemoteHeld(true)
        XCTAssertTrue(peer.isLocallyHeld)
        XCTAssertTrue(peer.isRemotelyHeld)

        peer.setLocalHeld(false)
        XCTAssertFalse(peer.isLocallyHeld)
        XCTAssertTrue(peer.isRemotelyHeld)

        peer.setRemoteHeld(false)
        XCTAssertFalse(peer.isLocallyHeld)
        XCTAssertFalse(peer.isRemotelyHeld)
    }

    func testEndingAnsweredLocalHeldCallIsImmediateAndIdempotent() {
        let uuid = UUID()
        let state = PhoneHomeCallEndState()
        let snapshot = PhoneHomeCallEndSnapshot(
            callUUID: uuid,
            callId: "answered-local-held",
            fromLineId: "line-parent",
            toLineId: "line-child",
            answered: true,
            outgoing: false,
            localHeld: true,
            remoteHeld: false
        )

        let first = state.begin(snapshot)
        XCTAssertTrue(first.isFirst)
        XCTAssertTrue(first.snapshot.localHeld)
        XCTAssertNil(first.snapshot.hangupReason)
        XCTAssertTrue(state.isEnding(uuid))

        let duplicate = state.begin(snapshot)
        XCTAssertFalse(duplicate.isFirst)
        XCTAssertEqual(duplicate.snapshot, first.snapshot)
    }

    func testEndingAnsweredRemoteHeldCallDoesNotBecomeNoAnswer() {
        let state = PhoneHomeCallEndState()
        let snapshot = PhoneHomeCallEndSnapshot(
            callUUID: UUID(),
            callId: "answered-remote-held",
            fromLineId: "line-child",
            toLineId: "line-parent",
            answered: true,
            outgoing: false,
            localHeld: false,
            remoteHeld: true
        )

        let result = state.begin(snapshot)
        XCTAssertTrue(result.isFirst)
        XCTAssertTrue(result.snapshot.remoteHeld)
        XCTAssertNil(result.snapshot.hangupReason)
    }

    func testDeclinedRingingInboundUsesNoAnswer() {
        let snapshot = PhoneHomeCallEndSnapshot(
            callUUID: UUID(),
            callId: "ringing-decline",
            fromLineId: "line-child",
            toLineId: "line-parent",
            answered: false,
            outgoing: false,
            localHeld: false,
            remoteHeld: false
        )

        XCTAssertEqual(snapshot.hangupReason, "no-answer")
    }

    func testNativePeerCloseClearsBothHoldRoles() {
        let peer = PhoneHomeNativePeer()
        peer.setLocalHeld(true)
        peer.setRemoteHeld(true)

        peer.close()

        XCTAssertFalse(peer.isLocallyHeld)
        XCTAssertFalse(peer.isRemotelyHeld)
        XCTAssertFalse(peer.hasActivePeer)
    }

    func testNativeOfferBeforeDidActivateLeavesAudioDormant() {
        let state = PhoneHomeNativeAudioActivationState()

        XCTAssertFalse(state.audioUnitArmed)
        XCTAssertFalse(state.permissionRequestInFlight)
        XCTAssertEqual(state.permissionCompleted(), .none)
    }

    func testNativeOfferAfterDidActivateArmsExactlyOnce() {
        let state = PhoneHomeNativeAudioActivationState()

        XCTAssertEqual(state.requestEnable(), .requestPermission)
        XCTAssertEqual(state.permissionCompleted(), .activateAndEnable)
        XCTAssertTrue(state.audioUnitArmed)
        XCTAssertEqual(state.requestEnable(), .enableOnly)
        XCTAssertEqual(state.permissionCompleted(), .none)
    }

    func testDuplicateDidActivateAndPermissionCallbacksAreIdempotent() {
        let state = PhoneHomeNativeAudioActivationState()

        XCTAssertEqual(state.requestEnable(), .requestPermission)
        XCTAssertEqual(state.requestEnable(), .none)
        XCTAssertTrue(state.permissionRequestInFlight)
        XCTAssertEqual(state.permissionCompleted(), .activateAndEnable)
        XCTAssertEqual(state.permissionCompleted(), .none)
        XCTAssertEqual(state.requestEnable(), .enableOnly)
    }

    func testDidDeactivateInvalidatesPendingPermissionCallback() {
        let state = PhoneHomeNativeAudioActivationState()

        XCTAssertEqual(state.requestEnable(), .requestPermission)
        XCTAssertEqual(state.deactivate(), .disableOnly)
        XCTAssertEqual(state.permissionCompleted(), .none)
        XCTAssertFalse(state.audioUnitArmed)
    }

    func testNativeClosedEndsCurrentPeerImmediately() {
        let state = PhoneHomeNativeTerminationState()
        let peer = PhoneHomeNativePeerGeneration(callId: "closed", generation: 1)
        state.begin(peer)

        XCTAssertEqual(
            state.connectionChanged(peer: peer, ice: "closed", connection: "closed"),
            .endRemote
        )
    }

    func testNativeFailedEndsCurrentPeerImmediately() {
        let state = PhoneHomeNativeTerminationState()
        let peer = PhoneHomeNativePeerGeneration(callId: "failed", generation: 2)
        state.begin(peer)

        XCTAssertEqual(
            state.connectionChanged(peer: peer, ice: "connected", connection: "failed"),
            .endRemote
        )
    }

    func testNativeDisconnectedRecoveryCancelsGrace() {
        let state = PhoneHomeNativeTerminationState()
        let peer = PhoneHomeNativePeerGeneration(callId: "recovered", generation: 3)
        state.begin(peer)

        XCTAssertEqual(
            state.connectionChanged(peer: peer, ice: "disconnected", connection: "disconnected"),
            .scheduleDisconnectGrace
        )
        XCTAssertEqual(
            state.connectionChanged(peer: peer, ice: "completed", connection: "connected"),
            .cancelDisconnectGrace
        )
        XCTAssertEqual(state.disconnectGraceExpired(peer: peer), .none)
    }

    func testNativeDisconnectedTimeoutEndsCurrentPeer() {
        let state = PhoneHomeNativeTerminationState()
        let peer = PhoneHomeNativePeerGeneration(callId: "timeout", generation: 4)
        state.begin(peer)

        XCTAssertEqual(
            state.connectionChanged(peer: peer, ice: "disconnected", connection: "connected"),
            .scheduleDisconnectGrace
        )
        XCTAssertEqual(state.disconnectGraceExpired(peer: peer), .endRemote)
    }

    func testStaleNativePeerGenerationCannotEndNewCall() {
        let state = PhoneHomeNativeTerminationState()
        let stale = PhoneHomeNativePeerGeneration(callId: "same-call", generation: 5)
        let current = PhoneHomeNativePeerGeneration(callId: "same-call", generation: 6)
        state.begin(stale)
        state.begin(current)

        XCTAssertEqual(
            state.connectionChanged(peer: stale, ice: "closed", connection: "closed"),
            .none
        )
        XCTAssertEqual(state.disconnectGraceExpired(peer: stale), .none)
    }

    func testDuplicateNativeRemoteEndIsIgnored() {
        let state = PhoneHomeNativeTerminationState()
        let peer = PhoneHomeNativePeerGeneration(callId: "duplicate", generation: 7)
        state.begin(peer)

        XCTAssertEqual(
            state.connectionChanged(peer: peer, ice: "failed", connection: "failed"),
            .endRemote
        )
        XCTAssertEqual(
            state.connectionChanged(peer: peer, ice: "closed", connection: "closed"),
            .none
        )
        XCTAssertEqual(state.disconnectGraceExpired(peer: peer), .none)
    }
}
