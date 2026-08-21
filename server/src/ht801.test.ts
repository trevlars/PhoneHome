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
  assert.equal(formatSipServerForTls("y5876647.eero.online"), "y5876647.eero.online:5061");
  assert.equal(formatSipServerForTls("10.0.5.105:5061"), "10.0.5.105:5061");
  assert.equal(formatSipServerForTls("10.0.5.105:5060"), "10.0.5.105:5060");
});

test("sipServerHostname strips port", () => {
  assert.equal(sipServerHostname("y5876647.eero.online:5061"), "y5876647.eero.online");
  assert.equal(sipServerHostname("10.0.5.105"), "10.0.5.105");
});

test("shouldValidateSipServerCert on for FQDN, off for IP", () => {
  assert.equal(shouldValidateSipServerCert("y5876647.eero.online"), true);
  assert.equal(shouldValidateSipServerCert("y5876647.eero.online:5061"), true);
  assert.equal(shouldValidateSipServerCert("10.0.5.105"), false);
  assert.equal(shouldValidateSipServerCert("10.0.5.105:5061"), false);
});

test("normalizeAtaModel maps aliases", () => {
  assert.equal(normalizeAtaModel("HT801"), "ht801");
  assert.equal(normalizeAtaModel("fanvil-g100s"), "g100s");
});

test("buildHt801ConfigXml includes SIP TLS + SRTP P-values", () => {
  const xml = buildHt801ConfigXml({
    mac: "000b82aabbcc",
    sipServer: "10.0.5.105",
    sipUserId: "2001",
    sipPassword: "PhoneHomeHt801!",
    displayName: "Gemma ATA",
    configServerPath: "example.com:8443/provision/tok",
    upgradeVia: 2,
  });
  assert.match(xml, /<gs_provision version="1">/);
  assert.match(xml, /<mac>000b82aabbcc<\/mac>/);
  assert.match(xml, /<P271>1<\/P271>/);
  assert.match(xml, /<P47>10\.0\.5\.105:5061<\/P47>/);
  assert.match(xml, /<P35>2001<\/P35>/);
  assert.match(xml, /<P36>2001<\/P36>/);
  assert.match(xml, /<P34>PhoneHomeHt801!<\/P34>/);
  assert.match(xml, /<P130>2<\/P130>/); // TLS
  assert.match(xml, /<P183>2<\/P183>/); // SRTP forced
  assert.match(xml, /<P20501>0<\/P20501>/); // no random SIP port
  assert.match(xml, /<P32>3<\/P32>/); // short register expiration so a PBX restart self-heals
  assert.match(xml, /<P8463>0<\/P8463>/); // skip cert validate for LAN IP
  assert.match(xml, /<P52>2<\/P52>/); // Keep-Alive
  assert.match(xml, /<P8565>1<\/P8565>/); // Enable E911
  assert.match(xml, /<P8597>911;933<\/P8597>/);
  assert.match(xml, /<P8599>1<\/P8599>/);
  assert.match(xml, /<P90>\{ \[0-9\] \| 911 \| 933 \| \*98 \| \* \| \*x\+/);
  assert.match(xml, /<P237>example\.com:8443\/provision\/tok<\/P237>/);
  assert.match(xml, /<P212>2<\/P212>/);
  assert.match(xml, /<P192><\/P192>/); // firmware path cleared (config-only)
});

test("buildHt801ConfigXml enables cert validate for public FQDN", () => {
  const xml = buildHt801ConfigXml({
    sipServer: "y5876647.eero.online",
    sipUserId: "2001",
    sipPassword: "PhoneHomeHt801!",
  });
  assert.match(xml, /<P47>y5876647\.eero\.online:5061<\/P47>/);
  assert.match(xml, /<P8463>1<\/P8463>/);
});

test("buildHt801ConfigXml embeds admin password as P2", () => {
  const xml = buildHt801ConfigXml({
    sipServer: "10.0.5.105",
    sipUserId: "2001",
    sipPassword: "PhoneHomeHt801!",
    adminPassword: "HousePhone1",
  });
  assert.match(xml, /<P2>HousePhone1<\/P2>/);
});

test("formatConfigServerPath strips scheme", () => {
  assert.equal(
    formatConfigServerPath("https://y5876647.eero.online:8443", "abcTOKEN"),
    "y5876647.eero.online:8443/provision/abcTOKEN"
  );
});
