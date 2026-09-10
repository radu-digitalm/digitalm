"use client";

// The Today grid: one card per summariseToday() entry, tone-coloured, with
// optional detail lines that link into the CRM. The backfill card carries the
// button that posts /api/admin/leads/backfill (shown only while pending > 0).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { TodayCard } from "@/lib/inbox/today";
import type { Tone } from "@/lib/inbox/stages";
import { Button } from "./Button";
import { adminFetch } from "./adminFetch";
import { useToast } from "./Toast";

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
    } catch (e) {
      toast.push(`Backfill failed: ${(e as Error).message}`, "bad");
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

export function TodayCards({ cards }: { cards: TodayCard[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((c) => (
        <section key={c.key} className={`card flex flex-col gap-2 border p-5 ${TONE_CLASS[c.tone]}`} aria-labelledby={`today-${c.key}`}>
          <h2 id={`today-${c.key}`} className="text-xs uppercase tracking-wide text-fg-faint">
            {c.href ? (
              <Link href={c.href} className="hover:text-fg-heading">
                {c.title}
              </Link>
            ) : (
              c.title
            )}
          </h2>
          <p className={`font-display text-2xl ${VALUE_CLASS[c.tone]}`}>{c.value}</p>
          {c.detail ? <p className="text-sm text-fg-muted">{c.detail}</p> : null}
          {c.lines && c.lines.length > 0 ? (
            <ul className="mt-1 space-y-1 text-sm">
              {c.lines.map((l, i) => (
                <li key={i} className="truncate text-fg-muted" title={l.text}>
                  {l.href ? (
                    <Link href={l.href} className="hover:text-fg-heading">
                      {l.text}
                    </Link>
                  ) : (
                    l.text
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {c.key === "backfill" ? (
            <div className="mt-2">
              <BackfillButton />
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}
