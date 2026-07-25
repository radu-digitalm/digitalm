// Fresh sitemap URL: /sitemap.xml has been stuck "pending / never downloaded"
// in Google's regular sitemap queue since launch (three submissions, zero
// errors). New paths get processed; stuck entries don't. Same content as
// /sitemap.xml, generated at build time.
import { buildSitemapEntries, sitemapXml } from "@/lib/sitemapData";

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(sitemapXml(buildSitemapEntries()), {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}
