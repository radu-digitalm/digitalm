import nodemailer from "nodemailer";
import dns from "node:dns/promises";
import net from "node:net";
import { checkPostedPhone, countryFor, countryFromE164 } from "./phone.ts";

const TO = process.env.CONTACT_FORM_TO || "contact@digitalm.eu";
const FROM_ADDR =
  process.env.CONTACT_FORM_FROM || process.env.SMTP_USER || "contact@digitalm.eu";
// Display name so inboxes show "Digital M", not a bare "contact".
const FROM = FROM_ADDR.includes("<") ? FROM_ADDR : `"Digital M" <${FROM_ADDR}>`;

/** True when SMTP credentials are present so mail can actually be sent. */
export function mailConfigured(): boolean {
  return !!process.env.SMTP_HOST;
}

// This server has no IPv6 egress, but smtp.gmail.com publishes an AAAA record.
// nodemailer resolves A + AAAA and picks one AT RANDOM (lib/shared: formatDNSValue),
// so ~half of all sends died with ENETUNREACH and were silently lost. Passing
// `family` doesn't help — SMTPConnection never forwards it to its resolver. So we
// resolve to IPv4 ourselves and give nodemailer a literal IP (which short-circuits
// its resolver), keeping `servername` so TLS still validates against the hostname.
let ipv4Cache: { ip: string; expires: number } | null = null;

async function ipv4For(host: string): Promise<string> {
  if (net.isIP(host)) return host;
  if (ipv4Cache && ipv4Cache.expires > Date.now()) return ipv4Cache.ip;
  const [ip] = await dns.resolve4(host);
  if (!ip) return host; // fall back to the hostname rather than fail outright
  ipv4Cache = { ip, expires: Date.now() + 5 * 60_000 };
  return ip;
}

async function transport() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === "true"
    : port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  let address = host;
  try {
    address = await ipv4For(host);
  } catch {
    /* DNS hiccup — let nodemailer try the hostname itself */
  }
  return nodemailer.createTransport({
    host: address,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
    tls: { servername: host },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  });
}

const RETRY_DELAYS_MS = [1_000, 5_000, 15_000];

// @@crm:outreach
// Additive extension (contract §3.9): outreach passes its own `from`, `replyTo`
// and `headers` (List-Unsubscribe), sends with `attempts: 1` (one manual send
// at a time; a retry loop would outlive nginx's read timeout and hide the
// result), gives the recipient as an `{ address }` object (no display name,
// no header injection) and reads the SMTP message id back. Every existing
// caller keeps today's behaviour: 4 attempts, the site From, a string `to`.
export interface SendMailOptions {
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  to?: string | { address: string };
  from?: string;
  headers?: Record<string, string>;
  /** Total attempts, default 4 (1 + the three retry delays). */
  attempts?: number;
}

/**
 * Send with retries. A transient network fault must never silently swallow a
 * lead again: we retry with backoff, drop the cached IP between attempts (in
 * case the address went bad), and rethrow so callers can record the failure.
 */
