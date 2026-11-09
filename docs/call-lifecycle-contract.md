# Call lifecycle contract

## Version 1 scope

The hub owns a canonical call ID and ordered participants (`fromLineId`,
`toLineId`) for every 1:1 call, including ATA→ATA calls that stay in ARI.
Version 1 adds `contractVersion: 1` without removing any existing message
fields, so older clients can continue to read forwarded messages.

The canonical phases are:

`created → routing → ringing → accepted → negotiating → active → held → terminating → terminal`

Phases do not collapse distinct facts:

- `acceptedByLineId` records a user/CallKit acceptance.
- `sdpAnsweredByLineId` and `sdpAnswerEarly` record SDP answer state.
- `fxsPickedUp` records analog handset pickup.
- `mediaActive` records confirmed media connectivity.
- `heldByLineId` records current hold ownership.

`call.answer`, `call.accepted`, `call.ice`, `call.hold`, and `call.hangup`
are validated against the authenticated socket actor, canonical call ID,
ordered participants, and current phase before relay or mutation. Duplicate
events are no-ops. The first terminal result wins.

Known v0 clients sometimes sent sender-relative (reversed) participants for
ICE, or incomplete participants for hold/hangup. The server adapts only these
known unversioned shapes after authenticating the actor and loading the
canonical call row. Version 1 messages are strict.

## Analog-to-analog lifecycle

Before originating the second ATA leg, bridged requests a canonical session
from `/api/bridge/calls/begin`. It reports connect, hold, cancel, and hangup
events through `/api/bridge/calls/:callId/event`. These calls therefore use the
same activity log, busy detection, usage accounting, idempotent transitions,
and first-terminal-wins behavior as WebSocket calls.

Canonical state is persisted in `call_lifecycle` after each accepted
transition. After a process restart the hub validates and reloads that state,
falling back conservatively to legacy `call_logs` only when no valid lifecycle
snapshot exists.
