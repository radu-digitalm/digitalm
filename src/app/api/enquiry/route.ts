import { NextRequest, NextResponse } from "next/server";
import { sendMail, mailConfigured, renderNotification, renderClientEmail } from "@/lib/mail";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { enquiriesDb, newReference } from "@/lib/enquiries";
import { score } from "@/lib/diagnosticScoring";
import { triageEnquiry } from "@/lib/diagnosticTriage";
import { STEP1, ROUTER, BRANCHES, TOOLS, MAGIC, STEP5, CONTACT, type Question } from "@/content/diagnostic";

export const runtime = "nodejs";

// Flat id -> question lookup so the triage email shows labels, not ids.
const ALL_QUESTIONS: Question[] = [
  ...STEP1, ROUTER,
  ...Object.values(BRANCHES).flat(),
  TOOLS, MAGIC, ...STEP5, ...CONTACT,
];
const BY_ID = new Map(ALL_QUESTIONS.map((q) => [q.id, q]));

function labelFor(q: Question, v: string): string {
  return q.options?.find((o) => o.id === v)?.en ?? v;
}

async function verifyTurnstile(token: string, ip: string): Promise<"ok" | "bad" | "outage"> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return "ok"; // not configured -> skip
  if (!token) return "bad";
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
      signal: ctl.signal,
    });
    clearTimeout(t);
    const json = await res.json();
    return json.success ? "ok" : "bad";
  } catch {
    return "outage"; // Cloudflare unreachable -> accept but flag
  }
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!rateLimit(`enquiry:${ip}`, 5, 10 * 60_000)) {
    return NextResponse.json({ ok: false, error: "rate" }, { status: 429 });
  }

  let body: {
    locale?: string;
    answers?: Record<string, unknown>;
    turnstile?: string;
    website?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  // Honeypot: silently accept, store nothing.
  if (body.website) return NextResponse.json({ ok: true, reference: "DM-OK", grade: "C" });

  const answers = body.answers;
  const locale = body.locale === "fr" ? "fr" : "en";
  if (!answers || typeof answers !== "object" || JSON.stringify(answers).length > 20_000) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  const firstName = String(answers.firstName ?? "").trim().slice(0, 100);
  const email = String(answers.email ?? "").trim().slice(0, 200);
  if (!firstName || !/.+@.+\..+/.test(email)) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  const ts = await verifyTurnstile(String(body.turnstile ?? ""), ip);
  if (ts === "bad") return NextResponse.json({ ok: false, error: "verification" }, { status: 403 });
  const flagged = ts === "outage";

  const scoring = score(answers as Parameters<typeof score>[0]);

  // Labeled answers (EN labels) — for the LLM triage and the email body.
  const magic = String(answers.magic ?? "").trim();
  const detail: string[] = [];
  if (magic) detail.push(`MAGIC WAND (their own words):\n"${magic}"\n`);
  for (const [id, v] of Object.entries(answers)) {
    if (["firstName", "email", "company", "phone", "source", "magic"].includes(id)) continue;
    const q = BY_ID.get(id.replace(/_other$/, ""));
    if (!q) continue;
    if (id.endsWith("_other")) { detail.push(`${q.en} (other): ${String(v)}`); continue; }
    const vals = Array.isArray(v) ? v.map((x) => labelFor(q, String(x))).join(", ") : labelFor(q, String(v));
    detail.push(`${q.en}: ${vals}`);
  }

  // LLM triage — reads the free text the rules can't. Rule scoring is the fallback.
  const triage = await triageEnquiry(detail.join("\n"), scoring, locale);
  const proposed = triage?.proposed ?? scoring.proposed;

  const reference = newReference();
  const company = String(answers.company ?? "").trim().slice(0, 200);
  const phone = String(answers.phone ?? "").trim().slice(0, 50);
  const source = String(answers.source ?? "").trim().slice(0, 100);

  try {
    enquiriesDb()
      .prepare(
        `INSERT INTO enquiries (reference, locale, answers, scores, proposed, grade, urgent, flagged, first_name, email, company, phone, source, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        reference, locale, JSON.stringify(answers), JSON.stringify(scoring.scores),
        proposed.join("+") || "-", scoring.grade, scoring.urgent ? 1 : 0, flagged ? 1 : 0,
        firstName, email, company || null, phone || null, source || null, ip,
      );
  } catch (e) {
    console.error("enquiry db insert failed", e);
    return NextResponse.json({ ok: false, error: "server" }, { status: 500 });
  }

  // ---- Triage email to Radu (best-effort; the enquiry is already stored) ----
  if (mailConfigured()) {
    const rows: [string, string][] = [
      ["Reference", reference],
      ["Grade", `${scoring.grade}${scoring.urgent ? " · URGENT" : ""}${flagged ? " · FLAGGED (turnstile outage)" : ""}`],
      ["Proposed", proposed.join(" + ") || "(none scored)"],
      ["Urgency", `${scoring.urgency}/5`],
      ["Name", firstName],
      ["Email", email],
    ];
    if (company) rows.push(["Company", company]);
    if (phone) rows.push(["Phone", phone]);
    if (source) rows.push(["Heard about us", labelFor(BY_ID.get("source")!, source)]);
    rows.push(["Language", locale], ["IP", ip]);

    const body =
      (triage
        ? `READY-TO-SEND REPLY (review, tweak, send):\n\n${triage.replyDraft}\n\n———\nSTRATEGY NOTE:\n${triage.noteForRadu}\n\n———\n`
        : "") +
      detail.join("\n") +
      `\n\nRule scores: ${Object.entries(scoring.scores).filter(([, v]) => v !== 0).map(([k, v]) => `${k}:${v}`).join("  ") || "-"}${triage ? "" : "  (LLM triage unavailable — rules only)"}`;

    const grade = `[${scoring.grade}]${scoring.urgent ? "[URGENT]" : ""}`;
    const summary =
      triage?.subjectSummary ??
      `${firstName}${company ? `, ${company}` : ""} — ${proposed.join("+") || "?"} — ${String(answers.start ?? "?")}${answers.budget ? `, ${answers.budget}` : ""}`;
    const { text, html } = renderNotification({
      source: "Digital check-up",
      rows,
      body,
    });
    sendMail({
      subject: `[${reference}] ${grade} ${summary}`,
      text,
      html,
      replyTo: email,
    }).catch((e) => console.error("enquiry mail failed", e));

    // ---- Ack to the user, in their language (branded HTML + text) ----
    const ack =
      locale === "fr"
        ? {
            subject: `Votre check-up numérique — ${reference}`,
            title: `Merci ${firstName} — votre check-up est entre de bonnes mains`,
            paragraphs: [
              "Notre équipe l'examine personnellement et vous répond sous 1 jour ouvré avec des recommandations concrètes.",
              "Envie d'aller plus vite ? Réservez directement un appel gratuit de 30 minutes :",
            ],
            cta: { label: "Réserver un appel gratuit", url: "https://digitalm.eu/fr/book" },
            footnote: `Votre référence : ${reference} — mentionnez-la si vous souhaitez un jour que vos données soient supprimées.`,
            text: `Bonjour ${firstName},\n\nMerci pour votre check-up ! Notre équipe l'examine personnellement et vous répond sous 1 jour ouvré avec des recommandations concrètes.\n\nEnvie d'aller plus vite ? Réservez un appel gratuit de 30 min : https://digitalm.eu/fr/book\n\nVotre référence : ${reference} (mentionnez-la si vous souhaitez que vos données soient supprimées).\n\nÀ très vite,\nL'équipe Digital M — digitalm.eu`,
          }
        : {
            subject: `Your digital check-up — ${reference}`,
            title: `Thanks ${firstName} — your check-up is in good hands`,
            paragraphs: [
              "Our team reviews it personally and will reply within 1 business day with concrete recommendations.",
              "Want to move faster? Book a free 30-minute call directly:",
            ],
            cta: { label: "Book a free call", url: "https://digitalm.eu/en/book" },
            footnote: `Your reference: ${reference} — quote it if you ever want your data deleted.`,
            text: `Hi ${firstName},\n\nThanks for completing the check-up! Our team reviews it personally and will reply within 1 business day with concrete recommendations.\n\nWant to move faster? Book a free 30-min call: https://digitalm.eu/en/book\n\nYour reference: ${reference} (quote it if you ever want your data deleted).\n\nSpeak soon,\nThe Digital M team — digitalm.eu`,
          };
    sendMail({
      subject: ack.subject,
      text: ack.text,
      html: renderClientEmail(ack),
      to: email,
    }).catch((e) => console.error("enquiry ack failed", e));
  }

  return NextResponse.json({
    ok: true,
    reference,
    grade: scoring.grade,
    proposed,
    rationale: triage?.clientRationale ?? null,
  });
}
