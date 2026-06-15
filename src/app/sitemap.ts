import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";
import { locales } from "@/lib/i18n";
import { getContent } from "@/content";

const CASE_PATHS = getContent("en")
  .work.items.filter((i) => i.slug)
  .map((i) => `/work/${i.slug}`);

const PATHS = [
  "",
  "/services",
  "/work",
  "/contact",
  "/pme",
  ...CASE_PATHS,
  "/legal/mentions-legales",
  "/legal/confidentialite",
];

const LAST_MODIFIED = "2026-06-15";

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
  return entries;
}
