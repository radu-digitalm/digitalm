import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getContent } from "@/content";
import { isLocale } from "@/lib/i18n";
import { SITE_URL } from "@/lib/seo";
import { CtaBand } from "@/components/sections";

export function generateStaticParams() {
  return getContent("en")
    .work.items.filter((i) => i.slug)
    .map((i) => ({ slug: i.slug as string }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const loc = isLocale(locale) ? locale : "en";
  const item = getContent(loc).work.items.find((i) => i.slug === slug);
  if (!item) return {};
  const path = `/work/${slug}`;
  const title = `${item.headline ?? item.client} | Digital M`;
  const description = item.challenge ?? item.detail;
  return {
    title,
    description,
    alternates: {
      canonical: `/${loc}${path}`,
      languages: { en: `/en${path}`, fr: `/fr${path}`, "x-default": `/en${path}` },
    },
    openGraph: {
      type: "article",
      siteName: "Digital M",
      locale: loc === "fr" ? "fr_FR" : "en_GB",
      alternateLocale: loc === "fr" ? "en_GB" : "fr_FR",
      title,
      description,
      url: `/${loc}${path}`,
    },
  };
}

export default async function CaseStudyPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const c = getContent(locale);
  const item = c.work.items.find((i) => i.slug === slug);
  if (!item || !item.slug) notFound();
  const cs = c.caseStudy;
  const base = `/${locale}`;
  const url = `${SITE_URL}/${locale}/work/${slug}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: item.headline ?? item.client,
    about: item.client,
    inLanguage: locale,
    author: { "@type": "Organization", name: "Digital M", "@id": `${SITE_URL}/#org` },
    publisher: { "@id": `${SITE_URL}/#org` },
    mainEntityOfPage: url,
    ...(item.testimonial
      ? {
          review: {
            "@type": "Review",
            reviewBody: item.testimonial.quote,
            author: { "@type": "Person", name: item.testimonial.name },
          },
        }
      : {}),
  };
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Work", item: `${SITE_URL}/${locale}/work` },
      { "@type": "ListItem", position: 2, name: item.client, item: url },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />

      <section className="container-x py-16 md:py-20">
        <Link
          href={`${base}/work`}
          className="font-mono text-xs text-fg-faint transition-colors hover:text-fg-heading"
        >
          ← {cs.back}
        </Link>

        <div className="mt-6 max-w-3xl">
          <p className="eyebrow">
            {item.client} · {item.scope}
          </p>
          <h1 className="display-tight mt-4 text-display-l">
            {item.headline ?? item.client}
          </h1>
        </div>

        {item.results && item.results.length > 0 ? (
          <div
            className="mt-10 grid max-w-2xl gap-px overflow-hidden rounded-xl bg-line"
            style={{
              gridTemplateColumns: `repeat(${Math.min(item.results.length, 3)}, minmax(0, 1fr))`,
            }}
          >
            {item.results.map((r, i) => (
              <div key={i} className="bg-surface p-5">
                <p
                  className={`font-display text-2xl font-medium md:text-3xl ${
                    i === 0 ? "gradient-text" : "text-fg-heading"
                  }`}
                >
                  {r.value}
                </p>
                <p className="mt-2 text-sm text-fg-muted">{r.label}</p>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-12 grid max-w-3xl gap-10 md:grid-cols-2">
          {item.challenge ? (
            <div>
              <h2 className="eyebrow">{cs.challengeLabel}</h2>
              <p className="mt-3 leading-relaxed text-fg-muted">{item.challenge}</p>
            </div>
          ) : null}
          {item.approach ? (
            <div>
              <h2 className="eyebrow">{cs.approachLabel}</h2>
              <p className="mt-3 leading-relaxed text-fg-muted">{item.approach}</p>
            </div>
          ) : null}
        </div>

        {item.testimonial ? (
          <figure className="mt-10 max-w-3xl rounded-2xl border border-white/10 bg-surface p-6 md:p-8">
            <blockquote className="border-l-2 border-accent/50 pl-4 text-base leading-relaxed text-fg md:text-lg">
              {item.testimonial.quote}
            </blockquote>
            <figcaption className="mt-4 pl-4 font-mono text-xs text-fg-faint">
              {item.testimonial.name} · {item.testimonial.role}
            </figcaption>
          </figure>
        ) : null}

        <ul className="mt-10 flex flex-wrap gap-2">
          {item.tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-xs text-fg-faint"
            >
              {tag}
            </li>
          ))}
        </ul>
      </section>

      <CtaBand
        locale={locale}
        title={c.work.cta.title}
        body={c.work.cta.body}
        button={c.work.cta.button}
      />
    </>
  );
}
