import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTACT_LINK_RE,
  LEGAL_LINK_RE,
  clean,
  copyrightYear,
  countMixedContent,
  decodeEntities,
  detectBooking,
  detectChat,
  detectCms,
  extractSite,
  findLinks,
  findSocials,
  firstMailto,
  firstTel,
  fold,
  forbidsExtraction,
  hasEmailForm,
  htmlToText,
  metaDescription,
  pageTitle,
  pickLink,
  stripControl,
  summariseJsonLd,
} from "./extract.ts";
import type { PageLike } from "./extract.ts";

const page = (text: string, url = "https://www.example.fr/"): PageLike => ({ url, finalUrl: url, text, contentType: "text/html" });

test("firstMailto: a mailto with two addresses → first valid address only", () => {
  assert.equal(firstMailto('<a href="mailto:contact@example.fr,paul@example.fr">Écrire</a>'), "contact@example.fr");
  assert.equal(firstMailto('<a href="mailto:bad address,paul@example.fr?subject=Hi">x</a>'), "paul@example.fr");
  assert.equal(firstMailto("<a href='mailto:Info@Example.FR?cc=b@example.fr'>x</a>"), "info@example.fr");
  assert.equal(firstMailto('<a href="mailto:contact%40example.fr">x</a>'), "contact@example.fr");
  assert.equal(firstMailto('<a href="mailto:">x</a><a href="mailto:second@example.fr">y</a>'), "second@example.fr");
  assert.equal(firstMailto('<a href="mailto:nope">x</a>'), null);
  assert.equal(firstMailto("<p>contact@example.fr</p>"), null);
  assert.equal(firstMailto(`<a href="mailto:${"a".repeat(260)}@example.fr">x</a>`), null);
});

test("firstTel: normalised digits, leading + kept, junk dropped", () => {
  assert.equal(firstTel('<a href="tel:+33 5 61 00 00 00">Appeler</a>'), "+33561000000");
  assert.equal(firstTel('<a href="tel:05.61.00.00.00">x</a>'), "0561000000");
  assert.equal(firstTel('<a href="tel:0033561000000">x</a>'), "+33561000000");
  assert.equal(firstTel('<a href="tel:+33 (0)5 61 00 00 00">x</a>'), "+33561000000");
  assert.equal(firstTel('<a href="tel:123">x</a>'), null);
  assert.equal(firstTel("<p>05 61 00 00 00</p>"), null);
});

test("findLinks resolves relative hrefs, keeps mailto/tel raw, drops javascript:", () => {
  const html = `
    <a href="/contact">Contact</a>
    <a href='nous-contacter.html'>Nous contacter</a>
    <a href="https://www.facebook.com/maboulangerie">FB</a>
    <a href="mailto:contact@example.fr">Mail</a>
    <a href="javascript:void(0)">x</a>
    <a href="#top">top</a>
    <a href="https://user:pw@evil.example/">creds</a>`;
  const links = findLinks(html, "https://www.example.fr/fr/");
  assert.equal(links.find((l) => l.text === "Contact")?.href, "https://www.example.fr/contact");
  assert.equal(links.find((l) => l.text === "Nous contacter")?.href, "https://www.example.fr/fr/nous-contacter.html");
  assert.equal(links.find((l) => l.text === "FB")?.href, "https://www.facebook.com/maboulangerie");
  assert.equal(links.find((l) => l.text === "Mail")?.href, null);
  assert.equal(links.find((l) => l.text === "Mail")?.raw, "mailto:contact@example.fr");
  assert.equal(links.find((l) => l.text === "x")?.href, null);
  assert.equal(links.find((l) => l.text === "top")?.href, "https://www.example.fr/fr/#top");
  assert.equal(links.find((l) => l.text === "creds")?.href, null);
});

test("pickLink: same domain only, accent-folded, skips the home page itself", () => {
  const html = `
    <a href="https://www.example.fr/">Accueil</a>
    <a href="https://www.facebook.com/contact">FB contact</a>
    <a href="https://example.fr/nous-contacter">Contact</a>
    <a href="/mentions-l%C3%A9gales">Mentions légales</a>
    <a href="/politique-de-confidentialité">Confidentialité</a>`;
  const links = findLinks(html, "https://www.example.fr/");
  assert.equal(pickLink(links, CONTACT_LINK_RE, "https://www.example.fr/"), "https://example.fr/nous-contacter");
  assert.equal(pickLink(links, LEGAL_LINK_RE, "https://www.example.fr/"), "https://www.example.fr/mentions-l%C3%A9gales");
  assert.equal(pickLink(findLinks('<a href="/contact#form">c</a>', "https://www.example.fr/"), CONTACT_LINK_RE, "https://www.example.fr/"), "https://www.example.fr/contact");
  assert.equal(pickLink(findLinks('<a href="https://other.example/contact">c</a>', "https://www.example.fr/"), CONTACT_LINK_RE, "https://www.example.fr/"), null);
});

