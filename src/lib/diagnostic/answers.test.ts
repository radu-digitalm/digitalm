import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LINE_LABEL, PRICE_FIT, STANDARD_PRICE, answerEntries, coreSaleFacts, heardAbout, ownWords, priceFitFor, proposedLabel, saleFacts } from "./answers.ts";

// Two of the five real rows, as the database holds them (read-only fixtures):
// the lead who tapped every chip and typed nothing, and the lead who typed.
const JOJO_ANSWERS = {
  sellsOnline: "own-site", team: "solo", activity: "other", pains: ["A"], A_where: ["stock"], A_hours: "<5",
  tools: ["salesforce"], budget: "1500-3500", decision: "me", start: "asap", firstName: "Jojo ", email: "jojokita99@gmail.com", source: "word",
};
const MICHEL_ANSWERS = {
  activity: "other", team: "6-20", sellsOnline: "no", pains: ["D"], D_where: ["spreadsheets"], D_breaks: ["team"],
  tools: ["microsoft"], magic: "Répondre aux mêmes questions WhatsApp ", start: "asap", decision: "me", budget: "unsure",
  firstName: "Michel", email: "michelric4@gmail.com", activity_other: "Entretien piscine",
};

const ROUTE = readFileSync(join(import.meta.dirname, "../../app/api/enquiry/route.ts"), "utf8");

// ---- the page may never contradict the e-mail -------------------------------------

test("the service names and the price bands are one table, not two", () => {
  // /api/enquiry writes the lead e-mail Radu reads at 7am; this module writes
  // the page he opens afterwards. The two used to hold byte-identical private
  // copies of these tables and nothing compared them, so the day one was
  // edited the page would have quoted a price the e-mail did not. The route
  // now imports them, and this is what stops a private copy coming back.
  assert.match(ROUTE, /import \{[^}]*\bLINE_LABEL\b[^}]*\} from "@\/lib\/diagnostic\/answers"/);
  for (const name of ["LINE_LABEL", "PRICE_FIT", "STANDARD_PRICE"]) {
    assert.equal(ROUTE.includes(`const ${name}`), false, `${name} has a private copy in the enquiry route again`);
  }
  // And the tables themselves still say what the e-mail printed.
  assert.equal(LINE_LABEL.AUTO, "Process automation");
  assert.equal(LINE_LABEL.CRM, "Customer follow-up (CRM)");
  assert.equal(PRICE_FIT["1500-3500"], "€1,500-3,500 — quote €2,000-3,500");
  assert.equal(STANDARD_PRICE, "not stated - ask before quoting, do not name a band");
  assert.equal(priceFitFor("unsure"), "not stated - ask before quoting, do not name a band");
  assert.equal(priceFitFor(null), STANDARD_PRICE);
});

test("a budget nobody gave can never print a figure, with no model involved", () => {
  // DM-JED9Y's "1.500-3.500 EUR" did not come out of the model alone: this
  // table ordered it too, and it reaches the lead e-mail and the lead page
  // with nothing in between. 1,500-3,500 is not even one of our prices.
  for (const budget of ["unsure", "", "   ", "nonsense"]) {
    const line = priceFitFor(budget);
    assert.ok(!/\d/.test(line), `priceFitFor(${JSON.stringify(budget)}) prints a figure: ${line}`);
    assert.ok(!/[€$]|EUR|euros/i.test(line), `priceFitFor(${JSON.stringify(budget)}) prints a currency: ${line}`);
    assert.match(line, /ask before quoting/);
  }
  // A band they DID tap still quotes against it: that figure is theirs.
  assert.match(priceFitFor("3500-7000"), /€3,500-7,000/);
});

