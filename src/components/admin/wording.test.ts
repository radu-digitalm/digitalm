import { test } from "node:test";
import assert from "node:assert/strict";
import type { RefusalCode } from "../../lib/crm/types.ts";
import {
  ATTRIBUTION_TEXT,
  AREA_KIND_WORDS,
  BADGE_TEXT,
  CARD_TEXT,
  CHILD_KIND_WORDS,
  ERROR_TEXT,
  FIND_TEXT,
  FORBIDDEN_TOKENS,
  GOOGLE_TEXT,
  LEAD_STAGE_WORDS,
  LEGAL_FORM_TEXT,
  LEGEND_TEXT,
  PROSPECT_TEXT,
  REFUSAL_TEXT,
  SEARCH_STATUS_WORDS,
  SOURCE_WORDS,
  STATUS_WORDS,
  TODAY_TEXT,
  fill,
  legalFormWords,
} from "./wording.ts";

/** Every string reachable from the exported wording tables (nested objects walked). */
function allStrings(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === "string") out.push({ path, text: v });
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, `${path}.${k}`);
  };
  walk(
    { FIND_TEXT, CARD_TEXT, ERROR_TEXT, STATUS_WORDS, SEARCH_STATUS_WORDS, AREA_KIND_WORDS, CHILD_KIND_WORDS, LEGEND_TEXT, BADGE_TEXT, LEAD_STAGE_WORDS, REFUSAL_TEXT, LEGAL_FORM_TEXT, PROSPECT_TEXT, TODAY_TEXT, SOURCE_WORDS, ATTRIBUTION_TEXT, GOOGLE_TEXT },
    "wording",
  );
  return out;
}

test("the Google words (docs/finder-google-spec.md §3.8): forbidden tokens in force, every sentence walked", () => {
  const sources = FORBIDDEN_TOKENS.map(String);
  for (const re of ["/\\bclaimed\\b/i", "/\\bverified\\b/i", "/Google My Business/i", "/\\bGMB\\b/", "/\\btiles?\\b/i", "/\\bpartial\\b/i"]) assert.ok(sources.includes(re), `${re} missing from FORBIDDEN_TOKENS`);
  assert.equal(FORBIDDEN_TOKENS.length, 16);
  // Whole-word: "unverified" in a status token would not be caught, and is never shown as text anyway.
  assert.ok(!FORBIDDEN_TOKENS.some((re) => re.test("unverified")));
  assert.ok(FORBIDDEN_TOKENS.some((re) => re.test("This listing is claimed")));
  assert.ok(FORBIDDEN_TOKENS.some((re) => re.test("a Verified listing")));
  assert.ok(FORBIDDEN_TOKENS.some((re) => re.test("Google My Business")));
  assert.ok(FORBIDDEN_TOKENS.some((re) => re.test("the GMB page")));
  assert.ok(FORBIDDEN_TOKENS.some((re) => re.test("6 of 9 tiles")));
  const google = allStrings().filter((s) => s.path.startsWith("wording.GOOGLE_TEXT"));
  assert.ok(google.length >= 60, `walked ${google.length} Google strings`);
  assert.equal(GOOGLE_TEXT.attribution, "Google Maps");
  assert.equal(GOOGLE_TEXT.asking, "Asking Google — {done} of {total} parts of {area}");
  assert.equal(fill(GOOGLE_TEXT.asking, { done: 6, total: 9, area: "Ariège" }), "Asking Google — 6 of 9 parts of Ariège");
  assert.equal(GOOGLE_TEXT.mapFailed, "The Google map could not be loaded — showing OpenStreetMap instead.");
  assert.equal(GOOGLE_TEXT.toastMonthlyCap, "The monthly Google allowance is used up — try again next month.");
  assert.equal(GOOGLE_TEXT.statusMaintained, "Listing found · looks maintained");
  assert.equal(GOOGLE_TEXT.statusNotFound, "No listing found");
  assert.equal(fill(GOOGLE_TEXT.dataFrom, { names: "Example Data Co" }), "Data: Example Data Co");
  assert.equal(fill(GOOGLE_TEXT.todayUsage, { checks: "12", checksCap: "900", searches: "40", searchesCap: "4,500" }), "Google usage: 12 of 900 listing checks · 40 of 4,500 searches this month");
  assert.equal(GOOGLE_TEXT.todayKeyMissing, "Google is switched on, but its key is missing.");
});

const REFUSAL_CODES: RefusalCode[] = [
  "country_blocked",
  "no_email",
  "email_webmail",
  "email_sole_trader_consent",
  "email_unknown_legal_form",
  "optout_listed",
  "emailed_recently",
  "max_emails_reached",
  "audit_missing",
  "audit_stale",
  "daily_cap",
  "forbids_extraction",
  "register_inactive",
  "register_partial",
  "notice_deadline_passed",
  "not_a_fit",
  "draft_unreviewed",
  "stage_closed",
  "lead_in_conversation",
  "call_window_closed",
  "call_attempts_exceeded",
  "call_screening_missing",
];

