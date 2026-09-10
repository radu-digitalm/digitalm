// Template drafts (FR/EN) — the fallback when the model is off, times out,
// returns mangled text or breaks a rule — plus the 7-day follow-up body, the
// field caps shared with the zod schema, safeDisplayName and the guards that
// decide whether a model draft may be used at all. Pure: no DB, no next/*, no
// env, relative imports with extensions, `import type` for every type, no
// enums or parameter properties (node --test, strip-only mode).
import type { AuditChecks, CheckKey, FitSuggestion, Flag } from "../crm/types.ts";
import { BANNED_WORDS, GENERIC_BUSINESS, type ReportLocale } from "../../content/report.ts";
import { checkCounts, findingsInPlainWords, firstSteps, topFindings } from "../report/findings.ts";

// ---- shapes ----------------------------------------------------------------------

/** Where the phone number on file came from — the call script says so out loud. */
export type PhoneSource = "website" | "osm" | "fr_register" | "companies_house" | "google" | "manual";

export interface DraftProspect {
  /** Already passed through safeDisplayName(): never a sole trader's personal name. */
  displayName: string;
  town: string | null;
  trade: string | null;
  country: string;
  soleTrader: boolean | null;
  phoneSource?: PhoneSource | null;
}

export interface DraftInput {
  locale: ReportLocale;
  prospect: DraftProspect;
  checks: AuditChecks | null;
  flags: Flag[];
  top: CheckKey[];
  score: number | null;
  grade: "A" | "B" | "C" | null;
  fits: FitSuggestion[];
  reportUrl: string;
  /** Sign-off, default "Radu — Digital M" (OUTREACH_FROM_NAME at the call site). */
  signature?: string;
}

export interface DraftFields {
  subject: string;
  body: string;
  callScript: string;
  noteForOwner: string;
}

/** Length caps, shared by the zod schema, the templates and the panel. */
export const DRAFT_CAPS = {
  subject: { min: 8, max: 80 },
  body: { min: 200, max: 1400 },
  callScript: { min: 100, max: 700 },
  noteForOwner: { min: 40, max: 500 },
} as const;

export const DEFAULT_SIGNATURE = "Radu — Digital M";

// ---- names --------------------------------------------------------------------------

function tokensOf(s: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!s) return out;
  for (const t of s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().split(/[^A-Z]+/)) {
    if (t.length >= 3) out.add(t);
  }
  return out;
}

const clean = (s: string | null | undefined): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

/**
 * The name a prospect is addressed by. Companies: enseigne, else name. Sole
 * traders (sole_trader = 1): the enseigne only when no token (≥ 3 letters) of
 * the legal name appears in it — "MARTIN PLOMBERIE" vs "PAUL MARTIN" is
 * generic, "LE FOURNIL" is kept — so a personal name never reaches the model,
 * the subject or the report title.
 */
export function safeDisplayName(
  p: { enseigne?: string | null; legalName?: string | null; name?: string | null; soleTrader?: boolean | null },
  locale: ReportLocale,
): string {
  const enseigne = clean(p.enseigne);
  const name = clean(p.name);
  const legal = clean(p.legalName);
  const generic = GENERIC_BUSINESS[locale];
  if (p.soleTrader !== true) return enseigne || name || generic;
  // For a sole trader the plain `name` may be the person: use it only when it
  // differs from the legal name, then apply the same token test.
  const candidate = enseigne || (name && name.toUpperCase() !== legal.toUpperCase() ? name : "");
  if (!candidate) return generic;
  const personal = tokensOf(legal);
  if (!personal.size) return candidate;
  for (const t of tokensOf(candidate)) if (personal.has(t)) return generic;
  return candidate;
}

export function isGenericName(name: string, locale: ReportLocale): boolean {
  return name.trim().toLowerCase() === GENERIC_BUSINESS[locale].toLowerCase();
}

// ---- helpers ------------------------------------------------------------------------------

