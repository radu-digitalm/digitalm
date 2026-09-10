import { test } from "node:test";
import assert from "node:assert/strict";
import type { AuditChecks, CheckKey, CheckResult, CheckStatus } from "../crm/types.ts";
import { BANNED_WORDS } from "../../content/report.ts";
import { CHECK_ORDER } from "../report/findings.ts";
import {
  DRAFT_CAPS,
  containsBanned,
  containsEmail,
  containsPhone,
  draftSubject,
  fitLength,
  followUp,
  looksUnsafe,
  safeDisplayName,
  templateDraft,
  withinCaps,
  type DraftInput,
} from "./templates.ts";

const WEIGHT: Record<CheckKey, number> = {
  reachable: 10, https: 10, speed: 15, seo_basics: 10, contact: 10, socials: 5, schema: 10, ai_ready: 15, google_listing: 10, housekeeping: 5,
};

function checks(overrides: Partial<Record<CheckKey, CheckStatus>> = {}): AuditChecks {
  const out = {} as AuditChecks;
  for (const key of CHECK_ORDER) {
    const status = overrides[key] ?? "pass";
    const w = WEIGHT[key];
    const r: CheckResult = { key, status, points: status === "pass" ? w : status === "partial" ? Math.round(w / 2) : 0, measured: status !== "not_measured", details: {} };
    out[key] = r;
  }
  return out;
}

const REPORT_URL = "https://d3v.digitalm.eu/r/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcdefg";

function input(locale: "fr" | "en", extra: Partial<DraftInput> = {}): DraftInput {
  return {
    locale,
    prospect: { displayName: "Le Fournil", town: "Foix", trade: locale === "fr" ? "boulangerie" : "bakery", country: "FR", soleTrader: false, phoneSource: "website" },
    checks: checks({ https: "fail", speed: "partial", ai_ready: "fail", google_listing: "not_measured" }),
    flags: ["no-ssl", "slow-mobile", "blocks-ai"],
    top: ["https", "ai_ready", "speed"],
    score: 58,
    grade: "B",
    fits: [{ pkg: "WEB", flags: ["no-ssl", "slow-mobile"] }, { pkg: "AGENT", flags: ["blocks-ai"] }],
    reportUrl: REPORT_URL,
    ...extra,
  };
}

test("safeDisplayName: sole traders never expose a personal name", () => {
  assert.equal(safeDisplayName({ enseigne: "MARTIN PLOMBERIE", legalName: "PAUL MARTIN", name: "MARTIN PLOMBERIE", soleTrader: true }, "fr"), "votre établissement");
  assert.equal(safeDisplayName({ enseigne: "MARTIN PLOMBERIE", legalName: "PAUL MARTIN", name: "MARTIN PLOMBERIE", soleTrader: true }, "en"), "your business");
  assert.equal(safeDisplayName({ enseigne: "LE FOURNIL", legalName: "PAUL MARTIN", name: "PAUL MARTIN", soleTrader: true }, "fr"), "LE FOURNIL");
  // Accents and case do not hide a match; short tokens (≤ 2 letters) are ignored.
  assert.equal(safeDisplayName({ enseigne: "Chez Émilie", legalName: "EMILIE DURAND", name: "Chez Émilie", soleTrader: true }, "fr"), "votre établissement");
  assert.equal(safeDisplayName({ enseigne: "Au Bon Pain", legalName: "AU LUC", name: "Au Bon Pain", soleTrader: true }, "fr"), "Au Bon Pain");
  // No enseigne: the OSM name is used only when it is not the person's own name.
  assert.equal(safeDisplayName({ enseigne: null, legalName: "PAUL MARTIN", name: "Paul Martin", soleTrader: true }, "fr"), "votre établissement");
  assert.equal(safeDisplayName({ enseigne: null, legalName: "PAUL MARTIN", name: "Le Fournil", soleTrader: true }, "fr"), "Le Fournil");
  assert.equal(safeDisplayName({ enseigne: null, legalName: null, name: null, soleTrader: true }, "en"), "your business");
  // Companies: enseigne, else name — the legal name is irrelevant.
  assert.equal(safeDisplayName({ enseigne: "MARTIN PLOMBERIE", legalName: "MARTIN PLOMBERIE SARL", name: "Martin Plomberie", soleTrader: false }, "fr"), "MARTIN PLOMBERIE");
  assert.equal(safeDisplayName({ enseigne: null, legalName: null, name: "  Le   Central ", soleTrader: null }, "fr"), "Le Central");
});

