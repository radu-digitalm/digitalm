import { test } from "node:test";
import assert from "node:assert/strict";
import { FOLLOW_UP_AFTER_DAYS, evaluateCallRefusals, evaluateRefusals, refusal, screeningValid } from "./refusals.ts";
import type { CallRefusalContext, EmailRefusalContext, ProspectFacts } from "./refusals.ts";
import { RULES, countryAllowList, emailEnabled } from "./rules.ts";
import type { RefusalCode } from "../crm/types.ts";

// Thursday 10 Sep 2026 15:00 UTC — 17:00 Paris, 16:00 London, 11:00 New York: every window open.
const NOW = new Date("2026-09-10T15:00:00Z");

function sqlDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
}

const FR_PROSPECT: ProspectFacts = {
  country: "FR",
  soleTrader: false,
  registerId: "12345678900012",
  registerStatus: "active",
  diffusion: "full",
  forbidsExtraction: false,
  forbidsOverrideReason: null,
  noticeSentAt: null,
  noticeDeadlineAt: sqlDaysAgo(-20), // 20 days ahead
  personalWipedAt: null,
  fit: "unknown",
  lastEmailedAt: null,
  optedOutAt: null,
};

function ctx(over: Partial<EmailRefusalContext> = {}, prospect: Partial<ProspectFacts> = {}): EmailRefusalContext {
  return {
    prospect: { ...FR_PROSPECT, ...prospect },
    to: "contact@boulangerie-martin.fr",
    audit: { finishedAt: sqlDaysAgo(3) },
    draft: { reviewedAt: sqlDaysAgo(0) },
    rule: RULES.FR,
    emailEnabled: true,
    todaySent: 2,
    dailyCap: 10,
    channel: "email",
    sentCount90d: 0,
    optedOut: false,
    lead: null,
    registerCheck: null,
    now: NOW,
    ...over,
  };
}

const codes = (c: EmailRefusalContext): RefusalCode[] => evaluateRefusals(c).map((r) => r.code);

test("a clean FR prospect passes every rule", () => {
  assert.deepEqual(codes(ctx()), []);
});

test("each refusal code has a FR and an EN message", () => {
  const r = refusal("lead_in_conversation");
  assert.equal(r.message.fr, "Ce contact est en discussion : pas d'e-mail de prospection.");
  assert.equal(r.message.en, "This contact is in conversation: no prospecting email.");
  assert.equal(refusal("country_blocked").message.fr, "Pas d'e-mail depuis l'outil pour ce pays : appelez ou écrivez à la main.");
  assert.equal(refusal("call_screening_missing").message.en, "Screen the number against TPS and CTPS before calling (PECR reg 21).");
});

