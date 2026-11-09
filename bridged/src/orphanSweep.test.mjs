import assert from "node:assert/strict";
import test from "node:test";
import { sweepOrphanedExternalMedia } from "./orphanSweep.mjs";

const HOST = "192.168.2.106";
const quiet = { warn() {} };

function fakeClient({ bridges, channels }) {
  const hungUp = [];
  const destroyed = [];
  return {
    hungUp,
    destroyed,
    bridges: {
      list: async () => bridges,
      destroy: async ({ bridgeId }) => destroyed.push(bridgeId),
    },
    channels: {
      list: async () => channels,
      hangup: async ({ channelId }) => hungUp.push(channelId),
    },
  };
}

test("ends a stranded softphone↔house bridge: ExternalMedia leg, house leg, and bridge", async () => {
  const client = fakeClient({
    channels: [
      { id: "ext1", name: `UnicastRTP/${HOST}:14048-0x1` },
      { id: "fxs1", name: "PJSIP/2001-0000001e" },
    ],
    bridges: [{ id: "b1", name: "ph-1791", bridge_class: "stasis", channels: ["ext1", "fxs1"] }],
  });
  const result = await sweepOrphanedExternalMedia(client, { extMediaHost: HOST, log: quiet });
  assert.deepEqual(result, { channels: 2, bridges: 1 });
  assert.deepEqual(client.hungUp.sort(), ["ext1", "fxs1"]);
  assert.deepEqual(client.destroyed, ["b1"]);
});

test("keeps a live ATA↔ATA bridge mixing across a bridged restart", async () => {
  const client = fakeClient({
    channels: [
      { id: "a", name: "PJSIP/2001-00000023" },
      { id: "b", name: "PJSIP/2002-00000024" },
    ],
    bridges: [{ id: "b2", name: "ph-ata-a", bridge_class: "stasis", channels: ["a", "b"] }],
  });
  const result = await sweepOrphanedExternalMedia(client, { extMediaHost: HOST, log: quiet });
  assert.deepEqual(result, { channels: 0, bridges: 0 });
  assert.deepEqual(client.hungUp, []);
  assert.deepEqual(client.destroyed, []);
});

test("ends a loose pre-warmed ExternalMedia leg and destroys empty ph- bridges", async () => {
  const client = fakeClient({
    channels: [{ id: "ext2", name: `UnicastRTP/${HOST}:14050-0x2` }],
    bridges: [{ id: "b3", name: "ph-empty", bridge_class: "stasis", channels: [] }],
  });
  const result = await sweepOrphanedExternalMedia(client, { extMediaHost: HOST, log: quiet });
  assert.deepEqual(result, { channels: 1, bridges: 1 });
  assert.deepEqual(client.hungUp, ["ext2"]);
  assert.deepEqual(client.destroyed, ["b3"]);
});

test("leaves bridges and UnicastRTP legs that are not PhoneHome's", async () => {
  const client = fakeClient({
    channels: [
      { id: "x", name: "UnicastRTP/192.0.2.9:5000-0x3" },
      { id: "y", name: "PJSIP/trunk-00000001" },
    ],
    bridges: [
      { id: "conf", name: "conference-1", bridge_class: "stasis", channels: ["x"] },
      { id: "basic", name: "ph-basic", bridge_class: "base", channels: [] },
    ],
  });
  const result = await sweepOrphanedExternalMedia(client, { extMediaHost: HOST, log: quiet });
  assert.deepEqual(result, { channels: 0, bridges: 0 });
});

test("skips the sweep when ARI listing fails", async () => {
  const client = fakeClient({ channels: [], bridges: [] });
  client.bridges.list = async () => {
    throw new Error("ARI down");
  };
  const result = await sweepOrphanedExternalMedia(client, { extMediaHost: HOST, log: quiet });
  assert.deepEqual(result, { channels: 0, bridges: 0 });
});
