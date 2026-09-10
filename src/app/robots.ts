import type { MetadataRoute } from "next";
import { SITE_URL, IS_STAGING } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  if (IS_STAGING) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    // /admin, /r (prospect reports) and /o (opt-out links) are private tool
    // routes — noindex headers cover them too (next.config.mjs).
    rules: { userAgent: "*", allow: "/", disallow: ["/anal1t1c5/", "/admin", "/r/", "/o/"] },
    sitemap: [`${SITE_URL}/sitemap.xml`, `${SITE_URL}/sitemap-main.xml`],
  };
}
