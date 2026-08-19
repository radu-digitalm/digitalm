// Shared sitemap builder — used by both app/sitemap.ts (the canonical
// /sitemap.xml) and app/sitemap-main.xml (a fresh URL submitted to GSC because
// Google's regular sitemap queue never processed /sitemap.xml since launch;
// stuck queue entries stay stuck, new paths get picked up).
//
// lastModified must be TRUTHFUL or Google learns to ignore it. These are the
// dates of the last real content change per section — update them when a
// section's content (not styling) changes.
import { SITE_URL } from "@/lib/seo";
import { locales } from "@/lib/i18n";
import { getContent } from "@/content";

const DATES = {
  home: "2026-07-12", // ROI calculator copy
  pme: "2026-07-04", // pricing ladder + care plans
  diagnostic: "2026-07-12", // wizard copy
  core: "2026-07-03", // services/work/contact/book (FR testimonials pass)
  geo: "2026-07-03", // all-towns links
  legal: "2026-07-10", // privacy retention section
} as const;

function dateFor(path: string): string {
  if (path === "") return DATES.home;
  if (path === "/pme") return DATES.pme;
  if (path === "/diagnostic") return DATES.diagnostic;
  if (path.startsWith("/legal")) return DATES.legal;
  if (path.startsWith("/agence-ia") || path.startsWith("/creation-site") || path.startsWith("/audit-securite")) return DATES.geo;
  return DATES.core;
}

export type SitemapEntry = {
  url: string;
  lastModified: string;
  changeFrequency: "monthly";
  priority: number;
  alternates: { languages: { en: string; fr: string } };
};

export function buildSitemapEntries(): SitemapEntry[] {
  const casePaths = getContent("en")
    .work.items.filter((i) => i.slug)
    .map((i) => `/work/${i.slug}`);

  const paths = [
    "",
    "/services",
    "/work",
    "/contact",
    "/book",
    "/diagnostic",
    "/pme",
    "/agence-ia-ariege",
    "/agence-ia-foix",
    "/agence-ia-pamiers",
    "/agence-ia-saint-girons",
    "/agence-ia-lavelanet",
    "/creation-site-internet-ariege",
    "/audit-securite-site-ecommerce",
    "/agence-ia-toulouse",
    ...casePaths,
    "/legal/mentions-legales",
    "/legal/confidentialite",
  ];

  const geoPaths = [
    "/agence-ia",
    "/agence-ia/ariege",
    "/agence-ia/haute-garonne",
    // Individual commune pages are deliberately noindex (near-duplicate
    // templated content — see GeoPages.communeMetadata), so they must not be
    // advertised in the sitemap. The dept hubs above still link to them.
  ];

  const entries: SitemapEntry[] = [];
  const push = (path: string, priority: number) => {
    for (const locale of locales) {
      entries.push({
        url: `${SITE_URL}/${locale}${path}`,
        lastModified: dateFor(path),
        changeFrequency: "monthly",
        priority,
        alternates: {
          languages: { en: `${SITE_URL}/en${path}`, fr: `${SITE_URL}/fr${path}` },
        },
      });
    }
  };
  for (const p of paths) push(p, p === "" ? 1 : 0.7);
  for (const p of geoPaths) push(p, 0.6);
  return entries;
}

/** Serialize to sitemap XML with xhtml:link hreflang alternates. */
export function sitemapXml(entries: SitemapEntry[]): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const urls = entries
    .map((e) => {
      const alts = Object.entries(e.alternates.languages)
        .map(([lang, href]) => `<xhtml:link rel="alternate" hreflang="${lang}" href="${esc(href)}"/>`)
        .join("");
      return `<url><loc>${esc(e.url)}</loc>${alts}<lastmod>${e.lastModified}</lastmod><changefreq>${e.changeFrequency}</changefreq><priority>${e.priority}</priority></url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>`;
}
