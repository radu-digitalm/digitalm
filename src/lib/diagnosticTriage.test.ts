// U4 — the triage guard and the lead email Radu acts on.
//
// The mangled fixtures below are verbatim from the staging enquiries database
// (/home/hermes/data/enquiries-staging.db, rows DM-NXNX2, DM-NM89W, DM-V8NMN,
// DM-NG93X, DM-N7WWD). The old guard returned false on every one of them, so
// the retry and the fallback never ran and the text reached the visitor's
// screen and Radu's inbox as it is written here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isMangled, repairMangled } from "./diagnosticTriage.ts";
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
