"use client";

// The finder page's client workspace (docs/finder-ux-spec.md §5): owns the
// search bar value, starts searches, polls GET ?id=&after=&v= every 2 s
// (4 s after a minute), keeps the row list, filters/sorts it for the list and
// the map together, opens the business card, saves and dismisses from it.
// Layout: desktop two panes (map · list, the card over the list); tablet map
// on top, list below, card as a right sheet; phone map + bottom sheet.
// With Google on (docs/finder-google-spec.md §5): the map is Google Maps when
// the browser key and Map ID are set (`googleMap`), the Area box offers place
// suggestions (a pick posts `suggestion: { placeId }`), Google-only pins ride
// along with the rows (`googlePins`, the "Only on Google" chip, the
// Google-only card with Add by its website / Not this one). With Google off
// none of that exists and the Leaflet finder behaves exactly as before.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DiscoverySource } from "@/lib/crm/types";
import { AdminFetchError } from "./adminFetch";
import { BusinessCard, type CardLayout } from "./BusinessCard";
import { Button } from "./Button";
import { GoogleOnlyCard } from "./GoogleOnlyCard";
import { FindForm, EMPTY_CUSTOM, defaultSources, type FormValue } from "./FindForm";
import { FindList, PAGE, type Chip, type SortKey } from "./FindList";
import type { MapBounds } from "./FindMap";
import { CapGate, FindProgress, progressFraction, type FindErrorView, type Phase, type StartInfo } from "./FindProgress";
import {
  cancelFind,
  classifyFindError,
  completeness,
  continueFind,
  dismissFind,
  getFind,
  googleKeyOf,
  hasPin,
  isGate,
  isGoogleKey,
  isTerminal,
  notListed,
  placeIdOfKey,
  recentFinds,
  saveFind,
  savable,
  sinks,
  startFind,
  type AddByUrlResponse,
  type Alternative,
  type Candidate,
  type FindBody,
  type GateChild,
  type GatePlan,
  type GooglePin,
  type ResolvedArea,
  type ResultRow,
  type SearchResultV2,
  type SearchSummaryV2,
} from "./finderApi";
import { formatInt, relativeOrLocal } from "./format";
import { Legend } from "./Legend";
import { summaryText } from "./progressModel";
import { useToast } from "./Toast";
import { CUSTOM_KEY, type TradeOption } from "./TradePicker";
import { ERROR_TEXT, FIND_TEXT, GOOGLE_TEXT, SEARCH_STATUS_WORDS, fill } from "./wording";

const FindMap = dynamic(() => import("./FindMap"), { ssr: false, loading: () => <div className="h-full min-h-[320px] rounded-xl border border-line bg-surface-2" aria-hidden="true" /> });
const GoogleFindMap = dynamic(() => import("./GoogleFindMap"), { ssr: false, loading: () => <div className="h-full min-h-[320px] rounded-xl border border-line bg-surface-2" aria-hidden="true" /> });

const OSM_VALUE_RE = /^[a-z_]{2,40}$/;
const EUROPE = { lat: 48.5, lng: 6, zoom: 4 };

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const INSIDE_RANK = { yes: 0, approx: 1, no: 2 } as const;

function byNearest(a: ResultRow, b: ResultRow): number {
  const ia = INSIDE_RANK[a.inside] ?? 3;
  const ib = INSIDE_RANK[b.inside] ?? 3;
  if (ia !== ib) return ia - ib;
  const da = a.distanceKm ?? Infinity;
  const db = b.distanceKm ?? Infinity;
  if (da !== db) return da - db;
  return a.name.localeCompare(b.name);
}

/** Every sort puts the rows nobody can act on (not listed publicly, closed, hidden) last. */
function sortRows(rows: ResultRow[], sort: SortKey): ResultRow[] {
  const out = [...rows];
  const sink = (a: ResultRow, b: ResultRow) => Number(sinks(a)) - Number(sinks(b));
  if (sort === "nearest") out.sort((a, b) => sink(a, b) || byNearest(a, b));
  else if (sort === "complete") out.sort((a, b) => sink(a, b) || completeness(b) - completeness(a) || byNearest(a, b));
  else if (sort === "town") out.sort((a, b) => sink(a, b) || (a.city ?? "\uffff").localeCompare(b.city ?? "\uffff") || a.name.localeCompare(b.name));
  else out.sort((a, b) => sink(a, b) || a.name.localeCompare(b.name));
  return out;
}

