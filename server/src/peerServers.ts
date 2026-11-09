import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { nanoid } from "nanoid";

export type PeerServer = {
  id: string;
  name: string;
  signaling_url: string;
  public_key: string | null;
  trusted: number;
  invite_token_hash: string | null;
  peer_instance_id: string | null;
  created_at: string;
};

export function ensurePeerServerSchema(db: Database.Database): void {
  const cols = db.prepare(`PRAGMA table_info(peer_servers)`).all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("invite_token_hash")) {
    db.exec(`ALTER TABLE peer_servers ADD COLUMN invite_token_hash TEXT`);
  }
  if (!names.has("peer_instance_id")) {
    db.exec(`ALTER TABLE peer_servers ADD COLUMN peer_instance_id TEXT`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS peer_signal_inbox (
      id TEXT PRIMARY KEY,
      peer_id TEXT NOT NULL,
      from_line_id TEXT NOT NULL,
      to_line_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      consumed INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_peer_signal_peer ON peer_signal_inbox(peer_id, consumed);
  `);
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createPeerInvite(
  db: Database.Database,
  opts: { name: string; localSignalingUrl: string; localInstanceId: string }
): { peerId: string; inviteToken: string; inviteUrl: string } {
  ensurePeerServerSchema(db);
  const peerId = `peer_${nanoid(14)}`;
  const inviteToken = `phpeer_${crypto.randomBytes(24).toString("base64url")}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO peer_servers
       (id, name, signaling_url, public_key, trusted, invite_token_hash, peer_instance_id, created_at)
     VALUES (?, ?, '', NULL, 0, ?, NULL, ?)`
  ).run(peerId, opts.name.trim().slice(0, 80) || "Peer mothership", hashToken(inviteToken), now);

  const base = opts.localSignalingUrl.replace(/\/$/, "");
  const inviteUrl = `${base}/peer-join?peer=${encodeURIComponent(peerId)}&token=${encodeURIComponent(inviteToken)}&from=${encodeURIComponent(opts.localInstanceId)}&signal=${encodeURIComponent(base)}`;
  return { peerId, inviteToken, inviteUrl };
}

export function listPeerServers(db: Database.Database): PeerServer[] {
  ensurePeerServerSchema(db);
  return db
    .prepare(
      `SELECT id, name, signaling_url, public_key, trusted, invite_token_hash, peer_instance_id, created_at
       FROM peer_servers ORDER BY created_at DESC`
    )
    .all() as PeerServer[];
}

/** Remote mothership accepts our invite — we store their signaling URL and trust them. */
export function acceptInboundPeer(
  db: Database.Database,
  opts: {
    peerId: string;
    inviteToken: string;
    remoteSignalingUrl: string;
    remoteInstanceId: string;
    remotePublicKey?: string | null;
    remoteName?: string;
  }
): { ok: true; peer: PeerServer } | { ok: false; error: string } {
  ensurePeerServerSchema(db);
  const row = db.prepare(`SELECT * FROM peer_servers WHERE id = ?`).get(opts.peerId) as
    | PeerServer
    | undefined;
  if (!row) return { ok: false, error: "Unknown peer invite" };
  if (!row.invite_token_hash || row.invite_token_hash !== hashToken(opts.inviteToken)) {
    return { ok: false, error: "Invalid peer invite token" };
  }
  const nowName = (opts.remoteName || row.name || "Peer").slice(0, 80);
  db.prepare(
    `UPDATE peer_servers
     SET name = ?, signaling_url = ?, public_key = ?, trusted = 1,
         peer_instance_id = ?, invite_token_hash = NULL
     WHERE id = ?`
  ).run(
    nowName,
    opts.remoteSignalingUrl.replace(/\/$/, ""),
    opts.remotePublicKey || null,
    opts.remoteInstanceId,
    opts.peerId
  );
  const peer = db.prepare(`SELECT * FROM peer_servers WHERE id = ?`).get(opts.peerId) as PeerServer;
  return { ok: true, peer };
}

/** We accept a remote peer's invite by posting to them, then storing a local trusted row. */
export function recordOutboundPeer(
  db: Database.Database,
  opts: {
    name: string;
    signalingUrl: string;
    peerInstanceId: string;
    publicKey?: string | null;
  }
): PeerServer {
  ensurePeerServerSchema(db);
  const id = `peer_${nanoid(14)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO peer_servers
       (id, name, signaling_url, public_key, trusted, invite_token_hash, peer_instance_id, created_at)
     VALUES (?, ?, ?, ?, 1, NULL, ?, ?)`
  ).run(
    id,
    opts.name.trim().slice(0, 80) || "Peer mothership",
    opts.signalingUrl.replace(/\/$/, ""),
    opts.publicKey || null,
    opts.peerInstanceId,
    now
  );
  return db.prepare(`SELECT * FROM peer_servers WHERE id = ?`).get(id) as PeerServer;
}

export function getTrustedPeer(db: Database.Database, peerId: string): PeerServer | null {
  ensurePeerServerSchema(db);
  const row = db
    .prepare(`SELECT * FROM peer_servers WHERE id = ? AND trusted = 1`)
    .get(peerId) as PeerServer | undefined;
  return row || null;
}

/** Enqueue a signaling payload for a peer (local inbox when remote posts to us). */
export function enqueuePeerSignal(
  db: Database.Database,
  opts: {
    peerId: string;
    fromLineId: string;
    toLineId: string;
    payload: unknown;
  }
): string {
  ensurePeerServerSchema(db);
  const id = `psig_${nanoid(16)}`;
  db.prepare(
    `INSERT INTO peer_signal_inbox
       (id, peer_id, from_line_id, to_line_id, payload_json, created_at, consumed)
     VALUES (?, ?, ?, ?, ?, ?, 0)`
  ).run(
    id,
    opts.peerId,
    opts.fromLineId,
    opts.toLineId,
    JSON.stringify(opts.payload),
    new Date().toISOString()
  );
  return id;
}

export function drainPeerSignals(
  db: Database.Database,
  peerId: string,
  limit = 50
): Array<{
  id: string;
  from_line_id: string;
  to_line_id: string;
  payload: unknown;
  created_at: string;
}> {
  ensurePeerServerSchema(db);
  const rows = db
    .prepare(
      `SELECT id, from_line_id, to_line_id, payload_json, created_at
       FROM peer_signal_inbox
       WHERE peer_id = ? AND consumed = 0
       ORDER BY created_at ASC LIMIT ?`
    )
    .all(peerId, limit) as Array<{
    id: string;
    from_line_id: string;
    to_line_id: string;
    payload_json: string;
    created_at: string;
  }>;
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    db.prepare(
      `UPDATE peer_signal_inbox SET consumed = 1 WHERE id IN (${ids.map(() => "?").join(",")})`
    ).run(...ids);
  }
  return rows.map((r) => ({
    id: r.id,
    from_line_id: r.from_line_id,
    to_line_id: r.to_line_id,
    payload: JSON.parse(r.payload_json),
    created_at: r.created_at,
  }));
}

/**
 * Forward an offer/answer/candidate to a trusted peer's mothership.
 * Remote must expose POST /api/peers/inbound-signal with shared invite material later;
 * for now we POST to their /api/peers/inbound-signal with peer token header.
 */
export async function forwardSignalToPeer(
  peer: PeerServer,
  body: {
    fromLineId: string;
    toLineId: string;
    payload: unknown;
    fromInstanceId: string;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!peer.signaling_url || !peer.trusted) {
    return { ok: false, error: "Peer is not trusted yet" };
  }
  try {
    const res = await fetch(`${peer.signaling_url.replace(/\/$/, "")}/api/peers/inbound-signal`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-phonehome-peer-instance": body.fromInstanceId,
      },
      body: JSON.stringify({
        peerInstanceId: peer.peer_instance_id,
        fromLineId: body.fromLineId,
        toLineId: body.toLineId,
        payload: body.payload,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `Peer signal failed (${res.status}): ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Peer unreachable" };
  }
}

/** Local Circle check before placing a cross-mothership call. */
export function localAllowlistAllows(
  db: Database.Database,
  fromHouseholdId: string,
  remoteLineRef: string
): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM allowlist WHERE household_id = ? AND target_line_id = ?`
    )
    .get(fromHouseholdId, remoteLineRef);
  return Boolean(row);
}
