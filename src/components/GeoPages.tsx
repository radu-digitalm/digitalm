import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getContent } from "@/content";
import type { Locale } from "@/lib/i18n";
import { isLocale } from "@/lib/i18n";
import { SITE_URL } from "@/lib/seo";
import { localBusinessNode } from "@/lib/localBusiness";
import { communes, communeBy, communesByDept, DEPT_META, type Commune } from "@/content/communes";
import { Eyebrow, CtaBand } from "./sections";
import { KeyFigures, ServiceGrid } from "./LocalSections";
import { BookingWidget } from "./BookingWidget";

const LOCALES: Locale[] = ["fr", "en"];

// Correct French articles per (feminine, vowel/consonant) département.
const DEPT_FR: Record<string, { en: string; de: string; toute: string }> = {
  ariege: { en: "en Ariège", de: "de l'Ariège", toute: "toute l'Ariège" },
  "haute-garonne": { en: "en Haute-Garonne", de: "de la Haute-Garonne", toute: "toute la Haute-Garonne" },
};

type G = { name: string; code: string; en: string; de: string; toute: string };
function gram(deptSlug: string): G {
  const d = DEPT_META[deptSlug as "ariege" | "haute-garonne"];
  return { name: d.name, code: d.code, ...DEPT_FR[deptSlug] };
}

function hrefFor(c: Commune, locale: Locale) {
  return c.richHref ? `/${locale}${c.richHref}` : `/${locale}/agence-ia/${c.deptSlug}/${c.slug}`;
}

