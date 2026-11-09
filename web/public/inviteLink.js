/** 6-digit family invite from a shared URL — digits only, never SIP secrets. */
export function normalizeInviteCode(raw) {
  return String(raw || "")
    .replace(/\D/g, "")
    .slice(0, 6);
}

/** One-tap Grandma claim token (`/?gp=…`) — opaque base64url, not a password. */
export function normalizeGrandparentSetupToken(raw) {
  const t = String(raw || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "");
  return t.length >= 20 && t.length <= 64 ? t : "";
}

/** One-tap parent join token (`/?join=…`) — same opaque shape as `/?gp=`. */
export function normalizeJoinToken(raw) {
  return normalizeGrandparentSetupToken(raw);
}

function firstSixDigit(raw) {
  const cleaned = normalizeInviteCode(raw);
  return cleaned.length === 6 ? cleaned : "";
}

function codesFromSearchParams(params) {
  if (!params) return [];
  return [params.get("grandparent"), params.get("invite"), params.get("familyInvite")].filter(Boolean);
}

function gpTokensFromSearchParams(params) {
  if (!params) return [];
  return [params.get("gp"), params.get("gpSetup")].filter(Boolean);
}

function joinTokensFromSearchParams(params) {
  if (!params) return [];
  return [params.get("join")].filter(Boolean);
}

