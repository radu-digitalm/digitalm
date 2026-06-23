import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";
import { locales } from "@/lib/i18n";
import { getContent } from "@/content";
import { communes } from "@/content/communes";

const CASE_PATHS = getContent("en")
  .work.items.filter((i) => i.slug)
  .map((i) => `/work/${i.slug}`);

const PATHS = [
  "",
  "/services",
  "/work",
  "/contact",
  "/book",
  "/pme",
  "/agence-ia-ariege",
  "/agence-ia-foix",
  "/agence-ia-pamiers",
  "/agence-ia-saint-girons",
  "/agence-ia-lavelanet",
  "/creation-site-internet-ariege",
  "/audit-securite-site-ecommerce",
  "/agence-ia-toulouse",
  ...CASE_PATHS,
  "/legal/mentions-legales",
  "/legal/confidentialite",
];

const LAST_MODIFIED = "2026-06-16";

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];
  for (const path of PATHS) {
    for (const locale of locales) {
      entries.push({
        url: `${SITE_URL}/${locale}${path}`,
        lastModified: LAST_MODIFIED,
        changeFrequency: "monthly",
        priority: path === "" ? 1 : 0.7,
        alternates: {
          languages: {
            en: `${SITE_URL}/en${path}`,
            fr: `${SITE_URL}/fr${path}`,
          },
        },
      });
    }
  }

  // Local geo pages (agence-ia hierarchy) — bilingual with hreflang
  const geoPaths = [
    "/agence-ia",
    "/agence-ia/ariege",
    "/agence-ia/haute-garonne",
    ...communes.filter((c) => !c.richHref).map((c) => `/agence-ia/${c.deptSlug}/${c.slug}`),
  ];
  for (const path of geoPaths) {
    for (const locale of locales) {
      entries.push({
        url: `${SITE_URL}/${locale}${path}`,
        lastModified: LAST_MODIFIED,
        changeFrequency: "monthly",
        priority: 0.6,
        alternates: {
          languages: { en: `${SITE_URL}/en${path}`, fr: `${SITE_URL}/fr${path}` },
        },
      });
    }
  }

  return entries;
}
