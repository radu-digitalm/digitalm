// LLM triage for diagnostic enquiries: reads ALL answers (especially the
// free-text magic wand, which the rule scoring can't see) and produces the
// proposal Radu actually needs. Falls back to null: callers keep rule output.
//
// ENCODING - WHAT IS ASCII AND WHAT IS NOT. 6 of the 11 French rows stored on
// staging came back with control characters glued inside words ("indiqu<NUL>e9
// que", "m<NUL>eames"), and the production lead DM-C4DQ3 carried three of them
// in the subject line Radu received. The cause was isolated by experiment:
// accented letters and typographic punctuation inside the zod schema
// descriptions and the prompt. Twenty runs with ASCII-only descriptions
// produced zero corruption - and those runs still carried accented answers
// typed by the visitor, so what the PERSON wrote is not the cause.
//
// So the line is drawn between the two: every string WE write (this file's
// schema descriptions and prompt, the question labels the route interpolates)
// is plain ASCII - no accented letters, no curly quotes, no em dashes, no
// arrows, no euro sign. What the PERSON typed - first name, business name,
// website, their own words - reaches the model exactly as they typed it.
// It has to: the draft greets them by name and can quote their domain, and a
// reply that opens "Bonjour Helene," or points at cremerie-quebec.ca is the
// same defect as the bare "Bonjour," this file exists to fix.
//
// MONEY - WHY THIS FILE COUNTS DIGITS. DM-JED9Y is a solo social worker with
// no website who ticked "je me renseigne" and gave no budget. He reached Radu
// under the subject "... flexible, 1.500-3.500 EUR" with a priced two-phase
// proposal. He never said a figure; 1,500-3,500 is not even on our price grid.
// Two of our own rules ordered it printed. A prompt that asks for honesty is
// not a guarantee, so the guarantees live here instead:
//   - the schema has no priced field at all when the answers are thin
//     (docs/checkup-signal-spec.md section 5): a field that does not exist
//     cannot be filled in;
//   - GRID is the single source of both the package list the model reads and
//     the set of figures it is allowed to write back, so a band we do not sell
//     is unquotable by construction;
//   - the subject line is taken away from the model entirely: every money
//     token is stripped and a tail is appended from the budget chip the
//     customer physically tapped.
//
// WHICH MODEL RUNS THIS. `OPENAI_MODEL_TRIAGE`, beside the two names its
// siblings already use (`OPENAI_MODEL_CHAT` in the chat route,
// `OPENAI_MODEL_DRAFTS` in the outreach drafts). This file used to read a bare
// `OPENAI_MODEL`, a name that is set nowhere: every triage silently ran on the
// hardcoded default, and nobody could change the model without editing code.
// The old name is still honoured so a host that does set it keeps working.
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import type { Scoring, ServiceLine } from "./diagnosticScoring";

const MODEL = process.env.OPENAI_MODEL_TRIAGE || process.env.OPENAI_MODEL || "gpt-4.1-mini";

const LINES = ["AGENT", "AUTO", "WEB", "CRM", "SEC"] as const;

export const BOOKING = { fr: "https://digitalm.eu/fr/book", en: "https://digitalm.eu/en/book" } as const;

// ---------------------------------------------------------------------------
// The price grid: one constant, read twice
// ---------------------------------------------------------------------------

/**
 * What we actually sell, in the words the model reads. `figures` is the same
 * list of numbers as `price`, machine-readable: the prompt renders `price`,
 * the guard derives ALLOWED_FIGURES from `figures`, and neither can drift from
 * the other because there is only one table.
 */
export const GRID: { item: string; price: string; time: string; figures: number[] }[] = [
  { item: "Site essentiel (modern responsive site, SEO basics)", price: "from 500 EUR", time: "1-2 days", figures: [500] },
  { item: "AI on an existing site (assistant for quotes, replies, scheduling)", price: "from 500 EUR", time: "1-3 days", figures: [500] },
  { item: "Site + AI (new site with AI built in)", price: "from 2,500 EUR", time: "about a week", figures: [2500] },
  { item: "E-commerce security audit", price: "from 500 EUR per day", time: "scope-dependent", figures: [500] },
  { item: "Small automation builds (quote follow-ups, de-duplicating data entry, connecting tools)", price: "500-1,200 EUR", time: "1-3 days", figures: [500, 1200] },
  { item: "Light customer-tracking setup plus automated quote reminders", price: "800-1,200 EUR", time: "2-3 days", figures: [800, 1200] },
];

/** Every figure we publish: {500, 2500, 1200, 800}. Nothing else is quotable. */
export const ALLOWED_FIGURES: ReadonlySet<number> = new Set(GRID.flatMap((g) => g.figures));

/** The budget chips that are an actual statement. "unsure" and "" are not. */
const BAND_LABEL: Record<string, string> = {
  "<1500": "under 1,500 EUR",
  "1500-3500": "1,500-3,500 EUR",
  "3500-7000": "3,500-7,000 EUR",
  "7000+": "7,000 EUR and up",
};

/** True only when the customer tapped a band. "unsure" is NOT a budget. */
export function declaredBudget(budgetId: string | undefined | null): boolean {
  return !!BAND_LABEL[String(budgetId ?? "").trim()];
}

// ---------------------------------------------------------------------------
// What the model may write down
// ---------------------------------------------------------------------------

const SUBJECT_DESC =
  "Email subject tail for Radu, 90 characters at most: the need in a few words, then the timing. NEVER a price, a budget or any figure. Write it in the lead's language.";
const RATIONALE_DESC =
  "1 or 2 warm, complete sentences SHOWN ON SCREEN TO THE LEAD, in their language, addressed directly to them as vous / you. Reflect their own words back and say what you would look at first. Never say le client, leur, the client, they, this prospect. No hype, no pricing.";
const UNKNOWNS_DESC =
  "One short line, in English, listing what we still do not know about this lead and would need before quoting: for example 'no company name, no website, trade unstated, volume unknown'. Write 'nothing important missing' when the answers really are enough.";
