// Lead hooks for the five public routes (contract §5). Each one is a single
// guarded call placed at a fixed spot in its route: it never throws, never
// awaits the network, and stores the lead before any email goes out so a
// mail outage cannot lose it. Telegram pings carry references only.
import { attributionLabel, attributionSource, type Attribution } from "@/lib/attribution";
import { notifyTelegram } from "@/lib/notify";
import { sqlNow, zonedToday } from "@/lib/crm/db";
import type { Lead } from "@/lib/crm/types";
import { attachByCampaign, insertLead, linkEnquiry, type LeadInput } from "./leads";
import { AUDIT_CAMPAIGN_RE, addDays } from "./stages";

/** Runs `fn`; on failure logs the hook name and message only (no lead data) and returns null. */
function guarded(hook: string, fn: () => Lead | null): Lead | null {
  try {
    return fn();
  } catch (e) {
    console.error(`crm inbox hook failed (${hook})`, (e as { message?: string })?.message ?? e);
    return null;
  }
}

/** Insert, then link to an outreach prospect when the form carried a report campaign. */
function createFrom(input: LeadInput, attr: Attribution | undefined): { lead: Lead; merged: boolean } {
  const result = insertLead(input);
  const campaign = attr?.utm_campaign;
  if (campaign && AUDIT_CAMPAIGN_RE.test(campaign)) attachByCampaign(result.lead.id, campaign);
  return result;
}

function todayParis(): string {
  const [y, m, d] = zonedToday("Europe/Paris");
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Enquiries are DM- references; the booking widget passes them as `ref`.
const ENQUIRY_REFERENCE_RE = /^DM-[23456789A-Z]{5}$/;

/** /api/enquiry — after the enquiries row is written. */
export function leadFromEnquiry(p: {
  reference: string;
  locale: "fr" | "en";
  firstName: string;
  email: string;
  company: string;
  phone: string;
  attr: Attribution;
  ip: string;
}): Lead | null {
  return guarded("enquiry", () => {
    // The diagnostic form is the privacy notice: notice_sent_at = created_at.
    const createdAt = sqlNow();
    const { lead } = createFrom(
      {
        kind: "diagnostic",
        createdAt,
        name: p.firstName,
        email: p.email,
        company: p.company,
        phone: p.phone,
        locale: p.locale,
        sourceLabel: attributionLabel(p.attr),
        sourceUtm: attributionSource(p.attr) || null,
        attribution: p.attr,
        enquiryReference: p.reference,
        legalBasis: "request",
        dataSource: "form",
        noticeSentAt: createdAt,
        ip: p.ip,
      },
      p.attr,
    );
    linkEnquiry(p.reference, lead.id);
    return lead;
  });
}

/** /api/contact — after validation, before the mail send. */
export function leadFromContact(p: {
  name: string;
  email: string;
  phone: string;
  company: string;
  locale: string;
  message: string;
  attr: Attribution;
  ip: string;
}): Lead | null {
  return guarded("contact", () => {
    const { lead } = createFrom(
      {
        kind: "contact",
        name: p.name,
        email: p.email,
        company: p.company,
        phone: p.phone,
        locale: p.locale,
        sourceLabel: attributionLabel(p.attr),
        sourceUtm: attributionSource(p.attr) || null,
        attribution: p.attr,
        legalBasis: "request",
        dataSource: "form",
        note: p.message,
        ip: p.ip,
      },
      p.attr,
    );
    return lead;
  });
}

/** /api/book — once per successful branch (booked | requested), before its return. */
export function leadFromBooking(p: {
  mode: "booked" | "requested";
  name: string;
  email: string;
  phone: string;
  company: string;
  locale: "fr" | "en";
  needs: string;
  ref: string;
  startISO?: string;
  proposed?: string;
  attr: Attribution;
  ip: string;
}): Lead | null {
  return guarded("book", () => {
    const enquiryReference = ENQUIRY_REFERENCE_RE.test(p.ref) ? p.ref : null;
    const noteLines = [p.needs, p.mode === "requested" && p.proposed ? `Preferred times: ${p.proposed}` : null].filter(Boolean);
    // A booked slot is the next action; a call request needs a confirmed time today.
    const slotDay = p.startISO ? p.startISO.slice(0, 10) : null;
    const { lead } = createFrom(
      {
        kind: "booking",
        name: p.name,
        email: p.email,
        company: p.company,
        phone: p.phone,
        locale: p.locale,
        sourceLabel: attributionLabel(p.attr),
        sourceUtm: attributionSource(p.attr) || null,
        attribution: p.attr,
        enquiryReference,
        legalBasis: "request",
        dataSource: "booking",
        nextAction: p.mode === "booked" ? "Discovery call (booked)" : "Confirm a call time",
        nextActionAt: p.mode === "booked" && slotDay ? slotDay : todayParis(),
        note: noteLines.length ? noteLines.join("\n") : null,
        ip: p.ip,
      },
      p.attr,
    );
    if (enquiryReference) linkEnquiry(enquiryReference, lead.id);
    return lead;
  });
}

type ChatLead = {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  needs: string;
  timeline?: string;
  budget?: string;
  locale?: string;
};

function chatNote(l: ChatLead): string {
  return [l.needs, l.timeline ? `Timeline: ${l.timeline}` : null, l.budget ? `Budget: ${l.budget}` : null].filter(Boolean).join("\n");
}

/** /api/chat submit_lead — first statement inside execute, before mailConfigured(). */
export function leadFromChat(l: ChatLead, ip: string): Lead | null {
  return guarded("chat", () => {
    const { lead, merged } = insertLead({
      kind: "chat",
      name: l.name,
      email: l.email,
      phone: l.phone,
      company: l.company,
      locale: l.locale,
      sourceLabel: "Site chat",
      legalBasis: "request",
      dataSource: "chat",
      note: chatNote(l),
      ip,
    });
    notifyTelegram(`💬 CHAT lead ${lead.reference}${merged ? " (merged into an existing lead)" : ""} — ${siteLeadUrl(lead)}`);
    return lead;
  });
}

/** /api/messenger leadTool — first statement inside execute, before mailConfigured(). */
export function leadFromMessenger(l: ChatLead): Lead | null {
  return guarded("messenger", () => {
    const { lead, merged } = insertLead({
      kind: "messenger",
      name: l.name,
      email: l.email,
      phone: l.phone,
      company: l.company,
      locale: l.locale,
      sourceLabel: "Facebook Messenger",
      legalBasis: "request",
      dataSource: "messenger",
      note: chatNote(l),
    });
    notifyTelegram(`💬 MESSENGER lead ${lead.reference}${merged ? " (merged into an existing lead)" : ""} — ${siteLeadUrl(lead)}`);
    return lead;
  });
}

// Same expression as SITE_URL in @/lib/seo (that module pulls the content tree).
function siteLeadUrl(lead: Lead): string {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://d3v.digitalm.eu").replace(/\/$/, "");
  return `${site}/admin/leads/${lead.id}`;
}

/** Follow-up date helper for callers that schedule "in N days" (outreach's +7). */
export function followUpDate(days: number): string {
  return addDays(todayParis(), days);
}