export async function sendMail(opts: SendMailOptions): Promise<{ messageId: string | null }> {
  let lastErr: unknown;
  const maxAttempts = Math.max(1, Math.min(opts.attempts ?? RETRY_DELAYS_MS.length + 1, RETRY_DELAYS_MS.length + 1));
  const to = typeof opts.to === "object" ? { address: opts.to.address, name: "" } : opts.to || TO;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const t = await transport();
      if (!t) throw new Error("SMTP not configured");
      const info = await t.sendMail({
        to,
        from: opts.from || FROM,
        replyTo: opts.replyTo,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
        headers: opts.headers,
      });
      if (attempt > 0) console.warn(`mail delivered on retry ${attempt}: ${opts.subject}`);
      return { messageId: typeof info?.messageId === "string" ? info.messageId : null };
    } catch (e) {
      lastErr = e;
      if (!mailConfigured()) throw e; // nothing to retry against
      ipv4Cache = null; // re-resolve; the cached address may be the bad one
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || attempt + 1 >= maxAttempts) break;
      console.warn(`mail attempt ${attempt + 1} failed (${(e as { code?: string }).code ?? e}), retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export { esc };

const esc = (s: string) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );

/** Build a branded notification email (text + HTML) for form/assistant enquiries. */
export function renderNotification(opts: {
  source: string;
  rows: [string, string][];
  body?: string;
}): { text: string; html: string } {
  const { source, rows, body } = opts;

  const text =
    `${source}\nNew enquiry — Digital M\n\n` +
    rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
    (body ? `\n\n${body}` : "");

  const rowsHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 16px 6px 0;color:#8b94a4;white-space:nowrap;vertical-align:top;">${esc(
          k,
        )}</td><td style="padding:6px 0;color:#0a0e16;">${esc(v)}</td></tr>`,
    )
    .join("");

  const html = `<div style="background:#f4f5f7;padding:24px;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e8ec;">
    <div style="height:4px;background:linear-gradient(115deg,#F15A24,#EE355E 52%,#ED1E79);"></div>
    <div style="padding:24px 28px;">
      <p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8b94a4;">${esc(
        source,
      )}</p>
      <h1 style="margin:0 0 18px;font-size:18px;color:#0a0e16;font-weight:600;">New enquiry — Digital M</h1>
      <table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5;">${rowsHtml}</table>
      ${
        body
          ? `<div style="margin-top:18px;padding-top:16px;border-top:1px solid #eef0f3;white-space:pre-wrap;font-size:14px;color:#222;line-height:1.6;">${esc(
              body,
            )}</div>`
          : ""
      }
      <p style="margin:22px 0 0;font-size:12px;color:#9aa3b2;">Sent from the Digital M website · digitalm.eu</p>
    </div>
  </div>
</div>`;

  return { text, html };
}

