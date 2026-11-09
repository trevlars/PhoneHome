import test from "node:test";
import assert from "node:assert/strict";
import {
  ataLegDelta,
  createAudioEvidence,
  directionalMediaDelta,
  directionalMediaSnapshot,
  gapAdjustedRtpAdvance,
  observePcmActivity,
  rtpQosCounters,
} from "./mediaDiagnostics.mjs";

test("Asterisk rtpqos text parses into per-leg counters", () => {
  const counters = rtpQosCounters(
    "ssrc=1234;themssrc=5678;lp=3;rxjitter=0.001200;rxcount=1502;txjitter=0.000000;txcount=1498;rlp=1;rtt=0.021000"
  );
  assert.equal(counters.rx, 1502);
  assert.equal(counters.tx, 1498);
  assert.equal(counters.lp, 3);
  assert.equal(counters.rlp, 1);
  assert.equal(counters.rxjitter, "0.001200");
  assert.equal(counters.present, true);
  assert.equal(rtpQosCounters("").present, false);
  assert.equal(rtpQosCounters("").rx, 0);
});

test("ATA leg deltas expose the dead direction of a one-way analog call", () => {
  const previous = {
    caller: { rx: 1000, tx: 1000 },
    callee: { rx: 1000, tx: 1000 },
  };
  const current = {
    caller: { rx: 1250, tx: 1250 },
    callee: { rx: 1250, tx: 1001 },
  };
  assert.deepEqual(ataLegDelta(previous, current), {
    callerRx: 250,
    callerTx: 250,
    calleeRx: 250,
    calleeTx: 1,
  });
  assert.deepEqual(ataLegDelta(null, current), {
    callerRx: 1250,
    callerTx: 1250,
    calleeRx: 1250,
    calleeTx: 1001,
  });
});

test("FXS→WebRTC timestamps stay continuous through jitter but realign after outages", () => {
  assert.deepEqual(gapAdjustedRtpAdvance(0), { slots: 1, marker: false });
  assert.deepEqual(gapAdjustedRtpAdvance(21), { slots: 1, marker: false });
  assert.deepEqual(gapAdjustedRtpAdvance(199), { slots: 1, marker: false });
  assert.deepEqual(gapAdjustedRtpAdvance(200), { slots: 10, marker: true });
  assert.deepEqual(gapAdjustedRtpAdvance(5700), { slots: 285, marker: true });
  assert.deepEqual(gapAdjustedRtpAdvance(10 * 60 * 1000), { slots: 15000, marker: true });
  assert.deepEqual(gapAdjustedRtpAdvance(NaN), { slots: 1, marker: false });
});

test("PCM evidence distinguishes packets from non-silent samples", () => {
  const evidence = createAudioEvidence();
  observePcmActivity(evidence.webrtc, new Int16Array([0, 12, -20]));
  observePcmActivity(evidence.webrtc, new Int16Array([0, 400, -900]));

  assert.deepEqual(evidence.webrtc, { activeFrames: 1, peak: 900 });
});

test("directional snapshots retain packet and content evidence", () => {
  const snapshot = directionalMediaSnapshot({
    _webrtcRtpIn: 500,
    _sipRtpOut: 499,
    _fxsRtpIn: 250,
    _webrtcRtpOut: 250,
    audioEvidence: {
      webrtc: { activeFrames: 12, peak: 1400 },
      fxs: { activeFrames: 4, peak: 800 },
    },
  });

  assert.equal(snapshot.sipOut, 499);
  assert.equal(snapshot.fxsIn, 250);
  assert.equal(snapshot.webrtcActive, 12);
  assert.deepEqual(directionalMediaDelta({ sipOut: 200, fxsIn: 1 }, snapshot), {
    webToFxs: 299,
    fxsToWeb: 249,
  });
});
