"use client";

// Area + category search form (contract §6): 19 fixed trades or "Other trade"
// (OSM key/value, optional NAF and SIC), source toggles, optional country
// hint. Posts to /api/admin/find and renders the ResultsTable; a past search
// is re-opened from its cached result via GET /api/admin/find?id=.
import { useEffect, useState } from "react";
import type { DiscoverySource } from "@/lib/crm/types";
import type { SearchResult } from "@/lib/discover/index";
import { adminFetch, adminGet } from "./adminFetch";
import { Button } from "./Button";
import { Field } from "./Field";
import { ResultsTable } from "./ResultsTable";
import { Select } from "./Select";
import { useToast } from "./Toast";

export type CategoryOption = { key: string; label: string };

const OSM_KEY_OPTIONS = ["amenity", "shop", "craft", "office", "tourism", "leisure", "healthcare"].map((k) => ({ value: k, label: k }));

const SOURCE_OPTIONS: { id: DiscoverySource; label: string; hint: string }[] = [
  { id: "osm", label: "OpenStreetMap", hint: "worldwide, shop signs and websites" },
  { id: "fr_register", label: "FR register", hint: "Sirene/RNE, France only" },
  { id: "companies_house", label: "Companies House", hint: "UK, needs an API key" },
  { id: "google", label: "Google", hint: "off until GOOGLE_PLACES=on" },
];

const ERROR_TEXT: Record<string, string> = {
  area_not_found: "No area found — try a town name, a French postcode or a department number.",
  area_too_large: "That area is too large — search a town or a department, not a region or a country.",
  geocode_failed: "Geocoding failed — the geocoder did not answer. Try again in a minute.",
  bad_category: "Pick a trade, or fill in the custom trade correctly (OSM value a–z and _ only).",
  search_failed: "The search failed. Try again.",
};

export function FindForm({
  categories,
  initialSearchId,
  companiesHouseOn,
  googleOn,
}: {
  categories: CategoryOption[];
  initialSearchId?: number;
  companiesHouseOn: boolean;
  googleOn: boolean;
}) {
  const toast = useToast();
  const [area, setArea] = useState("");
  const [hint, setHint] = useState("");
  const [categoryKey, setCategoryKey] = useState(categories[0]?.key ?? "");
  const [custom, setCustom] = useState({ osmKey: "shop", osmValue: "", label: "", naf: "", sic: "" });
  const [sources, setSources] = useState<Set<DiscoverySource>>(() => new Set<DiscoverySource>(["osm", "fr_register", "companies_house", "google"]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);

  useEffect(() => {
    if (!initialSearchId) return;
    let cancelled = false;
    adminGet<SearchResult>(`/api/admin/find?id=${initialSearchId}`)
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        setArea(r.queryArea);
        setCategoryKey(r.category.custom ? "custom" : r.category.key);
        setSources(new Set(r.sources));
      })
      .catch(() => {
        if (!cancelled) setError("That search has expired from the cache — run it again.");
      });
    return () => {
      cancelled = true;
    };
  }, [initialSearchId]);

  function toggleSource(id: DiscoverySource) {
    setSources((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const category = categoryKey === "custom" ? { osmKey: custom.osmKey, osmValue: custom.osmValue.trim(), label: custom.label.trim(), naf: custom.naf.trim(), sic: custom.sic.trim() } : categoryKey;
    if (!area.trim()) {
      setError("Type an area first.");
      return;
    }
    if (categoryKey === "custom" && !/^[a-z_]{2,40}$/.test(custom.osmValue.trim())) {
      setError(ERROR_TEXT.bad_category!);
      return;
    }
    setBusy(true);
    try {
      const r = await adminFetch<SearchResult>("/api/admin/find", { area: area.trim(), category, sources: [...sources], hint: hint.trim() || undefined });
      setResult(r);
      if (typeof window !== "undefined") window.history.replaceState(null, "", `/admin/find?search=${r.searchId}`);
      if (r.partial) toast.push("Partial results — see the notes under the summary", "info");
    } catch (err) {
      const code = (err as { code?: string }).code ?? "search_failed";
      setError(ERROR_TEXT[code] ?? `Search failed (${code}).`);
    } finally {
      setBusy(false);
    }
  }

  const categoryOptions = [...categories.map((c) => ({ value: c.key, label: c.label })), { value: "custom", label: "Other trade…" }];

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="card space-y-4 p-5" noValidate>
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr_2fr]">
          <Field
            label="Area"
            name="area"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="Foix · 09000 · 09 · Havant · Portland, Oregon"
            hint="A town, a French postcode or department, or a place Nominatim knows. Regions and countries are refused."
            autoComplete="off"
            required
          />
          <Field
            label="Country hint"
            name="hint"
            value={hint}
            onChange={(e) => setHint(e.target.value.toUpperCase().slice(0, 2))}
            placeholder="auto"
            hint="Optional ISO2 (FR, GB, US…)"
            maxLength={2}
            autoComplete="off"
          />
          <Select label="Trade" name="category" value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)} options={categoryOptions} />
        </div>

        {categoryKey === "custom" ? (
          <div className="grid gap-4 rounded-lg border border-line p-4 sm:grid-cols-5">
            <Select label="OSM key" name="osmKey" value={custom.osmKey} onChange={(e) => setCustom({ ...custom, osmKey: e.target.value })} options={OSM_KEY_OPTIONS} />
            <Field label="OSM value" name="osmValue" value={custom.osmValue} onChange={(e) => setCustom({ ...custom, osmValue: e.target.value.toLowerCase() })} placeholder="tattoo" hint="a–z and _ only" required />
            <Field label="Label" name="label" value={custom.label} onChange={(e) => setCustom({ ...custom, label: e.target.value })} placeholder="Tattoo studio" hint="Stored as the trade" />
            <Field label="NAF (optional)" name="naf" value={custom.naf} onChange={(e) => setCustom({ ...custom, naf: e.target.value.toUpperCase() })} placeholder="96.09Z" hint="Enables the FR register" />
            <Field label="SIC (optional)" name="sic" value={custom.sic} onChange={(e) => setCustom({ ...custom, sic: e.target.value })} placeholder="96090" hint="Enables Companies House" />
          </div>
        ) : null}

        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="mb-1 text-sm text-fg-muted">Sources</legend>
          {SOURCE_OPTIONS.map((s) => {
            const off = (s.id === "companies_house" && !companiesHouseOn) || (s.id === "google" && !googleOn);
            return (
              <label key={s.id} className={`flex items-center gap-2 ${off ? "text-fg-faint" : "text-fg-heading"}`} title={s.hint}>
                <input type="checkbox" checked={sources.has(s.id)} onChange={() => toggleSource(s.id)} />
                {s.label}
                {off ? <span className="text-xs">(off)</span> : null}
              </label>
            );
          })}
        </fieldset>

        {error ? (
          <p role="alert" className="text-sm text-accent-soft">
            {error}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" loading={busy}>
            {busy ? "Searching (up to 45 s)…" : "Search"}
          </Button>
          <span className="text-xs text-fg-faint">Public APIs, paced at 1 request per second and cached 24 h — a repeat search is instant.</span>
        </div>
      </form>

      {result ? <ResultsTable result={result} /> : null}
    </div>
  );
}
