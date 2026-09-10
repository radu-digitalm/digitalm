import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ROBOTS_PATTERN,
  MAX_ROBOTS_WILDCARDS,
  aiBotsAllowed,
  normaliseRobotsPattern,
  parseRobots,
  robotsAllows,
  robotsGroupFor,
  robotsMatcher,
  robotsPatternMatches,
} from "./crawler.ts";

test("parseRobots: groups, comments, blank Disallow, agent runs", () => {
  const r = parseRobots(`# site rules
User-agent: *
Disallow: /admin
Allow: /admin/public  # inline comment

User-agent: GPTBot
User-agent: ClaudeBot
Disallow: /

User-agent: Bingbot
Disallow:
`);
  assert.equal(r.groups.length, 3);
  assert.deepEqual(r.groups[0]!.agents, ["*"]);
  assert.deepEqual(r.groups[0]!.rules, [
    { allow: false, pattern: "/admin" },
    { allow: true, pattern: "/admin/public" },
  ]);
  assert.deepEqual(r.groups[1]!.agents, ["gptbot", "claudebot"]);
  assert.deepEqual(r.groups[2]!.rules, []);
});

test("robotsGroupFor: longest matching token, else *, else null", () => {
  const r = parseRobots(`User-agent: *\nDisallow: /a\nUser-agent: DigitalM\nDisallow: /b\nUser-agent: DigitalM-AuditBot\nDisallow: /c\n`);
  assert.deepEqual(robotsGroupFor(r, "DigitalM-AuditBot")!.rules, [{ allow: false, pattern: "/c" }]);
  assert.deepEqual(robotsGroupFor(r, "GPTBot")!.rules, [{ allow: false, pattern: "/a" }]);
  assert.equal(robotsGroupFor(parseRobots("User-agent: Other\nDisallow: /"), "GPTBot"), null);
});

test("robotsPatternMatches: prefix, wildcard and $ anchor semantics", () => {
  assert.equal(robotsPatternMatches("/admin", "/admin/x"), true);
  assert.equal(robotsPatternMatches("/admin", "/adm"), false);
  assert.equal(robotsPatternMatches("/", "/anything"), true);
  assert.equal(robotsPatternMatches("", "/anything"), true);
  assert.equal(robotsPatternMatches("/*.pdf$", "/docs/a.pdf"), true);
  assert.equal(robotsPatternMatches("/*.pdf$", "/docs/a.pdf?x=1"), false);
  assert.equal(robotsPatternMatches("/*.pdf", "/docs/a.pdf?x=1"), true);
  assert.equal(robotsPatternMatches("/a*b*c", "/a1b2c3"), true);
  assert.equal(robotsPatternMatches("/a*b*c", "/a1c2b3"), false);
  assert.equal(robotsPatternMatches("/x$", "/x"), true);
  assert.equal(robotsPatternMatches("/x$", "/xy"), false);
  assert.equal(robotsPatternMatches("*", ""), true);
  assert.equal(robotsPatternMatches("/*$", "/abc"), true);
});

test("robotsAllows: longest match wins, allow wins ties, no rule → allowed", () => {
  const r = parseRobots(`User-agent: *\nDisallow: /private\nAllow: /private/ok\nDisallow: /tie\nAllow: /tie\n`);
  assert.equal(robotsAllows(r, "DigitalM-AuditBot", "/"), true);
  assert.equal(robotsAllows(r, "DigitalM-AuditBot", "/private/secret"), false);
  assert.equal(robotsAllows(r, "DigitalM-AuditBot", "/private/ok/page"), true);
  assert.equal(robotsAllows(r, "DigitalM-AuditBot", "/tie"), true);
  assert.equal(robotsAllows(null, "DigitalM-AuditBot", "/x"), true);
  assert.equal(robotsAllows(parseRobots(""), "DigitalM-AuditBot", "/x"), true);
  const m = robotsMatcher(r, "DigitalM-AuditBot");
  assert.equal(m("/private/a"), false);
  assert.equal(m("/public"), true);
});

test("aiBotsAllowed: per-bot verdict on /", () => {
  const r = parseRobots(`User-agent: *\nAllow: /\nUser-agent: GPTBot\nDisallow: /\nUser-agent: Google-Extended\nDisallow: /\n`);
  assert.deepEqual(aiBotsAllowed(r), { gptbot: false, claudebot: true, perplexitybot: true, googleExtended: false });
});

test("normaliseRobotsPattern: collapses star runs, drops long or star-heavy patterns", () => {
  assert.equal(normaliseRobotsPattern("/a***b**c"), "/a*b*c");
  assert.equal(normaliseRobotsPattern("/".repeat(MAX_ROBOTS_PATTERN + 1)), null);
  assert.equal(normaliseRobotsPattern("/a*b*c*d*e*f"), "/a*b*c*d*e*f");
  assert.equal(normaliseRobotsPattern("/a*b*c*d*e*f*g"), null);
  assert.equal(MAX_ROBOTS_WILDCARDS, 5);
  const r = parseRobots(`User-agent: *\nDisallow: ${"*x".repeat(9)}\nDisallow: /kept\n`);
  assert.deepEqual(r.groups[0]!.rules, [{ allow: false, pattern: "/kept" }]);
});

test("robots matching is linear: star-heavy rules answer in well under 20 ms", () => {
  const rules = parseRobots(`User-agent: *\nDisallow: **********x\nDisallow: /a*b*c*d*e*x$\nDisallow: *a*a*a*a*a$\n`);
  const path = `/${"a".repeat(99)}`;
  const t0 = process.hrtime.bigint();
  const m = robotsMatcher(rules, "DigitalM-AuditBot");
  for (let i = 0; i < 50; i++) m(path);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 20, `50 evaluations took ${ms.toFixed(1)} ms`);
  assert.equal(m(path), false); // "*a*a*a*a*a$" matches a path of a's
  assert.equal(m(`${path}x`), false); // "*x" (collapsed from ten stars) matches
  assert.equal(m(`/${"b".repeat(99)}`), true);
  // A 500-char path against a five-star anchored rule also stays cheap.
  const long = `/${"ab".repeat(250)}`;
  const t1 = process.hrtime.bigint();
  for (let i = 0; i < 50; i++) m(long);
  assert.ok(Number(process.hrtime.bigint() - t1) / 1e6 < 20);
});
