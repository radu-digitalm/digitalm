import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyHtml, cleanSubject, domainForNotice, formatLegalDate, identitySource, legalBlockProblems, legalFooter, legalFooterHtml, optoutUrl, privacyUrl, renderEmail } from "./legal.ts";
import type { LegalContext } from "./legal.ts";
import { RULES } from "./rules.ts";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";
const SITE = "https://digitalm.eu";

function ctx(over: Partial<LegalContext> = {}, prospect: Partial<LegalContext["prospect"]> = {}): LegalContext {
  return {
    siteUrl: SITE,
    token: TOKEN,
    prospect: { source: "fr_register", website: "https://www.boulangerie-martin.fr/", domainKey: "boulangerie-martin.fr", savedAt: "2026-09-01 08:15:00", tradeKey: "bakery", ...prospect },
    trade: "boulangerie",
    emailSource: { kind: "website", domain: "boulangerie-martin.fr", page: "/contact", auditDate: "2026-09-03 10:00:00" },
    ...over,
  };
}

test("urls and dates", () => {
  assert.equal(optoutUrl(SITE, TOKEN), `${SITE}/o/${TOKEN}`);
  assert.equal(optoutUrl(`${SITE}/`, TOKEN), `${SITE}/o/${TOKEN}`);
  assert.equal(privacyUrl(SITE, "fr"), `${SITE}/fr/legal/confidentialite`);
  assert.equal(privacyUrl(SITE, "en"), `${SITE}/en/legal/confidentialite`);
  assert.equal(formatLegalDate("2026-09-01 08:15:00", "fr"), "01/09/2026");
  assert.equal(formatLegalDate("2026-09-01 08:15:00", "en"), "1 September 2026");
  assert.equal(formatLegalDate("2026-03-31 23:30:00", "fr"), "01/04/2026", "Paris civil date");
  assert.equal(formatLegalDate(null, "en"), "");
});

test("identity source per prospect source, website for manual rows", () => {
  assert.deepEqual(identitySource({ source: "fr_register", website: null, domainKey: null }, "fr"), {
    label: "le registre national des entreprises (annuaire-entreprises.data.gouv.fr)",
    url: "https://annuaire-entreprises.data.gouv.fr",
  });
  assert.equal(identitySource({ source: "osm", website: null, domainKey: null }, "fr").label, "OpenStreetMap (données © les contributeurs d'OpenStreetMap, ODbL)");
  assert.equal(identitySource({ source: "osm", website: null, domainKey: null }, "en").label, "OpenStreetMap (data © OpenStreetMap contributors, ODbL)");
  assert.equal(identitySource({ source: "companies_house", website: null, domainKey: null }, "en").label, "Companies House");
  assert.deepEqual(identitySource({ source: "manual", website: "https://www.example.fr/x", domainKey: "example.fr" }, "fr"), {
    label: "votre site internet example.fr",
    url: "https://www.example.fr/x",
  });
  assert.equal(identitySource({ source: "manual", website: "javascript:alert(1)", domainKey: "example.fr" }, "en").url, "https://example.fr");
  assert.equal(domainForNotice({ website: "https://www.shop.co.uk/", domainKey: null }), "shop.co.uk");
});

test("FR footer: structure, opt-out line alone after the rule, sources, dates, trade, privacy URL", () => {
  const text = legalFooter(RULES.FR, ctx(), "fr");
  const lines = text.split("\n");
  assert.equal(lines[0], "—");
  assert.equal(lines[1], `Pour ne plus recevoir nos messages : répondez STOP à cet e-mail ou cliquez ici : ${SITE}/o/${TOKEN}`);
  assert.equal(lines[2], "");
  assert.match(lines[3]!, /^Digital M — nom commercial de Digital Management Ltd/);
  assert.ok(text.includes("3 Résidence des Écoles, 09000 Ferrières-sur-Ariège"));
  assert.ok(text.includes("sur le registre national des entreprises (annuaire-entreprises.data.gouv.fr) (https://annuaire-entreprises.data.gouv.fr) le 01/09/2026"));
  assert.ok(text.includes("et votre adresse e-mail professionnelle sur votre site internet boulangerie-martin.fr (page /contact) le 03/09/2026, dans le cadre de votre activité de boulangerie."));
  assert.ok(text.includes(`Détails : ${SITE}/fr/legal/confidentialite`));
  assert.ok(text.endsWith("ce message vaut information au titre de l'article 14 du RGPD."));
  assert.ok(!text.includes("{"), "no placeholder left");
});

