import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFcmCallMessage,
  buildFcmVoicemailMessage,
  fcmConfigured,
  fcmTokenShouldDrop,
} from "./fcmPush.js";

test("fcm call message is data-only and high priority", () => {
  const msg = buildFcmCallMessage("DeviceToken:KeepCase", {
    callId: "call_1",
    handle: "line_a",
    callerName: "Alex",
    fromLineId: "line_a",
    toLineId: "line_b",
  });
  assert.equal(msg.message.token, "DeviceToken:KeepCase");
  assert.equal(msg.message.android.priority, "HIGH");
  assert.equal(msg.message.android.ttl, "30s");
  assert.equal(msg.message.data.type, "incoming_call");
  assert.equal(msg.message.data.callerName, "Alex");
  assert.equal("notification" in msg.message, false);
  assert.equal(JSON.stringify(msg).includes("sdp"), false);
});

test("fcm voicemail message stays data-only", () => {
  const msg = buildFcmVoicemailMessage("tok", {
    voicemailId: "vm_1",
    fromLabel: "Dad",
    unreadCount: 2,
  });
  assert.equal(msg.message.data.type, "voicemail");
  assert.equal(msg.message.data.unreadCount, "2");
  assert.equal("notification" in msg.message, false);
});

test("dead FCM responses drop the token", () => {
  assert.equal(fcmTokenShouldDrop(404, ""), true);
  assert.equal(fcmTokenShouldDrop(400, '{"error":{"status":"INVALID_ARGUMENT"}}'), true);
  assert.equal(fcmTokenShouldDrop(404, "UNREGISTERED"), true);
  assert.equal(fcmTokenShouldDrop(500, "unavailable"), false);
});

test("fcm is not configured without a service account", () => {
  const prev = process.env.FCM_SERVICE_ACCOUNT_JSON;
  delete process.env.FCM_SERVICE_ACCOUNT_JSON;
  try {
    assert.equal(fcmConfigured(), false);
  } finally {
    if (prev !== undefined) process.env.FCM_SERVICE_ACCOUNT_JSON = prev;
  }
});
