"use client";

// /admin/leads/[id] — the record page (docs/lead-page-spec.md).
//
// Three bands. Band 1 is the header: who they are, the seven highlights, the
// reach strip (Write / Call / Where), the stage path and five quick actions
// that are in the same place on every lead. Band 2 is the sale: their own
// words first, then the facts, what to propose, the ready reply and the
// questions for the call. Band 3 is the timeline (next step at its head),
// what is linked to the lead, and one collapsed Details drawer holding the
// legal plumbing and the tracking values.
//
// Every fact on this page is derived by buildLeadView() on the server, with
// the same helpers the lead e-mail uses, so the page cannot contradict the
// e-mail. This component receives plain strings and decides nothing.
//
// Every mutation goes through adminFetch (CSRF header) and then
// router.refresh(), so the server page stays the single source of truth.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { OUTREACH_MODULE } from "@/lib/crm/features";
import type { Activity, LeadStage } from "@/lib/crm/types";
import type { DetailSection, LeadView, PhoneState } from "@/lib/inbox/leadView";
import { CALL_OUTCOMES, CALL_OUTCOME_LABELS, DATE_RE, FORWARD_STAGES, STAGE_LABELS, addDays, leadErrorWords, nextForwardStage, nextMoveLabel, parisToday, stopPartlyDoneWords } from "@/lib/inbox/stages";
import { Badge } from "./Badge";
import { Button, buttonClass } from "./Button";
import { ConfirmButton } from "./ConfirmButton";
import { ExtLink } from "./ExtLink";
import { Field, inputClass, labelClass } from "./Field";
import { StageSelect } from "./StageSelect";
import { Textarea } from "./Textarea";
import { Timeline } from "./Timeline";
import { adminFetch } from "./adminFetch";
import { useToast } from "./Toast";

// The forward path, the words on its one button, the five call outcomes and the
// follow-up date arithmetic all live in stages.ts, which the routes read too.
// This file keeps no copy of any of them: a second copy is how the "+2 days"
// chip came to compute its date in UTC while the page read it in Paris.

const HEADING = "text-[15px] uppercase tracking-wide text-fg-faint";

// Buttons whose label is a whole sentence (the repair offer, the reply link
// that has to explain itself). Button/buttonClass carry `whitespace-nowrap`,
// which pushes a sentence off the side of a 390 px screen.
const WRAP_BUTTON = "inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-left text-[15px] leading-snug text-fg-heading hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-60";
const WRAP_PRIMARY = "inline-flex items-center justify-center gap-2 btn-primary px-4 py-2 text-left text-[16px] leading-snug";

/**
 * What a handler hands back when it did two writes and only one landed: the
 * whole sentence to show, already in words. "Mark STOP" is the case — the
 * stage follows even when the opposition list refuses, so the toast has to say
 * both halves without naming the code that failed.
 */
type PartlyDone = { partlyDone: string };

function isPartlyDone(x: unknown): x is PartlyDone {
  return !!x && typeof x === "object" && typeof (x as PartlyDone).partlyDone === "string";
}

function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function run(label: string, fn: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    try {
      const out = await fn();
      if (isPartlyDone(out)) {
        // Something was written, so the page still has to catch up.
        toast.push(out.partlyDone, "bad");
        router.refresh();
        return false;
      }
      toast.push(label, "good");
      router.refresh();
      return true;
    } catch (e) {
      // Never (e as Error).message: adminFetch puts the route's own code there
      // ("lead_without_contact", "http_500"), and a code on Radu's screen is a
      // banned token (components/admin/wording.ts §7). leadErrorWords has a
      // sentence for every code the three routes behind this page answer with.
      toast.push(leadErrorWords(e), "bad");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, run, toast, router };
}

/**
 * Scroll a block into view and put the cursor in the control that block is for
 * — named, because the first focusable element in "Upcoming" is the "+2 days"
 * chip and a quick action called "Set next step" that lands on "+2 days" has
 * not done what it said.
 */
