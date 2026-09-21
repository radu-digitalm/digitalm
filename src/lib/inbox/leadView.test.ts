import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  answerEntries,
  arrivedAgo,
  attributionSentence,
  buildLeadView,
  campaignRollup,
  heardAboutLine,
  leadWhere,
  ownWords,
  phoneState,
  priceFitFor,
  proposedLabel,
  replyMailto,
  saleFacts,
  sendLabel,
  shortAdId,
  whereLine,
} from "./leadView.ts";
import type { EnquirySummary } from "./leads.ts";
import type { Attribution, Lead } from "../crm/types.ts";

const NOW = new Date("2026-09-21T08:00:00Z");

// The five real rows, as the database holds them (read-only fixtures).
const JOJO_ANSWERS = {
  sellsOnline: "own-site", team: "solo", activity: "other", pains: ["A"], A_where: ["stock"], A_hours: "<5",
  tools: ["salesforce"], budget: "1500-3500", decision: "me", start: "asap", firstName: "Jojo ", email: "jojokita99@gmail.com", source: "word",
};
const MICHEL_ANSWERS = {
  activity: "other", team: "6-20", sellsOnline: "no", pains: ["D"], D_where: ["spreadsheets"], D_breaks: ["team"],
  tools: ["microsoft"], magic: "Répondre aux mêmes questions WhatsApp ", start: "asap", decision: "me", budget: "unsure",
  firstName: "Michel", email: "michelric4@gmail.com", activity_other: "Entretien piscine",
};

const CHATGPT: Attribution = {
  utm_source: "chatgpt",
  utm_medium: "cpc",
  utm_campaign: "fr-france",
  utm_content: "ad_6aa271d4b5e8819283a9c766ce2fca0c",
  oppref: "gAAAAABqrHFtrw41n5Ayc7oEgueKrbCFf06Kt_GSjMqdyoKDJ0WMmMzRd61mpnba32029Lc2ZLoCuyk3FQSdJ623Pfiq1EwRPAJAvGNKBjtl8TWGjMoZLuww",
};
const AD_2 = "ad_6aa271d4d638819e9be488385c1b030e";

function lead(over: Partial<Lead> & { ip?: string | null; browserCountry?: string | null; browserTz?: string | null } = {}) {
  return {
    id: 1, reference: "LD-VQKA5", kind: "diagnostic", stage: "new", name: "Jojo", company: null,
    email: "jojokita99@gmail.com", emailHash: null, phone: "+33 4187172114", phoneHash: null,
    locale: "fr", country: "FR", sourceLabel: "ChatGPT Ads · fr-france", sourceUtm: "chatgpt",
    attribution: CHATGPT, enquiryReference: "DM-C4DQ3", prospectId: null, legalBasis: "request",
    dataSource: "form", noticeSentAt: null, nextAction: null, nextActionAt: null, note: null,
    lastActivityAt: "2026-09-17 23:07:30", repliedAt: null, closedAt: null, closeReason: null,
    createdAt: "2026-09-17 23:07:30", updatedAt: "2026-09-17 23:07:30",
    ip: "72.136.122.126", browserCountry: null, browserTz: null,
    ...over,
  } as Lead & { ip: string | null; browserCountry: string | null; browserTz: string | null };
}

function enquiry(over: Partial<EnquirySummary> = {}): EnquirySummary {
  return {
    reference: "DM-C4DQ3", grade: "A", proposed: "AUTO+CRM", urgent: false,
    subjectSummary: null, replyDraft: null, noteForRadu: null, mailStatus: "sent",
    createdAt: "2026-09-17 23:07:30", answers: JOJO_ANSWERS, answersBroken: false,
    scores: { AGENT: 0, AUTO: 3, WEB: 0, CRM: 2, SEC: 1 }, flagged: false, ip: "72.136.122.126",
    source: "word", callQuestions: null, unknowns: null, noFit: null, browserCountry: null, browserTz: null,
    ...over,
  };
}

// ---- the page may never contradict the e-mail -------------------------------------

test("saleFacts keeps the eight labels the lead e-mail prints, in order", () => {
  const route = readFileSync(join(import.meta.dirname, "../../app/api/enquiry/route.ts"), "utf8");
  const block = route.slice(route.indexOf("facts: ["), route.indexOf("propose: {"));
  const inEmail = [...block.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    saleFacts(JOJO_ANSWERS).map((f) => f.label),
    inEmail,
  );
  assert.equal(inEmail.length, 8);
});

