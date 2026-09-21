"use client";

// Every control on the lead page that does something, in one place: the stage
// path, the five quick actions, the next step, the call log, the note box, the
// inline edits and the three that live in Details (STOP, a bounce, Sent from
// Gmail). The page (LeadDetail.tsx) composes them and never posts to a route
// itself.
//
// Three rules hold here:
//  1. Nothing is gated on a prospect. An inbound lead has no prospect record,
//     and a control that disappears is a control Radu cannot find twice.
//     A cell that cannot work stays visible, is disabled, and carries its
//     one-line reason.
//  2. No route code reaches the screen. Every failure is translated into a
//     sentence (errorWords) — the codes are for the log, not for a person.
//  3. Every write goes through adminFetch (CSRF header), tells the timeline
//     about itself so the page does not appear to argue with the person using
//     it, then calls router.refresh() so the server page stays the truth.
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Activity, ActivityKind, LeadStage } from "@/lib/crm/types";
import { OUTREACH_MODULE } from "@/lib/crm/features";
import {
  CALL_OUTCOMES,
  CALL_OUTCOME_LABELS,
  FORWARD_STAGES,
  STAGE_LABELS,
  STAGE_TONE,
  addDays,
  dueWords,
  fmtDate,
  isClosedStage,
  nextForwardStage,
  nextMoveLabel,
  parisToday,
  type CallLogOutcome,
} from "@/lib/inbox/stages";
import { Badge } from "./Badge";
import { Button, buttonClass } from "./Button";
import { ConfirmButton } from "./ConfirmButton";
import { Field, inputClass } from "./Field";
import { Select } from "./Select";
import { StageSelect } from "./StageSelect";
import { Textarea } from "./Textarea";
import { adminFetch } from "./adminFetch";
import { useToast } from "./Toast";

/** One sentence, used everywhere a control is switched off because they asked us to stop. */
export const STOP_REASON = "Asked not to be contacted — every way of reaching them is switched off here.";

/**
 * Ids the quick actions jump to. The blocks that own them are here; the page
 * puts the same ids on the reply block it renders itself.
 */
export const LEAD_ANCHORS = {
  reply: "lead-reply",
  logCall: "lead-log-call",
  nextStep: "lead-next-step",
  note: "lead-note",
} as const;

const JUMP_EVENT = "dm-lead-jump";

/**
 * Scroll a block into view, tell it it is the target, then put the cursor in
 * its first control. False when that block is not on this page — the caller
 * then does the next best thing rather than looking broken.
 */
function jumpTo(id: string): boolean {
  const el = typeof document === "undefined" ? null : document.getElementById(id);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  window.dispatchEvent(new CustomEvent<string>(JUMP_EVENT, { detail: id }));
  window.setTimeout(() => {
    const target = el.querySelector<HTMLElement>("input, textarea, select, button:not([disabled]), a[href]");
    target?.focus({ preventScroll: true });
  }, 80);
  return true;
}

/** A block that opens itself when a quick action points at it. */
function useJumpTarget(id: string, onJump: () => void) {
  useEffect(() => {
    const handle = (e: Event) => {
      if ((e as CustomEvent<string>).detail === id) onJump();
    };
    window.addEventListener(JUMP_EVENT, handle);
    return () => window.removeEventListener(JUMP_EVENT, handle);
  });
}

// ---- failures in words ----------------------------------------------------------

// The routes answer with a short code. None of them belongs on a screen.
const ERROR_WORDS: Record<string, string> = {
  email: "That address does not look right.",
  outcome: "Pick what happened on the call first.",
  text: "Type something first.",
  stage: "That is not one of the nine stages.",
  kind: "This page asked for something the server does not do.",
  empty: "Nothing to save.",
  not_found: "This lead is no longer in the database — reload the page.",
  bad_id: "This lead is no longer in the database — reload the page.",
  bad_request: "The page sent something the server could not read.",
  send_not_found: "No send with that reference.",
  server_error: "The server had a problem. Try again in a minute.",
};

function errorWords(e: unknown): string {
  const code = e instanceof Error ? e.message : String(e);
  if (ERROR_WORDS[code]) return ERROR_WORDS[code];
  if (code === "next_action_at") return "That date could not be read.";
  if (code === "send_reference") return "A send reference looks like SN-ABCDE.";
  return "It did not go through. Try again.";
}

