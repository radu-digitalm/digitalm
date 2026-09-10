// DB-backed job queue and single-process runner (contract §3 jobs.ts).
// Started once from src/instrumentation.ts; ticks every 5 s and on kick;
// concurrency 1; claims with a single UPDATE so a second process (there is
// none today) could never double-run a row. Every timestamp is a SQL UTC string
// so comparisons happen inside SQLite.
//
// Timeouts: handlers must honour ctx.signal (contract §3, abort at 6 min), but
// the runner no longer depends on it — run() races the handler against the
// abort timer, so a handler stuck on a socket that ignores the signal still
// frees the single runner slot. Its late DB writes are no-ops because every
// status UPDATE is guarded by `WHERE id = ? AND claim_token = ?` and the
// timeout path clears the claim token.
import { randomBytes } from "node:crypto";
import { enquiriesDb } from "@/lib/enquiries";
import { parseJson } from "@/lib/crm/db";
import { sqlNow, toSql } from "@/lib/crm/time";
import { handlers } from "@/lib/crm/jobHandlers";
import type { Job, JobKind } from "@/lib/crm/types";

const TICK_MS = 5_000;
const HEARTBEAT_MS = 30_000;
const STALE_MS = 5 * 60_000;
const ABORT_MS = 6 * 60_000;
const RETRY_STEP_MS = 60_000;

type Row = {
  id: number;
  kind: JobKind;
  payload: string;
  dedupe_key: string | null;
  status: Job["status"];
  priority: number;
  run_after: string;
  attempts: number;
  max_attempts: number;
  claimed_at: string | null;
  claim_token: string | null;
  last_error: string | null;
  result: string | null;
  created_at: string;
  finished_at: string | null;
};

function rowToJob(r: Row): Job {
  return {
    id: r.id,
    kind: r.kind,
    payload: parseJson<Record<string, unknown>>(r.payload, {}),
    dedupeKey: r.dedupe_key,
    status: r.status,
    priority: r.priority,
    runAfter: r.run_after,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    claimedAt: r.claimed_at,
    claimToken: r.claim_token,
    lastError: r.last_error,
    result: parseJson<unknown>(r.result, null),
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  };
}

/**
 * A handler throws this to put its job back in the queue for a later time
 * without spending an attempt — the audit job uses it when the daily cap is
 * reached ("06:00 Europe/Paris next day with a visible note").
 */
export class RescheduleJob extends Error {
  runAfter: Date;
  note: string;
  constructor(runAfter: Date, note: string) {
    super(note);
    this.name = "RescheduleJob";
    this.runAfter = runAfter;
    this.note = note;
  }
}

function errorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.slice(0, 500);
}

function isUniqueError(e: unknown): boolean {
  return (e as { code?: string })?.code === "SQLITE_CONSTRAINT_UNIQUE";
}

// ---- queue API ---------------------------------------------------------------

export function enqueue(
  kind: JobKind,
  payload: Record<string, unknown> = {},
  opts: { priority?: number; runAfter?: Date; dedupeKey?: string; maxAttempts?: number } = {},
): { id: number; deduped: boolean } {
  const db = enquiriesDb();
  const dedupeKey = opts.dedupeKey ?? null;
  try {
    const r = db
      .prepare("INSERT INTO jobs (kind, payload, dedupe_key, priority, run_after, max_attempts) VALUES (?, ?, ?, ?, ?, ?)")
      .run(kind, JSON.stringify(payload), dedupeKey, opts.priority ?? 5, opts.runAfter ? toSql(opts.runAfter) : sqlNow(), opts.maxAttempts ?? 3);
    kickJobs();
    return { id: Number(r.lastInsertRowid), deduped: false };
  } catch (e) {
    if (dedupeKey && isUniqueError(e)) {
      const row = db
        .prepare("SELECT id FROM jobs WHERE kind = ? AND dedupe_key = ? AND status IN ('queued', 'running') LIMIT 1")
        .get(kind, dedupeKey) as { id: number } | undefined;
      if (row) return { id: row.id, deduped: true };
    }
    throw e;
  }
}

export function getJob(id: number): Job | null {
  const row = enquiriesDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Row | undefined;
  return row ? rowToJob(row) : null;
}

