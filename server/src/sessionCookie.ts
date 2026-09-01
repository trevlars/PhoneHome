import type { CookieOptions, Request } from "express";

/** Session cookie flags for the parent app. HTTPS gets Secure; always Path=/ so WKWebView keeps it. */
export function sessionCookieOptions(req?: Pick<Request, "secure" | "headers">): CookieOptions {
  const xf = String(req?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const secure = Boolean(req?.secure) || xf === "https";
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 864e5,
    ...(secure ? { secure: true } : {}),
  };
}
