import assert from "node:assert/strict";
import test from "node:test";
import {
  ataPresenceRegistered,
  deriveAtaStatus,
  parseBridgeSipStatus,
  shouldAttemptFxsInbound,
  unknownSipStatus,
} from "./ataStatus.js";

const online = {
  ok: true,
  registered: true,
  callable: true,
  state: "online",
  confidence: "high" as const,
  method: "ami-contacts",
  contacts: 1,
};

test("a verified registration is the only thing that reads as online", () => {
  assert.deepEqual(deriveAtaStatus(online), { status: "online", registered: true });
});

test("a completed check with no contact reads as offline", () => {
  assert.deepEqual(
    deriveAtaStatus({
      ...online,
      registered: false,
      callable: false,
      state: "offline",
      contacts: 0,
      reason: "no contact registered",
    }),
    { status: "offline", registered: false }
  );
});

test("bridge unreachable, ARI down, or missing secret never reads as online", () => {
  for (const reason of ["bridge unreachable", "ARI not connected", "BRIDGE_SECRET not configured"]) {
    const derived = deriveAtaStatus(unknownSipStatus(reason));
    assert.deepEqual(derived, { status: "unknown", registered: false }, reason);
  }
});

test("registered=true from a failed check is still unknown", () => {
  // Defence in depth: a bridge that contradicts itself must not show "Working".
  assert.deepEqual(
    deriveAtaStatus({ ...online, ok: false, confidence: "none", method: "ami-contacts" }),
    { status: "unknown", registered: false }
  );
});

test("registered=true with a non-online state is unknown", () => {
  assert.deepEqual(deriveAtaStatus({ ...online, state: "unknown" }), {
    status: "unknown",
    registered: false,
  });
});

test("directory presence only counts a confirmed registration", () => {
  assert.equal(ataPresenceRegistered(online), true);
  assert.equal(ataPresenceRegistered({ ...online, ok: false }), false);
  assert.equal(ataPresenceRegistered(unknownSipStatus("timeout")), false);
});

test("inbound FXS still attempts on unknown/reload blips", () => {
  assert.equal(shouldAttemptFxsInbound(online), true);
  assert.equal(shouldAttemptFxsInbound(unknownSipStatus("ARI not connected")), true);
  assert.equal(
    shouldAttemptFxsInbound({
      ...online,
      registered: false,
      callable: false,
      state: "unknown",
      confidence: "none",
      method: "ari-endpoint-state",
    }),
    true
  );
  assert.equal(
    shouldAttemptFxsInbound({
      ...online,
      registered: false,
      callable: false,
      state: "offline",
      confidence: "high",
      contacts: 0,
      reason: "no available contact",
    }),
    false
  );
});

test("parseBridgeSipStatus keeps confidence and contact count", () => {
  const parsed = parseBridgeSipStatus(
    {
      ok: true,
      registered: true,
      callable: true,
      state: "online",
      confidence: "high",
      method: "ami-contacts",
      contacts: 1,
    },
    true
  );
  assert.equal(parsed.confidence, "high");
  assert.equal(parsed.contacts, 1);
  assert.equal(deriveAtaStatus(parsed).status, "online");
});

test("parseBridgeSipStatus ignores a body sent with a non-2xx status", () => {
  const parsed = parseBridgeSipStatus(
    { ok: true, registered: true, state: "online", confidence: "high" },
    false
  );
  assert.equal(parsed.ok, false);
  assert.equal(parsed.registered, false);
  assert.equal(deriveAtaStatus(parsed).status, "unknown");
});

test("parseBridgeSipStatus treats an unreadable body as inconclusive", () => {
  for (const body of [null, "nonsense", undefined]) {
    const parsed = parseBridgeSipStatus(body, true);
    assert.equal(parsed.ok, false);
    assert.equal(deriveAtaStatus(parsed).status, "unknown");
  }
});

test("an older bridge without callable/confidence still works, at low confidence", () => {
  const parsed = parseBridgeSipStatus({ ok: true, registered: true, state: "online" }, true);
  assert.equal(parsed.callable, true);
  assert.equal(parsed.confidence, "low");
  assert.equal(deriveAtaStatus(parsed).status, "online");
});

test("a 503 sip-status keeps its reason for the doctor script", () => {
  const parsed = parseBridgeSipStatus(
    { ok: false, registered: false, state: "unknown", reason: "ARI not connected" },
    false
  );
  assert.equal(parsed.reason, "ARI not connected");
  assert.equal(parsed.callable, false);
});
