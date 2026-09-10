"use client";

// Audit panel on /admin/prospects/[id] (contract §7.3): self-loads from
// GET /api/admin/prospects/[id]/audit, shows score, grade, the ten checks,
// flags, fits, PageSpeed and crawl facts, and posts "Run again" (deduped).
// Polls every 5 s while a job is queued or running. Foreign strings render as
// React text nodes; the report link is a plain <a>, never <Link>.
import { useCallback, useEffect, useRef, useState } from "react";
import { adminFetch, adminGet } from "./adminFetch";
import { Badge } from "./Badge";
import type { BadgeVariant } from "./Badge";
import { Button } from "./Button";
import { Meter } from "./Meter";
import { useToast } from "./Toast";
import { CHECK_COPY, FLAG_COPY, packageLabel } from "@/content/auditChecks";
import { CHECK_ORDER } from "@/lib/audit/score";
import { CHECK_WEIGHTS } from "@/lib/crm/types";
import type { Audit, CheckKey, CheckResult, CheckStatus } from "@/lib/crm/types";

type PanelState = {
  ok: true;
  prospect: { id: number; reference: string; name: string; website: string | null; googleListing: string; personalWipedAt: string | null; forbidsExtraction: boolean };
  audit: Audit | null;
  history: { id: number; reference: string; status: Audit["status"]; score: number | null; grade: Audit["grade"]; finishedAt: string | null; createdAt: string }[];
  job: { id: number; status: string; position: number | null; runAfter: string; attempts: number; maxAttempts: number; lastError: string | null; createdAt: string } | null;
  usage: { used: number; cap: number };
  reportPath: string | null;
};

const POLL_MS = 5_000;

const STATUS_BADGE: Record<CheckStatus, { variant: BadgeVariant; label: string }> = {
  pass: { variant: "good", label: "Pass" },
  partial: { variant: "warn", label: "Partial" },
  fail: { variant: "bad", label: "Fail" },
  not_measured: { variant: "neutral", label: "Not measured" },
};

const AUDIT_BADGE: Record<Audit["status"], { variant: BadgeVariant; label: string }> = {
  queued: { variant: "info", label: "Queued" },
  running: { variant: "info", label: "Running" },
  done: { variant: "good", label: "Done" },
  failed: { variant: "bad", label: "Failed" },
};

