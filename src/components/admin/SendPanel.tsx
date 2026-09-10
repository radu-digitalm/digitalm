"use client";

// Send panel on /admin/prospects/[id] (contract §9): self-loads its state
// from GET /api/admin/prospects/[id]/send — recipient, sender, the reviewed
// draft, every refusal as things stand, the legal block preview, the daily
// cap and the recent sends. Send (POST the same route), "Copy email with
// legal block" and "I sent it from Gmail" (POST …/manual-send), the 7-day
// follow-up through the same manual path, and Mark STOP (POST
// /api/admin/optouts). A pending row left behind (page reloaded while an
// email was prepared, process died mid-SMTP) is listed with Record / Cancel,
// because it reserves the prospect until cleared; a send whose bookkeeping
// failed gets "Repair bookkeeping" — never a second send. Only { prospectId }
// comes from the page.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { fromSql } from "@/lib/crm/time";
import type { Refusal } from "@/lib/crm/types";
import type { PreparedSend, SendPanelState, SendSummary } from "@/lib/outreach/send";
import { AdminFetchError, adminFetch, adminGet } from "./adminFetch";
import { Badge, type BadgeVariant } from "./Badge";
import { Button } from "./Button";
import { ConfirmButton } from "./ConfirmButton";
import { EmptyState } from "./EmptyState";
import { inputClass } from "./Field";
import { useToast } from "./Toast";

type State = SendPanelState;
type Prepared = PreparedSend & { kind: "draft" | "followup" };

const STATUS_VARIANT: Record<string, BadgeVariant> = { sent: "good", pending: "info", failed: "bad", refused: "warn", bounced: "bad" };

const KIND_LABEL: Record<string, string> = { generic: "generic mailbox", named: "named person", sole_trader: "sole trader", webmail: "webmail — never emailed", unknown: "unknown" };

