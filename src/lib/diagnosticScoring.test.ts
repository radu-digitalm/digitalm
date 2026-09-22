import { test } from "node:test";
import assert from "node:assert/strict";
import { score } from "./diagnosticScoring.ts";
import { renderLeadNotification } from "./mail.ts";
import { answerEntries, saleFacts } from "./diagnostic/answers.ts";
import type { Answers } from "./diagnosticScoring.ts";

// ---------------------------------------------------------------------------
// The five real check-ups, as the production database holds them (read-only
// fixtures, 22 Sep 2026). Three of the five answered the pain question with
// "honnetement, je ne sais pas trop" and were then asked nothing at all, so
// every rule scored zero for them and a priced proposal came out anyway.
// ---------------------------------------------------------------------------

const REAL: Record<string, Answers> = {
  // Alberto: a social worker, on his own, no website, only looking.
  "DM-JED9Y": {
    activity: "other", activity_other: "Travail social", sellsOnline: "no", team: "solo",
    pains: ["unsure"], tools: ["google"], magic: "Enlever un peu les mauvaises nouvelles ",
    start: "exploring", budget: "unsure",
  },
  // Jose: wants to sell online, gave a band.
  "DM-M9EZ7": {
    activity: "ecom", team: "solo", sellsOnline: "want-to", pains: ["unsure"],
    tools: ["google", "microsoft"], start: "asap", budget: "<1500",
  },
  // Michel: pool maintenance, 6-20 people, everyone keeps their own copy.
  "DM-BSRA8": {
    activity: "other", activity_other: "Entretien piscine", team: "6-20", sellsOnline: "no",
    pains: ["D"], D_where: ["spreadsheets"], D_breaks: ["team"], tools: ["microsoft"],
    start: "asap", budget: "unsure",
  },
  // Steven: a custom-built shop and a bank asking about it. The best lead.
  "DM-88HKT": {
    activity: "services", sellsOnline: "want-to", team: "solo", pains: ["E"],
    E_platform: "custom", E_trigger: "asked", E_url: "steven-shop.fr", tools: ["invoicing"],
    start: "exploring", budget: "unsure",
  },
  // Anaia: retail, no problem named, a band tapped.
  "DM-8FPFT": {
    activity: "retail", team: "solo", sellsOnline: "want-to", pains: ["unsure"],
    tools: ["paper"], start: "exploring", budget: "1500-3500",
  },
};

// ---- branch U: the people who cannot name their own problem -----------------

test("branch U scores what last week actually cost them, on the router's scale", () => {
  const of = (week: string[]) => score({ U_week: week }).scores;
  assert.equal(of(["replies"]).AGENT, 3);
  assert.equal(of(["quotes"]).AUTO, 3);
  assert.deepEqual([of(["chasing"]).CRM, of(["chasing"]).AUTO], [3, 1]);
  assert.deepEqual([of(["retyping"]).AUTO, of(["retyping"]).CRM], [3, 1]);
  assert.deepEqual([of(["planning"]).AGENT, of(["planning"]).AUTO], [2, 1]);
  assert.equal(of(["searching"]).CRM, 3);
  // The weight is a router card's weight on purpose: a visitor who cannot name
  // their problem has to land on the same scale as one who can, or the deep
  // dive we just wrote for them would never move a recommendation.
  assert.equal(score({ pains: ["A"] }).scores.AUTO, of(["quotes"]).AUTO);
  // Two symptoms add up, and the cap is the question's own max of 2.
  assert.equal(of(["quotes", "chasing"]).AUTO, 4);
});

test("'last week went fine' is a fact about the lead, not a service line", () => {
  const s = score({ U_week: ["none"], U_where: "software", team: "solo" });
  assert.deepEqual(s.scores, { AGENT: 0, AUTO: 0, WEB: 0, CRM: 0, SEC: 0 });
  assert.ok(s.flags.includes("no-symptom"), "the e-mail has to be able to say no symptom was named");
  assert.ok(s.flags.includes("thin"));
  // A symptom beside it is still a symptom: the flag is for "none" alone.
  assert.equal(score({ U_week: ["none", "quotes"] }).flags.includes("no-symptom"), false);
});

