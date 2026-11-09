/**
 * Lab helper: place a softphone call.offer (Alex → Cameron) to exercise CallKit wake.
 * Run on the Mothership CT: node scripts/callkit-test-call.mjs
 */
import { openDb, createSession } from "../server/dist/db.js";
import WebSocket from "ws";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB =
  process.env.PHONEHOME_DB ||
  process.env.KIDS_LANDLINE_DB ||
  "/var/lib/kids-landline/kids-landline.db";
const WS_URL = process.env.PHONEHOME_WS || "ws://127.0.0.1:8787/ws";
const CAMERON = process.env.TO_LINE || "line_example_to";
const ALEX = process.env.FROM_LINE || "line_example";
const OPERATOR = process.env.OPERATOR_USER || "user_example";

const db = openDb(DB);
const session = createSession(db, OPERATOR);

const minimalSdp = {
  type: "offer",
  sdp: [
    "v=0",
    "o=- 0 0 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "a=msid-semantic: WMS *",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "c=IN IP4 0.0.0.0",
    "a=rtcp:9 IN IP4 0.0.0.0",
    "a=ice-ufrag:PhCk",
    "a=ice-pwd:phonehomeCallKitPwd1234567890",
    "a=fingerprint:sha-256 11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff:00",
    "a=setup:actpass",
    "a=mid:0",
    "a=sendrecv",
    "a=rtcp-mux",
    "a=rtpmap:111 opus/48000/2",
    "a=fmtp:111 minptime=10;useinbandfec=1",
    "a=ssrc:2 cname:alex-callkit",
    "",
  ].join("\r\n"),
};

const ws = new WebSocket(WS_URL);
ws.on("message", (raw) => {
  const m = JSON.parse(String(raw));
  console.log("←", m.type, m.callId || m.reason || m.error || "");
  if (m.type === "welcome") {
    ws.send(
      JSON.stringify({
        type: "call.offer",
        fromLineId: ALEX,
        toLineId: CAMERON,
        sdp: minimalSdp,
      })
    );
    console.log("→ call.offer", ALEX, "→", CAMERON);
  }
  if (["call.ringing", "call.rejected", "error"].includes(m.type)) {
    setTimeout(() => process.exit(m.type === "call.ringing" ? 0 : 1), 1500);
  }
});
ws.on("open", () => {
  ws.send(JSON.stringify({ type: "hello", sessionId: session.id, lineId: ALEX }));
});
ws.on("error", (e) => {
  console.error(e);
  process.exit(1);
});
setTimeout(() => {
  console.error("timeout");
  process.exit(2);
}, 10000);
