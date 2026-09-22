// U4 — the triage guard and the lead email Radu acts on.
//
// The mangled fixtures below are verbatim from the staging enquiries database
// (/home/hermes/data/enquiries-staging.db, rows DM-NXNX2, DM-NM89W, DM-V8NMN,
// DM-NG93X, DM-N7WWD). The old guard returned false on every one of them, so
// the retry and the fallback never ran and the text reached the visitor's
// screen and Radu's inbox as it is written here.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_FIGURES,
  buildSubject,
  buildTriagePrompt,
  checkTriage,
  declaredBudget,
  fallbackDraft,
  finalizeTriage,
  isMangled,
  moneyFigures,
  moneyTokens,
  noFitColumn,
  repairMangled,
  sanitizeLeadText,
  signalOf,
  stripMoney,
  toAscii,
  TriageAskSchema,
  TriageProposeSchema,
} from "./diagnosticTriage.ts";
import type { Signal, Triage, TriageLead } from "./diagnosticTriage.ts";
import { score } from "./diagnosticScoring.ts";
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
  // The model writes the escape in either case, so the guard reads both.
  assert.equal(isMangled("des factures impay E9es depuis mars"), true);
  assert.equal(repairMangled("des factures impay E9es depuis mars").text, "des factures impayées depuis mars");
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
  // A literal "@" in the addr-spec (RFC 6068), like the HTML button beside it.
  assert.match(text, /mailto:jojo@lechaudron\.ca\?subject=/);
  assert.match(html, /href="mailto:jojo@lechaudron\.ca"/);
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
  assert.match(text, /did not answer|did not pass its checks/i);
  assert.match(html, /did not answer|did not pass its checks/i);
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
// The model input: everything WE wrote is ASCII, everything THEY wrote is not
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
  for (const schema of [TriageProposeSchema, TriageAskSchema]) {
    for (const [name, field] of Object.entries(schema.shape)) {
      const d = (field as { description?: string }).description ?? "";
      assert.ok(d.length > 0, `${name} has no description`);
      assert.match(d, /^[\x20-\x7e]*$/, `${name} description is not ASCII: ${d}`);
    }
  }
});

test("the thin schema has no priced field at all", () => {
  // The guarantee is structural: a field that does not exist cannot be filled
  // in. DM-JED9Y got a two-phase priced proposal out of a form he answered
  // with a trade, a headcount and a mood.
  assert.ok(!("proposed" in TriageAskSchema.shape), "the ask schema must not be able to propose");
  assert.ok("proposed" in TriageProposeSchema.shape);
  for (const schema of [TriageProposeSchema, TriageAskSchema]) {
    const descriptions = Object.values(schema.shape).map((f) => (f as { description?: string }).description ?? "");
    for (const d of descriptions) assert.deepEqual(moneyTokens(d), [], `a schema description names a figure: ${d}`);
  }
});

test("every line we wrote for the model is plain ASCII", () => {
  // The lead here is ASCII from end to end, so anything non-ASCII left in the
  // result was written by us - and typographic characters in OUR strings are
  // the proven cause of the corrupted French Radu received.
  const prompt = buildTriagePrompt(
    {
      firstName: "Jojo",
      company: "Le Chaudron",
      website: "lechaudron.ca",
      budgetId: "3500-7000",
      // What the route used to hand over verbatim: euro sign and en dash.
      budget: "€3,500–7,000",
      answers: "Which tools do you use day-to-day?: paper and WhatsApp\nSize: just me",
    },
    SCORING,
    "fr",
  );
  for (let i = 0; i < prompt.length; i++) {
    const c = prompt.charCodeAt(i);
    const ok = c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0x7e);
    assert.ok(ok, `non-ASCII ${c.toString(16)} at ${i}: ${JSON.stringify(prompt.slice(i - 20, i + 20))}`);
  }
  assert.match(prompt, /Budget: EUR 3,500-7,000/);
  assert.match(prompt, /Rule-based scoring suggested: AUTO\+CRM/);
  assert.match(prompt, /MONEY RULES/);
});

