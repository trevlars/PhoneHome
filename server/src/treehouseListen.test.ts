import assert from "node:assert/strict";
import test from "node:test";
import { groupSignalingRole } from "./treehouseListen.js";

test("parent listener always gets the softphone (ATA claim must not steal answer)", () => {
  assert.equal(
    groupSignalingRole({ destIsListener: true, destIsAnalogMember: false }),
    "softphone"
  );
  assert.equal(
    groupSignalingRole({ destIsListener: true, destIsAnalogMember: true }),
    "softphone"
  );
});

test("analog TreeHouse members get the bridge (ExternalMedia listen)", () => {
  assert.equal(
    groupSignalingRole({ destIsListener: false, destIsAnalogMember: true }),
    "bridge"
  );
});

test("softphone kids get the app, even when an ATA is registered on the line", () => {
  assert.equal(
    groupSignalingRole({ destIsListener: false, destIsAnalogMember: false }),
    "softphone"
  );
});
