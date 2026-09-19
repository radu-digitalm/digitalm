import { NextRequest, NextResponse } from "next/server";
import { sendMail, mailConfigured, renderClientEmail, renderLeadNotification, splitReplyDraft, leadPlace, dialable } from "@/lib/mail";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { enquiriesDb, newReference } from "@/lib/enquiries";
import { score, type ServiceLine } from "@/lib/diagnosticScoring";
import { triageEnquiry } from "@/lib/diagnosticTriage";
import { notifyTelegram } from "@/lib/notify";
import { serverTrack } from "@/lib/serverTrack";
import { adsConversion } from "@/lib/openaiAds";
import { readAttribution, attributionLabel, attributionSource } from "@/lib/attribution";
import { repairPostedPhone } from "@/lib/phone";
import { SITE_URL } from "@/lib/seo";
import { STEP1, ROUTER, BRANCHES, TOOLS, MAGIC, STEP5, CONTACT, type Question } from "@/content/diagnostic";
// @@crm:inbox
import { leadFromEnquiry } from "@/lib/inbox/hooks";

export const runtime = "nodejs";

// Flat id -> question lookup so the triage email shows labels, not ids.
const ALL_QUESTIONS: Question[] = [
  ...STEP1, ROUTER,
  ...Object.values(BRANCHES).flat(),
  TOOLS, MAGIC, ...STEP5, ...CONTACT,
];
const BY_ID = new Map(ALL_QUESTIONS.map((q) => [q.id, q]));

// Plain names for the service lines: Radu reads the email on a phone, and
// "AUTO+CRM" is not what he wants to see at 7am.
const LINE_LABEL: Record<ServiceLine, string> = {
  AGENT: "AI assistant",
  AUTO: "Process automation",
  WEB: "Website / e-commerce",
  CRM: "Customer follow-up (CRM)",
  SEC: "E-commerce security audit",
};

// What to quote against the band they chose. The model gets the same rule in
// its prompt; this line is what Radu reads when the model did not answer at
// all, and it is why nobody gets offered the floor price of the grid again.
const PRICE_FIT: Record<string, string> = {
  "<1500": "under €1,500 — quote €800-1,500, never the €500 entry price",
  "1500-3500": "€1,500-3,500 — quote €2,000-3,500",
  "3500-7000": "€3,500-7,000 — quote €4,000-6,000",
  "7000+": "€7,000+ — quote from €7,000 up",
  unsure: "not decided — quote the standard €1,500-3,500 range",
};
const STANDARD_PRICE = "not stated — quote the standard €1,500-3,500 range";

function labelFor(q: Question, v: string): string {
  return q.options?.find((o) => o.id === v)?.en ?? v;
}