test("findSocials: first profile per network, share/embed links ignored", () => {
  const html = `
    <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
    <a href="https://www.facebook.com/maboulangerie">fb</a>
    <a href="https://www.facebook.com/autre">fb2</a>
    <a href="https://www.instagram.com/maboulangerie/">ig</a>
    <a href="https://fr.linkedin.com/company/digital-m">li</a>
    <a href="https://www.tiktok.com/@maboulangerie">tt</a>
    <a href="https://youtu.be/abc123">yt</a>
    <a href="https://www.youtube.com/">yt home</a>`;
  const s = findSocials(findLinks(html, "https://www.example.fr/"));
  assert.deepEqual(s, {
    facebook: "https://www.facebook.com/maboulangerie",
    instagram: "https://www.instagram.com/maboulangerie/",
    linkedin: "https://fr.linkedin.com/company/digital-m",
    tiktok: "https://www.tiktok.com/@maboulangerie",
    youtube: "https://youtu.be/abc123",
  });
  assert.deepEqual(findSocials(findLinks('<a href="https://www.facebook.com/">fb</a>', "https://x.fr/")), {});
});

test("detectCms: shop platforms before WordPress, generator meta honoured", () => {
  assert.equal(detectCms('<link rel="stylesheet" href="/wp-content/themes/x/style.css">'), "WordPress");
  assert.equal(detectCms('<link href="/wp-content/plugins/woocommerce/assets/css/x.css"><meta name="generator" content="WordPress 6.4">'), "WooCommerce");
  assert.equal(detectCms('<script src="https://cdn.shopify.com/s/files/1/x.js"></script>'), "Shopify");
  assert.equal(detectCms('<meta name="generator" content="PrestaShop">'), "PrestaShop");
  assert.equal(detectCms('<meta content="Joomla! - Open Source Content Management" name="generator">'), "Joomla");
  assert.equal(detectCms('<meta name="generator" content="Hugo 0.120.0">'), "Hugo");
  assert.equal(detectCms("<html><body>plain</body></html>"), null);
});

test("detectBooking / detectChat / hasEmailForm", () => {
  const noLinks = findLinks("", "https://x.fr/");
  assert.equal(detectBooking('<a href="https://calendly.com/radu/30min">rdv</a>', noLinks), "calendly");
  assert.equal(detectBooking('<iframe src="https://www.planity.com/widget/abc"></iframe>', noLinks), "planity");
  assert.equal(detectBooking('<a href="https://www.thefork.fr/restaurant/x">réserver</a>', noLinks), "thefork");
  assert.equal(detectBooking('<a href="https://reserve.google.com/x">book</a>', noLinks), "google");
  const html = '<a href="/prendre-rendez-vous/">RDV</a>';
  assert.equal(detectBooking(html, findLinks(html, "https://x.fr/")), "site");
  const html2 = '<a href="/book-now">Book</a>';
  assert.equal(detectBooking(html2, findLinks(html2, "https://x.fr/")), "site");
  const html3 = '<a href="/books">Livres</a><a href="/rdv-annules">x</a>';
  assert.equal(detectBooking(html3, findLinks(html3, "https://x.fr/")), "site");
  const html4 = '<a href="/bookshop">Livres</a><a href="/about">x</a>';
  assert.equal(detectBooking(html4, findLinks(html4, "https://x.fr/")), null);

  assert.equal(detectChat('<a href="https://wa.me/33612345678">WhatsApp</a>'), "whatsapp");
  assert.equal(detectChat('<script src="https://client.crisp.chat/l.js"></script>'), "crisp");
  assert.equal(detectChat('<script src="https://embed.tawk.to/abc/def"></script>'), "tawk");
  assert.equal(detectChat('<script src="https://js.hs-scripts.com/123.js"></script>'), "hubspot");
  assert.equal(detectChat("<p>Appelez-nous</p>"), null);

  assert.equal(hasEmailForm('<form><input type="email" name="x"></form>'), true);
  assert.equal(hasEmailForm('<form><input name="courriel"></form>'), true);
  assert.equal(hasEmailForm('<form><input type="text" name="nom"></form>'), false);
});

