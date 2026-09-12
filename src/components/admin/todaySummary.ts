// The Today page's card model (docs/finder-ux-spec.md §6.5) — plain data, no
// React, no "use client", so the server page can call toTodaySummary() and
// node --test can check it. `toTodaySummary()` accepts both the new
// `{ actions, week, housekeeping }` shape and the legacy card array of
// summariseToday(), so the page renders the same five cards either way.
import type { Tone } from "../../lib/inbox/stages.ts";
import { TODAY_TEXT, fill } from "./wording.ts";

export type TodayLine = { text: string; href?: string };
export type TodayAction = { key: string; title: string; value: string; detail?: string; tone: Tone; href: string; lines?: TodayLine[] };
export type TodayWeek = { newLeads: number; bySource: { label: string; n: number }[] };
export type TodayHousekeeping = { key: string; text: string; href?: string; tone: Tone };
export type TodaySummary = { actions: TodayAction[]; week: TodayWeek; housekeeping: TodayHousekeeping[] };

/** The legacy card shape of summariseToday() (main @ c7b84fe). */
export type LegacyCard = { key: string; title: string; value: string; detail?: string; tone: Tone; href?: string; lines?: TodayLine[] };

export const TODAY_ORDER = ["call", "ready", "followups", "reports-opened", "notice-deadlines"] as const;
const TITLE: Record<(typeof TODAY_ORDER)[number], string> = { call: TODAY_TEXT.calls, ready: TODAY_TEXT.emails, followups: TODAY_TEXT.followUps, "reports-opened": TODAY_TEXT.reports, "notice-deadlines": TODAY_TEXT.notices };
const HREF: Record<(typeof TODAY_ORDER)[number], string> = { call: "/admin/prospects?view=call", ready: "/admin/prospects?view=ready", followups: "/admin/leads?stage=open&sort=next&dir=asc", "reports-opened": "/admin/prospects", "notice-deadlines": "/admin/prospects" };

function isSummary(x: unknown): x is TodaySummary {
  return !!x && typeof x === "object" && Array.isArray((x as TodaySummary).actions);
}

/** Normalise whatever summariseToday() returned into the five-card shape. */
export function toTodaySummary(input: unknown): TodaySummary {
  if (isSummary(input)) return input;
  const cards = Array.isArray(input) ? (input as LegacyCard[]) : [];
  const by = new Map(cards.map((c) => [c.key, c]));
  const emails = by.get("emails-today");
  const sentToday = emails ? emails.value.replace(/\s*\/\s*/, " of ") : "";
  const actions: TodayAction[] = TODAY_ORDER.map((key) => {
    const c = by.get(key);
    const value = c?.value ?? "0";
    return {
      key,
      title: TITLE[key],
      value,
      detail: key === "ready" ? (sentToday ? fill(TODAY_TEXT.sentToday, { n: sentToday.split(" of ")[0] ?? "0", cap: sentToday.split(" of ")[1] ?? "10" }) : undefined) : c?.detail,
      tone: c?.tone ?? "neutral",
      href: HREF[key],
      lines: c?.lines,
    };
  });
  const newLeads = by.get("new-leads");
  const bySource = (newLeads?.lines ?? []).map((l) => {
    const m = /^(.*):\s*(\d+)$/.exec(l.text);
    return { label: m?.[1] ?? l.text, n: Number(m?.[2] ?? 0) };
  });
  const housekeeping: TodayHousekeeping[] = [];
  const audits = by.get("audits");
  if (audits) housekeeping.push({ key: "audits", text: `Audits: ${audits.value}${audits.detail ? ` · ${audits.detail.replace("in 7 days", "this week")}` : ""}`, tone: audits.tone });
  const bounces = by.get("bounces");
  if (bounces) housekeeping.push({ key: "bounces", text: `Bounces this week: ${bounces.value}`, tone: bounces.tone });
  const stop = by.get("stop-replies");
  if (stop && !/^0 /.test(stop.value)) housekeeping.push({ key: "stop", text: `STOP replies — check the mailbox (${stop.value})`, href: stop.href, tone: stop.tone });
  const purge = by.get("purge");
  if (purge) housekeeping.push({ key: "purge", text: `Purge last ran ${purge.value}`, tone: purge.tone === "bad" ? "bad" : "neutral" });
  const google = by.get("google");
  if (google && google.value !== "0 / 900") housekeeping.push({ key: "google", text: `Google usage: ${google.value.replace(/\s*\/\s*/, " of ")} this month`, tone: google.tone });
  const backfill = by.get("backfill");
  if (backfill) housekeeping.push({ key: "backfill", text: `Enquiries not yet in Leads: ${backfill.value}`, tone: "warn" });
  return { actions, week: { newLeads: Number(newLeads?.value ?? 0), bySource }, housekeeping };
}
