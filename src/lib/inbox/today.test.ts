import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTodayText, purgeAgeDays, purgeIsStale, summariseToday } from "./today.ts";
import type { TodayCard, TodayData } from "./today.ts";

const NOW = new Date("2026-09-10T08:00:00Z");

function data(over: Partial<TodayData> = {}): TodayData {
  return {
    today: "2026-09-10",
    followUps: [],
    newLeads7d: [],
    reportsOpenedNoReply: [],
    emailsToday: 0,
    emailCap: 10,
    audits: { queued: 0, running: 0, failed7d: 0 },
    ready: 0,
    call: 0,
    googleMonth: 0,
    googleCap: 900,
    noticeDeadlines5d: 0,
    bounces7d: 0,
    sends30d: 0,
    purgeLastRunAt: "2026-09-10 04:00:00",
    backfillPending: 0,
    ...over,
  };
}

function card(cards: TodayCard[], key: string): TodayCard {
  const c = cards.find((x) => x.key === key);
  assert.ok(c, `card ${key} missing`);
  return c;
}

test("quiet day: every card neutral, purge good, no backfill card", () => {
  const cards = summariseToday(data(), NOW);
  const keys = cards.map((c) => c.key);
  assert.deepEqual(keys, [
    "followups", "new-leads", "reports-opened", "emails-today", "audits", "ready", "call", "google",
    "notice-deadlines", "bounces", "stop-replies", "purge",
  ]);
  for (const c of cards) {
    if (c.key === "purge") assert.equal(c.tone, "good");
    else assert.equal(c.tone, "neutral", c.key);
  }
  assert.equal(card(cards, "followups").value, "0 due · 0 overdue");
  assert.equal(card(cards, "emails-today").value, "0 / 10");
  assert.equal(card(cards, "purge").value, "today");
});

test("follow-ups: due today vs overdue, lines link to the lead", () => {
  const cards = summariseToday(
    data({
      followUps: [
        { id: 1, reference: "LD-AAAAA", name: "Paul", company: "Le Fournil", stage: "contacted", nextAction: "Relance", nextActionAt: "2026-09-10" },
        { id: 2, reference: "LD-BBBBB", name: null, company: null, stage: "new", nextAction: null, nextActionAt: "2026-09-08" },
      ],
    }),
    NOW,
  );
  const c = card(cards, "followups");
  assert.equal(c.value, "1 due · 1 overdue");
  assert.equal(c.tone, "bad");
  assert.equal(c.lines?.[0]?.text, "LD-AAAAA · Paul · Le Fournil — Relance (today)");
  assert.equal(c.lines?.[0]?.href, "/admin/leads/1");
  assert.equal(c.lines?.[1]?.text, "LD-BBBBB · LD-BBBBB — follow up (2 days overdue)");

  const dueOnly = summariseToday(data({ followUps: [{ id: 3, reference: "LD-CCCCC", name: "A", company: null, stage: "new", nextAction: "Call", nextActionAt: "2026-09-10" }] }), NOW);
  assert.equal(card(dueOnly, "followups").tone, "warn");
});

test("new leads by source label", () => {
  const cards = summariseToday(data({ newLeads7d: [{ label: "Direct", n: 3 }, { label: "ChatGPT Ads · occ-ariege", n: 1 }] }), NOW);
  const c = card(cards, "new-leads");
  assert.equal(c.value, "4");
  assert.equal(c.tone, "info");
  assert.deepEqual(c.lines?.map((l) => l.text), ["Direct: 3", "ChatGPT Ads · occ-ariege: 1"]);
});

test("reports opened with no reply", () => {
  const cards = summariseToday(
    data({ reportsOpenedNoReply: [{ prospectId: 9, prospectReference: "PR-AAAAA", name: "Le Fournil", auditReference: "AU-BBBBB", firstViewedAt: "2026-09-09 10:00:00", views: 2 }] }),
    NOW,
  );
  const c = card(cards, "reports-opened");
  assert.equal(c.value, "1");
  assert.equal(c.tone, "warn");
  assert.equal(c.lines?.[0]?.text, "PR-AAAAA · Le Fournil — AU-BBBBB, 2 views");
  assert.equal(c.lines?.[0]?.href, "/admin/prospects/9");
});