/** Trim to `max` characters on a word boundary with an ellipsis (last resort only). */
export function fitLength(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

function callerName(signature: string): string {
  return signature.split(/\s[—–-]\s/)[0]?.trim() || signature;
}

const PHONE_SOURCE_WORDS: Record<PhoneSource | "unknown", { fr: string; en: string }> = {
  website: { fr: "sur votre site internet", en: "on your website" },
  osm: { fr: "sur OpenStreetMap", en: "on OpenStreetMap" },
  fr_register: { fr: "dans l'annuaire des entreprises", en: "in the French business register" },
  companies_house: { fr: "dans le registre Companies House", en: "at Companies House" },
  google: { fr: "dans vos coordonnées publiques", en: "in your public listing" },
  manual: { fr: "dans vos coordonnées publiques", en: "in your public listing" },
  unknown: { fr: "dans vos coordonnées publiques", en: "in your public listing" },
};

// ---- subject ---------------------------------------------------------------------------------

/** "Votre présence en ligne : {business}" — the generic name is replaced by trade + town when known. */
export function draftSubject(input: DraftInput): string {
  const { locale, prospect } = input;
  let who = prospect.displayName;
  if (isGenericName(who, locale)) {
    const bits = [prospect.trade, prospect.town].filter((x): x is string => !!x);
    if (bits.length === 2) who = locale === "fr" ? `${bits[0]} à ${bits[1]}` : `${bits[0]} in ${bits[1]}`;
    else if (bits.length === 1) who = bits[0]!;
    else return locale === "fr" ? "Votre présence en ligne" : "Your online presence";
  }
  return fitLength(locale === "fr" ? `Votre présence en ligne : ${who}` : `Your online presence: ${who}`, DRAFT_CAPS.subject.max);
}

// ---- email body -----------------------------------------------------------------------------------

function bodyFr(input: DraftInput, findingsCount: number): string {
  const { prospect, reportUrl, flags } = input;
  const where = prospect.town ? ` à ${prospect.town}` : "";
  const counts = checkCounts(input.checks);
  const findings = findingsInPlainWords(input.checks, flags, input.top, "fr").slice(0, findingsCount);
  const step = firstSteps(input.fits, flags, "fr")[0];
  const sig = input.signature || DEFAULT_SIGNATURE;

  const opening = flags.includes("no-site")
    ? `Nous n'avons pas trouvé de site internet pour ${prospect.displayName}${where}. Voici ce que cela change pour un client qui vous cherche en ligne, et ce que nous ferions en premier.`
    : counts.measured
      ? `Nous avons regardé le site de ${prospect.displayName}${where} : ${counts.pass} vérification${counts.pass > 1 ? "s" : ""} sur ${counts.measured} ${counts.pass > 1 ? "sont" : "est"} en place, ${counts.attention} mérite${counts.attention > 1 ? "nt" : ""} un coup d'œil.`
      : `Nous avons regardé la présence en ligne de ${prospect.displayName}${where}.`;

  const parts = ["Bonjour,", opening];
  if (findings.length) parts.push(`Les points qui comptent le plus :\n${findings.map((f) => `– ${f}`).join("\n")}`);
  else parts.push("Rien d'urgent : votre site est en bon état.");
  parts.push(`Le rapport complet tient sur une page : ${reportUrl}`);
  if (step) parts.push(`Ce que nous ferions en premier : ${step.label}. ${step.action}`);
  // States the real rule: one reminder after a week, then nothing (followUp() is that reminder).
  parts.push("Si cela vous parle, répondez à cet e-mail ou prenez rendez-vous depuis le rapport. Sans réponse de votre part, une seule relance dans une semaine, puis plus rien.");
  parts.push(sig);
  return parts.join("\n\n");
}

function bodyEn(input: DraftInput, findingsCount: number): string {
  const { prospect, reportUrl, flags } = input;
  const where = prospect.town ? ` in ${prospect.town}` : "";
  const counts = checkCounts(input.checks);
  const findings = findingsInPlainWords(input.checks, flags, input.top, "en").slice(0, findingsCount);
  const step = firstSteps(input.fits, flags, "en")[0];
  const sig = input.signature || DEFAULT_SIGNATURE;

  const opening = flags.includes("no-site")
    ? `We could not find a website for ${prospect.displayName}${where}. Here is what that changes for a customer looking for you online, and what we would do first.`
    : counts.measured
      ? `We looked at the website of ${prospect.displayName}${where}: ${counts.pass} of ${counts.measured} checks ${counts.pass === 1 ? "is" : "are"} in place, ${counts.attention} deserve${counts.attention === 1 ? "s" : ""} a look.`
      : `We looked at the online presence of ${prospect.displayName}${where}.`;

  const parts = ["Hello,", opening];
  if (findings.length) parts.push(`The points that matter most:\n${findings.map((f) => `– ${f}`).join("\n")}`);
  else parts.push("Nothing urgent: your site is in good shape.");
  parts.push(`The full report fits on one page: ${reportUrl}`);
  if (step) parts.push(`What we would do first: ${step.label}. ${step.action}`);
  parts.push("If this speaks to you, reply to this email or book a call from the report. If not, one reminder in a week, then nothing more.");
  parts.push(sig);
  return parts.join("\n\n");
}

/** The email body without the legal block, within DRAFT_CAPS.body, always containing the report URL. */
export function templateBody(input: DraftInput): string {
  const build = input.locale === "fr" ? bodyFr : bodyEn;
  // Shrink the findings list before ever truncating — the URL sits mid-body.
  for (const n of [3, 2, 1]) {
    const body = build(input, n);
    if (body.length <= DRAFT_CAPS.body.max) return body;
  }
  return fitLength(build(input, 1), DRAFT_CAPS.body.max);
}

// ---- call script ------------------------------------------------------------------------------------------

/** Opens with who we are, where the number came from, why we call, and "you can refuse, I note it now". */
export function templateCallScript(input: DraftInput): string {
  const { locale, prospect } = input;
  const caller = callerName(input.signature || DEFAULT_SIGNATURE);
  const source = PHONE_SOURCE_WORDS[prospect.phoneSource ?? "unknown"][locale];
  const first = topFindings(input.checks, input.flags, input.top, locale)[0];
  const script =
    locale === "fr"
      ? [
          `Bonjour, ${caller} de Digital M, une petite agence web et IA basée en Ariège.`,
          `J'ai trouvé votre numéro ${source}.`,
          `Je vous appelle parce que nous avons regardé la présence en ligne de ${prospect.displayName}${first ? ` : ${first.text.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())}` : ""}.`,
          "Vous pouvez refuser cet appel : je le note tout de suite et je ne vous rappellerai pas.",
          "Sinon, je vous envoie le rapport d'une page par e-mail, sans engagement, et vous décidez ensuite. Avez-vous deux minutes ?",
        ]
      : [
          `Hello, this is ${caller} from Digital M, a small web and AI studio in the south of France.`,
          `I found your number ${source}.`,
          `I am calling because we looked at the online presence of ${prospect.displayName}${first ? `: ${first.text.replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase())}` : ""}.`,
          "You can refuse this call: I will note it right now and will not call again.",
          "Otherwise I can email you the one-page report, no strings attached, and you decide from there. Do you have two minutes?",
        ];
  return fitLength(script.join(" "), DRAFT_CAPS.callScript.max);
}