/** Client-facing branded email (ack, confirmations): message + optional CTA button. */
export function renderClientEmail(opts: {
  title: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  footnote?: string;
}): string {
  const { title, paragraphs, cta, footnote } = opts;
  const ps = paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#222;">${esc(p)}</p>`)
    .join("");
  return `<div style="background:#f4f5f7;padding:24px;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e8ec;">
    <div style="height:4px;background:linear-gradient(115deg,#F15A24,#EE355E 52%,#ED1E79);"></div>
    <div style="padding:28px 28px 24px;">
      <h1 style="margin:0 0 18px;font-size:20px;color:#0a0e16;font-weight:600;">${esc(title)}</h1>
      ${ps}
      ${
        cta
          ? `<p style="margin:22px 0;"><a href="${esc(cta.url)}" style="display:inline-block;background:linear-gradient(115deg,#F15A24,#EE355E 52%,#ED1E79);color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:10px;">${esc(cta.label)}</a></p>`
          : ""
      }
      ${footnote ? `<p style="margin:18px 0 0;font-size:12px;color:#9aa3b2;line-height:1.5;">${esc(footnote)}</p>` : ""}
      <p style="margin:22px 0 0;font-size:12px;color:#9aa3b2;">Digital M · <a href="https://digitalm.eu" style="color:#9aa3b2;">digitalm.eu</a></p>
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// The check-up lead notification
//
// Radu reads this on a phone, usually while doing something else, and has to
// decide one thing: do I call this person now? So the first screen carries who
// they are, where they are, how to reach them in one tap, and their own words.
// Everything a machine produced comes after that, and the noise (rule scores,
// urgency, IP, the full answer dump) sits at the very bottom under "The
// detail". renderNotification() above is untouched: the contact form, the chat
// and the booking notification keep using it exactly as they did.
// ---------------------------------------------------------------------------

export interface LeadMailFact {
  label: string;
  value: string;
}

export interface LeadMailInput {
  reference: string;
  grade: string;
  urgent?: boolean;
  flagged?: boolean;
  /** The language they wrote in. */
  locale: "fr" | "en";
  firstName: string;
  company?: string;
  email: string;
  /** The number as stored. Undialable values are reported, never printed as links. */
  phone?: string;
  /** "Quebec, Canada" — derived from the number or from the CRM lead row. */
  place?: string;
  /** Their own free text, highest signal first (magic wand, then anything else). */
  ownWords?: { label: string; text: string }[];
  /** The facts that decide the sale: trade, size, budget, start, decider, tools, site. */
  facts?: LeadMailFact[];
  propose?: {
    lines: string;
    why?: string;
    price?: string;
    /** The model's honest "nothing we sell fits this", with its reason. */
    noFit?: string;
  };
  callQuestions?: string[];
  unknowns?: string;
  /** The ready-to-send draft, already split into subject and body. */
  reply?: { subject: string; body: string };
  crmUrl?: string;
  /** The AI subject tail. Absent when the triage failed: the subject still works. */
  summary?: string;
  /** Every other answer, for the bottom of the message. */
  detail?: LeadMailFact[];
  /** Rule scores, urgency, IP, attribution: the machine noise, last. */
  diagnostics?: LeadMailFact[];
}

// Canadian area codes by province (NANP, 2026). Nearly all the paid traffic is
// from Quebec, and "Canada" alone does not tell Radu whether he is calling
// Montreal or Vancouver five time zones away.
//
// phone.ts keeps its own set of the same codes (CANADA_AREA_CODES, unexported)
// to tell CA from US. The two cannot contradict each other: this map is only
// consulted after countryFromE164 has already said CA, so a code phone.ts
// knows and this map does not simply reads "Canada" instead of "Quebec,
// Canada". Merging them means exporting from phone.ts, which belongs to
// another unit.
const CA_AREA_REGION: Record<string, string> = {
  "263": "Quebec", "354": "Quebec", "367": "Quebec", "418": "Quebec", "438": "Quebec",
  "450": "Quebec", "468": "Quebec", "514": "Quebec", "579": "Quebec", "581": "Quebec",
  "819": "Quebec", "873": "Quebec",
  "226": "Ontario", "249": "Ontario", "289": "Ontario", "343": "Ontario", "365": "Ontario",
  "382": "Ontario", "416": "Ontario", "437": "Ontario", "519": "Ontario", "548": "Ontario",
  "613": "Ontario", "647": "Ontario", "683": "Ontario", "705": "Ontario", "742": "Ontario",
  "753": "Ontario", "807": "Ontario", "905": "Ontario",
  "236": "British Columbia", "250": "British Columbia", "604": "British Columbia",
  "672": "British Columbia", "778": "British Columbia",
  "368": "Alberta", "403": "Alberta", "587": "Alberta", "780": "Alberta", "825": "Alberta",
  "204": "Manitoba", "431": "Manitoba", "584": "Manitoba",
  "306": "Saskatchewan", "474": "Saskatchewan", "639": "Saskatchewan",
  "428": "New Brunswick", "506": "New Brunswick",
  "709": "Newfoundland", "879": "Newfoundland",
  "782": "Nova Scotia / PEI", "902": "Nova Scotia / PEI",
  "867": "Yukon / NWT / Nunavut",
};

/** The dialable international form of a stored number, or null. */
export function dialable(phone: string | null | undefined): string | null {
  return checkPostedPhone(phone ?? "");
}

/**
 * Where this lead is, as far as the EVIDENCE goes: the dial code of the number
 * they typed first (it is the only thing the visitor typed that carries a
 * country), then a country the caller can vouch for — the one the browser
 * reported behind the phone field, for instance.
 *
 * `country` must never be the page language dressed up as a country, and in
 * particular never the CRM lead row's `country` column: `insertLead` falls back
 * to `countryForLocale(locale)` whenever the number carries no dial code, so
 * reading it back announces every French-speaking Quebec lead as French. When
 * there is no evidence this returns null and the email says so plainly, which
 * costs Radu nothing and misleads him about nothing.
 */
export function leadPlace(opts: { phone?: string | null; country?: string | null }): string | null {
  const e164 = dialable(opts.phone);
  const given = String(opts.country ?? "").trim();
  const iso = countryFromE164(e164) ?? (/^[A-Za-z]{2}$/.test(given) ? given.toUpperCase() : null);
  if (!iso) return null;
  const name = countryFor(iso)?.name ?? iso;
  if (e164 && /^\+1\d{10}$/.test(e164)) {
    const region = CA_AREA_REGION[e164.slice(2, 5)];
    if (region && iso === "CA") return `${region}, ${name}`;
  }
  return name;
}

/**
 * Split "Objet : ... \n\n body" off the draft so the reply can be sent with a
 * real subject. A draft that opens with no subject line keeps all its text.
 */
export function splitReplyDraft(draft: string, fallbackSubject: string): { subject: string; body: string } {
  const text = (draft ?? "").trim();
  const m = /^(?:objet|subject)\s*:\s*(.+?)\s*(?:\n|$)/i.exec(text);
  if (!m) return { subject: fallbackSubject, body: text };
  return { subject: m[1]!.trim() || fallbackSubject, body: text.slice(m[0].length).trim() };
}

/**
 * The address part of a mailto:. RFC 6068 wants a literal "@" in the addr-spec;
 * encodeURIComponent turns it into %40, so the link read
 * "mailto:jojo%40lechaudron.ca" while the HTML button right beside it used the
 * plain address - two links that disagree, one of which some clients balk at.
 * Everything that genuinely needs escaping still is.
 */
export function mailtoAddress(to: string): string {
  return encodeURIComponent(String(to).trim()).replace(/%40/g, "@");
}

/**
 * A mailto: a phone will actually open. The body is percent-encoded into the
 * URL, so a 2,200-character draft makes a link of several thousand characters
 * that some clients truncate and some refuse outright. Past the limit the body
 * is left out: the draft is printed in full just above, and a link that opens
 * with the right address and subject beats one that opens half a reply.
 */
export function mailtoLink(to: string, subject: string, body?: string, maxLength = 6000): string {
  const head = `mailto:${mailtoAddress(to)}?subject=${encodeURIComponent(subject)}`;
  if (!body) return head;
  const full = `${head}&body=${encodeURIComponent(body)}`;
  return full.length <= maxLength ? full : head;
}

/**
 * What a reply link can honestly promise. "none" is a draft that is a subject
 * line and nothing else (the model does return one occasionally): there is no
 * body to pre-fill, and saying "too long to pre-fill" about an empty body
 * sends Radu looking for text that is not there.
 */
export type Prefill = "full" | "long" | "none";

/** The reply link plus what it actually carries, so the label can be true. */
export function replyLink(to: string, reply: { subject: string; body: string }, maxLength?: number): { href: string; prefill: Prefill } {
  const body = reply.body.trim();
  if (!body) return { href: mailtoLink(to, reply.subject, undefined, maxLength), prefill: "none" };
  const href = mailtoLink(to, reply.subject, body, maxLength);
  return { href, prefill: href.includes("&body=") ? "full" : "long" };
}

function telLink(e164: string): string {
  return `tel:${e164.replace(/[^+\d]/g, "")}`;
}

const LANG_NAME: Record<string, string> = { fr: "French", en: "English" };

/**
 * What the letter means, beside the letter. Nothing anywhere told Radu, and a
 * grade that looks like a verdict on the person is read as one: "C" on a lead
 * who only said he is looking around is not a bad lead, it is a lead who told
 * us when. The grade is urgency plus budget fit and nothing else.
 */
const GRADE_LEGEND: Record<string, string> = {
  A: "Grade A = they want to start now and the budget covers it (B: in between; C: they said they are only exploring). It is urgency and budget fit, never lead quality.",
  B: "Grade B = in between (A: wants to start now and the budget covers it; C: they said they are only exploring). It is urgency and budget fit, never lead quality.",
  C: "Grade C = they said they are only exploring (A: wants to start now and the budget covers it; B: in between). It is urgency and budget fit, never lead quality.",
};

function gradeLegend(grade: string): string {
  return GRADE_LEGEND[String(grade ?? "").trim().toUpperCase()] ?? "";
}

/**
 * Nothing could honestly be named. Saying "Lines: (none scored)" reads as a
 * scoring accident; it is an answer, and the questions below are the work.
 */
const NOTHING_TO_PROPOSE = "Not enough here to quote. Ask the questions below before proposing anything.";

/**
 * No draft. Either the triage never answered, or the draft it wrote failed the
 * two checks every draft has to pass (greet this person by name, be signed by
 * Radu). One of five live drafts opened "Bonjour," and signed "L'equipe
 * Digital M", and a draft Radu has to proofread is worse than no draft,
 * because he will eventually stop proofreading.
 */
const NO_DRAFT =
  "No draft: either the AI triage did not answer, or the draft did not pass its checks (no first name, or not signed by Radu). Write this one yourself.";

/** True when there is no service line to name. */
function nothingToPropose(lines: string | undefined): boolean {
  const l = (lines ?? "").trim();
  return l === "" || /^\(none scored\)$/i.test(l);
}

/** Subject: reference, grade, who, where, need. Works with no AI answer at all. */
function leadSubject(i: LeadMailInput): string {
  const flags = [i.urgent ? "URGENT" : null, i.flagged ? "FLAGGED" : null].filter(Boolean).join(" ");
  const who = [i.firstName, i.company].filter(Boolean).join(", ");
  const where = i.place ? ` (${i.place})` : "";
  const need =
    (i.summary && i.summary.trim()) ||
    [i.propose?.lines, i.facts?.find((f) => /budget/i.test(f.label))?.value]
      .filter(Boolean)
      .join(", ") ||
    "new check-up";
  return `[${i.reference}] ${i.grade}${flags ? ` ${flags}` : ""} - ${who}${where} - ${need}`.slice(0, 190);
}

// ---- plain text -------------------------------------------------------------

function textBlock(title: string, lines: (string | null | undefined)[]): string {
  const body = lines.filter((l): l is string => !!l && l.trim() !== "").join("\n");
  return body ? `\n${title}\n${"-".repeat(title.length)}\n${body}\n` : "";
}

function renderLeadText(i: LeadMailInput, subject: string): string {
  const e164 = dialable(i.phone);
  const phoneLine = e164
    ? `Phone: ${e164}  (tel:${e164})`
    : i.phone
      ? `Phone: not dialable as stored ("${i.phone}") - ask for it on the reply`
      : "Phone: not given";

  const words = (i.ownWords ?? [])
    .filter((w) => w.text.trim())
    .map((w) => `${w.label}:\n"${w.text.trim()}"`);

  const reply = i.reply
    ? [
        `Subject: ${i.reply.subject}`,
        "",
        i.reply.body.trim() || "(the AI returned a subject line and no body - write the reply yourself)",
      ].join("\n")
    : NO_DRAFT;

  // The plain-text part is what Telegram and some clients show, so the link
  // has to stay readable rather than bury the message in three lines of %20.
  // 2,200 is measured, not guessed: the ten real drafts on staging are 913 to
  // 1,284 characters and percent-encode to 1,364-1,965, so the old 1,200 cap
  // dropped the body of EVERY ONE of them and the text part always read "too
  // long to pre-fill". At 2,200 the one-tap reply works in Telegram too.
  const send = i.reply ? replyLink(i.email, i.reply, 2200) : null;
  const sendLabel: Record<Prefill, string> = {
    full: "Send that reply in one tap",
    long: "Reply (the draft is above, too long to pre-fill here)",
    none: "Reply (the draft above is a subject line only)",
  };

  const legend = gradeLegend(i.grade);

  return (
    `${subject}\n${"=".repeat(Math.min(subject.length, 72))}\n` +
    (legend ? `${legend}\n` : "") +
    textBlock("WHO AND WHERE", [
      `Name: ${i.firstName}${i.company ? ` - ${i.company}` : " (no business name given)"}`,
      i.place ? `Where: ${i.place}` : "Where: not known from the answers",
      `Wrote in: ${LANG_NAME[i.locale] ?? i.locale}`,
    ]) +
    textBlock("HOW TO REACH THEM", [`Email: ${i.email}  (mailto:${i.email})`, phoneLine]) +
    textBlock("THEIR OWN WORDS", words.length ? words : ["(they typed nothing free-form)"]) +
    textBlock("THE FACTS", (i.facts ?? []).map((f) => `${f.label}: ${f.value}`)) +
    textBlock(
      "WHAT TO PROPOSE",
      i.propose
        ? [
            nothingToPropose(i.propose.lines) ? NOTHING_TO_PROPOSE : `Lines: ${i.propose.lines}`,
            i.propose.price ? `Price range that fits: ${i.propose.price}` : null,
            i.propose.why ? `Why: ${i.propose.why}` : null,
            i.propose.noFit ? `HONEST FLAG: ${i.propose.noFit}` : null,
          ]
        : [],
    ) +
    textBlock("ON THE CALL", [
      ...(i.callQuestions ?? []).filter((q) => q.trim()).map((q, n) => `${n + 1}. ${q.trim()}`),
      i.unknowns ? `Still unknown: ${i.unknowns}` : null,
    ]) +
    textBlock("READY-TO-SEND REPLY", [reply]) +
    textBlock("LINKS", [i.crmUrl ? `Lead in the CRM: ${i.crmUrl}` : null]) +
    textBlock("THE DETAIL", [
      ...(i.detail ?? []).map((f) => `${f.label}: ${f.value}`),
      ...(i.diagnostics ?? []).map((f) => `${f.label}: ${f.value}`),
    ]) +
    // Last, on its own. The one-tap reply is ~1,900 characters of
    // percent-encoding and it used to sit between the draft and the CRM link,
    // so the link Radu wanted was two screens of %20 away from the draft he
    // had just read. The link itself is untouched: it still works from a phone.
    textBlock("SEND THE REPLY IN ONE TAP", [send ? `${sendLabel[send.prefill]}:\n${send.href}` : null])
  );
}

// ---- HTML -------------------------------------------------------------------

const MUTED = "#8b94a4";
const INK = "#0a0e16";

function htmlSection(title: string, inner: string): string {
  if (!inner) return "";
  return `<div style="margin:0 0 20px;">
      <p style="margin:0 0 8px;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:${MUTED};">${esc(title)}</p>
      ${inner}
    </div>`;
}

// A short label ("Budget", "Where") is better on one line, but a long one
// ("Which tools do you use day-to-day?", down in "The detail") held the label
// column open on a 360 px phone and squeezed the value into a 55 px ribbon.
// Past this many characters the label wraps and the value gets the room.
const NOWRAP_LABEL_MAX = 18;

function htmlFacts(facts: LeadMailFact[]): string {
  if (!facts.length) return "";
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5;">${facts
    .map(
      (f) =>
        `<tr><td style="padding:5px 14px 5px 0;color:${MUTED};white-space:${
          f.label.length > NOWRAP_LABEL_MAX ? "normal" : "nowrap"
        };vertical-align:top;">${esc(
          f.label,
        )}</td><td style="padding:5px 0;color:${INK};vertical-align:top;">${esc(f.value)}</td></tr>`,
    )
    .join("")}</table>`;
}

