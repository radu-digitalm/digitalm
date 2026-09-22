// The check-up's answers in words, shared by everything that has to speak
// about one (docs/lead-page-spec.md §12).
//
// The lead e-mail (lib/mail.ts, fed by /api/enquiry) and the lead page
// (lib/inbox/leadView.ts) both have to say what the customer asked for, what
// to propose and what it may cost. Rule 1 of the spec is that the page never
// contradicts the e-mail, and two private copies of the same table is how a
// page comes to contradict one: this module is the single copy.
//
// Pure — the question tables and nothing else. No DB, no React, relative
// imports with .ts so `node --test` loads it.
import { STEP1, ROUTER, BRANCHES, TOOLS, MAGIC, STEP5, CONTACT, type Question } from "../../content/diagnostic.ts";

// ---- shared labels (the e-mail's words, verbatim) --------------------------------

/** Plain names for the service lines — the same table the lead e-mail prints. */
export const LINE_LABEL: Record<string, string> = {
  AGENT: "AI assistant",
  AUTO: "Process automation",
  WEB: "Website / e-commerce",
  CRM: "Customer follow-up (CRM)",
  SEC: "E-commerce security audit",
};

/** What we say when no band was chosen: a question, never a figure. */
const NO_BUDGET_PRICE = "not stated - ask before quoting, do not name a band";

/** What to quote against the band they chose (the e-mail's line, word for word). */
export const PRICE_FIT: Record<string, string> = {
  "<1500": "under €1,500 — quote €800-1,500, never the €500 entry price",
  "1500-3500": "€1,500-3,500 — quote €2,000-3,500",
  "3500-7000": "€3,500-7,000 — quote €4,000-6,000",
  "7000+": "€7,000+ — quote from €7,000 up",
  // No band. These two lines reach the lead e-mail and the lead page with no
  // model involved at all, so "quote the standard €1,500-3,500 range" WAS the
  // order that printed a price nobody had said: 1,500-3,500 is not even on our
  // grid. A budget that was not given is a question to ask, not a range.
  unsure: NO_BUDGET_PRICE,
};
export const STANDARD_PRICE = NO_BUDGET_PRICE;

export function priceFitFor(budgetId: string | null | undefined): string {
  const id = String(budgetId ?? "").trim();
  return PRICE_FIT[id] ?? STANDARD_PRICE;
}

/** "AUTO+CRM" → "Process automation + Customer follow-up (CRM)". */
export function proposedLabel(proposed: string | null | undefined): string {
  const parts = String(proposed ?? "")
    .split("+")
    .map((p) => p.trim())
    .filter((p) => p && p !== "-");
  return parts.map((p) => LINE_LABEL[p] ?? p).join(" + ");
}

// ---- the check-up answers --------------------------------------------------------

const ALL_QUESTIONS: Question[] = [...STEP1, ROUTER, ...Object.values(BRANCHES).flat(), TOOLS, MAGIC, ...STEP5, ...CONTACT];
const BY_ID = new Map(ALL_QUESTIONS.map((q) => [q.id, q]));

/** The option's English label, or the raw id when the option is gone. */
export function labelFor(q: Question, v: string): string {
  return q.options?.find((o) => o.id === v)?.en ?? v;
}

/** The contact fields the page reads off the lead row instead of the answers. */
const SKIP_IDS = ["firstName", "email", "company", "phone", "magic"];

export interface AnswerEntry {
  id: string;
  label: string;
  value: string;
  /** Show it under "What they said": the visitor wrote this sentence. */
  freeText: boolean;
  /** They typed the characters (a URL, an "other" box) rather than tapping a chip. */
  typed: boolean;
}

/** The values of a stored answer, as a list of strings. */
function valuesOf(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [String(v ?? "")];
}

/**
 * The text the visitor typed into an option's own box, when that option is the
 * one they actually picked. "Autre (précisez)" + "Travail social" is ONE
 * answer, and the answer is "Travail social": printing "Other (tell us) -
 * Travail social" made Radu read the chip we offered instead of the trade he
 * was told, and it put a trade under "their own words", where the only
 * sentence that belongs is the one they wrote about their work.
 */
function typedOther(answers: Record<string, unknown>, q: Question, v: string): string {
  const opt = q.options?.find((o) => o.id === v);
  if (!opt?.other) return "";
  return String(answers[`${q.id}_other`] ?? "").trim().slice(0, 500);
}

/**
 * The typed text when it replaces the WHOLE answer: one option picked, and it
 * is the one with the box. That is the "Autre (précisez)" + "Travail social"
 * case, and folding it loses nothing.
 *
 * A multi-select does not fold. `tools: ["google", "other"]` + "un logiciel
 * maison" folded into "Google Workspace, un logiciel maison" would be half our
 * words and half theirs in one string, so it could no longer be marked as
 * typed (our labels carry the en dashes and euro signs that corrupt the
 * model's French) and their sentence would be de-accented; and suppressing the
 * separate row took their words out of "their own words" altogether. So the
 * chips stay chips there, and their box keeps its own row.
 */
function foldedOther(answers: Record<string, unknown>, q: Question): string {
  const vals = valuesOf(answers[q.id]);
  if (vals.length !== 1) return "";
  return typedOther(answers, q, vals[0]!);
}

