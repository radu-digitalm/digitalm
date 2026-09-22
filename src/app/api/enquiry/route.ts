import { NextRequest, NextResponse } from "next/server";
import { sendMail, mailConfigured, renderClientEmail, renderLeadNotification, splitReplyDraft, leadPlace, dialable } from "@/lib/mail";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { enquiriesDb, newReference } from "@/lib/enquiries";
import { score } from "@/lib/diagnosticScoring";
import { triageEnquiry, toAscii, signalOf, noFitColumn, declaredBudget } from "@/lib/diagnosticTriage";
import { notifyTelegram } from "@/lib/notify";
import { serverTrack } from "@/lib/serverTrack";
import { adsConversion } from "@/lib/openaiAds";
import { readAttribution, attributionLabel, attributionSource } from "@/lib/attribution";
import { repairPostedPhone } from "@/lib/phone";
import { SITE_URL } from "@/lib/seo";
import { STEP1, ROUTER, BRANCHES, TOOLS, MAGIC, STEP5, CONTACT, type Question } from "@/content/diagnostic";
import { LINE_LABEL, PRICE_FIT, STANDARD_PRICE, labelFor } from "@/lib/diagnostic/answers";
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

// The service names, the price bands and the option labels live in
// lib/diagnostic/answers.ts. This route writes the lead e-mail and the lead
// page reads the same module, so the page can never quote a price the e-mail
// did not (docs/lead-page-spec.md §12).

// The same bands in plain ASCII, for the model only. The label the visitor
// picked ("€3,500–7,000") carries a euro sign and an en dash, and typographic
// characters in the model input are the proven cause of the corrupted French
// Radu received. The pretty label still goes in the email and the Telegram push.
const BUDGET_FOR_MODEL: Record<string, string> = {
  "<1500": "under 1,500 EUR",
  "1500-3500": "1,500-3,500 EUR",
  "3500-7000": "3,500-7,000 EUR",
  "7000+": "7,000 EUR and up",
  // No entry for "unsure" and none for a missing answer: "not decided yet"
  // read to the model as a soft answer, and it priced a two-phase proposal on
  // top of it (DM-JED9Y). A budget that was not given now says NOT GIVEN.
};

// Telegram refuses a message over 4,096 characters, and the push now carries
// the magic-wand answer as well as the draft. The textarea has no maximum
// length, so one talkative visitor could cost the whole speed-to-lead alert.
const TG_MAGIC_MAX = 400;
const TG_MAX = 3_900;

/** The first value that is a two-letter country code, upper-cased; null when none is. */
function readCountryHint(...values: unknown[]): string | null {
  for (const v of values) {
    const s = String(v ?? "").trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(s)) return s;
  }
  return null;
}

/**
 * The browser's own time zone, kept for the lead page's "their local hour".
 * Shape only — a zone name is letters, digits and the separators of an IANA
 * id, nothing else. Anything odd is dropped rather than stored.
 */
