import { test } from "node:test";
import assert from "node:assert/strict";
import type { AdminSession } from "./types.ts";
import {
  base64urlToBytes,
  bytesToBase64url,
  parseSessionPayload,
  safeEqualStrings,
  sessionSecretFromEnv,
  sessionVersionFromEnv,
  verifySessionEdge,
} from "./authEdge.ts";
import { readSession, sessionCookie, signSession, verifySession } from "./auth.ts";

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.ADMIN_SESSION_SECRET = SECRET;
process.env.ADMIN_SESSION_VERSION = "1";

test("edge and node verify the same cookie to the same session", async () => {
  const cookie = sessionCookie("password", "radu");
  const node = verifySession(cookie, SECRET, "1");
  const edge = await verifySessionEdge(cookie, SECRET, "1");
  assert.ok(node && edge);
  assert.deepEqual(edge, node);
});

test("fixed vector: explicit payload, both sides agree on accept and reject", async () => {
  const now = 1_800_000_000_000; // fixed clock
  const s: AdminSession = { method: "password", subject: "radu", iat: 1_799_999_000, exp: 1_800_600_000, nonce: "fixed-nonce" };
  const cookie = signSession(s, SECRET, "1");
  assert.deepEqual(await verifySessionEdge(cookie, SECRET, "1", now), s);
  assert.deepEqual(verifySession(cookie, SECRET, "1", now), s);
  // Same defects, same verdict on both sides.
  const cases: [string, string, string | number][] = [
    [cookie.slice(0, -1), SECRET, "1"], // truncated signature
    [`${cookie.slice(0, -1)}A`, SECRET, "1"], // altered signature
    [cookie.replace("v1.", "v2."), SECRET, "1"], // format version
    [cookie, SECRET, "2"], // session version bumped
    [cookie, `${SECRET}x`, "1"], // other secret
    [cookie, "short-secret", "1"], // secret too short
    [cookie.replace(/\.[^.]+\./, ".AAAA."), SECRET, "1"], // payload swapped
    ["", SECRET, "1"],
    ["v1", SECRET, "1"],
    ["v1..", SECRET, "1"],
  ];
  for (const [c, sec, ver] of cases) {
    assert.equal(await verifySessionEdge(c, sec, ver, now), null, `edge accepted ${JSON.stringify(c.slice(0, 20))}`);
    assert.equal(verifySession(c, sec, ver, now), null, `node accepted ${JSON.stringify(c.slice(0, 20))}`);
  }
  // Expired for both.
  assert.equal(await verifySessionEdge(cookie, SECRET, "1", (s.exp + 1) * 1000), null);
  assert.equal(verifySession(cookie, SECRET, "1", (s.exp + 1) * 1000), null);
});

test("version may be passed as a number or a string", async () => {
  const s: AdminSession = { method: "google", subject: "radu@digitalm.eu", iat: 1, exp: 4_000_000_000, nonce: "n" };
  const cookie = signSession(s, SECRET, 3);
  assert.deepEqual(await verifySessionEdge(cookie, SECRET, "3", 1000), s);
  assert.deepEqual(await verifySessionEdge(cookie, SECRET, 3, 1000), s);
  assert.equal(await verifySessionEdge(cookie, SECRET, "1", 1000), null);
});

test("edge and node derive secret and version from the env identically", async () => {
  // Pure helper: whitespace trimmed, blank and unset fall back to "1".
  assert.equal(sessionVersionFromEnv({ ADMIN_SESSION_VERSION: " 2 " }), "2");
  assert.equal(sessionVersionFromEnv({ ADMIN_SESSION_VERSION: "" }), "1");
  assert.equal(sessionVersionFromEnv({}), "1");
  assert.equal(sessionSecretFromEnv({ ADMIN_SESSION_SECRET: SECRET }), SECRET);
  assert.equal(sessionSecretFromEnv({}), "");
  // End to end: a cookie minted by Node under each env value must pass the
  // exact call middleware.ts makes AND Node's readSession — a mismatch here is
  // the /admin ↔ /admin/login redirect loop.
  const savedVersion = process.env.ADMIN_SESSION_VERSION;
  try {
    for (const v of [" 2 ", "", undefined] as const) {
      if (v === undefined) delete process.env.ADMIN_SESSION_VERSION;
      else process.env.ADMIN_SESSION_VERSION = v;
      const cookie = sessionCookie("password", "radu");
      const edge = await verifySessionEdge(cookie, sessionSecretFromEnv(), sessionVersionFromEnv());
      const node = readSession(cookie);
      assert.ok(edge, `edge rejected under version ${JSON.stringify(v)}`);
      assert.ok(node, `node rejected under version ${JSON.stringify(v)}`);
      assert.deepEqual(edge, node);
      // The normalised version is what is signed: " 2 " ≡ "2", "" ≡ "1".
      assert.deepEqual(await verifySessionEdge(cookie, SECRET, v === " 2 " ? "2" : "1"), edge);
      assert.equal(await verifySessionEdge(cookie, SECRET, v === " 2 " ? "1" : "2"), null);
    }
  } finally {
    if (savedVersion === undefined) delete process.env.ADMIN_SESSION_VERSION;
    else process.env.ADMIN_SESSION_VERSION = savedVersion;
  }
});

test("base64url helpers and constant-time compare", () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  const enc = bytesToBase64url(bytes);
  assert.match(enc, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(Array.from(base64urlToBytes(enc)!), Array.from(bytes));
  assert.equal(base64urlToBytes("not+valid/"), null);
  assert.equal(safeEqualStrings("abc", "abc"), true);
  assert.equal(safeEqualStrings("abc", "abd"), false);
  assert.equal(safeEqualStrings("abc", "ab"), false);
});

test("parseSessionPayload validates shape and expiry", () => {
  const ok = JSON.stringify({ method: "password", subject: "r", iat: 1, exp: 4_000_000_000, nonce: "n" });
  assert.ok(parseSessionPayload(ok, 1000));
  assert.equal(parseSessionPayload(ok, 4_000_000_001 * 1000), null);
  assert.equal(parseSessionPayload("{", 1000), null);
  assert.equal(parseSessionPayload("null", 1000), null);
  assert.equal(parseSessionPayload(JSON.stringify({ method: "token", subject: "r", iat: 1, exp: 4_000_000_000, nonce: "n" }), 1000), null);
  assert.equal(parseSessionPayload(JSON.stringify({ method: "password", subject: "r", iat: 1, exp: 4_000_000_000, nonce: "" }), 1000), null);
});
