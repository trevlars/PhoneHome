import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { signInstanceToken } from "./auth.js";
import { createGatewayApp } from "./index.js";

const instanceId = "inst_routes";
const secret = "routes-test-secret-is-long-enough";

async function withServer(
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const app = createGatewayApp(async (kind, request) => ({
    ok: true,
    status: 200,
    production: request.storedApnsEnv === "production",
    reason: kind,
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const address = server.address() as AddressInfo;
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

test("push routes require instance authentication", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/push/ios/voip`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 401);
  });
});

test("authenticated gateway relays only validated minimal push input", async () => {
  const previous = process.env.MOTHERSHIP_INSTANCE_SECRETS;
  process.env.MOTHERSHIP_INSTANCE_SECRETS = JSON.stringify({ [instanceId]: secret });
  try {
    await withServer(async (baseUrl) => {
      const token = signInstanceToken(instanceId, secret);
      const response = await fetch(`${baseUrl}/v1/push/ios/voip`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          deviceToken: "a".repeat(64),
          storedApnsEnv: "production",
          payload: {
            callId: "call_1",
            callerName: "Alex",
            fromLineId: "line_a",
            toLineId: "line_b",
          },
        }),
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as { ok: boolean; production: boolean; reason: string };
      assert.equal(body.ok, true);
      assert.equal(body.production, true);
      assert.equal(body.reason, "voip");
    });
  } finally {
    if (previous === undefined) delete process.env.MOTHERSHIP_INSTANCE_SECRETS;
    else process.env.MOTHERSHIP_INSTANCE_SECRETS = previous;
  }
});
