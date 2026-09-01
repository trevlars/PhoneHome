#!/usr/bin/env node
/**
 * Runs PhoneHome hub + SIP bridge as one background process (parent-friendly).
 * Used by macOS LaunchAgent, Linux systemd user service, and Windows scheduled task.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const children = [];
let stopping = false;

function start(name, cmd, args, cwd) {
  const child = spawn(cmd, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(`[supervisor] ${name} exited (code=${code} signal=${signal})`);
    shutdown(code || 1);
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
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

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const node = process.execPath;

console.log(`[supervisor] PhoneHome data dir: ${process.env.DATA_DIR}`);
console.log(`[supervisor] PUBLIC_BASE_URL=${process.env.PUBLIC_BASE_URL || "(not set — set in phonehome.env)"}`);

start("hub", npm, ["run", "start", "-w", "server"], REPO_ROOT);
start("bridge", node, ["src/index.mjs"], path.join(REPO_ROOT, "bridged"));
