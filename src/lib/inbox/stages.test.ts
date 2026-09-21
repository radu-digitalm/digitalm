import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FORBIDDEN_TOKENS } from "../../components/admin/wording.ts";
import {
  ACTIVITY_SUMMARY_MAX,
  AUDIT_CAMPAIGN_RE,
  LEAD_ERROR_FALLBACK,
  LeadWordsError,
  activityPayloadLine,
  stopPartlyDone,
  stopPartlyDoneWords,
  CALL_OUTCOMES,
  CALL_OUTCOME_LABELS,
  CLOSED_STAGES,
  FORWARD_STAGES,
  LEAD_ERROR_WORDS,
  LEAD_STAGES,
  OPEN_STAGES,
  activitySummary,
  addDays,
  callLogSummary,
  leadErrorWords,
  dueWords,
  isCallLogOutcome,
  nextForwardStage,
  nextMoveLabel,
  parisToday,
  daysSince,
  daysUntil,
  fmtDate,
  fmtDateTime,
  isClosedStage,
  isInboundKind,
  isLeadKind,
  isLeadStage,
  leadTitle,
  mergedKind,
  stageAfterInboundMerge,
  stageAfterReply,
  stagePatch,
  withinMergeWindow,
} from "./stages.ts";

const NOW = "2026-09-10 08:00:00";

test("stage and kind guards", () => {
  assert.equal(isLeadStage("replied"), true);
  assert.equal(isLeadStage("archived"), false);
  assert.equal(isLeadStage(42), false);
  assert.equal(isLeadKind("booking"), true);
  assert.equal(isLeadKind("call"), false);
  assert.deepEqual(CLOSED_STAGES, ["won", "lost", "no_response", "stop"]);
  assert.deepEqual(OPEN_STAGES, ["new", "contacted", "replied", "meeting", "proposal"]);
  assert.equal(isClosedStage("stop"), true);
  assert.equal(isClosedStage("proposal"), false);
});

test("stagePatch: unchanged stage → null", () => {
  assert.equal(stagePatch({ stage: "new", repliedAt: null }, "new", NOW), null);
});

test("stagePatch: entering a conversation stage stamps replied_at once", () => {
  assert.deepEqual(stagePatch({ stage: "contacted", repliedAt: null }, "replied", NOW), {
    stage: "replied",
    repliedAt: NOW,
    closedAt: null,
    closeReason: null,
  });
  // Already replied earlier: the first timestamp is kept.
  const earlier = "2026-09-01 10:00:00";
  assert.equal(stagePatch({ stage: "replied", repliedAt: earlier }, "meeting", NOW)?.repliedAt, earlier);
  // new → contacted is not a reply.
  assert.equal(stagePatch({ stage: "new", repliedAt: null }, "contacted", NOW)?.repliedAt, null);
});

test("stagePatch: closing and reopening", () => {
  for (const to of CLOSED_STAGES) {
    const p = stagePatch({ stage: "proposal", repliedAt: NOW }, to, NOW);
    assert.equal(p?.closedAt, NOW, to);
    assert.equal(p?.closeReason, to);
  }
  // won counts as a reply when none was recorded.
  assert.equal(stagePatch({ stage: "contacted", repliedAt: null }, "won", NOW)?.repliedAt, NOW);
  // lost/stop do not invent a reply.
  assert.equal(stagePatch({ stage: "contacted", repliedAt: null }, "lost", NOW)?.repliedAt, null);
  // Reopening clears the close.
  const reopened = stagePatch({ stage: "lost", repliedAt: null }, "contacted", NOW);
  assert.deepEqual(reopened, { stage: "contacted", repliedAt: null, closedAt: null, closeReason: null });
});

test("stageAfterReply / stageAfterInboundMerge", () => {
  assert.equal(stageAfterReply("new"), "replied");
  assert.equal(stageAfterReply("contacted"), "replied");
  assert.equal(stageAfterReply("meeting"), "meeting");
  assert.equal(stageAfterReply("stop"), "stop");
  assert.equal(stageAfterInboundMerge("contacted", "diagnostic"), "replied");
  assert.equal(stageAfterInboundMerge("contacted", "outreach"), "contacted");
  assert.equal(stageAfterInboundMerge("contacted", "manual"), "contacted");
  assert.equal(stageAfterInboundMerge("new", "booking"), "new");
  assert.equal(stageAfterInboundMerge("proposal", "contact"), "proposal");
  assert.equal(isInboundKind("chat"), true);
  assert.equal(isInboundKind("outreach"), false);
});

test("mergedKind: only booking upgrades", () => {
  assert.equal(mergedKind("diagnostic", "booking"), "booking");
  assert.equal(mergedKind("outreach", "booking"), "booking");
  assert.equal(mergedKind("booking", "diagnostic"), "booking");
  assert.equal(mergedKind("diagnostic", "contact"), "diagnostic");
  assert.equal(mergedKind("contact", "chat"), "contact");
});

