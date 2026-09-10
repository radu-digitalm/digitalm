"use client";

// Search results with tick-to-save (contract §6). Rows with partial register
// diffusion cannot be ticked (the save route refuses them with 422 anyway);
// rows already saved link to their prospect. Every foreign href goes through
// ExtLink; every value renders as text.
import Link from "next/link";
import { useMemo, useState } from "react";
import type { DiscoverySource } from "@/lib/crm/types";
import type { MergedBusiness, SearchResult } from "@/lib/discover/index";
import { adminFetch, adminGet } from "./adminFetch";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { DataTable, type Column } from "./DataTable";
import { ExtLink } from "./ExtLink";
import { useToast } from "./Toast";

export const ATTRIBUTION_TEXT =
  "Données © les contributeurs d'OpenStreetMap (ODbL) · Sirene/RNE via API Recherche d'entreprises — Licence Ouverte 2.0 · Companies House — OGL v3";

const SOURCE_SHORT: Record<DiscoverySource, string> = { osm: "OSM", fr_register: "FR reg.", companies_house: "CH", google: "Google" };

type SaveResponse = { ok: true; saved: number; auditsQueued: number; withoutWebsite: number; alreadySaved: number; unknown: number; references: string[] };

function savable(r: MergedBusiness): boolean {
  return r.diffusion !== "partial" && !r.alreadySaved && r.active !== false;
}

