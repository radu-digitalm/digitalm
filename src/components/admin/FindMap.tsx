"use client";

// Leaflet map for the finder (docs/finder-ux-spec.md §5.3) and the prospect
// page's mini map (`mini` prop). Loaded with next/dynamic({ ssr: false }) from
// FindWorkspace / MiniMap, so this module only ever runs in the browser.
// Pins are canvas circle markers styled by the pin vocabulary; over 200 pins
// in the viewport they are bucketed by mapCluster.ts into numbered discs.
// Tiles come from tile.openstreetmap.org, requested only for the visible
// viewport once the map is shown (no prefetch of any kind — OSM tile policy).
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import { hasPin, type GeoPolygon, type ResolvedArea, type ResultRow, type SearchUnit } from "./finderApi";
import { clusterPoints, clusterSize } from "./mapCluster";
import { FIND_TEXT, fill } from "./wording";

declare global {
  interface Window {
    __dmFindPins?: { total: number; visible: number; clustered: number; selectedKey: string | null };
    __dmFindProject?: (key: string) => { x: number; y: number } | null;
  }
}

export type MapBounds = { south: number; west: number; north: number; east: number };

export type FindMapProps = {
  area: ResolvedArea | null;
  rows: ResultRow[];
  units?: SearchUnit[];
  running?: boolean;
  /** 0–1 for the top-edge bar, null → indeterminate while running. */
  progress?: number | null;
  selectedKey?: string | null;
  hoverKey?: string | null;
  onSelect?: (key: string) => void;
  onViewport?: (b: MapBounds) => void;
  /** Where to sit when there is no area yet (last area or Europe). */
  idle?: { lat: number; lng: number; zoom: number } | null;
  /** Prospect page: one pin, zoom 14, no zoom control, wheel/touch zoom off. */
  mini?: boolean;
  /** Bump to re-fit the outline (e.g. "Show on map" on the phone). */
  fitSignal?: number;
  className?: string;
};

const PINK = "#ED1E79";
const GREEN = "#34d399";
const AMBER = "#fbbf24";
const ORANGE = "#F15A24";
const GREY = "rgba(160,168,180,0.4)";

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function isTouch(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}

type PinState = { selected: boolean; hovered: boolean; touch: boolean; mini?: boolean };

/** The pin vocabulary of §5.3. */
function pinStyle(r: ResultRow, s: PinState): L.CircleMarkerOptions {
  const base = s.touch ? 9 : 7;
  const active = s.selected || s.hovered;
  if (s.mini) return { radius: 9, fillColor: PINK, fillOpacity: 1, color: "#ffffff", weight: 3, opacity: 1 };
  let fillColor = PINK;
  let fillOpacity = 1;
  let color = PINK;
  let weight = 2;
  if (r.hidden) {
    fillColor = GREY;
    color = GREY;
    fillOpacity = 1;
  } else if (r.alreadySaved) {
    fillColor = GREEN;
    color = GREEN;
  } else if (!r.website) {
    fillOpacity = 0;
  }
  if (r.inside !== "yes" && !r.hidden) {
    color = AMBER;
    weight = 2;
  }
  if (active) {
    color = "#ffffff";
    weight = 3;
  }
  return { radius: active ? base + 3 : base, fillColor, fillOpacity, color, weight, opacity: 1 };
}

