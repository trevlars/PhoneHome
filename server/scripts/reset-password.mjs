/**
 * Admin: set a new password for a username (scrypt hash in SQLite).
 * Works for any account — parent or child login linked to a child line.
 * Usage:
 *   DATA_DIR=/var/lib/kids-landline node server/scripts/reset-password.mjs <username> <newPassword>
 *
 * Parents/guardians can also reset a child line’s login from Parent → Child login
 * (API: POST /api/lines/:lineId/reset-child-password) without server shell access.
 */
import Database from "better-sqlite3";
import { randomBytes, scryptSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.resolve("data");
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "kids-landline.db");

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  }).toString("hex");
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${hash}`;
}

const username = String(process.argv[2] || "")
  .trim()
  .toLowerCase();
const newPassword = String(process.argv[3] || "");

if (!username || !newPassword) {
  console.error("Usage: DATA_DIR=... node server/scripts/reset-password.mjs <username> <newPassword>");
  process.exit(1);
}
if (newPassword.length < 8) {
  console.error("Password must be at least 8 characters");
  process.exit(1);
}
if (!fs.existsSync(DB_PATH)) {
  console.error("No database at", DB_PATH);
  process.exit(1);
}

const db = new Database(DB_PATH);
const cols = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name);
if (!cols.includes("username") || !cols.includes("password_hash")) {
  console.error("Database missing username/password_hash — restart kids-landline once to migrate, then retry.");
  process.exit(1);
}

const user = db
  .prepare(`SELECT id, display_name, username FROM users WHERE username IS NOT NULL AND lower(username) = ?`)
  .get(username);
if (!user) {
  console.error(`No user with username “${username}”`);
  const sample = db
    .prepare(`SELECT username, display_name FROM users WHERE username IS NOT NULL ORDER BY created_at LIMIT 20`)
    .all();
  if (sample.length) {
    console.error("Known usernames:");
    for (const u of sample) console.error(`  ${u.username}  (${u.display_name})`);
  }
  process.exit(1);
}

const childLine = db
  .prepare(`SELECT id, name, child_label FROM lines WHERE child_user_id = ? LIMIT 1`)
  .get(user.id);

db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(newPassword), user.id);
const when = new Date().toISOString();
console.log(`[audit] password reset by admin for username=${user.username} user_id=${user.id} at ${when}`);
console.log(`Password updated for ${user.username} (${user.display_name}).`);
if (childLine) {
  console.log(
    `Note: this username is the child login for line “${childLine.child_label || childLine.name}” (${childLine.id}).`
  );
}
console.log("They can sign in with username + the new password on the HTTPS URL.");
db.close();
