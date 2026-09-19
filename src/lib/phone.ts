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
  // AE and SA do carry a national trunk 0 (Dubai "050 123 4567" is
  // +971 50 123 4567), so a visitor typing the local form is not rejected.
  { c: "AE", dial: "+971", flag: "🇦🇪", name: "UAE", min: 9, max: 9, trunk: true },
  { c: "SA", dial: "+966", flag: "🇸🇦", name: "Saudi Arabia", min: 9, max: 9, trunk: true },
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

// A couple of countries dial a trunk prefix longer than a single 0. Hungary
// dials "06 30 123 4567" at home for "+36 30 123 4567"; dropping only the
// first 0 would leave ten digits and reject a perfectly good number.
const LONG_TRUNK: Record<string, string> = { HU: "06" };

/**
 * Digits of a national number for `country`: drops a leading "+dial",
 * "00dial" or bare "dial" (the bare form only when what is left still fits
 * the country), then the trunk prefix where the country uses one.
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
  } else if (digits.startsWith(dial) && !fitsNational(digits, country)) {
    // No "+" and no "00": these digits only *look* like a dial code. Strip it
    // when what is left fits, and only when the whole string does not already
    // fit on its own — otherwise a German "04921 12345" typed without its
    // trunk 0 ("492112345") would lose the "49" that belongs to the number.
    const rest = digits.slice(dial.length);
    if (fitsNational(rest, country)) digits = rest;
  }

  if (country.trunk) {
    const long = LONG_TRUNK[country.c];
    if (long && digits.startsWith(long)) {
      const rest = digits.slice(long.length);
      digits = rest.length >= country.min && rest.length <= country.max ? rest : digits.slice(1);
    } else if (digits.startsWith("0")) {
      digits = digits.slice(1);
    }
  }
  return digits;
}

export type PhoneCheck =
  /**
   * `foreign` marks a number typed in full international form for a country
   * the picker does not carry: `national` then holds every digit after the
   * "+", and the picked dial code does not belong in front of it.
   */
  | { ok: true; national: string; e164: string; foreign: boolean }
  | { ok: false; reason: "empty" | "short" | "long" | "shape" };

/**
 * What `PhoneField` publishes to a parent that cannot read FormData (the
 * check-up wizard keeps its answers in React state). `raw` is the field as the
 * visitor left it, so a number the rules cannot accept is never silently lost.
 */
export type PhoneValue = {
  raw: string;
  /** National digits, trunk prefix gone. Empty unless `valid`. */
  national: string;
  /** The picked dial code, empty for a number that carries its own. */
  dial: string;
  /** International form. Empty unless `valid`. */
  e164: string;
  valid: boolean;
};

// North American numbering plan: neither the area code nor the exchange ever
// starts with 0 or 1. Without this, a French 10-digit number typed while the
// picker sits on Canada (a French expat in Quebec gets CA from the time zone)
// would pass the digit count and be filed as "+10630912844".
const NANP = new Set(["US", "CA"]);
const NANP_SHAPE = /^[2-9]\d{2}[2-9]\d{6}$/;

/**
 * A number typed in full international form for some other country. The
 * picker carries 32 countries; the rest of the world has to be able to reach
 * us too, so a "+…" (or "00…") number that is not this country's is taken as
 * typed rather than rejected. Anything else returns null and falls through to
 * the picked country's rules.
 */
function foreignNumber(typed: string, digits: string, country: Country): PhoneCheck | null {
  if (!/^\s*(\+|00)/.test(typed)) return null;
  const body = /^\s*\+/.test(typed) ? digits : digits.replace(/^00/, "");
  // A leading 0 after the "+" is never an E.164 country code: that is someone
  // typing "+" in front of their own domestic number, so let the country rules
  // (and their trunk 0) handle it.
  if (!body || body.startsWith("0")) return null;
  if (body.startsWith(digitsOf(country.dial))) return null;
  if (body.length < 7 || body.length > 15) return null;
  return { ok: true, national: body, e164: `+${body}`, foreign: true };
}

