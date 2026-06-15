import type { Metadata } from "next";
import type { Locale } from "./i18n";
import { getContent } from "@/content";

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://d3v.digitalm.eu"
).replace(/\/$/, "");

/** Staging must not be indexed. Production sets NEXT_PUBLIC_SITE_URL to the live domain. */
export const IS_STAGING =
  SITE_URL.includes("d3v.") || process.env.SITE_ENV === "staging";

type PageKey =
  | "home"
  | "services"
  | "work"
  | "contact"
  | "pme"
  | "legalNotice"
  | "privacy";

/** path is the route WITHOUT the locale prefix: "" for home, "/services", etc. */
export function pageMetadata(
  locale: Locale,
  page: PageKey,
  path: string,
): Metadata {
  const c = getContent(locale);
  const meta = c.meta[page];
  const enPath = `/en${path}`;
  const frPath = `/fr${path}`;
  const canonical = `/${locale}${path}`;

  return {
    title: meta.title,
    description: meta.description,
    alternates: {
      canonical,
      languages: { en: enPath, fr: frPath, "x-default": enPath },
    },
    openGraph: {
      type: "website",
      siteName: "Digital M",
      locale: locale === "fr" ? "fr_FR" : "en_GB",
      title: meta.title,
      description: meta.description,
      url: canonical,
      alternateLocale: locale === "fr" ? "en_GB" : "fr_FR",
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
    },
  };
}
