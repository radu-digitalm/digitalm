// The audit job (contract §7.3), registered under "audit" in crm/jobHandlers.ts.
// Daily cap (AUDIT_DAILY_CAP, re-scheduled to 06:00 Europe/Paris with a note),
// one `audits` row per run, crawl ∥ PageSpeed, the ten checks, the pure score,
// then the prospect's website_* / forbids_extraction / latest_* columns and an
// `audit_done` activity. Nothing crawled is stored as HTML; `audits.crawl`
// keeps {url, status, bytes} only. A refused target (SsrfError) fails the audit
// with an "ssrf:…" error and does NOT retry; unexpected errors fail the audit
// row and rethrow so the runner retries — the retry re-opens the same audits
// row, so one job costs one row and one cap unit however many attempts it
// takes. Rows left 'running' by a timeout or a crash are failed as
// "interrupted" by sweepStaleAudits() (every job start, every panel GET).
import { randomBytes } from "node:crypto";
import { enquiriesDb } from "@/lib/enquiries";
import { newReference } from "@/lib/crm/refs";
import { RescheduleJob } from "@/lib/crm/jobs";
import { intEnv, nextParisTime, sqlNow } from "@/lib/crm/time";
import { apiUsage, countApiUsage } from "@/lib/crm/apiUsage";
import { classifyEmail, coerceHttpUrl, domainOf, normaliseName } from "@/lib/crm/classify";
import { googleCheckDailyCap, googlePlacesOn } from "@/lib/discover/google";
import { googleCheck, type CheckProspect, type GoogleCheckOutcome } from "@/lib/discover/googleCheck";
import { notifyTelegram } from "@/lib/notify";
import { addActivity } from "@/lib/inbox/leads";
import type { AuditChecks, Job, PsiSummary, Score } from "@/lib/crm/types";
import { fetchSite } from "@/lib/audit/crawler";
import type { SiteCrawl } from "@/lib/audit/crawler";
import { SsrfError, parseTarget } from "@/lib/audit/ssrf";
import { extractSite } from "@/lib/audit/extract";
import type { Extraction } from "@/lib/audit/extract";
import { googleListing, runChecks } from "@/lib/audit/checks";
import { auditScore, noSiteChecks } from "@/lib/audit/score";
import { runPagespeed, timedOutSummary } from "@/lib/audit/pagespeed";

type JobCtx = { heartbeat(): void; signal: AbortSignal; log(m: string): void };

export type AuditJobResult =
  | { ok: true; auditId: number; reference: string; score: number; grade: "A" | "B" | "C"; flags: string[] }
  | { ok: false; auditId: number | null; reference: string | null; error: string };

type ProspectRow = {
  id: number;
  reference: string;
  name: string;
  trade_key: string | null;
  country: string;
  city: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  website: string | null;
  locale: "fr" | "en";
  sole_trader: number | null;
  domain_key: string | null;
  google_place_id: string | null;
  google_listing: "unverified" | "found" | "not_found";
  google_match: "auto" | "manual" | null;
  google_checked_at: string | null;
  personal_wiped_at: string | null;
  deleted_at: string | null;
  lead_id: number | null;
};

const PROSPECT_COLUMNS = "id, reference, name, trade_key, country, city, postcode, lat, lng, website, locale, sole_trader, domain_key, google_place_id, google_listing, google_match, google_checked_at, personal_wiped_at, deleted_at, lead_id";

/** AUDIT_DAILY_CAP (default 50). */
export function auditDailyCap(): number {
  return intEnv("AUDIT_DAILY_CAP", 50);
}

/** Today's count against the cap — the AuditBlock shows it. */
export function auditUsageToday(): { used: number; cap: number } {
  return { used: apiUsage("audit"), cap: auditDailyCap() };
}

/** Google-only audits (a prospect without a website, finder-google §4.5) draw on their own daily allowance. */
export function googleCheckUsageToday(): { used: number; cap: number } {
  return { used: apiUsage("google_check_day"), cap: googleCheckDailyCap() };
}

