// The lead page's view model (docs/lead-page-spec.md). Runs on the server and
// hands the client component plain data — strings, numbers, booleans — so the
// page can never re-derive a fact a different way than the lead e-mail did.
//
// Three rules from the spec run through this file:
//  1. The page never contradicts the e-mail: the place comes from leadPlace(),
//     the number from checkPostedPhone(), and the service names, the price
//     band and every answer label come from lib/diagnostic/answers.ts — the
//     one copy of those tables, which the lead e-mail reads too.
//  2. A column is not a fact. `leads.country` is the key hashPhone() normalises
//     with; it is never evidence and never reaches leadPlace(). leadWhere()'s
//     type makes passing it impossible.
//  3. Nothing disappears. Empty is a short sentence, never a dash.
//
// Pure apart from the two helper modules it reads (mail.ts, phone.ts): no DB,
// no React, relative imports with .ts so `node --test` loads it.
import { SALE_FACT_IDS, answerEntries, heardAbout, ownWords, priceFitFor, proposedLabel, saleFacts } from "../diagnostic/answers.ts";
import { checkPostedPhone, countryFor, countryFromE164 } from "../phone.ts";
import { leadPlace, mailtoAddress, replyLink, splitReplyDraft, type Prefill } from "../mail.ts";
import { attributionLabel, type Attribution } from "../attribution.ts";
import { safeHttpUrl } from "../crm/classify.ts";
import { sqlToMs } from "../crm/time.ts";
import type { Activity, Lead, LeadKind, LeadStage } from "../crm/types.ts";
import type { EnquirySummary, ProspectSummary } from "./leads.ts";
import { DATE_RE, KIND_LABELS, STAGE_LABELS, STAGE_TONE, dueWords, fmtDate, fmtDateTime, leadTitle, parisToday, type Tone } from "./stages.ts";

// ---- the number ------------------------------------------------------------------

export type PhoneState =
  | { kind: "dialable"; e164: string; display: string; href: string; note: null; repair: null; repairNote: null }
  // `repair` is what gets written (E.164); `repairDisplay` is the same number
  // spelled the way the button offers it, so the note left on the timeline
  // reads "+1 418 717 2114" and not the digits the column stores.
  | { kind: "unusable"; stored: string; note: string; repair: string | null; repairDisplay: string | null; repairNote: string | null }
  | { kind: "none"; note: string };

/** "+18732557953" → "+1 873 255 7953"; "+33780030320" → "+33 7 80 03 03 20". */
function prettyPhone(e164: string): string {
  if (/^\+1\d{10}$/.test(e164)) return `+1 ${e164.slice(2, 5)} ${e164.slice(5, 8)} ${e164.slice(8)}`;
  if (/^\+33\d{9}$/.test(e164)) return `+33 ${e164.slice(3, 4)} ${e164.slice(4).replace(/(\d{2})(?=\d)/g, "$1 ")}`;
  return e164;
}

/**
 * A North American number wearing the wrong country code. Jojo's row reads
 * "+33 4187172114": ten digits that France cannot dial and Quebec can. Offered,
 * never applied — the page asks before it writes.
 */
function nanpCandidate(stored: string): string | null {
  const raw = stored.trim();
  const digits = raw.replace(/\D/g, "");
  // Two readings: the digits as they stand, and the digits once the country
  // code they are wearing is taken off ("+33 4187172114" → "4187172114").
  const readings = new Set<string>([digits]);
  const dial = /^\+(\d{1,3})/.exec(raw);
  if (dial) readings.add(digits.slice(dial[1]!.length));
  for (const d of readings) {
    const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d.length === 10 ? d : null;
    if (!ten || !/^[2-9]\d{2}[2-9]\d{2}\d{4}$/.test(ten)) continue;
    const candidate = `+1${ten}`;
    if (checkPostedPhone(candidate)) return candidate;
  }
  return null;
}