/** Number of queued jobs that would run before this one (0 = next), or null when not queued. */
export function queuePosition(id: number): number | null {
  const db = enquiriesDb();
  const me = db.prepare("SELECT priority, status FROM jobs WHERE id = ?").get(id) as { priority: number; status: string } | undefined;
  if (!me || me.status !== "queued") return null;
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued' AND (priority < ? OR (priority = ? AND id < ?))")
    .get(me.priority, me.priority, id) as { n: number };
  return row.n;
}

/** Failed or cancelled → queued again with a fresh attempt budget. */
export function requeueJob(id: number): boolean {
  const r = enquiriesDb()
    .prepare(
      "UPDATE jobs SET status = 'queued', run_after = ?, attempts = 0, claimed_at = NULL, claim_token = NULL, finished_at = NULL, last_error = NULL WHERE id = ? AND status IN ('failed', 'cancelled')",
    )
    .run(sqlNow(), id);
  if (r.changes === 1) kickJobs();
  return r.changes === 1;
}

export function cancelJob(id: number): boolean {
  const r = enquiriesDb()
    .prepare("UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ? AND status = 'queued'")
    .run(sqlNow(), id);
  return r.changes === 1;
}

export type JobSummary = Omit<Job, "payload" | "result" | "claimToken"> & { payload: Record<string, unknown> };

/** Counts by status plus the most recent rows — the GET /api/admin/jobs body. */
export function jobStatus(limit = 50): { counts: Record<Job["status"], number>; recent: JobSummary[]; runner: boolean } {
  const db = enquiriesDb();
  const counts: Record<Job["status"], number> = { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0 };
  for (const r of db.prepare("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status").all() as { status: Job["status"]; n: number }[]) {
    if (r.status in counts) counts[r.status] = r.n;
  }
  const recent = (db.prepare("SELECT * FROM jobs ORDER BY id DESC LIMIT ?").all(Math.min(Math.max(limit, 1), 200)) as Row[]).map((r) => {
    const { claimToken: _t, result: _r, ...rest } = rowToJob(r);
    return rest;
  });
  return { counts, recent, runner: !!state()?.started };
}

// ---- runner ------------------------------------------------------------------

type RunnerState = { started: boolean; busy: boolean; timer: NodeJS.Timeout | null };

// Kept on globalThis so a dev-server module reload never starts a second loop.
function state(): RunnerState | undefined {
  return (globalThis as { __dmJobRunner?: RunnerState }).__dmJobRunner;
}

/** Wake the runner now (after an enqueue); no-op when the runner is off. */
export function kickJobs(): void {
  const st = state();
  if (!st?.started || st.busy) return;
  setImmediate(() => void tick());
}

/** Idempotent. Re-queues every `running` row (a previous process died mid-job), then ticks. */
export function startJobRunner(): void {
  if (process.env.CRM_JOB_RUNNER === "off") return;
  if (state()?.started) return;
  const st: RunnerState = { started: true, busy: false, timer: null };
  (globalThis as { __dmJobRunner?: RunnerState }).__dmJobRunner = st;
  try {
    const db = enquiriesDb();
    const now = sqlNow();
    const requeued = db
      .prepare(
        "UPDATE jobs SET status = 'queued', claimed_at = NULL, claim_token = NULL, run_after = ?, last_error = 'interrupted' WHERE status = 'running' AND attempts < max_attempts",
      )
      .run(now).changes;
    const failed = db
      .prepare("UPDATE jobs SET status = 'failed', finished_at = ?, last_error = 'interrupted' WHERE status = 'running'")
      .run(now).changes;
    if (requeued || failed) console.log(`jobs: start — re-queued ${requeued}, failed ${failed} interrupted job(s)`);
  } catch (e) {
    console.error("jobs: start-up re-queue failed", errorMessage(e));
  }
  st.timer = setInterval(() => void tick(), TICK_MS);
  st.timer.unref();
  setImmediate(() => void tick());
}

function sweepStale(): void {
  const db = enquiriesDb();
  const cutoff = toSql(new Date(Date.now() - STALE_MS));
  const now = sqlNow();
  const requeued = db
    .prepare(
      "UPDATE jobs SET status = 'queued', claimed_at = NULL, claim_token = NULL, run_after = ?, last_error = 'stale' WHERE status = 'running' AND claimed_at < ? AND attempts < max_attempts",
    )
    .run(now, cutoff).changes;
  const failed = db
    .prepare("UPDATE jobs SET status = 'failed', finished_at = ?, last_error = 'stale' WHERE status = 'running' AND claimed_at < ?")
    .run(now, cutoff).changes;
  if (requeued || failed) console.warn(`jobs: stale sweep — re-queued ${requeued}, failed ${failed}`);
}

