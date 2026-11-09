import assert from "node:assert/strict";
import test from "node:test";
import { sessionCookieOptions } from "./sessionCookie.js";

test("session cookies are httpOnly, lax, path /", () => {
  const opts = sessionCookieOptions();
  assert.equal(opts.httpOnly, true);
  assert.equal(opts.sameSite, "lax");
  assert.equal(opts.path, "/");
  assert.equal(opts.maxAge, 30 * 864e5);
  assert.equal(opts.secure, undefined);
});

test("session cookies are Secure on HTTPS (including forwarded proto)", () => {
  const direct = sessionCookieOptions({ secure: true, headers: {} });
  assert.equal(direct.secure, true);
  const viaProxy = sessionCookieOptions({
    secure: false,
    headers: { "x-forwarded-proto": "https, http" },
  });
  assert.equal(viaProxy.secure, true);
});
