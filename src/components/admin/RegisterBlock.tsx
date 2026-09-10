"use client";

// Register and identity facts of a prospect (contract §6): where the row came
// from, register id / status / diffusion, legal form, coordinates and their
// source, the notice-deadline state, and a live "Re-check register" button.
// Ends with the ODbL / Licence Ouverte / OGL attribution.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Prospect } from "@/lib/crm/types";
import { adminFetch } from "./adminFetch";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { ExtLink } from "./ExtLink";
import { KeyValue, type KeyValueItem } from "./KeyValue";
import { daysUntil } from "./ProspectBadges";
import { ATTRIBUTION_TEXT } from "./ResultsTable";
import { useToast } from "./Toast";

const SOURCE_LABEL: Record<Prospect["source"], string> = {
  osm: "OpenStreetMap",
  fr_register: "FR register (Sirene/RNE)",
  companies_house: "Companies House",
  google: "Google",
  manual: "Added by URL",
};

type RegisterCheck = { checked: boolean; registerStatus: string; diffusion: string; wiped: boolean; note: string | null };

export function RegisterBlock({ prospect: p }: { prospect: Prospect & { brand?: string | null } }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const canRecheck = !!p.registerId && (p.source === "fr_register" || p.source === "companies_house" || p.country === "FR" || p.country === "GB");

  async function recheck() {
    setBusy(true);
    try {
      const r = await adminFetch<{ registerCheck: RegisterCheck | null }>(`/api/admin/prospects/${p.id}`, { recheck_register: true });
      const c = r.registerCheck;
      if (!c || !c.checked) toast.push(c?.note ?? "Nothing to check", "info");
      else toast.push(`Register: ${c.registerStatus}, diffusion ${c.diffusion}${c.wiped ? " — personal fields wiped" : ""}${c.note ? ` — ${c.note}` : ""}`, c.registerStatus === "active" && !c.wiped ? "good" : "bad");
      router.refresh();
    } catch (e) {
      toast.push(`Register check failed (${(e as { code?: string }).code ?? "error"})`, "bad");
    } finally {
      setBusy(false);
    }
  }

  const deadlineDays = daysUntil(p.noticeDeadlineAt);
  const statusVariant = p.registerStatus === "active" ? "good" : p.registerStatus === "ceased" ? "bad" : "neutral";

  const items: KeyValueItem[] = [
    {
      label: "Source",
      value: (
        <span>
          {SOURCE_LABEL[p.source]}
          {p.sourceId ? <span className="ml-2 font-mono text-xs text-fg-muted">{p.sourceId}</span> : null}
          {p.sourceUrl ? (
            <span className="ml-2 text-xs">
              <ExtLink href={p.sourceUrl}>open</ExtLink>
            </span>
          ) : null}
        </span>
      ),
    },
    { label: "Legal name", value: p.legalName },
    { label: "Sign / enseigne", value: p.enseigne },
    { label: "Brand", value: p.brand ? <Badge variant="info">{p.brand}</Badge> : null },
    {
      label: "Register id",
      value: p.registerId ? (
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="font-mono">{p.registerId}</span>
          <Badge variant={statusVariant}>{p.registerStatus}</Badge>
          {p.diffusion !== "na" ? <Badge variant={p.diffusion === "partial" ? "warn" : "neutral"}>diffusion {p.diffusion}</Badge> : null}
        </span>
      ) : (
        <span className="text-fg-faint">none — {p.country === "GB" ? "GB email needs a company number" : "identity from the source above"}</span>
      ),
    },
    { label: "Checked", value: p.registerCheckedAt, muted: true },
    {
      label: "Legal form",
      value: (
        <span>
          {p.legalForm ?? <span className="text-fg-faint">—</span>}
          {p.soleTrader === true ? <Badge variant="warn" className="ml-2">sole trader</Badge> : p.soleTrader === false ? <Badge variant="neutral" className="ml-2">company</Badge> : <Badge variant="neutral" className="ml-2">form unknown</Badge>}
        </span>
      ),
    },
    { label: "Address", value: [p.addressLine, [p.postcode, p.city].filter(Boolean).join(" "), p.region].filter(Boolean).join(", ") },
    { label: "Country · locale", value: `${p.country} · ${p.locale}${p.localeOverridden ? " (overridden)" : ""}` },
    {
      label: "Coordinates",
      value: p.lat !== null && p.lng !== null ? (
        <span className="font-mono text-xs">
          {p.lat.toFixed(5)}, {p.lng.toFixed(5)} <span className="text-fg-faint">({p.geoSource ?? "unknown"})</span>
        </span>
      ) : null,
    },
    { label: "Saved", value: `${p.savedAt}${p.searchId ? ` · search #${p.searchId}` : ""}`, muted: true },
    {
      label: "Notice",
      value: p.noticeSentAt ? (
        <span>sent {p.noticeSentAt}</span>
      ) : p.personalWipedAt ? (
        <span>personal fields wiped {p.personalWipedAt}</span>
      ) : deadlineDays === null ? null : deadlineDays > 0 ? (
        <span className={deadlineDays <= 5 ? "text-amber-300" : ""}>deadline in {deadlineDays} day{deadlineDays === 1 ? "" : "s"} ({p.noticeDeadlineAt})</span>
      ) : (
        <span className="text-accent-soft">deadline passed ({p.noticeDeadlineAt}) — the purge wipes contact fields</span>
      ),
    },
  ];

  return (
    <section className="card p-5" aria-label="Register">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg text-fg-heading">Register</h2>
        {canRecheck ? (
          <Button size="sm" onClick={recheck} loading={busy}>
            Re-check register
          </Button>
        ) : null}
      </div>
      <KeyValue items={items} />
      <p className="mt-4 text-xs text-fg-faint">{ATTRIBUTION_TEXT}</p>
    </section>
  );
}
