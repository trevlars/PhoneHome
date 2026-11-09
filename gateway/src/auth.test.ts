import assert from "node:assert/strict";
import test from "node:test";
import { signInstanceToken, verifyInstanceToken } from "./auth.js";

const secret = "this-is-a-long-test-instance-secret";

test("instance token verifies with the matching secret", () => {
  const token = signInstanceToken("inst_test", secret, 1_000);
  const claims = verifyInstanceToken(token, (id) => (id === "inst_test" ? secret : undefined), 1_001);
  assert.equal(claims.sub, "inst_test");
  assert.equal(claims.aud, "phonehome-push-gateway");
});

test("instance token rejects expiry and wrong secrets", () => {
  const token = signInstanceToken("inst_test", secret, 1_000, 30);
  assert.throws(
    () => verifyInstanceToken(token, () => secret, 1_031),
    /Expired/
  );
  assert.throws(
    () => verifyInstanceToken(token, () => "different-long-instance-secret", 1_001),
    /Invalid/
  );
});