test("saleFacts reads the answers the old query never selected", () => {
  const facts = saleFacts(MICHEL_ANSWERS);
  assert.deepEqual(facts[0], { label: "What they do", value: "Other (tell us) — Entretien piscine" });
  assert.deepEqual(facts[1], { label: "Size", value: "6–20" });
  assert.deepEqual(facts[3], { label: "Budget", value: "Not sure yet" });
  assert.deepEqual(facts[4], { label: "Wants to start", value: "As soon as possible" });
  assert.deepEqual(facts[7], { label: "Website", value: "not given" });
});

test("an unanswered question reads the e-mail's word, never a dash", () => {
  const facts = saleFacts({});
  assert.equal(facts.find((f) => f.label === "Size")?.value, "not stated");
  assert.equal(facts.find((f) => f.label === "Tools today")?.value, "none picked");
  assert.equal(facts.find((f) => f.label === "Website")?.value, "not given");
});

test("answerEntries turns the branch answers into English", () => {
  const entries = answerEntries(MICHEL_ANSWERS);
  const pains = entries.find((e) => e.id === "pains");
  assert.equal(pains?.label, "Which of these feels most true right now?");
  assert.equal(pains?.value, "Customer info is scattered: quotes and follow-ups get forgotten");
  const where = entries.find((e) => e.id === "D_where");
  assert.ok(where && where.value.length > 0 && where.value !== "spreadsheets");
  const other = entries.find((e) => e.id === "activity_other");
  assert.equal(other?.label, "What does your business do? (other)");
  assert.equal(other?.freeText, true);
});

test("ownWords quotes the magic wand first, and is empty for the lead who typed nothing", () => {
  assert.deepEqual(ownWords(JOJO_ANSWERS), []);
  const words = ownWords(MICHEL_ANSWERS);
  assert.equal(words[0]?.label, "The chore they want gone");
  assert.equal(words[0]?.text, "Répondre aux mêmes questions WhatsApp");
  assert.equal(words[1]?.text, "Entretien piscine");
});

test("proposedLabel and priceFitFor speak the e-mail's words", () => {
  assert.equal(proposedLabel("AUTO+CRM"), "Process automation + Customer follow-up (CRM)");
  assert.equal(proposedLabel("-"), "");
  assert.equal(priceFitFor("1500-3500"), "€1,500-3,500 — quote €2,000-3,500");
  assert.equal(priceFitFor(""), "not stated — quote the standard €1,500-3,500 range");
});

// ---- the number -------------------------------------------------------------------

test("phoneState has exactly three states and offers the repair Jojo's row needs", () => {
  const dialable = phoneState("+18732557953");
  assert.equal(dialable.kind, "dialable");
  if (dialable.kind === "dialable") {
    assert.equal(dialable.e164, "+18732557953");
    assert.equal(dialable.display, "+1 873 255 7953");
    assert.equal(dialable.href, "tel:+18732557953");
  }
  const jojo = phoneState("+33 4187172114");
  assert.equal(jojo.kind, "unusable");
  if (jojo.kind === "unusable") {
    assert.equal(jojo.note, "cannot be dialled as stored — ask for it in your reply");
    assert.equal(jojo.repair, "+14187172114");
    assert.equal(jojo.repairNote, "418 is Quebec — set this number to +1 418 717 2114?");
  }
  const anaia = phoneState("15817015976");
  assert.equal(anaia.kind, "unusable");
  if (anaia.kind === "unusable") assert.equal(anaia.repair, "+15817015976");
  assert.equal(phoneState(null).kind, "none");
  assert.equal(phoneState("").kind, "none");
});

// ---- where they are ---------------------------------------------------------------

test("where is evidence, and the page language is never evidence", () => {
  assert.equal(whereLine(leadWhere({ phone: "+18732557953", browserCountry: null })), "Quebec, Canada — from the +1 873 number");
  assert.equal(whereLine(leadWhere({ phone: "+33780030320", browserCountry: null })), "France — from the +33 number");
  assert.equal(whereLine(leadWhere({ phone: "+33 4187172114", browserCountry: null })), "Not proven — the number they typed cannot be used");
  assert.equal(whereLine(leadWhere({ phone: "15817015976", browserCountry: null })), "Not proven — the number they typed cannot be used");
  assert.equal(whereLine(leadWhere({ phone: null, browserCountry: null })), "Not known — no usable number and the browser did not say");
});

test("a lead with no number never reads France off the row", () => {
  const w = leadWhere({ phone: null, browserCountry: null });
  assert.equal(w.known, false);
  assert.ok(!/France/i.test(whereLine(w)));
});

test("the browser hint is the only country the page will name, and the phone still wins", () => {
  assert.equal(whereLine(leadWhere({ phone: null, browserCountry: "CA" })), "Canada — from what their browser reported");
  const disagree = leadWhere({ phone: "+33780030320", browserCountry: "CA" });
  assert.equal(disagree.text, "France");
  assert.equal(disagree.second, "their browser said Canada");
});