/** Dedicated Grandma link (`?grandparent=`) vs family/friend (`?invite=`). */
export function parseInviteKindFromHref(href) {
  if (!href) return "";
  try {
    const url = new URL(String(href), "https://phonehome.local");
    if (url.searchParams.get("grandparent")) return "grandparent";
    const hash = String(url.hash || "").replace(/^#/, "");
    if (hash) {
      const params = new URLSearchParams(hash.startsWith("?") ? hash.slice(1) : hash);
      if (params.get("grandparent")) return "grandparent";
    }
  } catch {
    /* ignore */
  }
  return "";
}

function codesFromPathname(pathname) {
  const m = String(pathname || "").match(/\/(?:invite|join)\/(\d{4,8})(?:\/|$)/i);
  return m ? [m[1]] : [];
}

function codesFromHash(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  if (!raw) return [];
  const out = [];
  const asQuery = raw.startsWith("?") ? raw.slice(1) : raw.includes("=") ? raw.replace(/^\//, "") : "";
  if (asQuery) {
    try {
      const params = new URLSearchParams(asQuery.replace(/^\?/, ""));
      out.push(...codesFromSearchParams(params));
    } catch {
      /* ignore */
    }
  }
  try {
    const hashUrl = new URL(raw.startsWith("/") ? raw : `/${raw}`, "https://phonehome.local");
    out.push(...codesFromSearchParams(hashUrl.searchParams));
    out.push(...codesFromPathname(hashUrl.pathname));
  } catch {
    /* ignore */
  }
  const tagged = raw.match(/(?:^|[?&#/])invite[=/](\d{4,8})\b/i);
  if (tagged) out.push(tagged[1]);
  return out;
}

function gpTokensFromHash(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  if (!raw) return [];
  const out = [];
  const asQuery = raw.startsWith("?") ? raw.slice(1) : raw.includes("=") ? raw.replace(/^\//, "") : "";
  if (asQuery) {
    try {
      const params = new URLSearchParams(asQuery.replace(/^\?/, ""));
      out.push(...gpTokensFromSearchParams(params));
    } catch {
      /* ignore */
    }
  }
  try {
    const hashUrl = new URL(raw.startsWith("/") ? raw : `/${raw}`, "https://phonehome.local");
    out.push(...gpTokensFromSearchParams(hashUrl.searchParams));
  } catch {
    /* ignore */
  }
  const tagged = raw.match(/(?:^|[?&#/])gp[=/]([A-Za-z0-9_-]{20,64})\b/i);
  if (tagged) out.push(tagged[1]);
  return out;
}

function joinTokensFromHash(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  if (!raw) return [];
  const out = [];
  const asQuery = raw.startsWith("?") ? raw.slice(1) : raw.includes("=") ? raw.replace(/^\//, "") : "";
  if (asQuery) {
    try {
      const params = new URLSearchParams(asQuery.replace(/^\?/, ""));
      out.push(...joinTokensFromSearchParams(params));
    } catch {
      /* ignore */
    }
  }
  try {
    const hashUrl = new URL(raw.startsWith("/") ? raw : `/${raw}`, "https://phonehome.local");
    out.push(...joinTokensFromSearchParams(hashUrl.searchParams));
    const pathTok = String(hashUrl.pathname || "").match(/^\/join\/([A-Za-z0-9_-]{20,64})\/?$/i);
    if (pathTok) out.push(pathTok[1]);
  } catch {
    /* ignore */
  }
  const tagged = raw.match(/(?:^|[?&#/])join[=/]([A-Za-z0-9_-]{20,64})\b/i);
  if (tagged) out.push(tagged[1]);
  return out;
}

/**
 * Read a family invite code from query, hash, or path.
 * Share links use `/?invite=123456`. Hash/path covers QR/share-sheet rewrites.
 */
export function parseInviteCodeFromHref(href) {
  if (!href) return "";
  let url;
  try {
    url = new URL(String(href), "https://phonehome.local");
  } catch {
    return "";
  }
  const candidates = [
    ...codesFromSearchParams(url.searchParams),
    ...codesFromPathname(url.pathname),
    ...codesFromHash(url.hash),
  ];
  for (const c of candidates) {
    const code = firstSixDigit(c);
    if (code) return code;
  }
  return "";
}

/** One-tap Grandma claim from `/?gp=…` (or hash). */
export function parseGrandparentSetupTokenFromHref(href) {
  if (!href) return "";
  let url;
  try {
    url = new URL(String(href), "https://phonehome.local");
  } catch {
    return "";
  }
  const candidates = [
    ...gpTokensFromSearchParams(url.searchParams),
    ...gpTokensFromHash(url.hash),
  ];
  for (const c of candidates) {
    const token = normalizeGrandparentSetupToken(c);
    if (token) return token;
  }
  return "";
}

/** One-tap parent join from `/?join=…` (family / friend / co-parent). */
export function parseJoinTokenFromHref(href) {
  if (!href) return "";
  let url;
  try {
    url = new URL(String(href), "https://phonehome.local");
  } catch {
    return "";
  }
  const pathTok = String(url.pathname || "").match(/^\/join\/([A-Za-z0-9_-]{20,64})\/?$/i);
  const candidates = [
    ...joinTokensFromSearchParams(url.searchParams),
    ...(pathTok ? [pathTok[1]] : []),
    ...joinTokensFromHash(url.hash),
  ];
  for (const c of candidates) {
    const token = normalizeJoinToken(c);
    if (token) return token;
  }
  return "";
}

/** First https URL in share-sheet text (invite / Grandma / co-parent). */
export function extractHttpsUrlFromText(text) {
  const m = String(text || "").match(/https:\/\/[^\s<>"']+/i);
  if (!m) return "";
  return m[0].replace(/[),.;:!?]+$/g, "");
}

/**
 * Drop a bare URL line from share text when `navigator.share({ url })` is set —
 * otherwise iMessage shows the link twice and still may skip the rich preview.
 */
export function textForShareWithUrl(text, url) {
  const link = String(url || "").trim();
  let body = String(text || "");
  if (!link) return body.trim();
  if (body.includes(link)) {
    body = body.split(link).join("");
  }
  return body
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Native Connect gate / paste: accept a bare hub origin or a full share link.
 * Share links (`/?join=`, `/?gp=`, `/?invite=`) carry both the Mothership HTTPS
 * origin and a one-time token — keep `openPath` so Cap can load that URL after
 * saving the origin (sessionStorage would not survive the WebView hop).
 *
 * @returns {{
 *   origin: string,
 *   openPath: string,
 *   joinToken: string,
 *   gpToken: string,
 *   inviteCode: string,
 *   inviteKind: string,
 * }}
 */
export function parseMothershipShareInput(raw) {
  let s = String(raw || "").trim();
  if (!s) throw new Error("Enter your Mothership HTTPS address");
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new Error("That doesn’t look like a valid HTTPS URL");
  }
  if (u.protocol !== "https:") throw new Error("Mothership address must start with https://");
  if (!u.hostname) throw new Error("That doesn’t look like a valid HTTPS URL");
  const origin = `${u.protocol}//${u.host}`;
  const href = u.href;
  const joinToken = parseJoinTokenFromHref(href);
  const gpToken = parseGrandparentSetupTokenFromHref(href);
  const inviteCode = parseInviteCodeFromHref(href);
  const inviteKind = parseInviteKindFromHref(href);
  let openPath = "";
  if (joinToken) openPath = `/?join=${encodeURIComponent(joinToken)}`;
  else if (gpToken) openPath = `/?gp=${encodeURIComponent(gpToken)}`;
  else if (inviteCode) {
    const key = inviteKind === "grandparent" ? "grandparent" : "invite";
    openPath = `/?${key}=${encodeURIComponent(inviteCode)}`;
  }
  return { origin, openPath, joinToken, gpToken, inviteCode, inviteKind };
}

/** Drop invite params from the address bar after the code is stored in sessionStorage. */
export function hrefWithoutInviteParams(href) {
  let url;
  try {
    url = new URL(String(href), "https://phonehome.local");
  } catch {
    return href;
  }
  url.searchParams.delete("invite");
  url.searchParams.delete("familyInvite");
  url.searchParams.delete("grandparent");
  url.searchParams.delete("gp");
  url.searchParams.delete("gpSetup");
  url.searchParams.delete("join");
  url.searchParams.delete("guardian");
  let path = url.pathname
    .replace(/\/(?:invite|join)\/\d{4,8}\/?$/i, "/")
    .replace(/\/join\/[A-Za-z0-9_-]{20,64}\/?$/i, "/");
  if (!path) path = "/";
  let hash = url.hash || "";
  if (hash) {
    hash = hash
      .replace(/([?&#])invite=\d{4,8}\b/gi, "$1")
      .replace(/([?&#])familyInvite=\d{4,8}\b/gi, "$1")
      .replace(/([?&#])gp=[A-Za-z0-9_-]{20,64}\b/gi, "$1")
      .replace(/([?&#])gpSetup=[A-Za-z0-9_-]{20,64}\b/gi, "$1")
      .replace(/([?&#])join=[A-Za-z0-9_-]{20,64}\b/gi, "$1")
      .replace(/([?&#])guardian=\d{4,8}\b/gi, "$1")
      .replace(/\/(?:invite|join)\/\d{4,8}\b/gi, "")
      .replace(/\/join\/[A-Za-z0-9_-]{20,64}\b/gi, "")
      .replace(/[?&]+$/g, "")
      .replace(/#\/?$/g, "");
    if (hash === "#" || hash === "#/" || hash === "#?") hash = "";
  }
  return `${path}${url.search}${hash}`;
}