const CALLQ_DESC =
  "Two or three short questions for Radu to ask first on the call, in the lead's language, specific to what this person wrote. Not generic discovery questions.";
const FIT_DESC =
  "fits = at least one of the five services clearly matches something they described. unclear = they did not say enough to tell. no-fit = nothing we sell matches this person's situation at all. Choose one: this is a decision, not a default.";
const FITREASON_DESC =
  "Empty string when fit is 'fits'. Otherwise one honest short sentence, in English, internal, saying what is missing or why nothing we sell matches.";

const FIT = z.enum(["fits", "unclear", "no-fit"]);

/** The full answer, for a lead whose answers support naming a service line. */
export const TriageProposeSchema = z.object({
  proposed: z.array(z.enum(LINES)).max(3)
    .describe("Service lines you are confident about, best first. AGENT=AI assistant/chatbot, AUTO=process automation, WEB=website/e-commerce, CRM=customer follow-up, SEC=e-commerce security audit. EMPTY ARRAY when the answers do not support naming one. Guessing is worse than an empty array."),
  subjectSummary: z.string().max(90).describe(SUBJECT_DESC),
  noteForRadu: z.string().max(1000)
    .describe("3 or 4 COMPLETE sentences, in the lead's language, written for Radu and never shown to the lead: what to propose to this specific person, the angle for the reply, a concrete first step, and a price range ONLY when they declared a budget. When they declared none, name instead the two facts to get on the call before any price can be given. Finish every sentence."),
  clientRationale: z.string().max(450).describe(RATIONALE_DESC),
  replyDraft: z.string().max(2200)
    .describe("A complete, ready-to-send reply email to the lead, in the lead's language. Plain text. Structure: subject line first ('Objet: ...' / 'Subject: ...'), then a greeting using their actual first name, spelled exactly as it appears above, accents included, 1 or 2 sentences mirroring their exact pain in their words, then 1 or 2 numbered offer phases, each with a plain title and a timeline, then one ROI sentence grounded in their answers (hours lost, unfollowed quotes), then the booking link, then the sign-off 'Radu, Digital M'. A price range ONLY when they declared a budget; when they did not, one sentence saying you will price it after a short call. Fixed scope, no pressure. Complete sentences only."),
  unknowns: z.string().max(300).describe(UNKNOWNS_DESC),
  callQuestions: z.array(z.string().max(200)).min(2).max(3).describe(CALLQ_DESC),
  fit: FIT.describe(FIT_DESC),
  fitReason: z.string().max(240).describe(FITREASON_DESC),
});

/**
 * The whole answer for a lead whose answers support nothing: no `proposed`, no
 * offer phases, no price, no budget tail. Asking is the product here, and a
 * field that does not exist cannot be filled in with a guess.
 */
export const TriageAskSchema = z.object({
  subjectSummary: z.string().max(90).describe(SUBJECT_DESC),
  noteForRadu: z.string().max(1000)
    .describe("3 or 4 COMPLETE sentences, in the lead's language, for Radu alone: what we actually know about this person, the two facts to get on the call before anything can be proposed, and how to open the conversation. NO price, NO figures: the answers do not support one."),
  clientRationale: z.string().max(450).describe(RATIONALE_DESC),
  replyDraft: z.string().max(1400)
    .describe("A short reply email in the lead's language. Structure: 'Objet: ...' / 'Subject: ...', greeting with their exact first name, one sentence mirroring their own words, then two or three SPECIFIC questions as a short numbered list, then the booking link, then 'Radu, Digital M'. NO prices, NO figures, NO offer phases, NO packages: we do not know enough to propose anything yet. Asking is the product here."),
  unknowns: z.string().max(300).describe(UNKNOWNS_DESC),
  callQuestions: z.array(z.string().max(200)).min(2).max(3).describe(CALLQ_DESC),
  fit: FIT.describe(FIT_DESC),
  fitReason: z.string().max(240).describe(FITREASON_DESC),
});

/** The triage as the rest of the app reads it: one shape for both modes. */
export type Triage = {
  /** Empty when nothing could honestly be named. That is an answer, not a failure. */
  proposed: ServiceLine[];
  subjectSummary: string;
  noteForRadu: string;
  clientRationale: string;
  replyDraft: string;
  unknowns: string;
  callQuestions: string[];
  fit: z.infer<typeof FIT>;
  fitReason: string;
};

/**
 * Model-facing context about the person, built by the route.
 *
 * The three identity fields are the person's own spelling and are passed on
 * untouched: they end up in the greeting and in the reply draft.
 */
export type TriageLead = {
  /** Exactly as they typed it: "Helene" and "Helene" are different people. */
  firstName: string;
  company?: string;
  /** Exactly as they typed it: a de-accented domain is a different domain. */
  website?: string;
  /** The stored budget chip id: "1500-3500", "unsure", or absent. */
  budgetId?: string;
  /** The band label, ASCII, e.g. "1,500-3,500 EUR". Only when they tapped a band. */
  budget?: string;
  /** Their magic-wand sentence, verbatim: the fallback draft quotes it back. */
  magic?: string;
  /** Labelled answers, one per line, magic wand first: ASCII labels, their own words verbatim. */
  answers: string;
};

// ---------------------------------------------------------------------------
// Encoding damage: detection and repair
// ---------------------------------------------------------------------------

const TAB = 9, LF = 10, CR = 13;

/** A C0 control that never belongs in prose. Tab, CR and LF are legitimate. */
function isBadControl(code: number): boolean {
  return code < 0x20 && code !== TAB && code !== LF && code !== CR;
}

// Beyond latin-1, the only code points a repair may produce: the typography
// the model reaches for in French. Anything else is noise and gets dropped
// rather than guessed at.
const REPAIRABLE = new Set([
  0x27, // apostrophe
  0x152, 0x153, // OE, oe
  0x2013, 0x2014, // en dash, em dash
  0x2018, 0x2019, 0x201c, 0x201d, // curly quotes
  0x2026, // ellipsis
  0x20ac, // euro
]);

