#!/usr/bin/env node
/**
 * Runs PhoneHome hub + SIP bridge as one background process (parent-friendly).
 * Used by macOS LaunchAgent, Linux systemd user service, and Windows scheduled task.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startDuckDnsUpdater } from "./duckdns.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const dataDir =
  process.env.DATA_DIR ||
  (process.platform === "win32"
    ? path.join(process.env.USERPROFILE || "", ".phonehome")
    : path.join(process.env.HOME || "", ".phonehome"));

loadEnvFile(path.join(dataDir, "phonehome.env"));
loadEnvFile(path.join(dataDir, "bridge.env"));

if (!process.env.DATA_DIR) process.env.DATA_DIR = dataDir;
if (!process.env.PORT) process.env.PORT = "8787";

const duckDns = startDuckDnsUpdater(process.env, {
  log: (msg) => console.log(msg),
});

const children = [];
let stopping = false;

function start(name, cmd, args, cwd, { fatal = true } = {}) {
  const child = spawn(cmd, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(`[supervisor] ${name} exited (code=${code} signal=${signal})`);
    if (fatal) {
      shutdown(code || 1);
      return;
    }
    // Softphone-only hosts (macOS DMG, no FreePBX) often have no ARI on :8088.
    // Keep the hub up; analog bridge can be added later when Asterisk is present.
    console.error(
      `[supervisor] ${name} is optional here — hub keeps running. Set BRIDGE_REQUIRED=1 to treat bridge failure as fatal.`
    );
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  try {
    duckDns?.stop();
  } catch {
    /* ignore */
  }
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => process.exit(code), 1500);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function bundledNode() {
  const win = process.platform === "win32";
  const rel = win ? path.join("node", "node.exe") : path.join("node", "bin", "node");
  const candidate = path.join(REPO_ROOT, rel);
  return fs.existsSync(candidate) ? candidate : null;
}

const node = bundledNode() || process.execPath;
const hubDist = path.join(REPO_ROOT, "server/dist/index.js");

console.log(`[supervisor] PhoneHome data dir: ${process.env.DATA_DIR}`);
console.log(`[supervisor] Node: ${node}`);
console.log(`[supervisor] PUBLIC_BASE_URL=${process.env.PUBLIC_BASE_URL || "(not set — set in phonehome.env)"}`);

if (fs.existsSync(hubDist)) {
  start("hub", node, [hubDist], path.join(REPO_ROOT, "server"), { fatal: true });
} else {
  // Packaged installs ship server/dist. Falling back to `npm start` (tsx) fails with
  // exit 127 when tsx is omitted from production node_modules.
  console.error(
    "[supervisor] Missing server/dist/index.js — reinstall the Mothership package (or run npm run build -w server)."
  );
  process.exit(127);
}

const bridgeRequired =
  String(process.env.BRIDGE_REQUIRED || "").trim() === "1" ||
  String(process.env.ATA_LAN_PUSH || "").trim() === "1";
const skipBridge = String(process.env.SKIP_BRIDGE || "").trim() === "1";
if (!skipBridge) {
  start("bridge", node, ["src/index.mjs"], path.join(REPO_ROOT, "bridged"), {
    fatal: bridgeRequired,
  });
} else {
  console.log("[supervisor] SKIP_BRIDGE=1 — not starting SIP bridge");
}
