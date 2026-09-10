"use client";

// Next action + date + note, saved together to /api/admin/leads/[id].
// Quick chips move the date by a few days; "Clear" drops the follow-up.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addDays } from "@/lib/inbox/stages";
import { Button } from "./Button";
import { Field } from "./Field";
import { Textarea } from "./Textarea";
import { adminFetch } from "./adminFetch";
import { useToast } from "./Toast";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function NextActionForm({
  leadId,
  nextAction,
  nextActionAt,
  note,
}: {
  leadId: number;
  nextAction: string | null;
  nextActionAt: string | null;
  note: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [action, setAction] = useState(nextAction ?? "");
  const [date, setDate] = useState(nextActionAt ?? "");
  const [text, setText] = useState(note ?? "");
  const [busy, setBusy] = useState(false);

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    try {
      await adminFetch(`/api/admin/leads/${leadId}`, { next_action: action, next_action_at: date, note: text });
      toast.push("Saved", "good");
      router.refresh();
    } catch (err) {
      toast.push(`Not saved: ${(err as Error).message}`, "bad");
    } finally {
      setBusy(false);
    }
  }

  const bump = (days: number) => setDate(addDays(date || todayIso(), days));

  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Next action" name="next_action" value={action} onChange={(e) => setAction(e.target.value)} placeholder="Call back, send the proposal…" maxLength={200} />
      <div>
        <Field label="Due" name="next_action_at" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => setDate(todayIso())}>Today</Button>
          <Button size="sm" onClick={() => bump(1)}>+1 d</Button>
          <Button size="sm" onClick={() => bump(3)}>+3 d</Button>
          <Button size="sm" onClick={() => bump(7)}>+7 d</Button>
          <Button size="sm" onClick={() => { setDate(""); setAction(""); }}>Clear</Button>
        </div>
      </div>
      <Textarea label="Notes" name="note" rows={5} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} hint="Kept with the lead; not sent anywhere." />
      <Button type="submit" variant="primary" loading={busy}>
        Save
      </Button>
    </form>
  );
}
