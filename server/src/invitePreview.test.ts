import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHousehold, createInvite, registerParent } from "./api.js";
import { openDb } from "./db.js";
import {
  HOME_PREVIEW_DESCRIPTION,
  HOME_PREVIEW_TITLE,
  INVITE_PREVIEW_DESCRIPTION,
  INVITE_PREVIEW_TITLE,
  applyLinkPreviewMeta,
  englishPossessive,
  familyInviteCodeFromRequest,
  homeCanonicalUrl,
  invitePreviewCopy,
  invitePreviewGivenName,
  inviteShareCanonicalUrl,
  lookupInviterPreviewName,
  previewImageUrl,
  requestLooksLikeFamilyInvite,
} from "./invitePreview.js";

const SHELL = `<!doctype html>
<html>
  <head>
    <!-- phonehome-link-preview -->
    <title>PhoneHome</title>
    <meta name="description" content="${HOME_PREVIEW_DESCRIPTION}" />
    <meta property="og:title" content="PhoneHome" />
    <meta property="og:description" content="${HOME_PREVIEW_DESCRIPTION}" />
    <!-- /phonehome-link-preview -->
  </head>
  <body><div id="app"></div></body>
</html>`;

test("family invite codes come from query or /invite|/join path", () => {
  assert.equal(familyInviteCodeFromRequest("/", { invite: "246810" }), "246810");
  assert.equal(familyInviteCodeFromRequest("/", { familyInvite: "135790" }), "135790");
  assert.equal(familyInviteCodeFromRequest("/invite/112233", {}), "112233");
  assert.equal(familyInviteCodeFromRequest("/join/998877/", {}), "998877");
  assert.equal(familyInviteCodeFromRequest("/", { invite: "abc" }), "");
  assert.equal(familyInviteCodeFromRequest("/", { guardian: "246810" }), "");
  assert.equal(familyInviteCodeFromRequest("/", { grandparent: "654321" }), "654321");
  assert.equal(familyInviteCodeFromRequest("/phone", { host: "1" }), "");
});

test("requestLooksLikeFamilyInvite ignores homepage and guardian links", () => {
  assert.equal(requestLooksLikeFamilyInvite("/", { invite: "246810" }), true);
  assert.equal(requestLooksLikeFamilyInvite("/invite/246810", {}), true);
  assert.equal(requestLooksLikeFamilyInvite("/", {}), false);
  assert.equal(requestLooksLikeFamilyInvite("/", { guardian: "246810" }), false);
});

test("english possessive always adds 's (James's)", () => {
  assert.equal(englishPossessive("Cameron"), "Cameron's");
  assert.equal(englishPossessive("Jordan"), "Jordan's");
  assert.equal(englishPossessive("James"), "James's");
  assert.equal(englishPossessive("Chris"), "Chris's");
  assert.equal(englishPossessive(""), "");
});

test("invite preview given name uses first name, not username or email", () => {
  assert.equal(invitePreviewGivenName("Cameron Lars"), "Cameron");
  assert.equal(invitePreviewGivenName("Jordan"), "Jordan");
  assert.equal(invitePreviewGivenName("james watson"), "James");
  assert.equal(invitePreviewGivenName("JEAN-LUC PICARD"), "Jean-Luc");
  assert.equal(invitePreviewGivenName("user94"), "");
  assert.equal(invitePreviewGivenName("cameron@example.com"), "");
  assert.equal(invitePreviewGivenName("Parent"), "");
  assert.equal(invitePreviewGivenName("Host parent"), "");
  assert.equal(invitePreviewGivenName(""), "");
  assert.equal(invitePreviewGivenName(null), "");
});

test("named invite copy uses the parent's first name", () => {
  const named = invitePreviewCopy("Cameron Lars");
  assert.equal(named.title, "You're invited to Cameron's PhoneHome");
  assert.match(named.description, /^Cameron invited you to their private family phone/);
  assert.doesNotMatch(named.description, /@|extension|MAC/i);

  const james = invitePreviewCopy("James");
  assert.equal(james.title, "You're invited to James's PhoneHome");

  const fallback = invitePreviewCopy("");
  assert.equal(fallback.title, INVITE_PREVIEW_TITLE);
  assert.equal(fallback.description, INVITE_PREVIEW_DESCRIPTION);
  assert.equal(invitePreviewCopy("user94").title, INVITE_PREVIEW_TITLE);
});

