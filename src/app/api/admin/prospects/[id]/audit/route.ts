import { NextRequest, NextResponse } from "next/server";
import { guardAdminPost, isResponse, requireAdminApi } from "@/lib/crm/auth";
import { enqueue, queuePosition } from "@/lib/crm/jobs";
import { parseJson } from "@/lib/crm/db";
import { enquiriesDb } from "@/lib/enquiries";
import { auditUsageToday } from "@/lib/audit/job";
import type { Audit, AuditChecks, CheckKey, FitSuggestion, Flag, PsiSummary } from "@/lib/crm/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

type ProspectRow = {
  id: number;
  reference: string;
  name: string;
  website: string | null;
  google_listing: "unverified" | "found" | "not_found";
  personal_wiped_at: string | null;
  forbids_extraction: number;
  latest_audit_id: number | null;
};

type AuditRow = {
  id: number;
  reference: string;
  prospect_id: number;
  status: Audit["status"];
  locale: "fr" | "en";
  website: string | null;
  checks: string | null;
  score: number | null;
  grade: Audit["grade"];
  flags: string;
  fits: string;
  top: string;
  pagespeed: string | null;
  crawl: string;
  report_token: string;
  report_expires_at: string | null;
  report_first_viewed_at: string | null;
  report_views: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

type JobRow = { id: number; status: string; run_after: string; attempts: number; max_attempts: number; last_error: string | null; created_at: string };

export type AuditPanelState = {
  ok: true;
  prospect: { id: number; reference: string; name: string; website: string | null; googleListing: ProspectRow["google_listing"]; personalWipedAt: string | null; forbidsExtraction: boolean };
  audit: Audit | null;
  history: { id: number; reference: string; status: Audit["status"]; score: number | null; grade: Audit["grade"]; finishedAt: string | null; createdAt: string }[];
  job: { id: number; status: string; position: number | null; runAfter: string; attempts: number; maxAttempts: number; lastError: string | null; createdAt: string } | null;
  usage: { used: number; cap: number };
  reportPath: string | null;
};

function parseId(raw: string): number | null {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 && String(id) === raw ? id : null;
}

function rowToAudit(r: AuditRow): Audit {
  return {
    id: r.id,
    reference: r.reference,
    prospectId: r.prospect_id,
    status: r.status,
    locale: r.locale,
    website: r.website,
    checks: parseJson<AuditChecks | null>(r.checks, null),
    score: r.score,
    grade: r.grade,
    flags: parseJson<Flag[]>(r.flags, []),
    fits: parseJson<FitSuggestion[]>(r.fits, []),
    top: parseJson<CheckKey[]>(r.top, []),
    pagespeed: parseJson<PsiSummary | null>(r.pagespeed, null),
    crawl: parseJson<Audit["crawl"]>(r.crawl, []),
    reportToken: r.report_token,
    reportExpiresAt: r.report_expires_at,
    reportFirstViewedAt: r.report_first_viewed_at,
    reportViews: r.report_views,
    error: r.error,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    createdAt: r.created_at,
  };
}

function loadProspect(id: number): ProspectRow | undefined {
  return enquiriesDb()
    .prepare("SELECT id, reference, name, website, google_listing, personal_wiped_at, forbids_extraction, latest_audit_id FROM prospects WHERE id = ? AND deleted_at IS NULL")
    .get(id) as ProspectRow | undefined;
}

function pendingJob(prospectId: number): AuditPanelState["job"] {
  const row = enquiriesDb()
    .prepare("SELECT id, status, run_after, attempts, max_attempts, last_error, created_at FROM jobs WHERE kind = 'audit' AND dedupe_key = ? AND status IN ('queued', 'running') ORDER BY id DESC LIMIT 1")
    .get(`audit:${prospectId}`) as JobRow | undefined;
  if (!row) return null;
  return { id: row.id, status: row.status, position: queuePosition(row.id), runAfter: row.run_after, attempts: row.attempts, maxAttempts: row.max_attempts, lastError: row.last_error, createdAt: row.created_at };
}

/** AuditBlock state: the most recent audit (any status), the last five, the pending job, today's usage. */
export async function GET(req: NextRequest, { params }: Params) {
  const guard = await requireAdminApi(req);
  if (isResponse(guard)) return guard;
  const { id: raw } = await params;
  const id = parseId(raw);
  if (id === null) return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  const prospect = loadProspect(id);
  if (!prospect) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const db = enquiriesDb();
  const latest = db.prepare("SELECT * FROM audits WHERE prospect_id = ? ORDER BY id DESC LIMIT 1").get(id) as AuditRow | undefined;
  const history = (
    db.prepare("SELECT id, reference, status, score, grade, finished_at, created_at FROM audits WHERE prospect_id = ? ORDER BY id DESC LIMIT 5").all(id) as Pick<
      AuditRow,
      "id" | "reference" | "status" | "score" | "grade" | "finished_at" | "created_at"
    >[]
  ).map((r) => ({ id: r.id, reference: r.reference, status: r.status, score: r.score, grade: r.grade, finishedAt: r.finished_at, createdAt: r.created_at }));
  const body: AuditPanelState = {
    ok: true,
    prospect: {
      id: prospect.id,
      reference: prospect.reference,
      name: prospect.name,
      website: prospect.website,
      googleListing: prospect.google_listing,
      personalWipedAt: prospect.personal_wiped_at,
      forbidsExtraction: prospect.forbids_extraction === 1,
    },
    audit: latest ? rowToAudit(latest) : null,
    history,
    job: pendingJob(id),
    usage: auditUsageToday(),
    reportPath: latest && latest.status === "done" ? `/r/${latest.report_token}` : null,
  };
  return NextResponse.json(body);
}

/** Enqueue one audit for the prospect, deduped on "audit:{id}" while queued or running. */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await guardAdminPost(req);
  if (isResponse(guard)) return guard;
  const { id: raw } = await params;
  const id = parseId(raw);
  if (id === null) return NextResponse.json({ ok: false, error: "bad_id" }, { status: 400 });
  if (!loadProspect(id)) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const { id: jobId, deduped } = enqueue("audit", { prospectId: id }, { dedupeKey: `audit:${id}` });
  return NextResponse.json({ ok: true, jobId, deduped, position: queuePosition(jobId) });
}