test("the sale facts keep the seven labels the lead e-mail prints, in order", () => {
  const block = ROUTE.slice(ROUTE.indexOf("facts: ["), ROUTE.indexOf("propose: {"));
  const inEmail = [...block.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
  // The route may either hold the same list (and this compares it word for
  // word) or call the shared one, which is the same thing said once.
  if (inEmail.length) {
    assert.deepEqual(coreSaleFacts(JOJO_ANSWERS).map((f) => f.label), inEmail);
    assert.equal(inEmail.length, 7, "'Who decides' is cut: 7 of 7 leads answered 'Moi seul(e)'");
  } else {
    assert.match(block, /saleFacts\(/);
  }
  // Whatever the e-mail does, the page's list ENDS with those same seven.
  const onPage = saleFacts(JOJO_ANSWERS).map((f) => f.label);
  assert.deepEqual(onPage.slice(-7), coreSaleFacts(JOJO_ANSWERS).map((f) => f.label));
  assert.equal(onPage.includes("Who decides"), false);
});

test("what they told us goes wrong comes before the demographic chips", () => {
  // Michel's whole sale is in the deep dive: the customer information is in
  // spreadsheets and everyone keeps their own copy. It used to sit at the
  // bottom of the page under a 1,900-character mailto.
  const facts = saleFacts(MICHEL_ANSWERS);
  assert.equal(facts[0]?.label, "Where is customer information kept today?");
  assert.equal(facts[0]?.value, "Spreadsheets");
  assert.equal(facts[1]?.label, "What does that cost you in practice?");
  assert.equal(facts[1]?.value, "Everyone keeps their own info");
  assert.ok(facts.findIndex((f) => f.label === "Where is customer information kept today?") < facts.findIndex((f) => f.label === "Size"));
  // A lead with no deep dive on file still starts at the demographics.
  assert.equal(saleFacts({ team: "solo" })[0]?.label, "What they do");
});

test("the sale facts read the answers the old query never selected", () => {
  const facts = coreSaleFacts(MICHEL_ANSWERS);
  // Their trade, not the chip we offered them: "Other (tell us) - Entretien
  // piscine" made Radu read our word before Michel's.
  assert.deepEqual(facts[0], { label: "What they do", value: "Entretien piscine" });
  assert.deepEqual(facts[1], { label: "Size", value: "6–20" });
  assert.deepEqual(facts[3], { label: "Budget", value: "No idea yet, tell me what it costs" });
  assert.deepEqual(facts[4], { label: "Wants to start", value: "As soon as possible" });
  assert.deepEqual(facts[6], { label: "Website", value: "not given" });
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
  // "Autre (précisez)" plus "Entretien piscine" is ONE answer, and the answer
  // is the trade they typed. The separate "(other)" row is gone with it.
  const activity = entries.find((e) => e.id === "activity");
  assert.equal(activity?.value, "Entretien piscine");
  assert.equal(entries.some((e) => e.id === "activity_other"), false);
  // An "other" box with no chip behind it (a stale row) is still printed.
  const orphan = answerEntries({ activity_other: "Travail social" });
  assert.equal(orphan[0]?.label, "What does your business do? (other)");
  assert.equal(orphan[0]?.freeText, true);
  // And the chip is still the chip when they typed nothing in its box.
  assert.equal(answerEntries({ activity: "other" })[0]?.value, "Other (tell us)");
});

test("ownWords holds their sentence, not their trade", () => {
  assert.deepEqual(ownWords(JOJO_ANSWERS), []);
  const words = ownWords(MICHEL_ANSWERS);
  assert.equal(words[0]?.label, "The chore they want gone");
  assert.equal(words[0]?.text, "Répondre aux mêmes questions WhatsApp");
  // "Entretien piscine" is what he does, not something he wants gone: it is a
  // fact now, printed as his trade, and "their own words" holds one sentence.
  assert.equal(words.length, 1);
});

test("proposedLabel and priceFitFor speak the e-mail's words", () => {
  assert.equal(proposedLabel("AUTO+CRM"), "Process automation + Customer follow-up (CRM)");
  assert.equal(proposedLabel("-"), "");
  assert.equal(priceFitFor("1500-3500"), "€1,500-3,500 — quote €2,000-3,500");
  assert.equal(priceFitFor(""), "not stated - ask before quoting, do not name a band");
});

test("heardAbout carries the id, its English label and the other box", () => {
  assert.deepEqual(heardAbout(JOJO_ANSWERS), { id: "word", label: "Word of mouth", other: null });
  assert.deepEqual(heardAbout({ source: "other", source_other: "Chat gpt" }), { id: "other", label: "Something else", other: "Chat gpt" });
  assert.equal(heardAbout(MICHEL_ANSWERS), null);
});