/**
 * The name a site gives itself (finder-google §4.5, decision D3): the JSON-LD
 * business name, else the <title> cut at the first " | ", " – " or " - ";
 * trimmed, ≤ 120 chars; null when neither is usable.
 */
export function siteName(x: Pick<Extraction, "title" | "jsonLd">): string | null {
  const ld = (x.jsonLd.name ?? "").trim();
  if (ld) return ld.slice(0, 120);
  const title = (x.title ?? "").split(/\s+[|–-]\s+/)[0]!.trim();
  return title ? title.slice(0, 120) : null;
}

/** The check's view of the prospect row. */
function checkProspectOf(p: ProspectRow): CheckProspect {
  return {
    id: p.id,
    name: p.name,
    tradeKey: p.trade_key,
    country: p.country,
    city: p.city,
    postcode: p.postcode,
    lat: p.lat,
    lng: p.lng,
    googlePlaceId: p.google_place_id,
    googleListing: p.google_listing,
    googleMatch: p.google_match,
    googleCheckedAt: p.google_checked_at,
  };
}

/** The Google-listing check of an audit — never fails the job (a failed request leaves the check unmeasured with a reason). */
async function googleForAudit(p: ProspectRow, ctx: JobCtx): Promise<GoogleCheckOutcome["google"]> {
  try {
    const out = await googleCheck(checkProspectOf(p), { signal: ctx.signal, retry: false });
    if (out.requested) ctx.log(`google listing: ${out.decision}${out.error ? ` (${out.error})` : ""}`);
    return out.google;
  } catch (e) {
    ctx.log(`google listing: skipped (${e instanceof Error ? e.message.slice(0, 60) : "error"})`);
    return { status: p.google_listing, signals: null, reason: "unavailable" };
  }
}

export function newReportToken(): string {
  return randomBytes(32).toString("base64url");
}

/** A 'running' audit older than this has lost its job (timeout, crash) and is failed as interrupted. */
export const AUDIT_STALE_MINUTES = 10;

/**
 * Fail every 'running' audit whose start is older than AUDIT_STALE_MINUTES
 * (the runner abandons a timed-out handler; a crash re-queues the job but
 * never touched the row). Called at every job start and by the panel GET, so
 * the AuditBlock never shows "Running" for a row nobody is working on.
 */
export function sweepStaleAudits(): number {
  return enquiriesDb()
    .prepare(`UPDATE audits SET status = 'failed', error = 'interrupted', finished_at = ? WHERE status = 'running' AND (started_at IS NULL OR started_at < datetime('now', '-${AUDIT_STALE_MINUTES} minutes'))`)
    .run(sqlNow()).changes;
}