function readTimeZoneHint(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s.length >= 3 && s.length <= 64 && /^[A-Za-z0-9_+\-/]+$/.test(s) ? s : null;
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
    // What the visitor's own browser says about where they are. The wizard
    // reads both behind the phone field (time zone first, then the browser
    // languages) and posts them with the form; nothing is looked up, nothing
    // third-party is called. `phoneCountry` is the older name for the country
    // and is still the one the wizard sends.
    //
    // They are hints, and the lead page treats them as hints: a number that
    // can be dialled outranks them. But they are the ONLY thing allowed to
    // name a country when there is no usable number — the page language never
    // is, which is how three Quebec leads came to be filed as French.
    phoneCountry?: unknown; // ISO2, e.g. "CA"
    browserCountry?: unknown; // the same value under its real name
    browserTz?: unknown; // IANA time zone, e.g. "America/Toronto"
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
  // One reading of "there is not enough here", computed from the rules' own
  // flag and from the answers, shared by the prompt, the guards and the e-mail.
  const signal = signalOf(answers as Record<string, unknown>, scoring);

  // Labelled answers (EN labels), kept as data rather than one string: the
  // email picks out the facts that decide the sale and leaves the rest for the
  // bottom of the message, and the model gets the same thing as prose.
  const magic = String(answers.magic ?? "").trim();
  // `freeText` = show it under "their own words"; `typed` = the visitor wrote
  // these characters, so they go to the model exactly as written (a question
  // with no options - the site address, for one - is typed even though it is
  // not free text, and de-accenting a domain makes it a different domain).
  const entries: { id: string; label: string; value: string; freeText: boolean; typed: boolean }[] = [];
  for (const [id, v] of Object.entries(answers)) {
    if (["firstName", "email", "company", "phone", "magic"].includes(id)) continue;
    const q = BY_ID.get(id.replace(/_other$/, ""));
    if (!q) continue;
    if (id.endsWith("_other")) {
      entries.push({ id, label: `${q.en} (other)`, value: String(v).slice(0, 500), freeText: true, typed: true });
      continue;
    }
    const vals = Array.isArray(v) ? v.map((x) => labelFor(q, String(x))).join(", ") : labelFor(q, String(v));
    entries.push({ id, label: q.en, value: vals, freeText: false, typed: !q.options?.length });
  }
  const answerOf = (id: string): string => entries.find((e) => e.id === id)?.value ?? "";

  const company = String(answers.company ?? "").trim().slice(0, 200);
  // The address can come from three questions: the general one on the last
  // step, and the branch fields of the website and the security branches.
  // Reading only `site` told Radu "Website: not given" and showed the model an
  // empty website while the visitor had typed the URL two screens earlier.
  const website = ([answers.site, answers.C_url, answers.E_url]
    .map((v) => String(v ?? "").trim())
    .find((v) => v !== "") ?? "").slice(0, 300);
  const budgetId = String(answers.budget ?? "").trim();
  const budgetLabel = answerOf("budget");
  const priceFit = PRICE_FIT[budgetId] ?? STANDARD_PRICE;

  // The model is shown who this is: without the first name every "ready-to-send"
  // draft opened with a bare "Bonjour,", and without the budget it quoted the
  // floor price of the grid to a prospect who had declared several thousand.
  // "How did you hear about us" is left out: it changes nothing and the one
  // real lead's answer contradicted the ad tag we already had.
  //
  // OUR strings go to the model in ASCII (question labels and the option
  // labels we wrote are the same class of text as the prompt itself, and
  // typographic characters in them are the proven cause of the corrupted
  // French). THEIR strings - the magic wand and every answer they typed
  // themselves - go verbatim, accents and all: that is what the reply draft
  // has to echo back, and a de-accented domain is a different domain.
  const modelAnswers = [
    magic ? `MAGIC WAND (their own words):\n"${magic}"\n` : null,
    ...entries
      .filter((e) => e.id !== "source")
      .map((e) => `${toAscii(e.label)}: ${e.typed ? e.value : toAscii(e.value)}`),
  ]
    .filter((l): l is string => !!l)
    .join("\n");

  // LLM triage — reads the free text the rules can't. Rule scoring is the fallback.
  const triage = await triageEnquiry(
    { firstName, company, website, budgetId, budget: BUDGET_FOR_MODEL[budgetId] ?? "", magic, answers: modelAnswers },
    scoring,
    locale,
    signal,
  );
  // An empty proposal from the triage is an ANSWER: it read the free text the
  // rules cannot and found nothing it could honestly name. It is stored as "-"
  // and the results screen shows the self-serve tips instead of a guess.
  const proposed = triage ? triage.proposed : scoring.proposed;
  // The price line reaches Radu with no model involved, so it is gated here
  // too: nothing that says "quote 2,000-3,500" is printed beside a triage that
  // just said it does not know what fits.
  const priceForMail = !triage || triage.fit === "fits" ? priceFit : undefined;
  const noFit = triage ? noFitColumn(triage) : null;

  const reference = newReference();
  const attr = readAttribution(body.attribution);
  if (!attr.oppref && typeof body.oppref === "string") attr.oppref = body.oppref;
  const via = attributionLabel(attr);
  // Stored on the enquiry AND on the lead: a lead with no usable number has
  // nothing else that can say where its person is, and the page would rather
  // print "Not known" than the page language wearing a country's clothes.
  const browserCountry = readCountryHint(body.browserCountry, body.phoneCountry);
  const browserTz = readTimeZoneHint(body.browserTz);
  // The check-up now posts an E.164 number, but a page cached before that
  // deploy still posts whatever was typed ("15817015976", the 18 Sep 2026
  // lead). Repair what can be repaired and keep the rest exactly as typed:
  // this never throws and never refuses, so a badly written number cannot
  // cost us the lead, and `answers` keeps the original either way.
  const phone = repairPostedPhone(answers.phone, {
    country: browserCountry,
    dial: typeof body.phoneDial === "string" ? body.phoneDial : null,
  }).slice(0, 50);
  // Still read and still stored for the historical rows; the question itself
  // is gone, so new rows store null.
  const source = String(answers.source ?? "").trim().slice(0, 100);
  // "I do not have one yet" is an answer. An empty box is not, and the e-mail
  // is allowed to tell the two apart.
  const companyNone = String(answers.companyNone ?? "").trim();

  try {
    // The triage's questions for the call, its line of what we still do not
    // know and its honest "nothing we sell fits" used to exist for the length
    // of one email and then be gone: the lead page had no way to show Radu
    // what to ask on a call he had already booked. They are columns now.
    enquiriesDb()
      .prepare(
        `INSERT INTO enquiries (reference, locale, answers, scores, proposed, grade, urgent, flagged, first_name, email, company, phone, source, ip, reply_draft, note_for_radu, subject_summary, source_utm, attribution, call_questions, unknowns, no_fit, browser_country, browser_tz)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        reference, locale, JSON.stringify(answers), JSON.stringify(scoring.scores),
        proposed.join("+") || "-", scoring.grade, scoring.urgent ? 1 : 0, flagged ? 1 : 0,
        firstName, email, company || null, phone || null, source || null, ip,
        // An empty draft means it failed its checks (no first name, or not
        // signed by Radu): that is NO draft, and the column has to say so.
        triage?.replyDraft || null, triage?.noteForRadu ?? null, triage?.subjectSummary ?? null,
        attributionSource(attr) || null, Object.keys(attr).length ? JSON.stringify(attr) : null,
        triage?.callQuestions?.length ? JSON.stringify(triage.callQuestions) : null,
        triage?.unknowns?.trim() || null,
        noFit,
        browserCountry, browserTz,
      );
  } catch (e) {
    console.error("enquiry db insert failed", e);
    return NextResponse.json({ ok: false, error: "server" }, { status: 500 });
  }

  // @@crm:inbox
  const lead = leadFromEnquiry({ reference, locale, firstName, email, company, phone, attr, ip, browserCountry, browserTz });

  // Where they are, as far as the evidence goes: the dial code of the number
  // they typed, then the country the browser reported behind the phone field.
  // NOT the CRM lead row's country: `insertLead` defaults that column to
  // `countryForLocale(locale)` whenever the number carries no dial code, so
  // reading it back would announce a Quebec restaurant to Radu as French and
  // send him calling six time zones off.
  const place = leadPlace({ phone, country: browserCountry });
  const e164 = dialable(phone);
  const crmUrl = lead ? `${SITE_URL}/admin/leads/${lead.reference}` : undefined;

  serverTrack("diagnostic_completed", { grade: scoring.grade, proposed: proposed.join("+") || "-", locale, source: attributionSource(attr) || "direct" });
  // ChatGPT Ads conversion — only fires when the visitor landed from an ad (?oppref=).
  adsConversion("lead_created", { id: reference, sourceUrl: `${SITE_URL}/${locale}/diagnostic`, oppref: attr.oppref });

  // ---- Telegram push (speed-to-lead: reply from your phone in minutes) ----
  // Same order as the email: who, where, how to reach them, their own words,
  // then the draft. A number that cannot be dialled says so instead of being
  // printed as if it could.
  const tgMagic = magic.length > TG_MAGIC_MAX ? `${magic.slice(0, TG_MAGIC_MAX).trimEnd()} [...]` : magic;
  const tgLines = [
    `🔔 ${scoring.grade}${scoring.urgent ? " · URGENT" : ""} lead — ${reference}`,
    `${firstName}${company ? ` · ${company}` : ""}${place ? ` · ${place}` : ""}`,
    // The band they tapped, or the plain statement that there is none. The
    // "unsure" chip is not a budget and must never read like one on a phone.
    `→ ${proposed.map((p) => LINE_LABEL[p]).join(" + ") || "?"} · ${declaredBudget(budgetId) && budgetLabel ? budgetLabel : "budget not stated"}`,
    e164 ? `📞 ${e164}` : phone ? `📞 ${phone} (not dialable as stored)` : null,
    `✉️ ${email}`,
    via ? `📣 via ${via}` : null,
    tgMagic ? `\n— their own words —\n"${tgMagic}"` : null,
    triage?.replyDraft ? `\n— ready reply —\n${triage.replyDraft}` : null,
    crmUrl ? `\n${crmUrl}` : null,
  ].filter(Boolean);
  const tgText = tgLines.join("\n");
  notifyTelegram(tgText.length > TG_MAX ? `${tgText.slice(0, TG_MAX)}\n[...]` : tgText);

  // ---- Triage email to Radu (best-effort; the enquiry is already stored) ----
  if (mailConfigured()) {
    // One subject for the visitor's confirmation and for the reply Radu sends
    // in one tap, so the two sit in the same thread. No em dash: a prospect
    // reads this one.
    const checkupSubject =
      locale === "fr"
        ? `Votre check-up numérique (${reference})`
        : `Your digital check-up (${reference})`;
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
        { label: "Tools today", value: answerOf("tools") || "none picked" },
        { label: "Website", value: website || "not given" },
      ],
      propose: {
        lines: proposed.map((p) => LINE_LABEL[p]).join(" + ") || "(none scored)",
        why: triage?.noteForRadu,
        price: priceForMail,
        noFit: noFit ?? undefined,
      },
      callQuestions: triage?.callQuestions,
      unknowns: triage?.unknowns,
      reply: triage?.replyDraft ? splitReplyDraft(triage.replyDraft, checkupSubject) : undefined,
      detail: entries.map((e) => ({ label: e.label, value: e.value })),
      diagnostics: [
        { label: "Rule scores", value: Object.entries(scoring.scores).filter(([, v]) => v !== 0).map(([k, v]) => `${k}:${v}`).join("  ") || "-" },
        { label: "Urgency", value: `${scoring.urgency}/5` },
        { label: "Flags", value: scoring.flags.join(", ") || "-" },
        // "Heard about us" is gone: 6 of 7 rows carried utm_source=chatgpt
        // automatically, the one self-report that differed was wrong, and
        // "Attribution" right below says the same thing from data.
        ...(company
          ? []
          : [{ label: "Business name", value: companyNone === "none" ? "they have none yet (they said so)" : "not given" }]),
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
    // The same promise as the results screen they have just read: Radu himself,
    // by name, within one working day. "Notre équipe" for a one-person studio
    // read as a call centre, and "1 jour ouvré" is not what a Quebec reader
    // says. Signed by him, like the reply draft.
    const ack =
      locale === "fr"
        ? {
            subject: checkupSubject,
            title: `Merci ${firstName}, votre check-up est bien arrivé`,
            paragraphs: [
              "C'est Radu, le fondateur de Digital M, qui le lit lui-même et vous répond sous 1 jour ouvrable, avec des pistes concrètes.",
              "Envie d'aller plus vite ? Réservez directement un appel gratuit de 30 minutes :",
            ],
            cta: { label: "Réserver un appel gratuit", url: "https://digitalm.eu/fr/book" },
            footnote: `Votre référence : ${reference}. Mentionnez-la si vous souhaitez un jour que vos données soient supprimées.`,
            text: `Bonjour ${firstName},\n\nMerci pour votre check-up. C'est Radu, le fondateur de Digital M, qui le lit lui-même et vous répond sous 1 jour ouvrable, avec des pistes concrètes.\n\nEnvie d'aller plus vite ? Réservez un appel gratuit de 30 minutes : https://digitalm.eu/fr/book\n\nVotre référence : ${reference} (mentionnez-la si vous souhaitez que vos données soient supprimées).\n\nÀ très vite,\nRadu, Digital M\ndigitalm.eu`,
          }
        : {
            subject: checkupSubject,
            title: `Thanks ${firstName}, your check-up has arrived`,
            paragraphs: [
              "I am Radu, the founder of Digital M. I read every check-up myself and will reply within 1 working day, with concrete suggestions.",
              "Want to move faster? Book a free 30-minute call directly:",
            ],
            cta: { label: "Book a free call", url: "https://digitalm.eu/en/book" },
            footnote: `Your reference: ${reference}. Quote it if you ever want your data deleted.`,
            text: `Hi ${firstName},\n\nThanks for completing the check-up. I am Radu, the founder of Digital M, and I read every one myself. You will hear back from me within 1 working day, with concrete suggestions.\n\nWant to move faster? Book a free 30-minute call: https://digitalm.eu/en/book\n\nYour reference: ${reference} (quote it if you ever want your data deleted).\n\nSpeak soon,\nRadu, Digital M\ndigitalm.eu`,
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
