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
});

export type Triage = z.infer<typeof TriageSchema>;

export async function triageEnquiry(
  labeledAnswers: string,
  ruleScoring: Scoring,
  locale: "en" | "fr",
): Promise<Triage | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const { object } = await generateObject({
      model: openai(MODEL),
      schema: TriageSchema,
      abortSignal: AbortSignal.timeout(12_000),
      prompt: `You triage enquiries for Digital M, a small AI-for-commerce studio (services: AI agents & chatbots [AGENT], process automation incl. invoicing/reminders [AUTO], websites & e-commerce [WEB], CRM/customer follow-up [CRM], e-commerce security audits [SEC]). Pricing floors: small automations/chatbots from ~€500-1500; websites/CRM from ~€3500. Clients are small, non-technical businesses.

A prospect completed the diagnostic form (language: ${locale}). Their answers:
${labeledAnswers}

Rule-based scoring suggested: ${ruleScoring.proposed.join("+") || "nothing"} (scores ${JSON.stringify(ruleScoring.scores)}). The rules CANNOT read free text — you can. If their own words (especially the magic-wand answer) point somewhere else, trust the words over the rules.

Recommend what genuinely fits this person's situation and budget — modest is fine; "start with one small automation" is a great answer. Never propose SEC unless they sell online.

CRITICAL OUTPUT RULE: write all text as plain UTF-8 with normal accented characters (é, à, ç, ê…). NEVER use escape sequences, hex codes, or character references of any kind.`,
    });
    // Belt & braces: never let the model propose an invalid line.
    const proposed = object.proposed.filter((p): p is ServiceLine => (LINES as readonly string[]).includes(p));
    if (!proposed.length) return null;
    // Reject mangled latin-1 escape output (" E9"→é etc.) — fall back to rules
    // rather than show corrupted text to anyone.
    const mangled = /(?:^| )[EA][0-9A-F](?=[ a-z]|$)|\\x[0-9a-fA-F]{2}/;
    if (mangled.test(object.noteForRadu) || mangled.test(object.clientRationale)) {
      console.error("triage llm returned mangled encoding — discarded");
      return null;
    }
    return { ...object, proposed };
  } catch (e) {
    console.error("triage llm failed", e);
    return null;
  }
}
