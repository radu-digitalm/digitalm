"use client";

// The finder map on Google Maps (docs/finder-google-spec.md §5.2): the same
// props and behaviour as FindMap (Leaflet) — the dashed area outline, pins in
// the legend's vocabulary as Advanced Markers, numbered discs from
// @googlemaps/markerclusterer, unit dots, the progress bar, hover/select sync
// and the viewport callback for "List follows the map" — plus the Google-only
// pins (blue, no name: rule §3.4). One Map instance per workspace mount,
// reused across searches and areas (one Dynamic Maps load; StrictMode-guarded
// by keeping the instance on the container element). When the script cannot
// load or the key is refused, the Leaflet FindMap renders instead under one
// line of explanation — the Google-only pins are never handed to it, since
// Places content may not sit on an OpenStreetMap map.
import { MarkerClusterer, SuperClusterViewportAlgorithm, type Cluster, type Marker, type Renderer } from "@googlemaps/markerclusterer";
import { useEffect, useRef, useState } from "react";
import FindMap, { type FindMapProps } from "./FindMap";
import { googleKeyOf, hasPin, type GeoPolygon, type GooglePin, type ResolvedArea, type ResultRow, type SearchUnit } from "./finderApi";
import { countMapLoad, googleMapId, importLibrary, loadGoogleMaps, onGoogleAuthFailure } from "./googleMaps";
import { clusterSize } from "./mapCluster";
import { FIND_TEXT, GOOGLE_TEXT, fill } from "./wording";

export type GoogleFindMapProps = FindMapProps & {
  /** Places Google knows that no other source listed (already filtered by the chips). */
  googlePins?: GooglePin[];
};

const ORANGE = "#F15A24";
const EUROPE = { lat: 48.5, lng: 6, zoom: 4 };

type PinSpec = { key: string; lat: number; lng: number; title: string; tooltip: string | null; classes: string[] };
type AdvancedMarker = google.maps.marker.AdvancedMarkerElement;

function isTouch(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}

/** The pin vocabulary of finder-ux §5.3 as classes on the marker content. */
function rowClasses(r: ResultRow): string[] {
  const c: string[] = [];
  if (r.hidden) c.push("dm-gpin-hidden");
  else if (r.alreadySaved) c.push("dm-gpin-saved");
  else if (r.website) c.push("dm-gpin-website");
  else c.push("dm-gpin-nowebsite");
  if (r.inside !== "yes" && !r.hidden) c.push("dm-gpin-outside");
  return c;
}

/** Google-only pins are blue; a saved one turns green, a hidden one grey. */
function pinClasses(p: GooglePin): string[] {
  if (p.hidden) return ["dm-gpin-google", "dm-gpin-hidden"];
  if (p.saved) return ["dm-gpin-google", "dm-gpin-saved"];
  return ["dm-gpin-google"];
}

function unitClass(u: SearchUnit): string {
  return u.state === "done" ? "dm-unit-done" : u.state === "failed" ? "dm-unit-failed" : u.state === "running" ? "dm-unit-running" : "dm-unit-pending";
}

function unitTitle(u: SearchUnit): string {
  if (u.state === "failed") return fill(FIND_TEXT.unitFailed, { unit: u.label });
  if (u.state === "done") return fill(FIND_TEXT.unitDone, { unit: u.label });
  if (u.state === "running") return fill(FIND_TEXT.unitRunning, { unit: u.label });
  return u.label;
}

