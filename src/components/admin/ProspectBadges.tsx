import { daysUntilSql, fromSql } from "@/lib/crm/time";
import { Badge, type BadgeVariant } from "./Badge";
import { BADGE_TEXT, LEAD_STAGE_WORDS, fill } from "./wording";

// Status badges for a prospect (contract §6 "Badges"), worded per
// docs/finder-ux-spec.md §6.3: the keys are unchanged, the labels are plain
// words from wording.ts and every badge carries its sentence as a title.
// Pure — no hooks, no DB — so server pages and client tables share it. Dates
// arrive as SQL UTC strings ("YYYY-MM-DD HH:MM:SS") and are parsed by
// crm/time.ts, which has no imports and therefore never pulls the SQLite
// driver into a bundle.

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
  const add = (key: string, variant: BadgeVariant, params: Record<string, string | number> = {}, title?: string) => {
    const t = BADGE_TEXT[key] ?? { label: key, sentence: "" };
    out.push({ key, label: fill(t.label, params), variant, title: title ?? t.sentence });
  };

  if (p.deletedAt) add("removed", "bad");
  if (p.optedOutAt) add("optout", "bad");
  if (p.registerStatus === "ceased") add("ceased", "bad");
  if (p.diffusion === "partial") add("partial", "warn");
  if (p.forbidsExtraction) {
    if (p.forbidsOverrideReason) add("forbids-override", "warn", {}, p.forbidsOverrideReason);
    else add("forbids", "bad");
  }
  if (p.fit === "not_fit") add("not-fit", "neutral");
  else if (p.fit === "fit") add("fit", "good");

  const email = usableEmail(p);
  const phone = anyPhone(p);
  if (!p.website) add("no-website", "warn");
  if (!email) {
    if (phone) add("call", "info");
    else add("no-email", "warn");
  } else if (p.websiteEmailKind === "webmail" && !p.contactEmailOverride) {
    add("webmail", "warn");
  }
  if (!phone) add("no-phone", "neutral");
  if (p.country === "GB" && p.soleTrader === null) add("gb-unknown", "warn");
  if (p.country === "GB" && p.soleTrader === true) add("gb-sole", "warn");
  if (p.brand) add("chain", "info", {}, `Part of the ${p.brand} chain`);

  if (p.personalWipedAt) add("wiped", "neutral");
  else if (!p.noticeSentAt && p.noticeDeadlineAt) {
    const days = daysUntil(p.noticeDeadlineAt, now);
    if (days !== null) {
      if (days > 0) add("deadline", days <= 5 ? "warn" : "neutral", { n: days });
      else add("deadline-passed", "bad");
    }
  }

  if (p.leadStage) {
    const stage = LEAD_STAGE_WORDS[p.leadStage] ?? p.leadStage.replace(/_/g, " ");
    if (["replied", "meeting", "proposal"].includes(p.leadStage)) add("lead", "info", {}, `Lead stage: ${stage}`);
    else if (["won", "lost", "stop", "no_response"].includes(p.leadStage)) add("lead-closed", "neutral", { stage });
    else add("lead-open", "neutral", { stage });
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

/** Every badge word with its sentence — the "What the labels mean" list. */
export function badgeGlossary(): { label: string; sentence: string }[] {
  return Object.values(BADGE_TEXT).map((t) => ({ label: fill(t.label, { n: "N", stage: "stage" }), sentence: t.sentence }));
}
