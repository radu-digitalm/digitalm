// The audit job (contract §7.3), registered under "audit" in crm/jobHandlers.ts.
// Daily cap (AUDIT_DAILY_CAP, re-scheduled to 06:00 Europe/Paris with a note),
// one `audits` row per run, crawl ∥ PageSpeed, the ten checks, the pure score,
// then the prospect's website_* / forbids_extraction / latest_* columns and an
// `audit_done` activity. Nothing crawled is stored as HTML; `audits.crawl`
// keeps {url, status, bytes} only. A refused target (SsrfError) fails the audit
// with an "ssrf:…" error and does NOT retry; unexpected errors fail the audit
// row and rethrow so the runner retries.
import { randomBytes } from "node:crypto";
import { enquiriesDb } from "@/lib/enquiries";
import { newReference } from "@/lib/crm/refs";
import { RescheduleJob } from "@/lib/crm/jobs";
import { nextParisTime, sqlNow } from "@/lib/crm/db";
import { apiUsage, countApiUsage } from "@/lib/crm/apiUsage";
import { classifyEmail, coerceHttpUrl, domainOf } from "@/lib/crm/classify";
import { notifyTelegram } from "@/lib/notify";
import type { AuditChecks, Job, PsiSummary, Score } from "@/lib/crm/types";
import { fetchSite } from "@/lib/audit/crawler";
import type { SiteCrawl } from "@/lib/audit/crawler";
import { SsrfError, parseTarget } from "@/lib/audit/ssrf";
import { extractSite } from "@/lib/audit/extract";
import type { Extraction } from "@/lib/audit/extract";
import { runChecks } from "@/lib/audit/checks";
import { auditScore, noSiteChecks } from "@/lib/audit/score";
import { runPagespeed, timedOutSummary } from "@/lib/audit/pagespeed";

type JobCtx = { heartbeat(): void; signal: AbortSignal; log(m: string): void };

export type AuditJobResult =
  | { ok: true; auditId: number; reference: string; score: number; grade: "A" | "B" | "C"; flags: string[] }
  | { ok: false; auditId: number | null; reference: string | null; error: string };

type ProspectRow = {
  id: number;
  reference: string;
  website: string | null;
  locale: "fr" | "en";
  sole_trader: number | null;
  domain_key: string | null;
  google_listing: "unverified" | "found" | "not_found";
  personal_wiped_at: string | null;
  deleted_at: string | null;
  lead_id: number | null;
};

/** AUDIT_DAILY_CAP (default 50). */
export function auditDailyCap(): number {
  const n = Number.parseInt(process.env.AUDIT_DAILY_CAP ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : 50;
}

/** Today's count against the cap — the AuditBlock shows it. */
export function auditUsageToday(): { used: number; cap: number } {
  return { used: apiUsage("audit"), cap: auditDailyCap() };
}

export function newReportToken(): string {
  return randomBytes(32).toString("base64url");
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

  const { used, cap } = auditUsageToday();
  if (used >= cap) {
    throw new RescheduleJob(nextParisTime(6, 0), `Daily audit cap reached (${used}/${cap}) — rescheduled to 06:00 Europe/Paris`);
  }

  const db = enquiriesDb();
  const prospect = db
    .prepare("SELECT id, reference, website, locale, sole_trader, domain_key, google_listing, personal_wiped_at, deleted_at, lead_id FROM prospects WHERE id = ?")
    .get(prospectId) as ProspectRow | undefined;
  if (!prospect || prospect.deleted_at) {
    ctx.log(`prospect ${prospectId} missing or deleted — nothing to audit`);
    return { ok: false, auditId: null, reference: null, error: "prospect_missing" };
  }

  countApiUsage("audit");
  const website = prospect.website ? coerceHttpUrl(prospect.website) : null;
  const reference = newReference("AU");
  const token = newReportToken();
  const auditId = Number(
    db
      .prepare("INSERT INTO audits (reference, prospect_id, status, locale, website, report_token, started_at) VALUES (?, ?, 'running', ?, ?, ?, ?)")
      .run(reference, prospectId, prospect.locale === "fr" ? "fr" : "en", website, token, sqlNow()).lastInsertRowid,
  );
  ctx.log(`${reference} for ${prospect.reference}${website ? ` (${domainOf(website) ?? "site"})` : " (no website)"}`);

  try {
    let checks: AuditChecks;
    let score: Score;
    let site: SiteCrawl | null = null;
    let psi: PsiSummary | null = null;
    let extraction: Extraction | null = null;

    if (!website) {
      checks = noSiteChecks({ error: prospect.website ? "invalid_url" : "no_website" });
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
      checks = runChecks({ site, psi, extraction, googleListing: prospect.google_listing });
      score = auditScore(checks, { ecommerce: extraction.ecommerce, forbidsExtraction: extraction.forbidsExtraction });
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
      const sets: [string, string | number | null][] = [
        ["latest_audit_id", auditId],
        ["latest_score", score.score],
        ["latest_grade", score.grade],
        ["updated_at", now],
      ];
      if (site && extraction && website) sets.push(...prospectUpdates(prospect, website, extraction, site));
      db.prepare(`UPDATE prospects SET ${sets.map(([col]) => `${col} = ?`).join(", ")} WHERE id = ?`).run(...sets.map(([, v]) => v), prospectId);
      db.prepare("INSERT INTO activities (lead_id, prospect_id, kind, channel, summary, payload, actor, created_at) VALUES (?, ?, 'audit_done', 'system', ?, ?, 'system', ?)").run(
        prospect.lead_id,
        prospectId,
        website ? `Audit ${reference} done — score ${score.score} (${score.grade})` : `Audit ${reference} done — no website`,
        JSON.stringify({ auditId, reference, score: score.score, grade: score.grade, flags: score.flags }),
        now,
      );
    });
    finish();
    ctx.log(`${reference} done: ${score.score} (${score.grade}) flags ${score.flags.join(",") || "—"}`);
    return { ok: true, auditId, reference, score: score.score, grade: score.grade, flags: score.flags };
  } catch (e) {
    failAudit(auditId, reference, prospect.reference, e instanceof Error ? e.message : String(e), ctx.log);
    throw e;
  }
}
