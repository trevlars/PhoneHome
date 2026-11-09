import assert from "node:assert/strict";
import test from "node:test";
import {
  CALL_LIFECYCLE_CONTRACT_VERSION,
  CallLifecycleEventType,
  CallPhase,
  CallTerminalOutcome,
  CallTerminalReason,
  CallTransitionRejection,
  callEnvelopeMatches,
  createCallLifecycle,
  normalizeTerminalReason,
  restoreLegacyCallLifecycle,
  transitionCallLifecycle,
  type CallLifecycleEvent,
  type CallLifecycleState,
} from "./callLifecycle.js";

const participants = {
  callId: "call_a",
  fromLineId: "line_caller",
  toLineId: "line_callee",
};

function event(
  type: CallLifecycleEvent["type"],
  patch: Partial<CallLifecycleEvent> = {}
): CallLifecycleEvent {
  return {
    contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION,
    type,
    ...participants,
    actorLineId: "line_callee",
    ...patch,
  };
}

function apply(state: CallLifecycleState, next: CallLifecycleEvent): CallLifecycleState {
  const result = transitionCallLifecycle(state, next);
  assert.equal(result.accepted, true, "expected transition to be accepted");
  return result.state;
}

function ringing(): CallLifecycleState {
  let state = createCallLifecycle(participants);
  state = apply(
    state,
    event(CallLifecycleEventType.RouteStarted, { actorLineId: "server" })
  );
  return apply(state, event(CallLifecycleEventType.Ringing, { actorLineId: "server" }));
}

test("early answer keeps negotiating through media telemetry until FXS pickup", () => {
  let state = ringing();
  state = apply(state, event(CallLifecycleEventType.UserAccepted));
  assert.equal(state.phase, CallPhase.Accepted);
  assert.equal(state.acceptedByLineId, "line_callee");
  assert.equal(state.sdpAnsweredByLineId, null);
  assert.equal(state.fxsPickedUp, false);
  assert.equal(state.mediaActive, false);

  state = apply(
    state,
    event(CallLifecycleEventType.SdpAnswered, {
      early: true,
      idempotencyKey: "answer",
    })
  );
  assert.equal(state.phase, CallPhase.Negotiating);
  assert.equal(state.sdpAnsweredByLineId, "line_callee");
  assert.equal(state.sdpAnswerEarly, true);
  assert.equal(state.fxsPickedUp, false);
  assert.equal(state.mediaActive, false);

  state = apply(
    state,
    event(CallLifecycleEventType.MediaActive, {
      actorLineId: "line_caller",
      idempotencyKey: "media-active:caller",
    })
  );
  assert.equal(state.phase, CallPhase.Negotiating);
  assert.equal(state.mediaActive, true);
  assert.equal(state.fxsPickedUp, false);

  state = apply(state, event(CallLifecycleEventType.FxsPickedUp));
  assert.equal(state.phase, CallPhase.Active);
  assert.equal(state.fxsPickedUp, true);
  assert.equal(state.mediaActive, true);
});

test("duplicate FXS pickup is harmless", () => {
  let state = ringing();
  state = apply(
    state,
    event(CallLifecycleEventType.SdpAnswered, {
      early: true,
      idempotencyKey: "answer",
    })
  );
  state = apply(state, event(CallLifecycleEventType.FxsPickedUp));
  const revision = state.revision;

  const repeated = transitionCallLifecycle(
    state,
    event(CallLifecycleEventType.FxsPickedUp)
  );
  assert.equal(repeated.accepted, true);
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.state.revision, revision);
});

test("non-early media telemetry advances a softphone call to active", () => {
  let state = ringing();
  state = apply(
    state,
    event(CallLifecycleEventType.SdpAnswered, {
      early: false,
      idempotencyKey: "answer",
    })
  );
  state = apply(
    state,
    event(CallLifecycleEventType.MediaActive, {
      actorLineId: "line_caller",
      idempotencyKey: "media-active:caller",
    })
  );

  assert.equal(state.phase, CallPhase.Active);
  assert.equal(state.sdpAnswerEarly, false);
  assert.equal(state.mediaActive, true);
  assert.equal(state.fxsPickedUp, false);
});

test("FXS pickup accepts legacy active ordering only after an early answer", () => {
  let earlyState = ringing();
  earlyState = apply(
    earlyState,
    event(CallLifecycleEventType.SdpAnswered, {
      early: true,
      idempotencyKey: "answer",
    })
  );
  earlyState = {
    ...earlyState,
    phase: CallPhase.Active,
    mediaActive: true,
  };

  const compatible = transitionCallLifecycle(
    earlyState,
    event(CallLifecycleEventType.FxsPickedUp)
  );
  assert.equal(compatible.accepted, true);
  assert.equal(compatible.duplicate, false);
  assert.equal(compatible.state.phase, CallPhase.Active);
  assert.equal(compatible.state.fxsPickedUp, true);

  let directState = ringing();
  directState = apply(
    directState,
    event(CallLifecycleEventType.SdpAnswered, {
      early: false,
      idempotencyKey: "answer",
    })
  );
  directState = apply(
    directState,
    event(CallLifecycleEventType.MediaActive, {
      actorLineId: "line_caller",
      idempotencyKey: "media-active:caller",
    })
  );
  const rejected = transitionCallLifecycle(
    directState,
    event(CallLifecycleEventType.FxsPickedUp)
  );
  assert.equal(rejected.accepted, false);
  if (!rejected.accepted) {
    assert.equal(rejected.rejection, CallTransitionRejection.WrongPhase);
  }
});

