"use client";

// /admin/leads/[id]: facts, stage, next action + notes, quick actions, the
// diagnostic triage when there is one, and the timeline. Every mutation goes
// through adminFetch (CSRF header) and then router.refresh(), so the server
// page stays the single source of truth. "Log call" and "Sent from Gmail"
// post to outreach's prospect routes and only show when a prospect is linked;
// "Mark STOP" writes the opt-out list first, then the stage.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Activity, Lead } from "@/lib/crm/types";
import type { EnquirySummary, ProspectSummary } from "@/lib/inbox/leads";
import { KIND_LABELS, STAGE_LABELS, STAGE_TONE, fmtDate, fmtDateTime, leadTitle } from "@/lib/inbox/stages";
import { Badge } from "./Badge";
import { Button, buttonClass } from "./Button";
import { ConfirmButton } from "./ConfirmButton";
import { ExtLink } from "./ExtLink";
import { Field, inputClass, labelClass } from "./Field";
import { KeyValue } from "./KeyValue";
import { NextActionForm } from "./NextActionForm";
import { StageSelect } from "./StageSelect";
import { Textarea } from "./Textarea";
import { Timeline } from "./Timeline";
import { adminFetch } from "./adminFetch";
import { useToast } from "./Toast";

const LEGAL_BASIS: Record<Lead["legalBasis"], string> = { request: "Their request", legitimate_interest: "Legitimate interest" };

function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function run(label: string, fn: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    try {
      await fn();
      toast.push(label, "good");
      router.refresh();
      return true;
    } catch (e) {
      toast.push(`${label} failed: ${(e as Error).message}`, "bad");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, run, toast, router };
}

function NoteBox({ leadId }: { leadId: number }) {
  const { busy, run } = useAction();
  const [text, setText] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        if (await run("Note added", () => adminFetch(`/api/admin/leads/${leadId}/activity`, { kind: "note", text }))) setText("");
      }}
    >
      <Textarea label="Add a note to the timeline" name="timeline_note" rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
      <Button type="submit" size="sm" loading={busy} disabled={!text.trim()}>
        Add note
      </Button>
    </form>
  );
}

function BounceBox({ leadId }: { leadId: number }) {
  const { busy, run } = useAction();
  const [ref, setRef] = useState("");
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run("Bounce recorded", () => adminFetch(`/api/admin/leads/${leadId}/activity`, { kind: "bounce", send_reference: ref }))) setRef("");
      }}
    >
      <Field label="Bounced send" name="send_reference" placeholder="SN-XXXXX" value={ref} onChange={(e) => setRef(e.target.value.toUpperCase())} maxLength={8} className="w-40" />
      <Button type="submit" size="sm" loading={busy} disabled={!/^SN-[23456789A-Z]{5}$/.test(ref)}>
        Log bounce
      </Button>
    </form>
  );
}

const OUTCOMES = [
  { value: "no_answer", label: "No answer" },
  { value: "answered", label: "Answered" },
  { value: "callback", label: "Call back later" },
  { value: "refused", label: "Refused — do not call again" },
  { value: "wrong_number", label: "Wrong number" },
];

function CallBox({ prospectId, country }: { prospectId: number; country: string }) {
  const { busy, run } = useAction();
  const [outcome, setOutcome] = useState("no_answer");
  const [note, setNote] = useState("");
  const [tps, setTps] = useState(false);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const body: Record<string, unknown> = { outcome, note };
        if (country === "GB") body.tpsChecked = tps;
        if (await run("Call logged", () => adminFetch(`/api/admin/prospects/${prospectId}/call`, body))) setNote("");
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="call_outcome" className={labelClass}>
            Log call
          </label>
          <select id="call_outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className={`${inputClass} w-auto`}>
            {OUTCOMES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <Field label="Note" name="call_note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="min-w-[12rem] flex-1" />
        <Button type="submit" size="sm" loading={busy}>
          Log call
        </Button>
      </div>
      {country === "GB" ? (
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <input type="checkbox" checked={tps} onChange={(e) => setTps(e.target.checked)} />
          Screened against TPS and CTPS today (PECR reg 21)
        </label>
      ) : null}
    </form>
  );
}

