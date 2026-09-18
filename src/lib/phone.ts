// Phone country list, national-number rules, normalisation and validation.
//
// Pure module: no React, no Node-only import — `PhoneField` (a client
// component) imports it, and so can a route handler.
//
// `min`/`max` are the digit counts of a *national* number once the trunk
// prefix is gone (a French mobile is 9 digits after +33). `trunk` marks the
// countries whose national form carries a leading 0 that is dropped in the
// international form. Italy is deliberately `false`: Italian landlines keep
// their leading 0.

export type Country = {
  c: string;
  dial: string;
  flag: string;
  name: string;
  min: number;
  max: number;
  trunk: boolean;
};

export const COUNTRIES: Country[] = [
  { c: "FR", dial: "+33", flag: "🇫🇷", name: "France", min: 9, max: 9, trunk: true },
  { c: "GB", dial: "+44", flag: "🇬🇧", name: "United Kingdom", min: 9, max: 10, trunk: true },
  { c: "US", dial: "+1", flag: "🇺🇸", name: "United States", min: 10, max: 10, trunk: false },
  { c: "CA", dial: "+1", flag: "🇨🇦", name: "Canada", min: 10, max: 10, trunk: false },
  { c: "IE", dial: "+353", flag: "🇮🇪", name: "Ireland", min: 7, max: 9, trunk: true },
  { c: "BE", dial: "+32", flag: "🇧🇪", name: "Belgium", min: 8, max: 9, trunk: true },
  { c: "CH", dial: "+41", flag: "🇨🇭", name: "Switzerland", min: 9, max: 9, trunk: true },
  { c: "LU", dial: "+352", flag: "🇱🇺", name: "Luxembourg", min: 4, max: 11, trunk: true },
  { c: "DE", dial: "+49", flag: "🇩🇪", name: "Germany", min: 6, max: 11, trunk: true },
  { c: "ES", dial: "+34", flag: "🇪🇸", name: "Spain", min: 9, max: 9, trunk: true },
  { c: "IT", dial: "+39", flag: "🇮🇹", name: "Italy", min: 6, max: 11, trunk: false },
  { c: "NL", dial: "+31", flag: "🇳🇱", name: "Netherlands", min: 9, max: 9, trunk: true },
  { c: "PT", dial: "+351", flag: "🇵🇹", name: "Portugal", min: 9, max: 9, trunk: true },
  { c: "AT", dial: "+43", flag: "🇦🇹", name: "Austria", min: 4, max: 13, trunk: true },
  { c: "DK", dial: "+45", flag: "🇩🇰", name: "Denmark", min: 8, max: 8, trunk: false },
  { c: "SE", dial: "+46", flag: "🇸🇪", name: "Sweden", min: 7, max: 9, trunk: true },
  { c: "NO", dial: "+47", flag: "🇳🇴", name: "Norway", min: 8, max: 8, trunk: false },
  { c: "FI", dial: "+358", flag: "🇫🇮", name: "Finland", min: 5, max: 12, trunk: true },
  { c: "PL", dial: "+48", flag: "🇵🇱", name: "Poland", min: 9, max: 9, trunk: true },
  { c: "CZ", dial: "+420", flag: "🇨🇿", name: "Czechia", min: 9, max: 9, trunk: true },
  { c: "RO", dial: "+40", flag: "🇷🇴", name: "Romania", min: 9, max: 9, trunk: true },
  { c: "GR", dial: "+30", flag: "🇬🇷", name: "Greece", min: 10, max: 10, trunk: true },
  { c: "HU", dial: "+36", flag: "🇭🇺", name: "Hungary", min: 8, max: 9, trunk: true },
  { c: "AU", dial: "+61", flag: "🇦🇺", name: "Australia", min: 9, max: 9, trunk: true },
  { c: "NZ", dial: "+64", flag: "🇳🇿", name: "New Zealand", min: 8, max: 10, trunk: true },
  { c: "AE", dial: "+971", flag: "🇦🇪", name: "UAE", min: 9, max: 9, trunk: false },
  { c: "SA", dial: "+966", flag: "🇸🇦", name: "Saudi Arabia", min: 9, max: 9, trunk: false },
  { c: "MA", dial: "+212", flag: "🇲🇦", name: "Morocco", min: 9, max: 9, trunk: true },
  { c: "TN", dial: "+216", flag: "🇹🇳", name: "Tunisia", min: 8, max: 8, trunk: true },
  { c: "DZ", dial: "+213", flag: "🇩🇿", name: "Algeria", min: 9, max: 9, trunk: true },
  { c: "ZA", dial: "+27", flag: "🇿🇦", name: "South Africa", min: 9, max: 9, trunk: true },
  { c: "SG", dial: "+65", flag: "🇸🇬", name: "Singapore", min: 8, max: 8, trunk: false },
];