test("FXS pickup is rejected before routing reaches a pickup-capable phase", () => {
  let state = createCallLifecycle(participants);
  state = apply(
    state,
    event(CallLifecycleEventType.RouteStarted, { actorLineId: "server" })
  );

  const result = transitionCallLifecycle(
    state,
    event(CallLifecycleEventType.FxsPickedUp)
  );
  assert.equal(result.accepted, false);
  if (!result.accepted) {
    assert.equal(result.rejection, CallTransitionRejection.WrongPhase);
  }
});

test("duplicate and reordered answer, accepted, and ICE are harmless", () => {
  let state = ringing();
  const ice = event(CallLifecycleEventType.Ice, {
    actorLineId: "line_caller",
    idempotencyKey: "ice:abc",
  });
  let result = transitionCallLifecycle(state, ice);
  assert.equal(result.accepted, true);
  assert.equal(result.duplicate, false);
  state = result.state;

  result = transitionCallLifecycle(state, ice);
  assert.equal(result.accepted, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.state.revision, state.revision);

  state = apply(
    state,
    event(CallLifecycleEventType.SdpAnswered, { idempotencyKey: "answer" })
  );
  assert.equal(state.phase, CallPhase.Negotiating);
  assert.equal(state.acceptedByLineId, "line_callee");

  result = transitionCallLifecycle(state, event(CallLifecycleEventType.UserAccepted));
  assert.equal(result.accepted, true);
  assert.equal(result.duplicate, true);

  result = transitionCallLifecycle(
    state,
    event(CallLifecycleEventType.SdpAnswered, { idempotencyKey: "answer" })
  );
  assert.equal(result.accepted, true);
  assert.equal(result.duplicate, true);
});

test("wrong actor, wrong call, reversed participants, and foreign participants are rejected", () => {
  const state = ringing();

  let result = transitionCallLifecycle(
    state,
    event(CallLifecycleEventType.UserAccepted, { actorLineId: "line_caller" })
  );
  assert.equal(result.accepted, false);
  if (!result.accepted) assert.equal(result.rejection, CallTransitionRejection.WrongActor);

  result = transitionCallLifecycle(
    state,
    event(CallLifecycleEventType.Ice, { callId: "call_b", idempotencyKey: "ice:b" })
  );
  assert.equal(result.accepted, false);
  if (!result.accepted) assert.equal(result.rejection, CallTransitionRejection.WrongCall);

  result = transitionCallLifecycle(
    state,
    event(CallLifecycleEventType.Ice, {
      fromLineId: participants.toLineId,
      toLineId: participants.fromLineId,
      idempotencyKey: "ice:reversed",
    })
  );
  assert.equal(result.accepted, false);
  if (!result.accepted) {
    assert.equal(result.rejection, CallTransitionRejection.WrongParticipants);
  }

  result = transitionCallLifecycle(
    state,
    event(CallLifecycleEventType.Hangup, {
      actorLineId: "line_intruder",
      fromLineId: "line_intruder",
    })
  );
  assert.equal(result.accepted, false);
  if (!result.accepted) {
    assert.equal(result.rejection, CallTransitionRejection.WrongParticipants);
  }
});

test("hold is phase checked, idempotent, and either participant may resume", () => {
  let state = ringing();
  let result = transitionCallLifecycle(
    state,
    event(CallLifecycleEventType.HoldChanged, {
      actorLineId: "line_caller",
      byLineId: "line_caller",
      onHold: true,
    })
  );
  assert.equal(result.accepted, false);
  if (!result.accepted) assert.equal(result.rejection, CallTransitionRejection.WrongPhase);

  state = apply(state, event(CallLifecycleEventType.SdpAnswered));
  state = apply(
    state,
    event(CallLifecycleEventType.HoldChanged, {
      actorLineId: "line_caller",
      byLineId: "line_caller",
      onHold: true,
    })
  );
  assert.equal(state.phase, CallPhase.Held);
  assert.equal(state.heldByLineId, "line_caller");

  result = transitionCallLifecycle(
    state,
    event(CallLifecycleEventType.HoldChanged, {
      actorLineId: "line_caller",
      byLineId: "line_caller",
      onHold: true,
    })
  );
  assert.equal(result.accepted, true);
  assert.equal(result.duplicate, true);

  state = apply(
    state,
    event(CallLifecycleEventType.HoldChanged, {
      actorLineId: "line_callee",
      byLineId: "line_callee",
      onHold: false,
    })
  );
  assert.equal(state.phase, CallPhase.Negotiating);
  assert.equal(state.heldByLineId, null);
});

