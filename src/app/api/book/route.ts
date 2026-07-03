import { NextResponse } from "next/server";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { calendarConfigured, createBooking, getBusy } from "@/lib/googleCalendar";
import { BOOKING, generateSlots } from "@/lib/booking";
import { sendMail, mailConfigured, renderNotification } from "@/lib/mail";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { verifyTurnstile } from "@/lib/turnstile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MODEL = process.env.OPENAI_MODEL_CHAT || "gpt-4.1-mini";

/** Short internal brief for the meeting, written by the AI from the visitor's note. */
async function buildBrief(
  name: string,
  company: string,
  needs: string,
  locale: string,
): Promise<string> {
  const fallback =
    needs ||
    (locale === "fr"
      ? "Appel découverte demandé via le site."
      : "Discovery call requested via the website.");
  if (!process.env.OPENAI_API_KEY || !needs) return fallback;
  try {
    const { text } = await generateText({
      model: openai(MODEL),
      maxOutputTokens: 160,
      temperature: 0.3,
      prompt: `Write a 1–2 sentence internal brief for a sales discovery call, in ${
        locale === "fr" ? "French" : "English"
      }. Visitor: ${name}${company ? `, ${company}` : ""}. They wrote: "${needs}". Summarise concretely what they want and a sensible talking point. Neutral, no fluff, no preamble — output only the brief.`,
    });
    return text.trim() || fallback;
  } catch {
    return fallback;
  }
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!rateLimit(`book:${ip}`, 8, 10 * 60_000)) {
    return NextResponse.json({ ok: false, error: "rate" }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Honeypot — real users never fill this.
  const honeypot = String(body.website ?? "").trim();
  if (honeypot) return NextResponse.json({ ok: true });

  const str = (v: unknown) => String(v ?? "").trim().slice(0, 2000);
  const name = str(body.name);
  const email = str(body.email);
  const phone = str(body.phone);
  const company = str(body.company);
  const needs = str(body.needs);
  const start = str(body.start);
  // The widget names this field "preferred"; keep reading "proposed" for compat.
  const proposed = str(body.proposed ?? body.preferred);
  const ref = str(body.ref).slice(0, 20); // diagnostic hand-off reference (DM-XXXXX)
  const locale = body.locale === "fr" ? "fr" : "en";

  if (!name || !EMAIL_RE.test(email) || !phone) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  // Turnstile: reject bad tokens, proceed (flagged) on Cloudflare outage or
  // when the secret is unset (local dev).
  const ts = await verifyTurnstile(String(body.turnstile ?? "").trim(), ip);
  if (ts === "bad") {
    return NextResponse.json({ ok: false, error: "verification" }, { status: 403 });
  }
  const flagged = ts === "outage";

  // Live calendar mode: create a real event with an invite + notify the team.
  if (calendarConfigured() && start) {
    const startMs = Date.parse(start);
    if (!startMs) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
    const startISO = new Date(startMs).toISOString();

    const now = new Date();
    const busy = await getBusy(
      now.toISOString(),
      new Date(now.getTime() + (BOOKING.days + 1) * 86400000).toISOString(),
    );
    if (!generateSlots(now, busy).includes(startISO)) {
      return NextResponse.json({ ok: false, error: "taken" }, { status: 409 });
    }

    const brief = await buildBrief(name, company, needs, locale);
    const endISO = new Date(startMs + BOOKING.slotMin * 60000).toISOString();
    const summary = `Digital M call — ${name}${company ? ` (${company})` : ""}`;
    const description = [
      brief,
      "",
      `Name: ${name}`,
      `Email: ${email}`,
      `Phone: ${phone}`,
      company ? `Company: ${company}` : "",
      "Booked via digitalm.eu",
    ]
      .filter(Boolean)
      .join("\n");

    const ok = await createBooking({
      startISO,
      endISO,
      summary,
      description,
      attendeeEmail: email,
      attendeeName: name,
      tz: BOOKING.tz,
    });
    if (!ok) return NextResponse.json({ ok: false }, { status: 502 });

    // Notify contact@ that a new appointment was booked (in addition to the calendar event).
    if (mailConfigured()) {
      const when =
        new Date(startMs).toLocaleString(locale === "fr" ? "fr-FR" : "en-GB", {
          timeZone: BOOKING.tz,
          dateStyle: "full",
          timeStyle: "short",
        }) + ` (${BOOKING.tz})`;
      const rows: [string, string][] = [
        ["Name", name],
        ["Email", email],
        ["Phone", phone],
      ];
      if (company) rows.push(["Company", company]);
      rows.push(["When", when]);
      if (ref) rows.push(["Diagnostic ref", ref]);
      rows.push(["Language", locale]);
      if (flagged) rows.push(["Flagged", "Turnstile outage — unverified"]);
      const { text, html } = renderNotification({
        source: "New appointment",
        rows,
        body: brief,
      });
      try {
        await sendMail({
          subject: `New appointment — ${name}${company ? ` (${company})` : ""}`,
          text,
          html,
          replyTo: email,
        });
      } catch {
        /* the calendar event is the source of truth; notification is best-effort */
      }
    }

    return NextResponse.json({ ok: true, mode: "booked" });
  }

  // Fallback: no live calendar — email a call request to the team.
  if (mailConfigured()) {
    const rows: [string, string][] = [
      ["Name", name],
      ["Email", email],
      ["Phone", phone],
    ];
    if (company) rows.push(["Company", company]);
    if (proposed) rows.push(["Preferred times", proposed]);
    if (needs) rows.push(["Topic", needs]);
    if (ref) rows.push(["Diagnostic ref", ref]);
    if (flagged) rows.push(["Flagged", "Turnstile outage — unverified"]);
    const { text, html } = renderNotification({
      source: "Call request",
      rows,
      body: "A visitor requested a call via the website.",
    });
    try {
      await sendMail({
        subject: `Call request — ${name}${company ? ` (${company})` : ""}`,
        text,
        html,
        replyTo: email,
      });
      return NextResponse.json({ ok: true, mode: "requested" });
    } catch {
      return NextResponse.json({ ok: false }, { status: 502 });
    }
  }

  return NextResponse.json({ ok: false, error: "unconfigured" }, { status: 503 });
}