function mergeResult(prev: SearchResultV2 | null, next: SearchResultV2, askedAfter: number | null, askedV: number | null): SearchResultV2 {
  if (!prev || prev.searchId !== next.searchId || askedAfter === null || askedV === null) return next;
  if (next.progress.rowsVersion !== askedV || askedAfter === 0) return next;
  // A slice omits `googlePins` unless the server holds a newer pinsVersion — keep the pins we have.
  const pins = next.googlePins === undefined && prev.googlePins !== undefined ? { googlePins: prev.googlePins } : {};
  return { ...next, rows: [...prev.rows, ...next.rows], ...pins };
}

export type FindWorkspaceProps = {
  trades: TradeOption[];
  initialSearchId?: number;
  companiesHouseOn: boolean;
  googleOn: boolean;
  /** Google Maps instead of Leaflet — the browser key and Map ID are set (docs/finder-google-spec.md §5.2, D4). */
  googleMap?: boolean;
};

export function FindWorkspace({ trades, initialSearchId, companiesHouseOn, googleOn, googleMap = false }: FindWorkspaceProps) {
  const toast = useToast();
  const desktop = useMedia("(min-width: 1024px)");
  const tablet = useMedia("(min-width: 768px)");
  const phone = !tablet;

  // ---- search bar + search state ----------------------------------------------------------
  const [form, setForm] = useState<FormValue>({ area: "", categoryKey: trades[0]?.key ?? "", custom: EMPTY_CUSTOM, sources: defaultSources(companiesHouseOn) });
  const [phase, setPhase] = useState<Phase>("idle");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [gate, setGate] = useState<{ area: ResolvedArea; plan: GatePlan } | null>(null);
  const [capChildren, setCapChildren] = useState<GateChild[] | null>(null);
  const [start, setStart] = useState<StartInfo>(null);
  const [searchId, setSearchId] = useState<number | null>(initialSearchId ?? null);
  const [result, setResult] = useState<SearchResultV2 | null>(null);
  const resultRef = useRef<SearchResultV2 | null>(null);
  resultRef.current = result;
  const [error, setError] = useState<FindErrorView>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [past, setPast] = useState<SearchSummaryV2[] | null>(null);
  const lastBody = useRef<FindBody | null>(null);

  // ---- list / map interaction -------------------------------------------------------------
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [chips, setChips] = useState<Set<Chip>>(() => new Set());
  const googleChipTouched = useRef(false);
  const [text, setText] = useState("");
  const [sort, setSort] = useState<SortKey>("complete");
  const [followMap, setFollowMap] = useState(false);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [shown, setShown] = useState(PAGE);
  const [saving, setSaving] = useState(false);
  const [undo, setUndo] = useState<{ key: string; name: string } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [barOpen, setBarOpen] = useState(false);
  const [fitSignal, setFitSignal] = useState(0);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- layout height ----------------------------------------------------------------------
  const topEl = useRef<HTMLDivElement>(null);
  const gridEl = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(560);
  useLayoutEffect(() => {
    const update = () => {
      const top = gridEl.current?.getBoundingClientRect().top ?? 200;
      const h = window.innerHeight - top - (phone ? 0 : 12);
      setHeight(Math.max(phone ? 320 : 480, Math.round(h)));
    };
    update();
    window.addEventListener("resize", update);
    const ro = new ResizeObserver(update);
    if (topEl.current) ro.observe(topEl.current);
    return () => {
      window.removeEventListener("resize", update);
      ro.disconnect();
    };
  }, [phone]);

  // ---- past searches ----------------------------------------------------------------------
  const loadPast = useCallback(() => {
    recentFinds(20)
      .then((r) => setPast(r.searches))
      .catch(() => setPast([]));
  }, []);
  useEffect(() => {
    loadPast();
  }, [loadPast]);

  // ---- open a past search (?search=N) ----------------------------------------------------------
  useEffect(() => {
    if (!initialSearchId) return;
    let cancelled = false;
    getFind(initialSearchId)
      .then((r) => {
        if (cancelled) return;
        const { ok: _ok, ...res } = r;
        void _ok;
        setResult(res);
        setSearchId(res.searchId);
        setForm((f) => ({ ...f, area: res.queryArea, categoryKey: res.category.custom ? CUSTOM_KEY : res.category.key, sources: res.sources }));
        setPhase(isTerminal(res.progress.status) ? "finished" : "running");
      })
      .catch(() => {
        if (cancelled) return;
        setExpired(true);
        setPhase("idle");
      });
    return () => {
      cancelled = true;
    };
  }, [initialSearchId]);

  // ---- polling ----------------------------------------------------------------------------------
  useEffect(() => {
    if (phase !== "running" || !searchId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    const tick = async () => {
      if (stop) return;
      const cur = resultRef.current;
      const same = cur && cur.searchId === searchId;
      const after = same ? cur.rows.length : null;
      const v = same ? cur.progress.rowsVersion : null;
      try {
        const r = same ? await getFind(searchId, after!, v!, cur.progress.google?.pinsVersion) : await getFind(searchId);
        if (stop) return;
        const { ok: _ok, ...res } = r;
        void _ok;
        setResult((prev) => mergeResult(prev, res, after, v));
        if (isTerminal(res.progress.status)) {
          setPhase("finished");
          loadPast();
          return;
        }
      } catch (e) {
        if (stop) return;
        if (e instanceof AdminFetchError && (e.code === "search_expired" || e.status === 404 || e.status === 410)) {
          setExpired(true);
          setPhase("finished");
          return;
        }
      }
      timer = setTimeout(tick, Date.now() - startedAt > 60_000 ? 4000 : 2000);
    };
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, searchId, loadPast]);

  // ---- derived rows ------------------------------------------------------------------------------
  const rows = result?.rows ?? [];
  const area = result?.area ?? start?.area ?? gate?.area ?? null;
  const isFr = area?.countryCode === "FR";
  // Places Google knows that no other source listed (present only when the Google phase ran).
  const googlePins = useMemo(() => result?.googlePins ?? [], [result]);

  // Hidden rows and register entries that are not listed publicly stay out of the way unless their chip is on.
  const baseRows = useMemo(() => rows.filter((r) => (chips.has("hidden") || !r.hidden) && (chips.has("not_listed") || !notListed(r))), [rows, chips]);

  const counts = useMemo<Record<Chip, number>>(() => {
    const c: Record<Chip, number> = { savable: 0, website: 0, no_website: 0, phone: 0, email: 0, register: 0, saved: 0, not_listed: 0, hidden: 0, google_only: 0 };
    c.google_only = googlePins.filter((g) => !g.hidden).length;
    for (const r of rows) {
      if (r.hidden) c.hidden++;
      if (notListed(r)) c.not_listed++;
      if (r.hidden && !chips.has("hidden")) continue;
      if (notListed(r) && !chips.has("not_listed")) continue;
      if (savable(r)) c.savable++;
      if (r.website) c.website++;
      else c.no_website++;
      if (r.phone) c.phone++;
      if (r.email) c.email++;
      if (r.registerId && r.sources.includes("fr_register")) c.register++;
      if (r.alreadySaved) c.saved++;
    }
    return c;
  }, [rows, chips, googlePins]);

  const visibleRows = useMemo(() => {
    const q = fold(text.trim());
    const filtered = baseRows.filter((r) => {
      if (chips.has("savable") && !savable(r)) return false;
      if (chips.has("website") && !r.website) return false;
      if (chips.has("no_website") && r.website) return false;
      if (chips.has("phone") && !r.phone) return false;
      if (chips.has("email") && !r.email) return false;
      if (chips.has("register") && !(r.registerId && r.sources.includes("fr_register"))) return false;
      if (chips.has("saved") && !r.alreadySaved) return false;
      if (q && !fold(r.name).includes(q) && !fold(r.city ?? "").includes(q) && !fold(r.postcode ?? "").includes(q)) return false;
      if (followMap && bounds) {
        if (!hasPin(r)) return false;
        if (r.lat! < bounds.south || r.lat! > bounds.north || r.lng! < bounds.west || r.lng! > bounds.east) return false;
      }
      return true;
    });
    return sortRows(filtered, sort);
  }, [baseRows, chips, text, sort, followMap, bounds]);

  const pinRows = useMemo(() => visibleRows.filter(hasPin), [visibleRows]);
  const selectedRow = useMemo(() => (selectedKey ? rows.find((r) => r.key === selectedKey) ?? null : null), [rows, selectedKey]);

  // The Google-only pins (blue) show while their chip is on; hidden ones only with the Hidden chip, like rows.
  const visiblePins = useMemo(() => (chips.has("google_only") ? googlePins.filter((g) => chips.has("hidden") || !g.hidden) : []), [googlePins, chips]);
  const selectedPin = useMemo(() => (isGoogleKey(selectedKey) ? (googlePins.find((g) => googleKeyOf(g.placeId) === selectedKey) ?? null) : null), [googlePins, selectedKey]);
  // The chip is on by default whenever a search has Google-only pins, until it is toggled by hand.
  useEffect(() => {
    if (googlePins.length === 0 || googleChipTouched.current) return;
    setChips((s) => (s.has("google_only") ? s : new Set(s).add("google_only")));
  }, [googlePins.length]);

  // ---- actions ------------------------------------------------------------------------------------
  function resetForNewSearch() {
    setError(null);
    setFormError(null);
    setCandidates(null);
    setGate(null);
    setExpired(false);
    setSelectedKey(null);
    setHoverKey(null);
    setCardOpen(false);
    setPicked(new Set());
    setShown(PAGE);
    setText("");
    setUndo(null);
    setSheetOpen(false); // the phone shows the map while a new search runs; the gate reopens the sheet
    googleChipTouched.current = false;
    setChips((s) => {
      if (!s.has("google_only")) return s;
      const n = new Set(s);
      n.delete("google_only");
      return n;
    });
  }

  /** `allowEmptyArea`: a suggestion pick carries the place id, so the typed text may be empty (§5.3). */
  function bodyFromForm(f: FormValue, allowEmptyArea = false): FindBody | null {
    const areaText = f.area.trim();
    if (!areaText && !allowEmptyArea) {
      setFormError(FIND_TEXT.typeAreaFirst);
      return null;
    }
    if (f.categoryKey === CUSTOM_KEY) {
      if (!OSM_VALUE_RE.test(f.custom.osmValue.trim())) {
        setFormError(ERROR_TEXT.bad_category);
        return null;
      }
      return { area: areaText, category: { osmKey: f.custom.osmKey, osmValue: f.custom.osmValue.trim(), label: f.custom.label.trim() || undefined, naf: f.custom.naf.trim() || undefined, sic: f.custom.sic.trim() || undefined }, sources: f.sources };
    }
    if (!f.categoryKey) {
      setFormError(ERROR_TEXT.bad_category);
      return null;
    }
    return { area: areaText, category: f.categoryKey, sources: f.sources };
  }

  async function runSearch(body: FindBody, opts: { keepChildren?: GateChild[] | null } = {}) {
    resetForNewSearch();
    // Remembered without `fresh`: a candidate pick or a gate child after a "Run again" reads from the cache as usual.
    const { fresh: _fresh, ...remembered } = body;
    void _fresh;
    lastBody.current = remembered;
    setQuery(body.area);
    setPhase("resolving");
    setStart(null);
    setResult(null);
    setCapChildren(opts.keepChildren ?? null);
    try {
      const r = await startFind(body);
      if (isGate(r)) {
        setGate({ area: r.area, plan: r.plan });
        setPhase("gate");
        // The gate lives in the list pane — on the phone that is the sheet, which must be open to show it.
        setSheetOpen(true);
        return;
      }
      setStart({ area: r.area, expected: r.plan.expected, alternatives: r.alternatives });
      setSearchId(r.searchId);
      setPhase("running");
      if (r.queryArea && body.suggestion) {
        // A suggestion pick: the box shows the area the search resolved to, and Run again re-posts that text (no second Google call).
        const queryArea = r.queryArea;
        setForm((f) => ({ ...f, area: queryArea }));
        lastBody.current = { ...remembered, area: queryArea, suggestion: undefined };
      }
      if (typeof window !== "undefined") window.history.replaceState(null, "", `/admin/find?search=${r.searchId}`);
    } catch (e) {
      const err = classifyFindError(e);
      setPhase(resultRef.current ? "finished" : "idle");
      if (err.kind === "ambiguous") setCandidates(err.candidates);
      else if (err.kind === "search_running") setError({ text: fill(ERROR_TEXT.search_running, { area: err.area, trade: err.trade }), running: { searchId: err.searchId, area: err.area, trade: err.trade } });
      else if (err.code === "suggestion_unresolved") {
        // Google could not turn the pick into a place and there was no typed text to fall back on: under the field, focus back in the box.
        setFormError(err.message ?? ERROR_TEXT.suggestion_unresolved);
        if (typeof document !== "undefined") document.getElementById("area")?.focus();
      } else {
        const known = (ERROR_TEXT as Record<string, string>)[err.code];
        setError({ text: known ? fill(known, { query: body.area }) : err.message ?? ERROR_TEXT.search_failed });
      }
    }
  }

  function submit() {
    const body = bodyFromForm(form);
    if (body) void runSearch(body);
  }

  /** An Area-box pick (docs/finder-google-spec.md §5.3): the place id only, plus the last typed text as the fallback. */
  function submitSuggestion(s: { placeId: string }) {
    setBarOpen(false);
    const body = bodyFromForm(form, true);
    if (body) void runSearch({ ...body, suggestion: s });
  }

  function pickCandidate(c: Candidate) {
    const body = lastBody.current ?? bodyFromForm(form);
    if (!body) return;
    void runSearch({ ...body, pick: { osmType: c.osmType, osmId: c.osmId } });
  }

  function pickAlternative(a: Alternative) {
    const body = lastBody.current;
    if (!body) return;
    void runSearch({ ...body, pick: { osmType: a.osmType, osmId: a.osmId } });
  }

  function pickChild(c: GateChild) {
    const body = lastBody.current ?? bodyFromForm(form);
    if (!body) return;
    const relId = /^r(\d+)$/.exec(c.id)?.[1];
    setForm((f) => ({ ...f, area: c.label }));
    // A department chip posts its code (deterministic); an Overpass child posts its relation; anything else its label.
    void runSearch({ ...body, area: c.query ?? c.label, pick: relId ? { osmType: "relation", osmId: Number(relId) } : undefined, confirmCap: undefined });
  }

  function confirmCap() {
    const body = lastBody.current;
    if (!body || !gate) return;
    void runSearch({ ...body, confirmCap: true }, { keepChildren: gate.plan.units });
  }

  async function stop(id = searchId) {
    if (!id) return;
    try {
      await cancelFind(id);
    } catch {
      /* the poll reports the final status either way */
    }
  }

  async function continueSearch() {
    if (!searchId) return;
    setError(null);
    try {
      await continueFind(searchId);
      setPhase("running");
    } catch (e) {
      const err = classifyFindError(e);
      if (err.kind === "search_running") setError({ text: fill(ERROR_TEXT.search_running, { area: err.area, trade: err.trade }), running: { searchId: err.searchId, area: err.area, trade: err.trade } });
      else if (err.kind === "code") setError({ text: (ERROR_TEXT as Record<string, string>)[err.code] ?? ERROR_TEXT.search_failed });
      else setError({ text: ERROR_TEXT.search_failed });
    }
  }

  function runAgain() {
    const body = lastBody.current ?? bodyFromForm(form);
    if (body) void runSearch(body);
  }

  /** "Run again" next to "Results from 1 h ago": the same search, every source read anew. */
  function runFresh() {
    const body = lastBody.current ?? bodyFromForm(form);
    if (body) void runSearch({ ...body, fresh: true });
  }

  function openRunning(id: number) {
    setError(null);
    setResult(null);
    setSearchId(id);
    setPhase("running");
    if (typeof window !== "undefined") window.history.replaceState(null, "", `/admin/find?search=${id}`);
  }

  async function stopRunning(id: number) {
    await stop(id);
    setError(null);
  }

  function openPast(s: SearchSummaryV2) {
    if (!s.cached) {
      setForm((f) => ({ ...f, area: s.queryArea, categoryKey: s.categoryKey.startsWith("custom:") ? f.categoryKey : s.categoryKey }));
      setExpired(true);
      return;
    }
    resetForNewSearch();
    setResult(null);
    setStart(null);
    setSearchId(s.id);
    setForm((f) => ({ ...f, area: s.queryArea, categoryKey: s.categoryKey.startsWith("custom:") ? f.categoryKey : s.categoryKey, sources: s.sources }));
    setPhase("running"); // the first poll loads it and settles the phase
    if (typeof window !== "undefined") window.history.replaceState(null, "", `/admin/find?search=${s.id}`);
  }

  function select(key: string, openCard = true) {
    setSelectedKey(key);
    if (openCard) setCardOpen(true);
    const idx = visibleRows.findIndex((r) => r.key === key);
    if (idx >= shown) setShown(Math.ceil((idx + 1) / PAGE) * PAGE);
    if (phone) setSheetOpen(true);
  }

  const closeCard = useCallback(() => {
    setCardOpen(false);
    const key = selectedKey;
    if (key) requestAnimationFrame(() => rowRefs.current.get(key)?.focus());
  }, [selectedKey]);

  function updateRow(key: string, patch: Partial<ResultRow>) {
    setResult((prev) => (prev ? { ...prev, rows: prev.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) } : prev));
  }

  function updatePin(placeId: string, patch: Partial<GooglePin>) {
    setResult((prev) => (prev && prev.googlePins ? { ...prev, googlePins: prev.googlePins.map((g) => (g.placeId === placeId ? { ...g, ...patch } : g)) } : prev));
  }

  /** Hidden state for a row key or a `google:<id>` pin key. */
  function setHidden(key: string, hidden: boolean) {
    const placeId = placeIdOfKey(key);
    if (placeId) updatePin(placeId, { hidden });
    else updateRow(key, { hidden });
  }

  async function refreshFull() {
    if (!searchId) return;
    try {
      const r = await getFind(searchId);
      const { ok: _ok, ...res } = r;
      void _ok;
      setResult(res);
    } catch {
      /* keep what we have */
    }
  }

  async function saveOne(row: ResultRow) {
    if (!searchId || !savable(row)) return;
    setSaving(true);
    try {
      const r = await saveFind(searchId, [row.key]);
      const reference = r.references[0];
      const id = r.prospectIds?.[0];
      if (reference && id) {
        updateRow(row.key, { alreadySaved: { prospectId: id, reference } });
        toast.push(fill(row.website ? FIND_TEXT.savedAs : FIND_TEXT.savedAsNoWebsite, { reference }), "good");
      } else if (reference) {
        toast.push(fill(row.website ? FIND_TEXT.savedAs : FIND_TEXT.savedAsNoWebsite, { reference }), "good");
        await refreshFull();
      } else {
        toast.push(FIND_TEXT.saveFailed, "bad");
      }
      loadPast();
    } catch (e) {
      const code = e instanceof AdminFetchError ? e.code : "";
      toast.push(code === "partial_diffusion" ? FIND_TEXT.saveNotListed : code === "hidden" ? FIND_TEXT.saveHidden : code === "search_expired" ? FIND_TEXT.saveExpired : FIND_TEXT.saveFailed, "bad");
    } finally {
      setSaving(false);
    }
  }

  async function saveTicked() {
    if (!searchId) return;
    const keys = visibleRows.filter((r) => picked.has(r.key) && savable(r)).map((r) => r.key);
    if (keys.length === 0) return;
    setSaving(true);
    let saved = 0;
    let audits = 0;
    let without = 0;
    try {
      for (let i = 0; i < keys.length; i += 300) {
        const r = await saveFind(searchId, keys.slice(i, i + 300));
        saved += r.saved;
        audits += r.auditsQueued;
        without += r.withoutWebsite;
      }
      toast.push(fill(FIND_TEXT.savedBulk, { saved: formatInt(saved), audits: formatInt(audits), without: formatInt(without) }), "good");
      setPicked(new Set());
      await refreshFull();
      loadPast();
    } catch (e) {
      const code = e instanceof AdminFetchError ? e.code : "";
      toast.push(code === "partial_diffusion" ? FIND_TEXT.saveNotListed : code === "hidden" ? FIND_TEXT.saveHidden : code === "search_expired" ? FIND_TEXT.saveExpired : FIND_TEXT.saveFailed, "bad");
      await refreshFull();
    } finally {
      setSaving(false);
    }
  }

  async function dismiss(row: ResultRow) {
    if (!searchId) return;
    updateRow(row.key, { hidden: true });
    // Select the next visible row so the flow continues.
    const idx = visibleRows.findIndex((r) => r.key === row.key);
    const next = visibleRows[idx + 1] ?? visibleRows[idx - 1] ?? null;
    if (!chips.has("hidden")) {
      if (next) setSelectedKey(next.key);
      else {
        setSelectedKey(null);
        setCardOpen(false);
      }
    }
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ key: row.key, name: row.name });
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
    try {
      await dismissFind(searchId, row.key, false);
    } catch {
      updateRow(row.key, { hidden: false });
      setUndo(null);
      toast.push(FIND_TEXT.saveFailed, "bad");
    }
  }

  async function undoDismiss(key: string) {
    if (!searchId) return;
    setHidden(key, false);
    setUndo(null);
    try {
      await dismissFind(searchId, key, true);
    } catch {
      setHidden(key, true);
    }
  }

  /** "Not this one" on a Google-only pin: hidden server-side under its `google:<id>` key, with the same Undo. */
  async function dismissGoogle(pin: GooglePin) {
    if (!searchId) return;
    const key = googleKeyOf(pin.placeId);
    updatePin(pin.placeId, { hidden: true });
    if (!chips.has("hidden")) {
      setSelectedKey(null);
      setCardOpen(false);
    }
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ key, name: GOOGLE_TEXT.onlyOnGoogle });
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
    try {
      await dismissFind(searchId, key, false);
    } catch {
      updatePin(pin.placeId, { hidden: false });
      setUndo(null);
      toast.push(FIND_TEXT.saveFailed, "bad");
    }
  }

  /** "Add by its website" answered: the pin turns green at once (the next full read confirms it through `pin.saved`). */
  function savedGoogle(pin: GooglePin, r: AddByUrlResponse) {
    if (r.existing) {
      toast.push(fill(r.placeAttached ? GOOGLE_TEXT.alreadySavedAttached : GOOGLE_TEXT.alreadySaved, { reference: r.reference }), r.placeAttached ? "good" : "info");
      if (r.placeAttached) updatePin(pin.placeId, { saved: { prospectId: r.id, reference: r.reference } });
      return;
    }
    toast.push(fill(GOOGLE_TEXT.savedAs, { reference: r.reference }), "good");
    updatePin(pin.placeId, { saved: { prospectId: r.id, reference: r.reference } });
    loadPast();
  }

  const running = phase === "running";
  const trade = result?.category.label.en ?? trades.find((t) => t.key === form.categoryKey)?.label.en ?? "";
  const cardLayout: CardLayout = desktop ? "overlay" : tablet ? "sheet" : "full";
  const idleCenter = area ? { lat: area.center.lat, lng: area.center.lng, zoom: 8 } : EUROPE;

  const pastList = (
    <details data-testid="past-searches" open={!result && phase === "idle"} className="px-3 py-2">
      <summary className="cursor-pointer text-[16px] text-fg-heading">{FIND_TEXT.pastSearches}</summary>
      {past === null ? (
        <p className="py-2 text-[15px] text-fg-muted">…</p>
      ) : past.length === 0 ? (
        <p className="py-2 text-[15px] text-fg-muted">{FIND_TEXT.noPastSearches}</p>
      ) : (
        <ul className="mt-1 divide-y divide-line/60">
          {past.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => openPast(s)} className="flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 text-left hover:bg-surface-2/60">
                <span className="text-[15px] text-fg-heading">
                  {s.areaLabel || s.queryArea} · {s.categoryLabel || s.categoryKey}
                </span>
                <span className="text-[14px] text-fg-muted">
                  {formatInt(s.resultCount)} found · {formatInt(s.savedCount)} saved · {relativeOrLocal(s.createdAt)} · {s.cached ? SEARCH_STATUS_WORDS[s.status] ?? s.status : SEARCH_STATUS_WORDS.expired}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );

  const listPane = result ? (
    <FindList
      result={result}
      rows={visibleRows}
      counts={counts}
      chips={chips}
      onToggleChip={(c) => {
        if (c === "google_only") googleChipTouched.current = true;
        setChips((s) => {
          const n = new Set(s);
          if (n.has(c)) n.delete(c);
          else n.add(c);
          return n;
        });
      }}
      text={text}
      onText={setText}
      sort={sort}
      onSort={setSort}
      followMap={followMap}
      onFollowMap={setFollowMap}
      showRegisterChip={isFr}
      showGoogleChip={googlePins.length > 0}
      googleCounts={result.progress.google ? { also: result.progress.google.matched, only: counts.google_only } : null}
      selectedKey={selectedKey}
      onHover={setHoverKey}
      onSelect={(key) => select(key)}
      picked={picked}
      onTogglePick={(key) =>
        setPicked((s) => {
          const n = new Set(s);
          if (n.has(key)) n.delete(key);
          else n.add(key);
          return n;
        })
      }
      onSaveTicked={() => void saveTicked()}
      saving={saving}
      shown={shown}
      onShowMore={() => setShown((n) => n + PAGE)}
      onUndoDismiss={(key) => void undoDismiss(key)}
      rowRefs={rowRefs}
      running={running}
      footer={pastList}
      compactHeader={phone}
      className="h-full"
    />
  ) : phase === "gate" && gate ? (
    <div className="h-full overflow-y-auto" data-testid="find-list">
      <CapGate
        area={gate.area}
        plan={gate.plan}
        trade={trade}
        onChild={pickChild}
        onContinue={confirmCap}
        onChange={() => {
          setGate(null);
          setPhase("idle");
        }}
      />
    </div>
  ) : (
    <div className="h-full overflow-y-auto" data-testid="find-list">
      {running ? <p className="px-4 py-6 text-[15px] text-fg-muted">{FIND_TEXT.searchingOsmOne}…</p> : null}
      {pastList}
    </div>
  );

  const showOnMap = phone
    ? () => {
        setSheetOpen(false);
        setCardOpen(false);
        setFitSignal((n) => n + 1);
      }
    : undefined;

  const card =
    cardOpen && selectedPin && area ? (
      <GoogleOnlyCard pin={selectedPin} area={area} layout={cardLayout} onClose={closeCard} onSaved={(r) => savedGoogle(selectedPin, r)} onDismiss={() => void dismissGoogle(selectedPin)} onShowOnMap={showOnMap} />
    ) : cardOpen && selectedRow && area ? (
      <BusinessCard
        row={selectedRow}
        area={area}
        trade={trade}
        layout={cardLayout}
        saving={saving}
        onClose={closeCard}
        onSave={() => void saveOne(selectedRow)}
        onDismiss={() => void dismiss(selectedRow)}
        onShowOnMap={showOnMap}
      />
    ) : null;

  const undoBar = undo ? (
    <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-[15px] shadow-xl">
      <span className="text-fg">{fill(FIND_TEXT.dismissed, { name: undo.name })}</span>
      <Button size="sm" onClick={() => void undoDismiss(undo.key)}>
        {FIND_TEXT.undo}
      </Button>
    </div>
  ) : null;

  const mapProps = {
    area,
    rows: pinRows,
    units: result?.progress.units ?? [],
    running,
    progress: result ? progressFraction(result) : null,
    selectedKey,
    hoverKey,
    onSelect: (key: string) => select(key),
    onViewport: setBounds,
    idle: idleCenter,
    fitSignal,
    className: "h-full",
  };
  const mapPane = (
    <div className="relative isolate h-full">
      {googleMap ? <GoogleFindMap {...mapProps} googlePins={visiblePins} /> : <FindMap {...mapProps} />}
      <Legend phone={phone} google={googleMap} />
      {undoBar ? <div className="pointer-events-none absolute bottom-8 left-1/2 z-[1000] -translate-x-1/2">{undoBar}</div> : null}
    </div>
  );

  // On the phone the bar folds into one line once a search exists, so the map gets the screen.
  const barCollapsed = phone && !barOpen && (result !== null || phase === "running" || phase === "gate") && !candidates;

  useEffect(() => {
    if (!phone) setBarOpen(false);
  }, [phone]);

  return (
    <div className="find-wide">
      <div ref={topEl} className="space-y-2 pb-2">
        {barCollapsed ? (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setBarOpen(true)} aria-expanded={false} className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-left text-[15px] text-fg-heading">
              <span className="truncate">
                {form.area} · {trade}
              </span>
              <span className="shrink-0 text-fg-muted">{FIND_TEXT.gateChange}</span>
            </button>
            {running ? (
              <Button variant="danger" onClick={() => void stop()} data-testid="find-submit">
                {FIND_TEXT.stop}
              </Button>
            ) : null}
          </div>
        ) : (
          <FindForm
            trades={trades}
            value={form}
            onChange={setForm}
            onSubmit={() => {
              setBarOpen(false);
              submit();
            }}
            onStop={() => void stop()}
            running={running}
            resolving={phase === "resolving"}
            candidates={candidates}
            onPick={pickCandidate}
            companiesHouseOn={companiesHouseOn}
            googleOn={googleOn}
            onSuggestion={googleOn ? submitSuggestion : undefined}
            error={formError}
            compact={result !== null || phase === "running" || phase === "gate"}
          />
        )}
        <FindProgress phase={phase} query={query} start={start} result={result} error={error} expired={expired} onContinue={() => void continueSearch()} onRunAgain={runAgain} onRunFresh={runFresh} onOpenRunning={openRunning} onStopRunning={(id) => void stopRunning(id)} onPickAlternative={pickAlternative} onPickChild={pickChild} capChildren={capChildren} />
      </div>

      {desktop ? (
        <div ref={gridEl} className="grid grid-cols-[minmax(0,3fr)_minmax(360px,2fr)] gap-3" style={{ height }}>
          {mapPane}
          <div className="relative h-full min-h-0 overflow-hidden rounded-xl border border-line bg-surface">
            {listPane}
            {card}
          </div>
        </div>
      ) : tablet ? (
        <div ref={gridEl} className="flex flex-col gap-3">
          <div className="h-[45dvh] min-h-[320px] shrink-0">{mapPane}</div>
          <div className="relative h-[70dvh] min-h-[420px] overflow-hidden rounded-xl border border-line bg-surface">{listPane}</div>
          {card}
        </div>
      ) : (
        <div ref={gridEl} style={{ height }}>
          {mapPane}
          <div
            data-testid="find-sheet"
            className="fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-t-2xl border-t border-line bg-surface shadow-2xl transition-[height] duration-200"
            style={{ height: sheetOpen ? "78dvh" : 68 }}
          >
            <button type="button" aria-label={sheetOpen ? FIND_TEXT.mapControl : FIND_TEXT.listControl} onClick={() => setSheetOpen((o) => !o)} className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-line-strong" />
            <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
              <span className="truncate text-[16px] text-fg-heading">{result ? summaryText(result) : FIND_TEXT.title}</span>
              <div className="flex overflow-hidden rounded-lg border border-line text-[14px]" role="group" aria-label="View">
                <button type="button" onClick={() => setSheetOpen(true)} aria-pressed={sheetOpen} className={`px-3 py-1 ${sheetOpen ? "bg-surface-3 text-fg-heading" : "text-fg-muted"}`}>
                  {FIND_TEXT.listControl}
                </button>
                <button type="button" onClick={() => setSheetOpen(false)} aria-pressed={!sheetOpen} className={`px-3 py-1 ${!sheetOpen ? "bg-surface-3 text-fg-heading" : "text-fg-muted"}`}>
                  {FIND_TEXT.mapControl}
                </button>
              </div>
            </div>
            {/* Peeking, the sheet shows only the title and the List / Map control — nothing half-cut underneath. */}
            {sheetOpen ? <div className="min-h-0 flex-1">{listPane}</div> : null}
          </div>
          {card}
        </div>
      )}
    </div>
  );
}
