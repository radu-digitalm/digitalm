// U4 — the triage guard and the lead email Radu acts on.
//
// The mangled fixtures below are verbatim from the staging enquiries database
// (/home/hermes/data/enquiries-staging.db, rows DM-NXNX2, DM-NM89W, DM-V8NMN,
// DM-NG93X, DM-N7WWD). The old guard returned false on every one of them, so
// the retry and the fallback never ran and the text reached the visitor's
// screen and Radu's inbox as it is written here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTriagePrompt, isMangled, repairMangled, toAscii, TriageSchema } from "./diagnosticTriage.ts";
import { leadPlace, renderLeadNotification, splitReplyDraft } from "./mail.ts";

const MANGLED = {
  // DM-NM89W, subject line: control characters where the separators belong.
  subject: "automatisation prise de réservations \x0295h/sem \x02900\x0200 \x00b7 d\x00e8s 1j",
  // DM-NXNX2, note: "cherche à supprimer", "des infos".
  note: "Cette personne travaille seule, ne vend pas en ligne, et cherche \x0e0 supprimer la ressaisie multiple d\x00e9s infos dans plusieurs outils.",
  // DM-NXNX2, reply draft: "indiqué", "mêmes".
  draft: "Vous nous avez indiqu\x00e9 que vous ressaisissez les m\x00eames informations dans plusieurs outils.",
  // DM-V8NMN, reply draft: uppercase hex, and an apostrophe written as an escape.
  upper: "J\x0027ai bien not\x00E9 que vous perdez du temps \x00E0 ressaisir les m\x00EAmes informations.",
  // DM-V8NMN, note: two digits survived, so the code point is 0x0153 (oe).
  oe: "Ce prospect est seul, avec trop de ressaisies d\x0153uvres manuelles.",
  // DM-NG93X, note: a tab standing in for the letter itself. Nothing to rebuild from.
  tabs: "Le prospect semble int\tress\t par une simulation li\te \x0e0 des pages en cache.",
  // DM-N7WWD, subject: controls that map to nothing printable.
  noise: "relances factures + suivi client \x034 automatisation \x0b 2-3j \x0b 0,8-1,2k",
};

const CLEAN = [
  "Vous perdez du temps à ressaisir les mêmes informations dans plusieurs outils, surtout pour les devis et les factures.",
  "Objet : proposition d'automatisation pour vos devis\n\nBonjour Marc,\n\nVoici deux options.\n\nRadu, Digital M",
  "Les eaux usées de l'atelier, c'est 5 h par semaine.",
  "automatisation ressaisie, 1-3j, moins de 1,5k",
  "They lose about 10 bookings a week and want to start in 1-3 months.",
];

test("isMangled catches the real corrupted rows, which the old guard missed", () => {
  for (const [name, s] of Object.entries(MANGLED)) {
    assert.equal(isMangled(s), true, `${name} should be detected`);
    // The old rule: a SPACE followed by a hex pair. This is why it never fired.
    const oldRule = /(?:^|\s)(?:[ec][0-9]|f[49]|a0)(?=[a-z\xe0-\xff])/i.test(s);
    if (name !== "legacy") assert.equal(oldRule, false, `${name} is not a space + hex pair`);
  }
});

test("isMangled leaves clean French and English alone", () => {
  for (const s of CLEAN) assert.equal(isMangled(s), false, `false positive on: ${s.slice(0, 40)}`);
  assert.equal(isMangled(""), false);
  assert.equal(isMangled("line one\nline two\r\nand a\ttabbed column"), false);
});

test("isMangled still catches the legacy forms", () => {
  assert.equal(isMangled("des factures impay e9es depuis mars"), true);
  assert.equal(isMangled("des factures impay\\xe9es depuis mars"), true);
});

