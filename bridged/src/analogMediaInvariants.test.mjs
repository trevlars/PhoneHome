import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ONE_TO_ONE_BRIDGE_TYPE,
  FORBIDDEN_BRIDGE_TOKENS,
  assertOneToOneBridgeType,
  validateAnalogMediaSource,
} from "./analogMedia.mjs";

const indexSource = fs.readFileSync(
  fileURLToPath(new URL("./index.mjs", import.meta.url)),
  "utf8"
);

test("ONE_TO_ONE_BRIDGE_TYPE is plain mixing", () => {
  assert.equal(ONE_TO_ONE_BRIDGE_TYPE, "mixing");
});

test("assertOneToOneBridgeType rejects proxy_media and native_rtp", () => {
  assert.throws(() => assertOneToOneBridgeType("mixing,proxy_media"));
  assert.throws(() => assertOneToOneBridgeType("native_rtp,mixing"));
  assert.doesNotThrow(() => assertOneToOneBridgeType("mixing"));
});

test("FORBIDDEN_BRIDGE_TOKENS covers known regression vectors", () => {
  assert.ok(FORBIDDEN_BRIDGE_TOKENS.includes("proxy_media"));
  assert.ok(FORBIDDEN_BRIDGE_TOKENS.includes("native_rtp"));
});

test("live index.mjs satisfies analog media invariants", () => {
  const result = validateAnalogMediaSource(indexSource);
  if (!result.ok) {
    assert.fail(`Media invariant violations:\n- ${result.violations.join("\n- ")}`);
  }
});

test("guard rejects a handset caller prompt before the mix is armed", () => {
  const armed = "armExternalMediaMix(session);\n    void startHandsetCallerPrompt(session, handsetPrompt);";
  assert.ok(indexSource.includes(armed));
  const early = indexSource.replace(
    armed,
    "void startHandsetCallerPrompt(session, handsetPrompt);\n    armExternalMediaMix(session);"
  );
  const result = validateAnalogMediaSource(early);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes("only after armExternalMediaMix")));
});

test("guard rejects Asterisk playback in the handset caller prompt", () => {
  const head = "async function startHandsetCallerPrompt(session, pending) {";
  assert.ok(indexSource.includes(head));
  const played = indexSource.replace(head, `${head}\n  await session.bridge.play({ media: "sound:x" });`);
  const result = validateAnalogMediaSource(played);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.includes("never Asterisk playback")));
});

test("index does not import chan_websocket helper", () => {
  assert.doesNotMatch(indexSource, /asteriskMediaWebSocket\.mjs/);
});
