/**
 * Optional AMI lookup of PJSIP AOR contacts.
 *
 * ARI cannot list contacts — `endpoints.get` only returns an endpoint `state`,
 * and with `qualify_frequency=0` Asterisk reports that state as "online" even
 * when the AOR has no Contact at all. AMI `PJSIPShowEndpoint` does emit one
 * `ContactStatusDetail` per contact, which is the only registration evidence
 * the bridge can get without shell access to the PBX.
 *
 * Disabled unless AMI_USER + AMI_PASSWORD are set (see bridged/README.md).
 * Nothing here logs; the AMI secret must never reach stdout.
 */
import net from "node:net";

/** Contact rows in these states exist but cannot carry a call. */
const UNUSABLE_STATUS = new Set(["unreachable", "removed"]);

/**
 * Split an AMI stream into packets of lowercased header → value.
 * Lines without a colon (the "Asterisk Call Manager/x.y.z" banner) are dropped.
 * @param {string} text
 * @returns {Record<string, string>[]}
 */
export function parseAmiPackets(text) {
  const packets = [];
  for (const block of String(text || "").split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue;
    /** @type {Record<string, string>} */
    const packet = {};
    for (const line of block.split(/\r?\n/)) {
      const sep = line.indexOf(":");
      if (sep <= 0) continue;
      const key = line.slice(0, sep).trim().toLowerCase();
      if (key) packet[key] = line.slice(sep + 1).trim();
    }
    if (Object.keys(packet).length) packets.push(packet);
  }
  return packets;
}

/**
 * Reduce PJSIPShowEndpoint packets to contact evidence for one extension.
 * @param {Record<string, string>[]} packets
 * @param {string} extension
 * @returns {{ total: number, usable: number, contacts: { aor: string, status: string, usable: boolean, rtt_ms: number|null }[] }}
 */
export function contactEvidence(packets, extension) {
  const ext = String(extension || "").replace(/\D/g, "");
  const contacts = [];
  for (const packet of packets) {
    if (String(packet.event || "").toLowerCase() !== "contactstatusdetail") continue;
    const aor = String(packet.aor || "");
    const endpointName = String(packet.endpointname || "");
    if (
      ext &&
      aor.replace(/\D/g, "") !== ext &&
      endpointName.replace(/\D/g, "") !== ext
    ) {
      continue;
    }
    const status = String(packet.status || "Unknown");
    const hasUri = Boolean(String(packet.uri || "").trim());
    const rttUsec = Number(packet.roundtripusec);
    contacts.push({
      aor: aor || ext,
      status,
      usable: hasUri && !UNUSABLE_STATUS.has(status.toLowerCase()),
      rtt_ms: Number.isFinite(rttUsec) && rttUsec > 0 ? Math.round(rttUsec / 100) / 10 : null,
    });
  }
  return {
    total: contacts.length,
    usable: contacts.filter((c) => c.usable).length,
    contacts,
  };
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ host: string|null, port: number, username: string, password: string, timeoutMs: number } | null}
 */
export function amiConfigFromEnv(env = process.env) {
  const username = String(env.AMI_USER || "").trim();
  const password = String(env.AMI_PASSWORD || "").trim();
  if (!username || !password) return null;
  return {
    host: String(env.AMI_HOST || "").trim() || null,
    port: Number(env.AMI_PORT || 5038),
    username,
    password,
    timeoutMs: Number(env.AMI_TIMEOUT_MS || 4000),
  };
}

/**
 * Log in, run PJSIPShowEndpoint, and summarize the contacts. Rejects on any
 * transport/auth failure so callers can report "inconclusive" instead of "OK".
 * @param {{ host: string, port?: number, username: string, password: string, extension: string, timeoutMs?: number, createConnection?: Function }} opts
 */
export function fetchAmiContactEvidence(opts) {
  const {
    host,
    port = 5038,
    username,
    password,
    extension,
    timeoutMs = 4000,
    createConnection,
  } = opts || {};
  const ext = String(extension || "").replace(/\D/g, "");
  return new Promise((resolve, reject) => {
    if (!ext) return reject(new Error("extension required"));
    const actionId = `ph-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
    const connect = createConnection || ((o) => net.createConnection(o));
    const socket = connect({ host, port });
    let settled = false;
    let loggedIn = false;
    let buf = "";

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {}
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error(`AMI timed out after ${timeoutMs}ms`)), timeoutMs);

    socket.setEncoding?.("utf8");
    socket.on("error", (e) => finish(new Error(`AMI ${e?.message || e}`)));
    socket.on("close", () => finish(new Error("AMI closed before the endpoint listing finished")));
    socket.on("connect", () => {
      socket.write(
        `Action: Login\r\nUsername: ${username}\r\nSecret: ${password}\r\nEvents: off\r\nActionID: ${actionId}-login\r\n\r\n`
      );
    });

    socket.on("data", (chunk) => {
      buf += chunk;
      const boundary = buf.lastIndexOf("\r\n\r\n");
      if (boundary < 0) return;
      const packets = parseAmiPackets(buf.slice(0, boundary + 4));

      if (!loggedIn) {
        const login = packets.find((p) => p.actionid === `${actionId}-login`);
        if (!login) return;
        if (String(login.response || "").toLowerCase() !== "success") {
          return finish(new Error("AMI login rejected"));
        }
        loggedIn = true;
        socket.write(`Action: PJSIPShowEndpoint\r\nEndpoint: ${ext}\r\nActionID: ${actionId}\r\n\r\n`);
        return;
      }

      const mine = packets.filter((p) => p.actionid === actionId);
      const failed = mine.find((p) => String(p.response || "").toLowerCase() === "error");
      if (failed) return finish(new Error(failed.message || "PJSIPShowEndpoint failed"));
      const complete = mine.find(
        (p) => String(p.event || "").toLowerCase() === "pjsipshowendpointcomplete"
      );
      if (!complete) return;
      try {
        socket.write(`Action: Logoff\r\nActionID: ${actionId}-logoff\r\n\r\n`);
      } catch {}
      finish(null, contactEvidence(mine, ext));
    });
  });
}
