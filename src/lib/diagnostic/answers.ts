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

/** What to quote against the band they chose (the e-mail's line, word for word). */
export const PRICE_FIT: Record<string, string> = {
  "<1500": "under €1,500 — quote €800-1,500, never the €500 entry price",
  "1500-3500": "€1,500-3,500 — quote €2,000-3,500",
  "3500-7000": "€3,500-7,000 — quote €4,000-6,000",
  "7000+": "€7,000+ — quote from €7,000 up",
  unsure: "not decided — quote the standard €1,500-3,500 range",
};
export const STANDARD_PRICE = "not stated — quote the standard €1,500-3,500 range";

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

/** Every stored answer with its English label — the enquiry route's loop, unchanged. */
export function answerEntries(answers: Record<string, unknown>): AnswerEntry[] {
  const entries: AnswerEntry[] = [];
  for (const [id, v] of Object.entries(answers)) {
    if (SKIP_IDS.includes(id)) continue;
    const q = BY_ID.get(id.replace(/_other$/, ""));
    if (!q) continue;
    if (id.endsWith("_other")) {
      entries.push({ id, label: `${q.en} (other)`, value: String(v).slice(0, 500), freeText: true, typed: true });
      continue;
    }
    const vals = Array.isArray(v) ? v.map((x) => labelFor(q, String(x))).join(", ") : labelFor(q, String(v));
    entries.push({ id, label: q.en, value: vals, freeText: false, typed: !q.options?.length });
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
 * The eight facts that decide the sale, in the e-mail's order with the e-mail's
 * labels. Changing a word here changes the e-mail too (leadView.test.ts asserts
 * the two match), which is the point.
 */
export function saleFacts(answers: Record<string, unknown>): { label: string; value: string }[] {
  const entries = answerEntries(answers);
  const answerOf = (id: string): string => entries.find((e) => e.id === id)?.value ?? "";
  return [
    { label: "What they do", value: [answerOf("activity"), answerOf("activity_other")].filter(Boolean).join(" — ") || "not stated" },
    { label: "Size", value: answerOf("team") || "not stated" },
    { label: "Sells online", value: answerOf("sellsOnline") || "not stated" },
    { label: "Budget", value: answerOf("budget") || "not stated" },
    { label: "Wants to start", value: answerOf("start") || "not stated" },
    { label: "Who decides", value: answerOf("decision") || "not stated" },
    { label: "Tools today", value: answerOf("tools") || "none picked" },
    { label: "Website", value: websiteOf(answers) || "not given" },
  ];
}

/** The answer ids the eight sale facts already cover — Details prints the rest. */
export const SALE_FACT_IDS = ["activity", "activity_other", "team", "sellsOnline", "budget", "start", "decision", "tools", "site", "C_url", "E_url"];

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