/** A repaired code point has to be a latin-1 letter or sign, or known typography. */
function latin1Char(code: number): string | null {
  if (code === 0x27) return "'";
  if (code >= 0xa0 && code <= 0xff) return String.fromCharCode(code);
  if (REPAIRABLE.has(code)) return String.fromCharCode(code);
  return null;
}

/** Letter for the "is this glued inside a word?" tests, accents included. */
function isWordChar(ch: string | undefined): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 0xc0 && c <= 0xff);
}

// The legacy " e9" form: a space where the escape's backslash-x used to be.
//
// ONE shape is used both to detect it and to repair it, so a repair can never
// rewrite something the guard would not have called damage. It takes a letter,
// exactly one space, a hex pair out of the set the old guard knew (either
// case: the model writes "\xE9" as readily as "\xe9", and legacyLetter below
// validates the rebuilt character anyway), and a lowercase letter right after:
// "impay e9es" -> "impayées". Anything looser rewrites ordinary prose, which
// is the bug itself with extra steps:
// "votre boutique D2C et" became "votre boutiqueÒC et", "un test E2E sur" became
// "un testâE sur", and because the result carried no control character the
// caller was told the text was clean and shipped it to the visitor's screen.
const LEGACY_RE = /([A-Za-z\xc0-\xff])[ \xa0]([cCeE][0-9]|[fF][49])(?=[a-z\xe0-\xff])/g;

// The rebuild has to land on an ACCENTED letter (x is the multiplication sign
// and a0 is a no-break space: neither is a letter that went missing out of a
// French word) whose case matches the word it is glued to. That last test is
// what keeps "du c2c" intact: 0xc2 is a capital A circumflex, and no French
// word has one in the middle of a lowercase word.
const LOWER_ACCENT = /^[\xdf-\xf6\xf8-\xff]$/;
const UPPER_ACCENT = /^[\xc0-\xd6\xd8-\xde]$/;

/** The accented letter a legacy pair stands for, or null when it stands for none. */
function legacyLetter(before: string, hex: string): string | null {
  const ch = latin1Char(parseInt(hex, 16));
  if (!ch) return null;
  const lower = LOWER_ACCENT.test(ch);
  if (!lower && !UPPER_ACCENT.test(ch)) return null;
  return lower === /[a-z\xdf-\xff]/.test(before) ? ch : null;
}

/** True when the string carries a legacy pair this file can actually rebuild. */
function hasLegacyPair(s: string): boolean {
  LEGACY_RE.lastIndex = 0;
  for (let m = LEGACY_RE.exec(s); m; m = LEGACY_RE.exec(s)) {
    if (legacyLetter(m[1]!, m[2]!)) {
      LEGACY_RE.lastIndex = 0;
      return true;
    }
  }
  return false;
}

// A tab is legitimate whitespace, so the run of letters on each side decides.
// Two complete words joined by a tab ("semaine<TAB>perdues") is a column
// separator or a stray keystroke, not damage, and calling it damage costs the
// whole triage: retry, then the rules fallback, so no reply draft and no
// paragraph on the results screen.
const WHOLE_WORD = 6;

/**
 * A tab standing in for an accented letter ("int<TAB>ress<TAB> par" = the row
 * DM-NG93X, where "intéressé" lost both its letters). At least two letters are
 * required on each side ("5 h<TAB>par semaine" is a column), and at least one
 * of the two runs has to be short enough to be a word fragment rather than a
 * word: "int" and "ress" are fragments, "semaine" and "perdues" are not.
 */
function hasTabInWord(s: string): boolean {
  for (let i = 1; i < s.length - 1; i++) {
    if (s.charCodeAt(i) !== TAB) continue;
    let left = 0;
    while (isWordChar(s[i - 1 - left])) left++;
    let right = 0;
    while (isWordChar(s[i + 1 + right])) right++;
    if (left < 2 || right < 2) continue; // a separator, not a broken word
    if (left >= WHOLE_WORD && right >= WHOLE_WORD) continue; // two whole words
    return true;
  }
  return false;
}

/**
 * Detect encoding damage in model output.
 *
 * The old guard looked for a SPACE followed by a hex pair and returned false on
 * every corrupted row in the database: the real corruption is an invisible
 * control character ("indiqu<NUL>e9", "cherche <SO>0 supprimer"), not a space.
 * So: any C0 control other than tab/CR/LF, a tab glued inside a word, the
 * legacy " e9es" form, and literal backslash-x escapes.
 */
export function isMangled(s: string): boolean {
  if (!s) return false;
  for (let i = 0; i < s.length; i++) if (isBadControl(s.charCodeAt(i))) return true;
  return hasTabInWord(s) || hasLegacyPair(s) || /\\x[0-9a-fA-F]{2}/.test(s);
}

/**
 * Turn the known escape artefacts back into the letter they stand for, then
 * drop whatever is left that must never be shown or stored.
 *
 * The model writes an escape for the character it wants ("é"), and the
 * damage always has the same shape: the leading digits of the code point were
 * swallowed into a control character and the rest survived as plain text. How
 * many were swallowed varies, so the code point is rebuilt by putting the
 * control's own value back in front of the digits that are left. All four
 * forms below come straight out of the staging rows:
 *   "indiqu<NUL>e9"    NUL + 2 hex digits      -> 0x00e9, e acute
 *   "cherche <SO>0"    control + 1 hex digit   -> 0x0e0,  a grave
 *   "d<SOH>53uvres"    control + 2 hex digits  -> 0x0153, oe
 *   "impay e9es"       space + hex pair        -> the latin-1 char
 *   "impay\xe9es"      literal \xNN escape     -> the latin-1 char
 *
 * `damaged` reports what the mapping could NOT recover (a lone control
 * character, a tab standing in for a letter): that is what triggers the retry.
 * The damage is judged before the leftovers are dropped, so stripping can never
 * hide the evidence.
 */
