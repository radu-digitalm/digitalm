"use client";

// Draft panel on /admin/prospects/[id] (contract §8): self-loads its state
// from GET /api/admin/prospects/[id]/draft, shows the four editable fields of
// the newest draft, Regenerate (POST the same route) and Save (POST
// /api/admin/drafts/[id], which stamps reviewed_at — outreach refuses to send
// until then). Only { prospectId } comes from the page.
import { useCallback, useEffect, useState } from "react";
import { OUTREACH_MODULE } from "@/lib/crm/features";
import type { Draft } from "@/lib/crm/types";
import { AdminFetchError, adminFetch, adminGet } from "./adminFetch";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { ConfirmButton } from "./ConfirmButton";
import { EmptyState } from "./EmptyState";
import { Field } from "./Field";
import { Textarea } from "./Textarea";
import { useToast } from "./Toast";
import { localDateTime } from "./format";
import { REFUSAL_TEXT } from "./wording";

type FieldKey = "subject" | "body" | "callScript" | "noteForOwner";
type Fields = Record<FieldKey, string>;
type Caps = Record<FieldKey, { min: number; max: number }>;

type PanelState = {
  prospect: { id: number; reference: string; displayName: string; locale: "fr" | "en" };
  audit: { id: number; reference: string; score: number | null; grade: "A" | "B" | "C" | null; finishedAt: string | null; reportUrl: string } | null;
  draft: Draft | null;
  draftStale: boolean;
  llm: boolean;
  model: string;
  caps: Caps;
};

const EMPTY: Fields = { subject: "", body: "", callScript: "", noteForOwner: "" };

function fieldsOf(d: Draft | null): Fields {
  return d ? { subject: d.subject, body: d.body, callScript: d.callScript, noteForOwner: d.noteForOwner } : EMPTY;
}

const REASONS: Record<string, string> = {
  no_key: "no model key configured on this server",
  timeout: "model timed out",
  model_error: "model call failed",
  mangled: "model output was garbled",
  "unsafe:email": "model output contained an email address",
  "unsafe:phone": "model output contained a phone number",
  "unsafe:banned": "model output used a banned word",
};

function errorMessage(e: unknown): string {
  if (e instanceof AdminFetchError) {
    if (e.code === "audit_missing") return `${REFUSAL_TEXT.audit_missing} — run an audit first.`;
    if (e.code === "csrf") return "Session check failed — reload the page.";
    return "The request failed. Try again.";
  }
  return "Request failed.";
}

function when(sql: string | null): string {
  return localDateTime(sql);
}

function Count({ value, cap }: { value: string; cap: { min: number; max: number } }) {
  const n = value.length;
  const off = n < cap.min || n > cap.max;
  return (
    <span className={`font-mono text-[14px] ${off ? "text-amber-300" : "text-fg-muted"}`} title={`Between ${cap.min} and ${cap.max} characters`}>
      {n} / {cap.max}
    </span>
  );
}

