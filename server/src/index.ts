import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import {
  addAllowlist,
  addLine,
  bootstrapAdmin,
  canCall,
  createHousehold,
  createInvite,
  endCallLog,
  expireStaleRings,
  householdSnapshot,
  logCall,
  loginWithSetupCode,
  redeemInvite,
  registerParent,
  removeAllowlist,
  updateAllowlistEntry,
  updateHouseholdRules,
  verifyParentPin,
  getSessionUser,
} from "./api.js";
import { openDb, type LineType } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const PORT = Number(process.env.PORT || 8787);
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "kids-landline.db");
const WEB_DIR = path.join(ROOT, "web", "public");

function buildIceServers(): RTCIceServerLike[] {
  const servers: RTCIceServerLike[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  const turnUrls = (process.env.TURN_URLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (turnUrls.length && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    servers.push({
      urls: turnUrls,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  return servers;
}

type RTCIceServerLike = { urls: string | string[]; username?: string; credential?: string };
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = openDb(DB_PATH);
const boot = bootstrapAdmin(db);

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

function sessionId(req: express.Request): string | undefined {
  return (req.cookies?.kl_session as string | undefined) || (req.headers["x-session-id"] as string | undefined);
}

function requireUser(req: express.Request, res: express.Response) {
  const user = getSessionUser(db, sessionId(req));
  if (!user) {
    res.status(401).json({ error: "Not signed in" });
    return null;
  }
  return user;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "kids-landline", stage: 1 });
});

app.get("/api/ice", (_req, res) => {
  res.json({ iceServers: buildIceServers() });
});

app.get("/api/bootstrap", (_req, res) => {
  const initialized = Boolean(db.prepare(`SELECT 1 FROM sessions LIMIT 1`).get());
  res.json({
    initialized,
    hostSetupHint: initialized ? null : "Use the printed setup code from server logs on first boot",
  });
});

app.post("/api/auth/login", (req, res) => {
  try {
    const { code, displayName } = req.body as { code?: string; displayName?: string };
    if (!code) return res.status(400).json({ error: "code required" });
    const { user, session } = loginWithSetupCode(db, String(code), displayName);
    res.cookie("kl_session", session.id, { httpOnly: true, sameSite: "lax", maxAge: 30 * 864e5 });
    res.json({ user, sessionId: session.id });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/auth/register", (req, res) => {
  try {
    const { displayName } = req.body as { displayName?: string };
    const result = registerParent(db, displayName || "Parent");
    res.cookie("kl_session", result.sessionId, { httpOnly: true, sameSite: "lax", maxAge: 30 * 864e5 });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/auth/logout", (req, res) => {
  const sid = sessionId(req);
  if (sid) db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sid);
  res.clearCookie("kl_session");
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const snap = householdSnapshot(db, user.id);
  res.json({ user, ...snap, userIncluded: true });
});

app.post("/api/households", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const { name } = req.body as { name?: string };
  const household = createHousehold(db, user.id, name || "Family");
  res.json({ household });
});

app.patch("/api/households/:id/rules", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const household = updateHouseholdRules(db, req.params.id, req.body);
    res.json({ household });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/households/:id/lines", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const { name, type } = req.body as { name?: string; type?: LineType };
  const line = addLine(db, req.params.id, user.id, name || "Softphone", type || "softphone");
  res.json({ line });
});

app.post("/api/households/:id/invites", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const invite = createInvite(db, req.params.id, user.id);
  const base = `${req.protocol}://${req.get("host")}`;
  res.json({
    invite,
    shareUrl: `${base}/?invite=${invite.code}`,
    shareText: `Join our Kids Landline — a private family phone (code ${invite.code})`,
  });
});

app.post("/api/invites/redeem", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const { code, householdName } = req.body as { code?: string; householdName?: string };
    const result = redeemInvite(db, String(code || ""), user.id, householdName || "Family");
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.post("/api/households/:id/allowlist", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const { targetLineId, label, speedDial, favorite } = req.body as {
    targetLineId?: string;
    label?: string;
    speedDial?: number;
    favorite?: boolean;
  };
  if (!targetLineId) return res.status(400).json({ error: "targetLineId required" });
  const entry = addAllowlist(db, req.params.id, targetLineId, label || "Contact", {
    speedDial,
    favorite,
  });
  res.json({ entry });
});

app.patch("/api/households/:id/allowlist/:entryId", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const entry = updateAllowlistEntry(db, req.params.id, req.params.entryId, req.body || {});
    res.json({ entry });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

app.delete("/api/households/:id/allowlist/:entryId", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  removeAllowlist(db, req.params.id, req.params.entryId);
  res.json({ ok: true });
});

app.post("/api/households/:id/pin/verify", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const hh = db.prepare(`SELECT * FROM households WHERE id = ?`).get(req.params.id) as
    | import("./db.js").Household
    | undefined;
  if (!hh) return res.status(404).json({ error: "Household not found" });
  const { pin } = req.body as { pin?: string };
  if (!verifyParentPin(hh, String(pin || ""))) {
    return res.status(403).json({ error: "Incorrect PIN" });
  }
  res.json({ ok: true });
});

app.post("/api/households/:id/voicemails/:vmId/listen", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  db.prepare(`UPDATE voicemails SET listened = 1 WHERE id = ? AND household_id = ?`).run(
    req.params.vmId,
    req.params.id
  );
  res.json({ ok: true });
});
app.get("/api/directory", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const snap = householdSnapshot(db, user.id);
  res.json({ directory: snap.directory });
});

app.use(express.static(WEB_DIR));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/ws")) return next();
  res.sendFile(path.join(WEB_DIR, "index.html"));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

type Client = {
  ws: WebSocket;
  userId?: string;
  lineId?: string;
};