export function repairMangled(s: string): { text: string; repaired: boolean; damaged: boolean } {
  if (!s) return { text: s, repaired: false, damaged: false };

  // Literal backslash escapes first: "\xe9" -> e acute.
  let out = s.replace(/\\x([0-9a-fA-F]{2})/g, (m, hex: string) => latin1Char(parseInt(hex, 16)) ?? m);

  // One left-to-right pass over the control characters: shortest surviving
  // tail first, so "<SO>0" stays a grave and does not swallow the "0" of a
  // following number. A rebuild only counts when it lands on a character the
  // model could plausibly have wanted; otherwise the control is dropped and
  // the text is marked damaged.
  let mapped = "";
  let unrecoverable = false;
  for (let i = 0; i < out.length; i++) {
    const code = out.charCodeAt(i);
    if (!isBadControl(code)) {
      mapped += out[i];
      continue;
    }
    const digits = /^[0-9a-fA-F]{0,3}/.exec(out.slice(i + 1))?.[0] ?? "";
    let rebuilt: string | null = null;
    let used = 0;
    for (let n = 1; n <= digits.length; n++) {
      const ch = latin1Char((code << (4 * n)) | parseInt(digits.slice(0, n), 16));
      if (ch) {
        rebuilt = ch;
        used = n;
        break;
      }
    }
    if (rebuilt) {
      mapped += rebuilt;
      i += used;
      continue;
    }
    unrecoverable = true; // nothing to rebuild from: drop it, but remember why
  }

  // The legacy form, on exactly the shape the guard above calls damage.
  const text = mapped.replace(LEGACY_RE, (m, before: string, hex: string) => {
    const ch = legacyLetter(before, hex);
    return ch ? before + ch : m;
  });

  return { text, repaired: text !== s, damaged: unrecoverable || isMangled(text) };
}

/** Repair every text field of a triage. `damaged` = something we could not fix. */
function repairTriage(t: Triage): { value: Triage; repaired: boolean; damaged: boolean } {
  let repaired = false;
  let damaged = false;
  const fix = (s: string): string => {
    const r = repairMangled(s);
    repaired = repaired || r.repaired;
    damaged = damaged || r.damaged;
    return r.text;
  };
  const value: Triage = {
    ...t,
    subjectSummary: fix(t.subjectSummary),
    noteForRadu: fix(t.noteForRadu),
    clientRationale: fix(t.clientRationale),
    replyDraft: fix(t.replyDraft),
    unknowns: fix(t.unknowns),
    callQuestions: t.callQuestions.map(fix),
    fitReason: fix(t.fitReason),
  };
  return { value, repaired, damaged };
}

// ---------------------------------------------------------------------------
// The ASCII net for everything that comes from outside this file
// ---------------------------------------------------------------------------

// The schema descriptions and the prompt are written in ASCII by hand. What
// the route interpolates is not: the budget band arrives as "EUR3,500-7,000"
// with a euro sign and an en dash, the labelled answers carry every accent the
// questions and the visitor wrote. Those characters are the proven cause of the
// corrupted output, so they are converted before the model ever sees them.
// Accents are dropped rather than guessed at: the model reads "reservations"
// exactly as it reads the accented spelling, and it still answers in proper
// French because the output rule tells it to.
const ASCII_SUBST: Record<string, string> = {
  " ": " ", " ": " ", " ": " ", // no-break, narrow, thin spaces
  "€": "EUR ", "£": "GBP ", "¥": "JPY ",
  "‘": "'", "’": "'", "‚": "'", "′": "'",
  "“": '"', "”": '"', "„": '"', "«": '"', "»": '"',
  "‐": "-", "‑": "-", "–": "-", "—": "-", "−": "-",
  "…": "...", "•": "-", "·": "-", "→": "->", "°": " deg",
  "Œ": "OE", "œ": "oe", "Æ": "AE", "æ": "ae", "ß": "ss",
  "Ø": "O", "ø": "o", "Ł": "L", "ł": "l", "ı": "i",
  "Ð": "D", "ð": "d", "Þ": "Th", "þ": "th",
};

const ASCII_RE = new RegExp(`[${Object.keys(ASCII_SUBST).join("")}]`, "g");