test("withinMergeWindow: 180 days either way, invalid dates never merge", () => {
  assert.equal(withinMergeWindow("2026-03-14 00:00:00", "2026-09-10 00:00:00"), true); // 180 d
  assert.equal(withinMergeWindow("2026-03-13 00:00:00", "2026-09-10 00:00:00"), false); // 181 d
  assert.equal(withinMergeWindow("2026-09-10 00:00:00", "2026-03-14 00:00:00"), true); // symmetric (backfill)
  assert.equal(withinMergeWindow("nope", "2026-09-10 00:00:00"), false);
});

test("AUDIT_CAMPAIGN_RE matches report CTA campaigns only", () => {
  assert.equal(AUDIT_CAMPAIGN_RE.test("AU-7KQ2M"), true);
  assert.equal(AUDIT_CAMPAIGN_RE.test("AU-7KQ2M1"), false);
  assert.equal(AUDIT_CAMPAIGN_RE.test("au-7kq2m"), false);
  assert.equal(AUDIT_CAMPAIGN_RE.test("PR-7KQ2M"), false);
  assert.equal(AUDIT_CAMPAIGN_RE.test("AU-7KQ21"), false); // 1 is not in the alphabet
});

test("date helpers", () => {
  assert.equal(daysUntil("2026-09-10", "2026-09-10"), 0);
  assert.equal(daysUntil("2026-09-08", "2026-09-10"), -2);
  assert.equal(daysUntil("2026-09-17", "2026-09-10"), 7);
  assert.equal(addDays("2026-09-10", 7), "2026-09-17");
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
  const now = new Date("2026-09-10T08:00:00Z");
  assert.equal(daysSince("2026-09-08 07:00:00", now), 2);
  assert.equal(daysSince("2026-09-10 07:00:00", now), 0);
  assert.equal(daysSince(null, now), null);
  assert.equal(daysSince("garbage", now), null);
  assert.equal(fmtDate("2026-09-10"), "10 Sept 2026");
  assert.equal(fmtDate(null), "—");
  assert.equal(fmtDateTime("2026-09-10 12:03:00"), "10 Sept 2026, 14:03"); // Paris = UTC+2 in September
  assert.equal(fmtDateTime(null), "—");
});

test("leadTitle", () => {
  assert.equal(leadTitle({ name: "Paul", company: "Le Fournil", reference: "LD-AAAAA" }), "Paul · Le Fournil");
  assert.equal(leadTitle({ name: null, company: "Le Fournil", reference: "LD-AAAAA" }), "Le Fournil");
  assert.equal(leadTitle({ name: " ", company: null, reference: "LD-AAAAA" }), "LD-AAAAA");
});

test("FORWARD_STAGES: the path, and the three stages off it", () => {
  assert.deepEqual(FORWARD_STAGES, ["new", "contacted", "replied", "meeting", "proposal", "won"]);
  // Every stage on the path is a real stage, and the three off it are the closed-but-not-won ones.
  for (const s of FORWARD_STAGES) assert.ok(LEAD_STAGES.includes(s), s);
  assert.deepEqual(
    LEAD_STAGES.filter((s) => !FORWARD_STAGES.includes(s)),
    ["lost", "no_response", "stop"],
  );
});

test("nextForwardStage: one step along the path, nothing at the end or off it", () => {
  assert.equal(nextForwardStage("new"), "contacted");
  assert.equal(nextForwardStage("contacted"), "replied");
  assert.equal(nextForwardStage("replied"), "meeting");
  assert.equal(nextForwardStage("meeting"), "proposal");
  assert.equal(nextForwardStage("proposal"), "won");
  assert.equal(nextForwardStage("won"), null);
  assert.equal(nextForwardStage("lost"), null);
  assert.equal(nextForwardStage("no_response"), null);
  assert.equal(nextForwardStage("stop"), null);
});

test("nextMoveLabel: the button names the move, and never appears on a closed lead", () => {
  assert.equal(nextMoveLabel("new"), "Mark contacted");
  assert.equal(nextMoveLabel("contacted"), "They replied");
  assert.equal(nextMoveLabel("replied"), "Mark meeting");
  assert.equal(nextMoveLabel("meeting"), "Mark proposal");
  assert.equal(nextMoveLabel("proposal"), "Mark won");
  for (const s of CLOSED_STAGES) assert.equal(nextMoveLabel(s), null, s);
  // A label exists exactly where there is a move to make.
  for (const s of LEAD_STAGES) assert.equal(nextMoveLabel(s) === null, nextForwardStage(s) === null, s);
});