const STR = {
  fr: {
    home: "Accueil",
    agence: "Agence IA",
    book: "Réserver un appel",
    price: "À partir de 500 €",
    communeEyebrow: (n: string, cp: string) => `Agence IA · ${n} (${cp})`,
    communeH1: (n: string, g: G) => `Agence IA à ${n} (${g.name}) — intelligence artificielle & site internet`,
    introA: (n: string, g: G) => `Digital M est votre agence IA — agence d'intelligence artificielle et agence web — de proximité pour ${n} et ${g.toute}. Nous aidons les commerçants, artisans, professions libérales et PME à mettre l'intelligence artificielle au travail : des chatbots qui répondent aux clients, des automatisations qui font gagner des heures, des sites internet qui vendent, et des audits de sécurité honnêtes.`,
    introB: (n: string, pop: string) => `${n} compte environ ${pop} habitants. Plutôt qu'un prestataire 100 % à distance, vous avez ici un interlocuteur basé en Ariège, qui répond vite, parle clair et ne facture que ce qui sert. Tarifs à partir de 500 €, audit express gratuit sous 48 h.`,
    nearby: (g: G) => `Villes proches ${g.en}`,
    allTowns: (g: G) => `Toutes les villes ${g.de} →`,
    faqTitle: (n: string) => `Questions fréquentes — agence IA à ${n}`,
    faq: (n: string, g: G) => [
      { q: `Proposez-vous une agence IA à ${n} ?`, a: `Oui. Digital M accompagne les TPE/PME, commerçants et artisans de ${n} et ${g.de} sur l'IA, la création de site et l'audit de sécurité, depuis notre présence en Ariège.` },
      { q: `Combien coûte une solution IA ou un site à ${n} ?`, a: `Nos tarifs sont transparents, à partir de 500 €, avec un devis fixe validé avant de commencer. Un audit express gratuit sous 48 h vous donne un premier avis, sans engagement.` },
      { q: `Intervenez-vous à distance ou sur place à ${n} ?`, a: `Les deux. Basés en Ariège, nous travaillons à distance et pouvons nous déplacer à ${n} et ${g.en} quand c'est utile.` },
      { q: `En combien de temps un projet est-il livré ?`, a: `Un site essentiel ou une première automatisation se lance en quelques jours ; un site avec IA intégrée, environ une semaine.` },
      { q: `Mes données sont-elles protégées ?`, a: `Oui — données clients et de paiement traitées avec soin, dans le respect du RGPD ; nous pouvons aussi auditer la sécurité de votre site.` },
    ],
    hubEyebrow: (g: G) => `Agence IA · ${g.name} (${g.code})`,
    hubH1: (g: G) => `Agence IA ${g.en}`,
    hubIntro: (g: G) => `Digital M accompagne les TPE/PME, commerçants et artisans ${g.de} sur l'IA utile : chatbots, automatisation, création de site, e-commerce et audits de sécurité. Une présence réelle en Ariège, des tarifs clairs à partir de 500 € et un audit express gratuit sous 48 h. Trouvez votre ville ci-dessous.`,
    hubTowns: (g: G) => `Villes desservies ${g.en}`,
    idxEyebrow: "Agence IA · Occitanie",
    idxH1: "Agence IA en Ariège et Haute-Garonne",
    idxIntro: "Digital M met l'intelligence artificielle au travail pour les TPE/PME, commerçants et artisans d'Occitanie : chatbots, automatisation, création de site, e-commerce et audits de sécurité. Présence réelle en Ariège, tarifs clairs à partir de 500 €, audit express gratuit sous 48 h.",
    idxCard: (n: number) => `${n} villes desservies — Agence IA, sites web et audits.`,
    idxCardCta: "Voir les villes →",
    ctaTitle: "Mettons l'IA au travail dans votre commerce.",
    ctaBody: "Dites-nous où vous en êtes — nous vous dirons, honnêtement, où l'IA aide et où elle n'aide pas.",
    metaCommuneT: (n: string, cp: string, g: G) => `Agence IA à ${n} (${cp}) — ${g.name} | Digital M`,
    metaCommuneD: (n: string) => `Agence IA à ${n} : chatbots, automatisation, création de site et audit de sécurité pour les TPE/PME. Tarifs dès 500 €, audit gratuit sous 48 h.`,
    metaHubT: (g: G) => `Agence IA ${g.en} (${g.code}) — villes desservies | Digital M`,
    metaHubD: (g: G) => `Agence IA et création de sites ${g.en} : IA, automatisation, e-commerce et audits de sécurité pour les TPE/PME. Toutes les villes desservies.`,
    metaIdxT: "Agence IA en Occitanie — Ariège & Haute-Garonne | Digital M",
    metaIdxD: "Agence IA pour les TPE/PME en Ariège (09) et Haute-Garonne (31) : IA, sites web, e-commerce et audits de sécurité. Tarifs dès 500 €.",
  },
  en: {
    home: "Home",
    agence: "AI agency",
    book: "Book a call",
    price: "From €500",
    communeEyebrow: (n: string, cp: string) => `AI agency · ${n} (${cp})`,
    communeH1: (n: string, g: G) => `AI agency in ${n} (${g.name}) — artificial intelligence & websites`,
    introA: (n: string, g: G) => `Digital M is your local AI agency for ${n} and the wider ${g.name}. We help shops, tradespeople, professionals and SMEs put AI to work: chatbots that answer customers, automations that save hours, websites that sell, and honest security audits.`,
    introB: (n: string, pop: string) => `${n} has around ${pop} inhabitants. Rather than a 100%-remote provider, you get a contact based in the Ariège who replies fast, talks straight and only charges for what helps. Prices from €500, free 48-hour express audit.`,
    nearby: (g: G) => `Nearby towns in ${g.name}`,
    allTowns: (g: G) => `All ${g.name} towns →`,
    faqTitle: (n: string) => `FAQ — AI agency in ${n}`,
    faq: (n: string, g: G) => [
      { q: `Do you offer an AI agency in ${n}?`, a: `Yes. Digital M supports SMEs, shops and tradespeople in ${n} and across the wider ${g.name} with AI, website creation and security audits, from our base in the Ariège.` },
      { q: `How much does an AI solution or website cost in ${n}?`, a: `Our pricing is transparent, from €500, with a fixed quote agreed before we start. A free 48-hour express audit gives you a first opinion, no commitment.` },
      { q: `Do you work remotely or on-site in ${n}?`, a: `Both. Based in the Ariège, we work remotely and can come to ${n} and the wider ${g.name} when it helps.` },
      { q: `How quickly is a project delivered?`, a: `A starter site or a first automation goes live in days; a site with AI built in takes about a week.` },
      { q: `Is my data protected?`, a: `Yes — customer and payment data handled with care and GDPR-compliant; we can also audit your site's security.` },
    ],
    hubEyebrow: (g: G) => `AI agency · ${g.name} (${g.code})`,
    hubH1: (g: G) => `AI agency in ${g.name}`,
    hubIntro: (g: G) => `Digital M supports SMEs, shops and tradespeople across ${g.name} with practical AI: chatbots, automation, website creation, e-commerce and security audits. A real presence in the Ariège, clear pricing from €500 and a free 48-hour express audit. Find your town below.`,
    hubTowns: (g: G) => `Towns we serve in ${g.name}`,
    idxEyebrow: "AI agency · Occitanie",
    idxH1: "AI agency in Ariège and Haute-Garonne",
    idxIntro: "Digital M puts AI to work for SMEs, shops and tradespeople across Occitanie: chatbots, automation, website creation, e-commerce and security audits. A real presence in the Ariège, clear pricing from €500, free 48-hour express audit.",
    idxCard: (n: number) => `${n} towns served — AI, websites and audits.`,
    idxCardCta: "See the towns →",
    ctaTitle: "Let's put AI to work in your business.",
    ctaBody: "Tell us where you are — we'll tell you, honestly, where AI helps and where it doesn't.",
    metaCommuneT: (n: string, cp: string, g: G) => `AI agency in ${n} (${cp}) — ${g.name} | Digital M`,
    metaCommuneD: (n: string) => `AI agency in ${n}: chatbots, automation, website creation and security audits for SMEs. From €500, free 48-hour audit.`,
    metaHubT: (g: G) => `AI agency in ${g.name} (${g.code}) — towns served | Digital M`,
    metaHubD: (g: G) => `AI agency and website creation in ${g.name}: AI, automation, e-commerce and security audits for SMEs. All towns served.`,
    metaIdxT: "AI agency in Occitanie — Ariège & Haute-Garonne | Digital M",
    metaIdxD: "AI agency for SMEs in Ariège (09) and Haute-Garonne (31): AI, websites, e-commerce and security audits. From €500.",
  },
} as const;