test("repairMangled rebuilds the accented letters and leaves no control character", () => {
  const draft = repairMangled(MANGLED.draft);
  assert.equal(draft.repaired, true);
  assert.equal(draft.damaged, false);
  assert.match(draft.text, /Vous nous avez indiqué que vous ressaisissez les mêmes informations/);

  const upper = repairMangled(MANGLED.upper);
  assert.equal(upper.damaged, false);
  assert.match(upper.text, /J'ai bien noté que vous perdez du temps à ressaisir les mêmes/);

  const note = repairMangled(MANGLED.note);
  assert.match(note.text, /cherche à supprimer la ressaisie multiple/);

  const oe = repairMangled(MANGLED.oe);
  assert.match(oe.text, /ressaisies dœuvres manuelles/);

  for (const [name, s] of Object.entries(MANGLED)) {
    const out = repairMangled(s).text;
    for (let i = 0; i < out.length; i++) {
      const code = out.charCodeAt(i);
      const ok = code >= 0x20 || code === 9 || code === 10 || code === 13;
      assert.ok(ok, `${name} still carries a control character at ${i}`);
    }
  }
});

test("repairMangled reports what it could not rebuild, so the caller retries", () => {
  assert.equal(repairMangled(MANGLED.tabs).damaged, true, "a tab standing in for a letter is unrecoverable");
  assert.equal(repairMangled(MANGLED.noise).damaged, true, "controls that map to nothing are unrecoverable");
  // Recoverable damage is not a reason to throw the whole answer away.
  assert.equal(repairMangled(MANGLED.draft).damaged, false);
});

test("repairMangled repairs the legacy forms and touches nothing else", () => {
  assert.equal(repairMangled("des factures impay e9es depuis mars").text, "des factures impayées depuis mars");
  assert.equal(repairMangled("des factures impay\\xe9es depuis mars").text, "des factures impayées depuis mars");
  for (const s of CLEAN) {
    const r = repairMangled(s);
    assert.equal(r.repaired, false, `clean text was rewritten: ${s.slice(0, 40)}`);
    assert.equal(r.text, s);
  }
  assert.deepEqual(repairMangled(""), { text: "", repaired: false, damaged: false });
});

// ---------------------------------------------------------------------------
// The lead email
// ---------------------------------------------------------------------------

test("leadPlace reads the dial code first, then the CRM row", () => {
  assert.equal(leadPlace({ phone: "+14185550199", country: "FR" }), "Quebec, Canada");
  assert.equal(leadPlace({ phone: "+16135550199" }), "Ontario, Canada");
  assert.equal(leadPlace({ phone: "+33612345678" }), "France");
  assert.equal(leadPlace({ phone: "4187172114", country: "CA" }), "Canada");
  assert.equal(leadPlace({ phone: "", country: "GB" }), "United Kingdom");
  assert.equal(leadPlace({}), null);
});

test("splitReplyDraft lifts the subject line out of the draft", () => {
  const { subject, body } = splitReplyDraft("Objet : Automatiser vos relances\n\nBonjour Marc,\n\nVoici.", "fallback");
  assert.equal(subject, "Automatiser vos relances");
  assert.equal(body, "Bonjour Marc,\n\nVoici.");
  const none = splitReplyDraft("Bonjour Marc,\n\nVoici.", "fallback");
  assert.equal(none.subject, "fallback");
  assert.equal(none.body, "Bonjour Marc,\n\nVoici.");
});

const FULL = {
  reference: "DM-C4DQ3",
  grade: "A",
  urgent: false,
  locale: "fr" as const,
  firstName: "Jojo",
  company: "Le Chaudron",
  email: "jojo@lechaudron.ca",
  phone: "+14185550199",
  place: "Quebec, Canada",
  summary: "relances factures + suivi client, 2-3j",
  crmUrl: "https://digitalm.eu/admin/leads/LD-VQKA5",
  ownWords: [{ label: "Magic wand", text: "Courir après les factures impayées." }],
  facts: [
    { label: "What they do", value: "Restaurant / hospitality" },
    { label: "Budget", value: "€3,500-7,000" },
  ],
  propose: { lines: "Process automation + Customer follow-up (CRM)", why: "Ils perdent 10 réservations par semaine.", price: "€3,500-7,000" },
  callQuestions: ["Combien de réservations par semaine ?", "Qui répond au téléphone aujourd'hui ?"],
  unknowns: "no website, volume unknown",
  reply: { subject: "Automatiser vos relances", body: "Bonjour Jojo,\n\nVoici deux options.\n\nRadu, Digital M" },
  detail: [{ label: "Which tools do you use day-to-day?", value: "Mostly paper, honestly" }],
  diagnostics: [{ label: "IP", value: "203.0.113.7" }],
};

test("renderLeadNotification puts everything Radu needs in the subject and the text", () => {
  const { subject, text, html } = renderLeadNotification(FULL);
  assert.match(subject, /^\[DM-C4DQ3\] A - Jojo, Le Chaudron \(Quebec, Canada\) - relances factures/);
  // Their own words, the reference and the address are the three things that
  // must survive in the plain-text alternative (Telegram shows that one).
  assert.match(text, /DM-C4DQ3/);
  assert.match(text, /jojo@lechaudron\.ca/);
  assert.match(text, /Courir après les factures impayées\./);
  assert.match(text, /tel:\+14185550199/);
  assert.match(text, /mailto:jojo%40lechaudron\.ca\?subject=/);
  assert.match(text, /Quebec, Canada/);
  assert.match(text, /THE DETAIL/);
  // Their own words come before any AI text.
  assert.ok(text.indexOf("Courir après") < text.indexOf("Ils perdent 10"), "own words must come first");
  // The noise is at the bottom.
  assert.ok(text.indexOf("203.0.113.7") > text.indexOf("READY-TO-SEND REPLY"), "the detail goes last");
  assert.match(html, /href="tel:\+14185550199"/);
  assert.match(html, /Send this reply/);
  assert.match(html, /LD-VQKA5/);
});

test("renderLeadNotification survives no phone, no company and no website", () => {
  const { subject, text, html } = renderLeadNotification({
    reference: "DM-33HHH",
    grade: "B",
    locale: "en",
    firstName: "Sam",
    email: "sam@example.com",
    summary: "one small automation, exploring",
    ownWords: [{ label: "Magic wand", text: "Re-typing orders into two systems." }],
    facts: [{ label: "Budget", value: "not stated" }],
    propose: { lines: "Process automation" },
  });
  assert.match(subject, /^\[DM-33HHH\] B - Sam - one small automation/);
  assert.match(text, /Phone: not given/);
  assert.match(text, /no business name given/);
  assert.match(text, /Re-typing orders into two systems\./);
  assert.ok(!/tel:/.test(html), "no tel: link without a number");
  assert.match(html, /No phone number given\./);
});

test("renderLeadNotification says so plainly when the number cannot be dialled", () => {
  const { text, html } = renderLeadNotification({
    reference: "DM-VTX99",
    grade: "C",
    locale: "fr",
    firstName: "Luc",
    email: "luc@example.fr",
    phone: "4187172114",
  });
  assert.match(text, /not dialable as stored \("4187172114"\)/);
  assert.ok(!/tel:/.test(html), "an undialable number is never printed as a link");
});

test("renderLeadNotification works with no AI answer at all", () => {
  const { subject, text, html } = renderLeadNotification({
    reference: "DM-N7WWD",
    grade: "C",
    locale: "fr",
    firstName: "Claire",
    email: "claire@example.fr",
    place: "France",
    ownWords: [{ label: "Baguette magique", text: "Arrêter de recopier les devis à la main." }],
    facts: [{ label: "Budget", value: "Moins de 1 500 €" }],
    propose: { lines: "Process automation", price: "under €1,500" },
    detail: [{ label: "When would you like to start?", value: "As soon as possible" }],
    diagnostics: [{ label: "AI triage", value: "unavailable - rules only" }],
  });
  assert.match(subject, /^\[DM-N7WWD\] C - Claire \(France\) - Process automation/);
  assert.match(text, /DM-N7WWD/);
  assert.match(text, /claire@example\.fr/);
  assert.match(text, /Arrêter de recopier les devis à la main\./);
  assert.match(text, /the AI triage did not answer/i);
  assert.match(html, /did not answer/);
});

// ---------------------------------------------------------------------------
// The repair must never be wider than the guard
//
// The first version of this pass rewrote clean model output: it accepted any
// hex-looking pair with no corruption signal at all, swallowed the space, and
// since the result carried no control character it reported the text as clean,
// so there was no retry and the mangled French shipped to the results screen.
// ---------------------------------------------------------------------------

const CLEAN_LOOKALIKES = [
  "votre boutique D2C et vos relances",
  "une approche B2B classique",
  "du C2C sur les places de marche",
  "du c2c sur les places de marche",
  "un test E2E sur le tunnel de commande",
  "nous ferons F2F la semaine prochaine",
  "le d3v est notre staging",
  "Shopify E2E puis WooCommerce",
  "de 4 000 a 6 000 EUR sur 2 a 3 semaines",
  "Phase 1 : audit. Phase 2 : mise en place.",
  "votre site https://d3v.digitalm.eu/fr",
  "il y a 5 h par semaine\tperdues",
  "factures\timpayees\trelances",
];

test("repairMangled leaves clean model output exactly as it is", () => {
  for (const s of CLEAN_LOOKALIKES) {
    const r = repairMangled(s);
    assert.equal(r.text, s, `clean text was rewritten: ${s}`);
    assert.equal(r.repaired, false, `clean text was reported as repaired: ${s}`);
    assert.equal(r.damaged, false, `clean text was reported as damaged: ${s}`);
    assert.equal(isMangled(s), false, `clean text was flagged: ${s}`);
  }
});

test("a tab between two whole words is a separator, not a broken word", () => {
  // Two words joined by a tab cost nothing to keep; calling it damage costs the
  // retry, then the rules fallback: no reply draft and no paragraph on screen.
  assert.equal(repairMangled("il y a 5 h par semaine\tperdues").damaged, false);
  assert.equal(repairMangled("5 h\tpar semaine").damaged, false);
  // A tab standing in for a letter still is damage: "int<TAB>ress" is a word
  // torn in two, not two words (staging row DM-NG93X).
  assert.equal(repairMangled("Le prospect semble int\tress\t par une simulation.").damaged, true);
  assert.equal(isMangled("il y a 5 h par semaine\tperdues"), false);
  assert.equal(isMangled("int\tress par"), true);
});

test("the legacy pair is only rebuilt where the guard calls it damage", () => {
  // Exactly the shape the guard detects: a word torn open by a space and a
  // lowercase hex pair that rebuilds into an accented letter of the same case.
  assert.equal(repairMangled("des factures impay e9es depuis mars").text, "des factures impayées depuis mars");
  assert.equal(isMangled("des factures impay e9es depuis mars"), true);
  // A capital A circumflex in the middle of a lowercase word is not French.
  assert.equal(repairMangled("du c2c sur les places").text, "du c2c sur les places");
  // Exactly one space, and it has to be the one the escape left behind inside
  // a word: no space, or a real word space as well, means nothing to rebuild.
  assert.equal(repairMangled("modee9co").text, "modee9co");
  assert.equal(repairMangled("le mode  e9co").text, "le mode  e9co");
  assert.equal(isMangled("le mode  e9co"), false);
});

// ---------------------------------------------------------------------------
// The model input is ASCII, all of it
// ---------------------------------------------------------------------------

const SCORING = {
  scores: { AGENT: 0, AUTO: 3, WEB: 0, CRM: 2, SEC: 0 },
  proposed: ["AUTO", "CRM"],
  urgency: 3,
  urgent: false,
  grade: "A",
  flags: [],
} as unknown as Parameters<typeof buildTriagePrompt>[1];

test("every schema description shown to the model is plain ASCII", () => {
  for (const [name, field] of Object.entries(TriageSchema.shape)) {
    const d = (field as { description?: string }).description ?? "";
    assert.ok(d.length > 0, `${name} has no description`);
    assert.match(d, /^[\x20-\x7e]*$/, `${name} description is not ASCII: ${d}`);
  }
});

test("the prompt is ASCII even when the answers and the budget are not", () => {
  const prompt = buildTriagePrompt(
    {
      firstName: "Jojo",
      company: "Le Chaudron",
      website: "lechaudron.ca",
      // What the route used to hand over verbatim: euro sign and en dash.
      budget: "€3,500–7,000",
      answers:
        'MAGIC WAND (their own words):\n"Arrêter de courir après les factures impayées."\n' +
        "What budget do you have in mind?: €3,500–7,000\n" +
        "Which tools do you use day-to-day?: Réservations « en ligne », œufs, 5 h/semaine…",
    },
    SCORING,
    "fr",
  );
  for (let i = 0; i < prompt.length; i++) {
    const c = prompt.charCodeAt(i);
    const ok = c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0x7e);
    assert.ok(ok, `non-ASCII ${c.toString(16)} at ${i}: ${JSON.stringify(prompt.slice(i - 20, i + 20))}`);
  }
  // ASCII, but still the same facts: the name to greet, the company, the site,
  // the band to quote against and their own words.
  assert.match(prompt, /First name \(use it in the greeting\): Jojo/);
  assert.match(prompt, /Business name: Le Chaudron/);
  assert.match(prompt, /Website: lechaudron\.ca/);
  assert.match(prompt, /Budget they declared: EUR 3,500-7,000/);
  assert.match(prompt, /Arreter de courir apres les factures impayees/);
  assert.match(prompt, /oeufs/);
  assert.match(prompt, /"en ligne"/);
});