function SourceBadges({ sources }: { sources: DiscoverySource[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {sources.map((s) => (
        <Badge key={s} variant={s === "osm" ? "info" : "neutral"}>
          {SOURCE_SHORT[s]}
        </Badge>
      ))}
    </span>
  );
}

export function ResultsTable({ result, onSaved }: { result: SearchResult; onSaved?: (r: SaveResponse) => void }) {
  const toast = useToast();
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [rows, setRows] = useState<MergedBusiness[]>(result.rows);
  const [saving, setSaving] = useState(false);

  // A new search result replaces the rows and the ticks.
  const [seenId, setSeenId] = useState(result.searchId);
  if (seenId !== result.searchId) {
    setSeenId(result.searchId);
    setRows(result.rows);
    setPicked(new Set());
  }

  const savableKeys = useMemo(() => rows.filter(savable).map((r) => r.key), [rows]);
  const allPicked = savableKeys.length > 0 && savableKeys.every((k) => picked.has(k));

  function toggle(key: string) {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  function toggleAll() {
    setPicked(allPicked ? new Set() : new Set(savableKeys));
  }

  async function save() {
    if (picked.size === 0) return;
    setSaving(true);
    try {
      const r = await adminFetch<SaveResponse>("/api/admin/find/save", { searchId: result.searchId, picks: [...picked] });
      toast.push(`Saved ${r.saved} · ${r.auditsQueued} audit${r.auditsQueued === 1 ? "" : "s"} queued · ${r.withoutWebsite} without a website${r.alreadySaved ? ` · ${r.alreadySaved} already saved` : ""}`, "good");
      // Refresh the already-saved marks from the server rather than guessing.
      const fresh = await adminGet<SearchResult>(`/api/admin/find?id=${result.searchId}`).catch(() => null);
      if (fresh) setRows(fresh.rows);
      setPicked(new Set());
      onSaved?.(r);
    } catch (e) {
      const err = e as { code?: string; body?: { picks?: string[] } };
      if (err.code === "partial_diffusion") toast.push(`Cannot save non-diffusible register rows: ${(err.body?.picks ?? []).join(", ")}`, "bad");
      else if (err.code === "search_expired") toast.push("This search has expired — run it again", "bad");
      else toast.push(`Save failed (${err.code ?? "error"})`, "bad");
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<MergedBusiness>[] = [
    {
      key: "pick",
      header: (
        <input type="checkbox" aria-label="Select every savable row" checked={allPicked} onChange={toggleAll} disabled={savableKeys.length === 0} />
      ),
      className: "w-8",
      render: (r) =>
        savable(r) ? (
          <input type="checkbox" aria-label={`Select ${r.name}`} checked={picked.has(r.key)} onChange={() => toggle(r.key)} />
        ) : (
          <span className="text-fg-faint" title={r.alreadySaved ? "Already saved" : r.diffusion === "partial" ? "Non-diffusible: cannot be saved" : "Not active in the register"}>
            –
          </span>
        ),
    },
    {
      key: "name",
      header: "Business",
      render: (r) => (
        <div className="min-w-[12rem]">
          <div className="text-fg-heading">{r.name}</div>
          {r.legalName && r.legalName !== r.name ? <div className="text-xs text-fg-muted">{r.legalName}</div> : null}
          {r.enseigne && r.enseigne !== r.name && r.enseigne !== r.legalName ? <div className="text-xs text-fg-faint">Sign: {r.enseigne}</div> : null}
          {r.brand ? <Badge variant="info" className="mt-1" title={`Brand: ${r.brand}`}>chain</Badge> : null}
        </div>
      ),
    },
    { key: "sources", header: "Sources", render: (r) => <SourceBadges sources={r.sources} /> },
    {
      key: "where",
      header: "Where",
      render: (r) => (
        <div className="min-w-[10rem] text-fg-muted">
          {r.addressLine ? <div>{r.addressLine}</div> : null}
          <div>{[r.postcode, r.city].filter(Boolean).join(" ")}</div>
          {r.registeredOfficeOnly ? <div className="text-xs text-amber-300">registered office, not the shop</div> : null}
          {r.geoSource === "centre" ? <div className="text-xs text-fg-faint">no coordinates in the register (area centre)</div> : null}
        </div>
      ),
    },
    { key: "website", header: "Website", render: (r) => (r.website ? <ExtLink href={r.website} /> : <span className="text-fg-faint">—</span>) },
    {
      key: "contact",
      header: "Contact",
      render: (r) => (
        <div className="text-fg-muted">
          {r.phone ? <div>{r.phone}</div> : null}
          {r.email ? <div className="break-all">{r.email}</div> : null}
          {!r.phone && !r.email ? <span className="text-fg-faint">—</span> : null}
        </div>
      ),
    },
    {
      key: "register",
      header: "Register",
      render: (r) => (
        <div className="text-xs">
          {r.registerId ? <ExtLink href={r.sourceUrl} className="link-accent font-mono">{r.registerId}</ExtLink> : <span className="text-fg-faint">—</span>}
          <div className="mt-1 flex flex-wrap gap-1">
            {r.diffusion === "partial" ? <Badge variant="warn">partial</Badge> : null}
            {r.soleTrader === true ? <Badge variant="neutral">sole trader</Badge> : null}
            {r.active === false ? <Badge variant="bad">ceased</Badge> : null}
            {r.legalForm && r.source === "companies_house" ? <Badge variant="neutral">{r.legalForm}</Badge> : null}
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) =>
        r.alreadySaved ? (
          <Link href={`/admin/prospects/${r.alreadySaved.prospectId}`} className="link-accent font-mono text-xs">
            {r.alreadySaved.reference}
          </Link>
        ) : (
          <ExtLink href={r.sourceUrl} className="text-xs text-fg-faint hover:text-fg-muted">
            source
          </ExtLink>
        ),
    },
  ];

  const savedCount = rows.filter((r) => r.alreadySaved).length;

  return (
    <section aria-label="Search results" className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm text-fg-muted">
        <span className="text-fg-heading">
          {rows.length} business{rows.length === 1 ? "" : "es"} in {result.area.label}
        </span>
        {Object.entries(result.perSource).map(([s, n]) => (
          <span key={s}>
            {SOURCE_SHORT[s as DiscoverySource]} {n}
          </span>
        ))}
        {savedCount > 0 ? <span>{savedCount} already saved</span> : null}
        {result.partial ? <Badge variant="warn">partial results</Badge> : null}
        <span className="flex-1" />
        <span>{picked.size} ticked</span>
        <Button variant="primary" size="sm" onClick={save} disabled={picked.size === 0} loading={saving}>
          Save ticked
        </Button>
      </div>
      {result.notes.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-fg-muted">
          {result.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} dense empty="No businesses found for this area and trade." caption="Search results" />
      <p className="text-xs text-fg-faint">{ATTRIBUTION_TEXT}</p>
    </section>
  );
}