function useLeadAction() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (done: string, fn: () => Promise<string | void>): Promise<boolean> => {
      setBusy(true);
      try {
        const instead = await fn();
        toast.push(typeof instead === "string" ? instead : done, "good");
        router.refresh();
        return true;
      } catch (e) {
        toast.push(errorWords(e), "bad");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [router, toast],
  );
  return { busy, run, toast };
}

// ---- the timeline answering straight away ---------------------------------------

/** A row written in this tab, shown at the head of the timeline until the server catches up. */
export interface PendingActivity {
  key: number;
  kind: ActivityKind;
  channel: Activity["channel"];
  actor: Activity["actor"];
  summary: string;
}

type PendingApi = { rows: PendingActivity[]; push: (row: Omit<PendingActivity, "key">) => void };

const PendingCtx = createContext<PendingApi | null>(null);

/**
 * Wrap the page in this and pass how many activities the server sent. Every
 * write below adds its row immediately; the list is dropped as soon as the
 * server's own list changes, which is what router.refresh() produces.
 */
export function PendingActivitiesProvider({ serverCount, children }: { serverCount: number; children: React.ReactNode }) {
  const [rows, setRows] = useState<PendingActivity[]>([]);
  useEffect(() => {
    setRows([]);
  }, [serverCount]);
  const push = useCallback((row: Omit<PendingActivity, "key">) => {
    setRows((cur) => [{ ...row, key: Date.now() + cur.length }, ...cur]);
  }, []);
  const value = useMemo<PendingApi>(() => ({ rows, push }), [rows, push]);
  return <PendingCtx.Provider value={value}>{children}</PendingCtx.Provider>;
}

/** Rows written in this tab and not yet in the server's list — the timeline renders them first. */
export function usePendingActivities(): PendingActivity[] {
  return useContext(PendingCtx)?.rows ?? [];
}

function usePushPending(): (row: Omit<PendingActivity, "key">) => void {
  const ctx = useContext(PendingCtx);
  return ctx ? ctx.push : noop;
}

function noop() {
  /* no provider: the page still refreshes, it just does not answer instantly */
}

// ---- the stage path -------------------------------------------------------------

/**
 * The six forward stages as a path, one button naming the next move, and the
 * nine-option select folded away for the moves that go backwards or close the
 * lead. "They replied" is the customer's move, so it is written as an inbound
 * reply, not as a stage we set.
 */
export function StagePath({ leadId, stage }: { leadId: number; stage: LeadStage }) {
  const { busy, run } = useLeadAction();
  const push = usePushPending();
  const next = nextForwardStage(stage);
  const label = nextMoveLabel(stage);
  const stopped = stage === "stop";
  const here = FORWARD_STAGES.indexOf(stage);

  async function move() {
    if (!next || !label) return;
    if (next === "replied") {
      const ok = await run("Marked as replied", () => adminFetch(`/api/admin/leads/${leadId}/activity`, { kind: "mark_replied" }));
      if (ok) push({ kind: "email_in", channel: "email", actor: "prospect", summary: "Reply received" });
      return;
    }
    const ok = await run(`Stage: ${STAGE_LABELS[next]}`, () => adminFetch(`/api/admin/leads/${leadId}`, { stage: next }));
    if (ok) push({ kind: "stage_change", channel: "system", actor: "admin", summary: `Stage: ${STAGE_LABELS[stage]} → ${STAGE_LABELS[next]}` });
  }

  return (
    <div className="space-y-3">
      <ol className={`hidden flex-wrap items-center gap-x-2 gap-y-1 sm:flex ${stopped ? "opacity-50" : ""}`} aria-label="Stage">
        {FORWARD_STAGES.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            {i > 0 ? (
              <span aria-hidden="true" className="text-fg-faint">
                ›
              </span>
            ) : null}
            {s === stage ? (
              <Badge variant={STAGE_TONE[s]}>{STAGE_LABELS[s]}</Badge>
            ) : (
              <span className={`text-[15px] ${here >= 0 && i < here ? "text-fg-muted" : "text-fg-faint"}`}>{STAGE_LABELS[s]}</span>
            )}
          </li>
        ))}
      </ol>
      <p className="text-[16px] text-fg-muted sm:hidden">
        Stage: <span className="text-fg-heading">{STAGE_LABELS[stage]}</span>
        {label ? " →" : ""}
      </p>

      {stopped ? <p className="text-[16px] text-fg-muted">{STOP_REASON}</p> : null}
      {!stopped && isClosedStage(stage) ? (
        <p className="text-[16px] text-fg-muted">Closed as {STAGE_LABELS[stage].toLowerCase()} — use Change stage to open it again.</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {label ? (
          <Button variant="primary" size="md" loading={busy} onClick={move} className="min-h-[44px]">
            {label}
          </Button>
        ) : null}
        <details className="text-[15px]">
          <summary className="cursor-pointer text-fg-muted hover:text-fg-heading">Change stage</summary>
          <div className="mt-2">
            <StageSelect leadId={leadId} stage={stage} size="md" />
          </div>
        </details>
      </div>
    </div>
  );
}

