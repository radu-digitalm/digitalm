// Outreach drafts via generateObject (contract §8): four fields with zod caps,
// a 20 s timeout, the mangled-encoding guard from the diagnostic triage (one
// retry), the PII / banned-word guards, and the FR/EN template as the fallback
// for every other outcome. The model only ever sees what the caller puts in
// DraftInput — a safeDisplayName(), a town, a trade, stored check results —
// never a legal name, an email address or a phone number.
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { isMangled } from "@/lib/diagnosticTriage";
import { BANNED_WORDS } from "@/content/report";
import { findingsInPlainWords, firstSteps, flagWords } from "@/lib/report/findings";
import { DEFAULT_SIGNATURE, DRAFT_CAPS, looksUnsafe, templateDraft, type DraftFields, type DraftInput } from "./templates";

export { safeDisplayName } from "./templates";

export const DRAFT_TIMEOUT_MS = 20_000;

export function draftModelName(): string {
  return process.env.OPENAI_MODEL_DRAFTS || "gpt-4.1-mini";
}

export interface GeneratedDraft extends DraftFields {
  /** Model id, or null for a template draft. */
  model: string | null;
  fallback: boolean;
  /** Model calls made (0 when the key is unset) — the caller counts them in api_usage. */
  attempts: number;
  /** Why the template was used (log/UI hint), null when the model draft was kept. */
  reason: string | null;
}

const DraftSchema = z.object({
  subject: z
    .string()
    .min(DRAFT_CAPS.subject.min)
    .max(DRAFT_CAPS.subject.max)
    .describe("Email subject: plain and specific, names the business, no exclamation mark, no emoji."),
  email: z
    .string()
    .min(DRAFT_CAPS.body.min)
    .max(DRAFT_CAPS.body.max)
    .describe(
      "Plain-text email body WITHOUT any legal block: greeting; one sentence on what we looked at; the 2-3 findings that matter most, in the recipient's interest; the report link on its own line, verbatim; one line 'what we would do first' with the package label and price as given; a soft close; the signature. No email address, no phone number.",
    ),
  callScript: z
    .string()
    .min(DRAFT_CAPS.callScript.min)
    .max(DRAFT_CAPS.callScript.max)
    .describe(
      "Spoken opener, first person. Opens with who we are, where the number came from, why we call (one finding), then the sentence that they can refuse and we note it right now and never call again; then offers to email the report. No numbers, no addresses.",
    ),
  noteForOwner: z
    .string()
    .min(DRAFT_CAPS.noteForOwner.min)
    .max(DRAFT_CAPS.noteForOwner.max)
    .describe("In English, for the person who sends: the angle, the package to lead with, anything to check by hand before sending."),
});

const PHONE_SOURCE_WORDS: Record<string, string> = {
  website: "their own website",
  osm: "OpenStreetMap",
  fr_register: "the French business register (annuaire des entreprises)",
  companies_house: "Companies House",
  google: "their public listing",
  manual: "their public listing",
};