// ---- where the lead came from -----------------------------------------------------

test("the attribution sentence reads as a sentence, for all five rows", () => {
  assert.equal(
    attributionSentence(CHATGPT, { name: "Jojo", kind: "booking", booked: true, where: null, adCount: 3, total: 5 }),
    'Paid ad on ChatGPT. Jojo clicked it, filled the check-up, then booked a call a minute later. Campaign "fr-france" — that is the ad\'s name, not where Jojo is. Ad …2fca0c (3 of your 5 leads).',
  );
  assert.equal(
    attributionSentence(CHATGPT, { name: "Anaia", kind: "diagnostic", booked: false, where: null, adCount: 3, total: 5 }),
    'Paid ad on ChatGPT. Anaia clicked it and filled the check-up. Campaign "fr-france" — that is the ad\'s name, not where Anaia is. Ad …2fca0c (3 of your 5 leads).',
  );
  assert.equal(
    attributionSentence({ ...CHATGPT, utm_content: AD_2 }, { name: "Steven", kind: "diagnostic", booked: false, where: "France", adCount: 2, total: 5 }),
    'Paid ad on ChatGPT. Steven clicked it and filled the check-up. Campaign "fr-france". Ad …1b030e (2 of your 5 leads).',
  );
  assert.equal(
    attributionSentence(CHATGPT, { name: "José", kind: "diagnostic", booked: false, where: "Quebec, Canada", adCount: 3, total: 5 }),
    'Paid ad on ChatGPT. José clicked it and filled the check-up. Campaign "fr-france" — that is the ad\'s name, not where José is. Ad …2fca0c (3 of your 5 leads).',
  );
  assert.equal(attributionSentence(null, { name: "X", kind: "manual", booked: false, where: null, adCount: 0, total: 0 }), null);
});

test("the sentence never prints the click id, a tracking key or a key=value pair", () => {
  for (const name of ["Jojo", "Anaia", "Steven", "Michel", "José"]) {
    const s = attributionSentence(CHATGPT, { name, kind: "diagnostic", booked: false, where: null, adCount: 3, total: 5 })!;
    assert.ok(!s.includes(CHATGPT.oppref!), "no click id");
    assert.ok(!/utm/i.test(s), "no tracking key");
    assert.ok(!s.includes("="), "no key=value pair");
  }
});

test("the two live ad ids stay different when shortened", () => {
  assert.equal(shortAdId(CHATGPT.utm_content!), "…2fca0c");
  assert.notEqual(shortAdId(CHATGPT.utm_content!), shortAdId(AD_2));
});

test("what they said about hearing of us is checked against the click", () => {
  assert.equal(heardAboutLine("Jojo", JOJO_ANSWERS, true), "Jojo said they heard about you through word of mouth — that does not match the ad click.");
  assert.equal(heardAboutLine("Steven", { source: "other" }, true), 'Steven chose "Something else" and did not say what.');
  assert.equal(heardAboutLine("José", { source: "other", source_other: "Chat gpt" }, true), "José said they found you through ChatGPT — that matches.");
  assert.equal(heardAboutLine("Michel", MICHEL_ANSWERS, true), "Michel did not answer how they heard about you.");
});

test("the campaign roll-up counts only what the evidence supports", () => {
  const rows = [
    { reference: "LD-VQKA5", phone: "+33 4187172114", browserCountry: null, attribution: CHATGPT },
    { reference: "LD-6VF33", phone: "15817015976", browserCountry: null, attribution: CHATGPT },
    { reference: "LD-24K4X", phone: "+33780030320", browserCountry: null, attribution: { ...CHATGPT, utm_content: AD_2 } },
    { reference: "LD-4H4TW", phone: null, browserCountry: null, attribution: { ...CHATGPT, utm_content: AD_2 } },
    { reference: "LD-BDQQZ", phone: "+18732557953", browserCountry: null, attribution: CHATGPT },
  ];
  assert.equal(campaignRollup("fr-france", rows), 'Campaign "fr-france": 5 leads so far — 1 in France, 1 in Quebec, 3 we cannot place.');
  assert.equal(campaignRollup("", rows), null);
});

// ---- the reply --------------------------------------------------------------------

test("the reply link says what it can carry", () => {
  const short = replyMailto("a@b.com", { subject: "Hello", body: "Short body" });
  assert.equal(short.prefill, "full");
  assert.ok(short.href.startsWith("mailto:a@b.com?subject=Hello"));
  assert.equal(sendLabel("full"), "Send in one tap");
  const long = replyMailto("a@b.com", { subject: "Hello", body: "x".repeat(9000) });
  assert.equal(long.prefill, "long");
  assert.ok(!long.href.includes("&body="));
  assert.equal(sendLabel("long"), "Open a reply (the draft is above, too long to pre-fill)");
  assert.equal(replyMailto("a@b.com", { subject: "Hello", body: "  " }).prefill, "none");
});