function polygonLayer(polygon: GeoPolygon | null, bbox: ResolvedArea["bbox"], approx: boolean): L.Layer {
  const style: L.PathOptions = { color: ORANGE, weight: 2, dashArray: "6 6", fillColor: ORANGE, fillOpacity: 0.06, interactive: false };
  let layer: L.Layer;
  if (polygon) layer = L.geoJSON(polygon as unknown as GeoJSON.GeoJsonObject, { style, interactive: false });
  else layer = L.rectangle([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { ...style, interactive: false });
  if (approx || !polygon) layer.bindTooltip(FIND_TEXT.approxOutline, { sticky: true });
  return layer;
}

function unitIcon(u: SearchUnit): L.DivIcon {
  const cls = u.state === "done" ? "dm-unit-done" : u.state === "failed" ? "dm-unit-failed" : u.state === "running" ? "dm-unit-running" : "dm-unit-pending";
  return L.divIcon({ className: `dm-unit ${cls}`, iconSize: [12, 12], iconAnchor: [6, 6] });
}

function unitTitle(u: SearchUnit): string {
  if (u.state === "failed") return fill(FIND_TEXT.unitFailed, { unit: u.label });
  if (u.state === "done") return fill(FIND_TEXT.unitDone, { unit: u.label });
  if (u.state === "running") return fill(FIND_TEXT.unitRunning, { unit: u.label });
  return u.label;
}

export default function FindMap({ area, rows, units = [], running = false, progress = null, selectedKey = null, hoverKey = null, onSelect, onViewport, idle, mini = false, fitSignal = 0, className = "" }: FindMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const pins = useRef<Map<string, L.CircleMarker>>(new Map());
  const rowsByKey = useRef<Map<string, ResultRow>>(new Map());
  const pinLayer = useRef<L.LayerGroup | null>(null);
  const clusterLayer = useRef<L.LayerGroup | null>(null);
  const unitLayer = useRef<L.LayerGroup | null>(null);
  const outline = useRef<L.Layer | null>(null);
  const clusteredKeys = useRef<Set<string>>(new Set());
  const fittedFor = useRef<string | null>(null);
  const lastSelected = useRef<string | null>(null);
  const lastHover = useRef<string | null>(null);
  const onSelectRef = useRef(onSelect);
  const onViewportRef = useRef(onViewport);
  const touch = useRef(false);
  onSelectRef.current = onSelect;
  onViewportRef.current = onViewport;

  // ---- create the map once ---------------------------------------------------------------
  useEffect(() => {
    if (!el.current || map.current) return;
    touch.current = isTouch();
    const m = L.map(el.current, {
      preferCanvas: true,
      zoomControl: !mini,
      scrollWheelZoom: !mini,
      touchZoom: !mini,
      doubleClickZoom: !mini,
      boxZoom: !mini,
      keyboard: !mini,
      dragging: true,
      attributionControl: true,
      worldCopyJump: true,
    });
    m.createPane("dm-units").style.zIndex = "450";
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION, keepBuffer: 1, updateWhenIdle: true }).addTo(m);
    pinLayer.current = L.layerGroup().addTo(m);
    clusterLayer.current = L.layerGroup().addTo(m);
    unitLayer.current = L.layerGroup().addTo(m);
    const start = idle ?? { lat: 48.5, lng: 6, zoom: 4 };
    m.setView([start.lat, start.lng], mini ? 14 : start.zoom);
    map.current = m;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const onMove = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        recluster();
        const b = m.getBounds();
        onViewportRef.current?.({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
      }, 80);
    };
    m.on("moveend zoomend resize", onMove);

    if (!mini) {
      window.__dmFindProject = (key: string) => {
        const pin = pins.current.get(key);
        if (!pin || clusteredKeys.current.has(key) || !map.current) return null;
        const p = map.current.latLngToContainerPoint(pin.getLatLng());
        return { x: p.x, y: p.y };
      };
    }
    // The container may be laid out after mount (grid heights are measured), so invalidate once more.
    const ro = new ResizeObserver(() => m.invalidateSize({ animate: false }));
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.off("moveend zoomend resize", onMove);
      if (timer) clearTimeout(timer);
      m.remove();
      map.current = null;
      pins.current.clear();
      if (!mini) {
        delete window.__dmFindProject;
        delete window.__dmFindPins;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- clustering (pure bucketing over projected visible pins) --------------------------------
  function publishDebug(visible: number) {
    if (mini) return;
    window.__dmFindPins = { total: pins.current.size, visible, clustered: clusteredKeys.current.size, selectedKey: lastSelected.current };
  }

  function recluster() {
    const m = map.current;
    const cl = clusterLayer.current;
    const pl = pinLayer.current;
    if (!m || !cl || !pl) return;
    const bounds = m.getBounds();
    const visible: { key: string; x: number; y: number; ll: L.LatLng }[] = [];
    for (const [key, pin] of pins.current) {
      const ll = pin.getLatLng();
      if (!bounds.contains(ll)) continue;
      const p = m.latLngToContainerPoint(ll);
      visible.push({ key, x: p.x, y: p.y, ll });
    }
    // The selected pin always stays a pin (it is what the card is about), so it is never bucketed.
    const selected = lastSelected.current;
    const result = clusterPoints(visible.filter((v) => v.key !== selected));
    cl.clearLayers();
    const nowClustered = new Set<string>();
    if (result.clustered) {
      const byKey = new Map(visible.map((v) => [v.key, v.ll]));
      for (const b of result.buckets) {
        const lls = b.keys.map((k) => byKey.get(k)!).filter(Boolean);
        for (const k of b.keys) nowClustered.add(k);
        const lat = lls.reduce((s, l) => s + l.lat, 0) / lls.length;
        const lng = lls.reduce((s, l) => s + l.lng, 0) / lls.length;
        const size = clusterSize(b.keys.length);
        const icon = L.divIcon({ className: "dm-pin-cluster", html: `<span>${b.keys.length}</span>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
        const marker = L.marker([lat, lng], { icon, keyboard: false });
        marker.on("click", () => m.fitBounds(L.latLngBounds(lls), { padding: [40, 40], maxZoom: 18 }));
        marker.addTo(cl);
      }
    }
    // Pins inside a bucket leave the map; the rest come back.
    for (const [key, pin] of pins.current) {
      const shouldHide = nowClustered.has(key);
      const isOn = pl.hasLayer(pin);
      if (shouldHide && isOn) pl.removeLayer(pin);
      else if (!shouldHide && !isOn) pl.addLayer(pin);
    }
    clusteredKeys.current = nowClustered;
    publishDebug(visible.length);
  }

  // ---- outline + fit on area change ------------------------------------------------------
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (outline.current) {
      m.removeLayer(outline.current);
      outline.current = null;
    }
    if (!area) return;
    const layer = polygonLayer(area.polygon, area.bbox, area.polygonApprox === true);
    layer.addTo(m);
    outline.current = layer;
    const id = `${area.label}|${area.bbox.join(",")}`;
    if (fittedFor.current !== id || fitSignal > 0) {
      fittedFor.current = id;
      const b = area.polygon ? (layer as L.GeoJSON).getBounds() : L.latLngBounds([area.bbox[0], area.bbox[1]], [area.bbox[2], area.bbox[3]]);
      if (b.isValid()) m.fitBounds(b, { padding: [24, 24], animate: false });
    }
  }, [area, fitSignal]);

  // ---- pins: diff by key, restyle everything (≤ 2,000 canvas markers) ----------------------------
  useEffect(() => {
    const m = map.current;
    const pl = pinLayer.current;
    if (!m || !pl) return;
    const next = new Map<string, ResultRow>();
    for (const r of rows) if (hasPin(r)) next.set(r.key, r);
    rowsByKey.current = next;
    for (const [key, pin] of pins.current) {
      if (!next.has(key)) {
        pl.removeLayer(pin);
        pins.current.delete(key);
      }
    }
    const state = (key: string): PinState => ({ selected: key === lastSelected.current, hovered: key === lastHover.current, touch: touch.current, mini });
    for (const [key, r] of next) {
      const existing = pins.current.get(key);
      if (existing) {
        const ll = existing.getLatLng();
        if (ll.lat !== r.lat || ll.lng !== r.lng) existing.setLatLng([r.lat!, r.lng!]);
        existing.setStyle(pinStyle(r, state(key)));
        continue;
      }
      const pin = L.circleMarker([r.lat!, r.lng!], { ...pinStyle(r, state(key)), bubblingMouseEvents: false });
      pin.on("click", () => onSelectRef.current?.(key));
      pin.bindTooltip(r.name, { direction: "top", offset: [0, -8], opacity: 0.95 });
      pins.current.set(key, pin);
      if (!clusteredKeys.current.has(key)) pl.addLayer(pin);
    }
    if (mini && rows.length > 0 && rows[0] && hasPin(rows[0])) m.setView([rows[0].lat!, rows[0].lng!], 14, { animate: false });
    recluster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, mini]);

  // ---- selection / hover: restyle only the pins that changed ------------------------------------
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const touched = new Set<string>();
    for (const k of [lastSelected.current, lastHover.current, selectedKey, hoverKey]) if (k) touched.add(k);
    lastSelected.current = selectedKey ?? null;
    lastHover.current = hoverKey ?? null;
    for (const key of touched) {
      const pin = pins.current.get(key);
      const r = rowsByKey.current.get(key);
      if (!pin || !r) continue;
      pin.setStyle(pinStyle(r, { selected: key === selectedKey, hovered: key === hoverKey, touch: touch.current }));
      if (key === selectedKey || key === hoverKey) pin.bringToFront();
    }
    // Pop the selected pin out of its cluster, then pan (never zoom) so it is in view.
    recluster();
    if (selectedKey) {
      const pin = pins.current.get(selectedKey);
      if (pin && !m.getBounds().pad(-0.1).contains(pin.getLatLng())) m.panInside(pin.getLatLng(), { padding: [40, 40] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, hoverKey]);

  // ---- unit dots (parts of a large area) -----------------------------------------------------------
  useEffect(() => {
    const ul = unitLayer.current;
    if (!ul) return;
    ul.clearLayers();
    if (mini || units.length < 2) return;
    for (const u of units) {
      if (!u.center) continue;
      const marker = L.marker([u.center.lat, u.center.lng], { icon: unitIcon(u), interactive: true, keyboard: false, pane: "dm-units" });
      marker.bindTooltip(unitTitle(u), { direction: "top", offset: [0, -6] });
      marker.addTo(ul);
    }
  }, [units, mini]);

  const pct = progress === null || progress === undefined ? null : Math.max(0, Math.min(1, progress));
  return (
    <div className={`relative isolate overflow-hidden rounded-xl border border-line bg-surface-2 ${className}`} data-testid={mini ? "mini-map" : "find-map"} data-pins={rows.filter(hasPin).length}>
      <div ref={el} className="h-full w-full" style={{ minHeight: mini ? 220 : 320 }} role="region" aria-label={mini ? "Map" : "Map of the businesses found"} />
      {running && !mini ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] h-[3px] overflow-hidden bg-white/10" aria-hidden="true">
          <div className={pct === null ? "dm-bar-indeterminate h-full bg-accent-magenta" : "h-full bg-accent-magenta transition-[width] duration-500"} style={pct === null ? undefined : { width: `${Math.round(pct * 100)}%` }} />
        </div>
      ) : null}
    </div>
  );
}
