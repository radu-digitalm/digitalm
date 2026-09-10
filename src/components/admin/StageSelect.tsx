"use client";

// Inline stage change: a <select> that posts { stage } to /api/admin/leads/[id]
// and refreshes the server-rendered page. Used in the list rows and on the
// lead page; the STOP stage is reached through "Mark STOP" on the lead page so
// the opt-out list is written first, hence it is disabled here.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { LeadStage } from "@/lib/crm/types";
import { LEAD_STAGES, STAGE_LABELS } from "@/lib/inbox/stages";
import { inputClass } from "./Field";
import { adminFetch } from "./adminFetch";
import { useToast } from "./Toast";

export function StageSelect({ leadId, stage, size = "sm", className = "" }: { leadId: number; stage: LeadStage; size?: "sm" | "md"; className?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState<LeadStage>(stage);
  const [busy, setBusy] = useState(false);

  async function change(next: LeadStage) {
    if (next === value) return;
    const previous = value;
    setValue(next);
    setBusy(true);
    try {
      await adminFetch(`/api/admin/leads/${leadId}`, { stage: next });
      router.refresh();
    } catch (e) {
      setValue(previous);
      toast.push(`Stage not saved: ${(e as Error).message}`, "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      aria-label="Stage"
      value={value}
      disabled={busy}
      onChange={(e) => change(e.target.value as LeadStage)}
      className={`${inputClass} ${size === "sm" ? "w-auto px-2 py-1 text-xs" : ""} ${className}`}
    >
      {LEAD_STAGES.map((s) => (
        <option key={s} value={s} disabled={s === "stop" && value !== "stop"}>
          {STAGE_LABELS[s]}
        </option>
      ))}
    </select>
  );
}