type Prepared = { sendId: number; reference: string; subject: string; text: string };

function GmailBox({ prospectId }: { prospectId: number }) {
  const { busy, run, toast } = useAction();
  const [prepared, setPrepared] = useState<Prepared | null>(null);

  async function prepare() {
    try {
      const res = await adminFetch<Prepared & { ok?: boolean }>(`/api/admin/prospects/${prospectId}/manual-send`, { action: "prepare", draftId: "followup" });
      setPrepared({ sendId: res.sendId, reference: res.reference, subject: res.subject, text: res.text });
    } catch (e) {
      toast.push(`Could not prepare the email: ${(e as Error).message}`, "bad");
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

  if (!prepared) {
    return (
      <Button size="sm" onClick={prepare}>
        Sent from Gmail…
      </Button>
    );
  }
  return (
    <div className="card space-y-2 p-4">
      <p className="text-sm text-fg-muted">
        Follow-up {prepared.reference} — paste this into Gmail (subject and body, legal block included), then confirm.
      </p>
      <p className="text-sm text-fg-heading">{prepared.subject}</p>
      <textarea readOnly rows={8} value={prepared.text} className={`${inputClass} font-mono text-xs`} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={copy}>
          Copy email with legal block
        </Button>
        <Button
          size="sm"
          variant="primary"
          loading={busy}
          onClick={async () => {
            if (await run("Recorded as sent", () => adminFetch(`/api/admin/prospects/${prospectId}/manual-send`, { action: "record", sendId: prepared.sendId }))) setPrepared(null);
          }}
        >
          I sent it from Gmail
        </Button>
        <Button size="sm" onClick={() => setPrepared(null)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function LeadDetail({
  lead,
  activities,
  prospect,
  enquiry,
}: {
  lead: Lead;
  activities: Activity[];
  prospect: ProspectSummary | null;
  enquiry: EnquirySummary | null;
}) {
  const { busy, run } = useAction();

  async function markReplied() {
    await run("Marked as replied", () => adminFetch(`/api/admin/leads/${lead.id}/activity`, { kind: "mark_replied" }));
  }

  async function markStop() {
    await run("STOP recorded", async () => {
      // The opposition list first (outreach's route); the stage follows even
      // when that call fails, so a STOP is never lost — the toast says which.
      let optoutError: string | null = null;
      try {
        await adminFetch("/api/admin/optouts", { lead_id: lead.id });
      } catch (e) {
        optoutError = (e as Error).message;
      }
      await adminFetch(`/api/admin/leads/${lead.id}`, { stage: "stop" });
      if (optoutError) throw new Error(`stage set, but the opt-out list was not updated (${optoutError})`);
    });
  }

  const attribution = lead.attribution ? Object.entries(lead.attribution).filter(([, v]) => v) : [];

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">
            <Link href="/admin/leads" className="hover:text-fg-heading">
              Leads
            </Link>{" "}
            / <span className="font-mono">{lead.reference}</span>
          </p>
          <h1 className="mt-1 text-2xl text-fg-heading">{leadTitle(lead)}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            <Badge>{KIND_LABELS[lead.kind]}</Badge>
            <Badge variant={STAGE_TONE[lead.stage]}>{STAGE_LABELS[lead.stage]}</Badge>
            <span>{lead.sourceLabel ?? "Direct"}</span>
            <span>· created {fmtDateTime(lead.createdAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {prospect ? (
            <Link href={`/admin/prospects/${prospect.id}`} className={buttonClass("ghost", "sm")}>
              Prospect {prospect.reference}
            </Link>
          ) : null}
          <StageSelect leadId={lead.id} stage={lead.stage} size="md" />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="card space-y-5 p-5" aria-labelledby="facts">
          <h2 id="facts" className="text-xs uppercase tracking-wide text-fg-faint">
            Facts
          </h2>
          <KeyValue
            columns={2}
            items={[
              { label: "Name", value: lead.name },
              { label: "Company", value: lead.company },
              { label: "Email", value: lead.email },
              { label: "Phone", value: lead.phone },
              { label: "Language", value: lead.locale === "fr" ? "French" : "English" },
              { label: "Country", value: lead.country },
              { label: "Legal basis", value: LEGAL_BASIS[lead.legalBasis] },
              { label: "Data from", value: lead.dataSource },
              { label: "Notice sent", value: lead.noticeSentAt ? fmtDateTime(lead.noticeSentAt) : null },
              { label: "Replied", value: lead.repliedAt ? fmtDateTime(lead.repliedAt) : null },
              { label: "Closed", value: lead.closedAt ? `${fmtDateTime(lead.closedAt)} (${lead.closeReason ?? "—"})` : null },
              { label: "Last activity", value: fmtDateTime(lead.lastActivityAt) },
              {
                label: "Diagnostic",
                value: enquiry ? `${enquiry.reference} · grade ${enquiry.grade}${enquiry.urgent ? " · urgent" : ""} · ${enquiry.proposed}` : lead.enquiryReference,
              },
              {
                label: "Prospect",
                value: prospect ? (
                  <span>
                    <Link href={`/admin/prospects/${prospect.id}`} className="link-accent">
                      {prospect.reference}
                    </Link>{" "}
                    {prospect.name}
                    {prospect.latestAuditReference ? ` · ${prospect.latestAuditReference}` : ""}
                    {typeof prospect.latestScore === "number" ? ` · ${prospect.latestScore}/100` : ""}
                    {prospect.website ? (
                      <>
                        {" · "}
                        <ExtLink href={prospect.website} />
                      </>
                    ) : null}
                  </span>
                ) : null,
              },
              { label: "Attribution", value: attribution.length ? attribution.map(([k, v]) => `${k}=${v}`).join(" · ") : null, muted: true },
            ]}
          />

          {enquiry && (enquiry.replyDraft || enquiry.noteForRadu) ? (
            <details className="rounded-lg border border-line bg-surface-2/40 p-4">
              <summary className="cursor-pointer text-sm text-fg-heading">
                Diagnostic triage{enquiry.subjectSummary ? ` — ${enquiry.subjectSummary}` : ""}
              </summary>
              {enquiry.replyDraft ? (
                <div className="mt-3">
                  <p className="text-xs uppercase tracking-wide text-fg-faint">Ready reply</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-fg">{enquiry.replyDraft}</p>
                </div>
              ) : null}
              {enquiry.noteForRadu ? (
                <div className="mt-3">
                  <p className="text-xs uppercase tracking-wide text-fg-faint">Strategy note</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-fg">{enquiry.noteForRadu}</p>
                </div>
              ) : null}
              <p className="mt-3 text-xs text-fg-faint">Triage email: {enquiry.mailStatus ?? "unknown"} · submitted {fmtDate(enquiry.createdAt)}</p>
            </details>
          ) : null}

          <div className="space-y-4 border-t border-line pt-4">
            <h3 className="text-xs uppercase tracking-wide text-fg-faint">Actions</h3>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" loading={busy} onClick={markReplied} disabled={lead.stage === "stop"}>
                Mark replied
              </Button>
              {prospect ? <GmailBox prospectId={prospect.id} /> : null}
              <ConfirmButton label="Mark STOP" confirmLabel="Confirm STOP — no more contact" onConfirm={markStop} size="sm" disabled={lead.stage === "stop"} loading={busy} />
            </div>
            {prospect ? <CallBox prospectId={prospect.id} country={prospect.country} /> : null}
            <BounceBox leadId={lead.id} />
            <NoteBox leadId={lead.id} />
          </div>
        </section>

        <section className="card p-5" aria-labelledby="next">
          <h2 id="next" className="mb-4 text-xs uppercase tracking-wide text-fg-faint">
            Next action &amp; notes
          </h2>
          <NextActionForm leadId={lead.id} nextAction={lead.nextAction} nextActionAt={lead.nextActionAt} note={lead.note} />
        </section>
      </div>

      <section className="card p-5" aria-labelledby="timeline">
        <h2 id="timeline" className="mb-4 text-xs uppercase tracking-wide text-fg-faint">
          Timeline
        </h2>
        <Timeline activities={activities} />
      </section>
    </div>
  );
}
