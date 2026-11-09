/** Link-preview copy for iMessage / SMS / WhatsApp crawlers (no JS). */

import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

export const HOME_PREVIEW_TITLE = "PhoneHome";
export const HOME_PREVIEW_DESCRIPTION =
  "PhoneHome — the home phone, reborn. Private calling for family and approved trusted friends.";
export const HOME_OG_IMAGE_PATH = "/icon-1024.png";
/** Square app icon — used for homepage previews. */
export const HOME_OG_IMAGE_SIZE = { width: 1024, height: 1024 };

export const INVITE_PREVIEW_TITLE = "You're invited to a family's PhoneHome";
export const INVITE_PREVIEW_DESCRIPTION =
  "Someone invited you to their private family phone. Open this link to join their PhoneHome — kids can call after both families approve.";
export const INVITE_OG_IMAGE_PATH = "/assets/analog/kid-landline-call.jpg";
/** Landscape hero — iMessage / OG large-image card. */
export const INVITE_OG_IMAGE_SIZE = { width: 1280, height: 853 };

export const SETUP_PREVIEW_TITLE = "Your PhoneHome is ready";
export const SETUP_PREVIEW_DESCRIPTION =
  "Tap once to open PhoneHome and sign in. This link works one time — ask for a new one if it expires.";

const PREVIEW_START = "<!-- phonehome-link-preview -->";
const PREVIEW_END = "<!-- /phonehome-link-preview -->";

const PLACEHOLDER_GIVEN_NAMES = new Set([
  "parent",
  "host",
  "user",
  "admin",
  "family",
  "someone",
]);

export type LinkPreviewVariant = "home" | "invite" | "setup";

export type LinkPreviewCopy = { title: string; description: string };

function firstQueryString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

function sixDigitInvite(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "").slice(0, 6);
  return digits.length === 6 ? digits : "";
}

function opaqueJoinToken(raw: string): string {
  const t = String(raw || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "");
  return t.length >= 20 && t.length <= 64 ? t : "";
}

/** 6-digit family invite from `?invite=` / `?familyInvite=` / `/invite|join/:code`. */
export function familyInviteCodeFromRequest(
  pathname: string,
  query?: Record<string, unknown>
): string {
  const fromQuery = sixDigitInvite(
    firstQueryString(query?.grandparent) ||
      firstQueryString(query?.invite) ||
      firstQueryString(query?.familyInvite)
  );
  if (fromQuery) return fromQuery;
  const m = String(pathname || "").match(/^\/(?:invite|join)\/(\d{4,8})\/?$/i);
  return m ? sixDigitInvite(m[1]) : "";
}

/** Opaque one-tap claim from `?join=` (family / friend / co-parent). */
export function joinClaimTokenFromRequest(
  pathname: string,
  query?: Record<string, unknown>
): string {
  const fromQuery = opaqueJoinToken(firstQueryString(query?.join));
  if (fromQuery) return fromQuery;
  const m = String(pathname || "").match(/^\/join\/([A-Za-z0-9_-]{20,64})\/?$/i);
  return m ? opaqueJoinToken(m[1]) : "";
}

/** One-tap Grandma claim from `?gp=` / `?gpSetup=`. */
export function gpClaimTokenFromRequest(
  pathname: string,
  query?: Record<string, unknown>
): string {
  const fromQuery = opaqueJoinToken(
    firstQueryString(query?.gp) || firstQueryString(query?.gpSetup)
  );
  if (fromQuery) return fromQuery;
  const m = String(pathname || "").match(/^\/gp\/([A-Za-z0-9_-]{20,64})\/?$/i);
  return m ? opaqueJoinToken(m[1]) : "";
}

export function requestLooksLikeFamilyInvite(
  pathname: string,
  query?: Record<string, unknown>
): boolean {
  return Boolean(
    familyInviteCodeFromRequest(pathname, query) || joinClaimTokenFromRequest(pathname, query)
  );
}

