import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getContent } from "@/content";
import { isLocale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";
import { Eyebrow, CtaBand } from "@/components/sections";

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

  return (
    <>
      <section className="container-x py-16 md:py-20">
        <div className="max-w-3xl">
          <Eyebrow>{p.hero.eyebrow}</Eyebrow>
          <h1 className="display-tight mt-6 text-display-l">{p.hero.title}</h1>
          <p className="mt-5 text-lg leading-relaxed text-fg-muted">{p.hero.sub}</p>
          <p className="mt-6 inline-flex rounded-full border border-white/10 bg-surface-2 px-4 py-1.5 font-mono text-xs text-accent-soft">
            {p.rateNote}
          </p>
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
              <p className="mt-2 gradient-text font-display text-2xl font-medium">
                {pkg.price}
              </p>
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
                href={`/${locale}/contact`}
                className="btn-ghost mt-6 inline-flex justify-center px-4 py-2.5 text-sm"
              >
                {p.cta}
              </Link>
            </article>
          ))}
        </div>

        <p className="mt-8 max-w-prose font-mono text-xs leading-relaxed text-fg-faint">
          {p.note}
        </p>
      </section>

      <CtaBand
        locale={locale}
        title={c.home.cta.title}
        body={c.home.cta.body}
        button={c.home.cta.button}
      />
    </>
  );
}