/** Validate a typed number against the picked country. */
export function validatePhone(raw: string, country: Country): PhoneCheck {
  const typed = String(raw ?? "");
  const digits = digitsOf(typed);
  if (!digits) return { ok: false, reason: "empty" };

  const foreign = foreignNumber(typed, digits, country);
  if (foreign) return foreign;

  const national = normalisePhone(typed, country);
  if (!national) return { ok: false, reason: "empty" };
  if (national.length < country.min) return { ok: false, reason: "short" };
  if (national.length > country.max) return { ok: false, reason: "long" };
  if (NANP.has(country.c) && !NANP_SHAPE.test(national)) {
    return { ok: false, reason: "shape" };
  }
  return { ok: true, national, e164: `${country.dial}${national}`, foreign: false };
}

// Dial codes longest first, so "+352" is matched before "+35…" or "+3…".
const BY_DIAL_LENGTH = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);

/** The country whose dial code opens these digits: "33630912844" → France. */
function countryForDigits(digits: string): Country | null {
  return BY_DIAL_LENGTH.find((c) => digits.startsWith(digitsOf(c.dial))) ?? null;
}

/**
 * Guard for a number as *posted* to a route handler: "+33 630912844", or
 * "+9725012345" for a country the picker does not carry. `PhoneField` already
 * normalises and blocks in the browser; this is the same check on the server,
 * for anything that arrives another way — a script, a page cached before this
 * fix, the diagnostic hand-off.
 *
 * Returns the E.164 form (so a page still posting "+33 0630912844" is
 * repaired, trunk 0 and all), or null when these digits cannot be a number for
 * the country their dial code claims: "+33 4187172114", the 17 Sep 2026 lead,
 * comes back null.
 */
export function checkPostedPhone(raw: unknown): string | null {
  const typed = String(raw ?? "").trim();
  // Everything the forms post carries its dial code. Without one there is no
  // country to check against, and no way to know what the digits mean.
  if (!/^\+/.test(typed)) return null;
  const digits = digitsOf(typed);
  if (digits.length < 7 || digits.length > 15) return null; // E.164 bounds
  const country = countryForDigits(digits);
  if (country) {
    const res = validatePhone(typed, country);
    return res.ok ? res.e164 : null;
  }
  // A country the picker does not carry: taken as typed, the way the field
  // does it, rather than turning away a lead from the rest of the world.
  return digits.startsWith("0") ? null : `+${digits}`;
}

// Characters a written phone number is made of. Anything else (a letter, an
// "@", a sentence) means the visitor typed something that is not a number, and
// nothing may be inferred from its digits.
const PHONE_CHARS = /^[+\d\s().\-/]+$/;

/**
 * The tolerant entry point, for a phone that arrives without the field's help:
 * a page cached before the check-up got `PhoneField`, a script, an integration.
 * Unlike `checkPostedPhone` it never returns null and never throws — the worst
 * case gives the value back exactly as typed.
 *
 * The order is evidence first, guesswork never:
 *  1. "+…" or "00…" already names a country: `checkPostedPhone` decides.
 *  2. A country or dial code the caller knows about is used as typed.
 *  3. Eleven digits opening on 1 can only be North American ("15817015976",
 *     the 18 Sep 2026 lead, becomes "+15817015976").
 *  4. Otherwise the raw value is kept. "4187172114" is a Quebec number in
 *     Quebec and a Paris number nowhere; filing it under a country we merely
 *     assumed is exactly how the last three leads became undialable, and a
 *     lead Radu cannot call is worse than a string he can read.
 */
