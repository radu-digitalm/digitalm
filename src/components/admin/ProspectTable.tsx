"use client";

// Prospect list (contract §6 "Views", docs/finder-ux-spec.md §6.2): tabs
// ready / call / all / not_fit, Add by website, a More menu (Audit next 20,
// Fill in missing towns), search, sort, readable columns, whole-row click,
// card mode on phones, and the "What the labels mean" glossary.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ProspectListRow, ProspectView } from "@/lib/prospects/store";
import { tradeLabel } from "@/lib/discover/categories";
import { AddByUrl } from "./AddByUrl";
import { adminFetch } from "./adminFetch";
import { Badge } from "./Badge";
import { Button, buttonClass } from "./Button";
import { DataTable, type Column } from "./DataTable";
import { ExtLink } from "./ExtLink";
import { inputClass } from "./Field";
import { backfillTowns } from "./finderApi";
import { countryName, shortDateTime, townLine } from "./format";
import { ProspectBadges, anyPhone, badgeGlossary, usableEmail } from "./ProspectBadges";
import { useToast } from "./Toast";
import { LEAD_STAGE_WORDS, PROSPECT_TEXT } from "./wording";

const TABS: { view: ProspectView; label: string; hint: string }[] = [
  { view: "ready", label: "Ready to send", hint: "Audited, low score, a business email we may write to — 20 at a time, lowest score first" },
  { view: "call", label: "Call list", hint: "No usable email but a phone on file, under 4 attempts in 30 days" },
  { view: "all", label: "All", hint: "Every live prospect" },
  { view: "not_fit", label: "Not a fit", hint: "Marked not a fit" },
];

const SORT_OPTIONS = [
  { value: "saved", label: "Saved" },
  { value: "score", label: "Website score" },
  { value: "name", label: "Name" },
  { value: "deadline", label: "Notice due" },
  { value: "city", label: "Town" },
  { value: "updated", label: "Updated" },
];

function gradeVariant(grade: string | null): "good" | "warn" | "bad" | "neutral" {
  return grade === "A" ? "good" : grade === "B" ? "warn" : grade === "C" ? "bad" : "neutral";
}

