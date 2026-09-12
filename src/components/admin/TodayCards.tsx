"use client";

// Today (docs/finder-ux-spec.md §6.5): two buttons (Find businesses, Next
// call), exactly five action cards — each a link, 16 px sentence-case title,
// 32 px number, one line of detail — the week line, and a collapsed
// Housekeeping list. `toTodaySummary()` accepts both the new
// `{ actions, week, housekeeping }` shape and the legacy card array, so the
// page renders the same five cards before and after the backend's today.ts
// lands. The backfill button posts /api/admin/leads/backfill as before.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Tone } from "@/lib/inbox/stages";
import { Button } from "./Button";
import { buttonClass } from "./Button";
import { adminFetch } from "./adminFetch";
import { useToast } from "./Toast";
import { TODAY_TEXT, fill } from "./wording";

export type TodayLine = { text: string; href?: string };
export type TodayAction = { key: string; title: string; value: string; detail?: string; tone: Tone; href: string; lines?: TodayLine[] };
export type TodayWeek = { newLeads: number; bySource: { label: string; n: number }[] };
export type TodayHousekeeping = { key: string; text: string; href?: string; tone: Tone };
export type TodaySummary = { actions: TodayAction[]; week: TodayWeek; housekeeping: TodayHousekeeping[] };

/** The legacy card shape of summariseToday() (main @ c7b84fe). */
type LegacyCard = { key: string; title: string; value: string; detail?: string; tone: Tone; href?: string; lines?: TodayLine[] };

const ORDER = ["call", "ready", "followups", "reports-opened", "notice-deadlines"] as const;
const TITLE: Record<(typeof ORDER)[number], string> = { call: TODAY_TEXT.calls, ready: TODAY_TEXT.emails, followups: TODAY_TEXT.followUps, "reports-opened": TODAY_TEXT.reports, "notice-deadlines": TODAY_TEXT.notices };
const HREF: Record<(typeof ORDER)[number], string> = { call: "/admin/prospects?view=call", ready: "/admin/prospects?view=ready", followups: "/admin/leads?stage=open&sort=next&dir=asc", "reports-opened": "/admin/prospects", "notice-deadlines": "/admin/prospects" };

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
  const actions: TodayAction[] = ORDER.map((key) => {
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

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-line",
  good: "border-emerald-500/40",
  warn: "border-amber-500/50",
  bad: "border-accent/60 bg-accent/5",
  info: "border-sky-500/40",
};

const VALUE_CLASS: Record<Tone, string> = {
  neutral: "text-fg-heading",
  good: "text-emerald-300",
  warn: "text-amber-300",
  bad: "text-accent-soft",
  info: "text-sky-300",
};

function BackfillButton() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const r = await adminFetch<{ created: number; merged: number; pending: number }>("/api/admin/leads/backfill", {});
      toast.push(`Backfill: ${r.created} created · ${r.merged} merged · ${r.pending} pending`, "good");
      router.refresh();
    } catch {
      toast.push("The backfill failed. Try again.", "bad");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="primary" size="sm" loading={busy} onClick={run}>
      Backfill enquiries
    </Button>
  );
}

export function TodayCards({ summary, nextCall }: { summary: TodaySummary; nextCall: { id: number; name: string } | null }) {
  const weekBy = summary.week.bySource.map((s) => `${s.label} ${s.n}`).join(" · ");
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <Link href="/admin/find" className={buttonClass("primary", "md")}>
          {TODAY_TEXT.findBusinesses}
        </Link>
        {nextCall ? (
          <Link href={`/admin/prospects/${nextCall.id}`} className={buttonClass("ghost", "md")} title={nextCall.name}>
            {TODAY_TEXT.nextCall} · <span className="max-w-[14rem] truncate">{nextCall.name}</span>
          </Link>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" data-testid="today-cards">
        {summary.actions.map((c) => (
          <Link key={c.key} href={c.href} className={`card card-hover flex flex-col gap-1.5 border p-5 ${TONE_CLASS[c.tone]}`} data-testid="today-card">
            <span className="text-[16px] text-fg-heading">{c.title}</span>
            <span className={`font-display text-[32px] leading-none ${VALUE_CLASS[c.tone]}`}>{c.value}</span>
            {c.detail ? <span className="text-[15px] text-fg-muted">{c.detail}</span> : null}
            {c.lines && c.lines.length > 0 ? (
              <ul className="mt-1 space-y-0.5 text-[14px] text-fg-muted">
                {c.lines.slice(0, 4).map((l, i) => (
                  <li key={i} className="truncate" title={l.text}>
                    {l.text}
                  </li>
                ))}
              </ul>
            ) : null}
          </Link>
        ))}
      </div>

      <p className="text-[15px] text-fg-muted">
        <Link href="/admin/leads?stage=all&sort=created&dir=desc" className="hover:text-fg-heading">
          {fill(TODAY_TEXT.week, { n: summary.week.newLeads, by: weekBy || "none yet" })}
        </Link>
      </p>

      <details className="text-[15px]" data-testid="housekeeping">
        <summary className="cursor-pointer text-fg-muted">{TODAY_TEXT.housekeeping}</summary>
        <ul className="mt-2 space-y-1.5">
          {summary.housekeeping.map((h) => (
            <li key={h.key} className={`flex flex-wrap items-center gap-3 ${h.tone === "bad" ? "text-accent-soft" : h.tone === "warn" ? "text-amber-300" : "text-fg"}`}>
              {h.href ? (
                <Link href={h.href} className="hover:underline">
                  {h.text}
                </Link>
              ) : (
                <span>{h.text}</span>
              )}
              {h.key === "backfill" ? <BackfillButton /> : null}
            </li>
          ))}
          {summary.housekeeping.length === 0 ? <li className="text-fg-muted">Nothing to report.</li> : null}
        </ul>
      </details>
    </div>
  );
}
