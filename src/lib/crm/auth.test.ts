import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import type { AdminSession } from "./types.ts";
import {
  checkCsrf,
  csrfTokenFor,
  formatPasswordHash,
  readSession,
  sessionCookie,
  sessionSecretOk,
  signSession,
  verifyPassword,
  verifySession,
} from "./auth.ts";

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.ADMIN_SESSION_SECRET = SECRET;
process.env.ADMIN_SESSION_VERSION = "1";
process.env.NEXT_PUBLIC_SITE_URL = "https://d3v.digitalm.eu";

test("sessionCookie round-trips through readSession", () => {
  const cookie = sessionCookie("password", "radu");
  assert.match(cookie, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  const s = readSession(cookie);
  assert.ok(s);
  assert.equal(s.method, "password");
  assert.equal(s.subject, "radu");
  assert.equal(s.exp - s.iat, 604_800);
  assert.equal(typeof s.nonce, "string");
  assert.ok(s.nonce.length >= 16);
});

test("tampered, truncated, malformed cookies → null, never a throw", () => {
  const cookie = sessionCookie("password", "radu");
  const [v, payload, sig] = cookie.split(".") as [string, string, string];
  assert.equal(readSession(`${v}.${payload}.${sig.slice(0, -1)}`), null); // truncated signature
  assert.equal(readSession(`${v}.${payload}.${sig.slice(0, -1)}A`), null); // flipped char
  assert.equal(readSession(`${v}.${payload}x.${sig}`), null); // payload edited
  assert.equal(readSession(`v2.${payload}.${sig}`), null); // wrong format version
  assert.equal(readSession(`${payload}.${sig}`), null);
  assert.equal(readSession("v1..sig"), null);
  assert.equal(readSession("garbage"), null);
  assert.equal(readSession(""), null);
  assert.equal(readSession(undefined), null);
  // A valid signature over a payload that is not JSON must also fail closed.
  const bogus = Buffer.from("not json").toString("base64url");
  assert.equal(verifySession(signSession({ method: "password", subject: "x", iat: 1, exp: 2, nonce: "n" }).replace(/\.[^.]+\./, `.${bogus}.`), SECRET, "1"), null);
});

test("expiry and session version are enforced", () => {
  const now = Date.now();
  const iat = Math.floor(now / 1000) - 10;
  const s: AdminSession = { method: "password", subject: "radu", iat, exp: iat + 60, nonce: "abc" };
  const cookie = signSession(s, SECRET, "1");
  assert.equal(verifySession(cookie, SECRET, "1", now)?.subject, "radu");
  assert.equal(verifySession(cookie, SECRET, "1", now + 120_000), null); // expired
  assert.equal(verifySession(cookie, SECRET, "2", now), null); // version bumped
  assert.equal(verifySession(cookie, `${SECRET}x`, "1", now), null); // other secret
  assert.equal(verifySession(cookie, "short", "1", now), null); // secret too short
  const versioned = signSession(s, SECRET, 2);
  assert.equal(verifySession(versioned, SECRET, "2", now)?.subject, "radu");
  assert.equal(verifySession(versioned, SECRET, "1", now), null);
});

test("payload shape is validated", () => {
  const now = Date.now();
  const bad = (o: Record<string, unknown>) =>
    verifySession(signSession(o as unknown as AdminSession, SECRET, "1"), SECRET, "1", now);
  assert.equal(bad({ method: "magic", subject: "r", iat: 1, exp: now / 1000 + 100, nonce: "n" }), null);
  assert.equal(bad({ method: "password", subject: "", iat: 1, exp: now / 1000 + 100, nonce: "n" }), null);
  assert.equal(bad({ method: "password", subject: "r", iat: 1, exp: "soon", nonce: "n" }), null);
  assert.equal(bad({ method: "password", subject: "r", iat: 1, exp: now / 1000 + 100 }), null);
});

test("sessionSecretOk requires ≥ 32 chars", () => {
  assert.equal(sessionSecretOk(), true);
  const saved = process.env.ADMIN_SESSION_SECRET;
  process.env.ADMIN_SESSION_SECRET = "too-short";
  assert.equal(sessionSecretOk(), false);
  assert.equal(readSession(sessionCookie("password", "radu")), null);
  process.env.ADMIN_SESSION_SECRET = saved;
});

test("csrfTokenFor is deterministic per nonce and bound to the secret", () => {
  const a: AdminSession = { method: "password", subject: "radu", iat: 1, exp: 2, nonce: "nonce-a" };
  const b: AdminSession = { ...a, nonce: "nonce-b" };
  assert.equal(csrfTokenFor(a), csrfTokenFor(a));
  assert.notEqual(csrfTokenFor(a), csrfTokenFor(b));
  assert.notEqual(csrfTokenFor(a), csrfTokenFor(a, `${SECRET}x`));
  assert.match(csrfTokenFor(a), /^[A-Za-z0-9_-]{43}$/);
});

test("checkCsrf: origin/referer against SITE_URL plus the header token", () => {
  const s: AdminSession = { method: "password", subject: "radu", iat: 1, exp: 2, nonce: "n1" };
  const token = csrfTokenFor(s);
  const req = (h: Record<string, string>) => ({ headers: new Headers(h) });
  assert.equal(checkCsrf(req({ origin: "https://d3v.digitalm.eu", "x-dm-csrf": token }), s), true);
  assert.equal(checkCsrf(req({ referer: "https://d3v.digitalm.eu/admin/leads", "x-dm-csrf": token }), s), true);
  assert.equal(checkCsrf(req({ origin: "https://evil.example", "x-dm-csrf": token }), s), false);
  assert.equal(checkCsrf(req({ origin: "https://d3v.digitalm.eu.evil.example", "x-dm-csrf": token }), s), false);
  assert.equal(checkCsrf(req({ referer: "https://d3v.digitalm.eu.evil.example/x", "x-dm-csrf": token }), s), false);
  assert.equal(checkCsrf(req({ origin: "null", "x-dm-csrf": token }), s), false);
  assert.equal(checkCsrf(req({ "x-dm-csrf": token }), s), false); // neither header
  assert.equal(checkCsrf(req({ origin: "https://d3v.digitalm.eu" }), s), false); // no token
  assert.equal(checkCsrf(req({ origin: "https://d3v.digitalm.eu", "x-dm-csrf": token.slice(0, -1) }), s), false);
  assert.equal(checkCsrf(req({ origin: "https://d3v.digitalm.eu", "x-dm-csrf": `${token}A` }), s), false);
  // Origin present but referer would have matched: Origin wins.
  assert.equal(checkCsrf(req({ origin: "https://evil.example", referer: "https://d3v.digitalm.eu/", "x-dm-csrf": token }), s), false);
});

test("verifyPassword: scrypt format, constant-time compare, malformed → false", () => {
  const salt = randomBytes(16);
  const hash = scryptSync("change-me-radu", salt, 64, { N: 16384, r: 8, p: 1 });
  const stored = `scrypt$16384$8$1$${salt.toString("base64")}$${hash.toString("base64")}`;
  assert.equal(verifyPassword("change-me-radu", stored), true);
  assert.equal(verifyPassword("change-me-radU", stored), false);
  assert.equal(verifyPassword("", stored), false);
  assert.equal(verifyPassword("change-me-radu", ""), false);
  assert.equal(verifyPassword("change-me-radu", "bcrypt$whatever"), false);
  assert.equal(verifyPassword("change-me-radu", "scrypt$16384$8$1$$"), false);
  assert.equal(verifyPassword("change-me-radu", `scrypt$16000$8$1$${salt.toString("base64")}$${hash.toString("base64")}`), false); // N not a power of two
  // formatPasswordHash (what scripts/crm-hash-password.js prints) verifies too.
  const formatted = formatPasswordHash("s3cret");
  assert.match(formatted, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.equal(verifyPassword("s3cret", formatted), true);
  assert.equal(verifyPassword("s3cre", formatted), false);
  // Env-backed default parameter.
  process.env.ADMIN_PASSWORD_HASH = formatted;
  assert.equal(verifyPassword("s3cret"), true);
  delete process.env.ADMIN_PASSWORD_HASH;
  assert.equal(verifyPassword("s3cret"), false);
});