/** Every stored answer with its English label, the "other" box folded in. */
export function answerEntries(answers: Record<string, unknown>): AnswerEntry[] {
  const entries: AnswerEntry[] = [];
  for (const [id, v] of Object.entries(answers)) {
    if (SKIP_IDS.includes(id)) continue;
    const q = BY_ID.get(id.replace(/_other$/, ""));
    if (!q) continue;
    if (id.endsWith("_other")) {
      // Printed in place of the chip it belongs to, so it is not printed twice.
      if (foldedOther(answers, q)) continue;
      entries.push({ id, label: `${q.en} (other)`, value: String(v).slice(0, 500), freeText: true, typed: true });
      continue;
    }
    const folded = foldedOther(answers, q);
    const parts = folded
      ? [{ text: folded, typed: true }]
      : valuesOf(v).map((x) => ({ text: labelFor(q, x), typed: false }));
    entries.push({
      id,
      label: q.en,
      value: parts.map((p) => p.text).join(", "),
      freeText: false,
      // `typed` sends the string to the model verbatim. It is true only when
      // every word of the value came out of their keyboard: our own option
      // labels carry en dashes and euro signs, and those are the proven cause
      // of the corrupted French.
      typed: !q.options?.length || (parts.length > 0 && parts.every((p) => p.typed)),
    });
  }
  return entries;
}

/** The address, from the three questions that can carry one. */
export function websiteOf(answers: Record<string, unknown>): string {
  return (
    [answers.site, answers.C_url, answers.E_url]
      .map((v) => String(v ?? "").trim())
      .find((v) => v !== "") ?? ""
  ).slice(0, 300);
}

/**
 * The deep dive's questions. The address questions are left out: they are the
 * "Website" fact, and printing a URL twice on one screen is how a page starts
 * arguing with itself. `B_channels` appears in two branches and is one object,
 * so one id.
 */
const BRANCH_IDS: string[] = Object.values(BRANCHES)
  .flat()
  .map((q) => q.id)
  .filter((id, i, all) => all.indexOf(id) === i && id !== "C_url" && id !== "E_url");

/**
 * The seven facts that decide the sale, in the e-mail's order with the
 * e-mail's labels. Changing a word here changes the e-mail too
 * (answers.test.ts asserts the two match), which is the point.
 *
 * "Who decides" is gone with the question: 7 of 7 leads answered "Moi
 * seul(e)", and for a solo or 2-5 person business `team` already said it.
 */
export function coreSaleFacts(answers: Record<string, unknown>): { label: string; value: string }[] {
  const entries = answerEntries(answers);
  const answerOf = (id: string): string => entries.find((e) => e.id === id)?.value ?? "";
  return [
    { label: "What they do", value: answerOf("activity") || "not stated" },
    { label: "Size", value: answerOf("team") || "not stated" },
    { label: "Sells online", value: answerOf("sellsOnline") || "not stated" },
    { label: "Budget", value: answerOf("budget") || "not stated" },
    { label: "Wants to start", value: answerOf("start") || "not stated" },
    { label: "Tools today", value: answerOf("tools") || "none picked" },
    { label: "Website", value: websiteOf(answers) || "not given" },
  ];
}

/**
 * What they told us goes wrong, first, then the demographic chips.
 *
 * The deep dive is the only part of the check-up where a customer describes
 * their own business, and it used to sit under a 1,900-character mailto at the
 * bottom of the page. DM-BSRA8's "Spreadsheets / everyone keeps their own
 * copy" and DM-88HKT's "a partner or bank asked" are the two sentences that
 * decide those two calls, so they belong in the first screenful.
 */
export function saleFacts(answers: Record<string, unknown>): { label: string; value: string }[] {
  const entries = answerEntries(answers);
  // In the order they answered them: the stored answers keep the order the
  // wizard wrote them in, and branch U asks its own two questions before the
  // channels question it borrows from branch B.
  const deepDive = entries
    .filter((e) => BRANCH_IDS.includes(e.id) && e.value.trim() !== "")
    .map((e) => ({ label: e.label, value: e.value }));
  return [...deepDive, ...coreSaleFacts(answers)];
}

/** The answer ids the sale facts already cover — Details prints the rest. */
export const SALE_FACT_IDS = [
  "activity",
  "activity_other",
  "team",
  "sellsOnline",
  "budget",
  "start",
  "tools",
  "tools_other",
  "site",
  "C_url",
  "E_url",
  // The deep dive is promoted into the facts now, so the page and the e-mail
  // must not print it a second time under "the rest of the check-up".
  ...BRANCH_IDS,
  ...BRANCH_IDS.map((id) => `${id}_other`),
];

/** Their own sentences: the magic wand first, then every free-text answer. */
export function ownWords(answers: Record<string, unknown>): { label: string; text: string }[] {
  const magic = String(answers.magic ?? "").trim();
  return [
    ...(magic ? [{ label: "The chore they want gone", text: magic }] : []),
    ...answerEntries(answers)
      // "How did you hear about us (other)" is not something they want gone:
      // it has its own sentence in Details, next to the ad click it checks.
      .filter((e) => e.freeText && e.id !== "source_other" && e.value.trim() !== "")
      .map((e) => ({ label: e.label, text: e.value })),
  ];
}

/** How they said they heard about us, as an id + its English label. */
export function heardAbout(answers: Record<string, unknown>): { id: string; label: string; other: string | null } | null {
  const id = String(answers.source ?? "").trim();
  if (!id) return null;
  const q = BY_ID.get("source");
  const other = String(answers.source_other ?? "").trim() || null;
  return { id, label: q ? labelFor(q, id) : id, other };
}