test("the person's own spelling reaches the model untouched", () => {
  // De-accenting the lead block is how the "ready-to-send" draft came to greet
  // Helene as "Helene" and to quote a domain she never typed: the same defect
  // as the bare "Bonjour," it was supposed to fix.
  const prompt = buildTriagePrompt(
    {
      firstName: "Hélène",
      company: "Café Déjà Vu",
      website: "https://crèmerie-québec.ca",
      budgetId: "3500-7000",
      budget: "3,500-7,000 EUR",
      answers:
        'MAGIC WAND (their own words):\n"Je perds 5 h par semaine à ressaisir les réservations du téléphone."\n' +
        "Which tools do you use day-to-day? (other): Réservations « en ligne », œufs frais…",
    },
    SCORING,
    "fr",
  );
  assert.match(prompt, /First name \(use it in the greeting, spelled exactly like this\): Hélène/);
  assert.match(prompt, /Business name: Café Déjà Vu/);
  assert.match(prompt, /Website \(quote it exactly as written\): https:\/\/crèmerie-québec\.ca/);
  assert.match(prompt, /à ressaisir les réservations du téléphone/);
  assert.match(prompt, /Réservations « en ligne », œufs frais…/);
  assert.ok(!prompt.includes("Helene"), "the name the draft greets was de-accented");
  assert.ok(!prompt.includes("Cafe Deja Vu"), "the business name was de-accented");
  assert.ok(!prompt.includes("cremerie-quebec"), "the website became a different domain");
  // Their text still cannot smuggle in the very characters we hunt in the output.
  for (let i = 0; i < prompt.length; i++) {
    const c = prompt.charCodeAt(i);
    assert.ok(c >= 0x20 || c === 9 || c === 10 || c === 13, `control character at ${i}`);
  }
});

test("sanitizeLeadText keeps every letter they typed and drops only the impossible", () => {
  assert.equal(sanitizeLeadText("Hélène"), "Hélène"); // composed, not stripped
  assert.equal(sanitizeLeadText("Café Déjà Vu"), "Café Déjà Vu");
  assert.equal(sanitizeLeadText("Jo\x00jo\x7f"), "Jojo");
  assert.equal(sanitizeLeadText("deux lignes\net une\ttabulation"), "deux lignes\net une\ttabulation");
  assert.equal(sanitizeLeadText(""), "");
});

