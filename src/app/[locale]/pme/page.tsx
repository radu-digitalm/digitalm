import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getContent } from "@/content";
import { isLocale } from "@/lib/i18n";
import { pageMetadata, SITE_URL } from "@/lib/seo";
import { Eyebrow, CtaBand, Faq } from "@/components/sections";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  return pageMetadata(loc, "pme", "/pme");
}

export default async function PmePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const c = getContent(locale);
  const p = c.pricing;

  const offerLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: p.hero.title,
    provider: { "@id": `${SITE_URL}/#org` },
    areaServed: "FR",
    url: `${SITE_URL}/${locale}/pme`,
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: p.hero.eyebrow,
      itemListElement: [
        ...[...p.packages, p.audit].map((pkg) => ({
          "@type": "Offer",
          name: pkg.name,
          description: pkg.outcome,
          priceCurrency: "EUR",
          price: (pkg.price.match(/[\d\s.,]+/)?.[0] ?? "").replace(/[\s.,]/g, ""),
        })),
        // Monthly care plans — recurring price, hence UnitPriceSpecification.
        ...p.care.tiers.map((tier) => ({
          "@type": "Offer",
          name: tier.name,
          description: tier.outcome,
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: (tier.price.match(/\d+/)?.[0] ?? ""),
            priceCurrency: "EUR",
            unitCode: "MON",
          },
        })),
      ],
    },
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: c.faq.items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(offerLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />

      <section className="container-x py-16 md:py-20">
        <div className="max-w-3xl">
          <Eyebrow>{p.hero.eyebrow}</Eyebrow>
          <h1 className="display-tight mt-6 text-display-l">{p.hero.title}</h1>
          <p className="mt-5 text-lg leading-relaxed text-fg-muted">{p.hero.sub}</p>
          <p className="mt-6 inline-flex rounded-full border border-white/10 bg-surface-2 px-4 py-1.5 font-mono text-xs text-accent-soft">
            {p.rateNote}
          </p>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-fg-muted">{p.guarantee}</p>
        </div>

        {/* Free, low-risk entry offer */}
        <div className="gradient-border reveal mt-10 flex flex-col gap-5 rounded-2xl p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div className="max-w-2xl">
            <Eyebrow>{p.diagnostic.eyebrow}</Eyebrow>
            <h2 className="mt-3 text-display-m">{p.diagnostic.title}</h2>
            <p className="mt-3 leading-relaxed text-fg-muted">{p.diagnostic.body}</p>
          </div>
          <Link
            href={`/${locale}/diagnostic`}
            className="btn-primary inline-flex shrink-0 justify-center px-5 py-3 text-sm"
          >
            {p.diagnostic.cta}
          </Link>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {p.packages.map((pkg) => (
            <article
              key={pkg.name}
              className={`card card-hover reveal relative flex flex-col p-6 ${
                pkg.lead ? "gradient-border" : ""
              }`}
            >
              {pkg.lead ? (
                <span className="absolute right-5 top-5 rounded-full bg-brand-gradient px-2.5 py-0.5 font-mono text-[11px] font-medium text-ink">
                  {p.recommendedBadge}
                </span>
              ) : null}
              <h2 className="text-lg text-fg-heading">{pkg.name}</h2>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                {pkg.originalPrice ? (
                  <span className="font-display text-base text-fg-faint line-through">
                    {pkg.originalPrice}
                  </span>
                ) : null}
                <span className="gradient-text font-display text-2xl font-medium">
                  {pkg.price}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="font-mono text-xs text-fg-faint">{pkg.timeline}</span>
                <span className="rounded border border-accent/30 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent-soft">
                  {p.discountTag}
                </span>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-fg-muted">{pkg.outcome}</p>
              <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                {pkg.includes.map((inc, i) => (
                  <li key={i} className="flex gap-3 text-fg">
                    <span
                      className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent"
                      aria-hidden="true"
                    />
                    <span>{inc}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={`/${locale}/book`}
                className="btn-primary mt-6 inline-flex justify-center px-4 py-2.5 text-sm"
              >
                {pkg.cta ?? p.cta}
              </Link>
              <p className="mt-2 text-center font-mono text-[11px] text-fg-faint">
                {p.cardReassurance}
              </p>
            </article>
          ))}
        </div>

        {/* Security audit — slim horizontal card (out of the build grid) */}
        <div className="card card-hover reveal mt-5 flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-lg text-fg-heading">{p.audit.name}</h2>
              {p.audit.originalPrice ? (
                <span className="font-display text-sm text-fg-faint line-through">{p.audit.originalPrice}</span>
              ) : null}
              <span className="gradient-text font-display text-xl font-medium">{p.audit.price}</span>
              <span className="font-mono text-xs text-fg-faint">{p.audit.timeline}</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">{p.audit.outcome}</p>
          </div>
          <Link href={`/${locale}/book`} className="btn-primary inline-flex shrink-0 justify-center px-5 py-3 text-sm">
            {p.audit.cta ?? p.cta}
          </Link>
        </div>

        {/* Monthly care plans — "Tranquillité" */}
        <div className="gradient-border reveal mt-12 rounded-2xl p-6 md:p-8">
          <Eyebrow>{p.care.eyebrow}</Eyebrow>
          <h2 className="mt-3 text-display-m">{p.care.title}</h2>
          <p className="mt-3 max-w-3xl leading-relaxed text-fg-muted">{p.care.body}</p>
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {p.care.tiers.map((tier) => (
              <article key={tier.name} className={`card card-hover relative flex flex-col p-6 ${tier.lead ? "gradient-border" : ""}`}>
                {tier.lead ? (
                  <span className="absolute right-5 top-5 rounded-full bg-brand-gradient px-2.5 py-0.5 font-mono text-[11px] font-medium text-ink">
                    {p.recommendedBadge}
                  </span>
                ) : null}
                <h3 className="text-lg text-fg-heading">{tier.name}</h3>
                <div className="mt-2">
                  <span className="gradient-text font-display text-2xl font-medium">{tier.price}</span>
                </div>
                <p className="mt-1.5 font-mono text-xs text-fg-faint">{tier.timeline}</p>
                <p className="mt-4 text-sm leading-relaxed text-fg-muted">{tier.outcome}</p>
                <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                  {tier.includes.map((inc, i) => (
                    <li key={i} className="flex gap-3 text-fg">
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                      <span>{inc}</span>
                    </li>
                  ))}
                </ul>
                <Link href={`/${locale}/book`} className="btn-primary mt-6 inline-flex justify-center px-4 py-2.5 text-sm">
                  {tier.cta ?? p.cta}
                </Link>
                <p className="mt-2 text-center font-mono text-[11px] text-fg-faint">{p.care.mechanics}</p>
              </article>
            ))}
          </div>
          <p className="mt-6 text-sm leading-relaxed text-fg-muted">{p.care.overageRule}</p>
          <p className="mt-2 text-sm font-medium text-fg-heading">{p.care.honesty}</p>
        </div>

        <p className="mt-8 max-w-prose font-mono text-xs leading-relaxed text-fg-faint">
          {p.note}
        </p>
      </section>

      <Faq faq={c.faq} />

      <CtaBand
        locale={locale}
        title={c.home.cta.title}
        body={c.home.cta.body}
        button={c.home.cta.button}
      />
    </>
  );
}