function jump(id: string, focusId?: string) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(() => {
    const target = (focusId && document.getElementById(focusId)) || el.querySelector<HTMLElement>("textarea, input, select, button, a[href]");
    target?.focus({ preventScroll: true });
  }, 300);
}

function Section({ id, title, children, className = "" }: { id: string; title: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={`card space-y-3 p-5 ${className}`} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className={HEADING}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const toast = useToast();
  return (
    <Button
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast.push("Copied", "good");
        } catch {
          toast.push("Copy failed — select the text by hand", "bad");
        }
      }}
    >
      {label}
    </Button>
  );
}

/** A label, a value and a pencil. Saving posts the single field. */
function InlineFact({
  leadId,
  field,
  label,
  value,
  placeholder,
  addLabel,
  children,
}: {
  leadId: number;
  field: "name" | "company" | "email" | "phone";
  label: string;
  value: string | null;
  placeholder?: string;
  /** What the link says when there is nothing stored — §10 wants no "not given" row. */
  addLabel?: string;
  children?: React.ReactNode;
}) {
  const { busy, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  if (!editing) {
    const empty = !value || !value.trim();
    return (
      <span className="inline-flex max-w-full flex-wrap items-center gap-2">
        {empty ? null : (children ?? <span className="min-w-0 break-words text-[16px] text-fg-heading">{value}</span>)}
        <button
          type="button"
          onClick={() => {
            setDraft(value ?? "");
            setEditing(true);
          }}
          className="text-[15px] text-fg-faint underline decoration-dotted hover:text-fg-heading"
          aria-label={`${empty ? "Add" : "Change"} ${label.toLowerCase()}`}
        >
          {empty ? addLabel ?? `add ${label.toLowerCase()}` : "change"}
        </button>
      </span>
    );
  }
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(`${label} saved`, () => adminFetch(`/api/admin/leads/${leadId}`, { [field]: draft.trim() }))) setEditing(false);
      }}
    >
      <Field label={label} name={`lead_${field}`} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} className="min-w-[14rem] flex-1" maxLength={254} />
      <Button type="submit" size="sm" variant="primary" loading={busy}>
        Save
      </Button>
      <Button size="sm" onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </form>
  );
}

/** The three phone states of the spec, plus the repair offer when there is one. */
function CallCell({ leadId, phone, stopped }: { leadId: number; phone: PhoneState; stopped: boolean }) {
  const { busy, run } = useAction();
  return (
    <div className="min-w-0 space-y-1">
      <p className={HEADING}>Call</p>
      {phone.kind === "dialable" && stopped ? (
        <p className="break-words text-[17px] text-fg-muted">{phone.display}</p>
      ) : phone.kind === "dialable" ? (
        <a href={phone.href} className="link-accent block break-words text-[17px]">
          {phone.display}
        </a>
      ) : phone.kind === "unusable" ? (
        <>
          <p className="break-words text-[16px] text-fg-muted">{phone.stored}</p>
          <p className="text-[15px] text-fg-muted">{phone.note}</p>
          {phone.repair && phone.repairNote ? (
            <button
              type="button"
              className={WRAP_BUTTON}
              disabled={busy}
              onClick={async () => {
                await run("Number corrected", async () => {
                  await adminFetch(`/api/admin/leads/${leadId}`, { phone: phone.repair });
                  await adminFetch(`/api/admin/leads/${leadId}/activity`, {
                    kind: "note",
                    // The number as the button offered it, not the digits the
                    // column stores: the timeline is read by a person.
                    text: `Phone corrected from "${phone.stored}" to "${phone.repairDisplay ?? phone.repair}"`,
                  });
                });
              }}
            >
              {phone.repairNote}
            </button>
          ) : null}
        </>
      ) : (
        <p className="text-[16px] text-fg-muted">{phone.note}</p>
      )}
      <InlineFact leadId={leadId} field="phone" label="Phone" value={phone.kind === "none" ? "" : phone.kind === "dialable" ? phone.e164 : phone.stored} placeholder="+1 873 255 7953">
        <span className="sr-only">Phone</span>
      </InlineFact>
    </div>
  );
}