test("call outcomes: five values, a label each, nothing else accepted", () => {
  assert.deepEqual(CALL_OUTCOMES, ["no_answer", "answered", "refused", "callback", "wrong_number"]);
  for (const o of CALL_OUTCOMES) {
    assert.equal(typeof CALL_OUTCOME_LABELS[o], "string");
    assert.ok(CALL_OUTCOME_LABELS[o].length > 0, o);
    // The stored value is never the word on the screen: no snake_case reaches a person.
    assert.doesNotMatch(CALL_OUTCOME_LABELS[o], /_/);
    assert.equal(isCallLogOutcome(o), true);
  }
  assert.equal(isCallLogOutcome("busy"), false);
  assert.equal(isCallLogOutcome(""), false);
  assert.equal(isCallLogOutcome(3), false);
  assert.equal(isCallLogOutcome(null), false);
});

test("callLogSummary: the outcome in words, the note after it", () => {
  assert.equal(callLogSummary("no_answer"), "Call — No answer");
  assert.equal(callLogSummary("answered", "  wants a quote before Friday "), "Call — Answered · wants a quote before Friday");
  assert.equal(callLogSummary("wrong_number", ""), "Call — Wrong number");
  assert.equal(callLogSummary("callback", null), "Call — Call back");
});

test("dueWords: due, late, and how late", () => {
  assert.deepEqual(dueWords("2026-09-25", "2026-09-21"), { text: "25 Sept 2026, in 4 days", overdue: false });
  assert.deepEqual(dueWords("2026-09-22", "2026-09-21"), { text: "22 Sept 2026 — tomorrow", overdue: false });
  assert.deepEqual(dueWords("2026-09-21", "2026-09-21"), { text: "21 Sept 2026 — today", overdue: false });
  assert.deepEqual(dueWords("2026-09-19", "2026-09-21"), { text: "was due 19 Sept 2026, 2 days ago", overdue: true });
  assert.deepEqual(dueWords("2026-09-20", "2026-09-21"), { text: "was due 20 Sept 2026, 1 day ago", overdue: true });
});

test("parisToday: the civil date next_action_at is stored in", () => {
  // 23:30 UTC on the 20th is already the 21st in Paris (UTC+2 in September).
  assert.equal(parisToday(new Date("2026-09-20T23:30:00Z")), "2026-09-21");
  assert.equal(parisToday(new Date("2026-09-21T10:00:00Z")), "2026-09-21");
  assert.match(parisToday(), /^\d{4}-\d{2}-\d{2}$/);
});

test("activitySummary: kept whole under the store's 500, ellipsis over it", () => {
  assert.equal(activitySummary("  Called back, wants a quote  "), "Called back, wants a quote");
  const short = "x".repeat(ACTIVITY_SUMMARY_MAX);
  assert.equal(activitySummary(short), short);
  const long = activitySummary("y".repeat(ACTIVITY_SUMMARY_MAX + 200));
  assert.equal(long.length, ACTIVITY_SUMMARY_MAX);
  assert.ok(long.endsWith("…"));
  // The store slices at 500 without saying so; nothing may reach it longer.
  assert.ok(activitySummary("z".repeat(4000)).length <= ACTIVITY_SUMMARY_MAX);
});

test("callLogSummary: a long note is cut here, not silently by the store", () => {
  const summary = callLogSummary("answered", "w".repeat(600));
  assert.equal(summary.length, ACTIVITY_SUMMARY_MAX);
  assert.ok(summary.startsWith("Call — Answered · "));
  assert.ok(summary.endsWith("…"));
});