test("toAscii keeps money and punctuation readable", () => {
  assert.equal(toAscii("€3,500–7,000"), "EUR 3,500-7,000");
  assert.equal(toAscii("1 500–3 500 €"), "1 500-3 500 EUR ");
  assert.equal(toAscii("l'œuvre « réservée » — vite…"), 'l\'oeuvre "reservee" - vite...');
  assert.equal(toAscii("plain ascii stays"), "plain ascii stays");
});

// ---------------------------------------------------------------------------
// "Where" is evidence or nothing
// ---------------------------------------------------------------------------

test("leadPlace never turns the page language into a place", () => {
  // DM-C4DQ3, exactly as it is stored: a Quebec number typed without its dial
  // code, on the French page. The CRM lead row's country column reads "FR"
  // here, because insertLead defaults it to countryForLocale("fr") whenever
  // countryFromE164 returns null. Feeding that back announced a Quebec
  // restaurant to Radu as French, so the route no longer passes it and nothing
  // else may invent a country either.
  assert.equal(leadPlace({ phone: "4187172114" }), null);
  assert.equal(leadPlace({ phone: "4187172114", country: null }), null);
  assert.equal(leadPlace({ phone: "4187172114", country: "" }), null);
  assert.equal(leadPlace({ phone: "4187172114", country: "france" }), null);
  // A country the caller can vouch for (the browser's, behind the phone field)
  // is evidence and is used; the dial code still wins when there is one.
  assert.equal(leadPlace({ phone: "4187172114", country: "ca" }), "Canada");
  assert.equal(leadPlace({ phone: "+14185550199", country: "FR" }), "Quebec, Canada");
});