test("draftSubject: within 80 chars, generic name replaced by trade and town", () => {
  assert.equal(draftSubject(input("fr")), "Votre présence en ligne : Le Fournil");
  assert.equal(draftSubject(input("en")), "Your online presence: Le Fournil");
  const generic = input("fr", { prospect: { displayName: "votre établissement", town: "Foix", trade: "plomberie", country: "FR", soleTrader: true } });
  assert.equal(draftSubject(generic), "Votre présence en ligne : plomberie à Foix");
  const bare = input("en", { prospect: { displayName: "your business", town: null, trade: null, country: "GB", soleTrader: true } });
  assert.equal(draftSubject(bare), "Your online presence");
  const long = input("fr", { prospect: { displayName: "Boulangerie Pâtisserie Chocolaterie Salon de thé de la Grande Place du Marché", town: null, trade: null, country: "FR", soleTrader: false } });
  const s = draftSubject(long);
  assert.ok(s.length <= DRAFT_CAPS.subject.max && s.length >= DRAFT_CAPS.subject.min, s);
});

for (const locale of ["fr", "en"] as const) {
  test(`templateDraft (${locale}): four fields within caps, report URL present, no PII, no banned word`, () => {
    const d = templateDraft(input(locale));
    assert.ok(withinCaps(d), JSON.stringify({ subject: d.subject.length, body: d.body.length, callScript: d.callScript.length, note: d.noteForOwner.length }));
    assert.ok(d.body.includes(REPORT_URL));
    assert.equal(looksUnsafe(d), null);
    assert.ok(d.body.includes("Le Fournil"));
    assert.ok(d.body.includes(locale === "fr" ? "Site essentiel — à partir de 500 €" : "Site essentiel — from €500"));
    assert.ok(d.body.endsWith("Radu — Digital M"));
    // Call script: who we are, where the number came from, why, the refusal line.
    assert.match(d.callScript, /Digital M/);
    assert.match(d.callScript, locale === "fr" ? /votre site internet/ : /on your website/);
    assert.match(d.callScript, locale === "fr" ? /refuser cet appel/ : /refuse this call/);
    assert.match(d.callScript, locale === "fr" ? /je le note tout de suite/ : /note it right now/);
    // The AI-readability finding is worded "cannot read", never "error".
    assert.match(d.body, locale === "fr" ? /ne peuvent pas lire votre site/ : /cannot read your site/);
    assert.doesNotMatch(d.body, /\berror\b/i);
    // Note for the owner is English admin text with the score.
    assert.match(d.noteForOwner, /Score 58\/100 \(grade B\)/);
  });
}

test("templateDraft: custom signature, sole trader note, no-site opening", () => {
  const st = templateDraft(
    input("fr", {
      signature: "Marie — Digital M",
      prospect: { displayName: "votre établissement", town: "Pamiers", trade: "plomberie", country: "FR", soleTrader: true, phoneSource: "fr_register" },
    }),
  );
  assert.ok(st.body.endsWith("Marie — Digital M"));
  assert.match(st.callScript, /^Bonjour, Marie de Digital M/);
  assert.match(st.callScript, /annuaire des entreprises/);
  assert.match(st.noteForOwner, /Sole trader/);
  assert.ok(withinCaps(st));

  const empty = checks();
  for (const k of CHECK_ORDER) empty[k] = { key: k, status: "not_measured", points: 0, measured: false, details: {} };
  empty.reachable = { key: "reachable", status: "fail", points: 0, measured: true, details: {} };
  const ns = templateDraft(
    input("en", { checks: empty, flags: ["no-site"], top: ["reachable"], score: 0, grade: "C", fits: [{ pkg: "WEB", flags: ["no-site"] }] }),
  );
  assert.match(ns.body, /could not find a website for Le Fournil in Foix/);
  assert.ok(ns.body.includes("Site + AI — from €2,500"));
  assert.ok(withinCaps(ns));
});

