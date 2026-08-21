#!/usr/bin/env node
/**
 * Reissue 6-digit login codes for every parent (HTTPS migration / lost codes).
 * Usage: DATA_DIR=/var/lib/kids-landline node server/scripts/reissue-codes.mjs
 */
import Database from "better-sqlite3";
import { createHash, randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.resolve("data");
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "kids-landline.db");

function hashCode(code) {
  return createHash("sha256").update(code).digest("hex");
}

if (!fs.existsSync(DB_PATH)) {
  console.error("No database at", DB_PATH);
  process.exit(1);
}

const db = new Database(DB_PATH);
const users = db.prepare(`SELECT id, display_name FROM users ORDER BY created_at`).all();
console.log("Fresh login codes (share privately):\n");
for (const u of users) {
  const code = String(randomInt(100000, 999999));
  db.prepare(`UPDATE users SET setup_code_hash = ? WHERE id = ?`).run(hashCode(code), u.id);
  console.log(`  ${u.display_name || "(unnamed)"}  →  ${code}`);
}
console.log("\nParents open the HTTPS link → Already set up? Sign in with your code.");
db.close();
