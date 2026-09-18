// Timezone helpers shared by the booking widget (client) and /api/book (server).
// Pure Intl: no Node-only import, no dependency, safe in both runtimes.
//
// Every entry point is guarded. A visitor's `Intl` zone string reaches us from
// the browser and a booking page that throws on an unknown zone costs a lead,
// so an invalid or unknown zone is treated as the site zone instead.

/** Site zone fallback. A literal on purpose: this module is imported client-side. */
export const SITE_TZ = "Europe/Paris";

/** Hour + minute only, the shape used for slot labels. */
const TIME_OPTS: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

const zoneOk = new Map<string, boolean>();

/** True when `tz` is a string Intl accepts as a timezone. Cached; never throws. */
export function isValidZone(tz: unknown): tz is string {
  if (typeof tz !== "string") return false;
  const s = tz.trim();
  if (!s || s.length > 64) return false;
  const cached = zoneOk.get(s);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: s }).format(new Date());
    ok = true;
  } catch {
    ok = false;
  }
  zoneOk.set(s, ok);
  return ok;
}

/** `tz` when usable, otherwise the fallback (the site zone by default). */
function zoneOr(tz: unknown, fallback: string = SITE_TZ): string {
  return isValidZone(tz) ? tz.trim() : fallback;
}

function usable(at: Date): boolean {
  return at instanceof Date && Number.isFinite(at.getTime());
}

/** Minutes `tz` is ahead of UTC at that instant (Europe/Paris in summer → 120). */
export function offsetMinutes(tz: string, at: Date): number {
  if (!usable(at)) return 0;
  const zone = zoneOr(tz);
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    const p: Record<string, string> = {};
    for (const part of fmt.formatToParts(at)) p[part.type] = part.value;
    let hour = Number(p.hour);
    if (hour === 24) hour = 0; // some ICU builds render midnight as 24
    const asUTC = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      hour,
      Number(p.minute),
      Number(p.second),
    );
    if (!Number.isFinite(asUTC)) return 0;
    return Math.round((asUTC - at.getTime()) / 60000);
  } catch {
    return 0;
  }
}

/** True when both zones show the same wall clock at that instant. */
export function sameInstantClock(a: string, b: string, at: Date): boolean {
  return offsetMinutes(a, at) === offsetMinutes(b, at);
}

/** "America/Toronto" → "Toronto", "America/New_York" → "New York". */
export function zoneCity(tz: string): string {
  const zone = zoneOr(tz);
  const seg = zone.split("/").pop() || zone;
  return seg.replace(/_/g, " ");
}

/** Whatever Intl gives for `timeZoneName: "shortOffset"`: "UTC−4", "GMT+2", … */
export function zoneShort(tz: string, at: Date, locale: string): string {
  if (!usable(at)) return "";
  const zone = zoneOr(tz);
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      hour: "numeric",
      timeZoneName: "shortOffset",
    }).formatToParts(at);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** "Toronto (UTC−4)" — the city, plus the short offset when Intl gives one. */
export function zoneLabel(tz: string, at: Date, locale: string): string {
  const city = zoneCity(tz);
  const short = zoneShort(tz, at, locale);
  return short ? `${city} (${short})` : city;
}

/** Format an instant in a given zone; an unusable zone or locale falls back. */
export function formatInZone(
  at: Date,
  tz: string,
  locale: string,
  opts: Intl.DateTimeFormatOptions = TIME_OPTS,
): string {
  if (!usable(at)) return "";
  const zone = zoneOr(tz);
  try {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone: zone }).format(at);
  } catch {
    try {
      return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: SITE_TZ }).format(at);
    } catch {
      return "";
    }
  }
}

/**
 * The same instant on both clocks, already formatted.
 * `differ` is false when the two zones read the same at that instant (so the
 * UI can stay quiet), and when the visitor zone is unknown.
 */
export function bothTimes(
  at: Date,
  localTz: string,
  siteTz: string,
  locale: string,
): { local: string; site: string; differ: boolean } {
  const site = zoneOr(siteTz);
  const local = zoneOr(localTz, site);
  return {
    local: formatInZone(at, local, locale, TIME_OPTS),
    site: formatInZone(at, site, locale, TIME_OPTS),
    differ: !sameInstantClock(local, site, at),
  };
}