test("emails today vs cap", () => {
  assert.equal(card(summariseToday(data({ emailsToday: 3 }), NOW), "emails-today").tone, "good");
  const capped = card(summariseToday(data({ emailsToday: 10 }), NOW), "emails-today");
  assert.equal(capped.tone, "warn");
  assert.equal(capped.detail, "Daily cap reached");
  assert.equal(capped.value, "10 / 10");
});

test("audits, ready, call, google, deadlines, bounces", () => {
  const cards = summariseToday(
    data({
      audits: { queued: 4, running: 1, failed7d: 2 },
      ready: 12,
      call: 3,
      googleMonth: 850,
      noticeDeadlines5d: 6,
      bounces7d: 1,
    }),
    NOW,
  );
  const audits = card(cards, "audits");
  assert.equal(audits.value, "4 queued · 1 running");
  assert.equal(audits.detail, "2 failed in 7 days");
  assert.equal(audits.tone, "bad");
  assert.equal(card(cards, "ready").value, "12");
  assert.equal(card(cards, "ready").tone, "good");
  assert.equal(card(cards, "call").value, "3");
  assert.equal(card(cards, "google").value, "850 / 900");
  assert.equal(card(cards, "google").tone, "warn");
  assert.equal(card(summariseToday(data({ googleMonth: 900 }), NOW), "google").tone, "bad");
  assert.equal(card(cards, "notice-deadlines").tone, "warn");
  assert.equal(card(cards, "bounces").value, "1");
  assert.equal(card(cards, "bounces").tone, "warn");
  assert.equal(card(summariseToday(data({ audits: { queued: 1, running: 0, failed7d: 0 } }), NOW), "audits").tone, "info");
});

test("STOP replies reminder reflects recent sends and links to the opt-out list", () => {
  const quiet = card(summariseToday(data(), NOW), "stop-replies");
  assert.equal(quiet.tone, "neutral");
  assert.equal(quiet.href, "/admin/optouts");
  const busy = card(summariseToday(data({ sends30d: 7 }), NOW), "stop-replies");
  assert.equal(busy.value, "7 emails in 30 days");
  assert.equal(busy.tone, "info");
  assert.equal(card(summariseToday(data({ sends30d: 1 }), NOW), "stop-replies").value, "1 email in 30 days");
});

test("purge card: red when missing or older than 2 days", () => {
  assert.equal(purgeAgeDays(null, NOW), null);
  assert.equal(purgeIsStale(null, NOW), true);
  assert.equal(purgeIsStale("2026-09-08 04:00:00", NOW), true); // 2 days 4 h: two 04:00 runs missed
  assert.equal(purgeIsStale("2026-09-07 04:00:00", NOW), true);
  assert.equal(purgeIsStale("2026-09-09 04:00:00", NOW), false); // 1 day 4 h: one missed run is tolerated
  assert.equal(purgeIsStale("garbage", NOW), true);

  const never = card(summariseToday(data({ purgeLastRunAt: null }), NOW), "purge");
  assert.equal(never.value, "never");
  assert.equal(never.tone, "bad");
  const old = card(summariseToday(data({ purgeLastRunAt: "2026-09-05 04:00:00" }), NOW), "purge");
  assert.equal(old.value, "5 days ago");
  assert.equal(old.tone, "bad");
  const fresh = card(summariseToday(data({ purgeLastRunAt: "2026-09-09 04:00:00" }), NOW), "purge");
  assert.equal(fresh.value, "1 day ago");
  assert.equal(fresh.tone, "good");
});

test("backfill card only while enquiries are pending", () => {
  assert.equal(summariseToday(data(), NOW).some((c) => c.key === "backfill"), false);
  const c = card(summariseToday(data({ backfillPending: 4 }), NOW), "backfill");
  assert.equal(c.value, "4");
  assert.equal(c.tone, "warn");
});

test("formatTodayText lists cards and their lines", () => {
  const text = formatTodayText(summariseToday(data({ newLeads7d: [{ label: "Direct", n: 2 }], emailsToday: 10 }), NOW));
  assert.match(text, /^Follow-ups: 0 due · 0 overdue\n/);
  assert.match(text, /New leads, 7 days: 2\n  · Direct: 2\n/);
  assert.match(text, /Emails sent today: 10 \/ 10 — Daily cap reached\n/);
  assert.match(text, /Purge last ran: today$/);
  assert.equal(text.includes("@"), false);
});
