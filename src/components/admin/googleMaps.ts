"use client";

// Maps JavaScript loader and the Places UI Kit element helper
// (docs/finder-google-spec.md §5.1). One <script> per page, injected only when
// a component that needs Google mounts (the Google map, the Area box, a
// listing panel); the browser key is NEXT_PUBLIC_GOOGLE_MAPS_KEY (public by
// nature, referrer-restricted in Cloud Console) and the Map ID
// NEXT_PUBLIC_GOOGLE_MAP_ID. UI Kit elements are created imperatively — never
// written as JSX — so SSR and hydration never see them and no global JSX
// declaration exists anywhere. The pure parts (placeIdOk, googleMapsPlaceUrl)
// are tested in format.test.ts under node; nothing here touches `window` at
// module level.

declare global {
  interface Window {
    /** Maps JavaScript `callback=` target. */
    __dmGmapsReady?: () => void;
    /** Counts `new google.maps.Map()` — one Dynamic Maps load each; e2e G8 asserts ≤ 1 across searches. */
    __dmGmapLoads?: number;
    /** Called by Maps JavaScript when the key is refused after loading. */
    gm_authFailure?: () => void;
    google?: typeof google;
  }
}

/** Real ids are ~27 chars; 72 keeps `google:<id>` inside the dismiss route's 80-char key cap. */
export const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,72}$/;

export function placeIdOk(id: unknown): id is string {
  return typeof id === "string" && PLACE_ID_RE.test(id);
}

/** "View on Google Maps" from a validated place id — built here, never read from a response. */
export function googleMapsPlaceUrl(placeId: unknown): string | null {
  return placeIdOk(placeId) ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}` : null;
}

export function googleMapsKey(): string {
  return (process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "").trim();
}

export function googleMapId(): string {
  return (process.env.NEXT_PUBLIC_GOOGLE_MAP_ID ?? "").trim();
}

/** The map needs the key and a Map ID (Advanced Markers); panels and the Area box need the key only. */
export function googleMapReady(): boolean {
  return !!googleMapsKey() && !!googleMapId();
}

export type GoogleLoadFailure = "no_window" | "no_key" | "auth" | "timeout" | "script" | "no_maps";

export class GoogleLoadError extends Error {
  why: GoogleLoadFailure;
  constructor(why: GoogleLoadFailure) {
    super(why);
    this.name = "GoogleLoadError";
    this.why = why;
  }
}

const CALLBACK = "__dmGmapsReady";
const LOAD_TIMEOUT_MS = 10_000;

let loading: Promise<typeof google.maps> | null = null;
let authFailed = false;
const authListeners = new Set<() => void>();

/** Subscribe to a key refusal after load (`gm_authFailure`); fires at once when it already happened. */
export function onGoogleAuthFailure(cb: () => void): () => void {
  authListeners.add(cb);
  if (authFailed) cb();
  return () => {
    authListeners.delete(cb);
  };
}

/** Inject the Maps JavaScript script once; resolves on its callback, rejects after 10 s or on error. */
export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (typeof window === "undefined" || typeof document === "undefined") return Promise.reject(new GoogleLoadError("no_window"));
  const key = googleMapsKey();
  if (!key) return Promise.reject(new GoogleLoadError("no_key"));
  if (authFailed) return Promise.reject(new GoogleLoadError("auth"));
  const ready = window.google?.maps;
  if (ready && typeof ready.importLibrary === "function") return Promise.resolve(ready);
  if (loading) return loading;
  loading = new Promise<typeof google.maps>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fail = (why: GoogleLoadFailure) => {
      if (timer) clearTimeout(timer);
      loading = null;
      reject(new GoogleLoadError(why));
    };
    timer = setTimeout(() => fail("timeout"), LOAD_TIMEOUT_MS);
    window.__dmGmapsReady = () => {
      if (timer) clearTimeout(timer);
      const maps = window.google?.maps;
      if (maps) resolve(maps);
      else fail("no_maps");
    };
    window.gm_authFailure = () => {
      authFailed = true;
      for (const cb of authListeners) cb();
    };
    const s = document.createElement("script");
    const q = new URLSearchParams({ key, v: "weekly", loading: "async", language: "en", region: "FR", callback: CALLBACK });
    s.src = `https://maps.googleapis.com/maps/api/js?${q.toString()}`;
    s.async = true;
    s.onerror = () => fail("script");
    document.head.appendChild(s);
  });
  return loading;
}

export type GoogleLibraryName = "core" | "maps" | "marker" | "places";

/** `await importLibrary("marker")` after the script is in; typed through @types/google.maps. */
export async function importLibrary<K extends GoogleLibraryName>(name: K): Promise<google.maps.ImportLibraryMap[K]> {
  const maps = await loadGoogleMaps();
  return maps.importLibrary(name) as Promise<google.maps.ImportLibraryMap[K]>;
}

/**
 * Create a UI Kit element with its properties set. Keys prefixed `attr:` are
 * set as HTML attributes (the request element takes `place="<id>"`), every
 * other key is assigned as a property (arrays, strings, booleans). Children
 * are appended in order. The caller mounts it inside a ref'd container from
 * a useEffect and removes it on cleanup.
 */
export function createPlacesElement(tag: string, props: Record<string, unknown> = {}, children: HTMLElement[] = []): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (k.startsWith("attr:")) el.setAttribute(k.slice(5), String(v));
    else (el as unknown as Record<string, unknown>)[k] = v;
  }
  for (const c of children) el.appendChild(c);
  return el;
}

/** Bump the Dynamic Maps load counter (one per `new google.maps.Map()`). */
export function countMapLoad(): number {
  if (typeof window === "undefined") return 0;
  window.__dmGmapLoads = (window.__dmGmapLoads ?? 0) + 1;
  return window.__dmGmapLoads;
}
