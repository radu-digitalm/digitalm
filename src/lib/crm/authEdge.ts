// Edge-safe verification of the dm_admin cookie (contract §10). Web Crypto and
// Web APIs only — no Node imports — so src/middleware.ts can run it in the edge
// build. auth.ts (Node) produces the cookie; both sides share the payload
// parser below so they agree on every test vector.
//
// Cookie: v1.<payloadB64>.<sigB64>
//   payloadB64 = base64url(JSON{iat,exp,method,subject,nonce})
//   sigB64     = base64url(HMAC-SHA256(secret, "v" + version + "|" + payloadB64))
import type { AdminSession } from "./types.ts";

export const MIN_SECRET_LENGTH = 32;

// The ONLY readers of the two session env vars. auth.ts (Node) and
// src/middleware.ts (edge) both go through these, so the two verifiers can
// never normalise differently — a disagreement would send /admin into a
// redirect loop (edge 307s to login, Node accepts the cookie and bounces back).
// `env` is injectable for tests; the secret is taken verbatim (no trim) so a
// rotated value behaves identically on both sides.
type EnvLike = Record<string, string | undefined>;

export function sessionSecretFromEnv(env: EnvLike = process.env): string {
  return env.ADMIN_SESSION_SECRET ?? "";
}

/** Trimmed ADMIN_SESSION_VERSION, "1" when unset or blank. */
export function sessionVersionFromEnv(env: EnvLike = process.env): string {
  return (env.ADMIN_SESSION_VERSION ?? "").trim() || "1";
}

export function bytesToBase64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlToBytes(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Constant-time string equality after an explicit length check. */
export function safeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Validates a decoded payload: shape, method, non-empty subject, unexpired. */
export function parseSessionPayload(json: string, now = Date.now()): AdminSession | null {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.method !== "password" && o.method !== "google") return null;
  if (typeof o.subject !== "string" || !o.subject) return null;
  if (typeof o.nonce !== "string" || !o.nonce) return null;
  if (typeof o.iat !== "number" || !Number.isFinite(o.iat)) return null;
  if (typeof o.exp !== "number" || !Number.isFinite(o.exp)) return null;
  if (o.exp * 1000 <= now) return null;
  return { method: o.method, subject: o.subject, iat: o.iat, exp: o.exp, nonce: o.nonce };
}

async function hmacBase64url(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return bytesToBase64url(new Uint8Array(sig));
}

/** Same format and rules as auth.ts readSession; null on any defect, never throws. */
export async function verifySessionEdge(
  cookie: string | undefined | null,
  secret: string,
  version: string | number,
  now = Date.now(),
): Promise<AdminSession | null> {
  if (!cookie || typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) return null;
  const parts = cookie.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) return null;
  const payloadB64 = parts[1];
  const expected = await hmacBase64url(secret, `v${version}|${payloadB64}`);
  if (!safeEqualStrings(parts[2], expected)) return null;
  const bytes = base64urlToBytes(payloadB64);
  if (!bytes) return null;
  return parseSessionPayload(new TextDecoder().decode(bytes), now);
}
