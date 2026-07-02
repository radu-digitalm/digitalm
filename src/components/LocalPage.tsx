import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getContent } from "@/content";
import type { Locale } from "@/lib/i18n";
import { isLocale } from "@/lib/i18n";
import { SITE_URL } from "@/lib/seo";
import { localPages } from "@/content/local";
import { FR_NAP, LOCAL_LINKS, SERVED } from "@/lib/localBusiness";
import { Eyebrow, CtaBand, Faq } from "./sections";
import { KeyFigures, ServiceGrid } from "./LocalSections";
import { BookingWidget } from "./BookingWidget";

const UI: Record<Locale, { book: string; price: string; zones: string; seePricing: string; home: string; faqTitle: string }> = {
  fr: { book: "Réserver un appel", price: "À partir de 500 €", zones: "Zones & services", seePricing: "Voir les tarifs", home: "Accueil", faqTitle: "Questions fréquentes" },
  en: { book: "Book a call", price: "From €500", zones: "Areas & services", seePricing: "See pricing", home: "Home", faqTitle: "Frequently asked" },
};

export async function localPageMetadata(
  params: Promise<{ locale: string }>,
  slug: string,
): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  const c = localPages[slug]?.[loc];
  if (!c) return {};
  const path = `/${slug}`;
  const canonical = `/${loc}${path}`;
  return {
    title: c.metaTitle,
    description: c.metaDescription,
    alternates: {
      canonical,
      languages: { en: `/en${path}`, fr: `/fr${path}`, "x-default": `/en${path}` },
    },
    openGraph: {
      type: "website",
      siteName: "Digital M",
      locale: loc === "fr" ? "fr_FR" : "en_GB",
      alternateLocale: loc === "fr" ? "en_GB" : "fr_FR",
      title: c.metaTitle,
      description: c.metaDescription,
      url: canonical,
    },
  };
}

export function LocalPage({ locale, slug }: { locale: Locale; slug: string }) {
  const page = localPages[slug];
  if (!page) notFound();
  const c = page[locale];
  const ui = UI[locale];
  const base = `/${locale}`;
  const url = `${SITE_URL}/${locale}/${slug}`;

  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Service", name: c.h1, provider: { "@id": `${SITE_URL}/#fr-local` }, areaServed: { "@type": "AdministrativeArea", name: "Ariège" }, url },
      { "@type": "FAQPage", mainEntity: c.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: ui.home, item: `${SITE_URL}/${locale}` },
          { "@type": "ListItem", position: 2, name: c.eyebrow, item: url },
        ],
      },
    ],
  };

  const others = LOCAL_LINKS.filter((l) => l.slug !== slug);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }} />

      {/* Hero — short intro + key figures */}
      <section className="container-x py-16 md:py-20">
        <div className="max-w-3xl">
          <Eyebrow>{c.eyebrow}</Eyebrow>
          <h1 className="display-tight mt-6 text-display-l">{c.h1}</h1>
          <p className="mt-5 text-lg leading-relaxed text-fg-muted">{c.sub}</p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href={`${base}/book`} className="btn-primary px-5 py-3 text-sm">{ui.book}</Link>
            <span className="inline-flex rounded-full border border-white/10 bg-surface-2 px-3 py-1.5 font-mono text-xs text-accent-soft">{ui.price}</span>
          </div>
          <p className="mt-5 font-mono text-xs leading-relaxed text-fg-faint">
            {FR_NAP.addressLocality} · {FR_NAP.addressRegion} ·{" "}
            <a className="link-accent" href={`mailto:${FR_NAP.email}`}>{FR_NAP.email}</a>
            {FR_NAP.telephone ? ` · ${FR_NAP.telephone}` : ""}
          </p>
        </div>
        <KeyFigures locale={locale} />
      </section>

      {/* Services */}
      <section className="container-x py-6">
        <ServiceGrid locale={locale} />
      </section>

      {/* Booking form */}
      <section className="container-x py-8">
        <div className="mx-auto max-w-2xl">
          <BookingWidget locale={locale} copy={getContent(locale).booking} />
        </div>
      </section>

      {/* The rest — why / context / pricing / FAQ */}
      <section className="cv-auto container-x py-10">
        <div className="max-w-3xl">
          <h2 className="text-display-m">{c.whyTitle}</h2>
          {c.whyBody.map((p, i) => (
            <p key={i} className="mt-4 leading-relaxed text-fg-muted">{p}</p>
          ))}
        </div>
      </section>

      <section className="cv-auto container-x py-10">
        <div className="max-w-3xl">
          <h2 className="text-display-m">{c.contextTitle}</h2>
          {c.contextBody.map((p, i) => (
            <p key={i} className="mt-4 leading-relaxed text-fg-muted">{p}</p>
          ))}
          <ul className="mt-6 space-y-2.5">
            {c.useCases.map((u, i) => (
              <li key={i} className="flex gap-3 text-sm text-fg">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                <span>{u}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="container-x py-4">
        <div className="max-w-3xl rounded-2xl border border-white/[0.07] bg-ink-soft p-6 md:p-8">
          <p className="leading-relaxed text-fg-muted">{c.tarifsNote}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href={`${base}/pme`} className="btn-ghost px-5 py-3 text-sm">{ui.seePricing}</Link>
            <Link href={`${base}/book`} className="btn-primary px-5 py-3 text-sm">{ui.book}</Link>
          </div>
        </div>
      </section>

      <Faq faq={{ eyebrow: "FAQ", title: ui.faqTitle, items: c.faq }} />

      <section className="container-x py-10">
        <h2 className="eyebrow">{ui.zones}</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {others.map((l) => (
            <li key={l.slug}>
              <Link
                href={`${base}/${l.slug}`}
                className="inline-flex rounded-full border border-white/10 px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-accent/40 hover:text-fg-heading"
              >
                {locale === "fr" ? l.fr : l.en}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-8 grid gap-5 sm:grid-cols-3">
          {SERVED.map((g) => (
            <div key={g.region}>
              <p className="font-mono text-xs uppercase tracking-wide text-fg-faint">{g.region}</p>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">{g.towns.join(" · ")}</p>
            </div>
          ))}
        </div>
      </section>

      <CtaBand locale={locale} title={c.ctaTitle} body={c.ctaBody} button={ui.book} />
    </>
  );
}