function StagePath({ leadId, stage, stopped, stopNote }: { leadId: number; stage: LeadStage; stopped: boolean; stopNote: string | null }) {
  const { busy, run } = useAction();
  const to = stopped ? null : nextForwardStage(stage);
  const moveLabel = stopped ? null : nextMoveLabel(stage);
  const move = to && moveLabel ? { stage: to, label: moveLabel } : null;
  const index = FORWARD_STAGES.indexOf(stage);

  async function go(to: LeadStage) {
    if (to === "replied") {
      // The customer answering is an inbound message, not a stage tick: the
      // activity route writes the email_in row and moves the stage itself.
      await run("Marked as replied", () => adminFetch(`/api/admin/leads/${leadId}/activity`, { kind: "mark_replied" }));
      return;
    }
    await run(`Moved to ${STAGE_LABELS[to]}`, () => adminFetch(`/api/admin/leads/${leadId}`, { stage: to }));
  }

  return (
    <div className="space-y-2">
      <ol className={`hidden flex-wrap items-center gap-1 sm:flex ${stopped ? "opacity-50" : ""}`}>
        {FORWARD_STAGES.map((s, i) => (
          <li key={s} className="flex items-center gap-1">
            <span className={`text-[15px] ${i === index ? "font-medium text-fg-heading" : i < index ? "text-fg-muted" : "text-fg-faint"}`}>{STAGE_LABELS[s]}</span>
            {i < FORWARD_STAGES.length - 1 ? <span className="text-fg-faint">›</span> : null}
          </li>
        ))}
      </ol>
      {/* The arrow promises a next move; on a stopped lead there is none, and
          the greyed path above says so. */}
      <p className="text-[16px] text-fg-muted sm:hidden">
        Stage: {STAGE_LABELS[stage]}
        {move ? " →" : ""}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {move ? (
          <Button variant="primary" size="md" loading={busy} onClick={() => go(move.stage)}>
            {move.label}
          </Button>
        ) : null}
        <details className="min-w-0">
          <summary className="cursor-pointer text-[15px] text-fg-muted hover:text-fg-heading">Change stage</summary>
          <div className="mt-2">
            <StageSelect leadId={leadId} stage={stage} size="md" />
          </div>
        </details>
      </div>
      {stopped && stopNote ? <p className="text-[16px] text-fg-muted">{stopNote}</p> : null}
    </div>
  );
}

function QuickActions({
  phone,
  email,
  emailHref,
  emailNote,
  hasReplyBlock,
  stopped,
  onSetNextStep,
}: {
  phone: PhoneState;
  email: string | null;
  emailHref: string | null;
  /**
   * Why there is no address, in the same breath as the number — the one
   * sentence buildLeadView derived for the reach strip. A constant here read
   * "call them" next to a Call cell that said the number cannot be dialled.
   */
  emailNote: string | null;
  /** A check-up sits behind the lead, so there is a ready reply to scroll to. */
  hasReplyBlock: boolean;
  stopped: boolean;
  onSetNextStep: () => void;
}) {
  const cellClass = "flex min-h-[44px] items-center justify-center rounded-lg border border-line bg-surface-2/40 px-3 py-2 text-center text-[16px] text-fg-heading hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-60";
  const stopReason = "Asked not to be contacted — every way of reaching them is switched off here.";
  const noAddress = emailNote ?? "No address on file.";
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {hasReplyBlock ? (
        <button type="button" className={cellClass} onClick={() => jump("reply")} disabled={stopped || !email} title={stopped ? stopReason : email ? undefined : noAddress}>
          Write reply
        </button>
      ) : emailHref && !stopped ? (
        // A lead with no check-up has no ready reply to scroll to, so the cell
        // opens the e-mail itself rather than doing nothing.
        <a href={emailHref} className={cellClass}>
          Write reply
        </a>
      ) : (
        <button type="button" className={cellClass} disabled title={stopped ? stopReason : noAddress}>
          Write reply
        </button>
      )}
      {phone.kind === "dialable" && !stopped ? (
        <a href={phone.href} className={cellClass}>
          Call
        </a>
      ) : (
        <button type="button" className={cellClass} disabled title={stopped ? stopReason : phone.kind === "dialable" ? undefined : phone.note}>
          Call
        </button>
      )}
      <button type="button" className={cellClass} onClick={() => jump("log-call")} disabled={stopped} title={stopped ? stopReason : undefined}>
        Log a call
      </button>
      <button type="button" className={cellClass} onClick={onSetNextStep}>
        Set next step
      </button>
      <button type="button" className={cellClass} onClick={() => jump("note")}>
        Add note
      </button>
    </div>
  );
}

