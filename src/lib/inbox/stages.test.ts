import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUDIT_CAMPAIGN_RE,
  CLOSED_STAGES,
  OPEN_STAGES,
  addDays,
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
