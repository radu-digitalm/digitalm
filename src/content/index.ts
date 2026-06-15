import type { Locale } from "@/lib/i18n";
import type { SiteContent } from "./types";
import { en } from "./en";
import { fr } from "./fr";

const dictionaries: Record<Locale, SiteContent> = { en, fr };

export function getContent(locale: Locale): SiteContent {
  return dictionaries[locale];
}

export type { SiteContent };
