// Business-hours slot generation in a fixed timezone (DST-aware via Intl),
// excluding weekends, slots inside the lead-time window, and busy intervals.

export const BOOKING = {
  tz: process.env.BOOKING_TZ || "Europe/Paris",
  startHour: Number(process.env.BOOKING_START_HOUR || 9),
  endHour: Number(process.env.BOOKING_END_HOUR || 18),
  slotMin: Number(process.env.BOOKING_SLOT_MIN || 30),
  bufferMin: Number(process.env.BOOKING_BUFFER_MIN || 30),
  days: Number(process.env.BOOKING_DAYS || 14),
  leadMin: Number(process.env.BOOKING_LEAD_MIN || 120),
  maxSlots: 48,
};

function tzParts(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  return p;
}

/** Milliseconds the timezone is ahead of UTC at the given instant. */
function tzOffset(tz: string, date: Date): number {
  const p = tzParts(date, tz);
  let hour = +p.hour;
  if (hour === 24) hour = 0;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
  return asUTC - date.getTime();
}

/** UTC instant for the given wall-clock time in `tz` (two-pass for DST). */
function makeInstant(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let inst = guess - tzOffset(tz, new Date(guess));
  inst = guess - tzOffset(tz, new Date(inst));
  return new Date(inst);
}

/** Generate available slot start times (UTC ISO) for the configured window. */
export function generateSlots(now: Date, busy: { start: string; end: string }[]): string[] {
  const cfg = BOOKING;
  const lead = now.getTime() + cfg.leadMin * 60000;
  const intervals = busy.map((b) => [Date.parse(b.start), Date.parse(b.end)] as const);
  const out: string[] = [];

  for (let i = 0; i <= cfg.days && out.length < cfg.maxSlots; i++) {
    const dayRef = new Date(now.getTime() + i * 86400000);
    const p = tzParts(dayRef, cfg.tz);
    if (p.weekday === "Sat" || p.weekday === "Sun") continue;
    const y = +p.year,
      mo = +p.month,
      d = +p.day;

    for (
      let m = cfg.startHour * 60;
      m + cfg.slotMin <= cfg.endHour * 60 && out.length < cfg.maxSlots;
      m += cfg.slotMin + cfg.bufferMin
    ) {
      const start = makeInstant(y, mo, d, Math.floor(m / 60), m % 60, cfg.tz);
      const s = start.getTime();
      if (s < lead) continue;
      const e = s + cfg.slotMin * 60000;
      if (intervals.some(([bs, be]) => bs < e && be > s)) continue;
      out.push(start.toISOString());
    }
  }
  return out;
}
