import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getContent } from "@/content";
import { isLocale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";
import { Signature } from "@/components/Signature";
import { Eyebrow, PillarCard, CtaBand, SmbBand, Testimonials } from "@/components/sections";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  return pageMetadata(loc, "home", "");
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const c = getContent(locale);
  const { hero, grounding } = c.home;
  const proofLine = `15+ yrs · 100+ projects · ${c.home.clients.slice(0, 3).join(" · ")}`;

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute -right-40 -top-48 h-[42rem] w-[42rem] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(237,30,121,0.20), rgba(241,90,36,0.06) 55%, transparent 70%)",
          }}
          aria-hidden="true"
        />
        <div className="container-x relative grid gap-10 py-20 md:grid-cols-[1.45fr_0.55fr] md:items-center md:py-28">
          <div className="animate-fade-up">
            <Eyebrow>{hero.eyebrow}</Eyebrow>
            <h1 className="display-tight mt-6 text-display-xl">
              {hero.titleLines.map((line, i) => (
                <span key={i} className="block">
                  {line}
                </span>
              ))}
              <span className="gradient-text block">{hero.titleAccent}</span>
            </h1>
            <p className="mt-6 max-w-[46ch] text-xl leading-relaxed text-fg-muted">
              {hero.sub}
            </p>
            <p className="mt-6 font-mono text-xs text-fg-faint">{proofLine}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href={`/${locale}/contact`} className="btn-primary px-5 py-3 text-sm">
                {hero.ctaPrimary}
              </Link>
              <Link href={`/${locale}/work`} className="btn-ghost px-5 py-3 text-sm">
                {hero.ctaSecondary}
              </Link>
            </div>
          </div>
          <div className="hidden justify-center md:flex">
            <Signature className="w-[290px] lg:w-[330px]" />
          </div>
        </div>

        {/* Proof strip */}
        <div className="relative border-y border-white/[0.07] bg-surface/40">
          <div className="container-x flex flex-col gap-3 py-5 md:flex-row md:items-center md:gap-8">
            <span className="eyebrow shrink-0">{c.home.proofLabel}</span>
            <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-fg">
              {c.home.clients.map((client) => (
                <li key={client}>{client}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="cv-auto relative overflow-hidden">
        <div
          className="pointer-events-none absolute -right-40 -top-20 h-[600px] w-[600px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(237,30,121,0.08), rgba(241,90,36,0.04) 50%, transparent 70%)",
          }}
          aria-hidden="true"
        />
        <div className="container-x relative py-20 md:py-24">
          <div className="flex items-end justify-between gap-6">
            <div className="max-w-2xl">
              <Eyebrow>{c.home.pillarsHeading.eyebrow}</Eyebrow>
              <h2 className="mt-5 text-display-l">{c.home.pillarsHeading.title}</h2>
              <p className="mt-4 text-fg-muted">{c.home.pillarsHeading.intro}</p>
            </div>
            <span className="hidden shrink-0 font-mono text-xs text-fg-faint md:block">
              S.01 / what we do
            </span>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {c.home.pillars.map((pillar) => (
              <PillarCard key={pillar.id} pillar={pillar} />
            ))}
          </div>
        </div>
      </section>

      {/* Grounding */}
      <section className="cv-auto relative overflow-hidden border-t border-white/[0.07] bg-surface/30">
        <div
          className="pointer-events-none absolute -left-40 bottom-0 h-[600px] w-[600px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(241,90,36,0.07), rgba(237,30,121,0.04) 50%, transparent 70%)",
          }}
          aria-hidden="true"
        />
        <div className="container-x relative grid gap-12 py-20 md:grid-cols-2 md:py-24">
          <div>
            <Eyebrow>{grounding.eyebrow}</Eyebrow>
            <h2 className="mt-5 text-display-l">{grounding.title}</h2>
            <p className="mt-5 max-w-prose leading-relaxed text-fg-muted">
              {grounding.body}
            </p>
          </div>
          <div className="flex flex-col items-end gap-6 self-center">
            <Signature pulse={false} className="hidden h-24 w-auto md:block" />
            <div className="grid w-full grid-cols-2 gap-px overflow-hidden rounded-xl bg-line">
              {grounding.stats.map((stat, i) => (
                <div key={stat.label} className="bg-surface p-5">
                  <p
                    className={`font-display text-2xl font-medium tabular-nums md:text-3xl ${
                      i === 0 ? "gradient-text" : "text-fg-heading"
                    }`}
                  >
                    {stat.value}
                  </p>
                  <p className="mt-2 text-sm text-fg-muted">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <Testimonials heading={c.testimonialsHeading} items={c.testimonials} />

      {/* TPE/PME access tier */}
      <SmbBand locale={locale} smb={c.smb} />

      <CtaBand
        locale={locale}
        title={c.home.cta.title}
        body={c.home.cta.body}
        button={c.home.cta.button}
      />
    </>
  );
}
