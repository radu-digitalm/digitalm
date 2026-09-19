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
 * Where this lead is, as far as the evidence goes: the number's dial code
 * first (it is the only thing the visitor typed that carries a country), then
 * the country on the CRM lead row. Never guessed from the page language — that
 * is exactly how every Quebec lead ended up filed under France.
 */
export function leadPlace(opts: { phone?: string | null; country?: string | null }): string | null {
  const e164 = dialable(opts.phone);
  const iso = countryFromE164(e164) ?? (opts.country ? opts.country.toUpperCase() : null);
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

function mailtoLink(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function telLink(e164: string): string {
  return `tel:${e164.replace(/[^+\d]/g, "")}`;
}

const LANG_NAME: Record<string, string> = { fr: "French", en: "English" };

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
    ? [`Subject: ${i.reply.subject}`, "", i.reply.body].join("\n")
    : "No draft: the AI triage did not answer. The facts above are all rule-based.";

  return (
    `${subject}\n${"=".repeat(Math.min(subject.length, 72))}\n` +
    textBlock("WHO AND WHERE", [
      `Name: ${i.firstName}${i.company ? ` - ${i.company}` : " (no business name given)"}`,
      i.place ? `Where: ${i.place}` : "Where: not known from the answers",
      `Wrote in: ${LANG_NAME[i.locale] ?? i.locale}`,
    ]) +
    textBlock("HOW TO REACH THEM", [`Email: ${i.email}  (mailto:${i.email})`, phoneLine]) +
    textBlock("THEIR OWN WORDS", words.length ? words : ["(they typed nothing free-form)"]) +
    textBlock("THE FACTS", (i.facts ?? []).map((f) => `${f.label}: ${f.value}`)) +
    textBlock("WHAT TO PROPOSE", [
      i.propose?.lines ? `Lines: ${i.propose.lines}` : null,
      i.propose?.price ? `Price range that fits: ${i.propose.price}` : null,
      i.propose?.why ? `Why: ${i.propose.why}` : null,
      i.propose?.noFit ? `HONEST FLAG: ${i.propose.noFit}` : null,
    ]) +
    textBlock("ON THE CALL", [
      ...(i.callQuestions ?? []).filter((q) => q.trim()).map((q, n) => `${n + 1}. ${q.trim()}`),
      i.unknowns ? `Still unknown: ${i.unknowns}` : null,
    ]) +
    textBlock("READY-TO-SEND REPLY", [reply]) +
    textBlock("LINKS", [
      i.reply ? `Send that reply in one tap:\n${mailtoLink(i.email, i.reply.subject, i.reply.body)}` : null,
      i.crmUrl ? `Lead in the CRM: ${i.crmUrl}` : null,
    ]) +
    textBlock("THE DETAIL", [
      ...(i.detail ?? []).map((f) => `${f.label}: ${f.value}`),
      ...(i.diagnostics ?? []).map((f) => `${f.label}: ${f.value}`),
    ])
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

function htmlFacts(facts: LeadMailFact[]): string {
  if (!facts.length) return "";
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5;">${facts
    .map(
      (f) =>
        `<tr><td style="padding:5px 14px 5px 0;color:${MUTED};white-space:nowrap;vertical-align:top;">${esc(
          f.label,
        )}</td><td style="padding:5px 0;color:${INK};">${esc(f.value)}</td></tr>`,
    )
    .join("")}</table>`;
}

function htmlButton(label: string, href: string, primary = false): string {
  const style = primary
    ? `background:linear-gradient(115deg,#F15A24,#EE355E 52%,#ED1E79);color:#ffffff;`
    : `background:#ffffff;color:${INK};border:1px solid #d9dde4;`;
  return `<a href="${esc(href)}" style="display:inline-block;${style}text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:10px;margin:0 8px 8px 0;">${esc(label)}</a>`;
}

function renderLeadHtml(i: LeadMailInput, subject: string): string {
  const e164 = dialable(i.phone);
  const words = (i.ownWords ?? []).filter((w) => w.text.trim());

  const contact =
    htmlButton(`Email ${i.firstName}`, `mailto:${i.email}`) +
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

  const proposeHtml = htmlFacts(
    [
      i.propose?.lines ? { label: "Lines", value: i.propose.lines } : null,
      i.propose?.price ? { label: "Price range", value: i.propose.price } : null,
      i.propose?.why ? { label: "Why", value: i.propose.why } : null,
      i.propose?.noFit ? { label: "Honest flag", value: i.propose.noFit } : null,
    ].filter((f): f is LeadMailFact => !!f),
  );

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

  const replyHtml = i.reply
    ? `<div style="border:1px solid #e6e8ec;border-radius:10px;overflow:hidden;">
      <p style="margin:0;padding:10px 14px;background:#f7f8fa;font-size:13px;color:${MUTED};">Subject: <span style="color:${INK};">${esc(
        i.reply.subject,
      )}</span></p>
      <div style="padding:14px;white-space:pre-wrap;font-size:14px;line-height:1.65;color:${INK};">${esc(
        i.reply.body,
      )}</div>
    </div>
    <p style="margin:12px 0 0;">${htmlButton(
      "Send this reply",
      mailtoLink(i.email, i.reply.subject, i.reply.body),
      true,
    )}</p>`
    : `<p style="margin:0;font-size:14px;color:${INK};">The AI triage did not answer. Everything above is rule-based.</p>`;

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
  return { subject, text: renderLeadText(input, subject), html: renderLeadHtml(input, subject) };
}
