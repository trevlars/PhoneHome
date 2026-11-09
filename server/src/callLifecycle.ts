export const CALL_LIFECYCLE_CONTRACT_VERSION = 1 as const;

export const CallPhase = {
  Created: "created",
  Routing: "routing",
  Ringing: "ringing",
  Accepted: "accepted",
  Negotiating: "negotiating",
  Active: "active",
  Held: "held",
  Terminating: "terminating",
  Terminal: "terminal",
} as const;
export type CallPhase = (typeof CallPhase)[keyof typeof CallPhase];

export const CallTerminalOutcome = {
  Completed: "completed",
  Cancelled: "cancelled",
  Missed: "missed",
  Failed: "failed",
  Rejected: "rejected",
  Offline: "offline",
  Blocked: "blocked",
} as const;
export type CallTerminalOutcome =
  (typeof CallTerminalOutcome)[keyof typeof CallTerminalOutcome];

export const CallTerminalReason = {
  LocalHangup: "local-hangup",
  PeerHangup: "peer-hangup",
  NoAnswer: "no-answer",
  Declined: "declined",
  PeerDisconnected: "peer-disconnected",
  MaxDuration: "max-duration",
  BridgeHangup: "bridge-hangup",
  MediaFailure: "media-failure",
  Offline: "offline",
  Rejected: "rejected",
  ServerRestart: "server-restart",
  Unknown: "unknown",
} as const;
export type CallTerminalReason =
  (typeof CallTerminalReason)[keyof typeof CallTerminalReason];

export const CallLifecycleEventType = {
  RouteStarted: "route-started",
  Ringing: "ringing",
  UserAccepted: "user-accepted",
  SdpAnswered: "sdp-answered",
  Ice: "ice",
  FxsPickedUp: "fxs-picked-up",
  MediaActive: "media-active",
  HoldChanged: "hold-changed",
  Hangup: "hangup",
  SystemTerminated: "system-terminated",
  Finalized: "finalized",
} as const;
export type CallLifecycleEventType =
  (typeof CallLifecycleEventType)[keyof typeof CallLifecycleEventType];

export const CallTransitionRejection = {
  UnsupportedVersion: "unsupported-version",
  WrongCall: "wrong-call",
  WrongParticipants: "wrong-participants",
  WrongActor: "wrong-actor",
  WrongPhase: "wrong-phase",
  Terminal: "terminal",
  InvalidEvent: "invalid-event",
} as const;
export type CallTransitionRejection =
  (typeof CallTransitionRejection)[keyof typeof CallTransitionRejection];

export type CallTerminalResult = {
  outcome: CallTerminalOutcome;
  reason: CallTerminalReason;
  /** Bounded legacy wire reason, retained only for backward-compatible UI copy. */
  legacyReason?: string;
  byLineId: string | null;
};

export type CallLifecycleState = {
  contractVersion: typeof CALL_LIFECYCLE_CONTRACT_VERSION;
  callId: string;
  fromLineId: string;
  toLineId: string;
  phase: CallPhase;
  acceptedByLineId: string | null;
  sdpAnsweredByLineId: string | null;
  sdpAnswerEarly: boolean;
  fxsPickedUp: boolean;
  mediaActive: boolean;
  heldByLineId: string | null;
  resumePhase: typeof CallPhase.Negotiating | typeof CallPhase.Active | null;
  terminal: CallTerminalResult | null;
  revision: number;
  seenEventKeys: readonly string[];
};

export type CallLifecycleEvent = {
  /** Missing/zero means the legacy v0 boundary shape; v1 is canonical. */
  contractVersion?: number;
  type: CallLifecycleEventType;
  callId: string;
  fromLineId: string;
  toLineId: string;
  actorLineId: string;
  idempotencyKey?: string;
  early?: boolean;
  onHold?: boolean;
  byLineId?: string;
  reason?: unknown;
};

