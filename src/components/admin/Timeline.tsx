// Activity timeline for a lead (newest first). Presentational only — no hooks,
// no client directive — so both server pages and the client LeadDetail can
// render it. Summaries and payload scalars are React text nodes; ipHash is
// never shown.
import type { Activity, ActivityKind } from "@/lib/crm/types";
import { fmtDateTime } from "@/lib/inbox/stages";
import { Badge, type BadgeVariant } from "./Badge";

const KIND: Record<ActivityKind, { label: string; variant: BadgeVariant }> = {
  note: { label: "Note", variant: "neutral" },
  email_out: { label: "Email sent", variant: "info" },
  email_in: { label: "Reply", variant: "good" },
  call: { label: "Call", variant: "info" },
  report_view: { label: "Report opened", variant: "good" },
  optout: { label: "Opt-out", variant: "bad" },
  stage_change: { label: "Stage", variant: "neutral" },
  lead_created: { label: "Created", variant: "neutral" },
  merged: { label: "Merged", variant: "neutral" },
  send_refused: { label: "Send refused", variant: "warn" },
  audit_done: { label: "Audit", variant: "info" },
  notice_sent: { label: "Notice sent", variant: "info" },
  manual_send: { label: "Sent by hand", variant: "info" },
  bounce: { label: "Bounce", variant: "warn" },
  recollect: { label: "Recollected", variant: "neutral" },
};

const ACTOR: Record<Activity["actor"], string> = { admin: "you", system: "system", prospect: "them" };

function payloadLines(payload: Record<string, unknown> | null): string[] {
  if (!payload) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (k === "ipHash" || v === null || v === undefined || v === "") continue;
    if (typeof v === "object") continue;
    out.push(`${k}: ${String(v)}`);
  }
  return out;
}

export function Timeline({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) {
    return <p className="text-sm text-fg-muted">No activity yet.</p>;
  }
  return (
    <ol className="space-y-3">
      {activities.map((a) => {
        const meta = KIND[a.kind] ?? { label: a.kind, variant: "neutral" as BadgeVariant };
        const lines = payloadLines(a.payload);
        return (
          <li key={a.id} className="flex gap-3 border-b border-line/60 pb-3 last:border-0">
            <div className="w-36 shrink-0 text-xs text-fg-faint">
              <div>{fmtDateTime(a.createdAt)}</div>
              <div>{ACTOR[a.actor] ?? a.actor}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={meta.variant}>{meta.label}</Badge>
                {a.channel && a.channel !== "system" ? <span className="text-xs text-fg-faint">{a.channel}</span> : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">{a.summary}</p>
              {lines.length > 0 ? <p className="mt-0.5 text-xs text-fg-faint">{lines.join(" · ")}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