test("templateDraft: all-pass audit still produces a complete draft within caps", () => {
  const d = templateDraft(input("fr", { checks: checks(), flags: [], top: [], score: 100, grade: "A", fits: [] }));
  assert.ok(withinCaps(d));
  assert.match(d.body, /Rien d'urgent/);
  assert.ok(d.body.includes(REPORT_URL));
  assert.match(d.noteForOwner, /Nothing urgent/);
});

test("templateDraft: a long town and trade never push the body past its cap, URL kept", () => {
  const d = templateDraft(
    input("fr", {
      prospect: {
        displayName: "Boulangerie Pâtisserie Chocolaterie Salon de thé de la Grande Place du Marché et des Halles",
        town: "Saint-Jean-de-Verges-sur-la-Grande-Rivière-des-Pyrénées-Ariégeoises",
        trade: "boulangerie",
        country: "FR",
        soleTrader: false,
      },
      checks: checks({ https: "fail", speed: "fail", seo_basics: "fail", contact: "fail", schema: "fail", ai_ready: "fail", housekeeping: "fail" }),
      flags: ["no-ssl", "slow-mobile", "not-mobile", "no-contact", "no-schema", "blocks-ai", "stale-site"],
      top: ["speed", "ai_ready", "https"],
      fits: [{ pkg: "WEB", flags: ["no-ssl", "slow-mobile", "not-mobile", "no-schema", "stale-site"] }, { pkg: "AGENT", flags: ["blocks-ai", "no-contact"] }],
    }),
  );
  assert.ok(d.body.length <= DRAFT_CAPS.body.max, String(d.body.length));
  assert.ok(d.body.includes(REPORT_URL));
});

test("followUp: short body in both languages, optional report line", () => {
  for (const locale of ["fr", "en"] as const) {
    const f = followUp(locale);
    assert.ok(f.length >= DRAFT_CAPS.body.min && f.length <= DRAFT_CAPS.body.max, `${locale} ${f.length}`);
    assert.ok(f.endsWith("Radu — Digital M"));
    assert.equal(containsEmail(f), false);
    assert.equal(containsBanned(f), null);
    assert.ok(!f.includes(REPORT_URL));
    const withUrl = followUp(locale, { reportUrl: REPORT_URL, signature: "Marie — Digital M" });
    assert.ok(withUrl.includes(REPORT_URL));
    assert.ok(withUrl.endsWith("Marie — Digital M"));
    assert.ok(withUrl.length <= DRAFT_CAPS.body.max);
  }
  assert.match(followUp("fr"), /dernier message/);
  assert.match(followUp("en"), /last message/);
});

test("guards: email addresses, phone patterns and banned words are caught; prices and years are not", () => {
  assert.equal(containsEmail("write to contact@digitalm.eu"), true);
  assert.equal(containsEmail("no address here"), false);
  assert.equal(containsPhone("appelez le 06 12 34 56 78"), true);
  assert.equal(containsPhone("call +33 6 12 34 56 78 today"), true);
  assert.equal(containsPhone("call (503) 555-0100"), true);
  assert.equal(containsPhone("à partir de 2 500 € en 2026, score 72/100, 10/09/2026"), false);
  assert.equal(containsPhone(REPORT_URL), false);
  assert.equal(containsBanned("This is a game-changer for you"), "game-changer");
  assert.equal(containsBanned("We will Transform Your Business"), "transform your business");
  assert.equal(containsBanned("plain words only"), null);
  assert.equal(BANNED_WORDS.length, 9);

  const ok = templateDraft(input("en"));
  assert.equal(looksUnsafe(ok), null);
  assert.equal(looksUnsafe({ ...ok, body: `${ok.body}\nReply to paul@example.fr` }), "body:email");
  assert.equal(looksUnsafe({ ...ok, callScript: `${ok.callScript} Call 06 12 34 56 78.` }), "callScript:phone");
  assert.equal(looksUnsafe({ ...ok, subject: "A cutting-edge site" }), "subject:banned:cutting-edge");
});

test("fitLength: word boundary and ellipsis only when needed", () => {
  assert.equal(fitLength("short text", 80), "short text");
  const long = fitLength("word ".repeat(40), 50);
  assert.ok(long.length <= 50);
  assert.ok(long.endsWith("…"));
  assert.ok(!long.endsWith(" …"));
});
