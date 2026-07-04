// LLM triage for diagnostic enquiries: reads ALL answers (especially the
// free-text magic wand, which the rule scoring can't see) and produces the
// proposal Radu actually needs. Falls back to null — callers keep rule output.
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
    .describe("Email subject tail for Radu, <=90 chars, concrete and specific. Format like: 'services solo, tout papier — relances factures → AUTO · 1-3mo · <1.5k'. Use the lead's language."),
  noteForRadu: z.string().max(1000)
    .describe("3-4 COMPLETE sentences, in the lead's language: what you'd propose to this specific person and the angle for the reply, grounded in their own words. Realistic for their budget; mention a concrete first step and rough price fit. Finish every sentence."),
  clientRationale: z.string().max(450)
    .describe("1-2 warm, complete sentences in the lead's language, shown on their results screen: reflect their own words back and say what you'd look at first. No hype, no pricing."),
  replyDraft: z.string().max(2200)
    .describe("A complete, ready-to-send reply email to the lead, in the lead's language. Plain text. Structure: subject line first ('Objet: …' / 'Subject: …'), greeting with their first name, 1-2 sentences mirroring their exact pain in their words, then 1-2 numbered offer phases each with a bold-free plain title, an indicative price range from the package grid, and a timeline, then one ROI sentence grounded in their answers (hours lost / unfollowed quotes), a smaller-entry option if budget is unknown or low, the booking link, and sign-off 'L'équipe Digital M' or 'The Digital M team'. Fixed-scope, no-pressure tone. Complete sentences only."),
});

export type Triage = z.infer<typeof TriageSchema>;

/**
 * Detect the model's mangled latin-1 escapes (" e9es" = ées, " e0 " = à…).
 * Only digit-containing hex pairs — letter-only pairs like " ea" would
 * false-positive on real French ("l'eau"). Corrupted French output always
 * contains at least one é/è/à/ç/ô/ù, so this catches every real case.
 */
export function isMangled(s: string): boolean {
  return (
    /(?:^|\s)(?:[ec][0-9]|f[49]|a0)(?=[a-zàâçèéêîôùû])/i.test(s) ||
    /\\x[0-9a-fA-F]{2}/.test(s)
  );
}

export async function triageEnquiry(
  labeledAnswers: string,
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
      prompt: `You triage enquiries for Digital M, a small AI-for-commerce studio (services: AI agents & chatbots [AGENT], process automation incl. invoicing/reminders [AUTO], websites & e-commerce [WEB], CRM/customer follow-up [CRM], e-commerce security audits [SEC]). Clients are small, non-technical businesses.

PUBLISHED PACKAGE GRID (use these for any prices you quote — indicative "from" ranges, fixed scope agreed up front; day rate €500/day preferential for small businesses):
- Site essentiel (modern responsive site, SEO basics): from €500 · 1-2 days
- L'IA sur votre site / AI on your site (assistant for quotes, replies, scheduling on an existing site): from €500 · 1-3 days
- Site + IA (new site with AI integrated): from €2,500 · ~1 week
- Audit de sécurité e-commerce: from €500/day, scope-dependent
- Small automation builds (quote follow-ups, de-duplicating data entry, connecting tools): typically €500-1,200 · 1-3 days
- Light customer-tracking setup ("suivi client") + automated quote reminders: typically €800-1,200 · 2-3 days
Booking link: https://digitalm.eu/fr/book (FR) or https://digitalm.eu/en/book (EN). In French say "CRM" (never "GRC"), and prefer plain words like "suivi client".

A prospect completed the diagnostic form (language: ${locale}). Their answers:
${labeledAnswers}

Rule-based scoring suggested: ${ruleScoring.proposed.join("+") || "nothing"} (scores ${JSON.stringify(ruleScoring.scores)}). The rules CANNOT read free text — you can. If their own words (especially the magic-wand answer) point somewhere else, trust the words over the rules.

Recommend what genuinely fits this person's situation and budget — modest is fine; "start with one small automation" is a great answer. Never propose SEC unless they sell online.

CRITICAL OUTPUT RULE: write all text as plain UTF-8 with normal accented characters (é, à, ç, ê…). NEVER use escape sequences, hex codes, or character references of any kind.`,
    });
    // Belt & braces: never let the model propose an invalid line.
    const proposed = object.proposed.filter((p): p is ServiceLine => (LINES as readonly string[]).includes(p));
    if (!proposed.length) return null;
    // The model sometimes emits latin-1 escapes that reach us as " e9"/" E9"
    // glued mid-word ("impay e9es" = impayées). Corrupted text must never
    // reach anyone: retry once, then fall back to rule scoring.
    if (isMangled(object.noteForRadu) || isMangled(object.clientRationale) || isMangled(object.replyDraft)) {
      console.error(`triage llm returned mangled encoding (attempt ${attempt})`);
      if (attempt < 2) return triageEnquiry(labeledAnswers, ruleScoring, locale, attempt + 1);
      return null;
    }
    return { ...object, proposed };
  } catch (e) {
    console.error("triage llm failed", e);
    return null;
  }
}
