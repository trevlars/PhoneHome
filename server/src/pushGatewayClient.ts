import crypto from "node:crypto";
import {
  apnsConfigured,
  sendIosAlertPush as sendLocalAlertPush,
  sendIosVoipPush as sendLocalVoipPush,
  type AlertPushPayload,
  type ApnsSendResult,
  type VoipPushPayload,
} from "./apnsVoip.js";
import { getManagedEntitlements } from "./managedEntitlements.js";

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function gatewayConfig(): { url: string; instanceId: string; secret: string } | null {
  const url = String(process.env.PUSH_GATEWAY_URL || "").trim().replace(/\/+$/, "");
  const instanceId = String(process.env.MOTHERSHIP_INSTANCE_ID || "").trim();
  const secret = String(process.env.MOTHERSHIP_INSTANCE_SECRET || "");
  if (!url) return null;
  if (!/^https:\/\//i.test(url) && process.env.NODE_ENV === "production") {
    throw new Error("PUSH_GATEWAY_URL must use HTTPS in production");
  }
  if (!instanceId || secret.length < 24) {
    throw new Error("Managed push requires MOTHERSHIP_INSTANCE_ID and a strong instance secret");
  }
  return { url, instanceId, secret };
}

function instanceToken(instanceId: string, secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: "phonehome-mothership",
      sub: instanceId,
      aud: "phonehome-push-gateway",
      iat: now,
      exp: now + 300,
    })
  );
  const unsigned = `${header}.${payload}`;
  const signature = base64url(crypto.createHmac("sha256", secret).update(unsigned).digest());
  return `${unsigned}.${signature}`;
}

async function gatewayPush(
  kind: "voip" | "alert",
  deviceToken: string,
  payload: VoipPushPayload | AlertPushPayload,
  storedEnv?: string | null
): Promise<ApnsSendResult> {
  const cfg = gatewayConfig();
  if (!cfg) {
    return kind === "voip"
      ? sendLocalVoipPush(deviceToken, payload as VoipPushPayload, storedEnv)
      : sendLocalAlertPush(deviceToken, payload as AlertPushPayload, storedEnv);
  }
  const entitlements = getManagedEntitlements();
  if (entitlements && !entitlements.iosPush) {
    return { ok: false, status: 402, reason: "ios-push-not-entitled" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${cfg.url}/v1/push/ios/${kind}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${instanceToken(cfg.instanceId, cfg.secret)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        deviceToken,
        storedApnsEnv:
          storedEnv === "production" || storedEnv === "sandbox" ? storedEnv : null,
        payload,
        expirationSec:
          kind === "voip" ? 30 : (payload as AlertPushPayload).type === "voicemail" ? 3600 : 60,
      }),
      signal: controller.signal,
    });
    const result = (await response.json()) as ApnsSendResult;
    return {
      ok: Boolean(result.ok),
      status: result.status ?? response.status,
      reason: result.reason,
      production: result.production,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function pushDeliveryConfigured(): boolean {
  try {
    return Boolean(gatewayConfig()) || apnsConfigured();
  } catch {
    return false;
  }
}

export function sendIosVoipPush(
  deviceToken: string,
  payload: VoipPushPayload,
  storedEnv?: string | null
): Promise<ApnsSendResult> {
  return gatewayPush("voip", deviceToken, payload, storedEnv);
}

export function sendIosAlertPush(
  deviceToken: string,
  payload: AlertPushPayload,
  storedEnv?: string | null
): Promise<ApnsSendResult> {
  return gatewayPush("alert", deviceToken, payload, storedEnv);
}