// ---- the five quick actions -----------------------------------------------------

interface QuickActionsProps {
  /** Part of the contract with the page; the cells jump inside this one lead's page. */
  leadId: number;
  stage: LeadStage;
  email: string | null;
  /** "tel:+18732557953" when the stored number can actually be dialled, else null. */
  telHref: string | null;
  /** Why the number cannot be used, when it cannot. */
  phoneNote: string | null;
}

interface QuickCell {
  label: string;
  href?: string;
  anchor?: string;
  /** Used when the block this cell points at is not on the page. */
  fallbackHref?: string;
  disabled?: boolean;
  reason?: string;
}

/**
 * The same five cells on every lead, in the same order, in every stage. Never
 * gated on a prospect: "Sent from Gmail" and the outreach calling rules are the
 * two things that genuinely need one, and they live in Details.
 */
export function QuickActions({ stage, email, telHref, phoneNote }: QuickActionsProps) {
  const stopped = stage === "stop";
  const cells: QuickCell[] = [
    {
      label: "Write reply",
      anchor: LEAD_ANCHORS.reply,
      // No check-up behind the lead means no draft block to jump to: open a
      // blank message to them instead of doing nothing.
      fallbackHref: email ? `mailto:${email}` : undefined,
      disabled: stopped || !email,
      reason: stopped ? STOP_REASON : email ? undefined : "no address on file — call them",
    },
    {
      label: "Call",
      href: telHref ?? undefined,
      disabled: stopped || !telHref,
      reason: stopped ? STOP_REASON : telHref ? undefined : (phoneNote ?? "no number — e-mail only"),
    },
    { label: "Log a call", anchor: LEAD_ANCHORS.logCall, disabled: stopped, reason: stopped ? STOP_REASON : undefined },
    { label: "Set next step", anchor: LEAD_ANCHORS.nextStep },
    { label: "Add note", anchor: LEAD_ANCHORS.note },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {cells.map((cell) => (
        <div key={cell.label} className="flex flex-col gap-1">
          {cell.href && !cell.disabled ? (
            <a href={cell.href} className={buttonClass("ghost", "md", "min-h-[44px] w-full")}>
              {cell.label}
            </a>
          ) : (
            <button
              type="button"
              disabled={cell.disabled}
              title={cell.reason}
              onClick={() => {
                const found = cell.anchor ? jumpTo(cell.anchor) : false;
                if (!found && cell.fallbackHref) window.location.href = cell.fallbackHref;
              }}
              className={buttonClass("ghost", "md", "min-h-[44px] w-full")}
            >
              {cell.label}
            </button>
          )}
          {cell.reason ? <span className="text-[15px] leading-snug text-fg-faint">{cell.reason}</span> : null}
        </div>
      ))}
    </div>
  );
}

// ---- the next step --------------------------------------------------------------

/**
 * The follow-up, in the one place it is set: the line with how long is left,
 * the four chips, and the form. It does not touch the note column — that is
 * what made a customer's own message one Save away from gone.
 */
