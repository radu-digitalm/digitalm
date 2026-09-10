import { daysUntilSql, fromSql } from "@/lib/crm/time";
import { Badge, type BadgeVariant } from "./Badge";

// Status badges for a prospect (contract §6 "Badges"): needs website / email
// / phone, call instead, notice deadline in N days, not a fit, chain (brand),
// partial register, wiped, plus the states that block outreach. Pure — no
// hooks, no DB — so server pages and client tables share it. Dates arrive as
// SQL UTC strings ("YYYY-MM-DD HH:MM:SS") and are parsed by crm/time.ts, which
// has no imports and therefore never pulls the SQLite driver into a bundle.

export type BadgeSpec = { key: string; label: string; variant: BadgeVariant; title?: string };

/** The subset of Prospect the badges look at (plus finder's brand and the lead stage). */
export type BadgeInput = {
  website: string | null;
  websiteEmail: string | null;
  websiteEmailKind: string | null;
  websitePhone: string | null;
  sourcePhone: string | null;
  contactEmailOverride: string | null;
  contactPhoneOverride: string | null;
  fit: "unknown" | "fit" | "not_fit";
  diffusion: "full" | "partial" | "na";
  registerStatus: "active" | "ceased" | "unknown";
  soleTrader: boolean | null;
  registerId: string | null;
  country: string;
  forbidsExtraction: boolean;
  forbidsOverrideReason: string | null;
  noticeSentAt: string | null;
  noticeDeadlineAt: string | null;
  personalWipedAt: string | null;
  optedOutAt: string | null;
  deletedAt: string | null;
  brand?: string | null;
  leadStage?: string | null;
};

export const parseSqlDate = fromSql;

/** Whole days from now until `s` (negative when past); null when unset. */
export const daysUntil = daysUntilSql;

export function usableEmail(p: Pick<BadgeInput, "websiteEmail" | "websiteEmailKind" | "contactEmailOverride">): string | null {
  if (p.contactEmailOverride) return p.contactEmailOverride;
  if (p.websiteEmail && p.websiteEmailKind && p.websiteEmailKind !== "webmail" && p.websiteEmailKind !== "unknown") return p.websiteEmail;
  return null;
}

export function anyPhone(p: Pick<BadgeInput, "websitePhone" | "sourcePhone" | "contactPhoneOverride">): string | null {
  return p.contactPhoneOverride ?? p.websitePhone ?? p.sourcePhone ?? null;
}

export function badgesFor(p: BadgeInput, now = new Date()): BadgeSpec[] {
  const out: BadgeSpec[] = [];
  const add = (key: string, label: string, variant: BadgeVariant, title?: string) => out.push({ key, label, variant, title });

  if (p.deletedAt) add("removed", "removed", "bad", "Marked as not this business");
  if (p.optedOutAt) add("optout", "opted out", "bad", `Opted out ${p.optedOutAt}`);
  if (p.registerStatus === "ceased") add("ceased", "register ceased", "bad");
  if (p.diffusion === "partial") add("partial", "partial register", "warn", "Non-diffusible in the register: cannot be saved or contacted");
  if (p.forbidsExtraction) {
    if (p.forbidsOverrideReason) add("forbids-override", "extraction override", "warn", p.forbidsOverrideReason);
    else add("forbids", "forbids extraction", "bad", "The site's legal page forbids extraction or prospecting");
  }
  if (p.fit === "not_fit") add("not-fit", "not a fit", "neutral");
  else if (p.fit === "fit") add("fit", "fit", "good");

  const email = usableEmail(p);
  const phone = anyPhone(p);
  if (!p.website) add("no-website", "needs website", "warn");
  if (!email) {
    if (phone) add("call", "call instead", "info", "No usable business email — a phone number is on file");
    else add("no-email", "needs email", "warn");
  } else if (p.websiteEmailKind === "webmail" && !p.contactEmailOverride) {
    add("webmail", "webmail address", "warn");
  }
  if (!phone) add("no-phone", "needs phone", "neutral");
  if (p.country === "GB" && p.soleTrader === null) add("gb-unknown", "legal form unknown", "warn", "GB: no email until the register confirms a company");
  if (p.country === "GB" && p.soleTrader === true) add("gb-sole", "sole trader (GB)", "warn", "GB sole trader: consent required for email");
  if (p.brand) add("chain", "chain", "info", `Brand: ${p.brand}`);

  if (p.personalWipedAt) add("wiped", "wiped", "neutral", `Personal contact fields wiped ${p.personalWipedAt}`);
  else if (!p.noticeSentAt && p.noticeDeadlineAt) {
    const days = daysUntil(p.noticeDeadlineAt, now);
    if (days !== null) {
      if (days > 0) add("deadline", `notice deadline in ${days} day${days === 1 ? "" : "s"}`, days <= 5 ? "warn" : "neutral", "No notice sent yet: contact before this date or the purge wipes the row");
      else add("deadline-passed", "notice deadline passed", "bad", "No notice within 30 days: contact fields will be wiped by the purge");
    }
  }

  if (p.leadStage) {
    if (["replied", "meeting", "proposal"].includes(p.leadStage)) add("lead", "in conversation", "info", `Lead stage: ${p.leadStage}`);
    else if (["won", "lost", "stop", "no_response"].includes(p.leadStage)) add("lead-closed", `lead: ${p.leadStage}`, "neutral");
    else add("lead-open", `lead: ${p.leadStage}`, "neutral");
  }
  return out;
}

export function ProspectBadges({ prospect, max, className = "" }: { prospect: BadgeInput; max?: number; className?: string }) {
  const badges = badgesFor(prospect);
  const shown = max ? badges.slice(0, max) : badges;
  const extra = badges.length - shown.length;
  if (badges.length === 0) return null;
  return (
    <span className={`inline-flex flex-wrap gap-1 ${className}`}>
      {shown.map((b) => (
        <Badge key={b.key} variant={b.variant} title={b.title}>
          {b.label}
        </Badge>
      ))}
      {extra > 0 ? <Badge variant="neutral" title={badges.slice(shown.length).map((b) => b.label).join(", ")}>{`+${extra}`}</Badge> : null}
    </span>
  );
}