/** The three states of §3, shared by the reach strip and the quick actions. */
export function phoneState(phone: string | null | undefined): PhoneState {
  const stored = String(phone ?? "").trim();
  if (!stored) return { kind: "none", note: "no number — e-mail only" };
  const e164 = checkPostedPhone(stored);
  if (e164) {
    const display = prettyPhone(e164);
    return { kind: "dialable", e164, display, href: `tel:${e164}`, note: null, repair: null, repairNote: null };
  }
  const repair = nanpCandidate(stored);
  const repairDisplay = repair ? prettyPhone(repair) : null;
  let repairNote: string | null = null;
  if (repair) {
    const area = repair.slice(2, 5);
    const place = leadPlace({ phone: repair });
    const where = place ? place.split(",")[0]!.trim() : null;
    repairNote = where
      ? `${area} is ${where} — set this number to ${repairDisplay}?`
      : `set this number to ${repairDisplay}?`;
  }
  return { kind: "unusable", stored, note: "cannot be dialled as stored — ask for it in your reply", repair, repairDisplay, repairNote };
}

// ---- where they are --------------------------------------------------------------

/**
 * The dial code as Radu would read it: "+33", or "+1 873" when the area code
 * names the place. Null when the code is not one of the countries phone.ts
 * carries — the old fallback sliced the first two digits and printed "+22" for
 * a Senegalese "+221" number, a dial code that names the wrong country.
 */
function dialWords(e164: string): string | null {
  const iso = countryFromE164(e164);
  const dial = iso ? (countryFor(iso)?.dial ?? null) : null;
  if (dial === "+1" && /^\+1\d{10}$/.test(e164)) return `+1 ${e164.slice(2, 5)}`;
  return dial;
}

/**
 * The evidence the page is allowed to read. `leads.country` is deliberately
 * absent: insertLead() falls back to the page language whenever the number
 * carries no dial code, which is exactly how three Quebec leads were filed as
 * French. Only the browser's own hint may name a country here.
 */
export interface WhereEvidence {
  phone: string | null;
  browserCountry: string | null;
}

export interface WhereResult {
  text: string;
  reason: string | null;
  second: string | null;
  known: boolean;
}

let regionNames: Intl.DisplayNames | null = null;
const NOT_A_COUNTRY = new Set(["ZZ", "QO", "EU", "UN"]);

/**
 * A country's name in English, never its two-letter code. phone.ts carries 32
 * countries — its words win, so "AE" reads "UAE" here exactly as it does in the
 * picker — and everywhere else the browser's own region table names it, so a
 * visitor from Senegal reads "Senegal" and not "SN". A code no table knows is
 * not a fact, so it comes back null and the page falls through to the next
 * piece of evidence.
 */
