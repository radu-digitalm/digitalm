import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import "../globals.css";
import { fontVariables } from "@/lib/fonts";
import { locales, isLocale, type Locale } from "@/lib/i18n";
import { getContent } from "@/content";
import { SITE_URL, IS_STAGING } from "@/lib/seo";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { CookieConsent } from "@/components/CookieConsent";
import { ChatWidget } from "@/components/ChatWidget";
import { Reveal } from "@/components/Reveal";
import { localBusinessNode, FR_NAP_READY } from "@/lib/localBusiness";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  robots: IS_STAGING ? { index: false, follow: false } : undefined,
};

export const viewport: Viewport = {
  themeColor: "#0A0E16",
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const loc: Locale = locale;
  const skip = loc === "fr" ? "Aller au contenu" : "Skip to content";
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#org`,
        name: "Digital M",
        legalName: "Digital Management Ltd",
        url: SITE_URL,
        logo: `${SITE_URL}/brand/logo-white.png`,
        image: `${SITE_URL}/icon.png`,
        description: getContent(loc).meta.home.description,
        email: "contact@digitalm.eu",
        sameAs: [
          "https://www.linkedin.com/company/digitalm-eu",
          "https://www.crunchbase.com/organization/digital-m-b9e4",
          "https://find-and-update.company-information.service.gov.uk/company/09457882",
        ],
        areaServed: ["GB", "FR", "EU"],
        knowsAbout: [
          "AI adoption",
          "AI integration",
          "e-commerce engineering",
          "Salesforce Service Cloud",
          "Salesforce Marketing Cloud",
          "CRM delivery",
        ],
        address: {
          "@type": "PostalAddress",
          streetAddress: "67 Meridian Centre",
          addressLocality: "Havant",
          addressRegion: "Hampshire",
          postalCode: "PO9 1UN",
          addressCountry: "GB",
        },
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: "Digital M",
        inLanguage: ["en", "fr"],
        publisher: { "@id": `${SITE_URL}/#org` },
      },
      ...(FR_NAP_READY ? [localBusinessNode()] : []),
    ],
  };

  // Optional, env-configurable cookieless analytics (e.g. Plausible / Umami).
  // Cookieless → no consent gate needed. Set the env vars to enable; rebuild to apply.
  const analyticsSrc = process.env.NEXT_PUBLIC_ANALYTICS_SRC;
  const analyticsDomain = process.env.NEXT_PUBLIC_ANALYTICS_DOMAIN;
  const analyticsId = process.env.NEXT_PUBLIC_ANALYTICS_ID;

  return (
    <html lang={loc} className={fontVariables}>
      <body className="font-sans">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:text-fg-heading"
        >
          {skip}
        </a>
        <SiteHeader locale={loc} />
        <main id="main">{children}</main>
        <SiteFooter locale={loc} />
        <ChatWidget locale={loc} />
        <CookieConsent locale={loc} />
        <Reveal />
        {analyticsSrc ? (
          <script
            defer
            src={analyticsSrc}
            data-domain={analyticsDomain || undefined}
            data-website-id={analyticsId || undefined}
          />
        ) : null}
      </body>
    </html>
  );
}