function when(sql: string | null): string {
  if (!sql) return "";
  const d = fromSql(sql);
  return d ? d.toLocaleString("en-GB", { timeZone: "Europe/Paris", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : sql;
}

function errorMessage(e: unknown): string {
  if (e instanceof AdminFetchError) {
    if (e.code === "csrf") return "Session check failed — reload the page.";
    if (e.code === "optout_listed") return "This contact opted out in the meantime — nothing was sent.";
    if (e.code === "not_prepared") return "That prepared email is no longer pending — prepare it again.";
    if (e.code === "not_sent") return "Only a sent email can be repaired.";
    if (e.code === "legal_block_incomplete") return "The legal block is incomplete (see the problems under the preview) — nothing was sent.";
    if (e.code.startsWith("register_check_failed")) return `The register could not be reached (${e.code.split(":")[1] ?? "network"}) — nothing was sent. Try again later.`;
    if (e.code === "smtp_failed") {
      const code = (e.body as { code?: string } | null)?.code ?? "smtp";
      return `SMTP failed (${code}) — the send is logged as failed; nothing was retried.`;
    }
    return `Request failed: ${e.code}`;
  }
  return "Request failed.";
}

function refusalsOf(e: unknown): Refusal[] | null {
  if (e instanceof AdminFetchError && e.status === 409) {
    const body = e.body as { refusals?: Refusal[] } | null;
    if (Array.isArray(body?.refusals)) return body.refusals;
  }
  return null;
}

function RefusalList({ refusals, title }: { refusals: Refusal[]; title: string }) {
  if (refusals.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
      <p className="text-xs uppercase tracking-wide text-amber-300">{title}</p>
      <ul className="mt-2 space-y-1 text-sm text-fg">
        {refusals.map((r) => (
          <li key={r.code} className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-xs text-fg-faint">{r.code}</span>
            <span>{r.message.en}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SendRow({ s }: { s: SendSummary }) {
  return (
    <li className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-mono">{s.reference}</span>
      <Badge variant={STATUS_VARIANT[s.status] ?? "neutral"}>{s.status}</Badge>
      <span className="text-fg-faint">{s.channel === "manual_email" ? "Gmail" : s.channel}</span>
      <span className="text-fg-faint">{when(s.sentAt ?? s.createdAt)}</span>
      {s.subject ? <span className="truncate text-fg-muted">{s.subject}</span> : null}
      {s.refusalCodes.length ? <span className="font-mono text-fg-faint">{s.refusalCodes.join(", ")}</span> : null}
      {s.error ? <span className="font-mono text-accent-soft">{s.error}</span> : null}
    </li>
  );
}

export function SendPanel({ prospectId }: { prospectId: number }) {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"load" | "send" | "prepare" | "record" | "stop" | null>("load");
  const [lastRefusals, setLastRefusals] = useState<Refusal[] | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  /** A sent row whose lead / activity bookkeeping failed: offer a repair, never a re-send. */
  const [repairId, setRepairId] = useState<{ id: number; reference: string } | null>(null);

  const load = useCallback(async () => {
    setBusy("load");
    try {
      const s = await adminGet<State & { ok: true }>(`/api/admin/prospects/${prospectId}/send`);
      setState(s);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }, [prospectId]);

  useEffect(() => {
    void load();
  }, [load]);

  function afterSent(r: { send: SendSummary; warning?: string | null }) {
    if (r.warning === "bookkeeping_failed") {
      setRepairId({ id: r.send.id, reference: r.send.reference });
      toast.push(`${r.send.reference} went out, but the lead / activity bookkeeping failed — repair it below, do not send again`, "bad");
    } else toast.push(`Sent — ${r.send.reference}`, "good");
  }

  async function send() {
    if (!state?.draft) return;
    setBusy("send");
    setLastRefusals(null);
    try {
      const r = await adminFetch<{ ok: true; send: SendSummary; warning: string | null }>(`/api/admin/prospects/${prospectId}/send`, { draftId: state.draft.id });
      afterSent(r);
      router.refresh();
      await load();
    } catch (e) {
      const refusals = refusalsOf(e);
      if (refusals) {
        setLastRefusals(refusals);
        toast.push("Send refused — see the reasons below", "bad");
      } else toast.push(errorMessage(e), "bad");
      await load();
    }
  }

  async function prepare(kind: "draft" | "followup") {
    if (kind === "draft" && !state?.draft) return;
    setBusy("prepare");
    setLastRefusals(null);
    try {
      const r = await adminFetch<{ ok: true } & PreparedSend>(`/api/admin/prospects/${prospectId}/manual-send`, {
        action: "prepare",
        draftId: kind === "followup" ? "followup" : state!.draft!.id,
      });
      setPrepared({ sendId: r.sendId, reference: r.reference, subject: r.subject, text: r.text, optoutUrl: r.optoutUrl, kind });
    } catch (e) {
      const refusals = refusalsOf(e);
      if (refusals) {
        setLastRefusals(refusals);
        toast.push("Refused — see the reasons below", "bad");
      } else toast.push(errorMessage(e), "bad");
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!prepared) return;
    try {
      await navigator.clipboard.writeText(`${prepared.subject}\n\n${prepared.text}`);
      toast.push("Copied with the legal block", "good");
    } catch {
      toast.push("Copy failed — select the text by hand", "bad");
    }
  }

  async function record(sendId = prepared?.sendId) {
    if (!sendId) return;
    setBusy("record");
    try {
      const r = await adminFetch<{ ok: true; send: SendSummary; warning: string | null }>(`/api/admin/prospects/${prospectId}/manual-send`, { action: "record", sendId });
      afterSent(r);
      setPrepared(null);
      router.refresh();
      await load();
    } catch (e) {
      toast.push(errorMessage(e), "bad");
      setBusy(null);
    }
  }

  async function cancel(sendId = prepared?.sendId) {
    if (!sendId) return;
    setPrepared(null);
    try {
      await adminFetch(`/api/admin/prospects/${prospectId}/manual-send`, { action: "cancel", sendId });
    } catch (e) {
      // A row left pending reserves the prospect (no second send) until it is cleared: say so.
      toast.push(errorMessage(e), "bad");
    }
    await load();
  }

  async function repair() {
    if (!repairId) return;
    setBusy("record");
    try {
      const r = await adminFetch<{ ok: true; send: SendSummary }>(`/api/admin/prospects/${prospectId}/manual-send`, { action: "repair", sendId: repairId.id });
      toast.push(`Bookkeeping repaired — ${r.send.reference}`, "good");
      setRepairId(null);
      router.refresh();
      await load();
    } catch (e) {
      toast.push(errorMessage(e), "bad");
      setBusy(null);
    }
  }

  async function markStop() {
    setBusy("stop");
    try {
      const r = await adminFetch<{ ok: true; recorded: boolean }>("/api/admin/optouts", { prospect_id: prospectId });
      toast.push(r.recorded ? "STOP recorded — on the opposition list" : "Already on the opposition list", r.recorded ? "good" : "info");
      router.refresh();
      await load();
    } catch (e) {
      toast.push(errorMessage(e), "bad");
      setBusy(null);
    }
  }

  const refusals = lastRefusals ?? state?.refusals ?? [];
  const legalOk = !!state && state.legalProblems.length === 0;
  // The daily cap is a safeguard of the LIA: it blocks the Gmail path as much as the in-app one.
  const canSend = legalOk && !!state.draft && state.refusals.length === 0 && state.smtp;
  const canPrepare = legalOk && !!state.draft && state.refusals.length === 0;
  const canFollowUp = legalOk && state.sentCount90d >= 1 && state.followUpRefusals.length === 0;
  // Rows still pending with nothing prepared in this tab: a reload lost the prepared text, or an in-app send died mid-SMTP.
  const stuck = !prepared && state ? state.sends.filter((s) => s.status === "pending") : [];

  return (
    <section className="card p-5" aria-labelledby={`send-panel-${prospectId}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`send-panel-${prospectId}`} className="text-lg">
          Send
        </h2>
        {state ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={state.prospect.emailEnabled ? "info" : "warn"} title="Country rule row (contract §3)">
              {state.prospect.ruleKey === "*" ? `no email rule for ${state.prospect.country}` : `${state.prospect.ruleKey} rule`}
            </Badge>
            <Badge variant={state.cap.used >= state.cap.cap ? "bad" : "neutral"} title="Emails sent or still pending today, in-app and Gmail alike (Europe/Paris)">
              today {state.cap.used}/{state.cap.cap}
            </Badge>
            {state.sentCount90d > 0 ? (
              <Badge variant={state.sentCount90d >= 2 ? "warn" : "neutral"} title="Sent or pending, both paths">
                {state.sentCount90d}/2 emails in 90 d
              </Badge>
            ) : null}
            {state.prospect.optedOutAt ? <Badge variant="bad">Opted out {when(state.prospect.optedOutAt)}</Badge> : null}
            {!state.smtp ? <Badge variant="warn" title="SMTP_HOST is unset on this host">SMTP off</Badge> : null}
          </div>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-accent-soft">
          {error}
        </p>
      ) : null}
      {!state && busy === "load" ? <p className="mt-3 text-sm text-fg-muted">Loading…</p> : null}

      {state ? (
        <div className="mt-4 space-y-4">
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[6rem_1fr]">
            <dt className="text-fg-faint">To</dt>
            <dd className="break-all">
              {state.recipient.to ? (
                <>
                  <span className="font-mono">{state.recipient.to}</span>
                  {state.recipient.kind ? (
                    <Badge variant={state.recipient.kind === "webmail" ? "bad" : "neutral"} className="ml-2">
                      {KIND_LABEL[state.recipient.kind] ?? state.recipient.kind}
                    </Badge>
                  ) : null}
                  <span className="ml-2 text-xs text-fg-faint">
                    {state.recipient.source === "override"
                      ? "validated override — the notice says the address came from a public listing, not the website"
                      : state.recipient.source === "website"
                        ? `from the site${state.recipient.page ? ` (${state.recipient.page})` : ""}`
                        : "from the discovery source — the notice omits the email sentence"}
                  </span>
                </>
              ) : (
                <span className="text-fg-muted">no business email on file</span>
              )}
            </dd>
            <dt className="text-fg-faint">From</dt>
            <dd className="break-all font-mono text-xs text-fg-muted">
              {state.from}
              {state.replyTo !== state.from ? <span className="ml-2">· reply-to {state.replyTo}</span> : null}
            </dd>
            <dt className="text-fg-faint">Draft</dt>
            <dd>
              {state.draft ? (
                <>
                  <span>{state.draft.subject}</span>
                  <span className="ml-2 text-xs text-fg-faint">{state.draft.locale.toUpperCase()}</span>
                  {state.draft.reviewedAt ? (
                    <Badge variant="good" className="ml-2">
                      reviewed
                    </Badge>
                  ) : (
                    <Badge variant="bad" className="ml-2">
                      not reviewed
                    </Badge>
                  )}
                  {state.audit && state.draft.auditId !== state.audit.id ? (
                    <Badge variant="warn" className="ml-2" title="A newer audit has finished since this draft was written">
                      older audit
                    </Badge>
                  ) : null}
                </>
              ) : (
                <span className="text-fg-muted">no draft yet — generate one above</span>
              )}
            </dd>
            <dt className="text-fg-faint">Report</dt>
            <dd>
              {state.audit ? (
                <>
                  <span className="font-mono text-xs">{state.audit.reference}</span>
                  {state.audit.score !== null ? <span className="ml-2 text-xs text-fg-faint">{state.audit.score}/100</span> : null}
                  {" · "}
                  <a href={state.audit.reportUrl} target="_blank" rel="noopener" className="link-accent text-xs">
                    open
                  </a>
                  {state.audit.reportExpiresAt ? <span className="ml-2 text-xs text-fg-faint">expires {when(state.audit.reportExpiresAt)}</span> : null}
                </>
              ) : (
                <span className="text-fg-muted">no finished audit</span>
              )}
            </dd>
            {state.prospect.lastEmailedAt ? (
              <>
                <dt className="text-fg-faint">Last email</dt>
                <dd className="text-fg-muted">{when(state.prospect.lastEmailedAt)}</dd>
              </>
            ) : null}
          </dl>

          <RefusalList refusals={refusals} title={lastRefusals ? "Refused at send time" : "Why this cannot go out yet"} />
          {refusals.length === 0 && canFollowUp === false && state.sentCount90d >= 1 && state.followUpRefusals.length > 0 ? (
            <RefusalList refusals={state.followUpRefusals} title="Follow-up" />
          ) : null}

          <details className="text-xs text-fg-muted">
            <summary className="cursor-pointer text-fg-faint">Legal block preview (the opt-out link is generated at send time)</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-line bg-surface-2/40 p-3 font-mono text-[11px] leading-relaxed text-fg">{state.legalPreview}</pre>
          </details>
          {state.legalProblems.length > 0 ? (
            <div className="rounded-lg border border-accent/40 bg-accent/10 p-3" role="alert">
              <p className="text-xs uppercase tracking-wide text-accent-soft">Legal block incomplete — both paths are refused</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg">
                {state.legalProblems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-fg-faint">Fix the prospect's website / domain or its saved date in the finder, then reload this panel.</p>
            </div>
          ) : null}

          {repairId ? (
            <div className="space-y-2 rounded-lg border border-accent/40 bg-accent/10 p-4" role="alert">
              <p className="text-sm text-fg">
                {repairId.reference} went out, but the lead / activity bookkeeping failed. The email is recorded as sent — do not send it again; repair the bookkeeping instead.
              </p>
              <Button size="sm" variant="primary" onClick={repair} loading={busy === "record"} disabled={busy !== null}>
                Repair bookkeeping
              </Button>
            </div>
          ) : null}

          {stuck.length > 0 ? (
            <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
              <p className="text-sm text-fg">A send is still pending for this prospect — it counts as sent until you record or cancel it.</p>
              <ul className="space-y-2">
                {stuck.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono">{s.reference}</span>
                    <span className="text-fg-faint">{s.channel === "manual_email" ? "prepared for Gmail" : "in-app send left in flight — check the mailbox's Sent folder first"}</span>
                    <span className="text-fg-faint">{when(s.createdAt)}</span>
                    {s.channel === "manual_email" ? (
                      <Button size="sm" variant="primary" onClick={() => record(s.id)} loading={busy === "record"} disabled={busy !== null}>
                        I sent it from Gmail
                      </Button>
                    ) : null}
                    <Button size="sm" onClick={() => cancel(s.id)} disabled={busy !== null}>
                      Cancel
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {prepared ? (
            <div className="space-y-2 rounded-lg border border-line bg-surface-2/40 p-4">
              <p className="text-sm text-fg-muted">
                {prepared.kind === "followup" ? "Follow-up" : "Email"} {prepared.reference} — paste subject and body into Gmail (legal block included), then confirm.
              </p>
              <p className="text-sm text-fg-heading">{prepared.subject}</p>
              <textarea readOnly rows={12} value={prepared.text} className={`${inputClass} font-mono text-xs`} aria-label="Email text with legal block" />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={copy}>
                  Copy email with legal block
                </Button>
                <Button size="sm" variant="primary" onClick={() => record()} loading={busy === "record"} disabled={busy !== null}>
                  I sent it from Gmail
                </Button>
                <Button size="sm" onClick={() => cancel()} disabled={busy !== null}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <ConfirmButton
                label="Send"
                confirmLabel="Send this email now?"
                variant="primary"
                onConfirm={send}
                loading={busy === "send"}
                disabled={!canSend || busy !== null}
              />
              <Button onClick={() => prepare("draft")} loading={busy === "prepare"} disabled={!canPrepare || busy !== null} title="Prepares the same email with its legal block for Gmail">
                Prepare for Gmail…
              </Button>
              <Button onClick={() => prepare("followup")} loading={busy === "prepare"} disabled={!canFollowUp || busy !== null} title="Follow-up by hand: refused inside 7 days of the first email, and as a third email">
                Prepare follow-up…
              </Button>
              <ConfirmButton
                label="Mark STOP"
                confirmLabel="Confirm STOP — no more contact"
                variant="danger"
                onConfirm={markStop}
                loading={busy === "stop"}
                disabled={!!state.prospect.optedOutAt || busy !== null}
              />
            </div>
          )}
          {!state.smtp ? <p className="text-xs text-fg-faint">SMTP is not configured on this host: in-app sends fail visibly; the Gmail path still works.</p> : null}

          {state.sends.length > 0 ? (
            <details className="text-xs text-fg-muted">
              <summary className="cursor-pointer text-fg-faint">Recent sends ({state.sends.length})</summary>
              <ul className="mt-2 space-y-1">
                {state.sends.map((s) => (
                  <SendRow key={s.id} s={s} />
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {state && !state.audit && !state.draft && !error ? (
        <EmptyState className="mt-4" title="Nothing to send yet" hint="Run the audit, generate and review the draft, then this panel shows the recipient, the legal block and every reason a send would be refused." />
      ) : null}
    </section>
  );
}
