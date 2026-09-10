// Per-country SendRule table (contract §3 "Rule table", §9). FR under the
// CNIL's B2B rules, GB under PECR's corporate-subscriber rules, US under
// CAN-SPAM; every other country ("*", Canada included) gets no in-app email
// and "manual" calls. The env (OUTREACH_COUNTRY_ALLOW) can only restrict this
// table, never extend it. Pure — no DB, no next/*, no env read at load — so
// node --test loads it (relative imports with extensions, `import type`).
import type { CallWindow, SendRule } from "../crm/types.ts";

const EVERYWHERE = {
  noticeDeadlineDays: 30,
  reEmailAfterDays: 90,
  auditMaxAgeDays: 90,
  maxEmailsPer90d: 2,
  maxCallAttempts30d: 4,
} as const;

// Mon–Fri as 1..5 (ISO weekday numbers; Sunday is 7).
const WEEKDAYS = [1, 2, 3, 4, 5];

const GB_WINDOW: CallWindow = { tz: "Europe/London", days: WEEKDAYS, ranges: [["09:00", "17:30"]] };

export const RULES: Record<"FR" | "GB" | "US" | "*", SendRule> = {
  FR: {
    country: "FR",
    emailAllowed: true,
    soleTraderEmail: "allowed_with_notice",
    unknownLegalFormEmail: "allowed",
    requiresPostalAddress: false,
    requiresAdIdentification: false,
    optOutHonourDays: 0,
    ...EVERYWHERE,
    footer: "fr",
    defaultLocale: "fr",
    callAllowed: true,
    callWindow: { tz: "Europe/Paris", days: WEEKDAYS, ranges: [["10:00", "13:00"], ["14:00", "20:00"]] },
    legalRefs: ["RGPD art. 6.1.f", "RGPD art. 14", "CPCE art. L34-5", "CNIL — prospection B2B"],
  },
  GB: {
    country: "GB",
    emailAllowed: true,
    soleTraderEmail: "consent_required",
    unknownLegalFormEmail: "call_only",
    requiresPostalAddress: false,
    requiresAdIdentification: false,
    optOutHonourDays: 0,
    ...EVERYWHERE,
    footer: "en_uk",
    defaultLocale: "en",
    callAllowed: "screened",
    callWindow: GB_WINDOW,
    legalRefs: ["UK GDPR art. 6(1)(f)", "PECR reg 21", "PECR reg 22", "PECR reg 23"],
  },
  US: {
    country: "US",
    emailAllowed: true,
    soleTraderEmail: "allowed_with_notice",
    unknownLegalFormEmail: "allowed",
    requiresPostalAddress: true,
    requiresAdIdentification: true,
    optOutHonourDays: 10,
    ...EVERYWHERE,
    footer: "en_us",
    defaultLocale: "en",
    callAllowed: true,
    callWindow: { tz: "America/New_York", days: WEEKDAYS, ranges: [["09:00", "17:00"]] },
    legalRefs: ["CAN-SPAM Act", "GDPR / UK GDPR art. 6(1)(f)"],
  },
  "*": {
    country: "*",
    emailAllowed: false,
    soleTraderEmail: "blocked",
    unknownLegalFormEmail: "call_only",
    requiresPostalAddress: false,
    requiresAdIdentification: false,
    optOutHonourDays: 0,
    ...EVERYWHERE,
    footer: "en_uk",
    defaultLocale: "en",
    callAllowed: "manual",
    callWindow: GB_WINDOW,
    legalRefs: ["Local law check before any call (DE §7 UWG, AT §174 TKG)"],
  },
};

export type RuleKey = keyof typeof RULES;

function normaliseCountry(cc: string | null | undefined): string {
  return (cc ?? "").trim().toUpperCase();
}

/** "FR" | "GB" | "US" for a country with its own row, else "*" — the value stored in sends.rule_key. */
export function ruleKeyFor(cc: string | null | undefined): RuleKey {
  const c = normaliseCountry(cc);
  return c === "FR" || c === "GB" || c === "US" ? c : "*";
}

/** The SendRule that applies to a country (the "*" row for every country without its own). */
export function ruleFor(cc: string | null | undefined): SendRule {
  return RULES[ruleKeyFor(cc)];
}

/** ISO2 set from OUTREACH_COUNTRY_ALLOW (default FR,GB,US); junk entries dropped. */
export function countryAllowList(raw: string | undefined = process.env.OUTREACH_COUNTRY_ALLOW): Set<string> {
  const list = (raw ?? "").trim() ? raw! : "FR,GB,US";
  return new Set(
    list
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z]{2}$/.test(s)),
  );
}

/**
 * In-app email is possible only when the country has a rule row that allows
 * it AND the env lists it: `FR,GB,US,CA` still leaves CA blocked (no row).
 */
export function emailEnabled(cc: string | null | undefined, allow: Set<string> = countryAllowList()): boolean {
  const c = normaliseCountry(cc);
  return ruleKeyFor(c) !== "*" && RULES[ruleKeyFor(c)].emailAllowed === true && allow.has(c);
}

// ---- call windows -------------------------------------------------------------------------

export interface WindowStatus {
  open: boolean;
  tz: string;
  /** ISO weekday 1 (Mon) … 7 (Sun) in the rule's time zone. */
  weekday: number;
  /** Wall-clock "HH:MM" in the rule's time zone. */
  localTime: string;
  /** "HH:MM–HH:MM, HH:MM–HH:MM" for the hint. */
  hours: string;
}

const ISO_WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Weekday and "HH:MM" of an instant in a time zone. */
export function localClock(tz: string, at: Date): { weekday: number; localTime: string } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", weekday: "short", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ISO_WEEKDAY[get("weekday")] ?? 0;
  return { weekday, localTime: `${get("hour").padStart(2, "0")}:${get("minute").padStart(2, "0")}` };
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m ?? 0);
}

/** Whether `at` falls inside the window's days and ranges (range end exclusive), with the local clock for the hint. */
export function callWindowStatus(window: CallWindow, at: Date = new Date()): WindowStatus {
  const { weekday, localTime } = localClock(window.tz, at);
  const now = minutes(localTime);
  const open = window.days.includes(weekday) && window.ranges.some(([from, to]) => now >= minutes(from) && now < minutes(to));
  return { open, tz: window.tz, weekday, localTime, hours: window.ranges.map(([a, b]) => `${a}–${b}`).join(", ") };
}
