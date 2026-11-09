import assert from "node:assert/strict";
import test from "node:test";
import { sendIosVoipPush } from "./pushGatewayClient.js";

test("managed push sends minimal metadata with a short-lived instance token", async () => {
  const previous = {
    url: process.env.PUSH_GATEWAY_URL,
    id: process.env.MOTHERSHIP_INSTANCE_ID,
    secret: process.env.MOTHERSHIP_INSTANCE_SECRET,
    nodeEnv: process.env.NODE_ENV,
  };
  const originalFetch = globalThis.fetch;
  process.env.PUSH_GATEWAY_URL = "http://push.test";
  process.env.MOTHERSHIP_INSTANCE_ID = "inst_test";
  process.env.MOTHERSHIP_INSTANCE_SECRET = "test-instance-secret-that-is-long-enough";
  process.env.NODE_ENV = "test";
  let requestBody: Record<string, unknown> | null = null;
  let authorization = "";
  globalThis.fetch = (async (_input, init) => {
    authorization = String((init?.headers as Record<string, string>)?.authorization || "");
    requestBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    return new Response(
      JSON.stringify({ ok: true, status: 200, production: true }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;
  try {
    const result = await sendIosVoipPush(
      "a".repeat(64),
      {
        callId: "call_test",
        handle: "line_a",
        callerName: "Family",
        fromLineId: "line_a",
        toLineId: "line_b",
      },
      "production"
    );
    assert.equal(result.ok, true);
    assert.match(authorization, /^Bearer [^.]+\.[^.]+\.[^.]+$/);
    assert.equal(requestBody?.deviceToken, "a".repeat(64));
    assert.equal(requestBody?.storedApnsEnv, "production");
    assert.deepEqual((requestBody?.payload as { callId: string }).callId, "call_test");
    assert.equal("sdp" in requestBody, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous.url === undefined) delete process.env.PUSH_GATEWAY_URL;
    else process.env.PUSH_GATEWAY_URL = previous.url;
    if (previous.id === undefined) delete process.env.MOTHERSHIP_INSTANCE_ID;
    else process.env.MOTHERSHIP_INSTANCE_ID = previous.id;
    if (previous.secret === undefined) delete process.env.MOTHERSHIP_INSTANCE_SECRET;
    else process.env.MOTHERSHIP_INSTANCE_SECRET = previous.secret;
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
  }
});