test("invite HTML uses family-invite copy, not homepage marketing", () => {
  const html = applyLinkPreviewMeta(SHELL, {
    variant: "invite",
    canonicalUrl: "https://home.example/?invite=246810",
    imageUrl: "https://home.example/assets/analog/kid-landline-call.jpg",
    imageWidth: 1280,
    imageHeight: 853,
  });
  assert.match(html, new RegExp(`<title>${INVITE_PREVIEW_TITLE}</title>`));
  assert.match(html, new RegExp(`content="${INVITE_PREVIEW_DESCRIPTION}"`));
  assert.match(html, /property="og:title"/);
  assert.match(html, /name="twitter:title"/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(html, /property="og:image:width" content="1280"/);
  assert.match(html, /property="og:image:height" content="853"/);
  assert.match(html, /property="og:image:secure_url"/);
  assert.doesNotMatch(html, /the home phone, reborn/i);
  assert.doesNotMatch(html, new RegExp(`<title>${HOME_PREVIEW_TITLE}</title>`));
  assert.match(html, /id="app"/);
});

test("invite HTML injects the inviting parent's name when provided", () => {
  const html = applyLinkPreviewMeta(SHELL, {
    variant: "invite",
    canonicalUrl: "https://home.example/?invite=246810",
    imageUrl: "https://home.example/assets/analog/kid-landline-call.jpg",
    parentGivenName: "Cameron Lars",
  });
  assert.match(html, /<title>You're invited to Cameron's PhoneHome<\/title>/);
  assert.match(html, /property="og:title" content="You're invited to Cameron's PhoneHome"/);
  assert.match(html, /Cameron invited you to their private family phone/);
  assert.doesNotMatch(html, /a family's PhoneHome/);
  assert.match(html, /id="app"/);
});

test("homepage HTML keeps the normal site description", () => {
  const html = applyLinkPreviewMeta(SHELL, {
    variant: "home",
    canonicalUrl: "https://home.example/",
    imageUrl: "https://home.example/icon-1024.png",
  });
  assert.match(html, new RegExp(`<title>${HOME_PREVIEW_TITLE}</title>`));
  assert.match(html, new RegExp(`content="${HOME_PREVIEW_DESCRIPTION}"`));
  assert.doesNotMatch(html, /You're invited to a family's PhoneHome/);
  assert.doesNotMatch(html, /name="robots"/);
});

test("canonical helpers match share URLs", () => {
  assert.equal(inviteShareCanonicalUrl("https://home.example", "246810"), "https://home.example/?invite=246810");
  assert.equal(homeCanonicalUrl("https://home.example/"), "https://home.example/");
  assert.equal(
    previewImageUrl("https://home.example", "/assets/analog/kid-landline-call.jpg"),
    "https://home.example/assets/analog/kid-landline-call.jpg"
  );
});

test("lookupInviterPreviewName uses the inviting parent's display first name", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-invite-preview-"));
  const db = openDb(path.join(dir, "t.db"));
  const parent = registerParent(db, "Cameron Lars");
  const hh = createHousehold(db, parent.user.id, "Lars house");
  const invite = createInvite(db, hh.id, parent.user.id);
  assert.equal(lookupInviterPreviewName(db, invite.code), "Cameron");
  assert.equal(lookupInviterPreviewName(db, "000000"), "");
  db.close();
});

test("Grandma setup links get setup preview copy and invite art", () => {
  const html = applyLinkPreviewMeta(SHELL, {
    variant: "setup",
    canonicalUrl: "https://home.example/?gp=AbCdEfGhIjKlMnOpQrStUvWx",
    imageUrl: "https://home.example/assets/analog/kid-landline-call.jpg",
    imageWidth: 1280,
    imageHeight: 853,
  });
  assert.match(html, /<title>Your PhoneHome is ready<\/title>/);
  assert.match(html, /Tap once to open PhoneHome and sign in/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.doesNotMatch(html, /the home phone, reborn/i);
});
