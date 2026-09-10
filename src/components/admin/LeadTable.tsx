// /admin/leads: filter bar (plain GET form — no JS needed) and the table.
// Server component; the per-row StageSelect is the only client island.
import Link from "next/link";
import type { Lead } from "@/lib/crm/types";
import { KIND_LABELS, LEAD_KINDS, LEAD_STAGES, STAGE_LABELS, daysUntil, fmtDate, fmtDateTime, isClosedStage, leadTitle } from "@/lib/inbox/stages";
import { LEAD_SORTS, type LeadListQuery } from "@/lib/inbox/leads";
import { Badge } from "./Badge";
import { buttonClass } from "./Button";
import { DataTable, type Column } from "./DataTable";
import { inputClass, labelClass } from "./Field";
import { StageSelect } from "./StageSelect";

export type LeadTableQuery = Required<Pick<LeadListQuery, "stage" | "sort" | "dir">> & { kind: string; q: string; page: number };

const SORT_LABELS: Record<keyof typeof LEAD_SORTS, string> = {
  activity: "Last activity",
  created: "Created",
  next: "Next action",
  stage: "Stage",
  name: "Name",
};

function queryString(q: LeadTableQuery, over: Partial<LeadTableQuery>): string {
  const merged = { ...q, ...over };
  const p = new URLSearchParams();
  if (merged.stage !== "open") p.set("stage", merged.stage);
  if (merged.kind) p.set("kind", merged.kind);
  if (merged.q) p.set("q", merged.q);
  if (merged.sort !== "activity") p.set("sort", merged.sort);
  if (merged.dir !== "desc") p.set("dir", merged.dir);
  if (merged.page > 1) p.set("page", String(merged.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

function NextAction({ lead, today }: { lead: Lead; today: string }) {
  if (!lead.nextActionAt) return <span className="text-fg-faint">—</span>;
  const days = daysUntil(lead.nextActionAt, today);
  const closed = isClosedStage(lead.stage);
  const tone = closed ? "text-fg-faint" : days < 0 ? "text-accent-soft" : days === 0 ? "text-amber-300" : "text-fg-muted";
  return (
    <span className={tone}>
      {fmtDate(lead.nextActionAt)}
      {lead.nextAction ? <span className="block truncate text-xs text-fg-faint" title={lead.nextAction}>{lead.nextAction}</span> : null}
    </span>
  );
}

export function LeadTable({
  rows,
  total,
  query,
  today,
  pageSize,
  stageCounts,
}: {
  rows: Lead[];
  total: number;
  query: LeadTableQuery;
  today: string;
  pageSize: number;
  stageCounts: Record<string, number>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const openCount = LEAD_STAGES.filter((s) => !isClosedStage(s)).reduce((n, s) => n + (stageCounts[s] ?? 0), 0);
  const allCount = Object.values(stageCounts).reduce((n, v) => n + v, 0);

  const columns: Column<Lead>[] = [
    {
      key: "reference",
      header: "Lead",
      render: (l) => (
        <div className="min-w-0">
          <Link href={`/admin/leads/${l.id}`} className="font-medium text-fg-heading hover:underline">
            {leadTitle(l)}
          </Link>
          <div className="font-mono text-xs text-fg-faint">{l.reference}</div>
        </div>
      ),
    },
    {
      key: "kind",
      header: "Kind",
      render: (l) => <Badge variant={l.kind === "outreach" ? "info" : "neutral"}>{KIND_LABELS[l.kind]}</Badge>,
    },
    {
      key: "stage",
      header: "Stage",
      render: (l) => <StageSelect leadId={l.id} stage={l.stage} />,
    },
    {
      key: "source",
      header: "Source",
      render: (l) => <span className="text-fg-muted">{l.sourceLabel ?? "Direct"}</span>,
      className: "max-w-[14rem] truncate",
    },
    {
      key: "next",
      header: "Next action",
      render: (l) => <NextAction lead={l} today={today} />,
    },
    {
      key: "activity",
      header: "Last activity",
      render: (l) => <span className="whitespace-nowrap text-fg-muted">{fmtDateTime(l.lastActivityAt)}</span>,
    },
    {
      key: "created",
      header: "Created",
      render: (l) => <span className="whitespace-nowrap text-fg-muted">{fmtDate(l.createdAt)}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <form method="get" action="/admin/leads" className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label htmlFor="stage" className={labelClass}>
            Stage
          </label>
          <select id="stage" name="stage" defaultValue={query.stage} className={`${inputClass} w-auto`}>
            <option value="open">Open ({openCount})</option>
            <option value="all">All ({allCount})</option>
            {LEAD_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]} ({stageCounts[s] ?? 0})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="kind" className={labelClass}>
            Kind
          </label>
          <select id="kind" name="kind" defaultValue={query.kind} className={`${inputClass} w-auto`}>
            <option value="">Any</option>
            {LEAD_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sort" className={labelClass}>
            Sort
          </label>
          <select id="sort" name="sort" defaultValue={query.sort} className={`${inputClass} w-auto`}>
            {Object.keys(LEAD_SORTS).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="dir" className={labelClass}>
            Order
          </label>
          <select id="dir" name="dir" defaultValue={query.dir} className={`${inputClass} w-auto`}>
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </div>
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="q" className={labelClass}>
            Search
          </label>
          <input id="q" name="q" type="search" defaultValue={query.q} placeholder="Name, company, email, phone, reference" className={inputClass} maxLength={100} />
        </div>
        <button type="submit" className={buttonClass("ghost", "md")}>
          Filter
        </button>
      </form>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(l) => l.id}
        caption="Leads"
        empty="No leads match these filters."
        rowClassName={(l) => (isClosedStage(l.stage) ? "opacity-70" : undefined)}
      />

      <div className="flex items-center justify-between text-sm text-fg-muted">
        <span>
          {total} {total === 1 ? "lead" : "leads"} · page {query.page} of {pages}
        </span>
        <div className="flex gap-2">
          {query.page > 1 ? (
            <Link href={`/admin/leads${queryString(query, { page: query.page - 1 })}`} className={buttonClass("ghost", "sm")}>
              Previous
            </Link>
          ) : null}
          {query.page < pages ? (
            <Link href={`/admin/leads${queryString(query, { page: query.page + 1 })}`} className={buttonClass("ghost", "sm")}>
              Next
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