test("a FR-rule prospect with locale en gets the en_footer_fr block; UK and US rules are English whatever the locale", () => {
  const enFr = legalFooter(RULES.FR, ctx(), "en");
  assert.ok(enFr.startsWith("—\nTo stop receiving our emails: reply STOP or click here: "));
  assert.ok(enFr.includes("French establishment: 3 Résidence des Écoles, 09000 Ferrières-sur-Ariège, France"));
  assert.ok(enFr.includes("on the French national business register (annuaire-entreprises.data.gouv.fr) (https://annuaire-entreprises.data.gouv.fr) on 1 September 2026"));
  assert.ok(enFr.includes("art. L34-5 of the French CPCE"));
  assert.ok(enFr.includes(`Details: ${SITE}/en/legal/confidentialite`));

  const uk = legalFooter(RULES.GB, ctx({}, { source: "companies_house" }), "fr");
  assert.ok(uk.includes("67 Meridian Centre, Havant, Hampshire, PO9 1UN, United Kingdom"));
  assert.ok(uk.includes("regulation 22 of the Privacy and Electronic Communications Regulations 2003 does not require your prior consent"));
  assert.ok(uk.includes("(regulation 23)"));
  assert.ok(uk.includes("on Companies House (https://find-and-update.company-information.service.gov.uk) on 1 September 2026"));
  assert.ok(uk.includes("ico.org.uk"));
  assert.ok(uk.includes(`${SITE}/en/legal/confidentialite`), "UK rule → EN privacy page even for a fr locale");

  const us = legalFooter(RULES.US, ctx({}, { source: "osm" }), "en");
  assert.ok(us.split("\n")[1]!.endsWith(`${SITE}/o/${TOKEN} — we honour every request at once, and in any case within 10 business days.`));
  assert.ok(us.includes("This is a commercial message (advertisement) from Digital M"));
  assert.ok(us.includes("67 Meridian Centre"));
  assert.ok(us.includes("Article 6(1)(f) GDPR / UK GDPR"));
  assert.ok(us.includes("ico.org.uk"));
  assert.ok(us.includes("ODbL"), "OSM-sourced footer carries the ODbL attribution");
});

test("the email sentence is omitted when the address came from the identity source; trade falls back", () => {
  const fr = legalFooter(RULES.FR, ctx({ emailSource: null, trade: null }), "fr");
  assert.ok(fr.includes("le 01/09/2026, dans le cadre de votre activité de votre activité professionnelle."));
  assert.ok(!fr.includes("adresse e-mail professionnelle"));
  const en = legalFooter(RULES.GB, ctx({ emailSource: null, trade: "" }), "en");
  assert.ok(en.includes("on 1 September 2026, in connection with your your business business."));
  assert.ok(!en.includes("your business email address"));
  // Page unknown → the domain alone.
  const noPage = legalFooter(RULES.FR, ctx({ emailSource: { kind: "website", domain: "boulangerie-martin.fr", page: null, auditDate: "2026-09-03 10:00:00" } }), "fr");
  assert.ok(noPage.includes("sur votre site internet boulangerie-martin.fr le 03/09/2026"));
});

test("a validated override is described as a public listing — never the website, never a date", () => {
  const fr = legalFooter(RULES.FR, ctx({ emailSource: { kind: "listing" } }), "fr");
  assert.ok(fr.includes("le 01/09/2026, et votre adresse e-mail professionnelle dans un annuaire ou une mention publique, dans le cadre de votre activité de boulangerie."));
  assert.ok(!fr.includes("sur votre site internet"), "no site claimed for the address");
  assert.ok(!fr.includes("03/09/2026"), "no audit date claimed for the address");
  const en = legalFooter(RULES.GB, ctx({ emailSource: { kind: "listing" } }, { source: "companies_house" }), "en");
  assert.ok(en.includes("on 1 September 2026, and your business email address from a public listing, in connection with your boulangerie business."));
  assert.ok(!en.includes("email address on your website"), "no site claimed for the address");
  assert.deepEqual(legalBlockProblems(fr), []);
  assert.deepEqual(legalBlockProblems(en), []);
});