function hreflangFor(path: string) {
  return { en: `/en${path}`, fr: `/fr${path}`, "x-default": `/fr${path}` };
}

// ---------------------------------------------------------------- Commune page
export async function communeMetadata(
  params: Promise<{ locale: string; dept: string; commune: string }>,
): Promise<Metadata> {
  const { locale, dept, commune } = await params;
  const loc = isLocale(locale) ? locale : "fr";
  const c = communeBy[`${dept}/${commune}`];
  if (!c) return {};
  const g = gram(c.deptSlug);
  const t = STR[loc];
  const path = `/agence-ia/${c.deptSlug}/${c.slug}`;
  return {
    title: t.metaCommuneT(c.nom, c.postcode, g),
    description: t.metaCommuneD(c.nom),
    alternates: { canonical: `/${loc}${path}`, languages: hreflangFor(path) },
    openGraph: { type: "website", siteName: "Digital M", locale: loc === "fr" ? "fr_FR" : "en_GB", title: t.metaCommuneT(c.nom, c.postcode, g), description: t.metaCommuneD(c.nom), url: `/${loc}${path}` },
  };
}

export function CommunePage({ locale, dept, commune }: { locale: Locale; dept: string; commune: string }) {
  const c = communeBy[`${dept}/${commune}`];
  if (!c) notFound();
  const g = gram(c.deptSlug);
  const t = STR[locale];
  const url = `${SITE_URL}/${locale}/agence-ia/${c.deptSlug}/${c.slug}`;
  const pop = c.population.toLocaleString(locale === "fr" ? "fr-FR" : "en-GB");
  const nearby = c.nearby.map((s) => communeBy[`${c.deptSlug}/${s}`]).filter(Boolean) as Commune[];
  const faq = t.faq(c.nom, g);

  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      localBusinessNode(),
      { "@type": "Service", name: `${t.agence} — ${c.nom}`, provider: { "@id": `${SITE_URL}/#fr-local` }, areaServed: { "@type": "Place", name: c.nom }, url },
      { "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: t.home, item: `${SITE_URL}/${locale}` },
          { "@type": "ListItem", position: 2, name: t.agence, item: `${SITE_URL}/${locale}/agence-ia` },
          { "@type": "ListItem", position: 3, name: g.name, item: `${SITE_URL}/${locale}/agence-ia/${c.deptSlug}` },
          { "@type": "ListItem", position: 4, name: c.nom, item: url },
        ],
      },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }} />

      <section className="container-x py-16 md:py-20">
        <nav className="font-mono text-xs text-fg-faint" aria-label="Breadcrumb">
          <Link href={`/${locale}/agence-ia`} className="hover:text-fg-heading">{t.agence}</Link>
          {" › "}
          <Link href={`/${locale}/agence-ia/${c.deptSlug}`} className="hover:text-fg-heading">{g.name}</Link>
          {" › "}
          <span className="text-fg-muted">{c.nom}</span>
        </nav>

        <div className="mt-6 max-w-3xl">
          <Eyebrow>{t.communeEyebrow(c.nom, c.postcode)}</Eyebrow>
          <h1 className="display-tight mt-6 text-display-l">{t.communeH1(c.nom, g)}</h1>
          <p className="mt-5 leading-relaxed text-fg-muted">{t.introA(c.nom, g)}</p>
          <p className="mt-4 leading-relaxed text-fg-muted">{t.introB(c.nom, pop)}</p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href={`/${locale}/book`} className="btn-primary px-5 py-3 text-sm">{t.book}</Link>
            <span className="inline-flex rounded-full border border-white/10 bg-surface-2 px-3 py-1.5 font-mono text-xs text-accent-soft">{t.price}</span>
          </div>
        </div>
        <KeyFigures locale={locale} />
      </section>

      <section className="container-x py-6">
        <ServiceGrid locale={locale} />
      </section>

      <section className="container-x py-8">
        <div className="mx-auto max-w-2xl">
          <BookingWidget locale={locale} copy={getContent(locale).booking} />
        </div>
      </section>

      {nearby.length > 0 ? (
        <section className="container-x py-6">
          <h2 className="eyebrow">{t.nearby(g)}</h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {nearby.map((n) => (
              <li key={n.slug}>
                <Link href={hrefFor(n, locale)} className="inline-flex rounded-full border border-white/10 px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-accent/40 hover:text-fg-heading">{n.nom}</Link>
              </li>
            ))}
            <li>
              <Link href={`/${locale}/agence-ia/${c.deptSlug}`} className="inline-flex rounded-full border border-accent/30 px-3 py-1.5 text-sm text-accent-soft transition-colors hover:bg-accent/10">{t.allTowns(g)}</Link>
            </li>
          </ul>
        </section>
      ) : null}

      <section className="cv-auto container-x py-10">
        <div className="max-w-3xl">
          <h2 className="text-display-m">{t.faqTitle(c.nom)}</h2>
          <div className="mt-6 divide-y divide-white/[0.07] border-y border-white/[0.07]">
            {faq.map((f, i) => (
              <details key={i} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-fg-heading [&::-webkit-details-marker]:hidden">
                  <span className="text-base font-medium">{f.q}</span>
                  <svg className="shrink-0 text-fg-faint transition-transform group-open:rotate-45" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                </summary>
                <p className="mt-3 max-w-prose text-sm leading-relaxed text-fg-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

// ------------------------------------------------------------------- Dept hub
export async function deptHubMetadata(
  params: Promise<{ locale: string; dept: string }>,
): Promise<Metadata> {
  const { locale, dept } = await params;
  const loc = isLocale(locale) ? locale : "fr";
  if (!DEPT_META[dept as "ariege" | "haute-garonne"]) return {};
  const g = gram(dept);
  const t = STR[loc];
  const path = `/agence-ia/${dept}`;
  return {
    title: t.metaHubT(g),
    description: t.metaHubD(g),
    alternates: { canonical: `/${loc}${path}`, languages: hreflangFor(path) },
    openGraph: { type: "website", siteName: "Digital M", locale: loc === "fr" ? "fr_FR" : "en_GB", title: t.metaHubT(g), url: `/${loc}${path}` },
  };
}

export function DeptHub({ locale, dept }: { locale: Locale; dept: string }) {
  if (!DEPT_META[dept as "ariege" | "haute-garonne"]) notFound();
  const g = gram(dept);
  const t = STR[locale];
  const list = communesByDept(dept);

  return (
    <section className="container-x py-16 md:py-20">
      <nav className="font-mono text-xs text-fg-faint" aria-label="Breadcrumb">
        <Link href={`/${locale}/agence-ia`} className="hover:text-fg-heading">{t.agence}</Link>
        {" › "}
        <span className="text-fg-muted">{g.name}</span>
      </nav>
      <div className="mt-6 max-w-3xl">
        <Eyebrow>{t.hubEyebrow(g)}</Eyebrow>
        <h1 className="display-tight mt-6 text-display-l">{t.hubH1(g)}</h1>
        <p className="mt-5 leading-relaxed text-fg-muted">{t.hubIntro(g)}</p>
        <div className="mt-7">
          <Link href={`/${locale}/book`} className="btn-primary px-5 py-3 text-sm">{t.book}</Link>
        </div>
      </div>

      <h2 className="eyebrow mt-12">{t.hubTowns(g)}</h2>
      <ul className="mt-4 flex flex-wrap gap-2">
        {list.map((c) => (
          <li key={c.slug}>
            <Link href={hrefFor(c, locale)} className="inline-flex rounded-full border border-white/10 px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-accent/40 hover:text-fg-heading">{c.nom}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// --------------------------------------------------------------------- Index
export async function indexMetadata(
  params: Promise<{ locale: string }>,
): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "fr";
  const t = STR[loc];
  const path = `/agence-ia`;
  return {
    title: t.metaIdxT,
    description: t.metaIdxD,
    alternates: { canonical: `/${loc}${path}`, languages: hreflangFor(path) },
    openGraph: { type: "website", siteName: "Digital M", locale: loc === "fr" ? "fr_FR" : "en_GB", title: t.metaIdxT, url: `/${loc}${path}` },
  };
}

export function AgenceIaIndex({ locale }: { locale: Locale }) {
  const t = STR[locale];
  const depts = ["ariege", "haute-garonne"] as const;
  return (
    <>
      <section className="container-x py-16 md:py-20">
        <div className="max-w-3xl">
          <Eyebrow>{t.idxEyebrow}</Eyebrow>
          <h1 className="display-tight mt-6 text-display-l">{t.idxH1}</h1>
          <p className="mt-5 leading-relaxed text-fg-muted">{t.idxIntro}</p>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {depts.map((ds) => {
            const d = DEPT_META[ds];
            return (
              <Link key={ds} href={`/${locale}/agence-ia/${ds}`} className="card card-hover p-7">
                <h2 className="text-xl text-fg-heading">{d.name} ({d.code})</h2>
                <p className="mt-2 text-sm text-fg-muted">{t.idxCard(communesByDept(ds).length)}</p>
                <span className="mt-4 inline-block font-mono text-xs text-accent-soft">{t.idxCardCta}</span>
              </Link>
            );
          })}
        </div>
      </section>
      <CtaBand locale={locale} title={t.ctaTitle} body={t.ctaBody} button={t.book} />
    </>
  );
}

// generateStaticParams helpers (both locales)
export const communeParams = communes
  .filter((c) => !c.richHref)
  .flatMap((c) => LOCALES.map((locale) => ({ locale, dept: c.deptSlug, commune: c.slug })));
export const deptParams = LOCALES.flatMap((locale) =>
  ["ariege", "haute-garonne"].map((dept) => ({ locale, dept })),
);
export const indexParams = LOCALES.map((locale) => ({ locale }));
