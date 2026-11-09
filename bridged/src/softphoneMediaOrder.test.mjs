import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { validateAnalogMediaSource } from "./analogMedia.mjs";

const source = fs.readFileSync(
  fileURLToPath(new URL("./index.mjs", import.meta.url)),
  "utf8"
);

const ataSoftAnchor = "// No FXS playback on this leg. Piper after join killed";

test("index.mjs passes centralized analog media guard", () => {
  const result = validateAnalogMediaSource(source);
  if (!result.ok) {
    assert.fail(result.violations.join("; "));
  }
});

test("softphone to ATA preps ExternalMedia while ringing and joins only after FXS answers", () => {
  const start = source.indexOf("async function handleSoftphoneToAta");
  const end = source.indexOf("\n/** Match server softphoneCidNumber", start);
  const handler = source.slice(start, end);

  const prep = handler.indexOf("attachExternalMedia(client, session, null)");
  const answered = handler.indexOf("const dest = await destPromise");
  const join = handler.indexOf("await attachExternalMedia(client, session, dest");
  const fxsAnswer = handler.indexOf("answerChannelsAfterBridgeJoin");
  const arm = handler.lastIndexOf("armExternalMediaMix(session)");
  assert.ok(prep >= 0, "must prep ExternalMedia during ring");
  assert.ok(answered > prep, "prep starts before waiting for FXS answer");
  assert.ok(join > answered, "atomic join happens after FXS answers");
  assert.ok(fxsAnswer > join && arm > fxsAnswer, "arm mix immediately after FXS answer");
  const prompt = handler.indexOf("void startHandsetCallerPrompt(session, handsetPrompt)");
  assert.ok(prompt > arm, "handset caller prompt only once the mix is armed");
  assert.doesNotMatch(handler, /announceCallerOnFxs|announceDialingOnFxs/);
  assert.doesNotMatch(handler, /playBridgePhrase|bridge\.play|announceCallerOnHandset/, "no handset prompt before the mix");
});

test("analog calls say Calling name before either far end rings", () => {
  const announce = source.indexOf("await announceDialingOnFxs(channel, resolved.toLabel)");
  const ata = source.indexOf("await startAtaToAta(client, session, channel, resolved)");
  const webrtc = source.indexOf("const webrtcLeg = startWebRtcLeg(session, resolved)");
  assert.ok(announce >= 0 && ata > announce && webrtc > announce, "Calling finishes before ring");
  const start = source.indexOf("async function startAtaToAta");
  const end = source.indexOf("\n/**", start);
  assert.doesNotMatch(source.slice(start, end), /announceDialingOnFxs/);
});

test("ATA to softphone arms mix immediately after answer with no FXS playback", () => {
  const start = source.indexOf(ataSoftAnchor);
  const end = source.indexOf("[bridged] media up call=", start);
  const block = source.slice(start, end);
  const ring = block.indexOf("await channel.ring()");
  const attach = block.indexOf("await attachExternalMedia(client, session, channel");
  const answer = block.indexOf("await answerFxsWhenMediaReady");
  const arm = block.lastIndexOf("armExternalMediaMix(session)");
  assert.ok(ring >= 0 && attach > ring, "ring before mix join");
  assert.ok(answer > attach && arm > answer, "join → answer → arm");
  assert.doesNotMatch(block, /announceDialingOnFxs|announceCallerOnFxs/);
});

test("ATA to softphone keeps WebRTC WS handler after answer for call.hold", () => {
  const start = source.indexOf("async function startWebRtcLeg");
  const end = source.indexOf("\nfunction forwardPcmuToWebRtc", start);
  const fn = source.slice(start, end);
  const answerIdx = fn.indexOf('if (msg.type === "call.answer" && msg.sdp)');
  const holdIdx = fn.indexOf('if (msg.type === "call.hold")');
  const answerSlice = fn.slice(answerIdx, holdIdx);
  assert.ok(answerIdx >= 0 && holdIdx > answerIdx, "answer and hold handlers present");
  assert.doesNotMatch(
    answerSlice,
    /ws\.off\("message", onMsg\)/,
    "must not detach WS handler on answer — post-connect hold needs it"
  );
});

