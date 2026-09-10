"use client";

// Google Business Profile state (contract §6): unverified / found / not_found,
// place_id only. While GOOGLE_PLACES=off every action answers 501 google_off
// and the block says so; the google_listing check stays not_measured until a
// listing is confirmed.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Prospect } from "@/lib/crm/types";
import { adminFetch } from "./adminFetch";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { useToast } from "./Toast";

export function GoogleBlock({ prospect: p, enabled }: { prospect: Prospect; enabled: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<{ name: string; sourceId: string; addressLine?: string }[] | null>(null);

  async function act(action: "find" | "confirm" | "clear", extra: Record<string, unknown> = {}) {
    setBusy(action);
    try {
      const r = await adminFetch<{ candidates?: { name: string; sourceId: string; addressLine?: string }[] }>(`/api/admin/prospects/${p.id}/google`, { action, ...extra });
      if (action === "find") {
        setCandidates(r.candidates ?? []);
        if ((r.candidates ?? []).length === 0) toast.push("No Google listing candidates", "info");
      } else {
        toast.push(action === "clear" ? "Google listing reset" : "Google listing recorded", "good");
        router.refresh();
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      toast.push(code === "google_off" ? "Google Places is off (GOOGLE_PLACES=off)" : code === "google_monthly_cap" ? "Google monthly cap reached" : `Google action failed (${code ?? "error"})`, "bad");
    } finally {
      setBusy(null);
    }
  }

  const variant = p.googleListing === "found" ? "good" : p.googleListing === "not_found" ? "bad" : "neutral";

  return (
    <section className="card p-5" aria-label="Google">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg text-fg-heading">Google listing</h2>
        <Badge variant={variant}>{p.googleListing.replace("_", " ")}</Badge>
      </div>
      <dl className="grid gap-2 text-sm">
        <div className="grid grid-cols-[minmax(7rem,30%)_1fr] gap-3">
          <dt className="text-fg-faint">Place id</dt>
          <dd className="font-mono text-xs text-fg-heading">{p.googlePlaceId ?? <span className="text-fg-faint">—</span>}</dd>
        </div>
        <div className="grid grid-cols-[minmax(7rem,30%)_1fr] gap-3">
          <dt className="text-fg-faint">Confirmed</dt>
          <dd className="text-fg-muted">{p.googleConfirmedAt ?? <span className="text-fg-faint">—</span>}</dd>
        </div>
      </dl>
      {!enabled ? (
        <p className="mt-3 text-xs text-fg-muted">Google Places is off (GOOGLE_PLACES=off): the listing stays unverified and its 10 points stay out of the score. No Maps scraping — the check waits for the Places API.</p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void act("find")} loading={busy === "find"} title={enabled ? "Ask the Places API for candidates" : "Answers 501 google_off while the adapter is off"}>
          Find on Google
        </Button>
        {enabled ? (
          <>
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
          </>
        ) : null}
      </div>
      {candidates && candidates.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm">
          {candidates.map((c) => (
            <li key={c.sourceId} className="flex items-center justify-between gap-3">
              <span>
                {c.name} <span className="text-xs text-fg-faint">{c.addressLine}</span>
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
