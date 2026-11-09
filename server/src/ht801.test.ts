import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHt801ConfigXml,
  formatConfigServerPath,
  formatSipServerForTls,
  normalizeAtaModel,
  normalizeMac,
  shouldValidateSipServerCert,
  sipServerHostname,
} from "./ht801.js";

test("normalizeMac accepts common formats", () => {
  assert.equal(normalizeMac("00:0B:82:AA:BB:CC"), "000b82aabbcc");
  assert.equal(normalizeMac("000B82aabbcc"), "000b82aabbcc");
  assert.equal(normalizeMac("bad"), null);
});

test("formatSipServerForTls appends 5061 when missing", () => {
  assert.equal(formatSipServerForTls("mothership.example"), "mothership.example:5061");
  assert.equal(formatSipServerForTls("192.168.2.105:5061"), "192.168.2.105:5061");
  assert.equal(formatSipServerForTls("192.168.2.105:5060"), "192.168.2.105:5060");
});

test("sipServerHostname strips port", () => {
  assert.equal(sipServerHostname("mothership.example:5061"), "mothership.example");
  assert.equal(sipServerHostname("192.168.2.105"), "192.168.2.105");
});

test("shouldValidateSipServerCert on for FQDN, off for IP", () => {
  assert.equal(shouldValidateSipServerCert("mothership.example"), true);
  assert.equal(shouldValidateSipServerCert("mothership.example:5061"), true);
  assert.equal(shouldValidateSipServerCert("192.168.2.105"), false);
  assert.equal(shouldValidateSipServerCert("192.168.2.105:5061"), false);
});

test("normalizeAtaModel maps aliases", () => {
  assert.equal(normalizeAtaModel("HT801"), "ht801");
  assert.equal(normalizeAtaModel("fanvil-g100s"), "g100s");
});