test("ATA to softphone caps ICE gather before call.offer", () => {
  const start = source.indexOf("async function startWebRtcLeg");
  const end = source.indexOf("\nfunction forwardPcmuToWebRtc", start);
  const fn = source.slice(start, end);
  assert.match(fn, /waitIceGathering\(pc, Math\.min\(ICE_GATHER_MS, 2500\)\)/);
  assert.match(fn, /type: "call\.offer"/);
});

test("direct ATA to softphone rings, waits for answer, then arms mix", () => {
  const start = source.indexOf(ataSoftAnchor);
  const end = source.indexOf("[bridged] media up call=", start);
  const block = source.slice(start, end);
  const leg = block.indexOf("const webrtcLeg = startWebRtcLeg(session, resolved)");
  const ring = block.indexOf("await channel.ring()");
  const awaitLeg = block.indexOf("await webrtcLeg");
  const arm = block.lastIndexOf("armExternalMediaMix(session)");
  assert.ok(leg >= 0 && ring > leg && awaitLeg > ring, "offer leg, ring, then answer");
  assert.ok(arm > awaitLeg, "mix armed after softphone answers");
});

test("ATA to softphone joins ExternalMedia before FXS answer then arms mix", () => {
  const start = source.indexOf(ataSoftAnchor);
  const end = source.indexOf("[bridged] media up call=", start);
  const block = source.slice(start, end);

  const join = block.indexOf("await attachExternalMedia(client, session, channel");
  const answer = block.indexOf("await answerFxsWhenMediaReady");
  const arm = block.lastIndexOf("armExternalMediaMix(session)");
  assert.ok(join >= 0 && answer > join && arm > answer, "join → answer → arm");
  assert.doesNotMatch(source, /void answerFxsWhenMediaReady\(session, "call\.accepted"\)/);
});

test("softphone uplink gate opens on inbound WebRTC RTP before sendPcmu is armed", () => {
  const ontrack = source.indexOf("pc.ontrack = (ev) => {");
  const block = source.slice(ontrack, ontrack + 2200);
  const mark = block.indexOf("softphoneUplinkReady?.markReady()");
  const sendGuard = block.indexOf("if (!session.sendPcmu) return;");
  assert.ok(mark >= 0 && sendGuard > mark, "mark uplink ready before sendPcmu guard");
});

test("1:1 ExternalMedia uses UDP UnicastRTP constants from analogMedia.mjs", () => {
  assert.match(source, /EXTERNAL_MEDIA_TRANSPORT/);
  assert.match(source, /EXTERNAL_MEDIA_ENCAPSULATION/);
  assert.match(source, /resolveExternalMediaRtpEndpoint/);
  assert.doesNotMatch(source, /transport: "websocket"|external_host: "INCOMING"/);
});

test("completed bridge calls persist packet and PCM diagnostics", () => {
  assert.match(source, /startMediaDiagnostics\(session\)/);
  assert.match(
    source,
    /RTP summary \$\{label\}[\s\S]*?deltaWebToFxs=[\s\S]*?deltaFxsToWeb=[\s\S]*?webActive=[\s\S]*?fxsActive=/
  );
  assert.match(source, /"CHANNEL\(rtcp,all,audio\)", "RTPAUDIOQOS"/);
  assert.doesNotMatch(source, /"CHANNEL\(rtpqos/);
  assert.match(source, /"CHANNEL\(rtp,src,audio\)"/);
  assert.match(source, /"CHANNEL\(rtp,dest,audio\)"/);
});

test("ATA to ATA uses createOneToOneBridge and deferred answer", () => {
  const start = source.indexOf("async function startAtaToAta");
  const end = source.indexOf("\n/**", start);
  const handler = source.slice(start, end);

  assert.match(handler, /createOneToOneBridge/);
  assert.match(handler, /addLegsToBridge/);
  assert.match(handler, /answerChannelsAfterBridgeJoin/);
  assert.match(handler, /originateFxsPeer/);
  assert.match(handler, /startAtaMediaDiagnostics\(session\)/);
});