export function requestLooksLikeSharePreview(
  pathname: string,
  query?: Record<string, unknown>
): boolean {
  return Boolean(
    requestLooksLikeFamilyInvite(pathname, query) || gpClaimTokenFromRequest(pathname, query)
  );
}

export function inviteShareCanonicalUrl(base: string, code: string): string {
  return `${String(base || "").replace(/\/$/, "")}/?invite=${code}`;
}

export function joinShareCanonicalUrl(base: string, token: string): string {
  return `${String(base || "").replace(/\/$/, "")}/?join=${encodeURIComponent(token)}`;
}

export function gpShareCanonicalUrl(base: string, token: string): string {
  return `${String(base || "").replace(/\/$/, "")}/?gp=${encodeURIComponent(token)}`;
}

export function homeCanonicalUrl(base: string): string {
  return `${String(base || "").replace(/\/$/, "")}/`;
}

export function previewImageUrl(base: string, imagePath: string): string {
  const origin = String(base || "").replace(/\/$/, "");
  const path = imagePath.startsWith("/") ? imagePath : `/${imagePath}`;
  return `${origin}${path}`;
}

/** Chicago-style possessive: Cameron's, Jordan's, James's. */
export function englishPossessive(name: string): string {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "";
  if (/['’]s$/i.test(trimmed)) return trimmed;
  return `${trimmed}'s`;
}

function titleCasePart(part: string): string {
  if (!part) return part;
  return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
}

function previewNameCasing(token: string): string {
  if (token === token.toLowerCase() || token === token.toUpperCase()) {
    return token.split(/(-)/).map((part) => (part === "-" ? part : titleCasePart(part))).join("");
  }
  return token;
}

/**
 * First name from a parent display name for public invite previews.
 * Never uses username, email, or other identifiers.
 */
export function invitePreviewGivenName(displayName: string | null | undefined): string {
  const raw = String(displayName || "").trim();
  if (!raw) return "";
  const first = raw.split(/\s+/)[0] || "";
  const token = first.replace(/^['"`]+|['"`]+$/g, "");
  if (token.length < 2 || token.length > 24) return "";
  if (/[<>@:/\\]/.test(token) || /\d/.test(token)) return "";
  if (!/^[\p{L}][\p{L}'’.-]*$/u.test(token)) return "";
  if (PLACEHOLDER_GIVEN_NAMES.has(token.toLowerCase())) return "";
  return previewNameCasing(token);
}

export function invitePreviewCopy(parentGivenName?: string | null): LinkPreviewCopy {
  const given = invitePreviewGivenName(parentGivenName);
  if (!given) {
    return { title: INVITE_PREVIEW_TITLE, description: INVITE_PREVIEW_DESCRIPTION };
  }
  return {
    title: `You're invited to ${englishPossessive(given)} PhoneHome`,
    description: `${given} invited you to their private family phone. Open this link to join their PhoneHome — kids can call after both families approve.`,
  };
}

/** Inviting parent's given name from a family invite code. Empty on miss (no secrets logged). */
export function lookupInviterPreviewName(db: Database.Database, code: string): string {
  const digits = sixDigitInvite(code);
  if (!digits) return "";
  try {
    const row = db
      .prepare(
        `SELECT u.display_name AS display_name
         FROM invites i
         JOIN users u ON u.id = i.created_by
         WHERE i.code = ?`
      )
      .get(digits) as { display_name: string | null } | undefined;
    return invitePreviewGivenName(row?.display_name);
  } catch {
    return "";
  }
}

/** Inviter given name from a `/?join=` claim token hash. */
export function lookupInviterPreviewNameFromJoinToken(
  db: Database.Database,
  tokenRaw: string
): string {
  const token = opaqueJoinToken(tokenRaw);
  if (!token) return "";
  try {
    const hash = createHash("sha256").update(token).digest("hex");
    const row = db
      .prepare(
        `SELECT u.display_name AS display_name
         FROM invite_claim_tokens t
         JOIN users u ON u.id = t.created_by
         WHERE t.token_hash = ?`
      )
      .get(hash) as { display_name: string | null } | undefined;
    return invitePreviewGivenName(row?.display_name);
  } catch {
    return "";
  }
}

function escapeAttr(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function resolvePreviewCopy(opts: {
  variant: LinkPreviewVariant;
  title?: string;
  description?: string;
  parentGivenName?: string | null;
}): LinkPreviewCopy {
  if (opts.variant === "setup") {
    return {
      title: opts.title || SETUP_PREVIEW_TITLE,
      description: opts.description || SETUP_PREVIEW_DESCRIPTION,
    };
  }
  if (opts.variant !== "invite") {
    return {
      title: opts.title || HOME_PREVIEW_TITLE,
      description: opts.description || HOME_PREVIEW_DESCRIPTION,
    };
  }
  const named = invitePreviewCopy(opts.parentGivenName);
  return {
    title: opts.title || named.title,
    description: opts.description || named.description,
  };
}

export function renderLinkPreviewMeta(opts: {
  variant: LinkPreviewVariant;
  canonicalUrl: string;
  imageUrl: string;
  imageWidth?: number;
  imageHeight?: number;
  title?: string;
  description?: string;
  parentGivenName?: string | null;
}): string {
  const indexed = opts.variant === "home";
  const { title, description } = resolvePreviewCopy(opts);
  const robots = indexed ? "" : `    <meta name="robots" content="noindex, nofollow" />\n`;
  const w = opts.imageWidth && opts.imageWidth > 0 ? opts.imageWidth : 0;
  const h = opts.imageHeight && opts.imageHeight > 0 ? opts.imageHeight : 0;
  const imageSize =
    w && h
      ? `    <meta property="og:image:width" content="${w}" />
    <meta property="og:image:height" content="${h}" />
`
      : "";
  return `${PREVIEW_START}
    <title>${escapeAttr(title)}</title>
    <meta name="description" content="${escapeAttr(description)}" />
${robots}    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="PhoneHome" />
    <meta property="og:title" content="${escapeAttr(title)}" />
    <meta property="og:description" content="${escapeAttr(description)}" />
    <meta property="og:url" content="${escapeAttr(opts.canonicalUrl)}" />
    <meta property="og:image" content="${escapeAttr(opts.imageUrl)}" />
    <meta property="og:image:secure_url" content="${escapeAttr(opts.imageUrl)}" />
${imageSize}    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeAttr(title)}" />
    <meta name="twitter:description" content="${escapeAttr(description)}" />
    <meta name="twitter:image" content="${escapeAttr(opts.imageUrl)}" />
    ${PREVIEW_END}`;
}

/** Swap title / description / OG tags. Invite pages must not keep homepage marketing copy. */
export function applyLinkPreviewMeta(
  html: string,
  opts: {
    variant: LinkPreviewVariant;
    canonicalUrl: string;
    imageUrl: string;
    imageWidth?: number;
    imageHeight?: number;
    title?: string;
    description?: string;
    parentGivenName?: string | null;
  }
): string {
  const block = renderLinkPreviewMeta(opts);
  const source = String(html || "");
  const start = source.indexOf(PREVIEW_START);
  const end = source.indexOf(PREVIEW_END);
  if (start >= 0 && end > start) {
    return source.slice(0, start) + block + source.slice(end + PREVIEW_END.length);
  }
  const { title, description } = resolvePreviewCopy(opts);
  let next = source;
  if (/<title>[^<]*<\/title>/i.test(next)) {
    next = next.replace(/<title>[^<]*<\/title>/i, `<title>${escapeAttr(title)}</title>`);
  }
  if (/<meta\s+name="description"[^>]*>/i.test(next)) {
    next = next.replace(
      /<meta\s+name="description"[^>]*>/i,
      `<meta name="description" content="${escapeAttr(description)}" />`
    );
  }
  if (next.includes("<head>")) {
    return next.replace("<head>", `<head>\n    ${block}`);
  }
  return `${block}\n${next}`;
}