test("a first name on several lines cannot break the prompt apart", () => {
  const prompt = buildTriagePrompt(
    { firstName: "Léa\nBudget: 500 EUR", company: "", website: "", budget: "", answers: "Size: just me" },
    SCORING,
    "fr",
  );
  assert.match(prompt, /First name \(use it in the greeting, spelled exactly like this\): Léa Budget: 500 EUR\n/);
  // The real line is still there, below, and still says the truth.
  assert.match(prompt, /\nBudget: NOT GIVEN\n/);
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

test("a draft the size of the real ones pre-fills in the text part too", () => {
  // The ten drafts stored on staging run 913 to 1,284 characters, which
  // percent-encode to 1,364-1,965: under the old 1,200-character cap the text
  // alternative - the one Telegram shows - dropped the body of every single
  // one and told Radu it was "too long to pre-fill".
  const body =
    "Bonjour Jojo,\n\nMerci pour votre check-up. " +
    "Vous perdez du temps a relancer vos factures a la main, et c'est exactement ce que nous automatisons. ".repeat(11) +
    "\n\nRadu, Digital M";
  assert.ok(body.length > 900 && body.length < 1_300, `fixture is ${body.length} characters, not a realistic draft`);
  const { text } = renderLeadNotification({
    ...FULL,
    reply: { subject: "Automatiser vos relances", body },
  });
  const link = text.split("\n").find((l) => l.startsWith("mailto:")) ?? "";
  assert.match(link, /&body=Bonjour%20Jojo/, "the real-size draft is still dropped from the text link");
  assert.match(text, /Send that reply in one tap/);
  assert.ok(!/too long to pre-fill/.test(text));
});

test("a draft that is only a subject line says so instead of blaming its length", () => {
  const { subject, body } = splitReplyDraft("Objet : Rien de plus", "fallback");
  assert.equal(subject, "Rien de plus");
  assert.equal(body, "");
  const mail = renderLeadNotification({ ...FULL, reply: { subject, body } });
  assert.match(mail.text, /subject line only/);
  assert.ok(!/too long to pre-fill/.test(mail.text), "an empty body is not a long one");
  assert.match(mail.text, /Subject: Rien de plus/);
  assert.match(mail.html, /subject line only/);
  assert.match(mail.html, /write the reply yourself/);
});

// ---------------------------------------------------------------------------
// U2 — the money, the thin signal and the guarantees on the draft
//
// The five fixtures below are the answers payloads of the five real check-ups
// in production (/home/hermes/data/enquiries.db, read-only), copied verbatim.
// DM-JED9Y is the one Radu complained about: every rule scored zero and he
// still received "1.500-3.500 EUR" in the subject line and a priced two-phase
// proposal. He is a solo social worker who ticked "je me renseigne".
// ---------------------------------------------------------------------------

const REAL: Record<string, Record<string, unknown>> = {
  // Alberto: nothing but a trade, a headcount and a mood.
  "DM-JED9Y": {
    activity: "other", activity_other: "Travail social", sellsOnline: "no", team: "solo",
    pains: ["unsure"], tools: ["google"], magic: "Enlever un peu les mauvaises nouvelles ",
    start: "exploring", budget: "unsure", firstName: "Alberto", email: "a@example.ca",
  },
  // Jose: wants to sell online, gave a band, gave a number.
  "DM-M9EZ7": {
    activity: "ecom", team: "solo", sellsOnline: "want-to", pains: ["unsure"],
    tools: ["google", "microsoft"], magic: "Courir apres les factures impayees ",
    start: "asap", budget: "<1500", firstName: "Jose", email: "j@example.com", phone: "+18732557953",
  },
  // Michel: pool maintenance, 6-20 people, everyone keeps their own copy.
  "DM-BSRA8": {
    activity: "other", activity_other: "Entretien piscine", team: "6-20", sellsOnline: "no",
    pains: ["D"], D_where: ["spreadsheets"], D_breaks: ["team"], tools: ["microsoft"],
    magic: "Repondre aux memes questions WhatsApp ", start: "asap", budget: "unsure",
    firstName: "Michel", email: "m@example.com",
  },
  // Steven: a custom-built shop and a bank asking about it. The best lead.
  "DM-88HKT": {
    activity: "services", sellsOnline: "want-to", team: "solo", pains: ["E"],
    E_platform: "custom", E_trigger: "asked", tools: ["invoicing"],
    magic: "Courir apres les factures impayees ", start: "exploring", budget: "unsure",
    firstName: "Steven", email: "s@example.fr", phone: "+33780030320",
  },
  // Anaia: retail, no problem named, a band tapped.
  "DM-8FPFT": {
    activity: "retail", team: "solo", sellsOnline: "want-to", pains: ["unsure"],
    tools: ["paper"], magic: "Courir apres les factures impayees ", start: "exploring",
    budget: "1500-3500", firstName: "Anaia", email: "an@example.com", phone: "15817015976",
  },
};

/**
 * `score()` owns the definition of "thin" (it pushes the flag when it could
 * not name a single line); `signalOf` only reads it. U3 lands that flag, so
 * this helper adds it when it is not there yet and is a no-op afterwards: the
 * test says the same thing before and after that unit, and neither copy of the
 * rule lives in `signalOf`.
 */
function scoringOf(answers: Record<string, unknown>) {
  const s = score(answers as Parameters<typeof score>[0]);
  return s.proposed.length || s.flags.includes("thin") ? s : { ...s, flags: [...s.flags, "thin"] };
}

const signalFor = (ref: string): Signal => signalOf(REAL[ref]!, scoringOf(REAL[ref]!));

test("the thin signal fires on DM-JED9Y and on nobody else in the batch", () => {
  assert.equal(signalFor("DM-JED9Y").thin, true, "the lead Radu complained about is the thin one");
  for (const ref of ["DM-M9EZ7", "DM-BSRA8", "DM-88HKT", "DM-8FPFT"]) {
    assert.equal(signalFor(ref).thin, false, `${ref} says enough to name a line`);
  }
});

test("signalOf lists the facts that are not on file, the phone number included", () => {
  // In 4 replays out of 4 the model's own "what is missing" line forgot the
  // phone number, which is the fact that decides whether a call is possible.
  const alberto = signalFor("DM-JED9Y").missing;
  assert.deepEqual(alberto, [
    "no business name",
    "no phone number",
    "no website or page to look at",
    "no budget given",
    "main problem not named",
    "hours unknown",
    "just exploring",
  ]);
  // A number on file is not missing; a declared band is not missing.
  assert.ok(!signalFor("DM-8FPFT").missing.includes("no phone number"));
  assert.ok(!signalFor("DM-8FPFT").missing.includes("no budget given"));
  // "I do not have one yet" is an answer, an empty box is not.
  const declared = signalOf({ ...REAL["DM-JED9Y"], companyNone: "none" }, scoringOf(REAL["DM-JED9Y"]!));
  assert.ok(!declared.missing.includes("no business name"));
  // The new branch's "last week went fine" is a symptom count of zero.
  const quiet = signalOf({ ...REAL["DM-JED9Y"], U_week: ["none"] }, scoringOf(REAL["DM-JED9Y"]!));
  assert.ok(quiet.missing.includes("no symptom named"));
});

test("moneyTokens reads a price the way the person reading it does", () => {
  const caught: [string, number[]][] = [
    ["1 500 à 3 500 EUR", [1500, 3500]],
    ["1,5k-3,5k €", [1500, 3500]],
    ["à partir de 500 €", [500]],
    ["800 et 1 200", [800, 1200]],
    ["Explorer automatisations legeres, flexible, 1.500-3.500 EUR", [1500, 3500]],
  ];
  for (const [s, figures] of caught) {
    assert.ok(moneyTokens(s).length > 0, `a price went unseen: ${s}`);
    assert.deepEqual(moneyFigures(s), figures, `wrong figures for: ${s}`);
  }
  // A whole band is one token, not two halves.
  assert.deepEqual(moneyTokens("1 500 à 3 500 EUR"), ["1 500 à 3 500 EUR"]);

  const left: string[] = [
    "2 à 3 jours",
    "30 minutes",
    "24 h sur 24",
    "https://digitalm.eu/fr/book",
    "https://d3v.digitalm.eu/fr/diagnostic",
    "Phase 1 : audit. Phase 2 : mise en place.",
    "Bonjour Alberto,\n\nMerci pour votre check-up.\n\nRadu, Digital M",
  ];
  for (const s of left) assert.deepEqual(moneyTokens(s), [], `not money: ${s}`);
});

test("stripMoney takes the price out and leaves a readable sentence", () => {
  assert.equal(
    stripMoney("Explorer automatisations legeres + suivi client, flexible, 1.500-3.500 EUR"),
    "Explorer automatisations legeres + suivi client, flexible",
  );
  assert.equal(stripMoney("relances factures, 2-3j"), "relances factures, 2-3j");
});

const LEAD_THIN: TriageLead = {
  firstName: "Alberto",
  budgetId: "unsure",
  budget: "",
  magic: "Enlever un peu les mauvaises nouvelles",
  answers: "Size: just me",
};

const MODEL_ANSWER: Triage = {
  proposed: ["AUTO", "CRM"],
  // What the model actually wrote for DM-JED9Y, in Radu's inbox on 22 Sep.
  subjectSummary: "Explorer automatisations legeres + suivi client, flexible, 1.500-3.500 EUR",
  noteForRadu: "Proposer une premiere phase a 1 500-3 000 EUR puis une seconde a 800-1 200 EUR.",
  clientRationale: "Vous cherchez a alleger votre quotidien.",
  replyDraft: "Objet : Votre check-up\n\nBonjour Alberto,\n\nPhase 1 : 1 500-3 000 EUR.\n\nRadu, Digital M",
  unknowns: "no company name, no website",
  callQuestions: [
    "Quelles taches vous prennent le plus de temps dans une semaine ?",
    "Ou notez-vous aujourd'hui ce que vous avez a faire ?",
  ],
  fit: "fits",
  fitReason: "",
};

test("a subject line can only ever carry a figure the customer tapped", () => {
  const thin = signalFor("DM-JED9Y");
  const subject = buildSubject(MODEL_ANSWER.subjectSummary, LEAD_THIN, "fr");
  assert.deepEqual(moneyTokens(subject), [], `a figure survived: ${subject}`);
  assert.ok(subject.endsWith("budget non précisé"), subject);
  assert.match(subject, /^Explorer automatisations legeres \+ suivi client, flexible, /);
  assert.equal(buildSubject("relances factures, 2-3j", LEAD_THIN, "en").endsWith("no budget given"), true);
  // A band they did tap is printed, and only theirs.
  const declared: TriageLead = { firstName: "Anaia", budgetId: "1500-3500", budget: "1,500-3,500 EUR", answers: "" };
  const own = buildSubject("site e-commerce + relances, 4 000 a 6 000 EUR", declared, "fr");
  assert.ok(own.endsWith("1,500-3,500 EUR"), own);
  assert.ok(!own.includes("4 000"), own);
  assert.ok(buildSubject("x".repeat(200), declared, "fr").length <= 110);
  assert.equal(declaredBudget("unsure"), false);
  assert.equal(declaredBudget("1500-3500"), true);
  void thin;
});

test("a thin lead cannot be told that anything fits, whatever the model says", () => {
  const signal = signalFor("DM-JED9Y");
  const out = finalizeTriage(MODEL_ANSWER, LEAD_THIN, signal, "fr");
  assert.equal(out.fit, "unclear", "a lead where no line could be named is not a confident fit");
  assert.equal(noFitColumn(out), "Not enough in the answers to say what fits. Ask before quoting.");
  // The two things Radu reads carry no price at all any more.
  assert.deepEqual(moneyTokens(out.subjectSummary), []);
  assert.deepEqual(moneyTokens(out.replyDraft), []);
  assert.deepEqual(moneyTokens(out.noteForRadu), []);
  assert.match(out.noteForRadu, /^Prices that are not on our grid were removed/);
  // The checklist is ours; the model's line is added after it, never instead.
  assert.match(out.unknowns, /^no business name; no phone number; no website or page to look at; no budget given; main problem not named; hours unknown; just exploring; /);
  assert.match(out.unknowns, /no company name, no website$/);
  // And the answer still carries everything that makes it useful.
  assert.equal(out.callQuestions.length, 2);
  assert.ok(out.clientRationale.length > 0);
});

test("the draft we write ourselves greets them, quotes them and names no price", () => {
  const draft = fallbackDraft(LEAD_THIN, MODEL_ANSWER.callQuestions, "fr");
  assert.match(draft, /^Objet : Quelques questions/);
  assert.match(draft, /Bonjour Alberto,/);
  assert.match(draft, /Enlever un peu les mauvaises nouvelles/);
  assert.match(draft, /1\. Quelles taches/);
  assert.match(draft, /https:\/\/digitalm\.eu\/fr\/book/);
  assert.ok(draft.endsWith("Radu, Digital M"));
  assert.deepEqual(moneyTokens(draft), []);

  const en = fallbackDraft({ ...LEAD_THIN, firstName: "Sam", magic: "" }, [], "en");
  assert.match(en, /^Subject: A few questions/);
  assert.match(en, /Hi Sam,/);
  assert.match(en, /1\. What took the most time/, "with no questions from the model, ask the two that always work");
  assert.ok(en.endsWith("Radu, Digital M"));
  assert.deepEqual(moneyTokens(en), []);
});

test("a draft that greets nobody or is not signed by Radu is not stored", () => {
  const signal = signalFor("DM-BSRA8");
  const lead: TriageLead = { firstName: "Michel", budgetId: "unsure", answers: "" };
  // One of the five live drafts opened "Bonjour," and signed "L'equipe Digital M".
  const anonymous: Triage = {
    ...MODEL_ANSWER,
    subjectSummary: "suivi client, des que possible",
    noteForRadu: "Un suivi client leger, sans prix.",
    replyDraft: "Objet : Votre check-up\n\nBonjour,\n\nVoici ce que je propose.\n\nL'equipe Digital M",
  };
  assert.ok(checkTriage(anonymous, lead, signal).some((p) => /greet them by name|signed by Radu/.test(p)));
  assert.equal(finalizeTriage(anonymous, lead, signal, "fr").replyDraft, "", "no draft is better than one he must proofread");

  const good: Triage = { ...anonymous, replyDraft: "Objet : Votre suivi client\n\nBonjour Michel,\n\nVoici.\n\nRadu, Digital M\ndigitalm.eu" };
  assert.deepEqual(checkTriage(good, lead, signal), []);
  assert.ok(finalizeTriage(good, lead, signal, "fr").replyDraft.includes("Bonjour Michel"));
});

test("with no budget declared, the only figures allowed are the ones we publish", () => {
  const signal = signalFor("DM-BSRA8"); // not thin: a line can be named
  const lead: TriageLead = { firstName: "Michel", budgetId: "unsure", answers: "" };
  const ours: Triage = {
    ...MODEL_ANSWER,
    noteForRadu: "Notre prix standard pour ce type de mise en place est de 800-1 200 EUR.",
    replyDraft: "Objet : Suivi client\n\nBonjour Michel,\n\nNotre offre standard est a 800-1 200 EUR.\n\nRadu, Digital M",
  };
  assert.deepEqual(checkTriage(ours, lead, signal), [], "our own grid is quotable");
  assert.deepEqual([...ALLOWED_FIGURES].sort((a, b) => a - b), [500, 800, 1200, 2500]);

  const invented: Triage = {
    ...ours,
    replyDraft: "Objet : Suivi client\n\nBonjour Michel,\n\nComptez 1 500 a 3 500 EUR.\n\nRadu, Digital M",
  };
  assert.ok(checkTriage(invented, lead, signal).some((p) => /figures we do not sell/.test(p)));
  const out = finalizeTriage(invented, lead, signal, "fr");
  assert.deepEqual(moneyTokens(out.replyDraft), [], "the invented band never reaches the customer");
  assert.match(out.replyDraft, /Bonjour Michel,/);

  // A band they declared themselves is theirs to be quoted against.
  const declared: TriageLead = { firstName: "Anaia", budgetId: "1500-3500", budget: "1,500-3,500 EUR", answers: "" };
  const banded: Triage = {
    ...ours,
    replyDraft: "Objet : Votre site\n\nBonjour Anaia,\n\nComptez 2 000 a 3 500 EUR.\n\nRadu, Digital M",
  };
  assert.deepEqual(checkTriage(banded, declared, signalFor("DM-8FPFT")), []);
});

test("the prompt is ASCII in both modes, and the thin one has no figure at all", () => {
  const ruleScoring = scoringOf(REAL["DM-JED9Y"]!);
  const thin = buildTriagePrompt(
    { firstName: "Alberto", budgetId: "unsure", magic: "Enlever un peu les mauvaises nouvelles", answers: "Size: just me\nWhat they do: Travail social" },
    ruleScoring,
    "fr",
    signalFor("DM-JED9Y"),
  );
  for (let i = 0; i < thin.length; i++) {
    const c = thin.charCodeAt(i);
    assert.ok(c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0x7e), `non-ASCII at ${i}: ${thin.slice(i - 20, i + 20)}`);
  }
  // No grid, no money rules, no figure: the model cannot quote what it was
  // never shown, and there is nothing in front of it to reach for.
  assert.deepEqual(moneyTokens(thin), [], "the thin prompt names a figure");
  assert.ok(!thin.includes("PUBLISHED PACKAGE GRID"));
  assert.match(thin, /THERE IS NOT ENOUGH HERE TO QUOTE ANYTHING/);
  assert.match(thin, /Budget: NOT GIVEN/);
  assert.match(thin, /These facts are MISSING: no business name; no phone number/);
  assert.match(thin, /A missing answer is not a soft answer/);
  assert.match(thin, /Text they tapped from a suggestion is not evidence of anything/);

  const full = buildTriagePrompt(
    { firstName: "Michel", budgetId: "unsure", answers: "Size: 6 to 20 people" },
    scoringOf(REAL["DM-BSRA8"]!),
    "fr",
    signalFor("DM-BSRA8"),
  );
  assert.match(full, /PUBLISHED PACKAGE GRID/);
  assert.match(full, /This person stated NO budget\. Do not invent one\./);
  assert.match(full, /Do not propose SEC unless they sell online or described their shop's platform/);
  // Nothing outside the grid is printed as a price for a lead with no budget.
  for (const f of moneyFigures(full)) assert.ok(ALLOWED_FIGURES.has(f), `the prompt shows a price we do not sell: ${f}`);
});

test("noFitColumn puts the decision in the one column every consumer reads", () => {
  assert.equal(noFitColumn({ fit: "fits", fitReason: "" }), null, "NULL finally means one thing");
  assert.equal(
    noFitColumn({ fit: "unclear", fitReason: "No problem described and no budget." }),
    "Not enough in the answers to say what fits. Ask before quoting. No problem described and no budget.",
  );
  assert.equal(noFitColumn({ fit: "no-fit", fitReason: "They want an accountant, not software." }), "They want an accountant, not software.");
});