function Upcoming({
  leadId,
  upcoming,
  editing,
  setEditing,
}: {
  leadId: number;
  upcoming: LeadView["upcoming"];
  editing: boolean;
  setEditing: (v: boolean) => void;
}) {
  const { busy, run } = useAction();
  const [action, setAction] = useState(upcoming?.action ?? "");
  const [date, setDate] = useState(upcoming?.date ?? "");

  // The form is seeded from the server's values, and every chip above it
  // writes new ones: +2 days, +1 week and Done all end in router.refresh(),
  // which re-renders THIS instance rather than remounting it. Without this
  // the two boxes keep the values of the first render, so Edit re-opened on
  // the old date and Save wrote it back — the follow-up Radu had just moved
  // was silently undone. (React's own "adjust state when a prop changes"
  // pattern: compare, set, and let this render use the new values.)
  const stored = `${upcoming?.action ?? ""}\u0000${upcoming?.date ?? ""}`;
  const [seen, setSeen] = useState(stored);
  if (seen !== stored) {
    setSeen(stored);
    setAction(upcoming?.action ?? "");
    setDate(upcoming?.date ?? "");
  }

  async function save(next: { next_action: string; next_action_at: string }) {
    if (await run("Next step saved", () => adminFetch(`/api/admin/leads/${leadId}`, next))) setEditing(false);
  }

  /**
   * The new date for the +2 days / +1 week chips, counted in Paris the way the
   * column is stored. A stored date that is not a real day ("2026-13-45" gets
   * past the route, which checks the shape only) is counted from today instead
   * of turning into NaN — that threw inside the handler, so the chip looked
   * alive and wrote nothing.
   */
  function shift(days: number): string {
    const stored = upcoming?.date ?? "";
    const base = DATE_RE.test(stored) && Number.isFinite(Date.parse(`${stored}T12:00:00Z`)) ? stored : parisToday();
    return addDays(base, days);
  }

  return (
    <div id="upcoming" className="space-y-2 border-b border-line pb-4">
      <p className={HEADING}>Upcoming</p>
      {upcoming ? (
        <>
          <p className="break-words text-[17px] text-fg-heading">{upcoming.action}</p>
          {upcoming.when ? (
            upcoming.overdue ? (
              <Badge variant="warn">{upcoming.when}</Badge>
            ) : (
              <p className="text-[16px] text-fg-muted">{upcoming.when}</p>
            )
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={busy} onClick={() => save({ next_action: upcoming.action, next_action_at: shift(2) })}>
              +2 days
            </Button>
            <Button size="sm" loading={busy} onClick={() => save({ next_action: upcoming.action, next_action_at: shift(7) })}>
              +1 week
            </Button>
            <Button
              size="sm"
              loading={busy}
              onClick={async () => {
                await run("Next step done", async () => {
                  await adminFetch(`/api/admin/leads/${leadId}`, { next_action: "", next_action_at: "" });
                  await adminFetch(`/api/admin/leads/${leadId}/activity`, { kind: "note", text: `Next step done — ${upcoming.action}` });
                });
              }}
            >
              Done
            </Button>
            <Button size="sm" onClick={() => setEditing(!editing)}>
              Edit
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[16px] text-fg-muted">No next step set.</p>
          <Button size="sm" onClick={() => setEditing(true)}>
            Set one
          </Button>
        </div>
      )}
      {editing ? (
        <form
          className="flex flex-wrap items-end gap-2 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            void save({ next_action: action.trim(), next_action_at: date });
          }}
        >
          <Field label="What is the next move?" name="next_action" value={action} onChange={(e) => setAction(e.target.value)} maxLength={200} className="min-w-[12rem] flex-1" />
          <div>
            <label htmlFor="next_action_at" className={labelClass}>
              When
            </label>
            <input id="next_action_at" name="next_action_at" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputClass} w-auto`} />
          </div>
          <Button type="submit" size="sm" variant="primary" loading={busy}>
            Save
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function NoteBox({ leadId }: { leadId: number }) {
  const { busy, run } = useAction();
  const [text, setText] = useState("");
  return (
    <form
      id="note"
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

function LogCallBox({ leadId, stopped }: { leadId: number; stopped: boolean }) {
  const { busy, run } = useAction();
  const [outcome, setOutcome] = useState("answered");
  const [text, setText] = useState("");
  return (
    <form
      id="log-call"
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run("Call logged", () => adminFetch(`/api/admin/leads/${leadId}/activity`, { kind: "call", outcome, text }))) setText("");
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="call_outcome" className={labelClass}>
            Log a call
          </label>
          <select id="call_outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className={`${inputClass} w-auto`}>
            {CALL_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {CALL_OUTCOME_LABELS[o]}
              </option>
            ))}
          </select>
        </div>
        <Field label="What was said" name="call_note" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} className="min-w-[12rem] flex-1" />
        <Button type="submit" size="sm" loading={busy} disabled={stopped} title={stopped ? "Asked not to be contacted — every way of reaching them is switched off here." : undefined}>
          Log it
        </Button>
      </div>
    </form>
  );
}

function BounceBox({ leadId }: { leadId: number }) {
  const { busy, run } = useAction();
  const [ref, setRef] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
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

type Prepared = { sendId: number; reference: string; subject: string; text: string };

function GmailBox({ prospectId }: { prospectId: number | null }) {
  const { busy, run, toast } = useAction();
  const [prepared, setPrepared] = useState<Prepared | null>(null);

  if (prospectId === null) {
    return (
      <div className="space-y-1">
        <Button size="sm" disabled>
          Sent from Gmail…
        </Button>
        <p className="text-[15px] text-fg-muted">This needs a prospect record — inbound leads do not have one.</p>
      </div>
    );
  }

  async function prepare() {
    try {
      const res = await adminFetch<Prepared & { ok?: boolean }>(`/api/admin/prospects/${prospectId}/manual-send`, { action: "prepare", draftId: "followup" });
      setPrepared({ sendId: res.sendId, reference: res.reference, subject: res.subject, text: res.text });
    } catch (e) {
      toast.push(`The email could not be prepared. ${leadErrorWords(e)}`, "bad");
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
      <p className="text-[15px] text-fg-muted">Follow-up {prepared.reference} — paste this into Gmail (subject and body, legal block included), then confirm.</p>
      <p className="text-[16px] text-fg-heading">{prepared.subject}</p>
      <textarea readOnly rows={8} value={prepared.text} className={`${inputClass} text-[15px]`} />
      <div className="flex flex-wrap gap-2">
        <CopyButton value={`${prepared.subject}\n\n${prepared.text}`} label="Copy email with legal block" />
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

function DetailRows({ section }: { section: DetailSection }) {
  return (
    <div className="space-y-2">
      <h3 className={HEADING}>{section.title}</h3>
      <dl className="space-y-2">
        {section.rows.map((r, i) => (
          <div key={i} className="grid gap-1 sm:grid-cols-[minmax(9rem,32%)_1fr] sm:gap-3">
            <dt className="text-[15px] text-fg-muted">{r.label}</dt>
            <dd className="min-w-0 text-[16px] text-fg-heading">
              <span className="break-all">{r.value}</span>
              {r.copy ? (
                <span className="ml-2 inline-block align-middle">
                  <CopyButton value={r.value} />
                </span>
              ) : null}
              {r.caption ? <p className="text-[15px] text-fg-muted">{r.caption}</p> : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function LeadDetail({ view, activities }: { view: LeadView; activities: Activity[] }) {
  const { busy, run } = useAction();
  const [sent, setSent] = useState(false);
  // The next-step form is opened from two places — the quick action at the top
  // and "Set one" / "Edit" at the head of the timeline — so the state that
  // opens it lives here, above both.
  const [editStep, setEditStep] = useState(false);

  async function markStop() {
    await run("STOP recorded", async () => {
      // The opposition list first (outreach's route); the stage follows even
      // when that call fails, so a STOP is never lost — the toast then says
      // both halves, in words, without naming the code that failed.
      let refusal: unknown = null;
      try {
        await adminFetch("/api/admin/optouts", { lead_id: view.id });
      } catch (e) {
        refusal = e;
      }
      await adminFetch(`/api/admin/leads/${view.id}`, { stage: "stop" });
      // The sentence itself lives in stages.ts, next to the words it ends
      // with, so one test keeps both halves clear of the banned tokens.
      return refusal ? { partlyDone: stopPartlyDoneWords(refusal) } : undefined;
    });
  }

  async function iSentIt(subject: string) {
    if (await run("Reply recorded", () => adminFetch(`/api/admin/leads/${view.id}/activity`, { kind: "sent", text: `Reply sent by hand — ${subject}` }))) setSent(true);
  }

  return (
    <div className="space-y-6">
      {/* ---- Band 1: the header ------------------------------------------------ */}
      <header className="card space-y-4 p-5">
        <div>
          <p className="eyebrow text-[15px]">
            <Link href="/admin/leads" className="hover:text-fg-heading">
              Leads
            </Link>{" "}
            / <span className="font-mono">{view.reference}</span>
          </p>
          <h1 className="mt-1 break-words text-2xl text-fg-heading">{view.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px] text-fg-muted">
            <InlineFact leadId={view.id} field="name" label="Name" value={view.name} placeholder="First name" addLabel="add a name">
              <span className="min-w-0 break-words">Name: {view.name}</span>
            </InlineFact>
            <InlineFact leadId={view.id} field="company" label="Company" value={view.company} placeholder="Business name" addLabel="add a company">
              <span className="min-w-0 break-words">Company: {view.company}</span>
            </InlineFact>
          </div>
        </div>

        {/* Seven at most, in a fixed order. The ones with no tone are given a
            border too: separated by a gap alone, "Not sure yet" and "As soon
            as possible" ran together into one phrase at 390 px. */}
        <div className="flex flex-wrap items-center gap-2">
          {view.highlights.map((h, i) =>
            h.tone ? (
              <Badge key={i} variant={h.tone} title={h.title}>
                {h.text}
              </Badge>
            ) : (
              <span key={i} title={h.title} className="inline-flex max-w-full items-center rounded-full border border-line px-2.5 py-1 text-left text-[16px] leading-tight text-fg-heading">
                {h.text}
              </span>
            ),
          )}
        </div>
        {/* The letter, in words, beside the letter. Radu read "C" as a bad
            lead; it has never meant that. Same sentence as the lead e-mail. */}
        {view.gradeNote ? <p className="text-[15px] leading-snug text-fg-muted">{view.gradeNote}</p> : null}

        <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-3">
          <div className="min-w-0 space-y-1">
            <p className={HEADING}>Write</p>
            {view.reach.email && view.stopped ? (
              <p className="break-all text-[17px] text-fg-muted">{view.reach.email}</p>
            ) : view.reach.email ? (
              <a href={view.reach.emailHref ?? undefined} className="link-accent block break-all text-[17px]">
                {view.reach.email}
              </a>
            ) : (
              <p className="text-[16px] text-fg-muted">{view.reach.emailNote}</p>
            )}
            <InlineFact leadId={view.id} field="email" label="Email" value={view.reach.email} placeholder="name@example.com">
              <span className="sr-only">Email</span>
            </InlineFact>
          </div>
          <CallCell leadId={view.id} phone={view.reach.phone} stopped={view.stopped} />
          <div className="min-w-0 space-y-1">
            <p className={HEADING}>Where</p>
            <p className="break-words text-[17px] text-fg-heading">{view.reach.where}</p>
            {view.reach.whereSecond ? <p className="text-[15px] text-fg-muted">{view.reach.whereSecond}</p> : null}
          </div>
        </div>

        <div className="border-t border-line pt-4">
          <StagePath leadId={view.id} stage={view.stage} stopped={view.stopped} stopNote={view.stopNote} />
        </div>

        <div className="border-t border-line pt-4">
          <QuickActions
            phone={view.reach.phone}
            email={view.reach.email}
            emailHref={view.reach.emailHref}
            emailNote={view.reach.emailNote}
            hasReplyBlock={view.checkup}
            stopped={view.stopped}
            onSetNextStep={() => {
              setEditStep(true);
              jump("upcoming", "next_action");
            }}
          />
        </div>
      </header>

      {/* ---- Bands 2 and 3 ----------------------------------------------------- */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-6">
          <Section id="said" title="What they said">
            {view.words.quotes.map((q, i) => (
              <div key={i} className="space-y-1">
                <p className="text-[15px] text-fg-muted">{q.label}</p>
                <blockquote className="whitespace-pre-wrap break-words border-l-2 border-line-strong pl-3 text-[17px] text-fg-heading">{q.text}</blockquote>
              </div>
            ))}
            {view.words.inbound ? (
              <div className="space-y-1">
                <p className="text-[15px] text-fg-muted">{view.words.inbound.label}</p>
                <blockquote className="whitespace-pre-wrap break-words border-l-2 border-line-strong pl-3 text-[17px] text-fg-heading">{view.words.inbound.text}</blockquote>
              </div>
            ) : null}
            {view.words.empty ? <p className="text-[16px] text-fg-muted">{view.words.empty}</p> : null}
          </Section>

          {view.facts ? (
            <Section id="facts" title="The facts that decide the sale">
              {view.facts.rows ? (
                <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                  {view.facts.rows.map((f) => (
                    <div key={f.label} className="grid grid-cols-[minmax(7rem,40%)_1fr] gap-3">
                      <dt className="text-[15px] text-fg-muted">{f.label}</dt>
                      <dd className="min-w-0 break-words text-[16px] text-fg-heading">{f.href ? <ExtLink href={f.href} /> : f.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-[16px] text-fg-muted">{view.facts.note}</p>
              )}
            </Section>
          ) : null}

          {view.propose ? (
            <Section id="propose" title="What to propose">
              {view.propose.lines ? <p className="text-[17px] text-fg-heading">{view.propose.lines}</p> : null}
              {view.propose.price ? <p className="text-[16px] text-fg">Price that fits: {view.propose.price}</p> : null}
              {/* A Badge variant, not a colour: the light admin theme lands on
                  top of this file without touching it (spec §9). */}
              {view.propose.noFit ? <Badge variant="warn">{view.propose.noFit}</Badge> : null}
              {view.propose.why ? <p className="whitespace-pre-wrap text-[16px] text-fg">{view.propose.why}</p> : null}
              {view.propose.note ? <p className="text-[16px] text-fg-muted">{view.propose.note}</p> : null}
            </Section>
          ) : null}

          {view.checkup ? (
            <Section id="reply" title="The ready reply">
              {view.reply ? (
                <>
                  <p className="text-[16px] text-fg-heading">{view.reply.subject}</p>
                  <p className="whitespace-pre-wrap break-words text-[16px] text-fg">{view.reply.body}</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {view.stopped ? (
                      <Button disabled title={view.stopNote ?? undefined}>
                        {view.reply.label}
                      </Button>
                    ) : view.reply.href ? (
                      <a href={view.reply.href} className={WRAP_PRIMARY}>
                        {view.reply.label}
                      </a>
                    ) : (
                      <Button disabled>{view.reply.label}</Button>
                    )}
                    <CopyButton value={`${view.reply.subject}\n\n${view.reply.body}`} />
                    <Button
                      size="md"
                      loading={busy}
                      // No address means the button beside this one reads "No
                      // address to send to": recording a reply that could not
                      // be sent would move the stage on a lie.
                      disabled={sent || view.stopped || !view.reach.email}
                      title={view.stopped ? (view.stopNote ?? undefined) : view.reach.email ? undefined : (view.reply.note ?? undefined)}
                      onClick={() => iSentIt(view.reply!.subject)}
                    >
                      {sent ? "Recorded" : "I sent it"}
                    </Button>
                  </div>
                  {view.reply.note ? <p className="text-[15px] text-fg-muted">{view.reply.note}</p> : null}
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-[16px] text-fg-muted">{view.noReply ?? "No draft — the AI triage did not answer. Write the reply yourself; the facts above are what you have."}</p>
                  {view.reach.emailHref && !view.stopped ? (
                    <a href={view.reach.emailHref} className={buttonClass("ghost", "sm")}>
                      Write
                    </a>
                  ) : null}
                </div>
              )}
            </Section>
          ) : null}

          {view.ask ? (
            <Section id="ask" title="Ask them">
              {view.ask.questions.length ? (
                <ol className="list-decimal space-y-1 pl-5 text-[16px] text-fg">
                  {view.ask.questions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ol>
              ) : null}
              {view.ask.unknowns ? (
                <div className="space-y-1">
                  <p className={HEADING}>Still unknown</p>
                  <p className="text-[16px] text-fg">{view.ask.unknowns}</p>
                </div>
              ) : null}
            </Section>
          ) : null}
        </div>

        <div className="min-w-0 space-y-6">
          <Section id="timeline" title="Timeline">
            <Upcoming leadId={view.id} upcoming={view.upcoming} editing={editStep} setEditing={setEditStep} />
            <div className="pt-1">
              <p className={HEADING}>Past</p>
              <div className="mt-2">
                <Timeline activities={activities} />
              </div>
            </div>
            <div className="border-t border-line pt-4">
              <LogCallBox leadId={view.id} stopped={view.stopped} />
            </div>
            <div className="border-t border-line pt-4">
              <NoteBox leadId={view.id} />
            </div>
          </Section>

          {view.related.length ? (
            <Section id="related" title="Linked to this lead">
              <dl className="space-y-2">
                {view.related.map((r, i) => (
                  <div key={i} className="grid grid-cols-[minmax(7rem,35%)_1fr] gap-3">
                    <dt className="text-[15px] text-fg-muted">{r.label}</dt>
                    <dd className="min-w-0 break-words text-[16px] text-fg-heading">
                      {r.href ? (
                        <Link href={r.href} className="link-accent">
                          {r.value}
                        </Link>
                      ) : (
                        r.value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </Section>
          ) : null}
        </div>
      </div>

      {/* ---- Band 3: everything the sale does not need -------------------------- */}
      <details className="card p-5">
        <summary className="cursor-pointer text-[16px] text-fg-heading">Details</summary>
        <div className="mt-4 space-y-6">
          {view.origin.sentence || view.origin.heard || view.origin.rollup ? (
            <div className="space-y-2">
              <h3 className={HEADING}>Where it came from</h3>
              {view.origin.sentence ? <p className="text-[16px] text-fg">{view.origin.sentence}</p> : null}
              {view.origin.heard ? <p className="text-[16px] text-fg-muted">{view.origin.heard}</p> : null}
              {view.origin.rollup ? <p className="text-[16px] text-fg-muted">{view.origin.rollup}</p> : null}
            </div>
          ) : null}
          {view.details.map((section, i) => (
            <DetailRows key={i} section={section} />
          ))}
          <div className="space-y-3 border-t border-line pt-4">
            <h3 className={HEADING}>Tools</h3>
            {OUTREACH_MODULE ? <GmailBox prospectId={view.prospectId} /> : null}
            <BounceBox leadId={view.id} />
            {OUTREACH_MODULE ? (
              <ConfirmButton label="Mark STOP" confirmLabel="Confirm STOP — no more contact" onConfirm={markStop} size="sm" disabled={view.stopped} loading={busy} />
            ) : (
              <p className="text-[15px] text-fg-muted">Mark STOP arrives with the outreach module (opt-out list, legal block, call rules).</p>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}
