import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, locales } from "@/lib/i18n";
import { SITE_URL } from "@/lib/seo";
import { UI } from "@/content/diagnostic";
import { DiagnosticWizard } from "@/components/DiagnosticWizard";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const loc = isLocale(locale) ? locale : "en";
  const t = UI[loc];
  return {
    title: t.metaTitle,
    description: t.metaDesc,
    alternates: {
      canonical: `/${loc}/diagnostic`,
      languages: { en: `${SITE_URL}/en/diagnostic`, fr: `${SITE_URL}/fr/diagnostic` },
    },
  };
}

export default async function DiagnosticPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <section className="container-x py-16 md:py-20">
      <div className="mx-auto max-w-2xl">
        <DiagnosticWizard locale={locale} />
      </div>
    </section>
  );
}
