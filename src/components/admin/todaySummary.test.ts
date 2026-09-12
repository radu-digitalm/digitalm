import { test } from "node:test";
import assert from "node:assert/strict";
import { TODAY_ORDER, toTodaySummary, type LegacyCard } from "./todaySummary.ts";

const legacy: LegacyCard[] = [
  { key: "followups", title: "Follow-ups", value: "2 due · 1 overdue", tone: "bad", href: "/admin/leads", lines: [{ text: "LD-1 · Foo — call (today)", href: "/admin/leads/1" }] },
  { key: "new-leads", title: "New leads, 7 days", value: "12", tone: "info", lines: [{ text: "Diagnostic: 7" }, { text: "Contact: 3" }, { text: "Chat: 2" }] },
  { key: "reports-opened", title: "Reports opened, no reply", value: "1", tone: "warn", lines: [{ text: "PR-1 · Bar — AU-1, 2 views", href: "/admin/prospects/1" }] },
  { key: "emails-today", title: "Emails sent today", value: "3 / 10", tone: "good" },
  { key: "audits", title: "Audits", value: "1 queued · 0 running", detail: "0 failed in 7 days", tone: "info" },
  { key: "ready", title: "Ready to send", value: "4", tone: "good" },
  { key: "call", title: "Call list", value: "6", tone: "neutral" },
  { key: "notice-deadlines", title: "Notice deadlines", value: "2", tone: "warn" },
  { key: "purge", title: "Purge", value: "2 days ago", tone: "neutral" },
  { key: "backfill", title: "Backfill", value: "4", tone: "warn" },
  { key: "stop-replies", title: "STOP", value: "0 in 30 days", tone: "neutral" },
];

test("legacy cards become exactly five actions in the spec order, with the week line and housekeeping", () => {
  const s = toTodaySummary(legacy);
  assert.deepEqual(
    s.actions.map((a) => a.key),
    [...TODAY_ORDER],
  );
  assert.deepEqual(
    s.actions.map((a) => a.title),
    ["Calls to make", "Emails ready to send", "Follow-ups", "Reports opened, no reply", "Notices due within 5 days"],
  );
  assert.equal(s.actions[0]!.value, "6");
  assert.equal(s.actions[1]!.value, "4");
  assert.equal(s.actions[1]!.detail, "3 of 10 sent today");
  assert.equal(s.actions[2]!.lines?.length, 1);
  for (const a of s.actions) assert.ok(a.href.startsWith("/admin"), `${a.key} links into the admin`);
  assert.equal(s.week.newLeads, 12);
  assert.deepEqual(s.week.bySource, [
    { label: "Diagnostic", n: 7 },
    { label: "Contact", n: 3 },
    { label: "Chat", n: 2 },
  ]);
  const keys = s.housekeeping.map((h) => h.key);
  assert.deepEqual(keys, ["audits", "purge", "backfill"]); // STOP with 0 replies is left out
  assert.equal(s.housekeeping[0]!.text, "Audits: 1 queued · 0 running · 0 failed this week");
});

test("the new shape passes through untouched; junk becomes five empty cards", () => {
  const ready = { actions: [], week: { newLeads: 0, bySource: [] }, housekeeping: [] };
  assert.equal(toTodaySummary(ready), ready);
  const empty = toTodaySummary(null);
  assert.equal(empty.actions.length, 5);
  assert.ok(empty.actions.every((a) => a.value === "0" && a.tone === "neutral"));
  assert.equal(empty.week.newLeads, 0);
  assert.equal(empty.housekeeping.length, 0);
});