function buildPrompt(input: DraftInput): string {
  const { locale, prospect } = input;
  const language = locale === "fr" ? "French" : "English";
  const signature = input.signature || DEFAULT_SIGNATURE;
  const caller = signature.split(/\s[—–-]\s/)[0]?.trim() || signature;
  const findings = findingsInPlainWords(input.checks, input.flags, input.top, locale);
  const otherFlags = flagWords(input.flags, locale).filter((w) => !findings.some((f) => f.includes(w)));
  const steps = firstSteps(input.fits, input.flags, locale);
  const phoneSource = PHONE_SOURCE_WORDS[prospect.phoneSource ?? ""] ?? "their public listing";
  const who = [prospect.trade ?? "a local business", prospect.town ? `in ${prospect.town}` : "", `(${prospect.country})`].filter(Boolean).join(" ");

  return `You write business-to-business prospecting drafts for Digital M, a small web and AI studio in Ariège, France. Services and package labels (use the labels and prices exactly as given below, never invent others): websites [WEB], an AI assistant on an existing site [AGENT], online booking and small automations [AUTO], e-commerce security audits [SEC].

Recipient: ${who}. Business name to use: "${prospect.displayName}" — use this name and no other; never a person's name.
Write every field in ${language}, except noteForOwner in English.

We checked their public website automatically and send them a one-page report.
Findings that matter most, in plain words:
${findings.length ? findings.map((f) => `- ${f}`).join("\n") : "- Nothing urgent: the site is in good shape."}
${otherFlags.length ? `Other observations: ${otherFlags.join("; ")}.` : ""}
Score: ${input.score === null ? "not scored" : `${input.score}/100`}${input.grade ? ` (grade ${input.grade})` : ""}.
${steps.length ? `Suggested packages, best first (label and price verbatim):\n${steps.map((s) => `- ${s.label} — ${s.action}${s.why ? ` (because: ${s.why})` : ""}`).join("\n")}` : "No package to suggest: keep the email to the findings and the report."}
Report link, to appear verbatim in the email on its own line: ${input.reportUrl}
Signature to end the email with: "${signature}". The caller on the phone is ${caller} from Digital M; the phone number was found on ${phoneSource}.

Writing rules:
- Plain words, short sentences, no hype, no pressure, no jargon. Observations, not judgements: keep the recipient's dignity.
- Never use these words: ${BANNED_WORDS.join(", ")}.
- For the AI-readability finding say "AI assistants cannot read your site" (in ${language}), never "error".
- Never include an email address or a phone number anywhere. Never invent facts beyond the findings above. No legal text: it is added separately.
- Close the email with the real follow-up rule: without a reply there will be exactly one reminder about a week later, then nothing more. Never promise "you will not hear from us again" or anything the reminder would break.
- The call script must open with who we are, where the number came from and why we call, and must contain the sentence that they can refuse this call and we note it right now and will not call again.

CRITICAL OUTPUT RULE: write all text as plain UTF-8 with normal accented characters (é, à, ç, ê…). NEVER use escape sequences, hex codes, or character references of any kind.`;
}

function isTimeout(e: unknown): boolean {
  const name = String((e as { name?: unknown })?.name ?? "");
  return /abort|timeout/i.test(name);
}

/**
 * The model's four fields, or the template. Rules in order: no key → template;
 * a call fails → one retry unless it timed out; mangled text → one retry;
 * the report URL is appended when missing; an email address, a phone
 * pattern or a banned word → template. Nothing from the draft is logged.
 */
export async function generateDraft(input: DraftInput): Promise<GeneratedDraft> {
  const template = templateDraft(input);
  if (!process.env.OPENAI_API_KEY) return { ...template, model: null, fallback: true, attempts: 0, reason: "no_key" };
  const model = draftModelName();
  const prompt = buildPrompt(input);
  let attempts = 0;
  let reason = "unknown";
  for (let attempt = 1; attempt <= 2; attempt++) {
    attempts = attempt;
    let object: z.infer<typeof DraftSchema>;
    try {
      ({ object } = await generateObject({
        model: openai(model),
        schema: DraftSchema,
        abortSignal: AbortSignal.timeout(DRAFT_TIMEOUT_MS),
        prompt,
      }));
    } catch (e) {
      const timedOut = isTimeout(e);
      reason = timedOut ? "timeout" : "model_error";
      console.error(`draft llm failed (attempt ${attempt}): ${String((e as { name?: unknown })?.name ?? "error")}`);
      if (timedOut) break;
      continue;
    }
    const fields: DraftFields = {
      subject: object.subject.replace(/[\r\n]+/g, " ").trim(),
      body: object.email.trim(),
      callScript: object.callScript.trim(),
      noteForOwner: object.noteForOwner.trim(),
    };
    if (Object.values(fields).some((v) => isMangled(v))) {
      reason = "mangled";
      console.error(`draft llm returned mangled encoding (attempt ${attempt})`);
      continue;
    }
    if (!fields.body.includes(input.reportUrl)) {
      fields.body += input.locale === "fr" ? `\n\nLe rapport complet : ${input.reportUrl}` : `\n\nThe full report: ${input.reportUrl}`;
    }
    const unsafe = looksUnsafe(fields);
    if (unsafe) {
      console.warn(`draft llm output replaced by template (${unsafe.split(":").slice(0, 2).join(":")})`);
      return { ...template, model: null, fallback: true, attempts, reason: `unsafe:${unsafe.split(":")[1]}` };
    }
    return { ...fields, model, fallback: false, attempts, reason: null };
  }
  return { ...template, model: null, fallback: true, attempts, reason };
}