export function Upcoming({ leadId, nextAction, nextActionAt }: { leadId: number; nextAction: string | null; nextActionAt: string | null }) {
  const { busy, run } = useLeadAction();
  const push = usePushPending();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState(nextAction ?? "");
  const [date, setDate] = useState(nextActionAt ?? "");
  useJumpTarget(LEAD_ANCHORS.nextStep, () => setOpen(true));

  const has = Boolean(nextAction || nextActionAt);
  const due = nextActionAt ? dueWords(nextActionAt, parisToday()) : null;

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    const ok = await run("Next step saved", () => adminFetch(`/api/admin/leads/${leadId}`, { next_action: action, next_action_at: date }));
    if (ok) setOpen(false);
  }

  async function bump(days: number) {
    const at = addDays(nextActionAt || parisToday(), days);
    const ok = await run(`Moved to ${fmtDate(at)}`, () => adminFetch(`/api/admin/leads/${leadId}`, { next_action_at: at }));
    if (ok) setDate(at);
  }

  async function markDone() {
    const was = (nextAction ?? "").trim() || "the next step";
    const summary = `Next step done — ${was}`;
    const ok = await run("Next step done", async () => {
      await adminFetch(`/api/admin/leads/${leadId}`, { next_action: "", next_action_at: "" });
      await adminFetch(`/api/admin/leads/${leadId}/activity`, { kind: "note", text: summary });
    });
    if (ok) {
      setAction("");
      setDate("");
      setOpen(false);
      push({ kind: "note", channel: null, actor: "admin", summary });
    }
  }

  return (
    <div id={LEAD_ANCHORS.nextStep} className="space-y-3">
      {has ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[16px] text-fg-heading">{nextAction || "Follow up"}</p>
            {due ? <Badge variant={due.overdue ? "warn" : "neutral"}>{due.text}</Badge> : <span className="text-[15px] text-fg-muted">no date set</span>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" loading={busy} onClick={() => bump(2)}>
              +2 days
            </Button>
            <Button size="sm" loading={busy} onClick={() => bump(7)}>
              +1 week
            </Button>
            <Button size="sm" loading={busy} onClick={markDone}>
              Done
            </Button>
            <Button size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              Edit
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[16px] text-fg-muted">No next step set.</p>
          {!open ? (
            <Button size="sm" onClick={() => setOpen(true)}>
              Set one
            </Button>
          ) : null}
        </div>
      )}

      {open ? (
        <form onSubmit={save} className="space-y-3 border-t border-line pt-3">
          <Field
            label="Next step"
            name="nextStep"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="Call back, send the proposal…"
            maxLength={200}
          />
          <Field label="Due" name="nextStepDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="sm:max-w-[16rem]" />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" size="sm" loading={busy}>
              Save
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setOpen(false);
                setAction(nextAction ?? "");
                setDate(nextActionAt ?? "");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

// ---- logging a call -------------------------------------------------------------

/**
 * What happened on a call, on any lead — with or without a prospect behind it.
 * The outreach call route keeps the calling hours, the four-attempts counter
 * and the screening; those are rules for ringing a stranger, and this is a
 * person who wrote to us.
 */
export function LogCallBox({ leadId }: { leadId: number }) {
  const { busy, run } = useLeadAction();
  const push = usePushPending();
  const [outcome, setOutcome] = useState<CallLogOutcome>("no_answer");
  const [note, setNote] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const summary = `Call — ${CALL_OUTCOME_LABELS[outcome]}${note.trim() ? ` · ${note.trim()}` : ""}`;
    const ok = await run("Call logged", () => adminFetch(`/api/admin/leads/${leadId}/activity`, { kind: "call", outcome, text: note }));
    if (ok) {
      setNote("");
      push({ kind: "call", channel: "phone", actor: "admin", summary });
    }
  }

  return (
    <form id={LEAD_ANCHORS.logCall} onSubmit={submit} className="space-y-3">
      <Select
        label="What happened"
        name="callOutcome"
        value={outcome}
        onChange={(e) => setOutcome(e.target.value as CallLogOutcome)}
        options={CALL_OUTCOMES.map((o) => ({ value: o, label: CALL_OUTCOME_LABELS[o] }))}
        className="sm:max-w-[18rem]"
      />
      <Field label="What was said (optional)" name="callNote" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      <Button type="submit" variant="primary" size="sm" loading={busy}>
        Log the call
      </Button>
    </form>
  );
}

// ---- a note ---------------------------------------------------------------------

/** One note box. It appends to the timeline; it never overwrites anything. */
export function NoteBox({ leadId }: { leadId: number }) {
  const { busy, run } = useLeadAction();
  const push = usePushPending();
  const [text, setText] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const summary = text.trim();
    if (!summary) return;
    const ok = await run("Note added", () => adminFetch(`/api/admin/leads/${leadId}/activity`, { kind: "note", text: summary }));
    if (ok) {
      setText("");
      push({ kind: "note", channel: null, actor: "admin", summary });
    }
  }

  return (
    <form id={LEAD_ANCHORS.note} onSubmit={submit} className="space-y-2">
      <Textarea label="Add a note to the timeline" name="timelineNote" rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
      <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!text.trim()}>
        Add note
      </Button>
    </form>
  );
}

