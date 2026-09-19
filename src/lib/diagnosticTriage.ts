// LLM triage for diagnostic enquiries: reads ALL answers (especially the
// free-text magic wand, which the rule scoring can't see) and produces the
// proposal Radu actually needs. Falls back to null: callers keep rule output.
//
// EVERYTHING THE MODEL IS SHOWN IS PLAIN ASCII ON PURPOSE. 6 of the 11 French
// rows stored on staging came back with control characters glued inside words
// ("indiqu<NUL>e9 que", "m<NUL>eames"), and the production lead DM-C4DQ3 carried
// three of them in the subject line Radu received. The cause was isolated by
// experiment: accented letters and typographic punctuation inside the zod
// schema descriptions and the prompt. Twenty runs with ASCII-only descriptions
// produced zero corruption. Keep every model-facing string in this file ASCII:
// no accented letters, no curly quotes, no em dashes, no arrows, no euro sign.
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import type { Scoring, ServiceLine } from "./diagnosticScoring";

const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

const LINES = ["AGENT", "AUTO", "WEB", "CRM", "SEC"] as const;

const TriageSchema = z.object({
  proposed: z.array(z.enum(LINES)).min(1).max(3)
    .describe("Service lines to propose, best first. AGENT=AI assistant/chatbot, AUTO=process automation, WEB=website/e-commerce, CRM=customer follow-up, SEC=e-commerce security audit."),
  subjectSummary: z.string().max(90)
    .describe("Email subject tail for Radu, 90 characters at most, concrete and specific: the need in a few words, then the timing, then the budget band. Example shape: 'relances factures + suivi client, 2-3j, 1,5k-3,5k'. Write it in the lead's language."),
  noteForRadu: z.string().max(1000)
    .describe("3 or 4 COMPLETE sentences, in the lead's language, written for Radu and never shown to the lead: what to propose to this specific person, the angle for the reply, a concrete first step, and the price range that fits the budget they declared. Finish every sentence."),
  clientRationale: z.string().max(450)
    .describe("1 or 2 warm, complete sentences SHOWN ON SCREEN TO THE LEAD, in their language, addressed directly to them as vous / you. Reflect their own words back and say what you would look at first. Never say le client, leur, the client, they, this prospect. No hype, no pricing."),
  replyDraft: z.string().max(2200)
    .describe("A complete, ready-to-send reply email to the lead, in the lead's language. Plain text. Structure: subject line first ('Objet: ...' / 'Subject: ...'), then a greeting using their actual first name as given above, 1 or 2 sentences mirroring their exact pain in their words, then 1 or 2 numbered offer phases, each with a plain title, a price range that respects the budget they declared, and a timeline, then one ROI sentence grounded in their answers (hours lost, unfollowed quotes), then the booking link, then the sign-off 'Radu, Digital M'. Fixed scope, no pressure. Complete sentences only."),
  unknowns: z.string().max(300)
    .describe("One short line, in English, listing what we still do not know about this lead and would need before quoting: for example 'no company name, no website, trade unstated, volume unknown'. Write 'nothing important missing' when the answers really are enough."),
  callQuestions: z.array(z.string().max(200)).min(1).max(3)
    .describe("Exactly two short questions for Radu to ask first on the call, in the lead's language, specific to what this person wrote. Not generic discovery questions."),
  noFit: z.string().max(240)
    .describe("Empty string when at least one of the five services genuinely fits. Otherwise one honest short sentence, in English, saying that nothing we sell fits this lead and why."),
});

export type Triage = z.infer<typeof TriageSchema>;

