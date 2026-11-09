import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.join(here, "app.js"), "utf8");
const bridgeSource = fs.readFileSync(path.join(here, "../../bridged/src/index.mjs"), "utf8");

test("mobile web 1:1 calls use the earpiece audio session", () => {
  assert.match(appSource, /function applyWebCallAudioRoute\(speaker\)/);
  assert.match(appSource, /session\.type = speaker \? "playback" : "play-and-record"/);
  assert.match(appSource, /function releaseWebCallAudioRoute\(\)/);
  assert.match(appSource, /if \(!isNativeIosShell\(\)\) \{\s*state\.speakerOn = speaker;\s*applyWebCallAudioRoute\(speaker\);/);
  assert.match(appSource, /Earpiece before AudioContext/);
  assert.match(appSource, /function shouldRelayWebCallAudio\(\)/);
  assert.match(appSource, /createMediaStreamDestination\(\)/);
  assert.match(appSource, /silenceDirectCallAudioForRelay\(\)/);
});

test("parent Resume of a child hold clears native remote hold before CallKit local hold", () => {
  const start = appSource.indexOf("function toggleHold(");
  const end = appSource.indexOf("function isChildMode(");
  const fn = appSource.slice(start, end);
  const override = fn.indexOf("canOverrideRemoteHold()");
  const setHeld = fn.indexOf("setHeld(");
  assert.ok(override >= 0 && setHeld > override, "child-hold override must not use CallKit setHeld");
  assert.match(appSource, /function resumeOverriddenHold\(/);
  assert.match(appSource, /setRemoteHeld\(\{ onHold: false, muted: state\.muted \}\)/);
});

test("native CallKit hold uses native media APIs", () => {
  assert.match(appSource, /setHeld\(\{ onHold: next, muted: state\.muted \}\)/);
  assert.match(appSource, /setRemoteHeld\(\{ onHold: on, muted: state\.muted \}\)/);
  assert.match(appSource, /addListener\("callHeld"/);
});

test("WebView softphone to analog hold keeps bridge MOH path", () => {
  assert.match(
    appSource,
    /const ataPeer = peerLineHasAta\(otherLineId\(state\.call\)\);[\s\S]*if \(ataPeer\) \{[\s\S]*stopHoldMusic\(\);/
  );
  assert.match(
    bridgeSource,
    /async function applySoftphoneHold\(session, onHold\)[\s\S]*await fxs\.startMoh\(\{ mohClass: "default" \}\)/
  );
});

test("v1 call control sends canonical participants", () => {
  assert.match(appSource, /const CALL_LIFECYCLE_CONTRACT_VERSION = 1;/);
  assert.match(
    appSource,
    /type: "call\.ice",[\s\S]*contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION,[\s\S]*fromLineId: state\.call\?\.fromLineId \|\| state\.activeLineId,[\s\S]*toLineId: state\.call\?\.toLineId \|\| peer/
  );
  assert.match(
    appSource,
    /type: "call\.hangup",[\s\S]*contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION,[\s\S]*fromLineId: state\.call\.fromLineId \|\| state\.activeLineId,[\s\S]*toLineId: state\.call\.toLineId/
  );
  assert.match(
    appSource,
    /type: "call\.hold",[\s\S]*contractVersion: CALL_LIFECYCLE_CONTRACT_VERSION,[\s\S]*fromLineId: call\.fromLineId \|\| fromLineId,[\s\S]*toLineId: call\.toLineId \|\| toLineId/
  );
});