test("where the work lives on a Monday morning, without cancelling the symptoms", () => {
  for (const where of ["paper", "head"]) {
    const s = score({ U_where: where });
    assert.equal(s.scores.WEB, 1, `${where} points at the basics`);
    assert.ok(s.flags.includes("basics-first"), `${where} raises basics-first`);
  }
  assert.equal(score({ U_where: "sheet" }).scores.CRM, 1);
  assert.equal(score({ U_where: "inbox" }).scores.CRM, 1);
  assert.deepEqual(score({ U_where: "software" }).scores, { AGENT: 0, AUTO: 0, WEB: 0, CRM: 0, SEC: 0 });
  // `tools: paper` docks a point off AUTO and CRM to stop us automating on top
  // of nothing. U_where must NOT: applied here it would cancel the very
  // symptoms the question before it just collected.
  assert.equal(score({ U_week: ["quotes"], U_where: "paper" }).scores.AUTO, 3);
  assert.equal(score({ U_week: ["quotes"], tools: ["paper"] }).scores.AUTO, 2);
  // And "basics-first" is a fact, not a counter: two ways of saying it once.
  const both = score({ U_where: "paper", tools: ["paper"] }).flags.filter((f) => f === "basics-first");
  assert.equal(both.length, 1);
});

test("an unsure lead who answers branch U is no longer all zeroes", () => {
  // Alberto, run through the branch he was never offered. Two taps.
  const s = score({ ...REAL["DM-JED9Y"]!, U_week: ["replies", "searching"], U_where: "head" });
  assert.deepEqual(s.proposed.slice(0, 2), ["AGENT", "CRM"]);
  assert.equal(s.flags.includes("thin"), false, "three usable facts is not a thin answer");
  // The grade is unchanged, because the grade is urgency and budget fit: he
  // said he is only looking, and that is still what he said.
  assert.equal(s.grade, "C");
});

// ---- the thin signal --------------------------------------------------------

test("the thin flag fires on DM-JED9Y and on nobody else in the batch", () => {
  const alberto = score(REAL["DM-JED9Y"]!);
  assert.deepEqual(alberto.proposed, []);
  assert.ok(alberto.flags.includes("thin"), "the lead Radu complained about is the thin one");
  for (const ref of ["DM-M9EZ7", "DM-BSRA8", "DM-88HKT", "DM-8FPFT"]) {
    const s = score(REAL[ref]!);
    assert.ok(s.proposed.length, `${ref} says enough to name a line`);
    assert.equal(s.flags.includes("thin"), false, `${ref} is not thin`);
  }
});

test("thin is about the answers, never about the hurry they are in", () => {
  // Nothing to propose and a deadline is a real combination: it means call
  // them and ask. The grade keeps meaning urgency and budget fit alone.
  const s = score({ U_week: ["none"], start: "asap", budget: "3500-7000" });
  assert.ok(s.flags.includes("thin"));
  assert.equal(s.grade, "A");
});

// ---- the shop that the chips said did not exist ------------------------------

test("answering the security deep dive is the proof that a shop exists", () => {
  // DM-88HKT tapped "not yet, but we would like to", then named his platform
  // and said a bank had asked about its security. We zeroed his SEC score and
  // told him to come back "lorsque vous serez pret a vendre en ligne".
  const steven = score(REAL["DM-88HKT"]!);
  assert.ok(steven.proposed.includes("SEC"), "the one line he asked about survives");
  assert.equal(steven.scores.SEC, 3);
  // Either half of the evidence is enough on its own.
  assert.equal(score({ sellsOnline: "want-to", pains: ["E"], E_platform: "shopify" }).scores.SEC, 3);
  assert.equal(score({ sellsOnline: "want-to", pains: ["E"], E_url: "shop.example.fr" }).scores.SEC, 3);
  // "Non, et ca nous va", with no deep dive behind it, still clamps SEC: the
  // audit is not sellable to someone who has no shop at all.
  assert.equal(score({ sellsOnline: "no", pains: ["E"] }).scores.SEC, 0);
  assert.equal(score({ sellsOnline: "want-to", pains: ["E"] }).scores.SEC, 0);
});

test("a branch they backed out of is not evidence of anything", () => {
  // The wizard sends the answers it has collected, so a visitor who taps the
  // security card, answers it, goes back and picks "the admin eats my week"
  // instead still ships an E_platform and an E_trigger. Those two used to
  // unlock a line he never asked about and add a point of urgency he never
  // stated - and after this change they are read harder than before, so the
  // guard is the card he is actually on.
  const stale = { sellsOnline: "want-to", E_platform: "custom", E_trigger: "asked", start: "later" };
  const backedOut = score({ ...stale, pains: ["A"] });
  assert.equal(backedOut.scores.SEC, 0, "the audit is not proposable to someone who did not ask about it");
  assert.equal(backedOut.proposed.includes("SEC"), false);
  assert.equal(backedOut.urgency, 1, "someone else's deadline, on a question he left behind");
  assert.equal(backedOut.urgent, false);
  // Still on card E, the same answers mean everything they say.
  const onIt = score({ ...stale, pains: ["E"] });
  assert.ok(onIt.proposed.includes("SEC"));
  assert.equal(onIt.urgency, 2);
  assert.equal(score({ ...stale, pains: ["A"], E_trigger: "incident" }).urgent, false);
  assert.equal(score({ ...stale, pains: ["E"], E_trigger: "incident" }).urgent, true);
});