test("first terminal result wins and repeated terminal events are harmless", () => {
  let state = ringing();
  const first = transitionCallLifecycle(
    state,
    event(CallLifecycleEventType.Hangup, { reason: "no-answer" })
  );
  assert.equal(first.accepted, true);
  assert.equal(first.duplicate, false);
  state = first.state;
  assert.equal(state.phase, CallPhase.Terminating);
  assert.equal(state.terminal?.reason, CallTerminalReason.NoAnswer);
  assert.equal(state.terminal?.outcome, CallTerminalOutcome.Missed);

  const repeated = transitionCallLifecycle(
    state,
    event(CallLifecycleEventType.Hangup, {
      actorLineId: "line_caller",
      reason: "max-duration",
    })
  );
  assert.equal(repeated.accepted, true);
  assert.equal(repeated.duplicate, true);
  assert.deepEqual(repeated.state.terminal, state.terminal);

  state = apply(
    state,
    event(CallLifecycleEventType.Finalized, { actorLineId: "server" })
  );
  assert.equal(state.phase, CallPhase.Terminal);

  const lateIce = transitionCallLifecycle(
    state,
    event(CallLifecycleEventType.Ice, {
      actorLineId: "line_caller",
      idempotencyKey: "ice:late",
    })
  );
  assert.equal(lateIce.accepted, false);
  if (!lateIce.accepted) assert.equal(lateIce.rejection, CallTransitionRejection.Terminal);
});

test("delayed call A events cannot mutate call B on the same lines", () => {
  let callA = ringing();
  callA = apply(callA, event(CallLifecycleEventType.Hangup, { reason: "local-hangup" }));
  callA = apply(
    callA,
    event(CallLifecycleEventType.Finalized, { actorLineId: "server" })
  );

  let callB = createCallLifecycle({ ...participants, callId: "call_b" });
  callB = apply(
    callB,
    event(CallLifecycleEventType.RouteStarted, {
      actorLineId: "server",
      callId: "call_b",
    })
  );
  callB = apply(
    callB,
    event(CallLifecycleEventType.Ringing, {
      actorLineId: "server",
      callId: "call_b",
    })
  );
  const revision = callB.revision;

  for (const stale of [
    event(CallLifecycleEventType.Ice, {
      callId: "call_a",
      actorLineId: "line_caller",
      idempotencyKey: "ice:stale-a",
    }),
    event(CallLifecycleEventType.HoldChanged, {
      callId: "call_a",
      actorLineId: "line_caller",
      byLineId: "line_caller",
      onHold: true,
    }),
    event(CallLifecycleEventType.Hangup, {
      callId: "call_a",
      actorLineId: "line_caller",
      reason: "peer-hangup",
    }),
  ]) {
    const result = transitionCallLifecycle(callB, stale);
    assert.equal(result.accepted, false);
    if (!result.accepted) {
      assert.equal(result.rejection, CallTransitionRejection.WrongCall);
    }
    assert.equal(result.state.revision, revision);
  }

  const repeatedA = transitionCallLifecycle(
    callA,
    event(CallLifecycleEventType.Hangup, {
      actorLineId: "line_caller",
      reason: "peer-hangup",
    })
  );
  assert.equal(repeatedA.accepted, true);
  assert.equal(repeatedA.duplicate, true);

  assert.equal(
    callEnvelopeMatches(callA, { ...participants, targetLineId: "line_callee" }),
    false
  );
  assert.equal(
    callEnvelopeMatches(callB, {
      ...participants,
      callId: "call_b",
      targetLineId: "line_callee",
    }),
    true
  );
});

test("legacy rows and free-form reasons normalize without changing wire compatibility", () => {
  const restored = restoreLegacyCallLifecycle({
    ...participants,
    outcome: "answered",
    endedAt: null,
  });
  assert.equal(restored.phase, CallPhase.Active);
  assert.equal(restored.mediaActive, false);

  const unknown = normalizeTerminalReason("legacy ATA exploded in a novel way");
  assert.equal(unknown.reason, CallTerminalReason.Unknown);
  assert.equal(unknown.legacyReason, "legacy ATA exploded in a novel way");
});

test("future contract versions fail closed", () => {
  const result = transitionCallLifecycle(
    ringing(),
    event(CallLifecycleEventType.Ice, {
      contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION + 1,
      idempotencyKey: "ice:future",
    })
  );
  assert.equal(result.accepted, false);
  if (!result.accepted) {
    assert.equal(result.rejection, CallTransitionRejection.UnsupportedVersion);
  }
});
