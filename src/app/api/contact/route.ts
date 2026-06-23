import { NextRequest, NextResponse } from "next/server";
import { sendMail, mailConfigured, renderNotification } from "@/lib/mail";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const oneLine = (value: unknown) =>
  String(value ?? "").replace(/[\r\n]+/g, " ").trim();

export async function POST(req: NextRequest) {
  if (!rateLimit(`contact:${clientIp(req)}`, 5, 10 * 60_000)) {
    return NextResponse.json({ ok: false, error: "rate" }, { status: 429 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Honeypot: real users never fill this.
  if (oneLine(body.website)) {
    return NextResponse.json({ ok: true });
  }

  const name = oneLine(body.name);
  const email = oneLine(body.email);
  const phone = oneLine(body.phone);
  const company = oneLine(body.company);
  const locale = oneLine(body.locale) || "en";
  const message = String(body.message ?? "").trim();

  if (!name || !email || !message || !phone) {
    return NextResponse.json({ ok: false, error: "missing" }, { status: 422 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: "email" }, { status: 422 });
  }

  if (!mailConfigured()) {
    // No SMTP yet — tell the client to use the mailto fallback.
    return NextResponse.json({ ok: false, error: "unconfigured" }, { status: 503 });
  }

  const rows: [string, string][] = [
    ["Name", name],
    ["Email", email],
  ];
  if (phone) rows.push(["Phone", phone]);
  if (company) rows.push(["Company", company]);
  rows.push(["Language", locale]);

  const { text, html } = renderNotification({
    source: "Contact form",
    rows,
    body: message,
  });

  try {
    await sendMail({
      subject: `Contact form — ${name}`,
      text,
      html,
      replyTo: email,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("contact: delivery failed", err);
    return NextResponse.json({ ok: false, error: "delivery" }, { status: 502 });
  }
}
