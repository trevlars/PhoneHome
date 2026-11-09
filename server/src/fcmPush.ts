/**
 * Firebase Cloud Messaging HTTP v1 for the Android shell.
 *
 * Env:
 *   FCM_SERVICE_ACCOUNT_JSON   path to a service-account JSON, or the raw JSON
 *   FCM_PROJECT_ID             optional override of the JSON project_id
 *
 * Data-only, high priority. No SDP, no notification payload (the app draws
 * the incoming UI). Without credentials, send helpers no-op.
 */
import crypto from "node:crypto";
import fs from "node:fs";

export type FcmCallPayload = {
  callId: string;
  handle: string;
  callerName: string;
  fromLineId?: string;
  toLineId?: string;
};

export type FcmVoicemailPayload = {
  voicemailId: string;
  fromLabel: string;
  fromLineId?: string;
  toLineId?: string;
  unreadCount?: number;
};

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri: string;
};

type FcmMessage = {
  message: {
    token: string;
    data: Record<string, string>;
    android: { priority: "HIGH"; ttl: string };
  };
};

let cachedAccess: { token: string; exp: number } | null = null;

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function loadFcmServiceAccount(): ServiceAccount | null {
  const raw = (process.env.FCM_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) return null;
  let text = raw;
  if (!raw.startsWith("{")) {
    if (!fs.existsSync(raw)) return null;
    text = fs.readFileSync(raw, "utf8");
  }
  let parsed: Partial<ServiceAccount>;
  try {
    parsed = JSON.parse(text) as Partial<ServiceAccount>;
  } catch {
    return null;
  }
  const projectId = (process.env.FCM_PROJECT_ID || parsed.project_id || "").trim();
  const clientEmail = String(parsed.client_email || "").trim();
  const privateKey = String(parsed.private_key || "");
  if (!projectId || !clientEmail || !privateKey.includes("PRIVATE KEY")) return null;
  return {
    client_email: clientEmail,
    private_key: privateKey,
    project_id: projectId,
    token_uri: String(parsed.token_uri || "https://oauth2.googleapis.com/token"),
  };
}

export function fcmConfigured(): boolean {
  return Boolean(loadFcmServiceAccount());
}

function clip(value: string | undefined, max: number, fallback: string): string {
  const text = String(value || "").trim().slice(0, max);
  return text || fallback;
}

/** Data-only incoming-call message. Exported for tests. */
export function buildFcmCallMessage(token: string, payload: FcmCallPayload): FcmMessage {
  return {
    message: {
      token,
      data: {
        type: "incoming_call",
        callId: clip(payload.callId, 80, ""),
        handle: clip(payload.handle, 80, "PhoneHome"),
        callerName: clip(payload.callerName, 64, "Family"),
        fromLineId: clip(payload.fromLineId, 80, ""),
        toLineId: clip(payload.toLineId, 80, ""),
      },
      android: { priority: "HIGH", ttl: "30s" },
    },
  };
}

/** Data-only voicemail message. The app shows the notification. */
export function buildFcmVoicemailMessage(token: string, payload: FcmVoicemailPayload): FcmMessage {
  const unread = Math.max(0, Math.min(99, Math.floor(Number(payload.unreadCount) || 0)));
  return {
    message: {
      token,
      data: {
        type: "voicemail",
        callId: clip(payload.voicemailId, 80, ""),
        callerName: clip(payload.fromLabel, 40, "Someone"),
        fromLabel: clip(payload.fromLabel, 40, "Someone"),
        fromLineId: clip(payload.fromLineId, 80, ""),
        toLineId: clip(payload.toLineId, 80, ""),
        unreadCount: String(unread),
      },
      android: { priority: "HIGH", ttl: "86400s" },
    },
  };
}

export function fcmTokenShouldDrop(status: number, body: string): boolean {
  if (status === 404) return true;
  return /UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT/.test(body);
}

function serviceAccountJwt(sa: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64url(
    Buffer.from(
      JSON.stringify({
        iss: sa.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: sa.token_uri,
        iat: now,
        exp: now + 3600,
      })
    )
  );
  const unsigned = `${header}.${claims}`;
  const key = crypto.createPrivateKey(sa.private_key);
  const sig = crypto.sign("RSA-SHA256", Buffer.from(unsigned), key);
  return `${unsigned}.${base64url(sig)}`;
}

async function accessToken(sa: ServiceAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccess && cachedAccess.exp > now + 60) return cachedAccess.token;
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: serviceAccountJwt(sa),
  });
  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;
  cachedAccess = { token: json.access_token, exp: now + Number(json.expires_in || 3600) };
  return json.access_token;
}

export type FcmSendResult = { ok: boolean; status?: number; drop?: boolean; skipped?: boolean };

async function sendFcm(message: FcmMessage): Promise<FcmSendResult> {
  const sa = loadFcmServiceAccount();
  if (!sa) return { ok: false, skipped: true };
  try {
    const token = await accessToken(sa);
    if (!token) return { ok: false, status: 401 };
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(message),
      }
    );
    const text = await res.text();
    if (res.ok) return { ok: true, status: res.status };
    return { ok: false, status: res.status, drop: fcmTokenShouldDrop(res.status, text) };
  } catch (e) {
    console.warn(`[push] fcm send failed ${(e as Error).message}`);
    return { ok: false };
  }
}

export function sendFcmCall(deviceToken: string, payload: FcmCallPayload): Promise<FcmSendResult> {
  return sendFcm(buildFcmCallMessage(deviceToken, payload));
}

export function sendFcmVoicemail(
  deviceToken: string,
  payload: FcmVoicemailPayload
): Promise<FcmSendResult> {
  return sendFcm(buildFcmVoicemailMessage(deviceToken, payload));
}
