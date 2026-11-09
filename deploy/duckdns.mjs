#!/usr/bin/env node
/**
 * DuckDNS helpers for PhoneHome Mothership.
 *
 * Env (phonehome.env):
 *   DUCKDNS_DOMAIN   subdomain only (e.g. myfamily) — not myfamily.duckdns.org
 *   DUCKDNS_TOKEN    account token from https://www.duckdns.org
 *   DUCKDNS_HTTPS_PORT  optional, default 8443 — used when deriving PUBLIC_BASE_URL
 *
 * Never logs the token. Update API: https://www.duckdns.org/spec.jsp
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const UPDATE_URL = "https://www.duckdns.org/update";
const DEFAULT_HTTPS_PORT = "8443";
const INTERVAL_MS = 5 * 60 * 1000;

/** @param {string} raw */
export function normalizeDuckDnsDomain(raw) {
  let d = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
  if (d.endsWith(".duckdns.org")) d = d.slice(0, -".duckdns.org".length);
  // subdomain only: letters, digits, hyphen
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(d)) return "";
  return d;
}

/** @param {string} token */
export function normalizeDuckDnsToken(token) {
  return String(token || "")
    .trim()
    .replace(/^["']|["']$/g, "");
}

/**
 * @param {{ domain: string, token: string, ip?: string, ipv6?: string, verbose?: boolean }} opts
 * @returns {Promise<{ ok: boolean, body: string }>}
 */
export async function updateDuckDns(opts) {
  const domain = normalizeDuckDnsDomain(opts.domain);
  const token = normalizeDuckDnsToken(opts.token);
  if (!domain || !token) {
    return { ok: false, body: "missing domain or token" };
  }
  const params = new URLSearchParams();
  params.set("domains", domain);
  params.set("token", token);
  if (opts.ip != null) params.set("ip", opts.ip);
  else params.set("ip", "");
  if (opts.ipv6) params.set("ipv6", opts.ipv6);
  if (opts.verbose) params.set("verbose", "true");

  const res = await fetch(`${UPDATE_URL}?${params.toString()}`, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.text()).trim();
  const ok = /^OK\b/i.test(body);
  return { ok, body };
}

/**
 * @param {{ domain: string, httpsPort?: string | number }} opts
 */
export function duckDnsPublicUrls(opts) {
  const domain = normalizeDuckDnsDomain(opts.domain);
  if (!domain) return null;
  const host = `${domain}.duckdns.org`;
  const port = String(opts.httpsPort || DEFAULT_HTTPS_PORT).trim() || DEFAULT_HTTPS_PORT;
  const origin =
    port === "443" ? `https://${host}` : `https://${host}:${port}`;
  return { host, origin, port };
}

/**
 * Fill PUBLIC_BASE_URL / SIP_PUBLIC_HOST from DuckDNS when empty or still placeholders.
 * @param {Record<string, string | undefined>} env
 */
export function applyDuckDnsToEnv(env) {
  const domain = normalizeDuckDnsDomain(env.DUCKDNS_DOMAIN || "");
  const token = normalizeDuckDnsToken(env.DUCKDNS_TOKEN || "");
  if (!domain || !token) return { applied: false, domain: "", host: "" };

  const urls = duckDnsPublicUrls({
    domain,
    httpsPort: env.DUCKDNS_HTTPS_PORT || DEFAULT_HTTPS_PORT,
  });
  if (!urls) return { applied: false, domain: "", host: "" };

  const pub = (env.PUBLIC_BASE_URL || "").trim();
  const sip = (env.SIP_PUBLIC_HOST || "").trim();
  const placeholder =
    !pub ||
    /example\.com|phonehome\.local/i.test(pub) ||
    pub === "https://";

  if (placeholder) env.PUBLIC_BASE_URL = urls.origin;
  if (!sip || sip === "phonehome.local" || /example\.com/i.test(sip)) {
    env.SIP_PUBLIC_HOST = urls.host;
  }
  return { applied: true, domain, host: urls.host };
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {{ log?: (msg: string) => void }} [opts]
 */
export function startDuckDnsUpdater(env, opts = {}) {
  const log = opts.log || ((msg) => console.log(msg));
  const domain = normalizeDuckDnsDomain(env.DUCKDNS_DOMAIN || "");
  const token = normalizeDuckDnsToken(env.DUCKDNS_TOKEN || "");
  if (!domain || !token) return null;

  const applied = applyDuckDnsToEnv(env);
  if (applied.applied) {
    log(`[duckdns] hostname ${applied.host} → PUBLIC_BASE_URL / SIP_PUBLIC_HOST`);
  } else {
    log(`[duckdns] updater enabled for ${domain}.duckdns.org`);
  }

  let timer = null;
  let stopped = false;

  async function tick() {
    if (stopped) return;
    try {
      const { ok, body } = await updateDuckDns({ domain, token });
      // Never echo token; body is OK/KO (+ optional verbose IPs).
      if (ok) log(`[duckdns] update OK (${domain}.duckdns.org)`);
      else log(`[duckdns] update failed: ${body.slice(0, 80)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[duckdns] update error: ${msg}`);
    }
  }

  void tick();
  timer = setInterval(() => void tick(), INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();

  return {
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
}

async function cliMain(argv) {
  const once = argv.includes("--once");
  const domain =
    normalizeDuckDnsDomain(process.env.DUCKDNS_DOMAIN || "") ||
    normalizeDuckDnsDomain(argv.find((a) => a.startsWith("--domain="))?.slice(9) || "");
  const token =
    normalizeDuckDnsToken(process.env.DUCKDNS_TOKEN || "") ||
    normalizeDuckDnsToken(argv.find((a) => a.startsWith("--token="))?.slice(8) || "");

  if (!domain || !token) {
    console.error(
      "Usage: duckdns.mjs --once  (needs DUCKDNS_DOMAIN + DUCKDNS_TOKEN in env)\n" +
        "   or: duckdns.mjs --once --domain=name --token=…",
    );
    process.exit(1);
  }

  const { ok, body } = await updateDuckDns({ domain, token, verbose: true });
  console.log(ok ? `OK ${domain}.duckdns.org` : `KO: ${body}`);
  process.exit(ok ? 0 : 1);
}

const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  void cliMain(process.argv.slice(2));
}