test("a partner or a bank asking is a deadline; sleeping better is not", () => {
  const base = { sellsOnline: "own-site", pains: ["E"], E_platform: "custom", start: "later" };
  assert.equal(score({ ...base, E_trigger: "asked" }).urgency, 2);
  assert.equal(score({ ...base, E_trigger: "gdpr" }).urgency, 1);
  assert.equal(score({ ...base, E_trigger: "peace" }).urgency, 1);
  // Someone else's deadline is not our emergency: "urgent" stays for an
  // incident, which is the flag that shouts in the subject line.
  assert.equal(score({ ...base, E_trigger: "asked" }).urgent, false);
  assert.equal(score({ ...base, E_trigger: "incident" }).urgent, true);
});

test("the grade stopped reading a question nobody is asked any more", () => {
  // "Qui decide ?" is cut. An old row still carries it, and it must not
  // change what the letter means for that row.
  const withIt = score({ pains: ["A"], start: "asap", budget: "3500-7000", decision: "researching" });
  const withoutIt = score({ pains: ["A"], start: "asap", budget: "3500-7000" });
  assert.equal(withIt.grade, "A");
  assert.equal(withIt.grade, withoutIt.grade);
});

// ---------------------------------------------------------------------------
// What the e-mail says
//
// The same unit: score() decides there is nothing to propose, and this is the
// message that has to say so in words instead of printing "(none scored)".
// ---------------------------------------------------------------------------

const ALBERTO_MAIL = {
  reference: "DM-JED9Y",
  grade: "C",
  locale: "fr" as const,
  firstName: "Alberto",
  email: "alberto@example.ca",
  ownWords: [{ label: "The chore they want gone", text: "Enlever un peu les mauvaises nouvelles" }],
  facts: [{ label: "Budget", value: "No idea yet, tell me what it costs" }],
  propose: { lines: "(none scored)", why: "Un travailleur social seul, sans site." },
  callQuestions: ["Quelles mauvaises nouvelles, concretement ?", "Combien de personnes suivez-vous ?"],
  unknowns: "no business name; no phone number; no website or page to look at; no budget given",
  crmUrl: "https://digitalm.eu/admin/leads/LD-JED9Y",
  detail: [{ label: "Which tools do you use day-to-day?", value: "Google Workspace" }],
  diagnostics: [{ label: "IP", value: "203.0.113.9" }],
};

test("the e-mail says what the grade means, beside the grade", () => {
  const { text, html } = renderLeadNotification(ALBERTO_MAIL);
  const legend = "Grade C = they said they are only exploring";
  assert.ok(text.includes(legend), "the text says what C means");
  assert.ok(html.includes(legend), "the HTML says what C means");
  assert.match(text, /It is urgency and budget fit, never lead quality\./);
  // A on the same message reads the other way round, and never as a verdict.
  const a = renderLeadNotification({ ...ALBERTO_MAIL, grade: "A" });
  assert.ok(a.text.includes("Grade A = they want to start now and the budget covers it"));
  assert.match(a.text, /never lead quality/);
});

test("nothing to propose is an answer, not a scoring accident", () => {
  const { text, html } = renderLeadNotification(ALBERTO_MAIL);
  assert.match(text, /Not enough here to quote\. Ask the questions below before proposing anything\./);
  assert.match(html, /Not enough here to quote\./);
  assert.equal(text.includes("Lines: (none scored)"), false, "'(none scored)' reads as a bug, not an answer");
  assert.equal(html.includes("(none scored)"), false);
  // The questions it points at are still right underneath.
  assert.ok(text.indexOf("Not enough here to quote") < text.indexOf("Quelles mauvaises nouvelles"));
  // A lead that DID score keeps its lines, untouched.
  const scored = renderLeadNotification({ ...ALBERTO_MAIL, propose: { lines: "Process automation" } });
  assert.match(scored.text, /Lines: Process automation/);
  assert.equal(scored.text.includes("Not enough here to quote"), false);
});

