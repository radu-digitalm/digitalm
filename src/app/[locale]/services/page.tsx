import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getContent } from "@/content";
import { isLocale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";
import { Eyebrow, CtaBand, SmbBand, ProcessBand, Faq } from "@/components/sections";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  return pageMetadata(loc, "services", "/services");
}

export default async function ServicesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const c = getContent(locale);
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: c.faq.items.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: { "@type": "Answer", text: it.a },
    })),
  };
  const howToJsonLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: c.process.title,
    step: c.process.steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.title,
      text: s.detail,
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howToJsonLd) }}
      />
      <section className="container-x py-16 md:py-20">
        <div className="max-w-3xl">
          <Eyebrow>{c.services.hero.eyebrow}</Eyebrow>
          <h1 className="display-tight mt-6 text-display-l">{c.services.hero.title}</h1>
          <p className="mt-5 text-lg leading-relaxed text-fg-muted">
            {c.services.hero.sub}
          </p>
        </div>
      </section>

      <section className="container-x space-y-5 pb-8">
        {c.services.pillars.map((pillar) => (
          <article
            key={pillar.id}
            className={`card card-hover reveal grid gap-6 p-7 md:grid-cols-[0.9fr_1.1fr] md:p-9 ${
              pillar.lead ? "ring-1 ring-accent/40" : ""
            }`}
          >
            <div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-fg-faint">{pillar.kicker}</span>
                {pillar.lead && (
                  <span className="rounded-full bg-brand-gradient px-2.5 py-0.5 font-mono text-[11px] font-medium text-ink">
                    Lead offer
                  </span>
                )}
              </div>
              <h2 className="mt-4 text-2xl md:text-3xl">{pillar.title}</h2>
              <p className="mt-4 leading-relaxed text-fg-muted">{pillar.summary}</p>
              <p className="mt-5 font-mono text-xs leading-relaxed text-fg-faint">
                {pillar.proof}
              </p>
            </div>
            <ul className="space-y-3 md:border-l md:border-white/[0.07] md:pl-8">
              {pillar.points.map((point, i) => (
                <li key={i} className="flex gap-3 text-sm leading-relaxed text-fg">
                  <span
                    className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent"
                    aria-hidden="true"
                  />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <ProcessBand process={c.process} />

      <SmbBand locale={locale} smb={c.smb} />

      <Faq faq={c.faq} />

      <CtaBand
        locale={locale}
        title={c.services.cta.title}
        body={c.services.cta.body}
        button={c.services.cta.button}
      />
    </>
  );
}
