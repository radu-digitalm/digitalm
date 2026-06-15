export const locales = ["en", "fr"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export function isLocale(value: string | undefined): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}

export const localeNames: Record<Locale, string> = {
  en: "English",
  fr: "Français",
};

/** The opposite locale, used for the language toggle. */
export function otherLocale(locale: Locale): Locale {
  return locale === "en" ? "fr" : "en";
}
