"use client";

// Google Business Profile state (contract §6): unverified / found / not_found,
// place_id only. The prospect page hides this block entirely while Google is
// off (docs/finder-ux-spec.md §6.4); when on, every action posts to
// /api/admin/prospects/[id]/google.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Prospect } from "@/lib/crm/types";
import { adminFetch } from "./adminFetch";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { localDateTime } from "./format";
import { KeyValue } from "./KeyValue";
import { useToast } from "./Toast";

const LISTING_WORD: Record<Prospect["googleListing"], string> = { unverified: "Not checked yet", found: "Listing found", not_found: "No listing" };

export function GoogleBlock({ prospect: p, enabled }: { prospect: Prospect; enabled: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<{ name: string; sourceId: string; addressLine?: string }[] | null>(null);

  if (!enabled) return null;

  async function act(action: "find" | "confirm" | "clear", extra: Record<string, unknown> = {}) {
    setBusy(action);
    try {
      const r = await adminFetch<{ candidates?: { name: string; sourceId: string; addressLine?: string }[] }>(`/api/admin/prospects/${p.id}/google`, { action, ...extra });
      if (action === "find") {
        setCandidates(r.candidates ?? []);
        if ((r.candidates ?? []).length === 0) toast.push("No Google listing matches this business", "info");
      } else {
        toast.push(action === "clear" ? "Google listing reset" : "Google listing recorded", "good");
        router.refresh();
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      toast.push(code === "google_off" ? "Google is switched off for now" : code === "google_monthly_cap" ? "The monthly Google allowance is used up" : "The Google lookup failed. Try again later.", "bad");
    } finally {
      setBusy(null);
    }
  }

  const variant = p.googleListing === "found" ? "good" : p.googleListing === "not_found" ? "bad" : "neutral";

  return (
    <section className="card p-5" aria-label="Google listing">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[19px] text-fg-heading">Google listing</h2>
        <Badge variant={variant}>{LISTING_WORD[p.googleListing]}</Badge>
      </div>
      <KeyValue
        items={[
          { label: "Place id", value: p.googlePlaceId ? <span className="font-mono text-[13px]">{p.googlePlaceId}</span> : null },
          { label: "Confirmed", value: p.googleConfirmedAt ? localDateTime(p.googleConfirmedAt) : null, muted: true },
        ]}
      />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void act("find")} loading={busy === "find"}>
          Find on Google
        </Button>
        <Button size="sm" onClick={() => void act("confirm", { listing: "found", placeId: p.googlePlaceId ?? undefined })} loading={busy === "confirm"}>
          Mark found
        </Button>
        <Button size="sm" onClick={() => void act("confirm", { listing: "not_found" })} loading={busy === "confirm"}>
          Mark not found
        </Button>
        {p.googleListing !== "unverified" ? (
          <Button size="sm" onClick={() => void act("clear")} loading={busy === "clear"}>
            Clear
          </Button>
        ) : null}
      </div>
      {candidates && candidates.length > 0 ? (
        <ul className="mt-3 space-y-1 text-[15px]">
          {candidates.map((c) => (
            <li key={c.sourceId} className="flex items-center justify-between gap-3">
              <span>
                {c.name} <span className="text-[14px] text-fg-muted">{c.addressLine}</span>
              </span>
              <Button size="sm" onClick={() => void act("confirm", { listing: "found", placeId: c.sourceId })}>
                Use
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