test("legalBlockProblems: every complete footer passes; placeholders, empty identity and empty dates are caught", () => {
  for (const [rule, locale] of [
    [RULES.FR, "fr"],
    [RULES.FR, "en"],
    [RULES.GB, "en"],
    [RULES.US, "en"],
  ] as const) {
    assert.deepEqual(legalBlockProblems(legalFooter(rule, ctx({}, { source: rule === RULES.FR ? "fr_register" : "osm" }), locale)), [], `${rule.country}/${locale}`);
    assert.deepEqual(legalBlockProblems(legalFooter(rule, ctx({ emailSource: null, trade: null }), locale)), [], `${rule.country}/${locale} without the email sentence`);
  }
  // A manual row with no website: label "votre site internet " and url "" → "sur votre site internet  () le".
  const manual = legalFooter(RULES.FR, ctx({}, { source: "manual", website: null, domainKey: null }), "fr");
  const problems = legalBlockProblems(manual);
  assert.ok(problems.some((p) => p.startsWith("empty parentheses")), problems.join(" | "));
  assert.ok(problems.some((p) => p.startsWith("doubled space")), problems.join(" | "));
  // An unparsable saved_at → "le , et" in FR, "on , and" in EN.
  const noDate = legalFooter(RULES.FR, ctx({}, { savedAt: "not a date" }), "fr");
  assert.ok(legalBlockProblems(noDate).some((p) => p.startsWith("comma or full stop")));
  assert.ok(legalBlockProblems(legalFooter(RULES.GB, ctx({ emailSource: { kind: "website", domain: "x.co.uk", page: null, auditDate: "garbage" } }, { source: "companies_house" }), "en")).length > 0);
  assert.deepEqual(legalBlockProblems("Bonjour {trade}"), ["placeholder left in: {trade}"]);
  assert.deepEqual(legalBlockProblems("   "), ["empty block"]);
});

test("HTML rendering: rule paragraph, opt-out paragraph with the link first, escaped values, linked URLs", () => {
  const html = legalFooterHtml(RULES.FR, ctx({ trade: "<b>pâtisserie</b> & co" }), "fr");
  const paras = html.split("\n");
  assert.equal(paras[0], '<p style="margin:24px 0 0;color:#999;">—</p>');
  assert.ok(paras[1]!.startsWith('<p style="margin:8px 0 16px;'));
  assert.ok(paras[1]!.includes(`<a href="${SITE}/o/${TOKEN}" style="color:#555;">${SITE}/o/${TOKEN}</a>`));
  assert.ok(paras[1]!.endsWith("</p>"));
  assert.ok(html.includes("&lt;b&gt;pâtisserie&lt;/b&gt; &amp; co"));
  assert.ok(html.includes(`<a href="${SITE}/fr/legal/confidentialite"`));
  assert.ok(html.includes('<a href="https://annuaire-entreprises.data.gouv.fr"'));
  assert.ok(!html.includes("{"), "no placeholder left");
  assert.equal((html.match(/<p /g) ?? []).length, 2 + 4, "rule + opt-out + four notice paragraphs");
});

test("renderEmail: body then block in text; escaped paragraphs then block in HTML; subject cleaned", () => {
  const { text, html, legal } = renderEmail("Bonjour,\n\nPremière ligne\nseconde ligne <script>\n\nRadu", RULES.FR, ctx(), "fr");
  assert.ok(text.startsWith("Bonjour,\n\nPremière ligne\nseconde ligne <script>\n\nRadu\n\n—\nPour ne plus recevoir"));
  assert.ok(text.endsWith(legal));
  assert.ok(html.includes("<p style=\"margin:0 0 14px;font-size:15px;line-height:1.6;color:#222;\">Première ligne<br>seconde ligne &lt;script&gt;</p>"));
  assert.ok(html.indexOf("Radu</p>") < html.indexOf("—</p>"), "the body comes before the block");
  assert.equal(bodyHtml("a\r\n\r\nb"), '<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#222;">a</p>\n<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#222;">b</p>');
  assert.equal(cleanSubject("Votre site\r\nBcc: x@y.z   ok "), "Votre site Bcc: x@y.z ok");
});