export type CallTransitionResult =
  | {
      accepted: true;
      duplicate: boolean;
      state: CallLifecycleState;
    }
  | {
      accepted: false;
      duplicate: false;
      state: CallLifecycleState;
      rejection: CallTransitionRejection;
    };

const MAX_EVENT_KEYS = 128;
const MAX_LEGACY_REASON_LENGTH = 80;

function boundedText(value: unknown, maxLength = 128): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function changed(
  state: CallLifecycleState,
  patch: Partial<CallLifecycleState>,
  eventKey?: string
): CallTransitionResult {
  const seenEventKeys = eventKey
    ? [...state.seenEventKeys, eventKey].slice(-MAX_EVENT_KEYS)
    : state.seenEventKeys;
  return {
    accepted: true,
    duplicate: false,
    state: {
      ...state,
      ...patch,
      revision: state.revision + 1,
      seenEventKeys,
    },
  };
}

function duplicate(state: CallLifecycleState): CallTransitionResult {
  return { accepted: true, duplicate: true, state };
}

function rejected(
  state: CallLifecycleState,
  rejection: CallTransitionRejection
): CallTransitionResult {
  return { accepted: false, duplicate: false, state, rejection };
}

function isParticipant(state: CallLifecycleState, lineId: string): boolean {
  return lineId === state.fromLineId || lineId === state.toLineId;
}

function terminalReasonFromKnownText(text: string): CallTerminalReason | null {
  switch (text) {
    case CallTerminalReason.LocalHangup:
    case "hangup":
    case "ended":
    case "softphone-hangup":
      return CallTerminalReason.LocalHangup;
    case CallTerminalReason.PeerHangup:
    case "remote-hangup":
      return CallTerminalReason.PeerHangup;
    case CallTerminalReason.NoAnswer:
      return CallTerminalReason.NoAnswer;
    case CallTerminalReason.Declined:
      return CallTerminalReason.Declined;
    case CallTerminalReason.PeerDisconnected:
      return CallTerminalReason.PeerDisconnected;
    case CallTerminalReason.MaxDuration:
      return CallTerminalReason.MaxDuration;
    case CallTerminalReason.BridgeHangup:
      return CallTerminalReason.BridgeHangup;
    case CallTerminalReason.MediaFailure:
    case "ata-failed":
      return CallTerminalReason.MediaFailure;
    case CallTerminalReason.Offline:
      return CallTerminalReason.Offline;
    case CallTerminalReason.Rejected:
      return CallTerminalReason.Rejected;
    case CallTerminalReason.ServerRestart:
      return CallTerminalReason.ServerRestart;
    case CallTerminalReason.Unknown:
      return CallTerminalReason.Unknown;
    default:
      return null;
  }
}

export function normalizeTerminalReason(value: unknown): {
  reason: CallTerminalReason;
  legacyReason?: string;
} {
  const legacyReason = boundedText(value, MAX_LEGACY_REASON_LENGTH);
  if (!legacyReason) return { reason: CallTerminalReason.LocalHangup };
  const reason = terminalReasonFromKnownText(legacyReason);
  if (reason) return { reason };
  return { reason: CallTerminalReason.Unknown, legacyReason };
}

export function canonicalOutcomeForTerminal(
  state: CallLifecycleState,
  reason: CallTerminalReason
): CallTerminalOutcome {
  if (reason === CallTerminalReason.NoAnswer || reason === CallTerminalReason.Declined) {
    return CallTerminalOutcome.Missed;
  }
  if (reason === CallTerminalReason.Offline) return CallTerminalOutcome.Offline;
  if (reason === CallTerminalReason.Rejected) return CallTerminalOutcome.Rejected;
  if (
    reason === CallTerminalReason.MediaFailure ||
    reason === CallTerminalReason.ServerRestart ||
    reason === CallTerminalReason.Unknown
  ) {
    return state.mediaActive ||
      state.fxsPickedUp ||
      (Boolean(state.sdpAnsweredByLineId) && !state.sdpAnswerEarly)
      ? CallTerminalOutcome.Completed
      : CallTerminalOutcome.Failed;
  }
  return state.mediaActive ||
    state.fxsPickedUp ||
    (Boolean(state.sdpAnsweredByLineId) && !state.sdpAnswerEarly)
    ? CallTerminalOutcome.Completed
    : CallTerminalOutcome.Cancelled;
}