test("fixtures of the acceptance list, one code each", () => {
  assert.deepEqual(codes(ctx({ to: "martin.dupont@gmail.com" })), ["email_webmail"]);
  assert.deepEqual(codes(ctx({ to: null })), ["no_email"]);
  assert.deepEqual(codes(ctx({ to: "not an address" })), ["no_email"]);
  assert.deepEqual(codes(ctx({ optedOut: true })), ["optout_listed"]);
  assert.deepEqual(codes(ctx({}, { optedOutAt: sqlDaysAgo(1) })), ["optout_listed"]);
  assert.deepEqual(codes(ctx({}, { lastEmailedAt: sqlDaysAgo(10) })), ["emailed_recently"]);
  assert.deepEqual(codes(ctx({}, { lastEmailedAt: sqlDaysAgo(91) })), []);
  assert.deepEqual(codes(ctx({ sentCount90d: 2 })), ["max_emails_reached"]);
  assert.deepEqual(codes(ctx({ audit: { finishedAt: sqlDaysAgo(91) } })), ["audit_stale"]);
  assert.deepEqual(codes(ctx({ audit: { finishedAt: sqlDaysAgo(89) } })), []);
  assert.deepEqual(codes(ctx({ audit: null })), ["audit_missing"]);
  assert.deepEqual(codes(ctx({ todaySent: 10 })), ["daily_cap"]);
  assert.deepEqual(codes(ctx({ todaySent: 10, channel: "manual_email" })), ["daily_cap"], "the cap is a safeguard of the LIA: the Gmail path counts too");
  assert.deepEqual(codes(ctx({ todaySent: 9, channel: "manual_email" })), []);
  assert.deepEqual(codes(ctx({}, { forbidsExtraction: true })), ["forbids_extraction"]);
  assert.deepEqual(codes(ctx({}, { forbidsExtraction: true, forbidsOverrideReason: "Terms allow B2B contact (checked 9 Sep)" })), []);
  assert.deepEqual(codes(ctx({}, { registerStatus: "ceased" })), ["register_inactive"]);
  assert.deepEqual(codes(ctx({ registerCheck: { registerStatus: "ceased", diffusion: "full" } })), ["register_inactive"], "the live re-check wins");
  assert.deepEqual(codes(ctx({}, { diffusion: "partial" })), ["register_partial"]);
  assert.deepEqual(codes(ctx({}, { noticeDeadlineAt: sqlDaysAgo(1) })), ["notice_deadline_passed"], "saved 31 days ago, no notice");
  assert.deepEqual(codes(ctx({}, { noticeDeadlineAt: sqlDaysAgo(1), noticeSentAt: sqlDaysAgo(5) })), [], "notice sent in time");
  assert.deepEqual(codes(ctx({}, { noticeDeadlineAt: sqlDaysAgo(1), personalWipedAt: sqlDaysAgo(0) })), [], "already wiped");
  assert.deepEqual(codes(ctx({}, { fit: "not_fit" })), ["not_a_fit"]);
  assert.deepEqual(codes(ctx({ draft: { reviewedAt: null } })), ["draft_unreviewed"]);
  assert.deepEqual(codes(ctx({ draft: null })), ["draft_unreviewed"]);
  assert.deepEqual(codes(ctx({ draft: null, requireDraft: false })), [], "the follow-up template needs no draft");
  assert.deepEqual(codes(ctx({ lead: { stage: "stop" } })), ["stage_closed"]);
  assert.deepEqual(codes(ctx({ lead: { stage: "no_response" } })), ["stage_closed"]);
  assert.deepEqual(codes(ctx({ lead: { stage: "replied" } })), ["lead_in_conversation"]);
  assert.deepEqual(codes(ctx({ lead: { stage: "contacted" } })), []);
});

test("a pending send is a reservation: refused on both paths and for the follow-up, with its own wording", () => {
  const pending = evaluateRefusals(ctx({ pendingSendAt: sqlDaysAgo(0) }));
  assert.deepEqual(
    pending.map((r) => r.code),
    ["emailed_recently"],
  );
  assert.equal(pending[0]!.message.en, "A send is already in progress or prepared for this contact: finish or cancel it first.");
  assert.equal(pending[0]!.message.fr, "Un envoi est déjà en cours ou préparé pour ce contact : terminez-le ou annulez-le d'abord.");
  assert.deepEqual(codes(ctx({ pendingSendAt: sqlDaysAgo(0), channel: "manual_email" })), ["emailed_recently"]);
  assert.deepEqual(codes(ctx({ pendingSendAt: sqlDaysAgo(0), followUp: true, requireDraft: false, draft: null, sentCount90d: 1 }, { lastEmailedAt: sqlDaysAgo(10) })), ["emailed_recently"]);
  assert.deepEqual(codes(ctx({ pendingSendAt: null })), []);
  // The 90-day wording stays for a real earlier email.
  assert.equal(evaluateRefusals(ctx({}, { lastEmailedAt: sqlDaysAgo(10) }))[0]!.message.en, "An email went out less than 90 days ago: wait.");
});

test("GB: sole trader needs consent, unknown legal form is call-only", () => {
  const gb = (p: Partial<ProspectFacts>) => codes(ctx({ rule: RULES.GB, to: "office@plumbers-havant.co.uk" }, { country: "GB", registerId: "01234567", ...p }));
  assert.deepEqual(gb({ soleTrader: false }), []);
  assert.deepEqual(gb({ soleTrader: true }), ["email_sole_trader_consent"]);
  assert.deepEqual(gb({ soleTrader: null }), ["email_unknown_legal_form"]);
  assert.deepEqual(gb({ soleTrader: false, registerId: null }), ["email_unknown_legal_form"]);
  // FR: a sole trader is emailed with the Art. 14 notice, an unknown form is fine.
  assert.deepEqual(codes(ctx({}, { soleTrader: true })), []);
  assert.deepEqual(codes(ctx({}, { soleTrader: null, registerId: null })), []);
});

test("country: CA is blocked even when OUTREACH_COUNTRY_ALLOW lists it", () => {
  const allow = countryAllowList("FR,GB,US,CA");
  const ca = ctx({ rule: RULES["*"], emailEnabled: emailEnabled("CA", allow) }, { country: "CA" });
  assert.deepEqual(codes(ca), ["country_blocked"]);
  assert.deepEqual(codes(ctx({ emailEnabled: emailEnabled("FR", allow) })), []);
});

