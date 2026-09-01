/**
 * Turning a bridge `/sip-status` answer into what the parent app is allowed to show.
 *
 * The rule that matters: "Working" requires a check that actually succeeded and
 * actually found a registration. A bridge timeout, a missing BRIDGE_SECRET, a
 * dead ARI, or a reply we can't parse are all `unknown` — the UI says
 * "Can't check" and directory presence stays offline. During the fail2ban
 * self-ban outage the old code showed a green "Working" chip while no SIP
 * traffic could reach FreePBX at all.
 */

export type AtaStatusKind = "not_configured" | "online" | "offline" | "unknown";

export type BridgeSipStatus = {
  /** The check itself completed (no transport/auth/parse failure). */
  ok: boolean;
  /** Evidence of a usable Contact. */
  registered: boolean;
  /** Worth attempting an originate even if registration could not be verified. */
  callable: boolean;
  state: string;
  /** How much the bridge trusts this answer: contact detail vs bare endpoint state. */
  confidence: "high" | "low" | "none";
  /** Which source answered — "ami-contacts", "ari-endpoint-state", … */
  method: string;
  /** Usable contacts when the bridge could count them. */
  contacts: number | null;
  reason?: string;
};

const CONFIDENCE = new Set(["high", "low", "none"]);

export function unknownSipStatus(reason: string): BridgeSipStatus {
  return {
    ok: false,
    registered: false,
    callable: false,
    state: "unknown",
    confidence: "none",
    method: "none",
    contacts: null,
    reason,
  };
}

/**
 * Normalize a bridge reply. Anything we can't read is inconclusive, and an
 * older bridge that predates `callable`/`confidence` still works: it just
 * reports low confidence.
 */
export function parseBridgeSipStatus(body: unknown, httpOk: boolean): BridgeSipStatus {
  if (!body || typeof body !== "object") {
    return unknownSipStatus("bridge sent no readable status");
  }
  const raw = body as Record<string, unknown>;
  const ok = httpOk && raw.ok === true;
  const registered = ok && raw.registered === true;
  const state = String(raw.state || "unknown").toLowerCase();
  const confidence = CONFIDENCE.has(String(raw.confidence))
    ? (String(raw.confidence) as BridgeSipStatus["confidence"])
    : registered
      ? "low"
      : "none";
  const contacts = typeof raw.contacts === "number" ? raw.contacts : null;
  const reason = raw.reason ? String(raw.reason) : raw.error ? String(raw.error) : undefined;
  return {
    ok,
    registered,
    callable: typeof raw.callable === "boolean" ? raw.callable : registered,
    state,
    confidence,
    method: raw.method ? String(raw.method) : "unknown",
    contacts,
    reason,
  };
}

/**
 * Status shown to parents. `online` demands ok + registered + an online state;
 * `offline` demands a check that succeeded and said so. Everything else is
 * `unknown` on purpose.
 */
export function deriveAtaStatus(sip: BridgeSipStatus): {
  status: AtaStatusKind;
  registered: boolean;
} {
  if (sip.ok && sip.registered && sip.state === "online") {
    return { status: "online", registered: true };
  }
  if (sip.ok && !sip.registered && sip.state === "offline") {
    return { status: "offline", registered: false };
  }
  return { status: "unknown", registered: false };
}

/** Only a confirmed registration counts as ATA presence in the directory. */
export function ataPresenceRegistered(sip: BridgeSipStatus): boolean {
  return deriveAtaStatus(sip).status === "online";
}

/**
 * Inbound to a line with an ATA: ring the landline unless we are sure it is offline.
 * Brief "unknown" during FreePBX/PJSIP reload must not skip FXS and only VoIP-wake
 * the app (landline never rings; softphone often no-answers).
 */
export function shouldAttemptFxsInbound(sip: BridgeSipStatus): boolean {
  if (sip.callable || sip.registered) return true;
  // Confirmed dead Contact only — completed check, high confidence, offline.
  if (
    sip.ok &&
    sip.state === "offline" &&
    sip.confidence === "high" &&
    !sip.registered &&
    !sip.callable
  ) {
    return false;
  }
  return true;
}