export function repairPostedPhone(
  raw: unknown,
  hints: { country?: string | null; dial?: string | null } = {},
): string {
  const typed = String(raw ?? "").trim();
  if (!typed || !PHONE_CHARS.test(typed)) return typed;
  const digits = digitsOf(typed);
  if (!digits) return typed;

  // 1. Already international.
  if (/^\+/.test(typed) || digits.startsWith("00")) {
    const intl = /^\+/.test(typed) ? typed : `+${digits.replace(/^00/, "")}`;
    return checkPostedPhone(intl) ?? typed;
  }

  // 2. The country the caller knows about.
  const hinted = countryFor(hints.country) ?? countryForDial(hints.dial);
  if (hinted) {
    const res = validatePhone(typed, hinted);
    if (res.ok) return res.e164;
  }

  // 3. The North American domestic form: a trunk 1, then a valid NANP number.
  if (digits.length === 11 && digits.startsWith("1") && NANP_SHAPE.test(digits.slice(1))) {
    return `+${digits}`;
  }

  // 4. Nothing can be decided.
  return typed;
}

// Canadian area codes (NANP, 2026). Canada and the United States share "+1",
// so the dial code alone cannot tell them apart: without this every Quebec
// lead would be filed as American.
const CANADA_AREA_CODES = new Set([
  "204", "226", "236", "249", "250", "263", "289", "306", "343", "354", "365",
  "367", "368", "382", "387", "403", "416", "418", "428", "431", "437", "438",
  "450", "468", "474", "506", "514", "519", "548", "579", "581", "584", "587",
  "604", "613", "639", "647", "672", "683", "705", "709", "742", "753", "778",
  "780", "782", "807", "819", "825", "867", "873", "902", "905",
]);

/**
 * ISO2 country of a number already in international form, or null when the
 * dial code does not name one of the countries we carry. Callers use it to
 * stop filing a lead under the locale's country when the number says otherwise.
 */
export function countryFromE164(value: string | null | undefined): string | null {
  const typed = String(value ?? "").trim();
  if (!/^\+/.test(typed)) return null;
  const digits = digitsOf(typed);
  if (digits.length < 7 || digits.length > 15) return null;
  if (digits.startsWith("1")) {
    if (digits.length !== 11) return null;
    return CANADA_AREA_CODES.has(digits.slice(1, 4)) ? "CA" : "US";
  }
  return countryForDigits(digits)?.c ?? null;
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

// English needs "An American number", not "A American number". The article
// follows the opening sound, not the letter: "u-" and "eu-" adjectives open on
// a "y" sound ("a Ukrainian number", "a European number"), so they keep "a".
function enArticle(adj: string): "A" | "An" {
  if (/^(u|eu)/i.test(adj)) return "A";
  return /^[aeio]/i.test(adj) ? "An" : "A";
}

export type PhoneLang = "fr" | "en";

export type PhoneCopy = {
  empty: string;
  short: string;
  long: string;
  shape: string;
  /** Shown with any rejection: how to send a number from anywhere else. */
  intl: string;
  /** Shown once such a number is accepted, so the flag beside it makes sense. */
  foreignOk: string;
  /** Picker chrome, kept here so both languages stay together. */
  country: string;
  search: string;
  searchLabel: string;
  hint: (country: Country) => string;
};

export const PHONE_TEXT: Record<PhoneLang, PhoneCopy> = {
  fr: {
    empty: "Indiquez votre numéro de téléphone.",
    short: "Ce numéro est trop court.",
    long: "Ce numéro est trop long.",
    shape: "Ce numéro ne correspond pas à un numéro nord-américain.",
    intl: "Pour un autre pays, saisissez le numéro complet avec son indicatif international.",
    foreignOk: "Numéro international pris tel quel.",
    country: "Indicatif du pays",
    search: "Rechercher…",
    searchLabel: "Rechercher un pays",
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
    shape: "This does not look like a North American number.",
    intl: "For another country, type the full number with its international dialling code.",
    foreignOk: "International number, taken as typed.",
    country: "Country code",
    search: "Search…",
    searchLabel: "Search countries",
    hint: (country) => {
      const count =
        country.min === country.max
          ? `${country.min} digits`
          : `between ${country.min} and ${country.max} digits`;
      const adj = ADJ_EN[country.c];
      return adj
        ? `${enArticle(adj)} ${adj} number has ${count} after ${country.dial}.`
        : `A number for ${country.name} has ${count} after ${country.dial}.`;
    },
  },
};