test("summariseJsonLd: business type with telephone and opening hours, @graph, arrays, junk", () => {
  const full = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Bakery","name":"Le Fournil","telephone":"+33561000000","openingHoursSpecification":[{"@type":"OpeningHoursSpecification","dayOfWeek":"Monday","opens":"07:00","closes":"19:00"}]}</script>`;
  assert.deepEqual(summariseJsonLd(full), { present: true, type: "Bakery", localBusiness: true, telephone: true, openingHours: true });
  const graph = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","url":"https://x.fr"},{"@type":["Organization","LocalBusiness"],"telephone":"05 61 00 00 00","openingHours":"Mo-Fr 09:00-18:00"}]}</script>`;
  assert.deepEqual(summariseJsonLd(graph), { present: true, type: "Organization", localBusiness: true, telephone: true, openingHours: true });
  const partial = `<script type="application/ld+json">{"@type":"Restaurant","name":"X","telephone":""}</script>`;
  assert.deepEqual(summariseJsonLd(partial), { present: true, type: "Restaurant", localBusiness: true, telephone: false, openingHours: false });
  const website = `<script type="application/ld+json">{"@type":"WebPage","name":"X"}</script>`;
  assert.deepEqual(summariseJsonLd(website), { present: true, type: null, localBusiness: false, telephone: false, openingHours: false });
  const subtype = `<script type="application/ld+json">{"@type":"HairSalon","telephone":"1","openingHours":["Mo 9-18"]}</script>`;
  assert.equal(summariseJsonLd(subtype).openingHours, true);
  const nested = `<script type="application/ld+json">{"@type":"Plumber","contactPoint":{"@type":"ContactPoint","telephone":"+33"}}</script>`;
  assert.equal(summariseJsonLd(nested).telephone, true);
  assert.deepEqual(summariseJsonLd(`<script type="application/ld+json">{not json</script>`), { present: false, type: null, localBusiness: false, telephone: false, openingHours: false });
  assert.equal(summariseJsonLd("<p>nothing</p>").present, false);
});

test("copyrightYear takes the latest year near a copyright mark", () => {
  assert.equal(copyrightYear("<footer>© 2019 Le Fournil</footer>"), 2019);
  assert.equal(copyrightYear("<footer>&copy; 2015 - 2024 Le Fournil</footer>"), 2024);
  assert.equal(copyrightYear("<footer>Copyright 2021, tous droits réservés</footer>"), 2021);
  assert.equal(copyrightYear("<footer>© Le Fournil 2023</footer>"), 2023);
  assert.equal(copyrightYear("<footer>(c) 2018 · © 2022</footer>"), 2022);
  assert.equal(copyrightYear("<footer>Le Fournil — 09000 Foix</footer>"), null);
  assert.equal(copyrightYear("<p>Fondée en 1998</p>"), null);
});

test("countMixedContent counts sub-resources only", () => {
  const html = `
    <script src="http://cdn.example/x.js"></script>
    <img src="http://img.example/a.png">
    <link rel="stylesheet" href="http://cdn.example/x.css">
    <link rel="canonical" href="http://www.example.fr/">
    <a href="http://www.example.fr/page">plain link</a>
    <div style="background:url(http://img.example/bg.png)"></div>
    <img src="https://img.example/b.png">`;
  assert.equal(countMixedContent(html), 4);
  assert.equal(countMixedContent('<img src="https://x/a.png"><a href="http://x/">l</a>'), 0);
});

test("forbidsExtraction: the five contract patterns, accent-insensitive", () => {
  assert.equal(forbidsExtraction("Toute extraction des données de ce site est interdite."), true);
  assert.equal(forbidsExtraction("Il est interdit d'utiliser ce site à des fins de prospection."), true);
  assert.equal(forbidsExtraction("Il est interdit de faire du démarchage commercial."), true);
  assert.equal(forbidsExtraction("Interdite : toute extraction."), true);
  assert.equal(forbidsExtraction("No solicitation of any kind."), true);
  assert.equal(forbidsExtraction("No commercial solicitation."), true);
  assert.equal(forbidsExtraction("Data mining is strictly prohibited."), true);
  assert.equal(forbidsExtraction("Scraping of this website is forbidden."), true);
  assert.equal(forbidsExtraction("Nos horaires : 9h-18h. Contactez-nous pour toute question."), false);
  assert.equal(forbidsExtraction("We welcome partnership solicitations."), false);
});