// ---- correcting a fact ----------------------------------------------------------

const FACT_INPUT: Record<string, string> = { email: "email", phone: "tel" };

/**
 * A label, its value and a pencil. Saves the one key it owns. On the phone row
 * it also carries the repair offer: a number that cannot be dialled as stored
 * but that is unmistakably the same number with the right prefix.
 */
export function InlineFact({
  leadId,
  field,
  label,
  value,
  repair = null,
}: {
  leadId: number;
  field: "name" | "company" | "email" | "phone";
  label: string;
  value: string | null;
  /** A dialable version of the stored number, when there is an obvious one. */
  repair?: string | null;
}) {
  const { busy, run } = useLeadAction();
  const push = usePushPending();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(`${label} saved`, () => adminFetch(`/api/admin/leads/${leadId}`, { [field]: draft.trim() }));
    if (ok) setEditing(false);
  }

  async function fix() {
    if (!repair) return;
    const summary = `Phone corrected from "${value ?? "nothing"}" to "${repair}"`;
    const ok = await run("Number fixed", async () => {
      await adminFetch(`/api/admin/leads/${leadId}`, { phone: repair });
      await adminFetch(`/api/admin/leads/${leadId}/activity`, { kind: "note", text: summary });
    });
    if (ok) push({ kind: "note", channel: null, actor: "admin", summary });
  }

  return (
    <div className="space-y-1">
      {editing ? (
        <form onSubmit={save} className="flex flex-wrap items-end gap-2">
          <Field
            label={label}
            name={`lead-${field}`}
            type={FACT_INPUT[field] ?? "text"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={200}
            className="min-w-[12rem] flex-1"
          />
          <Button type="submit" variant="primary" size="sm" loading={busy}>
            Save
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditing(false);
              setDraft(value ?? "");
            }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <p className="flex flex-wrap items-baseline gap-2 text-[16px]">
          <span className="text-fg-muted">{label}</span>
          <span className="break-all text-fg-heading">{value || "not set"}</span>
          <button
            type="button"
            onClick={() => {
              setDraft(value ?? "");
              setEditing(true);
            }}
            aria-label={`Change ${label.toLowerCase()}`}
            className="text-[15px] text-fg-faint underline decoration-dotted hover:text-fg-heading"
          >
            change
          </button>
        </p>
      )}
      {repair && repair !== value ? (
        <p className="flex flex-wrap items-center gap-2 text-[15px] text-fg-muted">
          <span>This number cannot be dialled as stored. Set it to {repair}?</span>
          <Button size="sm" loading={busy} onClick={fix}>
            Fix the number
          </Button>
        </p>
      ) : null}
    </div>
  );
}

// ---- the ready reply's three controls -------------------------------------------

/** Subject + a blank line + body onto the clipboard. Writes nothing. */
export function CopyButton({ text, label = "Copy", done = "Copied" }: { text: string; label?: string; done?: string }) {
  const toast = useToast();
  return (
    <Button
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast.push(done, "good");
        } catch {
          toast.push("Copy did not work — select the text and copy it by hand", "bad");
        }
      }}
    >
      {label}
    </Button>
  );
}

/**
 * "I sent it": the reply left by hand, so the timeline says so and a lead that
 * was still new becomes contacted. Opening a draft is not sending it, which is
 * why the mailto button writes nothing and this one does.
 */
export function SentReplyButton({ leadId, stage, subject = null }: { leadId: number; stage: LeadStage; subject?: string | null }) {
  const { busy, run } = useLeadAction();
  const push = usePushPending();
  const stopped = stage === "stop";
  const summary = subject ? `Reply sent by hand — ${subject}` : "Reply sent by hand";

  return (
    <Button
      size="sm"
      loading={busy}
      disabled={stopped}
      title={stopped ? STOP_REASON : undefined}
      onClick={async () => {
        const ok = await run("Recorded as sent", () => adminFetch(`/api/admin/leads/${leadId}/activity`, { kind: "sent", text: summary }));
        if (ok) push({ kind: "email_out", channel: "email", actor: "admin", summary });
      }}
    >
      I sent it
    </Button>
  );
}