test("the follow-up waits 7 days after the first email, a third email is refused, and codes stack", () => {
  const followUp = (days: number) => ctx({ followUp: true, requireDraft: false, draft: null, sentCount90d: 1 }, { lastEmailedAt: sqlDaysAgo(days) });
  assert.equal(FOLLOW_UP_AFTER_DAYS, 7);
  assert.deepEqual(codes(followUp(7)), []);
  assert.deepEqual(codes(followUp(30)), []);
  assert.deepEqual(codes(followUp(6)), ["emailed_recently"], "day 6: too soon");
  assert.deepEqual(evaluateRefusals(followUp(6))[0]!.message, {
    fr: "Le premier e-mail date de moins de 7 jours : attendez.",
    en: "The first email is less than 7 days old: wait.",
  });
  assert.deepEqual(codes(followUp(0)), ["emailed_recently"]);
  assert.deepEqual(codes(ctx({ followUp: true, requireDraft: false, draft: null, sentCount90d: 2 }, { lastEmailedAt: sqlDaysAgo(14) })), ["max_emails_reached"]);
  assert.deepEqual(
    codes(ctx({ to: "me@hotmail.fr", optedOut: true, todaySent: 10, draft: { reviewedAt: null }, lead: { stage: "lost" } }, { registerStatus: "ceased" })),
    ["email_webmail", "optout_listed", "daily_cap", "register_inactive", "draft_unreviewed", "stage_closed"],
  );
});

// ---- calls ------------------------------------------------------------------------------

function callCtx(over: Partial<CallRefusalContext> = {}, prospect: Partial<CallRefusalContext["prospect"]> = {}): CallRefusalContext {
  return {
    prospect: {
      registerStatus: "active",
      diffusion: "full",
      tpsCheckedAt: null,
      optedOutAt: null,
      noticeSentAt: null,
      noticeDeadlineAt: sqlDaysAgo(-20),
      personalWipedAt: null,
      ...prospect,
    },
    rule: RULES.FR,
    optedOut: false,
    attempts30d: 0,
    registerCheck: null,
    now: NOW,
    ...over,
  };
}

const callCodes = (c: CallRefusalContext): RefusalCode[] => evaluateCallRefusals(c).map((r) => r.code);

test("calls: window, attempts, register, opposition", () => {
  assert.deepEqual(callCodes(callCtx()), []);
  assert.deepEqual(callCodes(callCtx({ now: new Date("2026-09-10T11:30:00Z") })), ["call_window_closed"], "13:30 Paris");
  assert.deepEqual(callCodes(callCtx({ attempts30d: 4 })), ["call_attempts_exceeded"]);
  assert.deepEqual(callCodes(callCtx({ attempts30d: 3 })), []);
  assert.deepEqual(callCodes(callCtx({ optedOut: true })), ["optout_listed"]);
  assert.deepEqual(callCodes(callCtx({}, { registerStatus: "ceased" })), ["register_inactive"]);
  assert.deepEqual(callCodes(callCtx({ registerCheck: { registerStatus: "active", diffusion: "partial" } })), ["register_partial"]);
  assert.deepEqual(callCodes(callCtx({}, { noticeDeadlineAt: sqlDaysAgo(2) })), ["notice_deadline_passed"]);
});

test("GB calls are screened: the checkbox or a screening under 28 days old", () => {
  const gb = (over: Partial<CallRefusalContext> = {}, p: Partial<CallRefusalContext["prospect"]> = {}) => callCodes(callCtx({ rule: RULES.GB, ...over }, p));
  assert.deepEqual(gb(), ["call_screening_missing"]);
  assert.deepEqual(gb({ tpsChecked: true }), []);
  assert.deepEqual(gb({}, { tpsCheckedAt: sqlDaysAgo(10) }), []);
  assert.deepEqual(gb({}, { tpsCheckedAt: sqlDaysAgo(29) }), ["call_screening_missing"]);
  assert.equal(screeningValid(sqlDaysAgo(28), NOW), true);
  assert.equal(screeningValid(sqlDaysAgo(29), NOW), false);
  assert.equal(screeningValid(null, NOW), false);
  // The * rule (DE) is "manual": no screening code, the window still applies (London hours).
  assert.deepEqual(callCodes(callCtx({ rule: RULES["*"] })), []);
  assert.deepEqual(callCodes(callCtx({ rule: RULES["*"], now: new Date("2026-09-10T18:00:00Z") })), ["call_window_closed"]);
});