function when(s: string | null | undefined): string {
  if (!s) return "";
  const d = new Date(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function pct(v: number | null | undefined): string {
  return typeof v === "number" ? String(Math.round(v * 100)) : "—";
}

/** One line of facts per check from its scalar details (admin only, English). */
function factLine(key: CheckKey, c: CheckResult): string {
  const d = c.details;
  const parts: string[] = [];
  switch (key) {
    case "reachable":
      if (typeof d.status === "number" && d.status > 0) parts.push(`HTTP ${d.status}`);
      if (typeof d.ms === "number") parts.push(`${d.ms} ms`);
      if (typeof d.error === "string" && d.error) parts.push(d.error);
      if (d.truncated === true) parts.push("2 MB cap hit");
      break;
    case "https":
      if (typeof d.tlsError === "string" && d.tlsError) parts.push(d.tlsError);
      if (typeof d.certDaysLeft === "number") parts.push(`cert ${d.certDaysLeft} d`);
      if (typeof d.issuer === "string" && d.issuer) parts.push(d.issuer);
      if (d.redirect === false) parts.push("no http→https redirect");
      if (d.hsts === false) parts.push("no HSTS");
      if (d.https === false) parts.push("served over http");
      break;
    case "speed":
      if (d.timedOut === true) parts.push("PageSpeed did not answer");
      else {
        parts.push(`perf ${pct(d.performance as number | null)}`);
        if (typeof d.lcpMs === "number") parts.push(`LCP ${(d.lcpMs / 1000).toFixed(1)} s`);
        if (typeof d.cls === "number") parts.push(`CLS ${d.cls}`);
      }
      break;
    case "seo_basics":
      if (typeof d.seo === "number") parts.push(`SEO ${pct(d.seo)}`);
      if (d.viewport === false) parts.push("no viewport");
      if (d.title === false) parts.push("no title");
      if (d.description === false) parts.push("no description");
      break;
    case "contact":
      if (d.tel === true) parts.push("tel:");
      if (d.mailto === true) parts.push("mailto:");
      if (d.form === true) parts.push("form");
      parts.push(typeof d.bookingProvider === "string" && d.bookingProvider ? `booking: ${d.bookingProvider}` : "no booking");
      break;
    case "socials":
      parts.push(typeof d.networks === "string" && d.networks ? d.networks : "none");
      break;
    case "schema":
      if (typeof d.type === "string" && d.type) parts.push(d.type);
      if (d.jsonLd === true && d.telephone !== true) parts.push("no telephone");
      if (d.jsonLd === true && d.openingHours !== true) parts.push("no openingHours");
      break;
    case "ai_ready": {
      const blocked = (["gptbot", "claudebot", "perplexitybot", "googleExtended"] as const).filter((k) => d[k] === false);
      if (blocked.length) parts.push(`blocked: ${blocked.join(", ")}`);
      if (d.llmsTxt === true) parts.push("llms.txt");
      if (typeof d.chatProvider === "string" && d.chatProvider) parts.push(`chat: ${d.chatProvider}`);
      if (d.robotsStatus === null) parts.push("robots.txt unreachable");
      break;
    }
    case "google_listing":
      if (typeof d.listing === "string") parts.push(d.listing);
      break;
    case "housekeeping":
      if (typeof d.copyrightYear === "number") parts.push(`© ${d.copyrightYear}`);
      if (d.legalLink === false) parts.push("no legal link");
      if (d.mixedContent === true) parts.push(`mixed content ×${typeof d.mixedCount === "number" ? d.mixedCount : "?"}`);
      if (typeof d.cms === "string" && d.cms) parts.push(d.cms);
      break;
  }
  return parts.join(" · ");
}

export function AuditBlock({ prospectId }: { prospectId: number }) {
  const [state, setState] = useState<PanelState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await adminGet<PanelState>(`/api/admin/prospects/${prospectId}/audit`);
      setState(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    }
  }, [prospectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while something is pending.
  const pending = !!state && (state.job !== null || state.audit?.status === "queued" || state.audit?.status === "running");
  useEffect(() => {
    if (!pending) return;
    timer.current = setTimeout(() => void load(), POLL_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [pending, state, load]);

  async function run() {
    setBusy(true);
    try {
      const r = await adminFetch<{ ok: true; jobId: number; deduped: boolean; position: number | null }>(`/api/admin/prospects/${prospectId}/audit`);
      toast.push(r.deduped ? "Audit already queued" : r.position !== null ? `Audit queued · ${r.position} ahead` : "Audit queued", r.deduped ? "info" : "good");
      await load();
    } catch (e) {
      toast.push(`Could not queue the audit: ${e instanceof Error ? e.message : "error"}`, "bad");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <section className="card p-5">
        <h2 className="font-display text-lg text-fg-heading">Audit</h2>
        <p className="mt-2 text-sm text-accent-soft">Could not load the audit ({error}).</p>
        <Button size="sm" className="mt-3" onClick={() => void load()}>
          Retry
        </Button>
      </section>
    );
  }
  if (!state) {
    return (
      <section className="card p-5" aria-busy="true">
        <h2 className="font-display text-lg text-fg-heading">Audit</h2>
        <p className="mt-2 text-sm text-fg-muted">Loading…</p>
      </section>
    );
  }

  const { audit, job, prospect, usage } = state;
  const done = audit?.status === "done" && audit.checks;
  const capReached = usage.used >= usage.cap;

  return (
    <section className="card p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-lg text-fg-heading">Audit</h2>
          {audit ? <Badge variant={AUDIT_BADGE[audit.status].variant}>{AUDIT_BADGE[audit.status].label}</Badge> : null}
          {audit ? <span className="font-mono text-xs text-fg-faint">{audit.reference}</span> : null}
          {audit?.finishedAt ? <span className="text-xs text-fg-faint">{when(audit.finishedAt)}</span> : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-fg-faint" title="Audits started today against AUDIT_DAILY_CAP">
            Today {usage.used} / {usage.cap}
          </span>
          <Button size="sm" variant={audit ? "ghost" : "primary"} loading={busy} disabled={job !== null} onClick={() => void run()}>
            {audit ? "Run again" : "Run audit"}
          </Button>
        </div>
      </header>

      {job ? (
        <p className="mt-3 text-sm text-sky-300">
          {job.status === "running" ? "Running now…" : job.position !== null ? `Queued · ${job.position} job${job.position === 1 ? "" : "s"} ahead` : "Queued"}
          {job.lastError ? <span className="text-fg-muted"> — {job.lastError}</span> : null}
        </p>
      ) : capReached ? (
        <p className="mt-3 text-sm text-amber-300">Daily cap reached — new audits run from 06:00 Europe/Paris tomorrow.</p>
      ) : null}

      {!prospect.website ? <p className="mt-3 text-sm text-fg-muted">No website on file — the audit records a &ldquo;no site&rdquo; result (score 0, fit Site + AI).</p> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {prospect.forbidsExtraction ? <Badge variant="warn">Site forbids extraction — email left empty</Badge> : null}
        {prospect.personalWipedAt ? <Badge variant="info">Personal data wiped — contact fields not stored</Badge> : null}
      </div>

      {audit?.status === "failed" ? (
        <p className="mt-3 break-words text-sm text-accent-soft">
          Failed: <span className="font-mono">{audit.error ?? "unknown"}</span>
        </p>
      ) : null}

      {!audit && !job ? <p className="mt-3 text-sm text-fg-muted">No audit yet.</p> : null}

      {done && audit ? (
        <>
          <Meter className="mt-4" value={audit.score} grade={audit.grade} label={`Score · ${audit.locale.toUpperCase()} report`} />

          {audit.flags.length ? (
            <div className="mt-4 flex flex-wrap gap-2" aria-label="Flags">
              {audit.flags.map((f) => (
                <Badge key={f} variant={f === "forbids-extraction" ? "warn" : "bad"} title={f}>
                  {FLAG_COPY[f]?.en ?? f}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-emerald-300">No flags — nothing obvious to pitch.</p>
          )}

          {audit.fits.length ? (
            <ul className="mt-3 space-y-1 text-sm">
              {audit.fits.map((fit) => (
                <li key={fit.pkg} className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xs text-fg-faint">{fit.pkg}</span>
                  <span className="text-fg-heading">{packageLabel(fit, "en")}</span>
                  <span className="text-xs text-fg-muted">{fit.flags.join(", ")}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="sr-only">The ten checks</caption>
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-fg-faint">
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">
                    Check
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    Points
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">
                    Facts
                  </th>
                </tr>
              </thead>
              <tbody>
                {CHECK_ORDER.map((key) => {
                  const c = audit.checks![key];
                  if (!c) return null;
                  const badge = STATUS_BADGE[c.status] ?? STATUS_BADGE.not_measured;
                  const isTop = audit.top.includes(key);
                  return (
                    <tr key={key} className={`border-b border-line/60 last:border-0 ${isTop ? "bg-surface-2/60" : ""}`}>
                      <td className="px-2 py-2 align-top">
                        <div className="text-fg-heading">
                          {CHECK_COPY[key].label.en}
                          {isTop ? <span className="ml-2 text-xs text-accent-soft">top</span> : null}
                        </div>
                        <div className="text-xs text-fg-muted">{CHECK_COPY[key][c.status].en}</div>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </td>
                      <td className="px-2 py-2 text-right align-top font-mono text-xs text-fg-muted">
                        {c.measured ? `${c.points} / ${CHECK_WEIGHTS[key]}` : `— / ${CHECK_WEIGHTS[key]}`}
                      </td>
                      <td className="px-2 py-2 align-top text-xs text-fg-muted">{factLine(key, c)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <dl className="mt-4 grid gap-2 text-xs text-fg-muted sm:grid-cols-2">
            <div>
              <dt className="text-fg-faint">PageSpeed (mobile)</dt>
              <dd>
                {audit.pagespeed && !audit.pagespeed.timedOut
                  ? `perf ${pct(audit.pagespeed.performance)} · SEO ${pct(audit.pagespeed.seo)}${typeof audit.pagespeed.lcpMs === "number" ? ` · LCP ${(audit.pagespeed.lcpMs / 1000).toFixed(1)} s` : ""}${typeof audit.pagespeed.cls === "number" ? ` · CLS ${audit.pagespeed.cls}` : ""} · ${when(audit.pagespeed.fetchedAt)}`
                  : "did not answer — speed scored as partial"}
              </dd>
            </div>
            <div>
              <dt className="text-fg-faint">Crawl</dt>
              <dd>
                {audit.crawl.length ? (
                  <ul className="space-y-0.5 font-mono">
                    {audit.crawl.map((h, i) => (
                      <li key={i} className="break-all">
                        {h.status} · {h.bytes} B · {h.url}
                      </li>
                    ))}
                  </ul>
                ) : (
                  "no requests"
                )}
              </dd>
            </div>
          </dl>

          {state.reportPath ? (
            <p className="mt-4 text-sm">
              <a href={state.reportPath} target="_blank" rel="noopener" className="link-accent">
                Open the report ({audit.locale.toUpperCase()})
              </a>
              {audit.reportViews > 0 ? <span className="ml-2 text-xs text-fg-faint">{audit.reportViews} view{audit.reportViews === 1 ? "" : "s"}</span> : null}
              {audit.reportExpiresAt ? <span className="ml-2 text-xs text-fg-faint">expires {when(audit.reportExpiresAt)}</span> : null}
            </p>
          ) : null}
        </>
      ) : null}

      {state.history.length > 1 ? (
        <details className="mt-4 text-xs text-fg-muted">
          <summary className="cursor-pointer text-fg-faint">Previous audits</summary>
          <ul className="mt-2 space-y-1 font-mono">
            {state.history.map((h) => (
              <li key={h.id}>
                {h.reference} · {h.status}
                {typeof h.score === "number" ? ` · ${h.score} (${h.grade})` : ""} · {when(h.finishedAt ?? h.createdAt)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
