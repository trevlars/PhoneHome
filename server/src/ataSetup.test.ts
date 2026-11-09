import assert from "node:assert/strict";
import test from "node:test";
import { ataSetupMode } from "./ataSetup.js";
import { deriveAtaParentPhase } from "./ataStatus.js";

test("cousin pods prefer Download even when the Mothership can LAN-push", () => {
  assert.equal(
    ataSetupMode({ lanPushEnabled: true, householdIsHome: false, lanPushOk: null }),
    "download"
  );
  assert.equal(
    ataSetupMode({ lanPushEnabled: true, householdIsHome: true, lanPushOk: null }),
    "lan"
  );
});

test("a failed one-tap pins Download; a successful one-tap pins LAN", () => {
  assert.equal(
    ataSetupMode({ lanPushEnabled: true, householdIsHome: true, lanPushOk: 0 }),
    "download"
  );
  assert.equal(
    ataSetupMode({ lanPushEnabled: true, householdIsHome: false, lanPushOk: 1 }),
    "lan"
  );
});

test("cloud motherships never offer one-tap", () => {
  assert.equal(
    ataSetupMode({ lanPushEnabled: false, householdIsHome: true, lanPushOk: 1 }),
    "download"
  );
});

test("waiting after download is not the same as registered", () => {
  assert.equal(
    deriveAtaParentPhase({
      status: "offline",
      lastDownloadAt: "2026-09-13T16:00:00.000Z",
      now: Date.parse("2026-09-13T16:05:00.000Z"),
    }),
    "waiting"
  );
  assert.equal(
    deriveAtaParentPhase({
      status: "online",
      lastDownloadAt: "2026-09-13T16:00:00.000Z",
    }),
    "online"
  );
});