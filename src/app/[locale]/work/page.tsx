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
  return pageMetadata(loc, "work", "/work");
}

export default async function WorkPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const c = getContent(locale);

  return (
    <>
      <section className="container-x py-16 md:py-20">
        <div className="max-w-3xl">
          <Eyebrow>{c.work.hero.eyebrow}</Eyebrow>
          <h1 className="display-tight mt-6 text-display-l">{c.work.hero.title}</h1>
          <p className="mt-5 text-lg leading-relaxed text-fg-muted">
            {c.work.hero.sub}
          </p>
        </div>
      </section>

      <section className="container-x">
        <Eyebrow>{c.work.itemsLabel}</Eyebrow>
        <ul className="mt-6 divide-y divide-white/[0.07] border-y border-white/[0.07]">
          {c.work.items.map((item) => {
            const inner = (
              <>
                <div>
                  <h2 className="text-2xl text-fg-heading">{item.client}</h2>
                  {item.headline ? (
                    <p className="mt-1 gradient-text text-sm font-medium">
                      {item.headline}
                    </p>
                  ) : null}
                </div>
                <div>
                  <p className="font-mono text-xs text-accent-soft">{item.scope}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">
                    {item.detail}
                  </p>
                </div>
                <ul className="flex flex-wrap gap-2 md:justify-end">
                  {item.tags.map((tag) => (
                    <li
                      key={tag}
                      className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-xs text-fg-faint"
                    >
                      {tag}
                    </li>
                  ))}
                </ul>
              </>
            );
            return item.slug ? (
              <li key={item.client}>
                <Link
                  href={`/${locale}/work/${item.slug}`}
                  className="grid gap-3 rounded-lg px-3 py-6 transition-colors md:grid-cols-[1.1fr_1.3fr_auto] md:items-baseline md:gap-8 md:hover:bg-white/[0.02]"
                >
                  {inner}
                </Link>
              </li>
            ) : (
              <li
                key={item.client}
                className="grid gap-3 px-3 py-6 md:grid-cols-[1.1fr_1.3fr_auto] md:items-baseline md:gap-8"
              >
                {inner}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="container-x py-16 md:py-20">
        <h2 className="text-display-m">{c.work.capabilitiesHeading}</h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {c.work.capabilities.map((cap) => (
            <div key={cap.title} className="card card-hover reveal p-6">
              <h3 className="text-lg">{cap.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-muted">{cap.detail}</p>
            </div>
          ))}
        </div>
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
