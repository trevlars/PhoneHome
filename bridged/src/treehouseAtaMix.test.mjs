import assert from "node:assert/strict";
import test from "node:test";
import { analogAnnounceTargets, analogEdgesToLink } from "./treehouseAtaMix.mjs";

test("analogEdgesToLink only connects present Circle peers", () => {
  assert.deepEqual(
    analogEdgesToLink("alex", ["riley", "quinn", "sam"], ["riley", "quinn"]).sort(),
    ["quinn", "riley"]
  );
  assert.deepEqual(analogEdgesToLink("alex", ["quinn"], ["sam"]), []);
  assert.deepEqual(analogEdgesToLink("alex", ["alex", "quinn"], ["quinn"]), ["quinn"]);
});

test("analogAnnounceTargets includes child and linked peers", () => {
  assert.deepEqual(analogAnnounceTargets("alex", ["quinn", "riley"]).sort(), [
    "quinn",
    "alex",
    "riley",
  ]);
  assert.deepEqual(analogAnnounceTargets("alex", []), ["alex"]);
});
