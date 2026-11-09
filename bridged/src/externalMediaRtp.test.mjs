import assert from "node:assert/strict";
import test from "node:test";
import {
  parseExternalMediaRtpEndpoint,
  resolveExternalMediaRtpEndpoint,
} from "./externalMediaRtp.mjs";

test("parses Asterisk UnicastRTP endpoint", () => {
  assert.deepEqual(parseExternalMediaRtpEndpoint("192.168.2.105", "18462", "192.168.2.105"), {
    address: "192.168.2.105",
    port: 18462,
  });
});

test("replaces wildcard bind address with ARI host", () => {
  assert.deepEqual(parseExternalMediaRtpEndpoint("0.0.0.0", "18462", "192.168.2.105"), {
    address: "192.168.2.105",
    port: 18462,
  });
});

test("rejects invalid address or port", () => {
  assert.equal(parseExternalMediaRtpEndpoint("not-an-ip", "18462", "192.168.2.105"), null);
  assert.equal(parseExternalMediaRtpEndpoint("192.168.2.105", "0", "192.168.2.105"), null);
  assert.equal(parseExternalMediaRtpEndpoint("192.168.2.105", "70000", "192.168.2.105"), null);
});

test("resolves endpoint through ARI channel variables", async () => {
  const channel = {
    async getChannelVar({ variable }) {
      return {
        value:
          variable === "UNICASTRTP_LOCAL_ADDRESS"
            ? "192.168.2.105"
            : "18462",
      };
    },
  };
  assert.deepEqual(
    await resolveExternalMediaRtpEndpoint(channel, { fallbackAddress: "192.168.2.105" }),
    { address: "192.168.2.105", port: 18462 }
  );
});

test("retries while Asterisk publishes channel variables", async () => {
  let portReads = 0;
  const channel = {
    async getChannelVar({ variable }) {
      if (variable === "UNICASTRTP_LOCAL_ADDRESS") return { value: "0.0.0.0" };
      portReads += 1;
      return { value: portReads < 2 ? "" : "18462" };
    },
  };
  assert.deepEqual(
    await resolveExternalMediaRtpEndpoint(channel, {
      fallbackAddress: "192.168.2.105",
      attempts: 2,
      delayMs: 0,
    }),
    { address: "192.168.2.105", port: 18462 }
  );
});