test("text helpers: decodeEntities, clean, htmlToText, fold, stripControl", () => {
  assert.equal(decodeEntities("Caf&eacute; &amp; Th&#233; &#x2014; &copy; &unknown;"), "Café & Thé — © &unknown;");
  assert.equal(clean("  Boulangerie\n\tMartin  ", 5), "Boula");
  assert.equal(htmlToText("<p>Bonjour <b>le</b> monde</p><script>var x = 1;</script><style>p{}</style><!-- c --><noscript>no</noscript>"), "Bonjour le monde");
  assert.equal(fold("Démarchage Interdit — À"), "demarchage interdit — a");
  assert.equal(stripControl("a bcde\tf\ng"), "abcde\tf\ng");
});

test("pageTitle / metaDescription with caps and either attribute order", () => {
  assert.equal(pageTitle(`<html><head><title>  Boulangerie &amp; Pâtisserie Martin </title></head></html>`), "Boulangerie & Pâtisserie Martin");
  assert.equal(pageTitle(`<title>${"x".repeat(300)}</title>`)?.length, 200);
  assert.equal(pageTitle("<p>no title</p>"), null);
  assert.equal(metaDescription(`<meta name="description" content="Pain au levain à Foix">`), "Pain au levain à Foix");
  assert.equal(metaDescription(`<meta content="OG desc" property="og:description">`), "OG desc");
  assert.equal(metaDescription(`<meta name="keywords" content="x">`), null);
  assert.equal(metaDescription(`<meta name="description" content="${"y".repeat(400)}">`)?.length, 300);
});

test("extractSite: home first, contact page supplies the email, e-commerce and forbids flags", () => {
  const home = page(`<html><head><title>Le Fournil</title><meta name="viewport" content="width=device-width"><meta name="description" content="Boulangerie à Foix"></head>
    <body><a href="/contact">Contact</a><a href="/mentions-legales">Mentions</a><a href="/panier">Panier</a>
    <a href="https://www.instagram.com/lefournil/">ig</a><a href="tel:+33561000000">05 61</a>
    <script type="application/ld+json">{"@type":"Bakery","telephone":"05","openingHours":"Mo"}</script>
    <footer>© 2016 Le Fournil</footer></body></html>`);
  const contact = page(`<html><body><form><input type="email" name="email"></form><a href="mailto:bonjour@lefournil.fr,paul@lefournil.fr">Écrire</a></body></html>`, "https://www.example.fr/contact");
  const legal = page(`<html><body><p>Toute extraction de données à des fins de prospection est interdite.</p></body></html>`, "https://www.example.fr/mentions-legales");
  const x = extractSite([home, contact, legal]);
  assert.equal(x.title, "Le Fournil");
  assert.equal(x.description, "Boulangerie à Foix");
  assert.equal(x.hasViewport, true);
  assert.equal(x.email, "bonjour@lefournil.fr");
  assert.equal(x.emailPage, "https://www.example.fr/contact");
  assert.equal(x.phone, "+33561000000");
  assert.equal(x.hasTel, true);
  assert.equal(x.hasMailto, true);
  assert.equal(x.hasEmailForm, true);
  assert.deepEqual(x.socials, { instagram: "https://www.instagram.com/lefournil/" });
  assert.equal(x.ecommerce, true);
  assert.equal(x.booking, null);
  assert.equal(x.chat, null);
  assert.deepEqual(x.jsonLd, { present: true, type: "Bakery", localBusiness: true, telephone: true, openingHours: true });
  assert.equal(x.copyrightYear, 2016);
  assert.equal(x.legalLink, true);
  assert.equal(x.forbidsExtraction, true);
  assert.equal(x.pagesScanned, 3);
  assert.equal(x.mixedContent, 0);

  const empty = extractSite([]);
  assert.equal(empty.pagesScanned, 0);
  assert.equal(empty.email, null);
  const shop = extractSite([page('<link href="/wp-content/plugins/woocommerce/x.css">')]);
  assert.equal(shop.cms, "WooCommerce");
  assert.equal(shop.ecommerce, true);
});
