import assert from "node:assert/strict";
import test from "node:test";
import {
  TerminalSignalBuffer,
  type TerminalHangupSignal,
} from "./terminalSignalBuffer.js";
import {
  CALL_LIFECYCLE_CONTRACT_VERSION,
  CallTerminalOutcome,
  CallTerminalReason,
} from "./callLifecycle.js";

function hangup(callId: string, fromLineId = "line_a", toLineId = "line_b"): TerminalHangupSignal {
  return {
    type: "call.hangup",
    contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION,
    callId,
    fromLineId,
    toLineId,
    reason: "bridge-hangup",
    terminalOutcome: CallTerminalOutcome.Completed,
    terminalReason: CallTerminalReason.BridgeHangup,
  };
}

test("disconnect buffers terminal hangup and reconnect flushes it once", () => {
  const buffer = new TerminalSignalBuffer();
  const raw = {
    ...hangup("call_1"),
    sdp: "must-not-be-retained",
    content: "must-not-be-retained",
  } as TerminalHangupSignal;

  assert.equal(buffer.buffer("line_b", raw), true);
  const delivered: TerminalHangupSignal[] = [];
  assert.equal(buffer.flush("line_b", (signal) => delivered.push(signal)), 1);
  assert.deepEqual(delivered, [hangup("call_1")]);
  assert.equal(buffer.flush("line_b", () => assert.fail("already flushed")), 0);
});

test("terminal buffer expires old signals and keeps newest per-line entries", () => {
  let now = 1_000;
  const buffer = new TerminalSignalBuffer({
    ttlMs: 100,
    maxPerLine: 2,
    now: () => now,
  });

  buffer.buffer("line_b", hangup("call_1"));
  buffer.buffer("line_b", hangup("call_2"));
  buffer.buffer("line_b", hangup("call_3"));
  assert.equal(buffer.sizeForLine("line_b"), 2);

  const bounded: string[] = [];
  assert.equal(buffer.flush("line_b", (signal) => bounded.push(signal.callId)), 2);
  assert.deepEqual(bounded, ["call_2", "call_3"]);

  buffer.buffer("line_b", hangup("call_4"));
  now += 101;
  assert.equal(buffer.flush("line_b", () => assert.fail("expired signal delivered")), 0);
  assert.equal(buffer.sizeForLine("line_b"), 0);
});

test("terminal buffer bounds line cardinality and rejects mismatched targets", () => {
  const buffer = new TerminalSignalBuffer({ maxLines: 2 });
  assert.equal(buffer.buffer("line_a", hangup("call_a", "line_a", "peer_a")), true);
  assert.equal(buffer.buffer("line_b", hangup("call_b", "line_b", "peer_b")), true);
  assert.equal(buffer.buffer("line_c", hangup("call_c", "line_c", "peer_c")), true);

  assert.equal(buffer.flush("line_a", () => assert.fail("oldest line should be evicted")), 0);
  assert.equal(buffer.sizeForLine("line_b"), 1);
  assert.equal(buffer.sizeForLine("line_c"), 1);
  assert.equal(buffer.buffer("unrelated", hangup("call_bad")), false);
});

test("duplicate hangups are deduplicated without extending expiry", () => {
  let now = 5_000;
  const buffer = new TerminalSignalBuffer({ ttlMs: 50, now: () => now });
  assert.equal(buffer.buffer("line_b", hangup("call_1")), true);
  now += 25;
  assert.equal(buffer.buffer("line_b", hangup("call_1")), false);
  assert.equal(buffer.sizeForLine("line_b"), 1);

  now += 26;
  assert.equal(buffer.flush("line_b", () => assert.fail("duplicate extended expiry")), 0);
});