export function DraftPanel({ prospectId }: { prospectId: number }) {
  const toast = useToast();
  const [state, setState] = useState<PanelState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [busy, setBusy] = useState<"load" | "generate" | "save" | null>("load");

  const load = useCallback(async () => {
    setBusy("load");
    try {
      const s = await adminGet<PanelState & { ok: true }>(`/api/admin/prospects/${prospectId}/draft`);
      setState(s);
      setFields(fieldsOf(s.draft));
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

  const draft = state?.draft ?? null;
  const saved = fieldsOf(draft);
  const dirty = (Object.keys(EMPTY) as FieldKey[]).some((k) => fields[k] !== saved[k]);

  async function generate() {
    setBusy("generate");
    try {
      const r = await adminFetch<{ ok: true; draft: Draft; fallback: boolean; reason: string | null }>(`/api/admin/prospects/${prospectId}/draft`);
      const why = r.reason ? REASONS[r.reason] ?? REASONS[r.reason.split(":").slice(0, 2).join(":")] ?? r.reason : null;
      toast.push(r.fallback ? `Template draft${why ? ` — ${why}` : ""}` : `Draft generated with ${state?.model ?? "the model"}`, r.fallback ? "info" : "good");
      await load();
    } catch (e) {
      toast.push(errorMessage(e), "bad");
      setBusy(null);
    }
  }

  async function save() {
    if (!draft) return;
    setBusy("save");
    try {
      const r = await adminFetch<{ ok: true; draft: Draft }>(`/api/admin/drafts/${draft.id}`, fields);
      setState((s) => (s ? { ...s, draft: r.draft } : s));
      setFields(fieldsOf(r.draft));
      toast.push("Saved — draft marked as reviewed", "good");
    } catch (e) {
      toast.push(errorMessage(e), "bad");
    } finally {
      setBusy(null);
    }
  }

  const set = (k: FieldKey) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setFields((f) => ({ ...f, [k]: e.target.value }));

  return (
    <section className="card p-5" aria-labelledby={`draft-panel-${prospectId}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`draft-panel-${prospectId}`} className="text-[20px]">
          Draft
        </h2>
        {draft ? (
          <div className="flex flex-wrap items-center gap-2">
            {draft.fallback ? <Badge variant="warn">Template</Badge> : <Badge variant="info">{draft.model ?? "model"}</Badge>}
            {draft.reviewedAt ? <Badge variant="good">Reviewed {when(draft.reviewedAt)}</Badge> : <Badge variant="bad">Not reviewed</Badge>}
            {draft.editedAt ? <Badge variant="neutral">Edited {when(draft.editedAt)}</Badge> : null}
            {state?.draftStale ? <Badge variant="warn" title="A newer audit has finished since this draft was written">Older audit</Badge> : null}
            <span className="text-[15px] text-fg-muted">{draft.locale === "fr" ? "French" : "English"}</span>
          </div>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-[16px] text-accent-soft">
          {error}
        </p>
      ) : null}

      {!state && busy === "load" ? <p className="mt-3 text-[16px] text-fg-muted">Loading…</p> : null}

      {state && !state.audit ? (
        <EmptyState className="mt-4" title="No finished audit yet" hint="Run an audit first; the draft is written from its results." />
      ) : null}

      {state && state.audit && !draft ? (
        <EmptyState
          className="mt-4"
          title="No draft yet"
          hint={`Writes the email, the call script and a note for you from audit ${state.audit.reference}${state.llm ? ` with ${state.model}` : " (template — no model key configured)"}.`}
          action={
            <Button variant="primary" onClick={generate} loading={busy === "generate"} disabled={busy !== null}>
              Generate draft
            </Button>
          }
        />
      ) : null}

      {state && state.audit && draft ? (
        <div className="mt-4 space-y-4">
          <p className="text-[15px] text-fg-muted">
            From audit {state.audit.reference}
            {state.audit.score !== null ? ` · score ${state.audit.score} of 100${state.audit.grade ? ` (${state.audit.grade})` : ""}` : ""} · To: {state.prospect.displayName}
            {OUTREACH_MODULE ? (
              <>
                {" · "}
                <a href={state.audit.reportUrl} target="_blank" rel="noopener" className="link-accent">
                  Open report
                </a>
              </>
            ) : (
              " · report link shown once the outreach module ships"
            )}
          </p>

          <Field
            label={
              <span className="flex items-center justify-between">
                <span>Subject</span>
                <Count value={fields.subject} cap={state.caps.subject} />
              </span>
            }
            name={`draft-subject-${prospectId}`}
            value={fields.subject}
            onChange={set("subject")}
            maxLength={200}
            autoComplete="off"
          />
          <Textarea
            label={
              <span className="flex items-center justify-between">
                <span>Email body (legal block is added at send time)</span>
                <Count value={fields.body} cap={state.caps.body} />
              </span>
            }
            name={`draft-body-${prospectId}`}
            rows={14}
            value={fields.body}
            onChange={set("body")}
          />
          <Textarea
            label={
              <span className="flex items-center justify-between">
                <span>Call script</span>
                <Count value={fields.callScript} cap={state.caps.callScript} />
              </span>
            }
            name={`draft-call-${prospectId}`}
            rows={6}
            value={fields.callScript}
            onChange={set("callScript")}
          />
          <Textarea
            label={
              <span className="flex items-center justify-between">
                <span>Note for you</span>
                <Count value={fields.noteForOwner} cap={state.caps.noteForOwner} />
              </span>
            }
            name={`draft-note-${prospectId}`}
            rows={3}
            value={fields.noteForOwner}
            onChange={set("noteForOwner")}
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={save} loading={busy === "save"} disabled={busy !== null}>
              {draft.reviewedAt ? (dirty ? "Save changes" : "Save (mark reviewed again)") : "Save and mark as reviewed"}
            </Button>
            {dirty ? (
              <ConfirmButton label="Regenerate" confirmLabel="Discard edits and regenerate?" variant="ghost" onConfirm={generate} loading={busy === "generate"} disabled={busy !== null} />
            ) : (
              <Button variant="ghost" onClick={generate} loading={busy === "generate"} disabled={busy !== null}>
                Regenerate
              </Button>
            )}
            {!draft.reviewedAt ? <span className="text-[15px] text-fg-muted">Sending stays refused until the draft is saved.</span> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