/** "They replied" on its own, for the quick row; the stage path carries the same move. */
export function MarkRepliedButton({ leadId, stage }: { leadId: number; stage: LeadStage }) {
  const { busy, run } = useLeadAction();
  const push = usePushPending();
  return (
    <Button
      size="sm"
      loading={busy}
      disabled={stage === "stop"}
      title={stage === "stop" ? STOP_REASON : undefined}
      onClick={async () => {
        const ok = await run("Marked as replied", () => adminFetch(`/api/admin/leads/${leadId}/activity`, { kind: "mark_replied" }));
        if (ok) push({ kind: "email_in", channel: "email", actor: "prospect", summary: "Reply received" });
      }}
    >
      They replied
    </Button>
  );
}

// ---- the three that live in Details ---------------------------------------------

/** The opposition list first, then the stage — the stage follows even when the list does not. */
export function MarkStopButton({ leadId, stage }: { leadId: number; stage: LeadStage }) {
  const { busy, run } = useLeadAction();
  if (!OUTREACH_MODULE) return null;
  return (
    <ConfirmButton
      label="Mark STOP"
      confirmLabel="Confirm STOP — no more contact"
      size="sm"
      disabled={stage === "stop"}
      loading={busy}
      onConfirm={async () => {
        await run("STOP recorded — no more contact", async () => {
          let listFailed = false;
          try {
            await adminFetch("/api/admin/optouts", { lead_id: leadId });
          } catch {
            listFailed = true;
          }
          await adminFetch(`/api/admin/leads/${leadId}`, { stage: "stop" });
          if (listFailed) return "Stage set to STOP, but the opposition list was not updated — try that part again.";
        });
      }}
    />
  );
}

/** An outreach send came back: the send is marked, the address downgraded, one line on the timeline. */
export function BounceBox({ leadId }: { leadId: number }) {
  const { busy, run } = useLeadAction();
  const [ref, setRef] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run("Bounce recorded", () => adminFetch(`/api/admin/leads/${leadId}/activity`, { kind: "bounce", send_reference: ref }))) setRef("");
      }}
    >
      <Field label="Bounced send" name="bouncedSend" placeholder="SN-XXXXX" value={ref} onChange={(e) => setRef(e.target.value.toUpperCase())} maxLength={8} className="w-44" />
      <Button type="submit" size="sm" loading={busy} disabled={!/^SN-[23456789A-Z]{5}$/.test(ref)}>
        Record a bounce
      </Button>
    </form>
  );
}

type Prepared = { sendId: number; reference: string; subject: string; text: string };

/**
 * The outreach follow-up, pasted into Gmail by hand and recorded here. It needs
 * a prospect record — a lead that wrote to us has none — and says so instead of
 * disappearing.
 */
export function GmailBox({ prospectId }: { prospectId: number | null }) {
  const { busy, run, toast } = useLeadAction();
  const [prepared, setPrepared] = useState<Prepared | null>(null);

  if (!OUTREACH_MODULE) return null;
  if (prospectId === null) {
    return (
      <div className="space-y-1">
        <Button size="sm" disabled title="This needs a prospect record — inbound leads do not have one.">
          Sent from Gmail…
        </Button>
        <p className="text-[15px] text-fg-faint">This needs a prospect record — inbound leads do not have one.</p>
      </div>
    );
  }

  async function prepare() {
    try {
      const res = await adminFetch<Prepared & { ok?: boolean }>(`/api/admin/prospects/${prospectId}/manual-send`, { action: "prepare", draftId: "followup" });
      setPrepared({ sendId: res.sendId, reference: res.reference, subject: res.subject, text: res.text });
    } catch (e) {
      toast.push(errorWords(e), "bad");
    }
  }

  async function copy() {
    if (!prepared) return;
    try {
      await navigator.clipboard.writeText(`${prepared.subject}\n\n${prepared.text}`);
      toast.push("Copied with the legal block", "good");
    } catch {
      toast.push("Copy did not work — select the text and copy it by hand", "bad");
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
        <Button size="sm" onClick={copy}>
          Copy with the legal block
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