function claim(): Job | null {
  const db = enquiriesDb();
  const token = randomBytes(12).toString("base64url");
  const now = sqlNow();
  const r = db
    .prepare(
      "UPDATE jobs SET status = 'running', claimed_at = ?, claim_token = ?, attempts = attempts + 1 WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_after <= ? ORDER BY priority, id LIMIT 1)",
    )
    .run(now, token, now);
  if (r.changes !== 1) return null;
  const row = db.prepare("SELECT * FROM jobs WHERE claim_token = ? AND status = 'running'").get(token) as Row | undefined;
  return row ? rowToJob(row) : null;
}

async function run(job: Job): Promise<void> {
  const db = enquiriesDb();
  const ctl = new AbortController();
  const abortTimer = setTimeout(() => ctl.abort(new Error("job_timeout")), ABORT_MS);
  // Rejects when the abort fires; raced against the handler below so the abort
  // is a hard deadline even for a handler that never looks at `signal`.
  const timeout = new Promise<never>((_, reject) => {
    ctl.signal.addEventListener("abort", () => reject(ctl.signal.reason instanceof Error ? ctl.signal.reason : new Error("job_timeout")), { once: true });
  });
  const heartbeat = () => {
    db.prepare("UPDATE jobs SET claimed_at = ? WHERE id = ? AND claim_token = ?").run(sqlNow(), job.id, job.claimToken);
  };
  const hbTimer = setInterval(heartbeat, HEARTBEAT_MS);
  hbTimer.unref();
  const log = (m: string) => console.log(`[job ${job.id} ${job.kind}] ${m}`);
  try {
    const handler = handlers[job.kind];
    if (!handler) throw new Error(`no_handler:${job.kind}`);
    // On timeout the handler's promise is abandoned (Promise.race keeps its
    // rejection handled) and "job_timeout" takes the retry/failed path below.
    const result = await Promise.race([handler(job, { heartbeat, signal: ctl.signal, log }), timeout]);
    db.prepare("UPDATE jobs SET status = 'done', result = ?, finished_at = ?, last_error = NULL WHERE id = ? AND claim_token = ?").run(
      result === undefined ? null : JSON.stringify(result),
      sqlNow(),
      job.id,
      job.claimToken,
    );
  } catch (e) {
    if (e instanceof RescheduleJob) {
      db.prepare(
        "UPDATE jobs SET status = 'queued', run_after = ?, attempts = MAX(attempts - 1, 0), claimed_at = NULL, claim_token = NULL, last_error = ? WHERE id = ? AND claim_token = ?",
      ).run(toSql(e.runAfter), e.note.slice(0, 500), job.id, job.claimToken);
      log(`rescheduled to ${toSql(e.runAfter)}: ${e.note}`);
      return;
    }
    const msg = errorMessage(e);
    if (job.attempts < job.maxAttempts) {
      const retryAt = toSql(new Date(Date.now() + RETRY_STEP_MS * job.attempts));
      db.prepare("UPDATE jobs SET status = 'queued', run_after = ?, claimed_at = NULL, claim_token = NULL, last_error = ? WHERE id = ? AND claim_token = ?").run(
        retryAt,
        msg,
        job.id,
        job.claimToken,
      );
      log(`attempt ${job.attempts}/${job.maxAttempts} failed, retry at ${retryAt}: ${msg}`);
    } else {
      db.prepare("UPDATE jobs SET status = 'failed', finished_at = ?, claimed_at = NULL, claim_token = NULL, last_error = ? WHERE id = ? AND claim_token = ?").run(
        sqlNow(),
        msg,
        job.id,
        job.claimToken,
      );
      log(`failed after ${job.attempts} attempt(s): ${msg}`);
    }
  } finally {
    clearTimeout(abortTimer);
    clearInterval(hbTimer);
  }
}

async function tick(): Promise<void> {
  const st = state();
  if (!st?.started || st.busy) return;
  st.busy = true;
  try {
    sweepStale();
    for (;;) {
      const job = claim();
      if (!job) break;
      await run(job);
    }
  } catch (e) {
    console.error("jobs: tick failed", errorMessage(e));
  } finally {
    st.busy = false;
  }
}