/** Record whether the triage email actually went out. Never throws. */
function markMail(reference: string, status: "sent" | "failed" | "skipped", error?: string): void {
  try {
    enquiriesDb()
      .prepare("UPDATE enquiries SET mail_status = ?, mail_error = ? WHERE reference = ?")
      .run(status, error ?? null, reference);
  } catch (e) {
    console.error("could not record mail status", e);
  }
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
    oppref?: string; // legacy field — now inside `attribution`
    attribution?: unknown; // utm_* + oppref read from the page URL by the wizard
    // Optional country hints for the phone. The wizard posts an E.164 number
    // and needs neither; they are here for a caller that knows where the
    // visitor is but cannot format the number itself.
    phoneCountry?: unknown; // ISO2, e.g. "CA"
    phoneDial?: unknown; // dial code, e.g. "+1"
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

  // Labelled answers (EN labels), kept as data rather than one string: the
  // email picks out the facts that decide the sale and leaves the rest for the
  // bottom of the message, and the model gets the same thing as prose.
  const magic = String(answers.magic ?? "").trim();
  const entries: { id: string; label: string; value: string; freeText: boolean }[] = [];
  for (const [id, v] of Object.entries(answers)) {
    if (["firstName", "email", "company", "phone", "magic"].includes(id)) continue;
    const q = BY_ID.get(id.replace(/_other$/, ""));
    if (!q) continue;
    if (id.endsWith("_other")) {
      entries.push({ id, label: `${q.en} (other)`, value: String(v).slice(0, 500), freeText: true });
      continue;
    }
    const vals = Array.isArray(v) ? v.map((x) => labelFor(q, String(x))).join(", ") : labelFor(q, String(v));
    entries.push({ id, label: q.en, value: vals, freeText: false });
  }
  const answerOf = (id: string): string => entries.find((e) => e.id === id)?.value ?? "";

  const company = String(answers.company ?? "").trim().slice(0, 200);
  const website = String(answers.site ?? "").trim().slice(0, 300);
  const budgetId = String(answers.budget ?? "").trim();
  const budgetLabel = answerOf("budget");
  const priceFit = PRICE_FIT[budgetId] ?? STANDARD_PRICE;

  // The model is shown who this is: without the first name every "ready-to-send"
  // draft opened with a bare "Bonjour,", and without the budget it quoted the
  // floor price of the grid to a prospect who had declared several thousand.
  // "How did you hear about us" is left out: it changes nothing and the one
  // real lead's answer contradicted the ad tag we already had.
  const modelAnswers = [
    magic ? `MAGIC WAND (their own words):\n"${magic}"\n` : null,
    ...entries.filter((e) => e.id !== "source").map((e) => `${e.label}: ${e.value}`),
  ]
    .filter((l): l is string => !!l)
    .join("\n");

  // LLM triage — reads the free text the rules can't. Rule scoring is the fallback.
  const triage = await triageEnquiry(
    { firstName, company, website, budget: budgetLabel, answers: modelAnswers },
    scoring,
    locale,
  );
  const proposed = triage?.proposed ?? scoring.proposed;

  const reference = newReference();
  const attr = readAttribution(body.attribution);
  if (!attr.oppref && typeof body.oppref === "string") attr.oppref = body.oppref;
  const via = attributionLabel(attr);
  // The check-up now posts an E.164 number, but a page cached before that
  // deploy still posts whatever was typed ("15817015976", the 18 Sep 2026
  // lead). Repair what can be repaired and keep the rest exactly as typed:
  // this never throws and never refuses, so a badly written number cannot
  // cost us the lead, and `answers` keeps the original either way.
  const phone = repairPostedPhone(answers.phone, {
    country: typeof body.phoneCountry === "string" ? body.phoneCountry : null,
    dial: typeof body.phoneDial === "string" ? body.phoneDial : null,
  }).slice(0, 50);
  const source = String(answers.source ?? "").trim().slice(0, 100);

  try {
    enquiriesDb()
      .prepare(
        `INSERT INTO enquiries (reference, locale, answers, scores, proposed, grade, urgent, flagged, first_name, email, company, phone, source, ip, reply_draft, note_for_radu, subject_summary, source_utm, attribution)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        reference, locale, JSON.stringify(answers), JSON.stringify(scoring.scores),
        proposed.join("+") || "-", scoring.grade, scoring.urgent ? 1 : 0, flagged ? 1 : 0,
        firstName, email, company || null, phone || null, source || null, ip,
        triage?.replyDraft ?? null, triage?.noteForRadu ?? null, triage?.subjectSummary ?? null,
        attributionSource(attr) || null, Object.keys(attr).length ? JSON.stringify(attr) : null,
      );
  } catch (e) {
    console.error("enquiry db insert failed", e);
    return NextResponse.json({ ok: false, error: "server" }, { status: 500 });
  }

  // @@crm:inbox
  const lead = leadFromEnquiry({ reference, locale, firstName, email, company, phone, attr, ip });

  // Where they are, as far as the evidence goes: the number's dial code first,
  // then the country the CRM row settled on. Never the page language.
  const place = leadPlace({ phone, country: lead?.country ?? null });
  const e164 = dialable(phone);
  const crmUrl = lead ? `${SITE_URL}/admin/leads/${lead.reference}` : undefined;

  serverTrack("diagnostic_completed", { grade: scoring.grade, proposed: proposed.join("+") || "-", locale, source: attributionSource(attr) || "direct" });
  // ChatGPT Ads conversion — only fires when the visitor landed from an ad (?oppref=).
  adsConversion("lead_created", { id: reference, sourceUrl: `${SITE_URL}/${locale}/diagnostic`, oppref: attr.oppref });

  // ---- Telegram push (speed-to-lead: reply from your phone in minutes) ----
  // Same order as the email: who, where, how to reach them, their own words,
  // then the draft. A number that cannot be dialled says so instead of being
  // printed as if it could.
  const tgLines = [
    `🔔 ${scoring.grade}${scoring.urgent ? " · URGENT" : ""} lead — ${reference}`,
    `${firstName}${company ? ` · ${company}` : ""}${place ? ` · ${place}` : ""}`,
    `→ ${proposed.map((p) => LINE_LABEL[p]).join(" + ") || "?"} · ${budgetLabel || "budget not stated"}`,
    e164 ? `📞 ${e164}` : phone ? `📞 ${phone} (not dialable as stored)` : null,
    `✉️ ${email}`,
    via ? `📣 via ${via}` : null,
    magic ? `\n— their own words —\n"${magic}"` : null,
    triage?.replyDraft ? `\n— ready reply —\n${triage.replyDraft}` : null,
    crmUrl ? `\n${crmUrl}` : null,
  ].filter(Boolean);
  notifyTelegram(tgLines.join("\n"));

  // ---- Triage email to Radu (best-effort; the enquiry is already stored) ----
  if (mailConfigured()) {
    const replySubject =
      locale === "fr"
        ? `Votre check-up numérique — ${reference}`
        : `Your digital check-up — ${reference}`;
    const { subject, text, html } = renderLeadNotification({
      reference,
      grade: scoring.grade,
      urgent: scoring.urgent,
      flagged,
      locale,
      firstName,
      company: company || undefined,
      email,
      phone: phone || undefined,
      place: place || undefined,
      summary: triage?.subjectSummary,
      crmUrl,
      ownWords: [
        ...(magic ? [{ label: "Magic wand — the chore they want gone", text: magic }] : []),
        ...entries.filter((e) => e.freeText).map((e) => ({ label: e.label, text: e.value })),
      ],
      facts: [
        { label: "What they do", value: [answerOf("activity"), answerOf("activity_other")].filter(Boolean).join(" — ") || "not stated" },
        { label: "Size", value: answerOf("team") || "not stated" },
        { label: "Sells online", value: answerOf("sellsOnline") || "not stated" },
        { label: "Budget", value: budgetLabel || "not stated" },
        { label: "Wants to start", value: answerOf("start") || "not stated" },
        { label: "Who decides", value: answerOf("decision") || "not stated" },
        { label: "Tools today", value: answerOf("tools") || "none picked" },
        { label: "Website", value: website || "not given" },
      ],
      propose: {
        lines: proposed.map((p) => LINE_LABEL[p]).join(" + ") || "(none scored)",
        why: triage?.noteForRadu,
        price: priceFit,
        noFit: triage?.noFit?.trim() || undefined,
      },
      callQuestions: triage?.callQuestions,
      unknowns: triage?.unknowns,
      reply: triage?.replyDraft ? splitReplyDraft(triage.replyDraft, replySubject) : undefined,
      detail: entries.map((e) => ({ label: e.label, value: e.value })),
      diagnostics: [
        { label: "Rule scores", value: Object.entries(scoring.scores).filter(([, v]) => v !== 0).map(([k, v]) => `${k}:${v}`).join("  ") || "-" },
        { label: "Urgency", value: `${scoring.urgency}/5` },
        { label: "Flags", value: scoring.flags.join(", ") || "-" },
        { label: "Heard about us", value: source ? labelFor(BY_ID.get("source")!, source) : "not answered" },
        { label: "Attribution", value: via || "direct" },
        { label: "Language", value: locale },
        { label: "IP", value: ip },
        { label: "Turnstile", value: flagged ? "outage — accepted unverified" : "verified" },
        { label: "AI triage", value: triage ? "ok" : "unavailable — rules only" },
      ],
    });
    sendMail({
      subject,
      text,
      html,
      replyTo: email,
    })
      .then(() => markMail(reference, "sent"))
      .catch((e) => {
        console.error("enquiry mail failed", e);
        markMail(reference, "failed", String((e as { code?: string }).code ?? e));
        // Email is down — make sure the lead can't go unnoticed.
        notifyTelegram(
          `⚠️ EMAIL FAILED for ${reference} (${(e as { code?: string }).code ?? "error"}).\n` +
            `The lead IS saved (reference ${reference}) and the reply draft is in the database.\n` +
            `Re-send once mail is healthy.`,
        );
      });

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
    }).catch((e) => {
      console.error("enquiry ack failed", e);
      notifyTelegram(`⚠️ Acknowledgement email to the ${reference} visitor failed — they were never confirmed. Re-send manually.`);
    });
  } else {
    markMail(reference, "skipped", "SMTP not configured");
  }

  return NextResponse.json({
    ok: true,
    reference,
    grade: scoring.grade,
    proposed,
    rationale: triage?.clientRationale ?? null,
  });
}