function countryName(iso: string | null | undefined): string | null {
  const code = String(iso ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  const known = countryFor(code)?.name;
  if (known) return known;
  // ZZ and QO are CLDR's own words for "we do not know" and "somewhere in the
  // ocean"; neither is a place to send Radu.
  if (NOT_A_COUNTRY.has(code)) return null;
  try {
    // fallback "none" so an invented code comes back undefined instead of
    // echoing itself, which is how the code reached the screen.
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
    const name = regionNames.of(code);
    return name && name.toUpperCase() !== code ? name : null;
  } catch {
    return null;
  }
}

/** Where this lead is, and why, in the same breath. Never a bare country code. */
export function leadWhere(e: WhereEvidence): WhereResult {
  const state = phoneState(e.phone);
  const hint = countryName(e.browserCountry);
  if (state.kind === "dialable") {
    const place = leadPlace({ phone: state.e164 });
    const dial = dialWords(state.e164);
    if (place) {
      const disagrees = hint && !place.toLowerCase().includes(hint.toLowerCase());
      return {
        text: place,
        reason: dial ? `from the ${dial} number` : "from the number they gave",
        second: disagrees ? `their browser said ${hint}` : null,
        known: true,
      };
    }
    // The number dials — the Call cell beside this one is a working tel: link —
    // but its country code is outside the list phone.ts carries, so nothing on
    // the row may name a country. Saying "no usable number" here would deny
    // what the cell 40 px to the left just proved.
    if (!hint) {
      return { text: "Not known", reason: "the number dials, but its country code is not one we know", second: null, known: false };
    }
    return { text: hint, reason: "from what their browser reported", second: "the number does not say which country", known: true };
  }
  // §6's order of trust: the number first, then the browser's own hint. A hint
  // beats digits that cannot be dialled — it is evidence and they are not —
  // and the second line says the digits were no help, so the two cells agree.
  // (§6's closing paragraph reads "Not proven" here; that is the case below,
  // where there is no hint either. Flagged for the integrator.)
  if (hint) {
    return {
      text: hint,
      reason: "from what their browser reported",
      second: state.kind === "unusable" ? "the number they typed cannot be used" : null,
      known: true,
    };
  }
  if (state.kind === "unusable") {
    return { text: "Not proven", reason: "the number they typed cannot be used", second: null, known: false };
  }
  return { text: "Not known", reason: "no usable number and the browser did not say", second: null, known: false };
}


/** One line for the reach strip: "Quebec, Canada — from the +1 873 number". */
export function whereLine(w: WhereResult): string {
  return w.reason ? `${w.text} — ${w.reason}` : w.text;
}

// ---- where the lead came from ----------------------------------------------------

/** The last six characters of an ad id, prefixed. The live ads share their first eight. */
export function shortAdId(adId: string): string {
  const id = String(adId ?? "").trim();
  return id.length > 6 ? `…${id.slice(-6)}` : id;
}

const CHANNEL_NAME: Record<string, string> = {
  chatgpt: "ChatGPT",
  openai: "ChatGPT",
  google: "Google",
  facebook: "Meta",
  meta: "Meta",
  instagram: "Meta",
  linkedin: "LinkedIn",
  bing: "Bing",
};

const PLACE_WORDS: Record<string, string> = {
  fr: "France",
  france: "France",
  ca: "Canada",
  canada: "Canada",
  qc: "Quebec",
  quebec: "Quebec",
  be: "Belgium",
  belgique: "Belgium",
  ch: "Switzerland",
  suisse: "Switzerland",
  uk: "United Kingdom",
  gb: "United Kingdom",
  us: "United States",
  usa: "United States",
};

const DID: Record<string, string> = {
  diagnostic: "filled the check-up",
  booking: "filled the check-up",
  contact: "sent the contact form",
  chat: "used the site chat",
  messenger: "wrote on Messenger",
  outreach: "answered our e-mail",
  manual: "was added by hand",
};

export interface AttributionContext {
  name: string;
  kind: LeadKind;
  /** A booking that followed the check-up within the hour. */
  booked: boolean;
  /** The derived place, or null when it is not known. */
  where: string | null;
  adCount: number;
  total: number;
}

/**
 * One sentence, built on read. Never prints the click id, the tracking keys or
 * a key=value pair — a test asserts it. Returns null when there is no
 * attribution JSON, so the caller falls back to the stored source label.
 */
export function attributionSentence(a: Attribution | null, ctx: AttributionContext): string | null {
  if (!a || Object.keys(a).length === 0) return null;
  const src = (a.utm_source ?? "").toLowerCase();
  const channel = a.oppref ? "ChatGPT" : (CHANNEL_NAME[src] ?? (src ? src.charAt(0).toUpperCase() + src.slice(1) : "an ad network"));
  const paid = /^(cpc|ppc|paid|paidsearch|paid_social)$/.test((a.utm_medium ?? "").toLowerCase());
  const name = ctx.name || "They";
  const did = ctx.booked ? "clicked it, filled the check-up, then booked a call a minute later" : `clicked it and ${DID[ctx.kind] ?? "came through"}`;
  const parts = [`${paid ? "Paid" : "Unpaid"} ad on ${channel}.`, `${name} ${did}.`];

  const campaign = (a.utm_campaign ?? "").trim();
  if (campaign) {
    const words = campaign
      .toLowerCase()
      .split(/[^a-z]+/)
      .map((w) => PLACE_WORDS[w])
      .filter((w): w is string => !!w);
    const agrees = !!ctx.where && words.some((w) => ctx.where!.toLowerCase().includes(w.toLowerCase()));
    const clause = words.length && !agrees ? ` — that is the ad's name, not where ${name} is` : "";
    parts.push(`Campaign "${campaign}"${clause}.`);
  }
  const ad = (a.utm_content ?? "").trim();
  if (ad) parts.push(`Ad ${shortAdId(ad)} (${ctx.adCount} of your ${ctx.total} leads).`);
  return parts.join(" ");
}

/** What the customer said when we asked, and whether it agrees with the click. */
export function heardAboutLine(name: string, answers: Record<string, unknown>, fromAd: boolean): string | null {
  const heard = heardAbout(answers);
  const who = name || "They";
  if (!heard) return `${who} did not answer how they heard about you.`;
  if (heard.id === "other") {
    if (!heard.other) return `${who} chose "Something else" and did not say what.`;
    if (/chat\s*gpt|openai/i.test(heard.other)) return `${who} said they found you through ChatGPT — that matches.`;
    return `${who} said they found you through "${heard.other}".`;
  }
  const said = `${who} said they heard about you through ${heard.label.toLowerCase()}`;
  return fromAd ? `${said} — that does not match the ad click.` : `${said}.`;
}

export interface CampaignLeadRow {
  reference: string;
  phone: string | null;
  browserCountry: string | null;
  attribution: Attribution | null;
}

/** "Campaign "fr-france": 5 leads so far — 1 in France, 1 in Quebec, 3 we cannot place." */
export function campaignRollup(campaign: string, rows: CampaignLeadRow[]): string | null {
  if (!campaign || rows.length === 0) return null;
  const counts = new Map<string, number>();
  let unknown = 0;
  for (const r of rows) {
    const w = leadWhere({ phone: r.phone, browserCountry: r.browserCountry });
    if (!w.known) {
      unknown += 1;
      continue;
    }
    const key = w.text.split(",")[0]!.trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const bits = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} in ${k}`);
  if (unknown) bits.push(`${unknown} we cannot place`);
  return `Campaign "${campaign}": ${rows.length} ${rows.length === 1 ? "lead" : "leads"} so far — ${bits.join(", ")}.`;
}

// ---- the ready reply -------------------------------------------------------------

// The link the page opens is the link the lead e-mail offers: one builder,
// exported from mail.ts, called here with the same 6,000-character ceiling the
// HTML e-mail uses. A second copy is how a page comes to open half a reply.
export { replyLink as replyMailto };
export type { Prefill };

/** The three labels the e-mail uses, so the button never promises what it cannot do. */
export function sendLabel(prefill: Prefill): string {
  if (prefill === "full") return "Send in one tap";
  if (prefill === "long") return "Open a reply (the draft is above, too long to pre-fill)";
  return "Open a reply (the draft above is a subject line only)";
}

// ---- small words -----------------------------------------------------------------

const DATA_SOURCE_WORDS: Record<string, string> = {
  form: "a form on the site",
  chat: "the site chat",
  messenger: "Messenger",
  booking: "the booking form",
  register: "the French company register",
  osm: "the open map",
  companies_house: "the UK company register",
  website: "their own website",
  manual: "added by hand",
};

const LEGAL_BASIS_WORDS: Record<string, string> = { request: "Their request", legitimate_interest: "Legitimate interest" };

/**
 * How a lead arrived, as the middle of a sentence ("came from the contact
 * form"). KIND_LABELS holds the same seven kinds as column headings ("Contact
 * form", "Messenger"); lower-casing those mid-sentence would print "came from
 * messenger", so the badge reads its words here and Details prints the label.
 */
const KIND_ORIGIN: Record<string, string> = {
  diagnostic: "the check-up",
  booking: "the booking form",
  contact: "the contact form",
  chat: "the site chat",
  messenger: "Messenger",
  outreach: "our outreach",
  manual: "a manual entry",
};

const MAIL_STATUS_WORDS: Record<string, string> = {
  sent: "the triage e-mail went out",
  failed: "The triage e-mail failed to send — the lead was saved anyway.",
  skipped: "no triage e-mail was sent",
};

/**
 * A YYYY-MM-DD that is a real day. /api/admin/leads/[id] checks the shape and
 * nothing else, so "2026-13-45" is stored happily; every date helper turns it
 * into NaN, and NaN reaches the screen as words or throws inside a click.
 */
export function readableDate(value: string | null | undefined): boolean {
  const v = String(value ?? "").trim();
  return DATE_RE.test(v) && Number.isFinite(Date.parse(`${v}T12:00:00Z`));
}

/** "arrived 4 days ago" / "arrived 14 h ago". */
export function arrivedAgo(createdAt: string, now: Date): string {
  const ms = sqlToMs(createdAt);
  if (ms === null) return "arrived at an unknown time";
  const hours = Math.max(0, Math.floor((now.getTime() - ms) / 3_600_000));
  if (hours < 1) return "arrived just now";
  if (hours < 48) return `arrived ${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `arrived ${days} days ago`;
}

// ---- the view model --------------------------------------------------------------

export interface Highlight {
  text: string;
  tone: Tone | null;
  title?: string;
}

export interface DetailRow {
  label: string;
  value: string;
  /** Shown with a copy button and wrapped mid-token. */
  copy?: boolean;
  caption?: string;
  href?: string;
}

export interface DetailSection {
  title: string;
  rows: DetailRow[];
}

export interface RelatedRow {
  label: string;
  value: string;
  href?: string;
  external?: boolean;
}

export interface LeadView {
  id: number;
  reference: string;
  /** The linked prospect, for the two outreach tools in Details. Null for inbound leads. */
  prospectId: number | null;
  title: string;
  name: string | null;
  company: string | null;
  stage: LeadStage;
  stageLabel: string;
  stageTone: Tone;
  stopped: boolean;
  stopNote: string | null;
  highlights: Highlight[];
  reach: {
    email: string | null;
    emailHref: string | null;
    emailNote: string | null;
    phone: PhoneState;
    where: string;
    whereSecond: string | null;
  };
  words: {
    quotes: { label: string; text: string }[];
    empty: string | null;
    inbound: { label: string; text: string } | null;
  };
  /** A check-up row was found. Without one, §10: the facts, propose, reply and ask blocks do not render. */
  checkup: boolean;
  facts: { rows: { label: string; value: string; href: string | null }[] | null; note: string | null } | null;
  propose: { lines: string | null; price: string | null; why: string | null; noFit: string | null; note: string | null } | null;
  reply: { subject: string; body: string; href: string; label: string; note: string | null } | null;
  ask: { questions: string[]; unknowns: string | null } | null;
  upcoming: { action: string; date: string | null; when: string | null; overdue: boolean } | null;
  related: RelatedRow[];
  details: DetailSection[];
  origin: { sentence: string | null; heard: string | null; rollup: string | null };
}

export interface LeadViewInput {
  lead: Lead & { ip?: string | null; browserCountry?: string | null; browserTz?: string | null };
  enquiry: EnquirySummary | null;
  prospect: ProspectSummary | null;
  activities: Activity[];
  /** Every lead on the same campaign, for the roll-up line and the ad count. */
  campaignRows?: CampaignLeadRow[];
  now?: Date;
}

/** True when a booking followed the check-up within the hour (Jojo's row). */
function bookedAfterCheckup(activities: Activity[]): boolean {
  const created = activities.find((a) => a.kind === "lead_created");
  const merged = activities.find((a) => a.kind === "merged");
  if (!created || !merged) return false;
  const a = sqlToMs(created.createdAt);
  const b = sqlToMs(merged.createdAt);
  return a !== null && b !== null && b >= a && b - a <= 3_600_000;
}

export function buildLeadView(input: LeadViewInput): LeadView {
  const { lead, enquiry, prospect, activities } = input;
  const now = input.now ?? new Date();
  const answers = enquiry?.answers ?? null;
  const answersBroken = enquiry?.answersBroken ?? false;
  const firstName = (lead.name ?? "").trim().split(/\s+/)[0] ?? "";

  // ---- highlights
  const highlights: Highlight[] = [];
  if (enquiry) {
    highlights.push({ text: `Grade ${enquiry.grade}`, tone: enquiry.grade === "A" ? "good" : enquiry.grade === "B" ? "info" : "neutral" });
    if (enquiry.urgent) highlights.push({ text: "URGENT", tone: "bad" });
    const lines = proposedLabel(enquiry.proposed);
    if (lines) highlights.push({ text: lines, tone: null });
    const facts = answers ? saleFacts(answers) : null;
    const budget = facts?.find((f) => f.label === "Budget")?.value ?? "not stated";
    highlights.push({ text: budget === "not stated" ? "budget not stated" : budget, tone: null });
    const start = facts?.find((f) => f.label === "Wants to start")?.value ?? "not stated";
    highlights.push({ text: start === "not stated" ? "start not stated" : start, tone: null });
  } else if (lead.enquiryReference) {
    highlights.push({ text: `Check-up ${lead.enquiryReference} is no longer in the database`, tone: "warn" });
  } else if (lead.kind === "diagnostic") {
    highlights.push({ text: "No check-up on file", tone: "neutral" });
  } else {
    highlights.push({ text: `No check-up — came from ${KIND_ORIGIN[lead.kind] ?? "somewhere else"}`, tone: "neutral" });
  }
  highlights.push({ text: STAGE_LABELS[lead.stage], tone: STAGE_TONE[lead.stage] });
  highlights.push({ text: arrivedAgo(lead.createdAt, now), tone: null });

  // ---- reach
  const phone = phoneState(lead.phone);
  const where = leadWhere({ phone: lead.phone, browserCountry: lead.browserCountry ?? enquiry?.browserCountry ?? null });
  // "call them" only when there is a number that dials: the cell beside this
  // one already says the stored digits cannot be used, and two cells must not
  // send Radu in opposite directions.
  const emailNote = lead.email
    ? null
    : phone.kind === "none"
      ? "no address and no number on file"
      : phone.kind === "unusable"
        ? "no address on file — and the number cannot be dialled"
        : "no address on file — call them";

  // ---- their own words
  const quotes = answers ? ownWords(answers) : [];
  const inboundKinds: LeadKind[] = ["contact", "chat", "booking", "messenger"];
  const inbound = lead.note && inboundKinds.includes(lead.kind) ? { label: "What they sent us", text: lead.note } : null;
  const wordsEmpty =
    quotes.length === 0 && !inbound
      ? answersBroken
        ? "The saved answers could not be read, so their own words are not available here."
        : enquiry
          ? "They typed nothing in their own words — the facts below are all we have."
          : "They left no message — the record below is all we have."
      : null;

  // ---- the facts
  //
  // §10: with no check-up behind the lead there is nothing to print here, so
  // the block does not render at all — the highlight strip and Related already
  // say where the lead came from and that its check-up is gone. `facts: null`
  // is that instruction to the component.
  let factRows: { label: string; value: string; href: string | null }[] | null = null;
  let factNote: string | null = null;
  if (enquiry) {
    if (answersBroken || !answers) factNote = "The saved answers could not be read — the check-up reference below still opens the record.";
    else
      factRows = saleFacts(answers).map((f) => ({
        label: f.label,
        value: f.value,
        href: f.label === "Website" ? safeHttpUrl(f.value) : null,
      }));
  }

  // ---- what to propose
  const propose = enquiry
    ? {
        lines: proposedLabel(enquiry.proposed) || null,
        price: priceFitFor(answers ? String(answers.budget ?? "") : ""),
        why: enquiry.noteForRadu,
        noFit: enquiry.noFit,
        note: enquiry.noteForRadu ? null : "The AI triage did not answer — the lines and the grade above are rule-based only.",
      }
    : null;

  // ---- the ready reply
  const checkupSubject =
    lead.locale === "fr" ? `Votre check-up numérique (${enquiry?.reference ?? lead.reference})` : `Your digital check-up (${enquiry?.reference ?? lead.reference})`;
  let reply: LeadView["reply"] = null;
  if (enquiry?.replyDraft) {
    const split = splitReplyDraft(enquiry.replyDraft, checkupSubject);
    const link = lead.email ? replyLink(lead.email, split) : { href: "", prefill: "none" as Prefill };
    reply = {
      subject: split.subject,
      body: split.body,
      href: link.href,
      label: lead.email ? sendLabel(link.prefill) : "No address to send to",
      note: lead.email ? null : "No address on file — call them instead.",
    };
  }

  // ---- ask them
  const ask =
    enquiry && ((enquiry.callQuestions && enquiry.callQuestions.length > 0) || enquiry.unknowns)
      ? { questions: enquiry.callQuestions ?? [], unknowns: enquiry.unknowns }
      : null;

  // ---- upcoming
  //
  // dueWords() is the one place the follow-up date is turned into words, so the
  // chips, the Today page and this line cannot drift apart. A stored date that
  // passes DATE_RE but is not a real day ("2026-13-45" — the route only checks
  // the shape) is read as unusable: it printed "NaN days ago" and made the
  // +2 days chip throw inside the click handler, writing nothing and saying
  // nothing.
  let upcoming: LeadView["upcoming"] = null;
  if (lead.nextAction || lead.nextActionAt) {
    const stored = lead.nextActionAt;
    const usable = !!stored && readableDate(stored);
    const due = usable ? dueWords(stored, parisToday(now)) : null;
    upcoming = {
      action: lead.nextAction ?? "Follow up",
      date: usable ? stored : null,
      when: due ? due.text : stored ? "the date saved for this step cannot be read" : null,
      overdue: due ? due.overdue : false,
    };
  }

  // ---- related
  const related: RelatedRow[] = [];
  if (enquiry) related.push({ label: "The check-up", value: `${enquiry.reference} · sent ${fmtDate(enquiry.createdAt)}` });
  else if (lead.enquiryReference) related.push({ label: "The check-up", value: `${lead.enquiryReference} — this check-up is no longer in the database` });
  if (prospect) {
    related.push({ label: "Prospect", value: `${prospect.reference} · ${prospect.name}`, href: `/admin/prospects/${prospect.id}` });
    if (prospect.latestAuditReference) {
      related.push({
        label: "Website audit",
        value: `${prospect.latestAuditReference}${typeof prospect.latestScore === "number" ? ` · ${prospect.latestScore}/100` : ""}`,
        href: prospect.latestReportToken ? `/r/${prospect.latestReportToken}` : undefined,
      });
    }
  }
  if (lead.kind === "booking" && lead.nextActionAt) related.push({ label: "Booked call", value: fmtDate(lead.nextActionAt) });

  // ---- where it came from
  const attribution = lead.attribution;
  const campaign = (attribution?.utm_campaign ?? "").trim();
  const adId = (attribution?.utm_content ?? "").trim();
  const campaignRows = input.campaignRows ?? [];
  const adCount = adId ? campaignRows.filter((r) => (r.attribution?.utm_content ?? "") === adId).length : 0;
  const sentence = attributionSentence(attribution, {
    name: firstName,
    kind: lead.kind,
    booked: lead.kind === "booking" && bookedAfterCheckup(activities),
    where: where.known ? where.text : null,
    adCount,
    total: campaignRows.length,
  });
  const heard = answers ? heardAboutLine(firstName, answers, !!attribution && Object.keys(attribution).length > 0) : null;
  const rollup = campaign ? campaignRollup(campaign, campaignRows) : null;

  // ---- details
  const details: DetailSection[] = [];
  if (answers && !answersBroken) {
    const rest = answerEntries(answers).filter((e) => !SALE_FACT_IDS.includes(e.id) && e.id !== "source" && e.id !== "source_other");
    if (rest.length) details.push({ title: "The rest of the check-up", rows: rest.map((e) => ({ label: e.label, value: e.value })) });
  }
  if (enquiry) {
    const scores = enquiry.scores
      ? Object.entries(enquiry.scores)
          .filter(([, v]) => v !== 0)
          .map(([k, v]) => `${k} ${v}`)
          .join(" · ")
      : "";
    details.push({
      title: "The check-up's own reading",
      rows: [
        { label: "Rule scores", value: scores || "nothing scored" },
        { label: "Urgent", value: enquiry.urgent ? "yes" : "no" },
        { label: "Spam check", value: enquiry.flagged ? "skipped — the checker was down" : "passed" },
        { label: "Triage e-mail", value: MAIL_STATUS_WORDS[enquiry.mailStatus ?? "skipped"] ?? "no triage e-mail was sent" },
      ],
    });
  }
  const timeZone = lead.browserTz ?? enquiry?.browserTz ?? null;
  details.push({
    title: "The record",
    rows: [
      { label: "How it arrived", value: KIND_LABELS[lead.kind] },
      { label: "Language", value: lead.locale === "fr" ? "French" : "English" },
      { label: "Legal basis", value: LEGAL_BASIS_WORDS[lead.legalBasis] ?? "Their request" },
      { label: "Data from", value: DATA_SOURCE_WORDS[lead.dataSource] ?? "a form on the site" },
      { label: "Notice sent", value: lead.noticeSentAt ? fmtDateTime(lead.noticeSentAt) : "not sent" },
      { label: "Replied", value: lead.repliedAt ? fmtDateTime(lead.repliedAt) : "not yet" },
      {
        label: "Closed",
        value: lead.closedAt ? `${fmtDateTime(lead.closedAt)}${lead.closeReason ? ` (${STAGE_LABELS[lead.closeReason as LeadStage] ?? lead.closeReason})` : ""}` : "still open",
      },
      { label: "Last activity", value: fmtDateTime(lead.lastActivityAt) },
      { label: "Their address on the internet", value: lead.ip ?? enquiry?.ip ?? "not kept", copy: true },
      { label: "Country used to read the phone number", value: lead.country },
      ...(timeZone ? [{ label: "Their time zone", value: timeZone }] : []),
    ],
  });
  const originRows: DetailRow[] = [];
  if (attribution?.utm_source) originRows.push({ label: "Source", value: attribution.utm_source, copy: true });
  if (attribution?.utm_medium) originRows.push({ label: "Kind of click", value: attribution.utm_medium, copy: true });
  if (campaign) originRows.push({ label: "Campaign", value: campaign, copy: true });
  if (adId) originRows.push({ label: "Ad", value: adId, copy: true });
  if (attribution?.utm_term) originRows.push({ label: "Search term", value: attribution.utm_term, copy: true });
  if (attribution?.oppref)
    originRows.push({
      label: "Click id",
      value: attribution.oppref,
      copy: true,
      caption: "ChatGPT's click id — used once to tell ChatGPT this lead came from the ad",
    });
  if (!originRows.length && lead.sourceLabel) originRows.push({ label: "Came from", value: lead.sourceLabel });
  // The sentence above already says where it came from; these are the raw
  // values, kept for the day OpenAI support asks for one of them.
  if (originRows.length) details.push({ title: "The tracking values", rows: originRows });

  return {
    id: lead.id,
    reference: lead.reference,
    prospectId: lead.prospectId,
    title: lead.name || lead.company ? leadTitle(lead) : `Unnamed lead · ${lead.reference}`,
    name: lead.name,
    company: lead.company,
    stage: lead.stage,
    stageLabel: STAGE_LABELS[lead.stage],
    stageTone: STAGE_TONE[lead.stage],
    stopped: lead.stage === "stop",
    stopNote: lead.stage === "stop" ? "Asked not to be contacted — every way of reaching them is switched off here." : null,
    highlights,
    reach: {
      email: lead.email,
      emailHref: lead.email ? `mailto:${mailtoAddress(lead.email)}` : null,
      emailNote,
      phone,
      where: whereLine(where),
      whereSecond: where.second,
    },
    words: { quotes, empty: wordsEmpty, inbound },
    checkup: !!enquiry,
    facts: enquiry ? { rows: factRows, note: factNote } : null,
    propose,
    reply,
    ask,
    upcoming,
    related,
    details,
    origin: { sentence: sentence ?? (lead.sourceLabel ? `Came from ${lead.sourceLabel}.` : null), heard, rollup },
  };
}

/** The short label the list pages print; kept here so the page can reuse it. */
export function sourceWords(a: Attribution | null): string | null {
  return a ? attributionLabel(a) : null;
}