/** GeoJSON [lng, lat] rings → polygons of rings of LatLng literals; a bbox rectangle without a polygon. */
function ringsOf(polygon: GeoPolygon | null, bbox: ResolvedArea["bbox"]): google.maps.LatLngLiteral[][][] {
  const toRing = (ring: unknown): google.maps.LatLngLiteral[] =>
    Array.isArray(ring)
      ? ring
          .filter((pt): pt is [number, number] => Array.isArray(pt) && typeof pt[0] === "number" && typeof pt[1] === "number")
          .map(([lng, lat]) => ({ lat, lng }))
      : [];
  if (polygon && polygon.type === "Polygon" && Array.isArray(polygon.coordinates)) return [(polygon.coordinates as unknown[]).map(toRing).filter((r) => r.length >= 3)];
  if (polygon && polygon.type === "MultiPolygon" && Array.isArray(polygon.coordinates)) return (polygon.coordinates as unknown[]).map((poly) => (Array.isArray(poly) ? poly.map(toRing).filter((r) => r.length >= 3) : [])).filter((p) => p.length > 0);
  const [s, w, n, e] = bbox;
  return [
    [
      [
        { lat: s, lng: w },
        { lat: n, lng: w },
        { lat: n, lng: e },
        { lat: s, lng: e },
      ],
    ],
  ];
}

function paddedContains(m: google.maps.Map, pos: google.maps.LatLngLiteral): boolean {
  const b = m.getBounds();
  if (!b) return true;
  const ne = b.getNorthEast();
  const sw = b.getSouthWest();
  const dLat = (ne.lat() - sw.lat()) * 0.1;
  const dLng = (ne.lng() - sw.lng()) * 0.1;
  return pos.lat >= sw.lat() + dLat && pos.lat <= ne.lat() - dLat && pos.lng >= sw.lng() + dLng && pos.lng <= ne.lng() - dLng;
}

export default function GoogleFindMap(props: GoogleFindMapProps) {
  const [fallback, setFallback] = useState(false);
  if (fallback) {
    const { googlePins: _pins, className = "", ...rest } = props;
    void _pins;
    return (
      <div className={`flex flex-col gap-1 ${className}`} data-testid="google-map-fallback">
        <p className="shrink-0 text-[15px] text-fg-muted">{GOOGLE_TEXT.mapFailed}</p>
        <div className="min-h-0 flex-1">
          <FindMap {...rest} className="h-full" />
        </div>
      </div>
    );
  }
  return <GoogleMapPane {...props} onFail={() => setFallback(true)} />;
}

