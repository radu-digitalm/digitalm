import nodemailer from "nodemailer";

const TO = process.env.CONTACT_FORM_TO || "contact@digitalm.eu";
const FROM =
  process.env.CONTACT_FORM_FROM || process.env.SMTP_USER || "contact@digitalm.eu";

/** True when SMTP credentials are present so mail can actually be sent. */
export function mailConfigured(): boolean {
  return !!process.env.SMTP_HOST;
}

function transport() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === "true"
    : port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });
}

export async function sendMail(opts: {
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  to?: string;
}): Promise<void> {
  const t = transport();
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