/** The entry for an ISO2 code, or null. */
export function countryFor(code: string | null | undefined): Country | null {
  if (!code) return null;
  const up = code.trim().toUpperCase();
  return COUNTRIES.find((c) => c.c === up) ?? null;
}

/** The first entry carrying this dial code (US before CA for "+1"), or null. */
export function countryForDial(dial: string | null | undefined): Country | null {
  if (!dial) return null;
  const d = dial.trim();
  return COUNTRIES.find((c) => c.dial === d) ?? null;
}

const FALLBACK = countryFor("FR")!;

function digitsOf(raw: string): string {
  return raw.replace(/\D+/g, "");
}

function fitsNational(digits: string, country: Country): boolean {
  const n = country.trunk && digits.startsWith("0") ? digits.length - 1 : digits.length;
  return n >= country.min && n <= country.max;
}

/**
 * Digits of a national number for `country`: drops a leading "+dial",
 * "00dial" or bare "dial" (the bare form only when what is left still fits
 * the country), then one trunk 0 where the country uses one.
 */
export function normalisePhone(raw: string, country: Country): string {
  if (!raw) return "";
  const plus = /^\s*\+/.test(raw);
  let digits = digitsOf(raw);
  if (!digits) return "";

  const dial = country.dial.replace(/\D+/g, "");
  if (plus && digits.startsWith(dial)) {
    digits = digits.slice(dial.length);
  } else if (digits.startsWith("00" + dial)) {
    digits = digits.slice(2 + dial.length);
  } else if (digits.startsWith(dial)) {
    const rest = digits.slice(dial.length);
    if (fitsNational(rest, country)) digits = rest;
  }

  if (country.trunk && digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

export type PhoneCheck =
  | { ok: true; national: string; e164: string }
  | { ok: false; reason: "empty" | "short" | "long" };

/** Validate a typed number against the picked country. */
export function validatePhone(raw: string, country: Country): PhoneCheck {
  const national = normalisePhone(raw ?? "", country);
  if (!national) return { ok: false, reason: "empty" };
  if (national.length < country.min) return { ok: false, reason: "short" };
  if (national.length > country.max) return { ok: false, reason: "long" };
  return { ok: true, national, e164: `${country.dial}${national}` };
}

// ---------------------------------------------------------------------------
// Where is this visitor? The browser already knows its time zone and its
// languages: no IP lookup, no third-party processor, nothing extra stored.
// ---------------------------------------------------------------------------

const ZONES: Record<string, string> = {
  // Canada
  "america/toronto": "CA",
  "america/montreal": "CA",
  "america/winnipeg": "CA",
  "america/edmonton": "CA",
  "america/vancouver": "CA",
  "america/halifax": "CA",
  "america/st_johns": "CA",
  "america/moncton": "CA",
  "america/regina": "CA",
  "america/swift_current": "CA",
  "america/glace_bay": "CA",
  "america/goose_bay": "CA",
  "america/blanc-sablon": "CA",
  "america/thunder_bay": "CA",
  "america/nipigon": "CA",
  "america/rainy_river": "CA",
  "america/atikokan": "CA",
  "america/iqaluit": "CA",
  "america/pangnirtung": "CA",
  "america/rankin_inlet": "CA",
  "america/resolute": "CA",
  "america/cambridge_bay": "CA",
  "america/inuvik": "CA",
  "america/yellowknife": "CA",
  "america/whitehorse": "CA",
  "america/dawson": "CA",
  "america/dawson_creek": "CA",
  "america/fort_nelson": "CA",
  "america/creston": "CA",
  // United States
  "america/new_york": "US",
  "america/chicago": "US",
  "america/denver": "US",
  "america/phoenix": "US",
  "america/los_angeles": "US",
  "america/anchorage": "US",
  "america/juneau": "US",
  "america/sitka": "US",
  "america/nome": "US",
  "america/yakutat": "US",
  "america/metlakatla": "US",
  "america/adak": "US",
  "america/boise": "US",
  "america/detroit": "US",
  "america/menominee": "US",
  "america/indiana/indianapolis": "US",
  "america/indiana/vincennes": "US",
  "america/indiana/knox": "US",
  "america/indiana/winamac": "US",
  "america/indiana/marengo": "US",
  "america/indiana/petersburg": "US",
  "america/indiana/tell_city": "US",
  "america/indiana/vevay": "US",
  "america/kentucky/louisville": "US",
  "america/kentucky/monticello": "US",
  "america/north_dakota/center": "US",
  "america/north_dakota/new_salem": "US",
  "america/north_dakota/beulah": "US",
  "pacific/honolulu": "US",
  // Europe
  "europe/paris": "FR",
  "europe/london": "GB",
  "europe/belfast": "GB",
  "europe/guernsey": "GB",
  "europe/jersey": "GB",
  "europe/isle_of_man": "GB",
  "europe/dublin": "IE",
  "europe/brussels": "BE",
  "europe/zurich": "CH",
  "europe/luxembourg": "LU",
  "europe/berlin": "DE",
  "europe/busingen": "DE",
  "europe/madrid": "ES",
  "africa/ceuta": "ES",
  "atlantic/canary": "ES",
  "europe/rome": "IT",
  "europe/amsterdam": "NL",
  "europe/lisbon": "PT",
  "atlantic/madeira": "PT",
  "atlantic/azores": "PT",
  "europe/vienna": "AT",
  "europe/copenhagen": "DK",
  "europe/stockholm": "SE",
  "europe/oslo": "NO",
  "europe/helsinki": "FI",
  "europe/warsaw": "PL",
  "europe/prague": "CZ",
  "europe/bucharest": "RO",
  "europe/athens": "GR",
  "europe/budapest": "HU",
  // Rest of the list
  "pacific/auckland": "NZ",
  "pacific/chatham": "NZ",
  "asia/dubai": "AE",
  "asia/riyadh": "SA",
  "africa/casablanca": "MA",
  "africa/el_aaiun": "MA",
  "africa/tunis": "TN",
  "africa/algiers": "DZ",
  "africa/johannesburg": "ZA",
  "asia/singapore": "SG",
};

const ZONE_PREFIXES: [string, string][] = [
  ["australia/", "AU"],
  ["antarctica/macquarie", "AU"],
  ["us/", "US"],
  ["canada/", "CA"],
];

/** IANA time zone → ISO2, for the countries in COUNTRIES. Unknown → null. */
export function countryFromTimeZone(tz: string | null | undefined): string | null {
  if (!tz) return null;
  const key = tz.trim().toLowerCase();
  if (!key) return null;
  const hit = ZONES[key];
  if (hit) return hit;
  for (const [prefix, code] of ZONE_PREFIXES) {
    if (key.startsWith(prefix)) return code;
  }
  return null;
}

/** First BCP-47 tag carrying a region we know: "fr-CA" → CA. Unknown → null. */
export function countryFromLanguages(
  tags: readonly string[] | null | undefined,
): string | null {
  if (!tags) return null;
  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    for (const part of tag.split(/[-_]/).slice(1)) {
      if (!/^[A-Za-z]{2}$/.test(part)) continue;
      const found = countryFor(part);
      if (found) return found.c;
    }
  }
  return null;
}

/**
 * Best guess at the visitor's country: time zone first (it is the strongest
 * signal and costs nothing), then the browser languages, then the dial code
 * the page was rendered with, then France.
 */
export function guessCountry(hints: {
  timeZone?: string | null;
  languages?: readonly string[] | null;
  fallbackDial?: string | null;
}): Country {
  return (
    countryFor(countryFromTimeZone(hints.timeZone)) ??
    countryFor(countryFromLanguages(hints.languages)) ??
    countryForDial(hints.fallbackDial) ??
    FALLBACK
  );
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

// Adjectives, so the hint reads like a sentence ("Un numéro canadien…"),
// which "Un numéro Canada…" would not.
const ADJ_FR: Record<string, string> = {
  FR: "français", GB: "britannique", US: "américain", CA: "canadien",
  IE: "irlandais", BE: "belge", CH: "suisse", LU: "luxembourgeois",
  DE: "allemand", ES: "espagnol", IT: "italien", NL: "néerlandais",
  PT: "portugais", AT: "autrichien", DK: "danois", SE: "suédois",
  NO: "norvégien", FI: "finlandais", PL: "polonais", CZ: "tchèque",
  RO: "roumain", GR: "grec", HU: "hongrois", AU: "australien",
  NZ: "néo-zélandais", AE: "émirien", SA: "saoudien", MA: "marocain",
  TN: "tunisien", DZ: "algérien", ZA: "sud-africain", SG: "singapourien",
};

const ADJ_EN: Record<string, string> = {
  FR: "French", GB: "British", US: "American", CA: "Canadian",
  IE: "Irish", BE: "Belgian", CH: "Swiss", LU: "Luxembourgish",
  DE: "German", ES: "Spanish", IT: "Italian", NL: "Dutch",
  PT: "Portuguese", AT: "Austrian", DK: "Danish", SE: "Swedish",
  NO: "Norwegian", FI: "Finnish", PL: "Polish", CZ: "Czech",
  RO: "Romanian", GR: "Greek", HU: "Hungarian", AU: "Australian",
  NZ: "New Zealand", AE: "Emirati", SA: "Saudi", MA: "Moroccan",
  TN: "Tunisian", DZ: "Algerian", ZA: "South African", SG: "Singaporean",
};

export type PhoneLang = "fr" | "en";

export type PhoneCopy = {
  empty: string;
  short: string;
  long: string;
  hint: (country: Country) => string;
};

export const PHONE_TEXT: Record<PhoneLang, PhoneCopy> = {
  fr: {
    empty: "Indiquez votre numéro de téléphone.",
    short: "Ce numéro est trop court.",
    long: "Ce numéro est trop long.",
    hint: (country) => {
      const count =
        country.min === country.max
          ? `${country.min} chiffres`
          : `entre ${country.min} et ${country.max} chiffres`;
      const adj = ADJ_FR[country.c];
      return adj
        ? `Un numéro ${adj} a ${count} après ${country.dial}.`
        : `Un numéro pour ${country.name} a ${count} après ${country.dial}.`;
    },
  },
  en: {
    empty: "Enter your phone number.",
    short: "This number is too short.",
    long: "This number is too long.",
    hint: (country) => {
      const count =
        country.min === country.max
          ? `${country.min} digits`
          : `between ${country.min} and ${country.max} digits`;
      const adj = ADJ_EN[country.c];
      return adj
        ? `A ${adj} number has ${count} after ${country.dial}.`
        : `A number for ${country.name} has ${count} after ${country.dial}.`;
    },
  },
};