test("how old the lead is, in words", () => {
  assert.equal(arrivedAgo("2026-09-21 06:00:00", NOW), "arrived 2 h ago");
  assert.equal(arrivedAgo("2026-09-17 08:00:00", NOW), "arrived 4 days ago");
});

// ---- the whole view ---------------------------------------------------------------

test("Jojo's page carries the seven highlights, the repair offer and no country column", () => {
  const view = buildLeadView({
    lead: lead({ kind: "booking", nextAction: "Discovery call (booked)", nextActionAt: "2026-09-25" }),
    enquiry: enquiry(),
    prospect: null,
    activities: [],
    campaignRows: [],
    now: NOW,
  });
  const highlights = view.highlights.map((h) => h.text);
  assert.deepEqual(highlights, ["Grade A", "Process automation + Customer follow-up (CRM)", "€1,500–3,500", "As soon as possible", "New", "arrived 3 days ago"]);
  assert.equal(view.reach.where, "Not proven — the number they typed cannot be used");
  assert.equal(view.reach.phone.kind, "unusable");
  assert.equal(view.words.empty, "They typed nothing in their own words — the facts below are all we have.");
  assert.equal(view.facts.rows?.length, 8);
  assert.equal(view.upcoming?.when, "in 4 days");
  assert.equal(view.related[0]?.label, "The check-up");
  assert.equal(view.ask, null);
  // leads.country appears once, under its honest label, and nowhere else.
  const serialised = JSON.stringify({ ...view, details: [] });
  assert.ok(!/"FR"/.test(serialised), "the country column never reaches the page");
  const countryRows = view.details.flatMap((s) => s.rows).filter((r) => r.label === "Country used to read the phone number");
  assert.equal(countryRows.length, 1);
});

test("an overdue next step is overdue, and a missing one says so", () => {
  const late = buildLeadView({ lead: lead({ nextAction: "Call back", nextActionAt: "2026-09-19" }), enquiry: null, prospect: null, activities: [], now: NOW });
  assert.equal(late.upcoming?.overdue, true);
  assert.equal(late.upcoming?.when, "2 days ago");
  const none = buildLeadView({ lead: lead(), enquiry: null, prospect: null, activities: [], now: NOW });
  assert.equal(none.upcoming, null);
});

test("a lead with no check-up keeps its controls and says where it came from", () => {
  const view = buildLeadView({
    lead: lead({ kind: "contact", enquiryReference: null, note: "Bonjour, pouvez-vous m'appeler ?", email: null, phone: null }),
    enquiry: null,
    prospect: null,
    activities: [],
    now: NOW,
  });
  assert.equal(view.highlights[0]?.text, "No check-up — came from the contact form");
  assert.equal(view.facts.rows, null);
  assert.ok(view.facts.note?.startsWith("No check-up behind this lead"));
  assert.equal(view.reply, null);
  assert.equal(view.propose, null);
  assert.equal(view.words.inbound?.text, "Bonjour, pouvez-vous m'appeler ?");
  assert.equal(view.reach.emailNote, "no address and no number on file");
  assert.equal(view.related.length, 0);
});

test("answers that will not parse replace the block with a sentence instead of failing", () => {
  const view = buildLeadView({
    lead: lead(),
    enquiry: enquiry({ answers: null, answersBroken: true }),
    prospect: null,
    activities: [],
    now: NOW,
  });
  assert.equal(view.facts.rows, null);
  assert.equal(view.facts.note, "The saved answers could not be read — the check-up reference below still opens the record.");
  assert.equal(view.reach.where, "Not proven — the number they typed cannot be used");
});

test("the ready reply is split and the questions for the call appear once they are stored", () => {
  const view = buildLeadView({
    lead: lead({ email: "jojokita99@gmail.com" }),
    enquiry: enquiry({
      replyDraft: "Objet : Automatisation de votre stock\n\nBonjour Jojo,\n\nVoici deux options.",
      callQuestions: ["Which tool holds the stock today?", "Who else touches it?"],
      unknowns: "We do not know how many products they carry.",
      noteForRadu: "Solo, Salesforce already in place.",
    }),
    prospect: null,
    activities: [],
    now: NOW,
  });
  assert.equal(view.reply?.subject, "Automatisation de votre stock");
  assert.equal(view.reply?.body, "Bonjour Jojo,\n\nVoici deux options.");
  assert.equal(view.reply?.label, "Send in one tap");
  assert.equal(view.ask?.questions.length, 2);
  assert.equal(view.propose?.why, "Solo, Salesforce already in place.");
  assert.equal(view.propose?.note, null);
});