function MoreMenu({ onAudit, onTowns, busy }: { onAudit: () => void; onTowns: () => void; busy: string | null }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div ref={root} className="relative">
      <Button size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" loading={busy !== null}>
        {PROSPECT_TEXT.more} ▾
      </Button>
      {open ? (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 flex w-64 flex-col rounded-lg border border-line bg-surface p-1 shadow-xl">
          <button
            type="button"
            role="menuitem"
            className="rounded-md px-3 py-2 text-left text-[16px] text-fg-heading hover:bg-surface-2"
            onClick={() => {
              setOpen(false);
              onAudit();
            }}
            title="Queues audits for up to 20 prospects with a website and no audit in the last 90 days"
          >
            {PROSPECT_TEXT.auditNext}
          </button>
          <button
            type="button"
            role="menuitem"
            className="rounded-md px-3 py-2 text-left text-[16px] text-fg-heading hover:bg-surface-2"
            onClick={() => {
              setOpen(false);
              onTowns();
            }}
            title="Looks up the commune of prospects saved without a town"
          >
            {PROSPECT_TEXT.fillTowns}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ProspectTable({
  rows,
  view,
  counts,
  q,
  sort,
  dir,
}: {
  rows: ProspectListRow[];
  view: ProspectView;
  counts: Record<ProspectView, number>;
  q: string;
  sort: string;
  dir: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function auditNext() {
    setBusy("audit");
    try {
      const r = await adminFetch<{ queued: number; deduped: number }>("/api/admin/prospects/audit-next", { limit: 20 });
      toast.push(r.queued === 0 && r.deduped === 0 ? "Nothing to audit — every prospect with a website has a recent audit or a queued job" : `${r.queued} audit${r.queued === 1 ? "" : "s"} queued${r.deduped ? ` · ${r.deduped} already queued` : ""}`, "good");
      router.refresh();
    } catch {
      toast.push("The audits could not be queued. Try again.", "bad");
    } finally {
      setBusy(null);
    }
  }

  async function fillTowns() {
    setBusy("towns");
    try {
      const r = await backfillTowns();
      toast.push(r.filled === 0 && r.remaining === 0 ? "Every prospect already has a town" : `${r.filled} town${r.filled === 1 ? "" : "s"} filled in${r.remaining ? ` · ${r.remaining} still missing — run it again` : ""}`, "good");
      router.refresh();
    } catch {
      toast.push("The towns could not be filled in. Try again later.", "bad");
    } finally {
      setBusy(null);
    }
  }

  const columns: Column<ProspectListRow>[] = [
    {
      key: "name",
      header: "Prospect",
      cardLabel: false,
      render: (p) => (
        <div className="min-w-[12rem]">
          <Link href={`/admin/prospects/${p.id}`} onClick={(e) => e.stopPropagation()} className="text-[17px] text-fg-heading hover:underline">
            {p.name}
          </Link>
          <div className="text-[15px] text-fg-muted">
            <span className="font-mono">{p.reference}</span> · saved {shortDateTime(p.savedAt)}
          </div>
        </div>
      ),
    },
    { key: "trade", header: "Trade", render: (p) => tradeLabel(p.tradeKey) ?? "" },
    {
      key: "town",
      header: "Town",
      render: (p) => {
        const town = townLine(p.postcode, p.city);
        const c = p.country !== "FR" ? countryName(p.country) : "";
        return town || c ? `${town}${town && c ? ", " : ""}${c}` : "";
      },
    },
    {
      key: "score",
      header: "Website score",
      align: "center",
      render: (p) =>
        p.latestScore === null ? (
          <span className="text-[16px] text-fg-muted">{PROSPECT_TEXT.notAudited}</span>
        ) : (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[16px]" title={PROSPECT_TEXT.scoreTitle}>
            {p.latestScore}
            <Badge variant={gradeVariant(p.latestGrade)}>{p.latestGrade ?? "?"}</Badge>
          </span>
        ),
    },
    {
      key: "site",
      header: "Website",
      className: "whitespace-nowrap [&_a]:break-normal",
      render: (p) =>
        p.website ? (
          <span onClick={(e) => e.stopPropagation()}>
            <ExtLink href={p.website}>{p.domainKey ?? p.website}</ExtLink>
          </span>
        ) : (
          ""
        ),
    },
    {
      key: "contact",
      header: "Contact",
      className: "min-w-[13rem]",
      render: (p) => {
        const email = usableEmail(p);
        const phone = anyPhone(p);
        return (
          <div className="text-[16px]">
            {email ? <div className="break-words">{email}</div> : p.websiteEmail ? <div className="break-words text-fg-muted">{p.websiteEmail}</div> : null}
            {phone ? <div className="whitespace-nowrap">{phone}</div> : null}
            {view === "call" ? <div className="text-[15px] text-fg-muted">{p.callAttempts30d} of 4 calls in 30 days</div> : null}
          </div>
        );
      },
    },
    { key: "badges", header: "Status", render: (p) => <ProspectBadges prospect={p} max={3} /> },
    {
      key: "lead",
      header: "Lead",
      render: (p) =>
        p.leadId ? (
          <Link href={`/admin/leads/${p.leadId}`} onClick={(e) => e.stopPropagation()} className="link-accent whitespace-nowrap text-[16px]">
            {p.leadReference ?? `#${p.leadId}`} · {LEAD_STAGE_WORDS[p.leadStage ?? ""] ?? p.leadStage ?? ""}
          </Link>
        ) : (
          ""
        ),
    },
  ];

  return (
    <section className="space-y-4">
      <nav aria-label="Views" className="flex flex-wrap items-center gap-1 border-b border-line">
        {TABS.map((t) => (
          <Link
            key={t.view}
            href={`/admin/prospects?view=${t.view}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            title={t.hint}
            aria-current={t.view === view ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-[16px] ${t.view === view ? "border-accent text-fg-heading" : "border-transparent text-fg-muted hover:text-fg-heading"}`}
          >
            {t.label} <span className="font-mono text-[15px] text-fg-muted">{counts[t.view]}</span>
          </Link>
        ))}
        <span className="flex-1" />
        <div className="flex items-center gap-2 py-1">
          <MoreMenu onAudit={() => void auditNext()} onTowns={() => void fillTowns()} busy={busy} />
        </div>
      </nav>

      <div className="flex flex-wrap items-end gap-3">
        <form method="get" action="/admin/prospects" className="flex flex-1 flex-wrap items-end gap-3">
          <input type="hidden" name="view" value={view} />
          <label className="min-w-[14rem] flex-1 text-[16px] text-fg-muted">
            <span className="mb-1.5 block">Search</span>
            <input name="q" defaultValue={q} placeholder="name, town, domain or PR- reference" className={inputClass} />
          </label>
          {view === "all" || view === "not_fit" ? (
            <>
              <label className="text-[16px] text-fg-muted">
                <span className="mb-1.5 block">Sort</span>
                <select name="sort" defaultValue={sort} className={inputClass}>
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[16px] text-fg-muted">
                <span className="mb-1.5 block">Order</span>
                <select name="dir" defaultValue={dir} className={inputClass}>
                  <option value="desc">Newest / highest first</option>
                  <option value="asc">Oldest / lowest first</option>
                </select>
              </label>
            </>
          ) : null}
          <button type="submit" className={buttonClass("ghost", "md")}>
            Apply
          </button>
          {q ? (
            <Link href={`/admin/prospects?view=${view}`} className={buttonClass("ghost", "md")}>
              Clear
            </Link>
          ) : null}
        </form>
        <AddByUrl className="sm:self-end" />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(p) => p.id}
        cards
        minWidth="58rem"
        onRowClick={(p) => router.push(`/admin/prospects/${p.id}`)}
        empty={
          view === "ready"
            ? "No prospect is ready to send: it takes a finished audit under the score threshold, a business email we may write to, and a country with an email rule."
            : view === "call"
              ? "Nobody to call: the call list needs a phone number and no usable email."
              : "No prospects yet — run a search on the Find page or add one by its website."
        }
        caption={`Prospects — ${TABS.find((t) => t.view === view)?.label ?? view}`}
      />

      <details className="text-[16px] text-fg">
        <summary className="cursor-pointer text-fg-muted">{PROSPECT_TEXT.labelsTitle}</summary>
        <dl className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {badgeGlossary().map((g) => (
            <div key={g.key} className="grid grid-cols-[minmax(9rem,38%)_1fr] gap-2">
              <dt className="text-fg-heading">{g.label}</dt>
              <dd className="text-fg-muted">{g.sentence}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
