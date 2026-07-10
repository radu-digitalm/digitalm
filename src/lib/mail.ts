import nodemailer from "nodemailer";
import dns from "node:dns/promises";
import net from "node:net";

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

export async function sendMail(opts: {
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  to?: string;
}): Promise<void> {
  const t = await transport();
  if (!t) throw new Error("SMTP not configured");
  await t.sendMail({
    to: opts.to || TO,
    from: FROM,
    replyTo: opts.replyTo,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
}

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
