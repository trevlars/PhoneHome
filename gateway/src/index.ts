import express, { type NextFunction, type Request, type Response } from "express";
import { pathToFileURL } from "node:url";
import {
  apnsConfigured,
  normalizeDeviceToken,
  sendGatewayPush,
  type GatewayPushKind,
  type GatewayPushRequest,
  type GatewayPushResult,
} from "./apns.js";
import { parseInstanceSecrets, verifyInstanceToken } from "./auth.js";

type AuthedRequest = Request & { instanceId?: string };
type Sender = (kind: GatewayPushKind, request: GatewayPushRequest) => Promise<GatewayPushResult>;

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = Number(process.env.PUSH_RATE_PER_MINUTE || 120);
const rateByInstance = new Map<string, { window: number; count: number }>();

function takeRate(instanceId: string, now = Date.now()): boolean {
  const current = rateByInstance.get(instanceId);
  if (!current || now - current.window >= RATE_WINDOW_MS) {
    rateByInstance.set(instanceId, { window: now, count: 1 });
    return true;
  }
  if (current.count >= RATE_MAX) return false;
  current.count += 1;
  return true;
}

function instanceAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const raw = String(req.headers.authorization || "");
  const token = raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ ok: false, reason: "authentication-required" });
    return;
  }
  try {
    const secrets = parseInstanceSecrets();
    const claims = verifyInstanceToken(token, (id) => secrets.get(id));
    if (!takeRate(claims.sub)) {
      res.setHeader("Retry-After", "60");
      res.status(429).json({ ok: false, reason: "rate-limit" });
      return;
    }
    req.instanceId = claims.sub;
    next();
  } catch {
    res.status(401).json({ ok: false, reason: "invalid-instance-token" });
  }
}

function pushRequest(body: unknown): GatewayPushRequest {
  const input = (body || {}) as Partial<GatewayPushRequest>;
  const deviceToken = normalizeDeviceToken(String(input.deviceToken || ""));
  const payload = (input.payload || {}) as GatewayPushRequest["payload"];
  const callId = String(payload.callId || "").trim().slice(0, 160);
  if (deviceToken.length < 16) throw new Error("Invalid device token");
  if (!callId) throw new Error("callId required");
  const stored =
    input.storedApnsEnv === "production" || input.storedApnsEnv === "sandbox"
      ? input.storedApnsEnv
      : null;
  return {
    deviceToken,
    storedApnsEnv: stored,
    payload: { ...payload, callId },
    expirationSec: Math.max(0, Math.min(3600, Number(input.expirationSec) || 0)),
  };
}

export function createGatewayApp(sender: Sender = sendGatewayPush) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "phonehome-push-gateway", apnsConfigured: apnsConfigured() });
  });

  const route = (kind: GatewayPushKind) => async (req: AuthedRequest, res: Response) => {
    try {
      const request = pushRequest(req.body);
      const result = await sender(kind, request);
      console.log(
        `[push-gateway] instance=${req.instanceId} kind=${kind} callId=${request.payload.callId} ` +
          `ok=${result.ok} token=…${request.deviceToken.slice(-8)}`
      );
      res.status(result.ok ? 200 : result.status === 429 ? 429 : 502).json(result);
    } catch (error) {
      res.status(400).json({
        ok: false,
        reason: error instanceof Error ? error.message : "invalid-request",
      });
    }
  };

  app.post("/v1/push/ios/voip", instanceAuth, route("voip"));
  app.post("/v1/push/ios/alert", instanceAuth, route("alert"));
  return app;
}

const isMain = Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
if (isMain) {
  const port = Number(process.env.PORT || 8789);
  createGatewayApp().listen(port, "0.0.0.0", () => {
    console.log(`[push-gateway] listening on :${port}`);
  });
}
