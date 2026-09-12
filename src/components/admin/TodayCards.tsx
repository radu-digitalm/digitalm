"use client";

// Today (docs/finder-ux-spec.md §6.5): two buttons (Find businesses, Next
// call), exactly five action cards — each a link, 16 px sentence-case title,
// 32 px number, one line of detail — the week line, and a collapsed
// Housekeeping list. The card model (`toTodaySummary()`, plain data) lives in
// todaySummary.ts so the server page never imports this client module's
// helpers. The backfill button posts /api/admin/leads/backfill as before.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Tone } from "@/lib/inbox/stages";
import { Button } from "./Button";
import { buttonClass } from "./Button";
import { adminFetch } from "./adminFetch";
import { useToast } from "./Toast";
import { TODAY_TEXT, fill } from "./wording";

export type { TodayAction, TodayHousekeeping, TodayLine, TodaySummary, TodayWeek } from "./todaySummary";
import type { TodaySummary } from "./todaySummary";

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