function htmlButton(label: string, href: string, primary = false): string {
  const style = primary
    ? `background:linear-gradient(115deg,#F15A24,#EE355E 52%,#ED1E79);color:#ffffff;`
    : `background:#ffffff;color:${INK};border:1px solid #d9dde4;`;
  return `<a href="${esc(href)}" style="display:inline-block;${style}text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:10px;margin:0 8px 8px 0;">${esc(label)}</a>`;
}

function renderLeadHtml(i: LeadMailInput): string {
  const e164 = dialable(i.phone);
  const words = (i.ownWords ?? []).filter((w) => w.text.trim());

  const contact =
    htmlButton(`Email ${i.firstName}`, `mailto:${mailtoAddress(i.email)}`) +
    (e164
      ? htmlButton(`Call ${e164}`, telLink(e164))
      : `<p style="margin:6px 0 0;font-size:14px;color:${INK};">${
          i.phone
            ? `Phone <strong>${esc(i.phone)}</strong> cannot be dialled as stored - ask for it in the reply.`
            : "No phone number given."
        }</p>`);

  const wordsHtml = words.length
    ? words
        .map(
          (w) =>
            `<div style="margin:0 0 10px;padding:12px 14px;background:#fff8f4;border-left:3px solid #F15A24;border-radius:6px;">
        <p style="margin:0 0 4px;font-size:12px;color:${MUTED};">${esc(w.label)}</p>
        <p style="margin:0;font-size:15px;line-height:1.6;color:${INK};white-space:pre-wrap;">${esc(w.text.trim())}</p>
      </div>`,
        )
        .join("")
    : `<p style="margin:0;font-size:14px;color:${MUTED};">They typed nothing free-form.</p>`;

  const nothingNamed = !!i.propose && nothingToPropose(i.propose.lines);
  const proposeHtml = i.propose
    ? (nothingNamed
        ? `<p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:${INK};font-weight:600;">${esc(NOTHING_TO_PROPOSE)}</p>`
        : "") +
      htmlFacts(
        [
          nothingNamed ? null : { label: "Lines", value: i.propose.lines },
          i.propose.price ? { label: "Price range", value: i.propose.price } : null,
          i.propose.why ? { label: "Why", value: i.propose.why } : null,
          i.propose.noFit ? { label: "Honest flag", value: i.propose.noFit } : null,
        ].filter((f): f is LeadMailFact => !!f),
      )
    : "";

  const callHtml =
    (i.callQuestions ?? []).filter((q) => q.trim()).length || i.unknowns
      ? `<ol style="margin:0 0 8px;padding-left:20px;font-size:14px;line-height:1.6;color:${INK};">${(
          i.callQuestions ?? []
        )
          .filter((q) => q.trim())
          .map((q) => `<li>${esc(q.trim())}</li>`)
          .join("")}</ol>${
          i.unknowns
            ? `<p style="margin:0;font-size:14px;color:${INK};"><span style="color:${MUTED};">Still unknown:</span> ${esc(
                i.unknowns,
              )}</p>`
            : ""
        }`
      : "";

  const send = i.reply ? replyLink(i.email, i.reply) : null;
  const sendLabel: Record<Prefill, string> = {
    full: "Send this reply",
    long: "Open a reply (draft above, too long to pre-fill)",
    none: "Open a reply (the draft is a subject line only)",
  };
  const replyHtml = i.reply && send
    ? `<div style="border:1px solid #e6e8ec;border-radius:10px;overflow:hidden;">
      <p style="margin:0;padding:10px 14px;background:#f7f8fa;font-size:13px;color:${MUTED};">Subject: <span style="color:${INK};">${esc(
        i.reply.subject,
      )}</span></p>
      <div style="padding:14px;white-space:pre-wrap;font-size:14px;line-height:1.65;color:${
        send.prefill === "none" ? MUTED : INK
      };">${
        send.prefill === "none"
          ? "The AI returned a subject line and no body - write the reply yourself."
          : esc(i.reply.body.trim())
      }</div>
    </div>
    <p style="margin:12px 0 0;">${htmlButton(sendLabel[send.prefill], send.href, true)}</p>`
    : `<p style="margin:0;font-size:14px;color:${INK};">${esc(NO_DRAFT)}</p>`;

  const detail = [...(i.detail ?? []), ...(i.diagnostics ?? [])];

  return `<div style="background:#f4f5f7;padding:20px 12px;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e8ec;">
    <div style="height:4px;background:linear-gradient(115deg,#F15A24,#EE355E 52%,#ED1E79);"></div>
    <div style="padding:20px 20px 24px;">
      <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};">Digital check-up - ${esc(
        i.reference,
      )}</p>
      <h1 style="margin:0 0 16px;font-size:20px;color:${INK};font-weight:700;">Grade ${esc(i.grade)}${
        i.urgent ? " - URGENT" : ""
      }${i.flagged ? " - flagged" : ""}: ${esc(i.firstName)}${i.company ? `, ${esc(i.company)}` : ""}</h1>
      ${gradeLegend(i.grade) ? `<p style="margin:-10px 0 16px;font-size:12px;line-height:1.5;color:${MUTED};">${esc(gradeLegend(i.grade))}</p>` : ""}
      ${htmlSection(
        "Who and where",
        htmlFacts([
          { label: "Name", value: `${i.firstName}${i.company ? ` - ${i.company}` : " (no business name given)"}` },
          { label: "Where", value: i.place || "not known from the answers" },
          { label: "Wrote in", value: LANG_NAME[i.locale] ?? i.locale },
        ]),
      )}
      ${htmlSection("How to reach them", contact)}
      ${htmlSection("Their own words", wordsHtml)}
      ${htmlSection("The facts", htmlFacts(i.facts ?? []))}
      ${htmlSection("What to propose", proposeHtml)}
      ${htmlSection("On the call", callHtml)}
      ${htmlSection("Ready-to-send reply", replyHtml)}
      ${htmlSection("Links", i.crmUrl ? htmlButton("Open the lead in the CRM", i.crmUrl) : "")}
      ${
        detail.length
          ? `<div style="margin-top:20px;padding-top:16px;border-top:1px solid #eef0f3;">
        <p style="margin:0 0 8px;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:${MUTED};">The detail (everything else)</p>
        ${htmlFacts(detail)}
      </div>`
          : ""
      }
    </div>
  </div>
</div>`;
}

/**
 * The check-up lead notification: subject, plain text and HTML.
 * The text alternative is what Telegram and some clients show, so it is
 * written to be read on its own, not as a fallback nobody looked at.
 */
export function renderLeadNotification(input: LeadMailInput): { subject: string; text: string; html: string } {
  const subject = leadSubject(input);
  return { subject, text: renderLeadText(input, subject), html: renderLeadHtml(input) };
}