test("leadErrorWords: a sentence for every code the lead page's three routes answer with", () => {
  // Read the sources rather than trusting a hand-kept list: a new refusal that
  // nobody gave words to would otherwise reach the screen as its code.
  const files = [
    "../../app/api/admin/leads/[id]/route.ts",
    "../../app/api/admin/leads/[id]/activity/route.ts",
    "../../app/api/admin/prospects/[id]/manual-send/route.ts",
    "../outreach/optout.ts", // Mark STOP posts to /api/admin/optouts, which answers with these
    "../outreach/send.ts", // "Sent from Gmail" prepares and records through these
  ];
  const codes = new Set<string>();
  for (const rel of files) {
    const src = readFileSync(join(import.meta.dirname, rel), "utf8");
    for (const m of src.matchAll(/error:\s*"([a-z_]+)"/g)) codes.add(m[1]);
    for (const m of src.matchAll(/(?:OptoutError|SendError)\("([a-z_]+)"/g)) codes.add(m[1]);
  }
  assert.ok(codes.size >= 25, `expected the routes' codes, found ${codes.size}`);
  for (const code of codes) {
    assert.ok(LEAD_ERROR_WORDS[code], `no words for "${code}"`);
    assert.equal(leadErrorWords(new Error(code)), LEAD_ERROR_WORDS[code]);
  }
});

test("leadErrorWords: never the code, never adminFetch's status fallback", () => {
  assert.equal(leadErrorWords(new Error("http_500")), LEAD_ERROR_FALLBACK);
  assert.equal(leadErrorWords(new Error("something_new")), LEAD_ERROR_FALLBACK);
  assert.equal(leadErrorWords(undefined), LEAD_ERROR_FALLBACK);
  assert.equal(leadErrorWords("send_not_found"), "No send with that reference.");
  // A raw server sentence is not passed through either: that is how a word the
  // admin bans would get on the screen.
  assert.equal(leadErrorWords(new Error("No valid business email address: call, or add a verified address.")), LEAD_ERROR_FALLBACK);
  // §7: none of these sentences may carry a token the admin bans — the
  // snake_case rule is exactly what "Bounce recorded failed: send_not_found"
  // broke.
  for (const [code, words] of Object.entries(LEAD_ERROR_WORDS)) {
    for (const re of FORBIDDEN_TOKENS) assert.doesNotMatch(words, re, `${code}: "${words}"`);
  }
});

test("leadErrorWords: an inherited name is not a sentence", () => {
  // A plain object literal answers "toString" with a function, and `??` does
  // not catch it: the toast would read "function toString() { [native code] }".
  for (const name of ["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"]) {
    assert.equal(leadErrorWords(new Error(name)), LEAD_ERROR_FALLBACK, name);
  }
});

test("leadErrorWords: the manual-send refusal carries its code in the body", () => {
  // That route answers { error: "<sentence>", code: "refused" } — the message
  // is not a code, so the words come from the body's code.
  const e = Object.assign(new Error("No in-app email for this country: call or write by hand."), {
    body: { ok: false, error: "No in-app email for this country: call or write by hand.", code: "refused" },
  });
  assert.equal(leadErrorWords(e), LEAD_ERROR_WORDS.refused);
});

test("stopPartlyDone: both halves in words, the code in neither", () => {
  const words = leadErrorWords(stopPartlyDone(new Error("lead_without_contact")));
  assert.match(words, /^The stage is now STOP\./);
  assert.ok(words.endsWith(LEAD_ERROR_WORDS.lead_without_contact), words);
  for (const re of FORBIDDEN_TOKENS) assert.doesNotMatch(words, re, words);
  // An unknown reason still reads as a sentence, never as a code.
  const unknown = leadErrorWords(stopPartlyDone(new Error("brand_new_code")));
  assert.ok(unknown.endsWith(LEAD_ERROR_FALLBACK), unknown);
  assert.doesNotMatch(unknown, /brand_new_code/);
  // A sentence we composed is handed back whole, not read as a code.
  assert.equal(leadErrorWords(new LeadWordsError("The list is now clear.")), "The list is now clear.");
  // The words alone, for a caller that reports a half-done write by returning
  // rather than throwing (the page does).
  assert.equal(stopPartlyDoneWords(new Error("lead_without_contact")), words);
  for (const re of FORBIDDEN_TOKENS) assert.doesNotMatch(stopPartlyDoneWords(new Error("csrf")), re);
});

test("activityPayloadLine: the stored codes read as words", () => {
  assert.equal(activityPayloadLine("outcome", "no_answer"), "Outcome: No answer");
  assert.equal(activityPayloadLine("outcome", "wrong_number"), "Outcome: Wrong number");
  assert.equal(activityPayloadLine("from", "replied"), "From: Replied");
  assert.equal(activityPayloadLine("to", "no_response"), "To: No response");
  assert.equal(activityPayloadLine("kind", "booking"), "Kind: Booking");
  assert.equal(activityPayloadLine("send_reference", "SN-ABCDE"), "Send reference: SN-ABCDE");
  assert.equal(activityPayloadLine("attempt", 2), "Attempt: 2");
  // An unknown stored token still loses its underscores.
  assert.equal(activityPayloadLine("some_key", "some_value"), "Some key: Some value");
  // Nothing worth a line.
  assert.equal(activityPayloadLine("ipHash", "abc123"), null);
  assert.equal(activityPayloadLine("note", null), null);
  assert.equal(activityPayloadLine("note", ""), null);
  assert.equal(activityPayloadLine("note", "   "), null);
  assert.equal(activityPayloadLine("refusals", ["a"]), null);
  assert.equal(activityPayloadLine("note", undefined), null);
  // No snake_case reaches the screen through this helper.
  for (const [k, v] of [
    ["outcome", "no_answer"],
    ["from", "no_response"],
    ["to", "stop"],
    ["some_key", "some_value"],
  ] as const) {
    const line = activityPayloadLine(k, v)!;
    assert.doesNotMatch(line, /\b[a-z]+_[a-z_]+\b/, line);
  }
});