export function createCallLifecycle(input: {
  callId: string;
  fromLineId: string;
  toLineId: string;
}): CallLifecycleState {
  const callId = boundedText(input.callId);
  const fromLineId = boundedText(input.fromLineId);
  const toLineId = boundedText(input.toLineId);
  if (!callId || !fromLineId || !toLineId || fromLineId === toLineId) {
    throw new Error("call lifecycle requires a call id and two distinct participants");
  }
  return {
    contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION,
    callId,
    fromLineId,
    toLineId,
    phase: CallPhase.Created,
    acceptedByLineId: null,
    sdpAnsweredByLineId: null,
    sdpAnswerEarly: false,
    fxsPickedUp: false,
    mediaActive: false,
    heldByLineId: null,
    resumePhase: null,
    terminal: null,
    revision: 0,
    seenEventKeys: [],
  };
}

function legacyTerminalOutcome(outcome: string): CallTerminalOutcome {
  switch (outcome) {
    case "completed":
      return CallTerminalOutcome.Completed;
    case "cancelled":
      return CallTerminalOutcome.Cancelled;
    case "missed":
      return CallTerminalOutcome.Missed;
    case "offline":
      return CallTerminalOutcome.Offline;
    case "blocked":
      return CallTerminalOutcome.Blocked;
    default:
      return CallTerminalOutcome.Failed;
  }
}

/** Reconstruct the minimum safe state after restart without inventing media facts. */
export function restoreLegacyCallLifecycle(input: {
  callId: string;
  fromLineId: string;
  toLineId: string;
  outcome: string;
  endedAt?: string | null;
}): CallLifecycleState {
  const state = createCallLifecycle(input);
  const outcome = boundedText(input.outcome, 32);
  if (input.endedAt || (outcome !== "ringing" && outcome !== "answered")) {
    return {
      ...state,
      phase: CallPhase.Terminal,
      terminal: {
        outcome: legacyTerminalOutcome(outcome),
        reason:
          outcome === "missed"
            ? CallTerminalReason.NoAnswer
            : outcome === "offline"
              ? CallTerminalReason.Offline
              : CallTerminalReason.Unknown,
        byLineId: null,
      },
      revision: 1,
    };
  }
  if (outcome === "answered") {
    return {
      ...state,
      phase: CallPhase.Active,
      acceptedByLineId: state.toLineId,
      sdpAnsweredByLineId: state.toLineId,
      revision: 1,
    };
  }
  return { ...state, phase: CallPhase.Ringing, revision: 1 };
}