function failAudit(auditId: number, auditRef: string, prospectRef: string, error: string, log: (m: string) => void): AuditJobResult {
  const msg = error.slice(0, 300);
  enquiriesDb().prepare("UPDATE audits SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(msg, sqlNow(), auditId);
  log(`${auditRef} failed: ${msg}`);
  notifyTelegram(`Audit failed ${auditRef} (${prospectRef}): ${msg.slice(0, 80)}`);
  return { ok: false, auditId, reference: auditRef, error: msg };
}

/** Column writes for the prospect from the extraction (allow-listed names, parameterised values). */
function prospectUpdates(p: ProspectRow, website: string, x: Extraction, site: SiteCrawl): [string, string | number | null][] {
  const sets: [string, string | number | null][] = [];
  const wiped = p.personal_wiped_at !== null;
  if (x.forbidsExtraction) {
    // The site's stated opposition covers every contact detail taken from it
    // (CNIL "moissonnage" guidance): email AND phone are left empty / cleared.
    sets.push(["forbids_extraction", 1], ["website_email", null], ["website_email_kind", null], ["website_email_page", null], ["website_phone", null]);
  } else {
    // A fetched legal page that carries no clause clears an older flag; an unfetched one leaves it alone.
    if (site.legal) sets.push(["forbids_extraction", 0]);
    if (!wiped && x.email) {
      const kind = classifyEmail(x.email, { domainKey: p.domain_key ?? domainOf(website), soleTrader: p.sole_trader === null ? null : p.sole_trader === 1 });
      sets.push(["website_email", x.email], ["website_email_kind", kind], ["website_email_page", x.emailPage]);
    }
    if (!wiped && x.phone) sets.push(["website_phone", x.phone]);
  }
  if (Object.keys(x.socials).length > 0) sets.push(["website_socials", JSON.stringify(x.socials)]);
  if (x.cms) sets.push(["website_cms", x.cms.slice(0, 60)]);
  return sets;
}

export async function runAuditJob(job: Job, ctx: JobCtx): Promise<AuditJobResult> {
  const prospectId = Number(job.payload.prospectId);
  if (!Number.isInteger(prospectId) || prospectId <= 0) throw new Error("bad_payload: prospectId");

  const db = enquiriesDb();
  const stale = sweepStaleAudits();
  if (stale) ctx.log(`${stale} stale running audit(s) marked failed`);
  const prospect = db.prepare(`SELECT ${PROSPECT_COLUMNS} FROM prospects WHERE id = ?`).get(prospectId) as ProspectRow | undefined;
  if (!prospect || prospect.deleted_at) {
    ctx.log(`prospect ${prospectId} missing or deleted — nothing to audit`);
    return { ok: false, auditId: null, reference: null, error: "prospect_missing" };
  }

  const website = prospect.website ? coerceHttpUrl(prospect.website) : null;
  // A prospect without a website gets the Google-listing check only (finder-google §4.5): its own daily allowance, its own counter.
  const googleOnly = !website && googlePlacesOn();
  const capProvider = googleOnly ? "google_check_day" : "audit";
  const { used, cap } = googleOnly ? googleCheckUsageToday() : auditUsageToday();
  if (used >= cap) {
    throw new RescheduleJob(nextParisTime(6, 0), `Daily ${googleOnly ? "Google check" : "audit"} cap reached (${used}/${cap}) — rescheduled to 06:00 Europe/Paris`);
  }
  // One audits row and one cap unit per JOB: a retry re-opens the row its
  // earlier attempt left 'running' or 'failed' instead of inserting another.
  const previous =
    job.attempts > 1
      ? (db
          .prepare("SELECT id, reference FROM audits WHERE prospect_id = ? AND status IN ('running', 'failed') AND created_at >= ? ORDER BY id DESC LIMIT 1")
          .get(prospectId, job.createdAt) as { id: number; reference: string } | undefined)
      : undefined;
  let auditId: number;
  let reference: string;
  if (previous) {
    auditId = previous.id;
    reference = previous.reference;
    db.prepare(
      "UPDATE audits SET status = 'running', error = NULL, started_at = ?, finished_at = NULL, checks = NULL, score = NULL, grade = NULL, flags = '[]', fits = '[]', top = '[]', pagespeed = NULL, crawl = '[]', website = ?, locale = ? WHERE id = ?",
    ).run(sqlNow(), website, prospect.locale === "fr" ? "fr" : "en", auditId);
    ctx.log(`${reference} re-opened for attempt ${job.attempts}`);
  } else {
    countApiUsage(capProvider);
    reference = newReference("AU");
    auditId = Number(
      db
        .prepare("INSERT INTO audits (reference, prospect_id, status, locale, website, report_token, started_at) VALUES (?, ?, 'running', ?, ?, ?, ?)")
        .run(reference, prospectId, prospect.locale === "fr" ? "fr" : "en", website, newReportToken(), sqlNow()).lastInsertRowid,
    );
  }
  // Any other 'running' row of this prospect belongs to no job (concurrency is 1).
  db.prepare("UPDATE audits SET status = 'failed', error = 'interrupted', finished_at = ? WHERE prospect_id = ? AND status = 'running' AND id <> ?").run(sqlNow(), prospectId, auditId);
  ctx.log(`${reference} for ${prospect.reference}${website ? ` (${domainOf(website) ?? "site"})` : " (no website)"}`);

  try {
    let checks: AuditChecks;
    let score: Score;
    let site: SiteCrawl | null = null;
    let psi: PsiSummary | null = null;
    let extraction: Extraction | null = null;

    const sets: [string, string | number | null][] = [];
    if (!website) {
      checks = noSiteChecks({ error: prospect.website ? "invalid_url" : "no_website" });
      checks.google_listing = googleListing(await googleForAudit(prospect, ctx));
      score = auditScore(checks);
    } else {
      // Static refusals (scheme / port / local names) before any socket or PSI call.
      try {
        parseTarget(website);
      } catch (e) {
        if (e instanceof SsrfError) return failAudit(auditId, reference, prospect.reference, e.message, ctx.log);
        throw e;
      }
      const local = new AbortController();
      const signal = AbortSignal.any([ctx.signal, local.signal]);
      const [siteResult, psiResult] = await Promise.allSettled([
        fetchSite(website, { signal, log: ctx.log }).catch((e: unknown) => {
          // A refused hop: stop waiting for PageSpeed too.
          if (e instanceof SsrfError) local.abort();
          throw e;
        }),
        runPagespeed(website, { signal, log: ctx.log }),
      ]);
      ctx.heartbeat();
      if (siteResult.status === "rejected") {
        const e = siteResult.reason;
        if (e instanceof SsrfError) return failAudit(auditId, reference, prospect.reference, e.message, ctx.log);
        throw e;
      }
      site = siteResult.value;
      psi = psiResult.status === "fulfilled" ? psiResult.value : timedOutSummary();
      extraction = extractSite(site.pages);
      const google = await googleForAudit(prospect, ctx);
      ctx.heartbeat();
      checks = runChecks({ site, psi, extraction, google });
      score = auditScore(checks, { ecommerce: extraction.ecommerce, forbidsExtraction: extraction.forbidsExtraction });
      // Add by URL stores the domain as the name until the site says what it is called; a name Radu typed is never touched.
      if (prospect.domain_key && prospect.name === prospect.domain_key && site.home && site.home.text.length > 0) {
        const name = siteName(extraction);
        if (name && name !== prospect.name) sets.push(["name", name], ["name_key", normaliseName(name)]);
      }
    }

    const now = sqlNow();
    const finish = db.transaction(() => {
      db.prepare(
        "UPDATE audits SET status = 'done', checks = ?, score = ?, grade = ?, flags = ?, fits = ?, top = ?, pagespeed = ?, crawl = ?, error = NULL, finished_at = ? WHERE id = ?",
      ).run(
        JSON.stringify(checks),
        score.score,
        score.grade,
        JSON.stringify(score.flags),
        JSON.stringify(score.fits),
        JSON.stringify(score.top),
        psi ? JSON.stringify(psi) : null,
        JSON.stringify(site?.crawl ?? []),
        now,
        auditId,
      );
      sets.push(["latest_audit_id", auditId], ["latest_score", score.score], ["latest_grade", score.grade], ["updated_at", now]);
      if (site && extraction && website) sets.push(...prospectUpdates(prospect, website, extraction, site));
      db.prepare(`UPDATE prospects SET ${sets.map(([col]) => `${col} = ?`).join(", ")} WHERE id = ?`).run(...sets.map(([, v]) => v), prospectId);
      // inbox's writer: resolves the lead, bumps last_activity_at.
      addActivity({
        leadId: prospect.lead_id,
        prospectId,
        kind: "audit_done",
        channel: "system",
        summary: website ? `Audit ${reference} done — score ${score.score} (${score.grade})` : `Audit ${reference} done — no website`,
        payload: { auditId, reference, score: score.score, grade: score.grade, flags: score.flags },
        actor: "system",
        createdAt: now,
      });
    });
    finish();
    ctx.log(`${reference} done: ${score.score} (${score.grade}) flags ${score.flags.join(",") || "—"}`);
    return { ok: true, auditId, reference, score: score.score, grade: score.grade, flags: score.flags };
  } catch (e) {
    failAudit(auditId, reference, prospect.reference, e instanceof Error ? e.message : String(e), ctx.log);
    throw e;
  }
}