test("buildHt801ConfigXml includes SIP TLS + SRTP P-values", () => {
  const xml = buildHt801ConfigXml({
    mac: "000b82aabbcc",
    sipServer: "192.168.2.105",
    sipUserId: "2001",
    sipPassword: "example-sip-pass",
    displayName: "Alex ATA",
    configServerPath: "example.com:8443/provision/tok",
    upgradeVia: 2,
  });
  assert.match(xml, /<gs_provision version="1">/);
  assert.match(xml, /<mac>000b82aabbcc<\/mac>/);
  assert.match(xml, /<P271>1<\/P271>/);
  assert.match(xml, /<P31>1<\/P31>/); // SIP Registration (not just Account Active)
  assert.match(xml, /<P47>10\.0\.5\.105:5061<\/P47>/);
  assert.match(xml, /<P35>2001<\/P35>/);
  assert.match(xml, /<P36>2001<\/P36>/);
  assert.match(xml, /<P34>example-sip-pass<\/P34>/);
  assert.match(xml, /<P130>2<\/P130>/); // TLS
  assert.match(xml, /<P183>2<\/P183>/); // SRTP forced
  assert.match(xml, /<P2329>0<\/P2329>/); // sip URI scheme, not sips
  assert.match(xml, /<P20501>0<\/P20501>/); // no random SIP port (v2)
  assert.match(xml, /<P32>1<\/P32>/); // short register expiration so a PBX restart self-heals
  assert.match(xml, /<P2397>1<\/P2397>/); // SIP OPTIONS keep-alive (1.0.9 + 1.0.11)
  assert.match(xml, /<P2398>15<\/P2398>/);
  assert.match(xml, /<P2330>15<\/P2330>/);
  assert.match(xml, /<P84>20<\/P84>/); // NAT keep-alive interval
  assert.match(xml, /<P109>0<\/P109>/); // no outbound without registration
  assert.match(xml, /<P138>10<\/P138>/); // fast REGISTER retry
  assert.match(xml, /<P8463>0<\/P8463>/); // skip cert validate for LAN IP
  assert.match(xml, /<P2311>0<\/P2311>/); // SIP TLS domain check off for LAN IP
  assert.match(xml, /<P2367>0<\/P2367>/); // SIP TLS chain check off for LAN IP
  assert.match(xml, /<P30>pool\.ntp.org<\/P30>/);
  assert.match(xml, /<P144>0<\/P144>/); // DHCP Option 42 must not override NTP
  assert.match(xml, /<P52>2<\/P52>/); // Keep-Alive
  assert.match(xml, /<P243>0<\/P243>/); // allow incoming SIP not only from proxy
  assert.match(xml, /<P4567>0<\/P4567>/); // Prefer Primary SIP Server (not proxy-only)
  assert.match(xml, /<P8565>1<\/P8565>/); // Enable E911
  assert.match(xml, /<P8597>911;933<\/P8597>/);
  assert.match(xml, /<P8599>1<\/P8599>/);
  assert.match(xml, /<P90>\{ \[0-9\] \| 911 \| 933 \| \*98 \| 98 \| \* \| \*x\+/);
  assert.match(xml, /<P4200>\{ \[0-9\] \| 911 \| 933 \| \*98 \| 98 \| \* \| \*x\+/);
  assert.doesNotMatch(xml, /\{ x\+/); // factory “any digits” plan would allow 2001 fishing
  assert.doesNotMatch(xml, /<P4000>\{/); // P4000 is dial tone, not the dial plan
  assert.doesNotMatch(xml, /<P63>/); // Tel URI — not Use Random SIP Port
  assert.match(xml, /<P79>101<\/P79>/); // DTMF payload RFC2833
  assert.match(xml, /<P850>101<\/P850>/); // Preferred DTMF: RFC2833 first (# hold)
  assert.match(xml, /<P851>102<\/P851>/);
  assert.match(xml, /<P852>100<\/P852>/);
  assert.match(xml, /<P4825>1<\/P4825>/); // force preferred DTMF order
  assert.match(xml, /<P72>1<\/P72>/); // required for P28147 disable-redial behavior
  assert.match(xml, /<P28147>1<\/P28147>/); // # not idle redial
  assert.match(xml, /<P892>1<\/P892>/); // loop current disconnect
  assert.match(xml, /<P191>0<\/P191>/); // Call Features OFF — no flash-triggered hold on pulse handset
  assert.match(xml, /<P4424>0<\/P4424>/); // Hook Flash OFF — pulse loop-current false triggers
  assert.match(xml, /<P50>0<\/P50>/); // VAD OFF — always transmit continuous audio
  assert.match(xml, /<P26062>0<\/P26062>/); // RFC2543 Hold off — SRTP-safe RFC3261 hold
  assert.match(xml, /<P237>example\.com:8443\/provision\/tok<\/P237>/);
  assert.match(xml, /<P212>2<\/P212>/);
  assert.match(xml, /<P145>0<\/P145>/); // DHCP cannot replace PhoneHome config URL
  assert.match(xml, /<P1414>1<\/P1414>/); // Auto Provision on
  assert.match(xml, /<P22296>1<\/P22296>/); // periodic config checks enabled
  assert.match(xml, /<P193>30<\/P193>/); // refresh interval
  assert.match(xml, /<P4428>0<\/P4428>/); // authenticate check-sync NOTIFY
  assert.doesNotMatch(xml, /<P194>/); // not an HT801 auto-provision control
  assert.match(xml, /<P192><\/P192>/); // firmware path cleared (config-only)
});

test("buildHt801ConfigXml enables cert validate for public FQDN", () => {
  const xml = buildHt801ConfigXml({
    sipServer: "mothership.example",
    sipUserId: "2001",
    sipPassword: "example-sip-pass",
  });
  assert.match(xml, /<P47>mothership\.example:5061<\/P47>/);
  assert.match(xml, /<P8463>1<\/P8463>/);
  assert.match(xml, /<P2311>1<\/P2311>/);
  assert.match(xml, /<P2367>1<\/P2367>/);
  assert.match(xml, /<P130>2<\/P130>/);
  assert.match(xml, /<P183>2<\/P183>/);
  assert.match(xml, /<P30>pool\.ntp.org<\/P30>/);
  assert.match(xml, /<P144>0<\/P144>/);
  assert.match(xml, /<P31>1<\/P31>/);
  assert.match(xml, /<P32>1<\/P32>/);
  assert.match(xml, /<P52>2<\/P52>/);
  assert.match(xml, /<P90>\{ \[0-9\] \| 911 \| 933 \| \*98 \| 98 \| \* \| \*x\+/);
  assert.match(xml, /<P4200>\{ \[0-9\] \| 911 \| 933 \| \*98 \| 98 \| \* \| \*x\+/);
});

test("buildHt801ConfigXml embeds admin password as P2", () => {
  const xml = buildHt801ConfigXml({
    sipServer: "192.168.2.105",
    sipUserId: "2001",
    sipPassword: "example-sip-pass",
    adminPassword: "HousePhone1",
  });
  assert.match(xml, /<P2>HousePhone1<\/P2>/);
});

test("formatConfigServerPath strips scheme", () => {
  assert.equal(
    formatConfigServerPath("https://mothership.example:8443", "abcTOKEN"),
    "mothership.example:8443/provision/abcTOKEN"
  );
});