test("an undialable number leaves the subject honest rather than French", () => {
  const { subject, text } = renderLeadNotification({
    reference: "DM-C4DQ3",
    grade: "A",
    locale: "fr",
    firstName: "Jojo",
    company: "Le Chaudron",
    email: "jojo@lechaudron.ca",
    phone: "4187172114",
    place: leadPlace({ phone: "4187172114" }) || undefined,
    summary: "relances factures + suivi client, 2-3j",
  });
  assert.ok(!/France/.test(subject), `the subject guessed a country: ${subject}`);
  assert.match(subject, /^\[DM-C4DQ3\] A - Jojo, Le Chaudron - relances factures/);
  assert.match(text, /Where: not known from the answers/);
});

test("a long reply draft never becomes a link a phone refuses", () => {
  const body =
    "Bonjour Jojo,\n\n" +
    "Voici ce que je propose pour vos relances de factures et votre suivi client. ".repeat(28);
  const { text, html } = renderLeadNotification({
    reference: "DM-LONG1",
    grade: "A",
    locale: "fr",
    firstName: "Jojo",
    email: "jojo@lechaudron.ca",
    reply: { subject: "Automatiser vos relances", body },
  });
  const link = text.split("\n").find((l) => l.startsWith("mailto:")) ?? "";
  assert.ok(link.length > 0, "the text version still carries a mailto link");
  assert.ok(link.length < 1_300, `the plain-text link is ${link.length} characters long`);
  assert.ok(!link.includes("&body="), "a 2,000-character draft is not pasted into the text link");
  // The draft itself is still there in full, ready to copy.
  assert.ok(text.includes("Voici ce que je propose pour vos relances"));
  assert.match(text, /too long to pre-fill/);
  // The HTML part is read in a mail client, which copes with a longer link, so
  // the one-tap reply survives there: that is the whole point of the button.
  assert.match(html, /Send this reply/);
});

test("a short reply draft is still pre-filled in one tap", () => {
  const { text, html } = renderLeadNotification(FULL);
  const link = text.split("\n").find((l) => l.startsWith("mailto:")) ?? "";
  assert.match(link, /&body=Bonjour%20Jojo/);
  assert.match(html, /Send this reply/);
});