export function transitionCallLifecycle(
  state: CallLifecycleState,
  event: CallLifecycleEvent
): CallTransitionResult {
  const eventVersion = Number(event.contractVersion || 0);
  if (
    !Number.isInteger(eventVersion) ||
    eventVersion < 0 ||
    eventVersion > CALL_LIFECYCLE_CONTRACT_VERSION
  ) {
    return rejected(state, CallTransitionRejection.UnsupportedVersion);
  }
  if (boundedText(event.callId) !== state.callId) {
    return rejected(state, CallTransitionRejection.WrongCall);
  }
  if (
    boundedText(event.fromLineId) !== state.fromLineId ||
    boundedText(event.toLineId) !== state.toLineId
  ) {
    return rejected(state, CallTransitionRejection.WrongParticipants);
  }

  const actorLineId = boundedText(event.actorLineId);
  const systemEvent =
    event.type === CallLifecycleEventType.RouteStarted ||
    event.type === CallLifecycleEventType.Ringing ||
    event.type === CallLifecycleEventType.SystemTerminated ||
    event.type === CallLifecycleEventType.Finalized;
  if (systemEvent) {
    if (actorLineId !== "server") {
      return rejected(state, CallTransitionRejection.WrongActor);
    }
  } else if (!isParticipant(state, actorLineId)) {
    return rejected(state, CallTransitionRejection.WrongActor);
  }

  if (event.type === CallLifecycleEventType.Finalized) {
    if (state.phase === CallPhase.Terminal) return duplicate(state);
    if (state.phase !== CallPhase.Terminating || !state.terminal) {
      return rejected(state, CallTransitionRejection.WrongPhase);
    }
    return changed(state, { phase: CallPhase.Terminal });
  }

  if (state.terminal) {
    if (
      event.type === CallLifecycleEventType.Hangup ||
      event.type === CallLifecycleEventType.SystemTerminated
    ) {
      return duplicate(state);
    }
    return rejected(state, CallTransitionRejection.Terminal);
  }

  const eventKey = boundedText(event.idempotencyKey, 160);
  if (eventKey && state.seenEventKeys.includes(eventKey)) return duplicate(state);

  switch (event.type) {
    case CallLifecycleEventType.RouteStarted:
      if (state.phase === CallPhase.Created) {
        return changed(state, { phase: CallPhase.Routing }, eventKey);
      }
      return duplicate(state);

    case CallLifecycleEventType.Ringing:
      if (state.phase === CallPhase.Created || state.phase === CallPhase.Routing) {
        return changed(state, { phase: CallPhase.Ringing }, eventKey);
      }
      return duplicate(state);

    case CallLifecycleEventType.UserAccepted:
      if (actorLineId !== state.toLineId) {
        return rejected(state, CallTransitionRejection.WrongActor);
      }
      if (
        state.phase === CallPhase.Accepted ||
        state.phase === CallPhase.Negotiating ||
        state.phase === CallPhase.Active ||
        state.phase === CallPhase.Held
      ) {
        return duplicate(state);
      }
      if (state.phase !== CallPhase.Ringing) {
        return rejected(state, CallTransitionRejection.WrongPhase);
      }
      return changed(
        state,
        {
          phase: CallPhase.Accepted,
          acceptedByLineId: actorLineId,
        },
        eventKey
      );

    case CallLifecycleEventType.SdpAnswered:
      if (actorLineId !== state.toLineId) {
        return rejected(state, CallTransitionRejection.WrongActor);
      }
      if (
        state.phase === CallPhase.Negotiating ||
        state.phase === CallPhase.Active ||
        state.phase === CallPhase.Held
      ) {
        return state.sdpAnsweredByLineId === actorLineId
          ? duplicate(state)
          : rejected(state, CallTransitionRejection.WrongPhase);
      }
      if (state.phase !== CallPhase.Ringing && state.phase !== CallPhase.Accepted) {
        return rejected(state, CallTransitionRejection.WrongPhase);
      }
      return changed(
        state,
        {
          phase: CallPhase.Negotiating,
          acceptedByLineId: state.acceptedByLineId || actorLineId,
          sdpAnsweredByLineId: actorLineId,
          sdpAnswerEarly: Boolean(event.early),
        },
        eventKey
      );

    case CallLifecycleEventType.Ice:
      if (
        state.phase !== CallPhase.Routing &&
        state.phase !== CallPhase.Ringing &&
        state.phase !== CallPhase.Accepted &&
        state.phase !== CallPhase.Negotiating &&
        state.phase !== CallPhase.Active &&
        state.phase !== CallPhase.Held
      ) {
        return rejected(state, CallTransitionRejection.WrongPhase);
      }
      return changed(state, {}, eventKey || undefined);

    case CallLifecycleEventType.FxsPickedUp:
      if (actorLineId !== state.toLineId) {
        return rejected(state, CallTransitionRejection.WrongActor);
      }
      if (state.fxsPickedUp) return duplicate(state);
      const activeAfterEarlyMedia =
        state.phase === CallPhase.Active &&
        state.sdpAnswerEarly &&
        !state.fxsPickedUp;
      if (
        state.phase !== CallPhase.Ringing &&
        state.phase !== CallPhase.Accepted &&
        state.phase !== CallPhase.Negotiating &&
        !activeAfterEarlyMedia
      ) {
        return rejected(state, CallTransitionRejection.WrongPhase);
      }
      return changed(
        state,
        {
          phase: CallPhase.Active,
          acceptedByLineId: state.acceptedByLineId || actorLineId,
          fxsPickedUp: true,
          mediaActive: true,
        },
        eventKey
      );

    case CallLifecycleEventType.MediaActive:
      if (
        state.phase !== CallPhase.Negotiating &&
        state.phase !== CallPhase.Active &&
        state.phase !== CallPhase.Held
      ) {
        return rejected(state, CallTransitionRejection.WrongPhase);
      }
      if (state.mediaActive) return duplicate(state);
      const waitingForFxsPickup =
        state.phase === CallPhase.Negotiating &&
        state.sdpAnswerEarly &&
        !state.fxsPickedUp;
      return changed(
        state,
        {
          phase:
            state.phase === CallPhase.Held
              ? CallPhase.Held
              : waitingForFxsPickup
                ? CallPhase.Negotiating
                : CallPhase.Active,
          mediaActive: true,
        },
        eventKey
      );

    case CallLifecycleEventType.HoldChanged: {
      const byLineId = boundedText(event.byLineId || actorLineId);
      if (byLineId !== actorLineId || !isParticipant(state, byLineId)) {
        return rejected(state, CallTransitionRejection.WrongActor);
      }
      if (event.onHold) {
        if (state.phase === CallPhase.Held) {
          return state.heldByLineId === byLineId
            ? duplicate(state)
            : rejected(state, CallTransitionRejection.WrongPhase);
        }
        if (state.phase !== CallPhase.Negotiating && state.phase !== CallPhase.Active) {
          return rejected(state, CallTransitionRejection.WrongPhase);
        }
        return changed(
          state,
          {
            phase: CallPhase.Held,
            heldByLineId: byLineId,
            resumePhase: state.phase,
          },
          eventKey
        );
      }
      if (state.phase !== CallPhase.Held) {
        return state.phase === CallPhase.Negotiating || state.phase === CallPhase.Active
          ? duplicate(state)
          : rejected(state, CallTransitionRejection.WrongPhase);
      }
      return changed(
        state,
        {
          phase: state.resumePhase || CallPhase.Active,
          heldByLineId: null,
          resumePhase: null,
        },
        eventKey
      );
    }

    case CallLifecycleEventType.Hangup:
    case CallLifecycleEventType.SystemTerminated: {
      const normalized = normalizeTerminalReason(event.reason);
      const terminal: CallTerminalResult = {
        outcome: canonicalOutcomeForTerminal(state, normalized.reason),
        reason: normalized.reason,
        ...(normalized.legacyReason ? { legacyReason: normalized.legacyReason } : {}),
        byLineId: actorLineId === "server" ? null : actorLineId,
      };
      return changed(
        state,
        {
          phase: CallPhase.Terminating,
          heldByLineId: null,
          resumePhase: null,
          terminal,
        },
        eventKey
      );
    }
  }
}

export function callEnvelopeMatches(
  state: CallLifecycleState,
  input: {
    callId: string;
    fromLineId: string;
    toLineId: string;
    targetLineId?: string;
  }
): boolean {
  if (state.phase === CallPhase.Terminating || state.phase === CallPhase.Terminal) return false;
  if (
    boundedText(input.callId) !== state.callId ||
    boundedText(input.fromLineId) !== state.fromLineId ||
    boundedText(input.toLineId) !== state.toLineId
  ) {
    return false;
  }
  return !input.targetLineId || isParticipant(state, boundedText(input.targetLineId));
}
