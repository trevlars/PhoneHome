import test from "node:test";
import assert from "node:assert/strict";
import {
  asteriskMediaWebSocketUrl,
  resolveMediaWebSocketConnectionId,
  splitPcmuFrames,
} from "./asteriskMediaWebSocket.mjs";

test("builds Asterisk media WebSocket URL from ARI URL", () => {
  assert.equal(
    asteriskMediaWebSocketUrl("http://192.168.2.105:8088", "abc-123"),
    "ws://192.168.2.105:8088/media/abc-123"
  );
  assert.equal(
    asteriskMediaWebSocketUrl("https://pbx.example/ari", "id/with space"),
    "wss://pbx.example/media/id%2Fwith%20space"
  );
});

test("splits raw PCMU media into 20ms frames", () => {
  const frames = splitPcmuFrames(Buffer.alloc(325, 0xff));
  assert.equal(frames.length, 2);
  assert.equal(frames[0].length, 160);
  assert.equal(frames[1].length, 160);
});

test("retries until Asterisk publishes the media connection id", async () => {
  let calls = 0;
  const channel = {
    async getChannelVar() {
      calls += 1;
      return { value: calls < 3 ? "" : "connection-42" };
    },
  };

  assert.equal(
    await resolveMediaWebSocketConnectionId(channel, { attempts: 3, delayMs: 1 }),
    "connection-42"
  );
});