/** Plain ASCII, for every string WE wrote that goes into the model input. */
export function toAscii(s: string): string {
  return (s ?? "")
    // French guillemets hug their content with a space: keep the quotes, drop
    // the space, so "<<en ligne>>" does not come out as '" en ligne "'.
    .replace(/«[ \t   ]*/g, '"')
    .replace(/[ \t   ]*»/g, '"')
    .replace(ASCII_RE, (c) => ASCII_SUBST[c] ?? " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // the accents themselves, once separated
    .replace(/[^\n\r\t\x20-\x7e]/g, "") // anything still out of range
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n");
}

// ---------------------------------------------------------------------------
// What the person typed
// ---------------------------------------------------------------------------

/**
 * Their own text, on its way to the model: keep every letter they typed,
 * accents included, and drop only what can never be prose - the C0 controls
 * (that is the corruption this file hunts, and it must not be fed back in) and
 * DEL. Combining accents are composed first, so "e" + acute counts as one
 * character for the model and comes back as one character in the draft.
 */
export function sanitizeLeadText(s: string): string {
  return (s ?? "")
    .normalize("NFC")
    .replace(/\p{Cc}/gu, (c) => (c === "\t" || c === "\n" || c === "\r" ? c : ""));
}

/** The same, for a value that has to stay on one line of the prompt. */
function leadField(s: string | undefined, fallback: string): string {
  const v = sanitizeLeadText(s ?? "").replace(/[\t\r\n]+/g, " ").trim();
  return v || fallback;
}

// ---------------------------------------------------------------------------
// Money: finding it, removing it, judging it
// ---------------------------------------------------------------------------

const THIN_SPACES = /[    ]/g;

// Digits inside an address are not money: "d3v.digitalm.eu", "/fr/book".
// The host part has to start with a letter, so "1.500" is never read as a
// domain and never escapes the hunt.
const URL_RE = /https?:\/\/\S+|\b[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?/gi;

// A number with thousands groups ("1 500", "3,500", "1.500"), or a plain
// number with an optional decimal part ("1,5", "500").
const NUMBER_RE = /\d{1,3}(?:[ .,]\d{3})+|\d+(?:[.,]\d+)?/g;

// What makes a number money even when it is small: a currency, or the "k" of
// "1,5k". `k(?![a-z])` so "2 kilos" is not 2,000 euros.
const UNIT_RE = /^ {0,2}(?:k(?![A-Za-z])\s?(?:EUR\b|euros?\b|€)?|€|EUR\b|euros?\b|\$|CA\$|CAD\b|USD\b)/i;

// What joins the two ends of a range: "1 500 a 3 500", "de 800 et 1 200".
const RANGE_BETWEEN = /^\s*(?:[-–—]|to|and|et|ou|or|a|au|à)\s*$/i;

type NumberHit = { start: number; end: number; money: boolean; value: number };

/** The numeric value of one hit; "1,5" + "k" is 1500, "3,500" is 3500. */
function valueOf(raw: string, unit: string): number {
  const isK = /^ {0,2}k/i.test(unit);
  const n = /^\d{1,3}(?:[ .,]\d{3})+$/.test(raw)
    ? parseInt(raw.replace(/[ .,]/g, ""), 10)
    : parseFloat(raw.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return NaN;
  return isK ? Math.round(n * 1000) : n;
}

/** Addresses blanked out, length preserved, so every index still lines up. */
function maskUrls(s: string): string {
  return s.replace(URL_RE, (m) => " ".repeat(m.length));
}

/**
 * Every number in the text, with a verdict on each.
 *
 * Money is: anything with a currency or a "k" after it, any run of three or
 * more digits, and any thousands-grouped number. NOT money: "2 a 3 jours",
 * "30 minutes", "24 h sur 24", a bare year. A plain number tied to a money one
 * by a range word ("de 1,5 a 3,5k") is pulled in, because half a range on
 * screen is worse than none.
 */
function scanNumbers(masked: string): NumberHit[] {
  const hits: NumberHit[] = [];
  NUMBER_RE.lastIndex = 0;
  for (let m = NUMBER_RE.exec(masked); m; m = NUMBER_RE.exec(masked)) {
    const raw = m[0];
    const unit = UNIT_RE.exec(masked.slice(m.index + raw.length))?.[0] ?? "";
    const grouped = /[ .,]\d{3}/.test(raw);
    const digits = raw.replace(/\D/g, "").length;
    const yearLike = !unit && !grouped && /^(?:19|20)\d{2}$/.test(raw);
    hits.push({
      start: m.index,
      end: m.index + raw.length + unit.length,
      money: !!unit || (!yearLike && (grouped || digits >= 3)),
      value: valueOf(raw, unit),
    });
  }
  for (let i = 0; i < hits.length - 1; i++) {
    const a = hits[i]!, b = hits[i + 1]!;
    if (a.money === b.money) continue;
    if (!RANGE_BETWEEN.test(masked.slice(a.end, b.start))) continue;
    a.money = true;
    b.money = true;
  }
  return hits;
}

/** Money hits merged across their range words, so a whole band is one span. */
function moneySpans(masked: string): { start: number; end: number }[] {
  const hits = scanNumbers(masked).filter((h) => h.money);
  const spans: { start: number; end: number }[] = [];
  for (const h of hits) {
    const last = spans[spans.length - 1];
    if (last && RANGE_BETWEEN.test(masked.slice(last.end, h.start))) last.end = h.end;
    else spans.push({ start: h.start, end: h.end });
  }
  return spans;
}

/**
 * The money in a string, as the reader sees it: "1 500 a 3 500 EUR" is one
 * token, not two. Empty means nobody can read a price out of this text.
 */
export function moneyTokens(s: string): string[] {
  const norm = (s ?? "").replace(THIN_SPACES, " ");
  const masked = maskUrls(norm);
  return moneySpans(masked).map((sp) => norm.slice(sp.start, sp.end).trim());
}

/** Every figure the text names, for the "is this one of our prices?" test. */
export function moneyFigures(s: string): number[] {
  const masked = maskUrls((s ?? "").replace(THIN_SPACES, " "));
  return scanNumbers(masked).filter((h) => h.money && Number.isFinite(h.value)).map((h) => h.value);
}

/** Leftover punctuation from a removed price, tidied away. */
function tidy(s: string): string {
  return s
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,;.!?])/g, "$1")
    .replace(/(^|[ \t])[-–—,;:|][ \t]*(?=[,;:|]|$)/g, "$1")
    .replace(/[\s,;:·|-]+$/g, "")
    .replace(/^[\s,;:·|-]+/g, "")
    .trim();
}

/** The same text with every price taken out (and, optionally, marked). */
export function stripMoney(s: string, replacement = ""): string {
  const norm = (s ?? "").replace(THIN_SPACES, " ");
  const spans = moneySpans(maskUrls(norm));
  let out = "";
  let last = 0;
  for (const sp of spans) {
    out += norm.slice(last, sp.start) + replacement;
    last = sp.end;
  }
  return tidy(out + norm.slice(last));
}

const NO_BUDGET_TAIL = { fr: "budget non précisé", en: "no budget given" } as const;
const SUBJECT_MAX = 110;

/**
 * The subject line, taken away from the model.
 *
 * Whatever it wrote is stripped of every figure, then the budget chip the
 * customer physically tapped is appended - or the plain statement that there
 * was none. A subject can then only ever carry a number this person chose.
 * (Accents are fine here: this is written after the model call, for Radu's
 * inbox, not for the prompt.)
 */
export function buildSubject(summary: string, lead: TriageLead, locale: "en" | "fr"): string {
  const tail = declaredBudget(lead.budgetId)
    ? (lead.budget?.trim() || BAND_LABEL[String(lead.budgetId).trim()]!)
    : NO_BUDGET_TAIL[locale];
  const head = stripMoney(sanitizeLeadText(summary ?? "").replace(/[\r\n]+/g, " "));
  if (!head) return tail.slice(0, SUBJECT_MAX);
  const room = SUBJECT_MAX - tail.length - 2;
  const cut = head.length > room ? tidy(head.slice(0, Math.max(0, room))) : head;
  return cut ? `${cut}, ${tail}` : tail.slice(0, SUBJECT_MAX);
}