const clients = new Set<Client>();

function send(ws: WebSocket, msg: unknown) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function findByLine(lineId: string): Client | undefined {
  let found: Client | undefined;
  for (const c of clients) {
    if (c.lineId === lineId) found = c; // prefer latest registration order
  }
  return found;
}

function claimLine(client: Client, lineId: string) {
  for (const c of [...clients]) {
    if (c !== client && c.lineId === lineId) {
      console.log(`[ws] replacing stale socket for ${lineId}`);
      try {
        c.ws.close();
      } catch {
        /* ignore */
      }
      clients.delete(c);
    }
  }
  client.lineId = lineId;
}

wss.on("connection", (ws) => {
  const client: Client = { ws };
  clients.add(client);

  ws.on("message", (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    const type = String(msg.type || "");

    if (type === "hello") {
      const sid = String(msg.sessionId || "");
      const user = getSessionUser(db, sid);
      if (!user) {
        send(ws, { type: "error", error: "bad session" });
        return;
      }
      client.userId = user.id;
      const lineId = String(msg.lineId || "");
      if (lineId) {
        claimLine(client, lineId);
        db.prepare(`UPDATE lines SET online = 1 WHERE id = ?`).run(lineId);
      }
      send(ws, { type: "welcome", userId: user.id, lineId: client.lineId });
      console.log(`[ws] hello line=${client.lineId} user=${user.display_name}`);
      return;
    }

    if (type === "call.offer") {
      const fromLineId = String(msg.fromLineId || client.lineId || "");
      const toLineId = String(msg.toLineId || "");
      const check = canCall(db, fromLineId, toLineId);
      if (!check.ok) {
        console.log(`[call] rejected ${fromLineId}→${toLineId}: ${check.reason}`);
        logCall(db, fromLineId, toLineId, "blocked");
        send(ws, { type: "call.rejected", reason: check.reason });
        return;
      }
      const target = findByLine(toLineId);
      const call = logCall(db, fromLineId, toLineId, "ringing");
      if (!target) {
        endCallLog(db, call.id, "offline");
        console.log(`[call] offline ${call.id} ${fromLineId}→${toLineId}`);
        send(ws, {
          type: "call.rejected",
          reason: "Their phone isn’t open right now. Ask them to keep the Kids Landline tab open.",
        });
        return;
      }
      send(target.ws, {
        type: "call.offer",
        callId: call.id,
        fromLineId,
        toLineId,
        sdp: msg.sdp,
      });
      send(ws, { type: "call.ringing", callId: call.id });
      console.log(`[call] ringing ${call.id} ${fromLineId}→${toLineId}`);
      return;
    }

    if (type === "call.answer" || type === "call.ice" || type === "call.hangup") {
      const otherId =
        client.lineId === String(msg.fromLineId) ? String(msg.toLineId) : String(msg.fromLineId);
      const target = findByLine(otherId);
      if (!target) {
        console.log(`[call] ${type} no peer for ${otherId} (from ${client.lineId})`);
        if (type === "call.answer") {
          send(ws, { type: "call.rejected", reason: "Caller disconnected before answer" });
        }
      } else {
        send(target.ws, msg);
      }
      if (type === "call.hangup" && msg.callId) {
        endCallLog(db, String(msg.callId), "ended");
        console.log(`[call] hangup ${msg.callId}`);
      }
      if (type === "call.answer" && msg.callId) {
        db.prepare(`UPDATE call_logs SET outcome = 'answered', ended_at = NULL WHERE id = ?`).run(
          String(msg.callId)
        );
        console.log(`[call] answered ${msg.callId}`);
      }
      return;
    }
  });

  ws.on("close", () => {
    if (client.lineId) {
      // Only mark offline if this was still the active socket for the line
      const still = findByLine(client.lineId);
      if (!still || still === client) {
        db.prepare(`UPDATE lines SET online = 0 WHERE id = ?`).run(client.lineId);
        const open = db
          .prepare(
            `SELECT id, from_line_id, to_line_id FROM call_logs
             WHERE outcome = 'ringing' AND ended_at IS NULL AND to_line_id = ?`
          )
          .all(client.lineId) as { id: string; from_line_id: string; to_line_id: string }[];
        for (const row of open) {
          endCallLog(db, row.id, "missed");
          const caller = findByLine(row.from_line_id);
          if (caller) {
            send(caller.ws, {
              type: "call.rejected",
              callId: row.id,
              reason: "They closed the page before answering",
            });
          }
          console.log(`[call] missed (disconnect) ${row.id}`);
        }
      }
    }
    clients.delete(client);
  });
});
setInterval(() => {
  const n = expireStaleRings(db);
  if (n) console.log(`[call] expired ${n} stale ring(s)`);
}, 10_000);
server.listen(PORT, () => {
  console.log("");
  console.log(`Kids Landline → http://127.0.0.1:${PORT}`);
  if (boot.fresh && boot.setupCode) {
    console.log("");
    console.log("╔══════════════════════════════════════╗");
    console.log(`║  HOST SETUP CODE:  ${boot.setupCode}           ║`);
    console.log("╚══════════════════════════════════════╝");
    console.log("Open the site → “I’m hosting” → enter this code.");
    console.log("");
    fs.writeFileSync(path.join(DATA_DIR, "HOST_CODE.txt"), `${boot.setupCode}\n`);
  } else {
    console.log("Database already initialized. Fresh start: rm -rf data && restart.");
    console.log("");
  }
  fs.writeFileSync(
    path.join(DATA_DIR, "bootstrap.json"),
    JSON.stringify(
      {
        port: PORT,
        setupCode: boot.fresh ? boot.setupCode : undefined,
        createdAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
});