test("the one-tap reply is last, and the CRM link is beside the draft", () => {
  const { text } = renderLeadNotification({
    ...ALBERTO_MAIL,
    reply: { subject: "Quelques questions", body: "Bonjour Alberto,\n\nDeux questions.\n\nRadu, Digital M" },
  });
  const crm = text.indexOf("Lead in the CRM:");
  const detail = text.indexOf("THE DETAIL");
  const oneTap = text.indexOf("SEND THE REPLY IN ONE TAP");
  assert.ok(crm > text.indexOf("READY-TO-SEND REPLY"), "the link Radu wants is beside the draft he just read");
  assert.ok(crm < detail, "the CRM link comes before the dump, not after it");
  // ~1,900 characters of percent-encoding used to sit between the draft and
  // the CRM link. It goes at the very end, where scrolling past it costs
  // nothing. (The plain address is still up under HOW TO REACH THEM.)
  assert.ok(oneTap > detail, "the one-tap reply is the last thing in the message");
  assert.ok(text.lastIndexOf("mailto:alberto@example.ca%3F") === -1);
  assert.ok(text.lastIndexOf("mailto:alberto@example.ca?subject=") > detail);
  assert.match(text.slice(oneTap), /Send that reply in one tap|too long to pre-fill|subject line only/);
});

test("what they told us goes wrong is in THE FACTS, and THE DETAIL says it once", () => {
  // Steven's whole call is two answers: an agency built his shop, and a bank
  // asked him about it. Both used to sit thirty lines below the reply draft,
  // under THE DETAIL, while THE FACTS printed his headcount - and six of the
  // seven facts were then reprinted word for word underneath.
  const answers = { ...REAL["DM-88HKT"]! } as Record<string, unknown>;
  const { text } = renderLeadNotification({
    ...ALBERTO_MAIL,
    firstName: "Steven",
    facts: saleFacts(answers),
    detail: answerEntries(answers).map((e) => ({ id: e.id, label: e.label, value: e.value })),
  });
  const facts = text.indexOf("THE FACTS");
  const detail = text.indexOf("THE DETAIL");
  for (const line of ["What is the shop built on?: Custom / an agency built it", "What brings the question up?: A partner or bank asked"]) {
    const at = text.indexOf(line);
    assert.ok(at > facts && at < detail, `"${line}" belongs in the first screenful, not under the dump`);
    assert.equal(text.indexOf(line, at + 1), -1, `"${line}" is printed twice`);
  }
  // The demographic chips are printed once too: THE DETAIL is everything else.
  const rest = text.slice(detail);
  for (const dup of ["What does your business do?", "How many people in the business?", "What budget do you have in mind?"]) {
    assert.equal(rest.includes(dup), false, `THE DETAIL reprints "${dup}", which THE FACTS already said`);
  }
  // What THE FACTS does not carry is still there: the card he picked.
  assert.match(rest, /Which of these feels most true right now\?/);
  // A caller that sends no ids loses nothing.
  const unlabelled = renderLeadNotification({ ...ALBERTO_MAIL, detail: [{ label: "Anything", value: "kept" }] });
  assert.match(unlabelled.text, /Anything: kept/);
});

test("the subject never says '(none scored)' either", () => {
  // The body says "not enough here to quote"; the subject said
  // "(none scored), No idea yet, tell me what it costs" on the very same
  // lead, in the one line Radu reads before he opens anything.
  const { subject } = renderLeadNotification(ALBERTO_MAIL);
  assert.equal(subject.includes("(none scored)"), false);
  assert.equal(subject.includes("No idea yet"), false, "a budget chip is not a need");
  assert.match(subject, /^\[DM-JED9Y\] C - Alberto - not enough to quote - ask first$/);
  // A lead that scored keeps the line and the band they tapped.
  const scored = renderLeadNotification({ ...ALBERTO_MAIL, propose: { lines: "Process automation" } });
  assert.match(scored.subject, /Process automation, No idea yet, tell me what it costs/);
  // And the AI subject, when there is one, still wins.
  const summarised = renderLeadNotification({ ...ALBERTO_MAIL, summary: "Deux questions avant de chiffrer" });
  assert.match(summarised.subject, /Deux questions avant de chiffrer$/);
});

test("no draft says which of the two things went wrong", () => {
  const { text, html } = renderLeadNotification(ALBERTO_MAIL);
  const sentence = "did not pass its checks (no first name, or not signed by Radu)";
  assert.ok(text.includes(sentence), "an empty draft box tells Radu nothing");
  assert.ok(html.includes(sentence));
  assert.match(text, /Write this one yourself\./);
});