// ---------------------------------------------------------------------------
// The thin signal: what we know, and what we do not
// ---------------------------------------------------------------------------

export type Signal = {
  /** Not one service line could be named from a fact they stated. */
  thin: boolean;
  /** The facts that are not on file, in plain words, computed from the answers. */
  missing: string[];
};

const MISSING = {
  company: "no business name",
  phone: "no phone number",
  website: "no website or page to look at",
  budget: "no budget given",
  problem: "main problem not named",
  symptom: "no symptom named",
  hours: "hours unknown",
  exploring: "just exploring",
} as const;

/**
 * What the answers do and do not support.
 *
 * `thin` is NOT defined here: it is the flag `score()` pushes when it could not
 * name a single line, so the wizard and the route read one definition. This
 * function only reads it and adds the checklist, because in 4 replays out of 4
 * the model's own "what is missing" line forgot the missing phone number -
 * the fact that decides whether speed-to-lead is possible at all.
 */
export function signalOf(answers: Record<string, unknown>, scoring: Scoring): Signal {
  const val = (k: string): string => String(answers[k] ?? "").trim();
  const list = (k: string): string[] => (Array.isArray(answers[k]) ? (answers[k] as unknown[]).map(String) : []);
  const missing: string[] = [];
  // "I do not have one yet" is an answer; an empty box is not.
  if (!val("company") && val("companyNone") !== "none") missing.push(MISSING.company);
  if (!val("phone")) missing.push(MISSING.phone);
  if (!val("site") && !val("C_url") && !val("E_url")) missing.push(MISSING.website);
  if (!declaredBudget(val("budget"))) missing.push(MISSING.budget);
  const pains = list("pains");
  if (!pains.length || pains.every((p) => p === "unsure")) missing.push(MISSING.problem);
  const week = list("U_week");
  if (week.length && week.every((w) => w === "none")) missing.push(MISSING.symptom);
  if (!val("A_hours")) missing.push(MISSING.hours);
  if (val("start") === "exploring") missing.push(MISSING.exploring);
  return { thin: scoring.flags.includes("thin"), missing };
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

function leadBlock(lead: TriageLead, signal: Signal): string {
  // ASCII labels, their own spelling in the values. De-accenting here is what
  // made the "ready-to-send" draft greet Helene as "Helene" and quote a domain
  // she never typed, which is exactly the defect this block exists to close.
  //
  // "Budget: NOT GIVEN" is the whole point of the line: "not decided yet" read
  // as a soft answer, and the model priced a two-phase proposal on top of it.
  const budget = declaredBudget(lead.budgetId) ? toAscii(lead.budget ?? "").trim() || "NOT GIVEN" : "NOT GIVEN";
  return [
    `First name (use it in the greeting, spelled exactly like this): ${leadField(lead.firstName, "not given")}`,
    `Business name: ${leadField(lead.company, "not given")}`,
    `Website (quote it exactly as written): ${leadField(lead.website, "not given")}`,
    `Budget: ${budget}`,
    `These facts are MISSING: ${signal.missing.length ? toAscii(signal.missing.join("; ")) : "nothing important"}`,
    `A missing answer is not a soft answer. "Not sure yet" under budget means NO BUDGET WAS GIVEN. "Honestly not sure" under the problem question means THEY DESCRIBED NO PROBLEM.`,
  ].join("\n");
}

function gridBlock(): string {
  return [
    "PUBLISHED PACKAGE GRID (all prices in euros, indicative, fixed scope agreed up front; day rate 500 EUR per day, preferential for small businesses):",
    ...GRID.map((g) => `- ${g.item}: ${g.price}, ${g.time}`),
  ].join("\n");
}

/**
 * The whole model input. Every hand-written line is ASCII by construction
 * (a test builds this with an ASCII lead and proves the result is all ASCII);
 * the person's own name, company, website and words go in verbatim.
 *
 * Two modes. When the answers support nothing, the grid does not appear at
 * all: the model cannot quote a package it was never shown, and there is not
 * one figure in the prompt for it to reach for.
 */
export function buildTriagePrompt(
  lead: TriageLead,
  ruleScoring: Scoring,
  locale: "en" | "fr",
  signal: Signal = { thin: false, missing: [] },
): string {
  const money = signal.thin
    ? `THERE IS NOT ENOUGH HERE TO QUOTE ANYTHING.
Not one of our five service lines can be named from a fact this person stated. Do not name a price, do not write any figure, do not mention a package, do not describe an offer. Write a short reply that thanks them, mirrors their own sentence back and asks two or three specific questions that would let Radu know what to propose. Asking well IS the complete, correct answer here.
Booking link: ${BOOKING.fr} (FR) or ${BOOKING.en} (EN). In French write "CRM" (never "GRC"), and prefer plain words such as "suivi client".`
    : `${gridBlock()}
Booking link: ${BOOKING.fr} (FR) or ${BOOKING.en} (EN). In French write "CRM" (never "GRC"), and prefer plain words such as "suivi client".

MONEY RULES - read these before quoting anything:
${
  declaredBudget(lead.budgetId)
    ? `- The budget band this person declared is a floor to work up to, never a ceiling to undercut. Never quote below that band without saying why in one clause.
- Quote a RANGE whose lower figure is at or above the floor of that band (for a 3,500-7,000 band quote something like 4,000 to 6,000 EUR), never the "from 500 EUR" entry price.`
    : `- This person stated NO budget. Do not invent one. You may name a price ONLY by quoting a package from the grid above, word for word, as our standard price, and you must say it is our standard price and not a quote for them.
- The only figures you may write are the ones printed in the grid above. Any other number is a price we do not sell.`
}
- Write prices the way the lead's own language writes them.`;

  return [
    toAscii(`You triage enquiries for Digital M, a one-person AI-for-commerce studio run by Radu (services: AI agents and chatbots [AGENT], process automation including invoicing and reminders [AUTO], websites and e-commerce [WEB], customer follow-up / CRM [CRM], e-commerce security audits [SEC]). Clients are small, non-technical businesses. Radu reads every enquiry and replies himself, so the reply draft is signed by him, not by a team.

WHO THIS PERSON IS`),
    leadBlock(lead, signal),
    toAscii(`
A prospect completed the diagnostic form (language: ${locale}). Their answers, in their own words and their own spelling:`),
    sanitizeLeadText(lead.answers),
    toAscii(`
Rule-based scoring suggested: ${ruleScoring.proposed.join("+") || "nothing"} (scores ${JSON.stringify(ruleScoring.scores)}). The rules CANNOT read free text - you can. Trust what they typed themselves over the rules. Text they tapped from a suggestion is not evidence of anything.

${money}

VOICE - clientRationale is printed on the results screen and this person reads it, immediately above the button to book a call. Write it TO them: "vous" in French, "you" in English. Never write "le client", "ce prospect", "leur", "the client" or "they" about them. Mirror their own words back. noteForRadu, unknowns, fit and fitReason are internal: Radu alone reads them.

${
  signal.thin
    ? `FIT - fits means at least one of the five services clearly matches something they described; unclear means they did not say enough to tell; no-fit means nothing we sell matches this person's situation at all. Be honest: "unclear" is the right answer far more often than it gets picked.`
    : `Recommend what genuinely fits this person's situation and budget - modest is fine; "start with one small automation" is a great answer. Do not propose SEC unless they sell online or described their shop's platform.

FIT - fits means at least one of the five services clearly matches something they described; unclear means they did not say enough to tell; no-fit means nothing we sell matches this person's situation at all. When nothing we sell fits, set fit to no-fit, leave proposed empty, and write a short reply that thanks them and asks what they are actually trying to fix. That is a complete, correct answer.`
}

NAMES AND ADDRESSES: copy the first name, the business name and the website above character for character, accents and capitals included. Never strip an accent from a name and never rewrite a web address. The reply draft must greet them by their first name and end with "Radu, Digital M".

CRITICAL OUTPUT RULE: write every field as ordinary text in the lead's language, with normal accented letters (e acute, a grave, c cedilla and the rest). NEVER use escape sequences, hex codes, backslash codes or character references of any kind.`),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// After the answer comes back: the guarantees
// ---------------------------------------------------------------------------

const SIGN_OFF = "Radu, Digital M";
// How much of the end of a draft may follow the sign-off: a "digitalm.eu" line
// is fine, three more paragraphs are not.
const SIGN_OFF_TAIL = 40;

/** The two things every draft must do: greet this person, and be from Radu. */
export function draftOk(draft: string, firstName: string): boolean {
  const d = sanitizeLeadText(draft ?? "").trim();
  const name = sanitizeLeadText(firstName ?? "").trim();
  if (!d || !name) return false;
  if (!d.toLowerCase().includes(name.toLowerCase())) return false;
  return d.slice(-SIGN_OFF_TAIL).includes(SIGN_OFF);
}

const GENERIC_QUESTIONS = {
  fr: [
    "Qu'est-ce qui vous a pris le plus de temps la semaine dernière, en dehors de votre vrai travail ?",
    "Où retrouvez-vous aujourd'hui ce que vous avez à faire : papier, tableur, boîte mail ?",
  ],
  en: [
    "What took the most time away from your real work last week?",
    "Where do you find what you have to do today: on paper, in a spreadsheet, in your inbox?",
  ],
} as const;

/**
 * The draft we write ourselves when the model will not stop naming a price.
 *
 * It is short on purpose: their own sentence back, the questions, the booking
 * link, Radu's name. No figure can appear in it, because none is interpolated.
 */
export function fallbackDraft(lead: TriageLead, callQuestions: string[], locale: "en" | "fr"): string {
  const name = sanitizeLeadText(lead.firstName ?? "").trim() || (locale === "fr" ? "bonjour" : "there");
  const asked = callQuestions.map((q) => sanitizeLeadText(q).trim()).filter(Boolean).slice(0, 3);
  const questions = (asked.length >= 2 ? asked : [...GENERIC_QUESTIONS[locale]]).map((q, i) => `${i + 1}. ${q}`);
  const magic = stripMoney(sanitizeLeadText(lead.magic ?? "").replace(/[\r\n]+/g, " ").trim());
  if (locale === "fr") {
    return [
      "Objet : Quelques questions avant de vous proposer quoi que ce soit",
      "",
      `Bonjour ${name},`,
      "",
      magic
        ? `Merci pour votre check-up. Vous avez écrit : « ${magic} ». Pour vous répondre utilement plutôt que de vous envoyer une offre toute faite, j'ai besoin de deux ou trois précisions :`
        : "Merci pour votre check-up. Pour vous répondre utilement plutôt que de vous envoyer une offre toute faite, j'ai besoin de deux ou trois précisions :",
      "",
      ...questions,
      "",
      `Une ligne par question suffit, ou réservez un appel de 30 minutes quand cela vous arrange : ${BOOKING.fr}`,
      "",
      SIGN_OFF,
    ].join("\n");
  }
  return [
    "Subject: A few questions before I suggest anything",
    "",
    `Hi ${name},`,
    "",
    magic
      ? `Thanks for completing the check-up. You wrote: "${magic}". Rather than send you an off-the-shelf offer, I would like two or three things cleared up first:`
      : "Thanks for completing the check-up. Rather than send you an off-the-shelf offer, I would like two or three things cleared up first:",
    "",
    ...questions,
    "",
    `One line each is plenty, or book a 30-minute call whenever it suits you: ${BOOKING.en}`,
    "",
    SIGN_OFF,
  ].join("\n");
}

/** The figures this lead may be shown: our own grid, and nothing else. */
function badFigures(t: Triage, lead: TriageLead, signal: Signal): number[] {
  const figures = [...moneyFigures(t.replyDraft), ...moneyFigures(t.noteForRadu)];
  if (signal.thin) return figures; // not one price is allowed
  if (declaredBudget(lead.budgetId)) return []; // their own band: the prompt's rules apply
  return figures.filter((f) => !ALLOWED_FIGURES.has(f));
}

/**
 * What is wrong with this answer, in words, or an empty list.
 *
 * A non-empty list buys exactly one retry: the same model asked again mostly
 * gets it right, and the deterministic remedies below are the floor, not the
 * plan.
 */
export function checkTriage(t: Triage, lead: TriageLead, signal: Signal): string[] {
  const problems: string[] = [];
  if (!draftOk(t.replyDraft, lead.firstName)) problems.push("the draft does not greet them by name or is not signed by Radu");
  const bad = badFigures(t, lead, signal);
  if (bad.length) {
    problems.push(
      signal.thin
        ? `a price reached the draft or the note for a lead we cannot quote: ${bad.join(", ")}`
        : `figures we do not sell: ${bad.join(", ")}`,
    );
  }
  return problems;
}

const PRICES_REMOVED = "Prices that are not on our grid were removed from this note. Ask before quoting. ";

/**
 * Everything the model does not get to decide, applied to its answer.
 *
 * Pure, and called on every answer whether or not it had a problem: the
 * subject line, the fit clamp and the checklist are guarantees, not repairs.
 */
export function finalizeTriage(t: Triage, lead: TriageLead, signal: Signal, locale: "en" | "fr"): Triage {
  let replyDraft = t.replyDraft;
  let noteForRadu = t.noteForRadu;

  // A price that survived the retry: write the draft ourselves, and take the
  // figures out of the note, which is the other half of what Radu reads.
  if (badFigures(t, lead, signal).length) {
    replyDraft = fallbackDraft(lead, t.callQuestions, locale);
    noteForRadu = PRICES_REMOVED + stripMoney(noteForRadu, "[price removed]");
  }
  // A draft Radu has to proofread is worse than no draft, because he will
  // eventually stop proofreading. No draft says so in the e-mail instead.
  if (!draftOk(replyDraft, lead.firstName)) replyDraft = "";

  // A lead where not one line could be named from a stated fact is not a
  // confident fit, whatever the model says.
  const fit = signal.thin && t.fit === "fits" ? "unclear" : t.fit;

  // The model may add nuance to what is missing; it may never subtract a fact.
  const modelLine = t.unknowns.trim();
  const unknowns = [
    ...signal.missing,
    signal.missing.length && /^nothing (important )?(is )?missing/i.test(modelLine) ? "" : modelLine,
  ]
    .filter(Boolean)
    .join("; ");

  return {
    ...t,
    proposed: fit === "no-fit" ? [] : t.proposed,
    subjectSummary: buildSubject(t.subjectSummary, lead, locale),
    noteForRadu,
    replyDraft,
    unknowns: unknowns.slice(0, 600),
    fit,
  };
}

/**
 * `fit` in the column every consumer already reads.
 *
 * "fits" writes NULL, so NULL finally means one thing; "unclear" writes the
 * sentence that stops a price being quoted; "no-fit" writes the model's reason,
 * exactly as the old `noFit` string did. leads.ts, leadView.ts, LeadDetail.tsx
 * and mail.ts keep working untouched.
 */
export function noFitColumn(t: Pick<Triage, "fit" | "fitReason">): string | null {
  const reason = (t.fitReason ?? "").trim();
  if (t.fit === "fits") return null;
  if (t.fit === "unclear") return `Not enough in the answers to say what fits. Ask before quoting. ${reason}`.trim();
  return reason || "Nothing we sell fits this lead.";
}

export async function triageEnquiry(
  lead: TriageLead,
  ruleScoring: Scoring,
  locale: "en" | "fr",
  signal: Signal = { thin: false, missing: [] },
  attempt = 1,
): Promise<Triage | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const call = {
      model: openai(MODEL),
      abortSignal: AbortSignal.timeout(18_000),
      prompt: buildTriagePrompt(lead, ruleScoring, locale, signal),
    };
    // The thin schema has no `proposed` field at all, which is the guarantee:
    // a field that does not exist cannot be filled in with a guess.
    const object: Omit<Triage, "proposed"> & { proposed?: string[] } = signal.thin
      ? await generateObject({ ...call, schema: TriageAskSchema }).then((r) => r.object)
      : await generateObject({ ...call, schema: TriageProposeSchema }).then((r) => r.object);
    // Belt & braces: never let the model propose an invalid line. An EMPTY
    // proposal is an answer, not a failure: throwing the draft, the call
    // questions and the on-screen paragraph away as punishment for honesty is
    // what produced the invented band in the first place.
    const proposed = (object.proposed ?? [])
      .filter((p): p is ServiceLine => (LINES as readonly string[]).includes(p));
    // Repair first, then judge what is left: corrupted text must never reach
    // the visitor's screen or Radu's inbox. Unrecoverable damage -> retry once,
    // then give up and let the caller keep the rule scoring.
    const { value, repaired, damaged } = repairTriage({ ...object, proposed });
    if (damaged) {
      console.error(`triage llm returned unrepairable encoding (attempt ${attempt})`);
      if (attempt < 2) return triageEnquiry(lead, ruleScoring, locale, signal, attempt + 1);
      return null;
    }
    if (repaired) console.warn(`triage llm output repaired (attempt ${attempt})`);
    const problems = checkTriage(value, lead, signal);
    if (problems.length) {
      console.error(`triage llm answer rejected (attempt ${attempt}): ${problems.join("; ")}`);
      if (attempt < 2) return triageEnquiry(lead, ruleScoring, locale, signal, attempt + 1);
    }
    return finalizeTriage(value, lead, signal, locale);
  } catch (e) {
    console.error("triage llm failed", e);
    return null;
  }
}
