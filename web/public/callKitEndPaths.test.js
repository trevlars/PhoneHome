import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.join(here, "app.js"), "utf8");
const callKitSource = fs.readFileSync(
  path.join(
    here,
    "../../mobile/plugins/phonehome-callkit/ios/Sources/PhoneHomeCallKitPlugin/PhoneHomeCallKit.swift"
  ),
  "utf8"
);
const nativePeerSource = fs.readFileSync(
  path.join(
    here,
    "../../mobile/plugins/phonehome-callkit/ios/Sources/PhoneHomeCallKitPlugin/PhoneHomeNativePeer.swift"
  ),
  "utf8"
);
const nativeTerminationSource = fs.readFileSync(
  path.join(
    here,
    "../../mobile/plugins/phonehome-callkit/ios/Sources/PhoneHomeCallKitPlugin/PhoneHomeNativeTerminationState.swift"
  ),
  "utf8"
);

test("CallKit End fulfills before immediate held-media teardown", () => {
  assert.match(
    callKitSource,
    /perform action: CXEndCallAction\)[\s\S]*?action\.fulfill\(\)[\s\S]*?beginImmediateEnd\(uuid: action\.callUUID\)/
  );
  assert.match(
    callKitSource,
    /private func beginImmediateEnd[\s\S]*?kickWebViewHangup\([\s\S]*?finishImmediateTeardown\([\s\S]*?event: "callEnded"/
  );
  assert.match(
    callKitSource,
    /private func finishImmediateTeardown[\s\S]*?localHeld = false[\s\S]*?endNativeMedia\(\)[\s\S]*?deactivateAudioSession\(\)[\s\S]*?emit\(event, data: endedData, retain: true\)/
  );
  assert.match(callKitSource, /"localHeld": snapshot\.localHeld/);
  assert.match(callKitSource, /"remoteHeld": snapshot\.remoteHeld/);
  assert.match(nativePeerSource, /func close\(\)[\s\S]*?stopHoldMusic\(\)[\s\S]*?remoteHeld = false/);
});

test("in-app End serializes behind an accepted hold request", () => {
  assert.match(
    callKitSource,
    /func endCall\(callId: String\?\)[\s\S]*?beginImmediateEnd\(uuid: uuid\)[\s\S]*?submitEndTransaction\(uuid: uuid\)/
  );
  assert.match(
    callKitSource,
    /if holdTransactionUuid == uuid \{[\s\S]*?deferredEndUuid = uuid[\s\S]*?return/
  );
  assert.match(
    callKitSource,
    /if endState\.isEnding\(action\.callUUID\)[\s\S]*?action\.fulfill\(\)[\s\S]*?return/
  );
  assert.match(
    appSource,
    /function hangup\(opts = \{\}\)[\s\S]*?releaseNativeCallAudio\(\)[\s\S]*?sendCallKitHangup\(payload\)[\s\S]*?skipNativeEnd: true/
  );
});

test("native peer terminals dismiss CallKit without an End transaction race", () => {
  const remoteEndStart = callKitSource.indexOf("private func endNativeCallFromRemote");
  const remoteEndFinish = callKitSource.indexOf(
    "private func terminalNativeState",
    remoteEndStart
  );
  assert.notEqual(remoteEndStart, -1);
  assert.notEqual(remoteEndFinish, -1);
  const remoteEndSource = callKitSource.slice(remoteEndStart, remoteEndFinish);

  assert.match(
    remoteEndSource,
    /provider\.reportCall\(with: callUuid, endedAt: Date\(\), reason: \.remoteEnded\)/
  );
  assert.match(remoteEndSource, /event: "nativeRemoteEnded"/);
  assert.doesNotMatch(
    remoteEndSource,
    /submitEndTransaction\(|CXTransaction\(action: CXEndCallAction/
  );
  assert.match(
    callKitSource,
    /private let nativeDisconnectGrace: TimeInterval = 3[\s\S]*?scheduleNativeDisconnectGrace[\s\S]*?asyncAfter\(deadline: \.now\(\) \+ nativeDisconnectGrace/
  );
  assert.match(
    callKitSource,
    /nativePeerGeneration == peerGeneration\.generation[\s\S]*?activeCallId == peerGeneration\.callId[\s\S]*?activeUuid == callUuid/
  );
  assert.match(
    callKitSource,
    /setNativeRemoteOffer\([\s\S]*?guard activeCallId == callId, activeUuid != nil/
  );
  assert.match(
    nativeTerminationSource,
    /contains\("closed"\)[\s\S]*?contains\("failed"\)[\s\S]*?return \.endRemote[\s\S]*?contains\("disconnected"\)[\s\S]*?return \.scheduleDisconnectGrace/
  );
});

test("retained native remote end only clears matching local UI", () => {
  const listenerStart = appSource.indexOf(
    'kit.addListener("nativeRemoteEnded"'
  );
  const listenerFinish = appSource.indexOf("\n\n    try {", listenerStart);
  assert.notEqual(listenerStart, -1);
  assert.notEqual(listenerFinish, -1);
  const listenerSource = appSource.slice(listenerStart, listenerFinish);

  assert.match(listenerSource, /endedCallId !== activeCallId/);
  assert.match(listenerSource, /endCallUi\("Call ended", \{ skipNativeEnd: true \}\)/);
  assert.doesNotMatch(
    listenerSource,
    /sendCallKitHangup\(|type:\s*"call\.hangup"/
  );
});

test("retained native End is replayed once after WebSocket recovery", () => {
  assert.match(callKitSource, /event: "callEnded",[\s\S]*?nativeKickRequested: true/);
  assert.match(callKitSource, /emit\(event, data: endedData, retain: true\)/);
  assert.match(
    appSource,
    /let pendingCallKitEndSignal = null[\s\S]*?function sendCallKitHangup[\s\S]*?sentCallKitHangupIds\.has\(payload\.callId\)[\s\S]*?pendingCallKitEndSignal = payload/
  );
  assert.match(
    appSource,
    /if \(msg\.type === "welcome"\) \{[\s\S]*?flushPendingCallKitEndSignal\(\)/
  );
  assert.match(
    appSource,
    /nativeKickRequested means evaluateJavaScript was attempted, not delivered[\s\S]*?sendCallKitHangup\(payload\)/
  );
});

test("CallKit Answer signals accepted before awaiting the pending offer", () => {
  const start = appSource.indexOf('kit.addListener("callAnswered"');
  const finish = appSource.indexOf('\n    await kit.addListener("callHeld"', start);
  assert.notEqual(start, -1);
  assert.notEqual(finish, -1);
  const listener = appSource.slice(start, finish);

  const immediate = listener.indexOf('signalCallKitAccepted("callAnswered-immediate")');
  const fetch = listener.indexOf("const pendingOffer = ensureIncomingOfferForCallKit()");
  const awaited = listener.indexOf("await pendingOffer");
  const accept = listener.indexOf("void acceptCallFromCallKit()");
  assert.ok(immediate >= 0 && immediate < fetch);
  assert.ok(fetch < awaited);
  assert.ok(awaited < accept);
  assert.match(listener, /applyNativeIncomingHint\(ev\)/);
});

test("incoming PushKit wake prewarms a memory-only ICE cache", () => {
  assert.match(
    appSource,
    /const ICE_SERVERS_CACHE_MS[\s\S]*?let iceServersFetch = null[\s\S]*?if \(iceServersFetch\) return iceServersFetch/
  );
  assert.match(
    appSource,
    /kit\.addListener\("incomingPush"[\s\S]*?void iceServers\(\)[\s\S]*?void ensureIncomingOfferForCallKit\(\)/
  );
  assert.doesNotMatch(
    appSource,
    /(?:localStorage|sessionStorage)\.setItem\([^\n)]*(?:iceServersCached|ICE_SERVERS_CACHE)/i
  );
});

test("native WebRTC activation requires real CallKit audio state", () => {
  const offerStart = callKitSource.indexOf("public func setNativeRemoteOffer");
  const offerFinish = callKitSource.indexOf(
    "private func handleNativeConnectionState",
    offerStart
  );
  const offerSource = callKitSource.slice(offerStart, offerFinish);
  assert.match(
    offerSource,
    /if audioSessionActive \{[\s\S]*?peer\.enableCallKitAudio/
  );
  assert.doesNotMatch(
    offerSource,
    /if callAnswered \|\| audioSessionActive|if self\?\.callAnswered == true[\s\S]*?enableCallKitAudio/
  );
  assert.match(
    callKitSource,
    /provider\(_ provider: CXProvider, didActivate audioSession: AVAudioSession\)[\s\S]*?audioSessionActive = true[\s\S]*?peer\.enableCallKitAudio\(session: audioSession\)/
  );
  assert.match(
    nativePeerSource,
    /permissionCompleted\(\)[\s\S]*?case \.activateAndEnable:[\s\S]*?rtc\.audioSessionDidActivate\(session\)/
  );
  assert.equal(
    (nativePeerSource.match(/audioSessionDidActivate\(session\)/g) || []).length,
    1
  );
  assert.doesNotMatch(callKitSource, /audioSessionDidActivate\(/);
});

test("native connected media drives active call chrome without status regression", () => {
  const listenerStart = appSource.indexOf(
    'kit.addListener("nativeConnectionState"'
  );
  const listenerFinish = appSource.indexOf(
    '\n  void kit.addListener("nativeMediaStat"',
    listenerStart
  );
  const listener = appSource.slice(listenerStart, listenerFinish);
  assert.notEqual(listenerStart, -1);
  assert.notEqual(listenerFinish, -1);
  assert.match(
    listener,
    /if \(up\) \{[\s\S]*?state\.iceState = "connected"[\s\S]*?status: "active"[\s\S]*?paintCallLayer\(\)/
  );

  const acceptStart = appSource.indexOf("async function acceptCallViaNativeMedia");
  const acceptFinish = appSource.indexOf("\nfunction reportNativeMediaStat", acceptStart);
  const accept = appSource.slice(acceptStart, acceptFinish);
  assert.match(
    accept,
    /state\.call\?\.callId === msg\.callId && state\.call\.status !== "active"[\s\S]*?status: "connecting"/
  );
});
