import assert from "node:assert/strict";
import test from "node:test";
import {
  extractHttpsUrlFromText,
  hrefWithoutInviteParams,
  normalizeGrandparentSetupToken,
  normalizeInviteCode,
  normalizeJoinToken,
  parseGrandparentSetupTokenFromHref,
  parseInviteCodeFromHref,
  parseInviteKindFromHref,
  parseJoinTokenFromHref,
  parseMothershipShareInput,
  textForShareWithUrl,
} from "./inviteLink.js";

test("normalizeInviteCode keeps six digits", () => {
  assert.equal(normalizeInviteCode("12 34-56"), "123456");
  assert.equal(normalizeInviteCode("abc1234567"), "123456");
  assert.equal(normalizeInviteCode(""), "");
});

test("parseInviteCodeFromHref reads query, hash, and path", () => {
  assert.equal(parseInviteCodeFromHref("https://home.example/?invite=246810"), "246810");
  assert.equal(parseInviteCodeFromHref("https://home.example/?invite=246810&host=1"), "246810");
  assert.equal(parseInviteCodeFromHref("https://home.example/#invite=135790"), "135790");
  assert.equal(parseInviteCodeFromHref("https://home.example/#/?invite=135790"), "135790");
  assert.equal(parseInviteCodeFromHref("https://home.example/invite/112233"), "112233");
  assert.equal(parseInviteCodeFromHref("https://home.example/join/998877"), "998877");
  assert.equal(parseInviteCodeFromHref("https://home.example/"), "");
  assert.equal(parseInviteCodeFromHref("https://home.example/?guardian=123456"), "");
  assert.equal(parseInviteCodeFromHref("https://home.example/?code=123456"), "");
  assert.equal(parseInviteCodeFromHref("https://home.example/?grandparent=654321"), "654321");
  assert.equal(parseInviteKindFromHref("https://home.example/?grandparent=654321"), "grandparent");
  assert.equal(parseInviteKindFromHref("https://home.example/?invite=654321"), "");
});

test("parseGrandparentSetupTokenFromHref reads opaque gp claim tokens", () => {
  const token = "AbCdEfGhIjKlMnOpQrStUvWx";
  assert.equal(
    parseGrandparentSetupTokenFromHref(`https://home.example/?gp=${token}`),
    token
  );
  assert.equal(
    parseGrandparentSetupTokenFromHref(`https://home.example/#gp=${token}`),
    token
  );
  assert.equal(parseGrandparentSetupTokenFromHref("https://home.example/?gp=short"), "");
  assert.equal(parseGrandparentSetupTokenFromHref("https://home.example/?invite=246810"), "");
  assert.equal(normalizeGrandparentSetupToken(`${token}!!`), token);
});

test("parseJoinTokenFromHref reads opaque join claim tokens", () => {
  const token = "XyZaBcDeFgHiJkLmNoPqRsTu";
  assert.equal(parseJoinTokenFromHref(`https://home.example/?join=${token}`), token);
  assert.equal(parseJoinTokenFromHref(`https://home.example/join/${token}`), token);
  assert.equal(parseJoinTokenFromHref("https://home.example/?join=short"), "");
  assert.equal(parseJoinTokenFromHref("https://home.example/?gp=AbCdEfGhIjKlMnOpQrStUvWx"), "");
  assert.equal(normalizeJoinToken(token), token);
});

test("hrefWithoutInviteParams strips invite and keeps other query", () => {
  assert.equal(
    hrefWithoutInviteParams("https://home.example/?invite=246810&host=1"),
    "/?host=1"
  );
  assert.equal(hrefWithoutInviteParams("https://home.example/invite/246810"), "/");
  assert.equal(
    hrefWithoutInviteParams("https://home.example/?gp=AbCdEfGhIjKlMnOpQrStUvWx&host=1"),
    "/?host=1"
  );
  assert.equal(
    hrefWithoutInviteParams("https://home.example/?join=XyZaBcDeFgHiJkLmNoPqRsTu&x=1"),
    "/?x=1"
  );
});

test("parseMothershipShareInput accepts origin or full share links", () => {
  const join = "XyZaBcDeFgHiJkLmNoPqRsTu";
  const gp = "AbCdEfGhIjKlMnOpQrStUvWx";
  assert.deepEqual(parseMothershipShareInput("https://home.example:8443"), {
    origin: "https://home.example:8443",
    openPath: "",
    joinToken: "",
    gpToken: "",
    inviteCode: "",
    inviteKind: "",
  });
  assert.equal(
    parseMothershipShareInput(`https://home.example:8443/?join=${join}`).openPath,
    `/?join=${join}`
  );
  assert.equal(
    parseMothershipShareInput(`home.example:8443/?gp=${gp}`).gpToken,
    gp
  );
  assert.equal(
    parseMothershipShareInput("https://home.example/?invite=246810").inviteCode,
    "246810"
  );
  assert.throws(() => parseMothershipShareInput("http://insecure.example"), /https/i);
});

test("extractHttpsUrlFromText finds the join URL and strips trailing punctuation", () => {
  assert.equal(
    extractHttpsUrlFromText("Tap once:\nhttps://home.example:8443/?join=abc123\n\nApprove after."),
    "https://home.example:8443/?join=abc123"
  );
  assert.equal(extractHttpsUrlFromText("See https://home.example/?invite=246810."), "https://home.example/?invite=246810");
  assert.equal(extractHttpsUrlFromText("no link here"), "");
});

test("textForShareWithUrl removes the URL so Messages does not duplicate it", () => {
  const url = "https://home.example/?join=tok";
  assert.equal(
    textForShareWithUrl(`You're invited.\n\nTap once to join:\n${url}\n\nApprove after.`, url),
    "You're invited.\n\nTap once to join:\n\nApprove after."
  );
  assert.equal(textForShareWithUrl("Hello", url), "Hello");
});
