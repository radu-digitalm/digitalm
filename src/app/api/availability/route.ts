import { NextResponse } from "next/server";
import { calendarConfigured, getBusy } from "@/lib/googleCalendar";
import { BOOKING, generateSlots } from "@/lib/booking";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!rateLimit(`avail:${clientIp(req)}`, 60, 10 * 60_000)) {
    return NextResponse.json({ configured: false, slots: [], error: "rate" }, { status: 429 });
  }
  if (!calendarConfigured()) {
    return NextResponse.json({
      configured: false,
      tz: BOOKING.tz,
      slotMin: BOOKING.slotMin,
      slots: [],
    });
  }
  const now = new Date();
  const timeMax = new Date(now.getTime() + (BOOKING.days + 1) * 86400000);
  let busy: { start: string; end: string }[] = [];
  try {
    busy = await getBusy(now.toISOString(), timeMax.toISOString());
  } catch {
    busy = [];
  }
  return NextResponse.json({
    configured: true,
    tz: BOOKING.tz,
    slotMin: BOOKING.slotMin,
    slots: generateSlots(now, busy),
  });
}
