import type { MetadataRoute } from "next";
import { buildSitemapEntries } from "@/lib/sitemapData";

export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemapEntries();
}
