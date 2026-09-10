import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse } from "@/lib/crm/auth";
import { validEmail } from "@/lib/crm/classify";
import { insertLead } from "@/lib/inbox/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create a manual lead: { name, company?, email?, phone?, locale?, country?, note?, source_label? }.
 * A name plus an email or a phone is the minimum. Merges into an open lead with
 * the same email/phone like every other source (response says so).
 */
export async function POST(req: NextRequest) {
  const guard = await guardAdminPost(req);
  if (isResponse(guard)) return guard;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const name = str(body.name, 200);
  const email = str(body.email, 254);
  const phone = str(body.phone, 50);
  if (!name) return NextResponse.json({ ok: false, error: "name" }, { status: 422 });
  if (!email && !phone) return NextResponse.json({ ok: false, error: "contact" }, { status: 422 });
  if (email && !validEmail(email)) return NextResponse.json({ ok: false, error: "email" }, { status: 422 });
  const country = str(body.country, 2).toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) return NextResponse.json({ ok: false, error: "country" }, { status: 422 });

  const { lead, merged } = insertLead({
    kind: "manual",
    name,
    company: str(body.company, 200) || null,
    email: email || null,
    phone: phone || null,
    locale: str(body.locale, 5) || (country === "FR" ? "fr" : "en"),
    country: country || null,
    sourceLabel: str(body.source_label, 200) || "Manual entry",
    legalBasis: "request",
    dataSource: "manual",
    note: str(body.note, 4000) || null,
  });
  return NextResponse.json({ ok: true, lead, merged });
}
