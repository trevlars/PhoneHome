const APP_MODULE_RE = /<script\b[^>]*\bsrc=["']([^"']*\/app\.js(?:\?[^"']*)?)["'][^>]*>/i;

function buildVersionFromUrl(value, baseUrl) {
  try {
    const url = new URL(String(value || ""), baseUrl);
    if (!/\/app\.js$/i.test(url.pathname)) return "";
    return String(url.searchParams.get("v") || "").trim();
  } catch {
    return "";
  }
}

/** Build token attached to the currently executing app.js module. */
export function appBuildVersionFromModuleUrl(moduleUrl) {
  return buildVersionFromUrl(moduleUrl);
}

/** Build token advertised by a freshly fetched PhoneHome index document. */
export function appBuildVersionFromHtml(html, baseUrl = "https://phonehome.invalid/") {
  const match = String(html || "").match(APP_MODULE_RE);
  return match ? buildVersionFromUrl(match[1], baseUrl) : "";
}

function comparableBuildNumber(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-z]+$/.test(raw)) return null;
  const parsed = Number.parseInt(raw, 36);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** build.mjs uses Date.now().toString(36), so numeric base-36 order is chronological. */
export function compareBuildVersions(left, right) {
  const a = comparableBuildNumber(left);
  const b = comparableBuildNumber(right);
  if (a == null || b == null) return null;
  return a === b ? 0 : a < b ? -1 : 1;
}

export function isNewerBuildVersion(currentVersion, availableVersion) {
  return compareBuildVersions(currentVersion, availableVersion) === -1;
}

/**
 * Decide whether a detected update should reload now or wait for calls/media/
 * submissions to become idle. Pending survives later checks that find no new token.
 */
export function webUpdateDecision({
  currentVersion,
  availableVersion,
  pending = false,
  busy = false,
  reloading = false,
} = {}) {
  if (reloading) return "none";
  const newer = isNewerBuildVersion(currentVersion, availableVersion);
  if (!newer && !pending) return "none";
  return busy ? "defer" : "reload";
}
