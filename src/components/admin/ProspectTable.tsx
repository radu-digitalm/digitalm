"use client";

// Prospect list (contract §6 "Views"): tabs ready / call / all / not_fit,
// search, sort (all view), badges, and "Audit next 20" which enqueues deduped
// audit jobs for prospects without a recent audit.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ProspectListRow, ProspectView } from "@/lib/prospects/store";
import { adminFetch } from "./adminFetch";
import { Badge } from "./Badge";
import { Button, buttonClass } from "./Button";
import { DataTable, type Column } from "./DataTable";
import { ExtLink } from "./ExtLink";
import { inputClass } from "./Field";
import { ProspectBadges, anyPhone, usableEmail } from "./ProspectBadges";
import { useToast } from "./Toast";

const TABS: { view: ProspectView; label: string; hint: string }[] = [
  { view: "ready", label: "Ready to send", hint: "Audited, low score, usable email, inside the rules — 20 at a time, lowest score first" },
  { view: "call", label: "Call list", hint: "No usable email but a phone on file, under 4 attempts in 30 days" },
  { view: "all", label: "All", hint: "Every live prospect" },
  { view: "not_fit", label: "Not a fit", hint: "Marked not a fit" },
];

const SORT_OPTIONS = [
  { value: "saved", label: "Saved" },
  { value: "score", label: "Score" },
  { value: "name", label: "Name" },
  { value: "deadline", label: "Notice deadline" },
  { value: "city", label: "Town" },
  { value: "updated", label: "Updated" },
];

function gradeVariant(grade: string | null): "good" | "warn" | "bad" | "neutral" {
  return grade === "A" ? "good" : grade === "B" ? "warn" : grade === "C" ? "bad" : "neutral";
}

function shortDate(s: string | null): string {
  return s ? s.slice(0, 10) : "—";
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
  const [busy, setBusy] = useState(false);

  async function auditNext() {
    setBusy(true);
    try {
      const r = await adminFetch<{ queued: number; deduped: number }>("/api/admin/prospects/audit-next", { limit: 20 });
      toast.push(r.queued === 0 && r.deduped === 0 ? "Nothing to audit — every prospect with a website has a recent audit or a queued job" : `${r.queued} audit${r.queued === 1 ? "" : "s"} queued${r.deduped ? ` · ${r.deduped} already queued` : ""}`, "good");
      router.refresh();
    } catch (e) {
      toast.push(`Could not queue audits (${(e as { code?: string }).code ?? "error"})`, "bad");
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<ProspectListRow>[] = [
    {
      key: "name",
      header: "Prospect",
      render: (p) => (
        <div className="min-w-[12rem]">
          <Link href={`/admin/prospects/${p.id}`} className="text-fg-heading hover:underline">
            {p.name}
          </Link>
          <div className="font-mono text-xs text-fg-faint">{p.reference}</div>
        </div>
      ),
    },
    {
      key: "where",
      header: "Trade · town",
      render: (p) => (
        <div className="text-fg-muted">
          <div>{p.tradeKey ?? <span className="text-fg-faint">—</span>}</div>
          <div className="text-xs">
            {[p.postcode, p.city].filter(Boolean).join(" ")} · {p.country}
          </div>
        </div>
      ),
    },
    {
      key: "score",
      header: "Score",
      align: "center",
      render: (p) =>
        p.latestScore === null ? (
          <span className="text-xs text-fg-faint">not audited</span>
        ) : (
          <span className="inline-flex items-center gap-1 font-mono text-sm">
            {p.latestScore}
            <Badge variant={gradeVariant(p.latestGrade)}>{p.latestGrade ?? "?"}</Badge>
          </span>
        ),
    },
    {
      key: "site",
      header: "Website",
      render: (p) => (p.website ? <ExtLink href={p.website}>{p.domainKey ?? p.website}</ExtLink> : <span className="text-fg-faint">—</span>),
    },
    {
      key: "contact",
      header: "Contact",
      render: (p) => {
        const email = usableEmail(p);
        const phone = anyPhone(p);
        return (
          <div className="text-xs text-fg-muted">
            {email ? (
              <div className="break-all">
                {email} <span className="text-fg-faint">({p.contactEmailOverride ? "override" : p.websiteEmailKind})</span>
              </div>
            ) : p.websiteEmail ? (
              <div className="break-all text-fg-faint">{p.websiteEmail} ({p.websiteEmailKind})</div>
            ) : null}
            {phone ? <div>{phone}</div> : null}
            {!email && !phone && !p.websiteEmail ? <span className="text-fg-faint">—</span> : null}
            {view === "call" ? <div className="text-fg-faint">{p.callAttempts30d}/4 calls in 30 d</div> : null}
          </div>
        );
      },
    },
    { key: "badges", header: "Status", render: (p) => <ProspectBadges prospect={p} max={4} /> },
    {
      key: "lead",
      header: "Lead",
      render: (p) =>
        p.leadId ? (
          <Link href={`/admin/leads/${p.leadId}`} className="link-accent text-xs">
            {p.leadReference ?? `#${p.leadId}`} · {p.leadStage}
          </Link>
        ) : (
          <span className="text-fg-faint">—</span>
        ),
    },
    { key: "saved", header: "Saved", className: "whitespace-nowrap text-xs text-fg-muted", render: (p) => shortDate(p.savedAt) },
  ];

  return (
    <section className="space-y-4">
      <nav aria-label="Views" className="flex flex-wrap items-center gap-1 border-b border-line text-sm">
        {TABS.map((t) => (
          <Link
            key={t.view}
            href={`/admin/prospects?view=${t.view}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            title={t.hint}
            aria-current={t.view === view ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 ${t.view === view ? "border-accent text-fg-heading" : "border-transparent text-fg-muted hover:text-fg-heading"}`}
          >
            {t.label} <span className="font-mono text-xs text-fg-faint">{counts[t.view]}</span>
          </Link>
        ))}
        <span className="flex-1" />
        <Button size="sm" variant="primary" onClick={auditNext} loading={busy} title="Enqueue audits for up to 20 prospects with a website and no audit in the last 90 days">
          Audit next 20
        </Button>
      </nav>

      <form method="get" action="/admin/prospects" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="view" value={view} />
        <label className="flex-1 text-sm text-fg-muted">
          <span className="mb-1.5 block">Search</span>
          <input name="q" defaultValue={q} placeholder="name, town, domain or PR- reference" className={inputClass} />
        </label>
        {view === "all" || view === "not_fit" ? (
          <>
            <label className="text-sm text-fg-muted">
              <span className="mb-1.5 block">Sort</span>
              <select name="sort" defaultValue={sort} className={inputClass}>
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-fg-muted">
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

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(p) => p.id}
        empty={
          view === "ready"
            ? "No prospect is ready to send: it takes a finished audit under the score threshold, a usable business email and a country with an email rule."
            : view === "call"
              ? "Nobody to call: the call list needs a phone number and no usable email."
              : "No prospects yet — run a search on the Find page or add one by URL."
        }
        caption={`Prospects — ${view}`}
      />
    </section>
  );
}