function GoogleMapPane({ area, rows, googlePins = [], units = [], running = false, progress = null, selectedKey = null, hoverKey = null, onSelect, onViewport, idle, fitSignal = 0, className = "", onFail }: GoogleFindMapProps & { onFail: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const markerLib = useRef<google.maps.MarkerLibrary | null>(null);
  const clusterer = useRef<MarkerClusterer | null>(null);
  const markers = useRef<Map<string, AdvancedMarker>>(new Map());
  const positions = useRef<Map<string, google.maps.LatLngLiteral>>(new Map());
  const specs = useRef<Map<string, PinSpec>>(new Map());
  const clustered = useRef<Set<string>>(new Set());
  const unitMarkers = useRef<AdvancedMarker[]>([]);
  const shapes = useRef<(google.maps.Polygon | google.maps.Polyline)[]>([]);
  const projector = useRef<google.maps.OverlayView | null>(null);
  const fittedFor = useRef<string | null>(null);
  const lastSelected = useRef<string | null>(null);
  const lastHover = useRef<string | null>(null);
  const touch = useRef(false);
  const onSelectRef = useRef(onSelect);
  const onViewportRef = useRef(onViewport);
  const onFailRef = useRef(onFail);
  onSelectRef.current = onSelect;
  onViewportRef.current = onViewport;
  onFailRef.current = onFail;
  const [ready, setReady] = useState(0);
  const [approx, setApprox] = useState(false);

  function style(mk: AdvancedMarker, s: PinSpec, selected: boolean, hovered: boolean) {
    const content = mk.content as HTMLElement | null;
    if (!content) return;
    const classes = ["dm-gpin", ...s.classes];
    if (touch.current) classes.push("dm-gpin-touch");
    if (selected) classes.push("dm-gpin-selected");
    else if (hovered) classes.push("dm-gpin-hovered");
    content.className = classes.join(" ");
    content.title = s.tooltip ?? "";
    mk.zIndex = selected ? 900 : hovered ? 800 : s.classes.includes("dm-gpin-hidden") ? 1 : 10;
  }

  function recomputeClustered() {
    const set = new Set<string>();
    for (const [key, mk] of markers.current) if (!mk.map) set.add(key);
    clustered.current = set;
  }

  function publishDebug() {
    const m = map.current;
    const b = m?.getBounds();
    let visible = 0;
    if (b) for (const pos of positions.current.values()) if (b.contains(pos)) visible++;
    window.__dmFindPins = { total: markers.current.size, visible, clustered: clustered.current.size, selectedKey: lastSelected.current };
  }

  // ---- create the map once per mount; reuse the instance kept on the container ---------------
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let cancelled = false;
    let idleListener: google.maps.MapsEventListener | null = null;
    let clusterListener: google.maps.MapsEventListener | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribeAuth = onGoogleAuthFailure(() => onFailRef.current());
    (async () => {
      try {
        await loadGoogleMaps();
        const [mapsLib, mLib] = await Promise.all([importLibrary("maps"), importLibrary("marker")]);
        if (cancelled) return;
        markerLib.current = mLib;
        touch.current = isTouch();
        const holder = node as HTMLDivElement & { __dmMap?: google.maps.Map };
        let m = holder.__dmMap ?? null;
        if (!m) {
          const start = idle ?? EUROPE;
          m = new mapsLib.Map(node, {
            mapId: googleMapId(),
            center: { lat: start.lat, lng: start.lng },
            zoom: start.zoom,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            gestureHandling: "greedy",
            clickableIcons: false,
            colorScheme: "DARK",
          });
          holder.__dmMap = m;
          countMapLoad();
        }
        map.current = m;
        const renderer: Renderer = {
          render: ({ count, position }: Cluster): Marker => {
            const size = clusterSize(count);
            const disc = document.createElement("div");
            disc.className = "dm-gcluster";
            disc.style.width = `${size}px`;
            disc.style.height = `${size}px`;
            const label = document.createElement("span");
            label.textContent = String(count);
            disc.appendChild(label);
            return new mLib.AdvancedMarkerElement({ position, content: disc, zIndex: 1000 + count });
          },
        };
        // The same 56 px cell as mapCluster.ts; past zoom 17 every pin stands alone.
        const c = new MarkerClusterer({ map: m, markers: [], algorithm: new SuperClusterViewportAlgorithm({ radius: 56, maxZoom: 17 }), renderer });
        clusterer.current = c;
        clusterListener = google.maps.event.addListener(c, "clusteringend", () => {
          recomputeClustered();
          publishDebug();
        });
        // A hidden overlay whose projection turns a pin into container pixels (e2e hook).
        class Projector extends mapsLib.OverlayView {
          onAdd() {}
          draw() {}
          onRemove() {}
        }
        const p = new Projector();
        p.setMap(m);
        projector.current = p;
        window.__dmFindProject = (key: string) => {
          const pos = positions.current.get(key);
          const proj = projector.current?.getProjection();
          if (!pos || !proj || !markers.current.has(key) || clustered.current.has(key)) return null;
          const pt = proj.fromLatLngToContainerPixel(new google.maps.LatLng(pos.lat, pos.lng));
          return pt ? { x: pt.x, y: pt.y } : null;
        };
        idleListener = m.addListener("idle", () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            const b = map.current?.getBounds();
            if (b) {
              const ne = b.getNorthEast();
              const sw = b.getSouthWest();
              onViewportRef.current?.({ south: sw.lat(), west: sw.lng(), north: ne.lat(), east: ne.lng() });
            }
            publishDebug();
          }, 80);
        });
        setReady((n) => n + 1);
      } catch {
        if (!cancelled) onFailRef.current();
      }
    })();
    return () => {
      cancelled = true;
      unsubscribeAuth();
      if (timer) clearTimeout(timer);
      idleListener?.remove();
      clusterListener?.remove();
      // The Map instance stays on the container (dev StrictMode re-runs this effect on the same node,
      // and a fresh one would be a second Dynamic Maps load); everything drawn on it is rebuilt.
      clusterer.current?.clearMarkers(true);
      clusterer.current?.setMap(null);
      clusterer.current = null;
      for (const mk of markers.current.values()) mk.map = null;
      markers.current.clear();
      positions.current.clear();
      specs.current.clear();
      clustered.current.clear();
      for (const s of shapes.current) s.setMap(null);
      shapes.current = [];
      for (const u of unitMarkers.current) u.map = null;
      unitMarkers.current = [];
      projector.current?.setMap(null);
      projector.current = null;
      map.current = null;
      fittedFor.current = null;
      delete window.__dmFindProject;
      delete window.__dmFindPins;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- outline + fit on area change ------------------------------------------------------
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const s of shapes.current) s.setMap(null);
    shapes.current = [];
    setApprox(false);
    if (!area) return;
    for (const poly of ringsOf(area.polygon, area.bbox)) {
      shapes.current.push(new google.maps.Polygon({ paths: poly, strokeOpacity: 0, strokeWeight: 0, fillColor: ORANGE, fillOpacity: 0.06, clickable: false, map: m }));
      for (const ring of poly) {
        const first = ring[0];
        if (!first) continue;
        shapes.current.push(
          new google.maps.Polyline({
            path: [...ring, first],
            strokeOpacity: 0,
            icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeColor: ORANGE, strokeWeight: 2, scale: 2 }, offset: "0", repeat: "12px" }],
            clickable: false,
            map: m,
          }),
        );
      }
    }
    setApprox(area.polygonApprox === true || !area.polygon);
    const id = `${area.label}|${area.bbox.join(",")}`;
    if (fittedFor.current !== id || fitSignal > 0) {
      fittedFor.current = id;
      const [s, w, n, e] = area.bbox;
      m.fitBounds(new google.maps.LatLngBounds({ lat: s, lng: w }, { lat: n, lng: e }), 24);
    }
  }, [area, fitSignal, ready]);

  // ---- pins: diff by key, restyle everything ---------------------------------------------------
  useEffect(() => {
    const m = map.current;
    const lib = markerLib.current;
    const c = clusterer.current;
    if (!m || !lib || !c) return;
    const next = new Map<string, PinSpec>();
    for (const r of rows) if (hasPin(r)) next.set(r.key, { key: r.key, lat: r.lat!, lng: r.lng!, title: r.name, tooltip: null, classes: rowClasses(r) });
    for (const p of googlePins) {
      const key = googleKeyOf(p.placeId);
      next.set(key, { key, lat: p.lat, lng: p.lng, title: "", tooltip: GOOGLE_TEXT.onlyOnGoogle, classes: pinClasses(p) });
    }
    specs.current = next;
    const gone: Marker[] = [];
    for (const [key, mk] of markers.current) {
      if (next.has(key)) continue;
      gone.push(mk);
      mk.map = null;
      markers.current.delete(key);
      positions.current.delete(key);
    }
    if (gone.length) c.removeMarkers(gone, true);
    const added: Marker[] = [];
    for (const [key, s] of next) {
      const selected = key === lastSelected.current;
      const hovered = key === lastHover.current;
      const existing = markers.current.get(key);
      if (existing) {
        const pos = positions.current.get(key);
        if (!pos || pos.lat !== s.lat || pos.lng !== s.lng) {
          existing.position = { lat: s.lat, lng: s.lng };
          positions.current.set(key, { lat: s.lat, lng: s.lng });
        }
        if (existing.title !== s.title) existing.title = s.title;
        style(existing, s, selected, hovered);
        continue;
      }
      const content = document.createElement("div");
      const mk = new lib.AdvancedMarkerElement({ position: { lat: s.lat, lng: s.lng }, content, title: s.title, gmpClickable: true });
      style(mk, s, selected, hovered);
      mk.addEventListener("gmp-click", () => onSelectRef.current?.(key));
      markers.current.set(key, mk);
      positions.current.set(key, { lat: s.lat, lng: s.lng });
      // The selected pin is what the card is about: it stays a pin, outside the clusterer.
      if (selected) mk.map = m;
      else added.push(mk);
    }
    if (added.length) c.addMarkers(added, true);
    c.render();
    recomputeClustered();
    publishDebug();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, googlePins, ready]);

  // ---- selection / hover: restyle only the pins that changed ------------------------------------
  useEffect(() => {
    const m = map.current;
    const c = clusterer.current;
    if (!m || !c) return;
    const prevSelected = lastSelected.current;
    const prevHover = lastHover.current;
    lastSelected.current = selectedKey ?? null;
    lastHover.current = hoverKey ?? null;
    for (const key of new Set([prevSelected, prevHover, selectedKey, hoverKey])) {
      if (!key) continue;
      const mk = markers.current.get(key);
      const s = specs.current.get(key);
      if (mk && s) style(mk, s, key === selectedKey, key === hoverKey);
    }
    if (prevSelected !== (selectedKey ?? null)) {
      // Pop the selected pin out of its cluster; the previous one goes back in.
      const prev = prevSelected ? markers.current.get(prevSelected) : null;
      if (prev) {
        prev.map = null;
        c.addMarker(prev, true);
      }
      const cur = selectedKey ? markers.current.get(selectedKey) : null;
      if (cur) {
        c.removeMarker(cur, true);
        cur.map = m;
      }
      c.render();
    }
    // Pan (never zoom) so the selected pin is in view.
    if (selectedKey) {
      const pos = positions.current.get(selectedKey);
      if (pos && !paddedContains(m, pos)) m.panTo(pos);
    }
    recomputeClustered();
    publishDebug();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, hoverKey, ready]);

  // ---- unit dots (parts of a large area) -----------------------------------------------------------
  useEffect(() => {
    const m = map.current;
    const lib = markerLib.current;
    if (!m || !lib) return;
    for (const u of unitMarkers.current) u.map = null;
    unitMarkers.current = [];
    if (units.length < 2) return;
    for (const u of units) {
      if (!u.center) continue;
      const dot = document.createElement("div");
      dot.className = `dm-unit dm-gunit ${unitClass(u)}`;
      dot.title = unitTitle(u);
      unitMarkers.current.push(new lib.AdvancedMarkerElement({ map: m, position: { lat: u.center.lat, lng: u.center.lng }, content: dot, zIndex: 5 }));
    }
  }, [units, ready]);

  const pct = progress === null || progress === undefined ? null : Math.max(0, Math.min(1, progress));
  const pinCount = rows.filter(hasPin).length + googlePins.length;
  return (
    <div className={`dm-gmap relative isolate overflow-hidden rounded-xl border border-line bg-surface-2 ${className}`} data-testid="find-map" data-map="google" data-pins={pinCount}>
      <div ref={el} className="h-full w-full" style={{ minHeight: 320 }} role="region" aria-label="Map of the businesses found" />
      {running ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[2] h-[3px] overflow-hidden bg-white/10" aria-hidden="true">
          <div className={pct === null ? "dm-bar-indeterminate h-full bg-accent-magenta" : "h-full bg-accent-magenta transition-[width] duration-500"} style={pct === null ? undefined : { width: `${Math.round(pct * 100)}%` }} />
        </div>
      ) : null}
      {approx ? <span className="pointer-events-none absolute right-2 top-2 z-[2] rounded bg-surface/85 px-1.5 py-0.5 text-[13px] text-fg-muted">{FIND_TEXT.approxOutline}</span> : null}
      {/* Our own data on Google's map: the OpenStreetMap credit sits on the map itself (the list footer is off-screen on the phone). */}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="dm-osm-attr">
        {GOOGLE_TEXT.osmAttribution}
      </a>
    </div>
  );
}
