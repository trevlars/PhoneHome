import assert from "node:assert/strict";
import test from "node:test";
import {
  apnsEnvName,
  iosCallKitMode,
  iosCallKitPushEnabled,
  isApnsBadDeviceToken,
  resolveApnsProduction,
  shouldSendVoipPush,
} from "./apnsVoip.js";

function withCallKitEnv(value: string | undefined, fn: () => void) {
  const prevIos = process.env.IOS_CALLKIT;
  const prevAlt = process.env.CALLKIT_ENABLED;
  try {
    if (value === undefined) {
      delete process.env.IOS_CALLKIT;
      delete process.env.CALLKIT_ENABLED;
    } else {
      process.env.IOS_CALLKIT = value;
      delete process.env.CALLKIT_ENABLED;
    }
    fn();
  } finally {
    if (prevIos === undefined) delete process.env.IOS_CALLKIT;
    else process.env.IOS_CALLKIT = prevIos;
    if (prevAlt === undefined) delete process.env.CALLKIT_ENABLED;
    else process.env.CALLKIT_ENABLED = prevAlt;
  }
}

test("IOS_CALLKIT unset is auto: VoIP only when a token exists", () => {
  withCallKitEnv(undefined, () => {
    assert.equal(iosCallKitMode(), "auto");
    assert.equal(iosCallKitPushEnabled(), true);
    assert.equal(shouldSendVoipPush(false), false);
    assert.equal(shouldSendVoipPush(true), true);
  });
});

test("IOS_CALLKIT=0 is alert-only even with VoIP tokens", () => {
  withCallKitEnv("0", () => {
    assert.equal(iosCallKitMode(), "alert");
    assert.equal(iosCallKitPushEnabled(), false);
    assert.equal(shouldSendVoipPush(true), false);
  });
});

test("IOS_CALLKIT=1 prefers VoIP when a token exists", () => {
  withCallKitEnv("1", () => {
    assert.equal(iosCallKitMode(), "voip");
    assert.equal(shouldSendVoipPush(false), false);
    assert.equal(shouldSendVoipPush(true), true);
  });
});

test("APNs env follows stored token, then hub default", () => {
  assert.equal(resolveApnsProduction("production", false), true);
  assert.equal(resolveApnsProduction("sandbox", true), false);
  assert.equal(resolveApnsProduction(null, false), false);
  assert.equal(resolveApnsProduction(undefined, true), true);
  assert.equal(apnsEnvName(true), "production");
  assert.equal(apnsEnvName(false), "sandbox");
});

test("BadDeviceToken is the sandbox/production mismatch signal", () => {
  assert.equal(isApnsBadDeviceToken(400, '{"reason":"BadDeviceToken"}'), true);
  assert.equal(isApnsBadDeviceToken(400, '{"reason":"ExpiredProviderToken"}'), false);
  assert.equal(isApnsBadDeviceToken(200, '{"reason":"BadDeviceToken"}'), false);
});