// ---- note for the owner (admin side, English) --------------------------------------------------------------------

export function templateNote(input: DraftInput): string {
  const counts = checkCounts(input.checks);
  const first = topFindings(input.checks, input.flags, input.top, "en")[0];
  const step = firstSteps(input.fits, input.flags, "en")[0];
  const bits = [
    input.score === null ? "No score." : `Score ${input.score}/100${input.grade ? ` (grade ${input.grade})` : ""}, ${counts.attention} of ${counts.measured} checks need attention.`,
    first ? `Lead with: ${first.name.toLowerCase()}.` : "Nothing urgent to lead with.",
    step ? `Suggested package: ${step.label}.` : "No package suggested.",
    input.prospect.soleTrader === true ? "Sole trader: personal name kept out of the draft; the notice paragraph is added at send time." : "",
    "Template draft (no model) — edit before sending.",
  ].filter(Boolean);
  return fitLength(bits.join(" "), DRAFT_CAPS.noteForOwner.max);
}

// ---- the four fields ---------------------------------------------------------------------------------------------------

export function templateDraft(input: DraftInput): DraftFields {
  return {
    subject: draftSubject(input),
    body: templateBody(input),
    callScript: templateCallScript(input),
    noteForOwner: templateNote(input),
  };
}

// ---- 7-day follow-up --------------------------------------------------------------------------------------------------------

