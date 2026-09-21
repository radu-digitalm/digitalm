import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LINE_LABEL, PRICE_FIT, STANDARD_PRICE, answerEntries, heardAbout, ownWords, priceFitFor, proposedLabel, saleFacts } from "./answers.ts";

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
  assert.equal(STANDARD_PRICE, "not stated — quote the standard €1,500-3,500 range");
  assert.equal(priceFitFor("unsure"), "not decided — quote the standard €1,500-3,500 range");
  assert.equal(priceFitFor(null), STANDARD_PRICE);
});

test("saleFacts keeps the eight labels the lead e-mail prints, in order", () => {
  const block = ROUTE.slice(ROUTE.indexOf("facts: ["), ROUTE.indexOf("propose: {"));
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

test("heardAbout carries the id, its English label and the other box", () => {
  assert.deepEqual(heardAbout(JOJO_ANSWERS), { id: "word", label: "Word of mouth", other: null });
  assert.deepEqual(heardAbout({ source: "other", source_other: "Chat gpt" }), { id: "other", label: "Something else", other: "Chat gpt" });
  assert.equal(heardAbout(MICHEL_ANSWERS), null);
});
