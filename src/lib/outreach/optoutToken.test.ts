import { test } from "node:test";
import assert from "node:assert/strict";
import { ONE_CLICK_BODY, isOptoutToken, newOptoutToken, parseOptoutBody } from "./optoutToken.ts";

test("newOptoutToken: 43-char base64url, unique", () => {
  const a = newOptoutToken();
  const b = newOptoutToken();
  assert.equal(a.length, 43);
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.equal(isOptoutToken(a), true);
});

test("isOptoutToken: shape only, never a path or a short guess", () => {
  assert.equal(isOptoutToken("short"), false);
  assert.equal(isOptoutToken("a".repeat(19)), false);
  assert.equal(isOptoutToken("a".repeat(20)), true);
  assert.equal(isOptoutToken("a".repeat(65)), false);
  assert.equal(isOptoutToken("abc/def" + "a".repeat(20)), false);
  assert.equal(isOptoutToken("abc.def" + "a".repeat(20)), false);
  assert.equal(isOptoutToken(null), false);
  assert.equal(isOptoutToken(42), false);
});

test("parseOptoutBody: one-click, JSON, form, junk", () => {
  assert.deepEqual(parseOptoutBody(ONE_CLICK_BODY, "application/x-www-form-urlencoded"), { kind: "one_click" });
  assert.deepEqual(parseOptoutBody(" List-Unsubscribe=One-Click\n", null), { kind: "one_click" });
  assert.deepEqual(parseOptoutBody('{"confirm":true}', "application/json; charset=utf-8"), { kind: "json" });
  assert.deepEqual(parseOptoutBody('{"confirm":"yes"}', "application/json"), { kind: "invalid" });
  assert.deepEqual(parseOptoutBody("{oops", "application/json"), { kind: "invalid" });
  assert.deepEqual(parseOptoutBody("confirm=1", "application/x-www-form-urlencoded"), { kind: "form" });
  assert.deepEqual(parseOptoutBody("confirm=on&x=y", "application/x-www-form-urlencoded"), { kind: "form" });
  assert.deepEqual(parseOptoutBody("confirm=0", "application/x-www-form-urlencoded"), { kind: "invalid" });
  assert.deepEqual(parseOptoutBody("", "application/x-www-form-urlencoded"), { kind: "invalid" });
  assert.deepEqual(parseOptoutBody("confirm=1", "text/plain"), { kind: "invalid" });
  assert.deepEqual(parseOptoutBody("confirm=1&pad=" + "x".repeat(3000), "application/x-www-form-urlencoded"), { kind: "invalid" });
});