/** Short follow-up body (no legal block; outreach appends it). `reportUrl` adds one line when given. */
export function followUp(locale: ReportLocale, opts: { reportUrl?: string | null; signature?: string } = {}): string {
  const sig = opts.signature || DEFAULT_SIGNATURE;
  const parts =
    locale === "fr"
      ? [
          "Bonjour,",
          "Une relance rapide : je vous ai envoyé la semaine dernière un rapport d'une page sur votre présence en ligne. Si le sujet n'est pas d'actualité, aucun souci — c'est mon dernier message.",
          opts.reportUrl ? `Le rapport reste consultable ici : ${opts.reportUrl}` : "",
          "Si vous souhaitez en parler, répondez simplement à cet e-mail.",
          `Bonne journée,\n${sig}`,
        ]
      : [
          "Hello,",
          "A quick follow-up: last week I sent you a one-page report on your online presence. If it is not the right time, no problem — this is my last message.",
          opts.reportUrl ? `The report is still available here: ${opts.reportUrl}` : "",
          "If you would like to talk it through, just reply to this email.",
          `Best regards,\n${sig}`,
        ];
  return fitLength(parts.filter(Boolean).join("\n\n"), DRAFT_CAPS.body.max);
}

// ---- guards on model output -----------------------------------------------------------------------------------------------------

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export function containsEmail(s: string): boolean {
  return EMAIL_IN_TEXT.test(s);
}

/**
 * A run of 9+ digits with phone punctuation ("06 12 34 56 78", "+33 6…",
 * "(503) 555-0100"); prices and years pass. URLs are skipped first — the
 * report link's token may well contain a long run of digits.
 */
export function containsPhone(s: string): boolean {
  for (const run of s.replace(/https?:\/\/\S+/g, " ").match(/\+?\d[\d .()-]*\d/g) ?? []) {
    if (run.replace(/\D/g, "").length >= 9) return true;
  }
  return false;
}

export function containsBanned(s: string): string | null {
  const lower = s.toLowerCase();
  for (const w of BANNED_WORDS) if (lower.includes(w)) return w;
  return null;
}

/** Reason a model draft must be replaced by the template, or null when it may be used. */
export function looksUnsafe(fields: DraftFields): string | null {
  for (const [name, value] of Object.entries(fields)) {
    if (containsEmail(value)) return `${name}:email`;
    if (containsPhone(value)) return `${name}:phone`;
    const banned = containsBanned(value);
    if (banned) return `${name}:banned:${banned}`;
  }
  return null;
}

/** True when every field sits within DRAFT_CAPS (the template guarantees it; the model is checked). */
export function withinCaps(fields: DraftFields): boolean {
  return (Object.keys(DRAFT_CAPS) as (keyof typeof DRAFT_CAPS)[]).every((k) => {
    const n = fields[k].length;
    return n >= DRAFT_CAPS[k].min && n <= DRAFT_CAPS[k].max;
  });
}
