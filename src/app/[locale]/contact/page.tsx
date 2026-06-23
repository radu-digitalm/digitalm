import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getContent } from "@/content";
import { isLocale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";
import { Eyebrow } from "@/components/sections";
import { ContactForm } from "@/components/ContactForm";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  return pageMetadata(loc, "contact", "/contact");
}

export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const c = getContent(locale);
  const { hero, form } = c.contact;

  return (
    <section className="container-x py-16 md:py-20">
      <div className="grid gap-12 md:grid-cols-[0.85fr_1.15fr] md:gap-16">
        <div>
          <Eyebrow>{hero.eyebrow}</Eyebrow>
          <h1 className="display-tight mt-6 text-display-l">{hero.title}</h1>
          <p className="mt-5 text-lg leading-relaxed text-fg-muted">{hero.sub}</p>

          <div className="mt-10">
            <h2 className="eyebrow">{c.contact.directHeading}</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex gap-3">
                <dt className="w-20 shrink-0 text-fg-faint">{c.contact.emailLabel}</dt>
                <dd>
                  <a className="link-accent" href={`mailto:${c.contact.email}`}>
                    {c.contact.email}
                  </a>
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-20 shrink-0 text-fg-faint">{locale === "fr" ? "Téléphone" : "Phone"}</dt>
                <dd>
                  <a className="link-accent" href="tel:+33412120909">04 12 12 09 09</a>
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-20 shrink-0 text-fg-faint">{c.contact.whatsappLabel}</dt>
                <dd>
                  <a
                    className="link-accent"
                    href={c.contact.whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {c.contact.whatsappText}
                  </a>
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-20 shrink-0 text-fg-faint">{locale === "fr" ? "Avis" : "Reviews"}</dt>
                <dd>
                  <a
                    className="link-accent"
                    href="https://search.google.com/local/writereview?placeid=ChIJmUI3_37cJSER3JTMmPxBzYs"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {locale === "fr" ? "Laisser un avis Google" : "Leave a Google review"}
                  </a>
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="card p-6 md:p-8">
          <h2 className="text-xl">{form.heading}</h2>
          <div className="mt-6">
            <ContactForm text={form} locale={locale} email={c.contact.email} />
          </div>
        </div>
      </div>
    </section>
  );
}
