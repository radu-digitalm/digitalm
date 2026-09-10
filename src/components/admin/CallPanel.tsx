"use client";

// Call panel on /admin/prospects/[id] (contract §9 "Calls"): self-loads its
// state from GET /api/admin/prospects/[id]/call — window status in the rule's
// time zone, attempts n/4, the number and where it came from, the opener
// lines, the draft's script, GB screening — and posts an outcome to the same
// route. GB shows the TPS/CTPS attestation checkbox; a country without its
// own rule shows the manual-rule warning and still logs. Only { prospectId }
// comes from the page.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { fromSql } from "@/lib/crm/time";
import type { Refusal } from "@/lib/crm/types";
import type { CallOutcome, CallPanelState } from "@/lib/outreach/calls";
import { AdminFetchError, adminFetch, adminGet } from "./adminFetch";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Field, inputClass, labelClass } from "./Field";
import { useToast } from "./Toast";

type State = CallPanelState;

const OUTCOMES: { value: CallOutcome; label: string }[] = [
  { value: "no_answer", label: "No answer" },
  { value: "answered", label: "Answered" },
  { value: "callback", label: "Call back" },
  { value: "refused", label: "Refused — do not call again" },
  { value: "wrong_number", label: "Wrong number" },
];

const SOURCE_LABEL: Record<string, string> = {
  website: "their website",
  osm: "OpenStreetMap",
  fr_register: "the FR register",
  companies_house: "Companies House",
  google: "their Google listing",
  manual: "entered by hand",
};

const WEEKDAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function when(sql: string | null): string {
  if (!sql) return "";
  const d = fromSql(sql);
  return d ? d.toLocaleString("en-GB", { timeZone: "Europe/Paris", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : sql;
}

function errorMessage(e: unknown): string {
  if (e instanceof AdminFetchError) {
    if (e.code === "csrf") return "Session check failed — reload the page.";
    if (e.code.startsWith("register_check_failed")) return `The register could not be reached (${e.code.split(":")[1] ?? "network"}) — the call was not logged. Try again later.`;
    return e.status === 409 ? e.code : `Request failed: ${e.code}`;
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

export function CallPanel({ prospectId }: { prospectId: number }) {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"load" | "log" | null>("load");
  const [outcome, setOutcome] = useState<CallOutcome>("no_answer");
  const [note, setNote] = useState("");
  const [tps, setTps] = useState(false);
  const [lastRefusals, setLastRefusals] = useState<Refusal[] | null>(null);

  const load = useCallback(async () => {
    setBusy("load");
    try {
      const s = await adminGet<State & { ok: true }>(`/api/admin/prospects/${prospectId}/call`);
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

  async function log(e: React.FormEvent) {
    e.preventDefault();
    if (!state) return;
    setBusy("log");
    setLastRefusals(null);
    try {
      const body: Record<string, unknown> = { outcome, note };
      if (state.screening.required) body.tpsChecked = tps;
      const r = await adminFetch<{ ok: true; optedOut: boolean }>(`/api/admin/prospects/${prospectId}/call`, body);
      toast.push(r.optedOut ? "Call logged — refused, added to the opposition list" : "Call logged", "good");
      setNote("");
      setTps(false);
      router.refresh();
      await load();
    } catch (err) {
      const refusals = refusalsOf(err);
      if (refusals) {
        setLastRefusals(refusals);
        toast.push("Call refused — see the reasons below", "bad");
      } else toast.push(errorMessage(err), "bad");
      await load();
    }
  }

  const refusals = lastRefusals ?? state?.refusals ?? [];
  const blockedNow = refusals.filter((r) => !(r.code === "call_screening_missing" && tps));

  return (
    <section className="card p-5" aria-labelledby={`call-panel-${prospectId}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`call-panel-${prospectId}`} className="text-lg">
          Call
        </h2>
        {state ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={state.window.open ? "good" : "warn"} title={`Rule hours ${state.rule.hours} (${state.rule.tz})`}>
              {state.window.open ? "hours open" : "outside hours"} · {WEEKDAY[state.window.weekday] ?? ""} {state.window.localTime} {state.rule.tz}
            </Badge>
            <Badge variant={state.attempts30d >= state.rule.maxAttempts ? "bad" : "neutral"} title="Call attempts in the last 30 days">
              {state.attempts30d}/{state.rule.maxAttempts} in 30 d
            </Badge>
            {state.rule.callAllowed === "screened" ? (
              <Badge variant={state.screening.valid ? "good" : "warn"} title="PECR reg 21: TPS/CTPS screening, valid 28 days">
                {state.screening.valid ? `screened ${when(state.screening.checkedAt)}` : "screening needed"}
              </Badge>
            ) : null}
            {state.rule.callAllowed === "manual" ? <Badge variant="warn">no call rule</Badge> : null}
            {state.prospect.optedOutAt ? <Badge variant="bad">Opted out {when(state.prospect.optedOutAt)}</Badge> : null}
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
          {state.rule.callAllowed === "manual" ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
              No call rule for {state.prospect.country} — check local law first (DE §7 UWG, AT §174 TKG). Outcomes are still logged here.
            </p>
          ) : null}

          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[6rem_1fr]">
            <dt className="text-fg-faint">Number</dt>
            <dd>
              {state.phone.number ? (
                <>
                  <a href={`tel:${state.phone.number.replace(/[^\d+]/g, "")}`} className="link-accent font-mono">
                    {state.phone.number}
                  </a>
                  {state.phone.source ? <span className="ml-2 text-xs text-fg-faint">from {SOURCE_LABEL[state.phone.source] ?? state.phone.source}</span> : null}
                </>
              ) : (
                <span className="text-fg-muted">no number on file</span>
              )}
            </dd>
            <dt className="text-fg-faint">Hours</dt>
            <dd className="text-fg-muted">
              {state.rule.hours} · Mon–Fri · {state.rule.tz}
              {state.prospect.lastCalledAt ? <span className="ml-2 text-xs text-fg-faint">last call {when(state.prospect.lastCalledAt)}</span> : null}
            </dd>
            <dt className="text-fg-faint">Register</dt>
            <dd className="text-fg-muted">
              {state.prospect.registerStatus}
              {state.prospect.registerCheckedAt ? <span className="ml-2 text-xs text-fg-faint">checked {when(state.prospect.registerCheckedAt)} — re-checked before logging when older than 24 h</span> : null}
            </dd>
          </dl>

          <div>
            <p className="text-xs uppercase tracking-wide text-fg-faint">Say first ({state.prospect.locale.toUpperCase()})</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-fg">
              {state.openers.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </div>

          {state.script ? (
            <details className="text-sm" open>
              <summary className="cursor-pointer text-xs uppercase tracking-wide text-fg-faint">Call script (from the draft)</summary>
              <p className="mt-1 whitespace-pre-wrap text-fg">{state.script}</p>
            </details>
          ) : (
            <p className="text-xs text-fg-faint">No draft yet — the call script appears here once one is generated.</p>
          )}

          {blockedNow.length > 0 ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="text-xs uppercase tracking-wide text-amber-300">{lastRefusals ? "Refused when logging" : "Why a call is refused right now"}</p>
              <ul className="mt-2 space-y-1 text-sm text-fg">
                {blockedNow.map((r) => (
                  <li key={r.code} className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-xs text-fg-faint">{r.code}</span>
                    <span>{r.message.en}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <form onSubmit={log} className="space-y-2 border-t border-line pt-4">
            {state.screening.required ? (
              <label className="flex items-center gap-2 text-sm text-fg-muted">
                <input type="checkbox" checked={tps} onChange={(e) => setTps(e.target.checked)} />
                Screened against TPS and CTPS today (PECR reg 21)
                {state.screening.valid ? <span className="text-xs text-fg-faint">— last screening still valid ({state.screening.validDays} days)</span> : null}
              </label>
            ) : null}
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor={`call-outcome-${prospectId}`} className={labelClass}>
                  Outcome
                </label>
                <select id={`call-outcome-${prospectId}`} value={outcome} onChange={(e) => setOutcome(e.target.value as CallOutcome)} className={`${inputClass} w-auto`}>
                  {OUTCOMES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <Field label="Note" name={`call-note-${prospectId}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="min-w-[12rem] flex-1" autoComplete="off" />
              <Button type="submit" variant="primary" loading={busy === "log"} disabled={busy !== null}>
                Log call
              </Button>
            </div>
            {outcome === "refused" ? <p className="text-xs text-fg-faint">Refused adds the number and the email on file to the opposition list and closes the lead with STOP.</p> : null}
          </form>

          {state.recentCalls.length > 0 ? (
            <details className="text-xs text-fg-muted">
              <summary className="cursor-pointer text-fg-faint">Recent calls ({state.recentCalls.length})</summary>
              <ul className="mt-2 space-y-1">
                {state.recentCalls.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-baseline gap-2">
                    <span className="text-fg-faint">{when(c.createdAt)}</span>
                    <span className="text-fg">{c.summary}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