/** Model-facing context about the person, built by the route. */
export type TriageLead = {
  firstName: string;
  company?: string;
  website?: string;
  /** The budget band as the lead chose it, e.g. "EUR 1,500-3,500". */
  budget?: string;
  /** Labelled answers, one per line, magic wand first. */
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

// The latin-1 codes the legacy " e9" form may stand for: pairs containing a
// digit only. Letter-only pairs such as "ea" would eat real French
// ("les eaux" -> "lseux"), which is worse than the bug itself.
const LEGACY_PAIRS = /^(?:[cdef][0-9]|a0)$/i;

/**
 * A tab standing in for an accented letter ("int<TAB>ress<TAB> par" = the row
 * DM-NG93X, where "intéressé" lost both its letters). Two letters are required
 * on each side so that a tab used as a column separator ("5 h<TAB>par semaine")
 * is not mistaken for damage: a needless retry costs a whole triage.
 */
function hasTabInWord(s: string): boolean {
  for (let i = 2; i < s.length - 2; i++) {
    if (
      s.charCodeAt(i) === TAB &&
      isWordChar(s[i - 1]) && isWordChar(s[i - 2]) &&
      isWordChar(s[i + 1]) && isWordChar(s[i + 2])
    ) {
      return true;
    }
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
  return (
    hasTabInWord(s) ||
    /(?:^|\s)(?:[ec][0-9]|f[49]|a0)(?=[a-z\xe0-\xff])/i.test(s) ||
    /\\x[0-9a-fA-F]{2}/.test(s)
  );
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

  // The legacy form, only where the pair is glued between two letters.
  const text = mapped.replace(
    /([A-Za-z\xc0-\xff])[ \xa0]?([0-9a-fA-F]{2})(?=[A-Za-z\xc0-\xff])/g,
    (m, before: string, hex: string) => {
      if (!LEGACY_PAIRS.test(hex)) return m;
      const ch = latin1Char(parseInt(hex, 16));
      return ch && /[a-z\xe0-\xff]/i.test(ch) ? before + ch : m;
    },
  );

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
    noFit: fix(t.noFit),
  };
  return { value, repaired, damaged };
}

// ---------------------------------------------------------------------------

function leadBlock(lead: TriageLead): string {
  return [
    `First name (use it in the greeting): ${lead.firstName || "not given"}`,
    `Business name: ${lead.company || "not given"}`,
    `Website: ${lead.website || "not given"}`,
    `Budget they declared: ${lead.budget || "not stated"}`,
  ].join("\n");
}

export async function triageEnquiry(
  lead: TriageLead,
  ruleScoring: Scoring,
  locale: "en" | "fr",
  attempt = 1,
): Promise<Triage | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const { object } = await generateObject({
      model: openai(MODEL),
      schema: TriageSchema,
      abortSignal: AbortSignal.timeout(18_000),
      prompt: `You triage enquiries for Digital M, a one-person AI-for-commerce studio run by Radu (services: AI agents and chatbots [AGENT], process automation including invoicing and reminders [AUTO], websites and e-commerce [WEB], customer follow-up / CRM [CRM], e-commerce security audits [SEC]). Clients are small, non-technical businesses. Radu reads every enquiry and replies himself, so the reply draft is signed by him, not by a team.

WHO THIS PERSON IS
${leadBlock(lead)}

A prospect completed the diagnostic form (language: ${locale}). Their answers:
${lead.answers}

Rule-based scoring suggested: ${ruleScoring.proposed.join("+") || "nothing"} (scores ${JSON.stringify(ruleScoring.scores)}). The rules CANNOT read free text - you can. If their own words (especially the magic-wand answer) point somewhere else, trust the words over the rules.

PUBLISHED PACKAGE GRID (all prices in euros, indicative, fixed scope agreed up front; day rate 500 EUR per day, preferential for small businesses):
- Site essentiel (modern responsive site, SEO basics): from 500 EUR, 1-2 days
- AI on an existing site (assistant for quotes, replies, scheduling): from 500 EUR, 1-3 days
- Site + AI (new site with AI built in): from 2,500 EUR, about a week
- E-commerce security audit: from 500 EUR per day, scope-dependent
- Small automation builds (quote follow-ups, de-duplicating data entry, connecting tools): 500-1,200 EUR, 1-3 days
- Light customer-tracking setup plus automated quote reminders: 800-1,200 EUR, 2-3 days
Booking link: https://digitalm.eu/fr/book (FR) or https://digitalm.eu/en/book (EN). In French write "CRM" (never "GRC"), and prefer plain words such as "suivi client".

MONEY RULES - read these before quoting anything:
- The budget band this person declared is a floor to work up to, never a ceiling to undercut. Never quote below that band without saying why in one clause.
- When they declared a band, quote a RANGE whose lower figure is at or above the floor of that band (for a 3,500-7,000 band quote something like 4,000 to 6,000 EUR), never the "from 500 EUR" entry price.
- When no budget was stated, quote the standard project range (1,500 to 3,500 EUR) rather than the cheapest item, and offer a smaller first step as an option.
- Write prices the way the lead's own language writes them.

VOICE - clientRationale is printed on the results screen and this person reads it, immediately above the button to book a call. Write it TO them: "vous" in French, "you" in English. Never write "le client", "ce prospect", "leur", "the client" or "they" about them. Mirror their own words back. noteForRadu, unknowns and noFit are internal: Radu alone reads them.

Recommend what genuinely fits this person's situation and budget - modest is fine; "start with one small automation" is a great answer. Never propose SEC unless they sell online. If nothing we sell honestly fits, say so in noFit and still fill the other fields with the least bad option.

CRITICAL OUTPUT RULE: write every field as ordinary text in the lead's language, with normal accented letters (e acute, a grave, c cedilla and the rest). NEVER use escape sequences, hex codes, backslash codes or character references of any kind.`,
    });
    // Belt & braces: never let the model propose an invalid line.
    const proposed = object.proposed.filter((p): p is ServiceLine => (LINES as readonly string[]).includes(p));
    if (!proposed.length) return null;
    // Repair first, then judge what is left: corrupted text must never reach
    // the visitor's screen or Radu's inbox. Unrecoverable damage -> retry once,
    // then give up and let the caller keep the rule scoring.
    const { value, repaired, damaged } = repairTriage({ ...object, proposed });
    if (damaged) {
      console.error(`triage llm returned unrepairable encoding (attempt ${attempt})`);
      if (attempt < 2) return triageEnquiry(lead, ruleScoring, locale, attempt + 1);
      return null;
    }
    if (repaired) console.warn(`triage llm output repaired (attempt ${attempt})`);
    return value;
  } catch (e) {
    console.error("triage llm failed", e);
    return null;
  }
}