const BADGE_KEYS = [
  "removed",
  "optout",
  "ceased",
  "partial",
  "forbids",
  "forbids-override",
  "not-fit",
  "fit",
  "no-website",
  "call",
  "no-email",
  "webmail",
  "no-phone",
  "gb-unknown",
  "gb-sole",
  "chain",
  "wiped",
  "deadline",
  "deadline-passed",
  "lead",
  "lead-open",
  "lead-closed",
];

test("no exported sentence contains a forbidden token", () => {
  const strings = allStrings();
  assert.ok(strings.length > 150, `walked ${strings.length} strings`);
  for (const { path, text } of strings) {
    for (const re of FORBIDDEN_TOKENS) {
      // The attribution line names the licences in French and is the one place "OpenStreetMap" sits next to a licence code; still no token.
      assert.ok(!re.test(text), `${path} contains ${re}: "${text}"`);
    }
  }
});

test("no sentence ends with a code in parentheses", () => {
  for (const { path, text } of allStrings()) {
    assert.ok(!/\((?:[a-z0-9]*_[a-z0-9_]*|[A-Z_]{3,}|\d{3,})\)\s*[.!]?$/.test(text), `${path} ends with a code: "${text}"`);
  }
});

test("every refusal code has a sentence, none mentions its code", () => {
  for (const code of REFUSAL_CODES) {
    const s = REFUSAL_TEXT[code];
    assert.ok(typeof s === "string" && s.length > 8, code);
    assert.ok(!s.includes(code), `${code} leaks into its sentence`);
  }
  assert.equal(Object.keys(REFUSAL_TEXT).length, REFUSAL_CODES.length);
});

test("every badge key has a word and a sentence", () => {
  for (const key of BADGE_KEYS) {
    const b = BADGE_TEXT[key];
    assert.ok(b, key);
    assert.ok(b.label.length > 1 && b.sentence.length > 10, key);
  }
});

test("every finder status word and search status has text", () => {
  for (const w of Object.values(STATUS_WORDS)) assert.ok(w.length > 2);
  for (const s of ["running", "done", "capped", "partial", "failed", "cancelled", "interrupted", "expired"] as const) assert.ok(SEARCH_STATUS_WORDS[s].length > 2, s);
  for (const k of ["town", "postcode", "department", "region", "country", "place"] as const) {
    assert.ok(AREA_KIND_WORDS[k]);
    assert.ok(CHILD_KIND_WORDS[k]);
  }
  for (const stage of ["new", "contacted", "replied", "meeting", "proposal", "won", "lost", "no_response", "stop"]) assert.ok(LEAD_STAGE_WORDS[stage], stage);
});

test("fill() replaces known tokens and leaves unknown ones visible", () => {
  assert.equal(fill("{n} businesses in {area}", { n: "289", area: "Ariège" }), "289 businesses in Ariège");
  assert.equal(fill("{n} of {total}", { n: 1 }), "1 of {total}");
  assert.equal(fill(FIND_TEXT.gateTitle, { expected: "12,000", trade: "restaurants", area: "Occitanie", cap: "2,000" }), "About 12,000 restaurants in Occitanie. One search holds 2,000.");
});

test("legal forms are words; unknown codes say so", () => {
  assert.equal(legalFormWords("1000"), "sole trader");
  assert.equal(legalFormWords("5710"), "SAS");
  assert.equal(legalFormWords("5720"), "SASU");
  assert.equal(legalFormWords("5499"), "SARL");
  assert.equal(legalFormWords("5498"), "EURL");
  assert.equal(legalFormWords("5599"), "SA");
  assert.equal(legalFormWords("5505"), "SA");
  assert.equal(legalFormWords("9220"), "association");
  assert.equal(legalFormWords("6540"), "SCI");
  assert.equal(legalFormWords("3120"), "other legal form (3120)");
  assert.equal(legalFormWords(null), "legal form unknown");
  assert.equal(legalFormWords("Private limited company"), "Private limited company");
});

test("sources are words, the attribution line is unchanged", () => {
  assert.equal(SOURCE_WORDS.osm, "OpenStreetMap");
  assert.equal(SOURCE_WORDS.fr_register, "French company register");
  assert.ok(ATTRIBUTION_TEXT.startsWith("Données © les contributeurs d'OpenStreetMap (ODbL)"));
  assert.ok(ATTRIBUTION_TEXT.endsWith("Companies House — OGL v3"));
});
