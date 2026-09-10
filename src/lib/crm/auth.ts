// Node-side admin auth (contract §3 Auth, §10 Security): scrypt password
// check, the signed dm_admin cookie, CSRF tokens and the per-page / per-route
// guards. Only node:crypto is imported at the top so node --test can load the
// sign/verify half; next/headers, next/navigation and next/server are pulled in
// lazily by the functions that need them (plain Node cannot resolve them).
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import type { AdminSession } from "./types.ts";
import { MIN_SECRET_LENGTH, parseSessionPayload, sessionSecretFromEnv, sessionVersionFromEnv } from "./authEdge.ts";

export const ADMIN_COOKIE = "dm_admin";
export const SESSION_MAX_AGE = 604_800; // 7 days, seconds

// Same expression as SITE_URL in @/lib/seo — that module pulls the whole content
// tree, which node --test cannot resolve through the "@/" alias. Read lazily so
// tests can set the env before calling.
function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://d3v.digitalm.eu").replace(/\/$/, "");
}
// Shared with the edge verifier (authEdge.ts) — never read the env directly here.
function sessionSecret(): string {
  return sessionSecretFromEnv();
}
function sessionVersion(): string {
  return sessionVersionFromEnv();
}

/** False → login must answer 500 (contract: secret ≥ 32 chars). */
export function sessionSecretOk(): boolean {
  return sessionSecret().length >= MIN_SECRET_LENGTH;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ---- cookie -------------------------------------------------------------------

export function signPayload(payloadB64: string, secret: string, version: string | number): string {
  return createHmac("sha256", secret).update(`v${version}|${payloadB64}`).digest("base64url");
}

export function signSession(session: AdminSession, secret = sessionSecret(), version: string | number = sessionVersion()): string {
  const payloadB64 = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `v1.${payloadB64}.${signPayload(payloadB64, secret, version)}`;
}

/** Fresh 7-day cookie value for a successful login. */
export function sessionCookie(method: AdminSession["method"], subject: string, now = Date.now()): string {
  const iat = Math.floor(now / 1000);
  return signSession({ method, subject, iat, exp: iat + SESSION_MAX_AGE, nonce: randomBytes(16).toString("base64url") });
}

/** Explicit-secret variant (tests, rotation checks). Never throws. */
export function verifySession(
  cookie: string | undefined | null,
  secret: string,
  version: string | number,
  now = Date.now(),
): AdminSession | null {
  if (!cookie || secret.length < MIN_SECRET_LENGTH) return null;
  const parts = cookie.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) return null;
  const payloadB64 = parts[1];
  const expected = signPayload(payloadB64, secret, version);
  if (!safeEqual(parts[2], expected)) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(payloadB64)) return null;
  return parseSessionPayload(Buffer.from(payloadB64, "base64url").toString("utf8"), now);
}

export function readSession(cookie?: string | null): AdminSession | null {
  return verifySession(cookie, sessionSecret(), sessionVersion());
}

/** Options for NextResponse.cookies.set — HttpOnly, Secure on https, Lax, 7 days. */
export function sessionCookieOptions(maxAge = SESSION_MAX_AGE) {
  return {
    httpOnly: true,
    secure: siteUrl().startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

// ---- password -----------------------------------------------------------------

const SCRYPT_RE = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/;

function parsePasswordHash(s: string): { N: number; r: number; p: number; salt: Buffer; hash: Buffer } | null {
  const m = SCRYPT_RE.exec(s.trim());
  if (!m) return null;
  const N = Number(m[1]);
  const r = Number(m[2]);
  const p = Number(m[3]);
  const salt = Buffer.from(m[4]!, "base64");
  const hash = Buffer.from(m[5]!, "base64");
  if (!Number.isInteger(N) || N < 1024 || (N & (N - 1)) !== 0 || r < 1 || p < 1 || !salt.length || !hash.length) return null;
  return { N, r, p, salt, hash };
}

/** "scrypt$16384$8$1$<saltB64>$<hashB64>" — the format scripts/crm-hash-password.js prints. */
export function formatPasswordHash(plain: string, salt = randomBytes(16)): string {
  const hash = scryptSync(plain, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function passwordHashConfigured(): boolean {
  return parsePasswordHash(process.env.ADMIN_PASSWORD_HASH ?? "") !== null;
}

/** Constant-time scrypt comparison against ADMIN_PASSWORD_HASH; false when unset or malformed. */
export function verifyPassword(plain: string, stored = process.env.ADMIN_PASSWORD_HASH ?? ""): boolean {
  const parsed = parsePasswordHash(stored);
  if (!parsed || typeof plain !== "string" || !plain) return false;
  let derived: Buffer;
  try {
    derived = scryptSync(plain, parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: 256 * parsed.N * parsed.r + 1024 * 1024,
    });
  } catch {
    return false;
  }
  return derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);
}

// ---- CSRF ---------------------------------------------------------------------

export function csrfTokenFor(s: AdminSession, secret = sessionSecret()): string {
  return createHmac("sha256", secret).update(`csrf|${s.nonce}`).digest("base64url");
}

/**
 * Origin must equal SITE_URL (Referer prefix accepted when Origin is absent;
 * both absent → false) and x-dm-csrf must match the session's token.
 */
export function checkCsrf(req: Pick<Request, "headers">, s: AdminSession): boolean {
  const site = siteUrl();
  const origin = req.headers.get("origin");
  if (origin !== null) {
    if (origin !== site) return false;
  } else {
    const referer = req.headers.get("referer");
    if (!referer || !(referer === site || referer.startsWith(`${site}/`))) return false;
  }
  const token = req.headers.get("x-dm-csrf") ?? "";
  return token.length > 0 && safeEqual(token, csrfTokenFor(s));
}

/** Post-login destination: only same-site /admin paths, else "/admin" (no open redirect). */
export function safeAdminNext(v: unknown): string {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== "string" || s.length > 500) return "/admin";
  return /^\/admin(?:[/?#]|$)/.test(s) && !/[\\\r\n]/.test(s) && !s.startsWith("/admin//") ? s : "/admin";
}

// ---- guards -------------------------------------------------------------------

/** Server components: every (gated) page starts with `await requireAdmin("/admin/…")`. */
export async function requireAdmin(path = "/admin"): Promise<AdminSession> {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  const session = readSession(jar.get(ADMIN_COOKIE)?.value);
  if (session) return session;
  const { redirect } = await import("next/navigation");
  return redirect(`/admin/login?next=${encodeURIComponent(path)}`);
}

/** Route handlers (GET): the session, or a 401 JSON response to return as is. */
export async function requireAdminApi(req: NextRequest): Promise<AdminSession | NextResponse> {
  const session = readSession(req.cookies.get(ADMIN_COOKIE)?.value);
  if (session) return session;
  const { NextResponse: Res } = await import("next/server");
  return Res.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

/** Route handlers (POST): 401 without a session, 403 on a CSRF miss, else the session. */
export async function guardAdminPost(req: NextRequest): Promise<AdminSession | NextResponse> {
  const session = readSession(req.cookies.get(ADMIN_COOKIE)?.value);
  const { NextResponse: Res } = await import("next/server");
  if (!session) return Res.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!checkCsrf(req, session)) return Res.json({ ok: false, error: "csrf" }, { status: 403 });
  return session;
}

/** Type guard so routes can `if (isResponse(x)) return x;`. */
export function isResponse(x: unknown): x is NextResponse {
  return x instanceof Response;
}
