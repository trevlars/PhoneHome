import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  amiConfigFromEnv,
  contactEvidence,
  fetchAmiContactEvidence,
  parseAmiPackets,
} from "./amiContacts.mjs";

const CRLF = "\r\n";

function packet(lines) {
  return lines.join(CRLF) + CRLF + CRLF;
}

/** Minimal AMI server stand-in: replays canned packets per written Action. */
function fakeSocket(script) {
  const socket = new EventEmitter();
  socket.written = [];
  socket.destroyed = false;
  socket.setEncoding = () => {};
  socket.destroy = () => {
    socket.destroyed = true;
  };
  socket.write = (chunk) => {
    socket.written.push(chunk);
    const reply = script(chunk);
    if (reply) setImmediate(() => socket.emit("data", reply));
    return true;
  };
  setImmediate(() => socket.emit("connect"));
  return socket;
}

test("parseAmiPackets drops the banner and lowercases headers", () => {
  const raw =
    "Asterisk Call Manager/7.0.3" +
    CRLF +
    packet(["Response: Success", "ActionID: abc-login", "Message: Authentication accepted"]);
  const packets = parseAmiPackets(raw);
  assert.equal(packets.length, 1);
  assert.equal(packets[0].response, "Success");
  assert.equal(packets[0].actionid, "abc-login");
});

test("contactEvidence counts a reachable contact for the extension", () => {
  const packets = parseAmiPackets(
    packet([
      "Event: ContactStatusDetail",
      "AOR: 2001",
      "URI: sip:2001@192.168.1.42:5060;transport=tls",
      "Status: Reachable",
      "RoundtripUsec: 4124",
      "EndpointName: 2001",
    ])
  );
  const evidence = contactEvidence(packets, "2001");
  assert.equal(evidence.total, 1);
  assert.equal(evidence.usable, 1);
  assert.equal(evidence.contacts[0].rtt_ms, 4.1);
});

test("contactEvidence treats an empty AOR as no evidence", () => {
  const evidence = contactEvidence(parseAmiPackets(packet(["Event: PJSIPShowEndpointComplete"])), "2001");
  assert.deepEqual(evidence, { total: 0, usable: 0, contacts: [] });
});

test("contactEvidence rejects unreachable and removed contacts", () => {
  const packets = parseAmiPackets(
    packet([
      "Event: ContactStatusDetail",
      "AOR: 2001",
      "URI: sip:2001@192.168.1.42:5060;transport=tls",
      "Status: Unreachable",
    ]) +
      packet([
        "Event: ContactStatusDetail",
        "AOR: 2001",
        "URI: sip:2001@192.168.1.99:5060;transport=tls",
        "Status: Removed",
      ])
  );
  const evidence = contactEvidence(packets, "2001");
  assert.equal(evidence.total, 2);
  assert.equal(evidence.usable, 0);
});

test("contactEvidence keeps NonQualified contacts (registered, just not probed)", () => {
  const packets = parseAmiPackets(
    packet([
      "Event: ContactStatusDetail",
      "AOR: 2001",
      "URI: sip:2001@192.168.1.42:5060;transport=tls",
      "Status: NonQualified",
      "RoundtripUsec: 0",
    ])
  );
  const evidence = contactEvidence(packets, "2001");
  assert.equal(evidence.usable, 1);
  assert.equal(evidence.contacts[0].rtt_ms, null);
});

test("contactEvidence ignores contacts belonging to another extension", () => {
  const packets = parseAmiPackets(
    packet([
      "Event: ContactStatusDetail",
      "AOR: 2002",
      "URI: sip:2002@192.168.1.43:5060;transport=tls",
      "Status: Reachable",
      "EndpointName: 2002",
    ])
  );
  assert.equal(contactEvidence(packets, "2001").total, 0);
});

test("amiConfigFromEnv stays off unless both user and password are set", () => {
  assert.equal(amiConfigFromEnv({}), null);
  assert.equal(amiConfigFromEnv({ AMI_USER: "phonehome" }), null);
  const cfg = amiConfigFromEnv({ AMI_USER: "phonehome", AMI_PASSWORD: "x", AMI_PORT: "5039" });
  assert.equal(cfg.username, "phonehome");
  assert.equal(cfg.port, 5039);
});

test("fetchAmiContactEvidence logs in, lists the endpoint, and summarizes", async () => {
  let socket;
  const evidence = await fetchAmiContactEvidence({
    host: "127.0.0.1",
    username: "phonehome",
    password: "secret",
    extension: "2001",
    createConnection: () => {
      socket = fakeSocket((chunk) => {
        const id = /ActionID: (\S+)/.exec(chunk)?.[1] || "";
        if (chunk.includes("Action: Login")) {
          return "Asterisk Call Manager/7.0.3" + CRLF + packet([`ActionID: ${id}`, "Response: Success"]);
        }
        if (chunk.includes("Action: PJSIPShowEndpoint")) {
          return (
            packet([`ActionID: ${id}`, "Response: Success", "EventList: start"]) +
            packet([
              "Event: ContactStatusDetail",
              `ActionID: ${id}`,
              "AOR: 2001",
              "URI: sip:2001@192.168.1.42:5060;transport=tls",
              "Status: Reachable",
              "RoundtripUsec: 4124",
            ]) +
            packet(["Event: PJSIPShowEndpointComplete", `ActionID: ${id}`, "EventList: Complete"])
          );
        }
        return null;
      });
      return socket;
    },
  });
  assert.equal(evidence.usable, 1);
  assert.ok(socket.written.some((c) => c.includes("Action: Logoff")));
  assert.ok(socket.destroyed);
});

test("fetchAmiContactEvidence reports zero contacts rather than assuming online", async () => {
  const evidence = await fetchAmiContactEvidence({
    host: "127.0.0.1",
    username: "phonehome",
    password: "secret",
    extension: "2001",
    createConnection: () =>
      fakeSocket((chunk) => {
        const id = /ActionID: (\S+)/.exec(chunk)?.[1] || "";
        if (chunk.includes("Action: Login")) return packet([`ActionID: ${id}`, "Response: Success"]);
        if (chunk.includes("Action: PJSIPShowEndpoint")) {
          return (
            packet([`ActionID: ${id}`, "Response: Success", "EventList: start"]) +
            packet(["Event: PJSIPShowEndpointComplete", `ActionID: ${id}`])
          );
        }
        return null;
      }),
  });
  assert.equal(evidence.total, 0);
  assert.equal(evidence.usable, 0);
});

test("fetchAmiContactEvidence rejects on a refused login", async () => {
  await assert.rejects(
    fetchAmiContactEvidence({
      host: "127.0.0.1",
      username: "phonehome",
      password: "wrong",
      extension: "2001",
      createConnection: () =>
        fakeSocket((chunk) => {
          const id = /ActionID: (\S+)/.exec(chunk)?.[1] || "";
          return chunk.includes("Action: Login")
            ? packet([`ActionID: ${id}`, "Response: Error", "Message: Authentication failed"])
            : null;
        }),
    }),
    /login rejected/
  );
});

test("fetchAmiContactEvidence rejects when the socket closes early", async () => {
  await assert.rejects(
    fetchAmiContactEvidence({
      host: "127.0.0.1",
      username: "phonehome",
      password: "secret",
      extension: "2001",
      createConnection: () => {
        const socket = fakeSocket(() => null);
        setImmediate(() => socket.emit("close"));
        return socket;
      },
    }),
    /closed before/
  );
});
