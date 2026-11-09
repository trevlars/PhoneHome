import assert from "node:assert/strict";
import test from "node:test";
import {
  analogCircleTalkPeers,
  filterCircleTalkPeers,
  groupSignalingRole,
  listenTargetsForChild,
  meshTalkPeerIds,
} from "./treehouseListen.js";

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

test("softphone TreeHouse mesh never includes analog members", () => {
  assert.deepEqual(meshTalkPeerIds(["app-a", "ata-b"], ["ata-b"]), ["app-a"]);
  assert.deepEqual(meshTalkPeerIds(["app-a", "ata-b"], ["ata-b"], { joinerIsAnalog: true }), []);
  assert.deepEqual(meshTalkPeerIds(["app-a"], []), ["app-a"]);
});

test("Circle filter keeps Alex↔Quinn and drops kids outside Circles", () => {
  const alex = "alex";
  const quinn = "quinn";
  const stranger = "stranger";
  const canTalk = (a: string, b: string) => {
    const pair = a < b ? `${a}|${b}` : `${b}|${a}`;
    return pair === "quinn|alex";
  };
  const members = [alex, quinn, stranger];
  assert.deepEqual(filterCircleTalkPeers(members, alex, canTalk), [quinn]);
  assert.deepEqual(filterCircleTalkPeers(members, stranger, canTalk), []);
  assert.deepEqual(listenTargetsForChild(members, alex, canTalk), [alex, quinn]);
  assert.equal(listenTargetsForChild(members, alex, canTalk).includes(stranger), false);
});

test("analog Circle peers are Circle-filtered and analog-only", () => {
  const alex = "alex";
  const riley = "riley";
  const quinn = "quinn";
  const sam = "sam";
  const canTalk = (a: string, b: string) => {
    const pair = [a, b].sort().join("|");
    return (
      pair === "alex|riley" ||
      pair === "quinn|alex" ||
      pair === "quinn|riley"
    );
  };
  const members = [alex, riley, quinn, sam];
  // Alex ATA + Riley softphone + Quinn ATA + Sam ATA (no Circle).
  const analog = [alex, quinn, sam];
  assert.deepEqual(analogCircleTalkPeers(members, alex, analog, canTalk).sort(), [
    quinn,
  ]);
  assert.deepEqual(analogCircleTalkPeers(members, quinn, analog, canTalk).sort(), [
    alex,
  ]);
  assert.deepEqual(analogCircleTalkPeers(members, sam, analog, canTalk), []);
});