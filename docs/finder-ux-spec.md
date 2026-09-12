# Finder redesign — "map-first" (final spec v2, 12 Sep 2026)

Scope: `/admin/find` rebuilt around a map, the search engine behind it fixed (polygon areas, honest progress, register enrichment), plus a readability pass on `/admin/prospects`, `/admin/prospects/[id]` and Today. Repo `/home/hermes/workspace/digitalm`, branch `feat/finder-ux` off `main` (sub-branches `feat/finder-ux-backend`, `feat/finder-ux-frontend`; every commit `finder-ux: …`; never push; never commit `.env*`). This document wins over `docs/leadgen-build-spec.md` §6 where they differ; everything not mentioned here or in §8 "What stays exactly as is" is unchanged. It is the map-first design chosen on 12 Sep with the list-first ideas of §13 grafted in; §14 lists what changed against the winning draft.

Why: Radu typed "ariege", picked Restaurant and got Andorra and a strip of Spain (the finder searched the bounding rectangle), no map, 12–13 px text, codes instead of words ("OSM", "FR reg.", "partial"), and rows he could not open. His requirement stands: *worldwide — any geographic area (town, department, region, country) and a trade.*

Verified on 12 Sep 2026 while writing this (numbers reused below):
- Nominatim `search?q=ariege&addressdetails=1&polygon_geojson=1&polygon_threshold=0.005` → relation **7439**, `addresstype: county`, `ISO3166-2-lvl6: FR-09`, `ISO3166-2-lvl4: FR-OCC`, `importance 0.6476`, polygon 205 points at that threshold; **11,964 points** at full precision (the scratchpad `ariege-polygon.json`, 273 KB).
- Overpass `area(3600007439)->.a; nwr["amenity"="restaurant"](area.a); out count;` → **292**. The area id is `3600000000 + relationId` (3.6 × 10⁹ — constant `AREA_OFFSET = 3_600_000_000`; the "36000000000" in the task brief has one zero too many).
- Overpass `area["ref:INSEE"="09122"]["boundary"="administrative"]` (Foix) → 32 restaurants; `rel(area.a)["boundary"="administrative"]["admin_level"="6"]; out tags center;` lists a region's departments with `ref:INSEE` and `ISO3166-2` tags.
- geo.gouv `/departements/09` → `codeRegion 76`; `/regions/76/departements` → the 13 Occitanie departments.
- `recherche-entreprises.api.gouv.fr/near_point?lat&long&radius&activite_principale` works; `/search` with `lat`/`long` returns 400 (the bug behind "register skipped" on Nominatim areas today).
- Current code (main @ `c7b84fe`): `geocode.ts` refuses bbox > 1.5 deg² (`area_too_large`), `overpass.ts` queries ≤ 24 rectangular tiles, `frRegister.ts` uses `/search?lat&long` for non-geo.gouv areas, `index.ts` truncates to 300 rows in tile order, `ResultsTable.tsx` shows "OSM" / "FR reg." / "partial" badges at 12 px. `MergedBusiness` lives in `discover/dedupe.ts` (not `types.ts`); `searches` has no `status` column; the job runner (`crm/jobs.ts`) is concurrency-1 with a 6-minute abort.

---

## 0. What Radu sees

1. He types **"ariege"** and picks **Restaurant**. The line under the search bar says *Finding "ariege"…* then *Ariège — department, France · about 290 restaurants on the map*. The map zooms to the Ariège outline (dashed orange), pins drop in as the search runs, a progress bar reads *Searching OpenStreetMap — done · Checking the French company register — 12 of 18 pages*. Nothing from Andorra or Spain appears, because nothing outside the outline is ever requested.
2. The list beside the map is readable (15–16 px): name, town, phone, website, a status word. Chips filter it: *Has website · No website · Has phone · Has email · In the register · Saved · Hidden*. Hovering a row lights its pin; clicking a row or a pin opens the **business card**: address, distance from the centre of Ariège, phone/email/website/socials, register facts in plain sentences, where it came from, and two buttons — **Save & audit** and **Not this one**. "Not this one" is remembered on the server, so the same search stays triaged tomorrow.
3. He types **"Occitanie"**: the finder answers before running — *About 12,000 restaurants in Occitanie. One search holds 2,000. Search one department to see everything there — or continue and get the 2,000 nearest the centre of Occitanie.* with the 13 departments as buttons. **"France"**: same gate, same honesty (§2.6). **"Andorra"**: it works; the register is skipped with the sentence *French company register not searched — Andorra is not in France.* **"Cambridge"**: a two-line chooser, *Cambridge — city, United Kingdom* / *Cambridge — city, United States*.
4. No "OSM", "FR reg.", "partial", "http_429", "GOOGLE_PLACES=off", "caveat" anywhere. Prospects and Today are readable at a glance; the prospect page leads with the address, a small map, phone and website.

---

## 1. Ownership (two engineers in parallel, one integrator)

### 1.1 Backend — exclusive

- `src/lib/discover/**`: existing `geocode.ts`, `overpass.ts`, `frRegister.ts`, `frRegisterMap.ts`, `index.ts`, `categories.ts`, `companiesHouse.ts`, `google.ts`, `dedupe.ts` (+ their tests); **new** `polygon.ts`, `plan.ts`, `runner.ts`, `notes.ts`, `townFill.ts`, `adminChildren.ts`, `areaQuery.ts`, `geocode.test.ts`, `polygon.test.ts`, `plan.test.ts`, `runner.test.ts`, `notes.test.ts`, `townFill.test.ts`, `areaQuery.test.ts`; **deleted** `overpassQuery.ts` + `overpassQuery.test.ts`; fixtures `src/lib/discover/fixtures/{ariege.polygon.json, ariege.fine.polygon.json, search-ariege.sample.json, nominatim-shapes.json}`.
- `src/lib/prospects/**`: `store.ts`, `registerCheck.ts`, **new** `communeLookup.ts` (+ test).
- `src/lib/inbox/today.ts`, `src/lib/inbox/today.test.ts` (card set only; `collectToday` queries may gain the "next call" prospect).
- `src/app/api/admin/find/**`: `route.ts`, `save/route.ts`, **new** `cancel/route.ts`, `continue/route.ts`, `dismiss/route.ts`, `recent/route.ts`.
- `src/app/api/admin/prospects/**`: `route.ts`, `[id]/route.ts`, **new** `backfill-towns/route.ts`; the rest owned, no change expected.
- `scripts/digitalm-digest.js` (+ its mirror in `/home/hermes/workspace/scripts/`) — Today text mirror only.

### 1.2 Frontend — exclusive

- `src/components/admin/FindForm.tsx` (rewritten as the search bar); **new** `FindWorkspace.tsx`, `FindMap.tsx`, `FindList.tsx`, `FindProgress.tsx`, `BusinessCard.tsx`, `AreaInput.tsx`, `TradePicker.tsx`, `Legend.tsx`, `MiniMap.tsx`, `mapCluster.ts` (+ `mapCluster.test.ts`), `wording.ts` (+ `wording.test.ts`), `format.ts` (+ `format.test.ts`); **deleted** `ResultsTable.tsx` (`ATTRIBUTION_TEXT` moves to `wording.ts`; `RegisterBlock` imports it from there).
- `ProspectTable.tsx`, `ProspectBadges.tsx`, `RegisterBlock.tsx`, `WebsiteBlock.tsx`, `GoogleBlock.tsx`, `AddByUrl.tsx`, `TodayCards.tsx`; wording/size-only edits in `AuditBlock.tsx`, `DraftPanel.tsx`, `SendPanel.tsx`, `CallPanel.tsx` (no logic change — same requests, same state machine).
- Primitives `DataTable.tsx`, `Badge.tsx`, `Field.tsx`, `Select.tsx`, `Textarea.tsx`, `KeyValue.tsx`, `Nav.tsx`, `AdminShell.tsx`, `Button.tsx`, `EmptyState.tsx`.
- Pages `src/app/(tools)/admin/(gated)/{page.tsx, find/page.tsx, prospects/page.tsx, prospects/[id]/page.tsx}`.
- `src/app/globals.css` — additions inside one new `/* @@admin */ … /* @@admin:end */` block only.
- `package.json` + `package-lock.json` — adds `leaflet@1.9.4` and dev `@types/leaflet@^1.9`; nothing else.
- `scripts/e2e/finder.cjs` (Playwright acceptance script; CommonJS because `NODE_PATH` is ignored by ESM imports).

### 1.3 Shared, append-only under markers

The marker owner inserts the marker on day 0; the other engineer never edits outside it; nobody reorders.

| File | Marker | Inserted by | Appended by |
|---|---|---|---|
| `src/lib/crm/types.ts` (end of file) | `// @@finder-ux:types` | backend, day 0 | backend only (§3.1); frontend imports, never edits |
| `src/lib/crm/schema.ts` `EXTRA_COLUMNS` | existing `// @@crm:finder` | — | backend (§3.1 schema) |
| `.env.example` | existing `# @@crm:finder` | — | backend (`FIND_MAX_ROWS`, `FIND_MAX_UNITS`, `FIND_MAX_MS`) |
| `README.md` "Admin CRM" section (end) | `<!-- @@finder-ux:backend -->` then `<!-- @@finder-ux:frontend -->` | backend, day 0 | each engineer under their own marker |
| `docs/leadgen-build-spec.md` (end of file) | `## 16. finder-ux` | backend | backend only — a pointer to this document plus the §4 API contract; nothing else in that file is edited |

### 1.4 Rules

- No other shared edits. `next.config.mjs` untouched: the CSP already allows `img-src 'self' data: https:` (tiles), `style-src 'unsafe-inline'`, `script-src 'self'`. `src/lib/crm/{http,apiCache,apiUsage,auth,db,time,classify}.ts`, `src/instrumentation.ts`, `src/middleware.ts`, `src/lib/crm/jobs.ts` untouched.
- No new port, unit, cron, or dependency other than Leaflet. One `next build` at a time on the box — **only the integrator builds staging**; engineers run `NODE_OPTIONS=--max-old-space-size=1536 npx tsc --noEmit` and `npm test`.
- Day 0 (backend, first two hours): §3.1 types appended, schema + `.env.example` appends, `notes.ts` codes with text, and the fixture `src/lib/discover/fixtures/search-ariege.sample.json` (a full `SearchResultV2` while running and one when done) committed on `feat/finder-ux` — the frontend builds against the fixture until the routes land.
- Integrator (this document's owner) resolves any contract question by appending to §15 "Decisions log"; engineers do not edit this file.

---

## 2. Area resolution (backend: `geocode.ts`, `polygon.ts`, `adminChildren.ts`)

### 2.1 Input routing

Query trimmed, whitespace collapsed, ≤ 120 chars. The `hint` body field and the "Country hint" input are gone; the country is inferred (§2.3).

| Input | Resolution | Polygon | Overpass area selector |
|---|---|---|---|
| 5-digit FR postcode | geo.gouv `communes?codePostal=<code>&fields=nom,code,codeDepartement,codesPostaux,centre,contour,population` → **all** communes of the postcode; main commune = highest population | MultiPolygon union of the `contour`s (exact) | `{ kind: "insee", codes: [all INSEE codes] }` → `(area["ref:INSEE"="09122"]["boundary"="administrative"]; …)->.a;` (a set of areas; `(area.a)` matches any of them) |
| 2-digit / 2A / 2B / 97x FR department code | geo.gouv `/departements/{code}` → name → Nominatim `search?q=<nom>, France` (path below) | Nominatim | `{ kind: "relation", relId }` |
| Anything else | Nominatim `search?q=…&format=jsonv2&limit=5&addressdetails=1&extratags=1` (no polygon; 30-d cache; 1.1 s lane; UA as today) → classify (§2.2–2.3) → chosen hit → `lookup?osm_ids=R<id>&format=jsonv2&addressdetails=1&extratags=1&polygon_geojson=1&polygon_threshold=<t>` (30-d cache) | Nominatim `geojson` of the lookup; node/way hits → circle (§2.4) | `{ kind: "relation", relId }` for relations; `{ kind: "around", lat, lng, m }` for nodes/ways |

For a French relation hit of kind `town`, `extratags["ref:INSEE"]` (present on French commune relations) → geo.gouv `/communes/{insee}?fields=nom,codesPostaux,codeDepartement` adds `admin.inseeCode`, `admin.postcodes`, `admin.departement`. No `ref:INSEE` → no geo.gouv call, no admin data, the register uses `near_point` (§3.4). The old fuzzy `communes?nom=` path is deleted: nothing can turn a department into a hamlet any more, because kinds are classified before any geo.gouv call. Label: `postcode` → *Foix (09000)* or *09120 — Lavelanet and 6 more communes*; every other kind → Nominatim `name` (+ ", <state>" for towns outside France, as today).

### 2.2 Kind

`AreaKind = "town" | "postcode" | "department" | "region" | "country" | "place"`, from the Nominatim hit:
- `country`: `addresstype === "country"` or `address["ISO3166-1"]`/`country_code` names the hit itself (`osm_type relation`, `admin_level 2` in extratags).
- `region`: `addresstype ∈ {state, region, province}` or `address["ISO3166-2-lvl4"]` equals the hit's own `ISO3166-2` extratag. FR regions: `ISO3166-2-lvl4` → INSEE region code through a fixed 18-row table in `geocode.ts` (`FR-OCC → 76`, `FR-NAQ → 75`, `FR-ARA → 84`, `FR-IDF → 11`, `FR-BFC → 27`, `FR-BRE → 53`, `FR-CVL → 24`, `FR-COR → 94`, `FR-GES → 44`, `FR-HDF → 32`, `FR-NOR → 28`, `FR-PDL → 52`, `FR-PAC → 93`, `FR-GP → 01`, `FR-MQ → 02`, `FR-GF → 03`, `FR-RE → 04`, `FR-YT → 06`; unit-tested against the names geo.gouv `/regions` returns) → `admin.regionCode`, `admin.departements = codes from /regions/{code}/departements` (30-d cache).
- `department`: `addresstype ∈ {county, state_district}` or `address["ISO3166-2-lvl6"]` equals the hit's own code. FR: `FR-09 → admin.departement = "09"`, `FR-2A → "2A"`, `FR-971 → "971"`.
- `town`: `addresstype ∈ {city, town, village, municipality, hamlet, suburb, quarter, neighbourhood}` with `osm_type relation` (a boundary); the same types as node/way hits are `place` with a circle.
- `postcode`: the geo.gouv path.
- `place`: everything else (natural features, parks, islands, mountain ranges, node/way hits).

Classification is pure: `classifyHit(hit): { kind, countryCode, iso }` in `geocode.ts`, tested against `fixtures/nominatim-shapes.json` (Ariège, Occitanie, France, Andorra, Foix, Cambridge UK/US, a hamlet node, the Pyrénées).

### 2.3 Country, ambiguity, alternatives

`countryCode = address.country_code.toUpperCase()` (geo.gouv paths → `FR`); `countryName = address.country` (geo.gouv → "France"). Ambiguity rule: among the ≤ 5 candidates keep those with `importance ≥ 0.75 × top.importance`; if they span more than one country **or** more than one kind, the route answers `409 { ok:false, error: "ambiguous", candidates: [{ osmType, osmId, label, kind, countryCode, countryName }] }` (≤ 5) and the UI shows a chooser; the pick is re-posted as `pick: { osmType, osmId }` and resolved through `lookup?osm_ids=<R|N|W><id>` (cached 30 d). Otherwise the top hit wins and the remaining candidates (≤ 3, deduplicated by label) come back as `alternatives` on the 202 so the UI can show *Not this place? Ariège — river, France* without blocking (§5.6). Ariège: department 0.65 vs river ≈ 0.40 → no chooser; Cambridge UK 0.75 vs US 0.70 → chooser.

### 2.4 Polygons — display and fine

`ResolvedArea.polygon` is the **display outline**: GeoJSON `Polygon | MultiPolygon` (WGS84 `[lng, lat]`) from the lookup at `polygon_threshold` **0.005** (**0.01** for `country`), capped at **5,000 points** — if larger, re-request at double the threshold, up to three times. Node/way hits get a 32-point circle of radius 1.5 km (village/hamlet/neighbourhood) or 4 km (town/suburb/other), `kind = place`, label *within 4 km of X*; Overpass then uses `(around:4000,lat,lon)` instead of an area.

The **fine polygon** (`polygon_threshold` 0.0005, capped at 50,000 points, cached 30 d under its own key) is fetched by the runner **only when a search actually starts** and only for kinds `town`, `department` and `place` — the sizes where 500 m at a border matters. Postcodes already have exact geo.gouv contours; regions and countries use the display outline (their register scopes are administrative anyway). The over-cap gate (§2.6) never fetches it: a France polygon at 0.0005 is a multi-megabyte call for nothing. The fine polygon lives in `api_cache`, never in the `searches` row or the API payload.

`polygon.ts` (pure, no imports beyond types): `pointInPolygon(lng, lat, geom)` (ray casting; holes; MultiPolygon), `bboxOf(geom)`, `centroidOf(geom)`, `circlePolygon(lat, lng, km, n = 32)`, `pointCount(geom)`, `haversineKm(a, b)`. Tests use `fixtures/ariege.polygon.json` (display, 205 pts) and `fixtures/ariege.fine.polygon.json` (11,964 pts, from the scratchpad file): Foix (42.9646, 1.6053) and Pamiers (43.1167, 1.6111) inside; La Massana AD (42.545, 1.515), Formiguères 66 (42.61, 2.11), Camurac 11 (42.79, 1.92) outside; a hand-made polygon with a hole; a two-part MultiPolygon.

### 2.5 Units — how an area is worked (`plan.ts`, pure where possible, tested)

- **Estimate**: one Overpass count on the whole area for the trade — `[out:json][timeout:30];<selector>->.a;(nwr["k"="v"](area.a);…);out count;` — cached **24 h** by `(areaSelector, categoryKey)`, so re-typing Ariège fills the confirmation line instantly and a repeat search makes zero Overpass calls. On 429/504/timeout the estimate is `null` (the search still runs; the progress line shows only "found so far"; note #11).
- **Split rule**: `expected ≤ UNIT_SPLIT_THRESHOLD (5,000)` or unknown → **one unit** (the whole area, one Overpass request). Above it → units = administrative children from one Overpass request per level: `<selector>->.a; rel(area.a)["boundary"="administrative"]["type"="boundary"]["admin_level"="L"]; out tags center;` trying L = 6, then 4, then 8, keeping the first level that yields 2…`FIND_MAX_UNITS (200)` named children with a centre (cached 24 h per `(selector, L)`); each child is a unit `{ id: "r<relId>", relId, label: tags.name, code: tags["ref:INSEE"] ?? tags["ISO3166-2"], center }`. If no level fits (or the area is a circle or a `place`) → bbox tiles of 0.25° clipped by the area — `(area.a)(s,w,n,e)` in the same statement — ordered from the centre outward, `id: "t<row>_<col>"`.
- **Order**: units sorted by haversine distance of their centre to `area.center`, so a capped search is "the N nearest the centre" — a meaningful, explainable subset (France: Cher, Indre, Allier, …).
- **Cap**: `FIND_MAX_ROWS` env, default **2,000** merged rows per search. The runner stops starting new units once the OpenStreetMap row count reaches the cap; the register phase then covers only the departments/postcodes of the units that ran.
- Per-unit Overpass query (`areaQuery.ts`, pure, tested; replaces `overpassQuery.ts`): `[out:json][timeout:60][maxsize:67108864];<selector>->.a;(nwr["k"="v"](area.a)[(s,w,n,e)];…);out center tags 5000;` — tag keys/values validated by the existing regexes (`^[a-z_:]{2,40}$` / `^[a-z_]{2,40}$`); relation ids must be integers in `[1, 99_999_999]` (area id `3_600_000_001…3_699_999_999`); INSEE codes `^\d[0-9AB]\d{3}$`; `around` radius an integer ≤ 20,000 m; anything else throws — the route maps it to `400 bad_area`. A unit answering exactly 5,000 elements is flagged `truncated` (note #6).
- Ceilings: `FIND_MAX_UNITS` 200 per search, `FIND_MAX_MS` 10 min wall clock (a capped France run actually finishes in ~1–2 min: ~8 Overpass units + 8 register departments), Overpass 1 req/s (existing `spaced` lane).

### 2.6 What happens for "France" (and any area over the cap)

`POST /api/admin/find` resolves + estimates and, when `expected > FIND_MAX_ROWS`, answers `200 { ok: true, gate: "over_cap", area, plan: { expected, cap, units: [{ id, label, code, countryCode }], estimateMs } }` **without starting** (children are fetched for the chooser; polygons of children are never fetched). The UI (§5.6) shows: *About 110,000 restaurants in France. One search holds 2,000. Search a region or a department to see everything there — or continue and get the 2,000 nearest the centre of France.* with the children as one-click sub-searches (the primary path) and a secondary **Continue with the 2,000 nearest the centre** button that re-posts with `confirmCap: true`. Then the runner works units from the centre outward and stops at 2,000 with the banner of note #4. A department like Ariège (292 ≤ 5,000) is always a single request; regions under 5,000 (e.g. "optician in Occitanie" ≈ 900) are a single request too. A child sub-search is a normal search whose `area` string is the child's label and whose `pick` is the child's relation id (so "Ariège" from the Occitanie chooser never re-asks).

---

## 3. Search execution (backend)

### 3.1 Types (appended to `src/lib/crm/types.ts` under `// @@finder-ux:types`)

`types.ts` cannot import from `discover/dedupe.ts`, so `ResultRow` restates the merged-row fields; `MergedBusiness` (dedupe.ts) stays structurally assignable to `ResultRow` minus the new fields.

```ts
// @@finder-ux:types — finder-ux (docs/finder-ux-spec.md §3.1). Backend appends here; frontend imports only.
export type AreaKind = "town" | "postcode" | "department" | "region" | "country" | "place";
export type AreaSelector =
  | { kind: "relation"; relId: number }
  | { kind: "insee"; codes: string[] }
  | { kind: "around"; lat: number; lng: number; m: number };
export interface GeoPolygon { type: "Polygon" | "MultiPolygon"; coordinates: unknown }
export interface ResolvedArea extends Area {
  kind: AreaKind;
  countryName: string;                     // "France" — Nominatim address.country; geo.gouv paths → "France"
  polygon: GeoPolygon | null;              // display outline (§2.4); null only for legacy cached areas
  polygonApprox?: boolean;                 // true when the outline is a circle or a legacy bbox
  osmRelationId?: number;
  areaSelector: AreaSelector;
  admin?: Area["admin"] & { inseeCodes?: string[]; departements?: string[]; regionCode?: string };
  radiusKm: number;                        // bbox radius from the centre (register near_point)
}
export type SearchStatus = "running" | "done" | "capped" | "partial" | "failed" | "cancelled" | "interrupted" | "expired";
export type UnitState = "pending" | "running" | "done" | "failed" | "skipped";
export interface SearchUnit { id: string; label: string; code?: string; center: { lat: number; lng: number }; state: UnitState; found: number; truncated?: boolean; error?: string }
export interface RegisterScope { id: string; label: string; state: UnitState; pages: number; totalPages: number | null; found: number }
export interface SearchProgress {
  status: SearchStatus;
  stage: "osm" | "register" | "merge" | "finished";
  units: SearchUnit[];                     // OpenStreetMap units in run order
  registerScopes: RegisterScope[];
  found: number;                           // rows so far (OpenStreetMap rows while running; merged rows once finished)
  expected: number | null;                 // Overpass count, null when unknown
  cap: number;
  rowsVersion: number;                     // bumps when the row list is reordered/replaced (merge); the client refetches from 0
  retryingUntil?: string | null;           // set while waiting out a busy map service (UI: "retrying in 40 s")
  startedAt: string; updatedAt: string; finishedAt: string | null;
  etaSeconds: number | null;               // (units left) × observed mean unit time, after ≥ 2 finished units
}
export interface SearchNote { code: string; text: string; params?: Record<string, string | number> }
export interface ResultRow extends Business {
  key: string;                             // "<source>:<sourceId>" of the identity row — the pick key
  sources: DiscoverySource[];
  provenance: Partial<Record<"website" | "phone" | "email" | "geo" | "address" | "name", DiscoverySource>>;
  inside: "yes" | "approx" | "no";         // polygon membership (OpenStreetMap rows are always "yes")
  distanceKm: number | null;               // haversine from area.center, 1 dp; null without coordinates
  cityApprox?: boolean;                    // city filled from the nearest commune centre (§3.8)
  socials?: Record<string, string>;        // OpenStreetMap contact:* (safeHttpUrl-validated)
  countryName: string;
  countrySource: "source" | "area";        // "area" = assumed from the search area
  hidden?: boolean;                        // "Not this one" (§3.7)
  unitId?: string;
  readAt?: string;                         // ISO, when the source was read (card: "read 12 Sep")
}
export interface SearchResultV2 {
  version: 2; searchId: number; queryArea: string; area: ResolvedArea;
  category: { key: string; label: { fr: string; en: string }; custom: boolean };
  sources: DiscoverySource[];
  rows: ResultRow[];                       // full list, or a slice when ?after= is used
  total: number;                           // rows.length of the full list
  perSource: Partial<Record<DiscoverySource, number>>;
  progress: SearchProgress; notes: SearchNote[];
  alternatives?: { osmType: "relation" | "node" | "way"; osmId: number; label: string; kind: AreaKind; countryCode: string; countryName: string }[];
  durationMs: number | null; createdAt: string;   // ISO 8601 UTC
}
export interface SearchSummaryV2 {
  id: number; queryArea: string; areaLabel: string; areaKind: AreaKind | null; countryCode: string; countryName: string;
  categoryKey: string; categoryLabel: string; sources: DiscoverySource[];
  resultCount: number; perSource: Partial<Record<DiscoverySource, number>>; savedCount: number;
  status: SearchStatus; durationMs: number | null; createdAt: string; cached: boolean;
}
```

Schema — backend appends to `EXTRA_COLUMNS` under `// @@crm:finder`: `["searches","status","TEXT"]`, `["searches","progress","TEXT"]` (JSON `SearchProgress`), `["searches","plan","TEXT"]` (JSON `{ expected, cap, units }`), `["searches","dismissed","TEXT"]` (JSON `string[]`), `["prospects","city_approx","INTEGER"]`, `["prospects","source_socials","TEXT"]` (JSON). Legacy `searches` rows with `status IS NULL` read as `done` (`partial` when `partial = 1`). `.env.example` under `# @@crm:finder`: `FIND_MAX_ROWS=2000`, `FIND_MAX_UNITS=200`, `FIND_MAX_MS=600000` (read through `intEnv`).

### 3.2 Runner (`runner.ts`) — in-process, resumable, one at a time

Not a `jobs` row: the job runner is concurrency-1 and a 6-minute audit would block a click on Search. `startSearch(input)` inserts the `searches` row with `status = 'running'`, `plan`, an initial `progress` (all units `pending`), writes an empty result to `api_cache["search:{id}"]`, returns `{ searchId }` and continues in the background of the `next start` process (`void run()`), holding an `AbortController` in `globalThis.__dmFinder: Map<number, { controller, startedAt }>` (the same pattern as `__dmJobRunner`). Exactly one search runs at a time: a second `POST` answers `409 { error: "search_running", searchId, area, trade }`.

State updates: after **every** unit and every register page the runner rewrites `api_cache["search:{id}"]` (24 h, `SearchResultV2` without `alternatives`) and `searches.progress/status/result_count/per_source`; a heartbeat bumps `progress.updatedAt` every 15 s while waiting (spacing, backoff). Rows while running are OpenStreetMap rows in arrival order, append-only (`rowsVersion` 0); register rows are collected aside. At stage `merge` the runner runs `mergeBusinesses` over everything, `markAlreadySaved`, town fill (§3.8), ordering (§3.7), replaces the list and bumps `rowsVersion` to 1; the client refetches from index 0 exactly once.

Failures and backoff: Overpass 429/504/timeout → wait 20 s, 40 s, 80 s (three tries; `retryingUntil` set; the heartbeat keeps `updatedAt` fresh) then the unit is `failed` (`error: "busy" | "timeout" | "network"`, never an HTTP code) and the search continues with the next unit; a search with any `failed` unit or register scope ends `partial` (note #5 + *Retry the missing areas*). Abort (`cancelSearch(id)`) → `cancelled`, rows kept, current unit's partial page discarded. Overall status when finished: `capped` when the cap stopped it, `partial` when anything failed, `failed` when nothing at all could run (first unit failed three times and no rows), else `done`.

Interrupted: a `running` row whose `progress.updatedAt` is older than **90 s** with no controller in `globalThis.__dmFinder` is reported as `interrupted` on every read (`getSearch`, `listSearches`); `POST /continue` re-runs it in place — units already cached (24 h per unit+category) are instant, so continuing costs only the missing ones. `/continue` on `partial` runs only `failed` units/scopes; on `cancelled` runs the `pending` ones; on `capped` answers `409 not_continuable` (the cap is the point). `run()` also checks `FIND_MAX_MS` between units → `partial` with note #14.

Test (`runner.test.ts`, pure reducer `applyEvent(progress, event)` exported by `runner.ts`): unit done / failed / retry / cancel / interrupted / merge; status resolution `capped` vs `partial` vs `done` vs `failed`; `etaSeconds` after two units; `rowsVersion` bump.

### 3.3 OpenStreetMap adapter (`overpass.ts`)

Per unit: `areaQuery.ts` (§2.5), `spaced("overpass", 1000)`, cache 24 h keyed by `(areaSelector, unitId, categoryKey)`, timeout 60 s. `mapElement` additionally captures `contact:facebook|instagram|linkedin|twitter` (through `safeHttpUrl`) into `socials`; `opening_hours` is **not** kept. Country of a row: `addr:country` if present (`countrySource: "source"`), else `area.countryCode` with `countrySource: "area"` — now correct by construction because the area filter is exact; for `place` areas that may straddle a border the card says *Country: France (assumed from the search area)*. `inside = "yes"` for every OpenStreetMap row; `distanceKm` from `area.center`; `readAt` = fetch time (cache time when served from cache). The tile loop, `TILE_RESERVE_MS`, the 10 s single retry and every "OSM: …" string are deleted.

### 3.4 French register (`frRegister.ts`)

`scopesFor(area, ranUnits)`:
- `postcode` → one scope per postcode (`code_postal=`, ≤ 12);
- `town` with `admin.postcodes` (≤ 12) → `code_postal=` each; a town without geo.gouv data → `near_point`;
- `department` → `departement=<code>`;
- `region` → one `departement=` per `admin.departements` **in unit order, limited to the departments whose OpenStreetMap unit ran** (a single-unit region → all of them);
- `country` FR → the departments whose units ran (children carry `ref:INSEE`);
- `place` → `GET /near_point?lat=&long=&radius=<min(50, ceil(radiusKm))>&activite_principale=&etat_administratif=A&page=&per_page=25`;
- non-FR → not searched (note #1).

`MAX_PAGES` 10 → **40** per scope (1,000 establishments; note #7 when `total_pages > 40`). Every register row with source coordinates is point-in-polygon tested against the fine polygon when present, else the display outline: outside → dropped and counted (note #8). Rows without coordinates (today they get the area centre) keep `geoSource: "centre"`, `lat/lng = area.center`, `inside: "approx"`, `distanceKm: null` when the scope was `departement`/`code_postal` (administratively inside), and are dropped under `near_point`. Errors: the note says *did not answer* (timeout/network) or *was busy* (429/5xx), never the HTTP code (note #9); a failed scope is `failed` and the search ends `partial`. `recheckSiret` unchanged. Pacing 200 ms unchanged.

### 3.5 Companies House, Google

Unchanged behaviour; CH rows have no coordinates → `inside: "approx"`, `distanceKm: null`, card sentence *registered office, not necessarily the shop* (as today). CH is searched only for GB areas with `admin.locality` (towns); regions/countries in GB skip it with note #15. Google stays off (note #10 only when the owner ticked it).

### 3.6 Notes catalogue (`notes.ts`)

Single source of wording; `note(code, params): SearchNote`. `notes.test.ts` asserts every code has text and no text contains a forbidden token (`OSM`, `FR reg`, `http_`, `GOOGLE_PLACES`, `tile`, `partial`, `Nominatim`, `Overpass`, `caveat`, `ISO2`).

1. `register_not_france` — "French company register not searched — {area} is not in France."
2. `register_no_code` — "French company register not searched for this trade (no activity code)."
3. `ch_off` — "Companies House not searched (no API key)."
4. `capped` — "Showing {cap} of about {expected} {trade}s in {area} — the ones nearest the centre of {area} ({done} of {total} areas: {list}). Search a smaller area for full coverage."
5. `units_failed` — "Some areas could not be searched because the map service was busy: {list}. Use “Retry the missing areas”."
6. `unit_truncated` — "{unit} has more than 5,000 {trade}s; the first 5,000 were read."
7. `register_pages_capped` — "The register lists {total} {trade}s in {scope}; the first 1,000 were checked."
8. `register_outside_dropped` — "{n} register entries fell outside {area} and were left out."
9. `register_failed` — "The French company register could not be searched (it {reason}). Businesses found on the map are shown without register details." (`reason` ∈ "did not answer" / "was busy")
10. `google_off` — "Google is switched off for now."
11. `estimate_unknown` — "The map service could not say how many to expect — the count grows as areas finish."
12. `interrupted` — "This search was interrupted (the server restarted). Continue to finish it."
13. `expired` — "This search is more than a day old and its results were cleared. Run it again."
14. `time_limit` — "The search stopped after {minutes} minutes ({done} of {total} areas). Continue to finish it."
15. `ch_needs_town` — "Companies House is searched by town — search a UK town to include it."
16. `country_assumed` — "Country assumed from the search area for {n} businesses without an address country."

`{list}` is at most 6 labels + "…" ; `{trade}` is the category's EN label in lower case; numbers use `toLocaleString("en-GB")`.

### 3.7 Merge, order, hide

`mergeBusinesses` unchanged. Final order: `inside` yes → approx → no; then `distanceKm` ascending (nulls last); then name. No `MAX_ROWS` slice any more — the cap is enforced by not starting units. `searches.dismissed` keys are marked `hidden: true` on every read (`getSearch`), never removed from the list; `dismissSearchRow(searchId, key, undo)` updates the JSON array (≤ 5,000 keys). `markAlreadySaved` as today (also at merge time and on every `GET` read).

### 3.8 Town fill (`townFill.ts`, `communeLookup.ts`)

No per-row geocoding, per the Nominatim policy. At merge time, for rows without `city` but with source coordinates:
- FR areas: the runner loads once per department touched (30-d cache) `geo.gouv /departements/{code}/communes?fields=nom,code,centre,codesPostaux` (≈ 40 KB each; payload guard 2 MB) and assigns the nearest commune centre within **6 km** → `city`, `postcode` (first), `cityApprox: true` (UI: *near Foix*). If the department payload fails or exceeds the guard, the fallback below is used instead of skipping.
- Non-FR areas, and the FR fallback: one Overpass request per unit `<selector>->.a; rel(area.a)["boundary"="administrative"]["admin_level"="8"]; out tags center;` (cached 24 h; `spaced` lane) → the same nearest-centre rule. Still nothing within 6 km → `city` stays empty and the card says *town unknown*.
- `townFill.ts` is pure (`nearestCentre(points, lat, lng, maxKm)`), tested: within 6 km, none beyond, ties by distance.

On **save** (`store.ts saveFromSearch`): FR rows with coordinates and `cityApprox` get the exact commune from `geo.gouv /communes?lat=&lon=&fields=nom,code,codesPostaux` (`communeLookup.ts`; ≤ 5 req/s on a `spaced` lane, cached 30 d by 4-dp coordinates, ≤ 100 lookups per save; a failure keeps the approximate town) → `city`, `postcode`, `city_approx = 0`; `source_socials` stored as JSON. Prospects saved earlier with `city NULL` and coordinates are back-filled by `POST /api/admin/prospects/backfill-towns` (admin, idempotent, ≤ 200 rows per call, FR rows through `communeLookup`, others through the nearest admin_level-8 centre of one Overpass `around:6000` request per row — capped at 20 such rows per call; returns `{ filled, remaining }`; button under **More** on the Prospects page).

---

## 4. API contract (backend; frontend codes against this from day 0)

All under the existing auth/CSRF rules (`guardAdminPost` for POST, `requireAdminApi` for GET); `runtime = "nodejs"`, `dynamic = "force-dynamic"`. Errors: `{ ok: false, error: <code>, message?: <plain sentence> }`. Rate: the routes are cheap; the search itself runs in the background.

- `POST /api/admin/find` body `{ area: string, category: string | { osmKey, osmValue, label?, naf?, sic? }, sources?: DiscoverySource[], pick?: { osmType: "relation" | "node" | "way", osmId: number }, confirmCap?: boolean }` →
  - `202 { ok: true, searchId, area: ResolvedArea, plan: { expected, cap, units: n, estimateMs }, alternatives? }` — started; poll.
  - `200 { ok: true, gate: "over_cap", area, plan: { expected, cap, units: [{ id, label, code, countryCode }], estimateMs } }` — not started (§2.6).
  - `409 ambiguous { candidates }` (§2.3) · `409 search_running { searchId, area, trade }` · `404 area_not_found` · `502 geocode_failed` · `400 bad_area | bad_category | bad_request`.
  - Resolving + estimate ≤ ~8 s (two Nominatim calls at 1.1 s spacing + one Overpass count); `maxDuration` stays 55.
- `GET /api/admin/find?id=N[&after=K&v=V]` → `200 { ok: true, ...SearchResultV2 }`. With `after`, `rows` holds only rows with index ≥ K (`total` carries the full length) **unless** `progress.rowsVersion !== V`, in which case the full list is returned (the client resets). `404 search_expired` (note #13 text in `message`). Legacy cached v1 results are upgraded on read (`version: 2`, `inside: "yes"`, `distanceKm` computed, `polygon: null`, `polygonApprox: true` → the map draws the bbox labelled *approximate outline*; `status` from `partial`).
- `POST /api/admin/find/cancel { searchId }` → `200 { ok: true, status }` (idempotent; `404` unknown id).
- `POST /api/admin/find/continue { searchId }` → `202 { ok: true, searchId }` for `interrupted | partial | cancelled`; `409 not_continuable` for `capped | done | running-elsewhere`; `409 search_running` when another search runs; `410 search_expired`.
- `POST /api/admin/find/dismiss { searchId, key, undo?: boolean }` → `200 { ok: true, hidden: string[] }`; `410 search_expired`; `404` unknown key.
- `POST /api/admin/find/save { searchId, picks: string[] }` — unchanged semantics (30-day notice, audits enqueued for rows with a website, `422 partial_diffusion { picks }`, `410 search_expired`, `saved_count`), `picks` ≤ 300 per call (the list saves in batches of 300); hidden keys are refused with `409 hidden { picks }`. Response unchanged (`saved, auditsQueued, withoutWebsite, alreadySaved, unknown, references`) **plus `prospectIds: number[]`** (same order as `references`) so the card can link *Open prospect* at once.
- `GET /api/admin/find/recent?limit=20` → `200 { ok: true, searches: SearchSummaryV2[] }` (`listSearches` with `status` resolved as in §3.2 and ISO `createdAt`; formatting is client-side).
- `POST /api/admin/prospects/backfill-towns {}` → `200 { ok: true, filled, remaining }`.
- Library exports the pages use (server-side): `getSearch(id)`, `listSearches(limit)`, `searchSummary(id): SearchSummaryV2 | null` (the prospect page's *Found by the search "Ariège · Restaurants" on 12 Sep* line), `CATEGORIES`, `SOURCE_LABELS` (now plain words: `osm: "OpenStreetMap"`, `fr_register: "French company register"`, `companies_house: "Companies House"`, `google: "Google"`).

Example (abridged) `GET ?id=7` while running — `fixtures/search-ariege.sample.json` carries a full one plus a finished one:

```json
{ "ok": true, "version": 2, "searchId": 7, "queryArea": "ariege",
  "area": { "label": "Ariège", "kind": "department", "countryCode": "FR", "countryName": "France",
            "center": { "lat": 42.9455, "lng": 1.4066 }, "bbox": [42.5732, 0.8268, 43.3163, 2.1758],
            "polygon": { "type": "Polygon", "coordinates": [[[1.43, 43.31], "…"]] }, "osmRelationId": 7439,
            "areaSelector": { "kind": "relation", "relId": 7439 }, "admin": { "departement": "09" }, "radiusKm": 58, "provider": "nominatim" },
  "category": { "key": "restaurant", "label": { "fr": "Restaurant", "en": "Restaurant" }, "custom": false },
  "sources": ["osm", "fr_register"], "perSource": { "osm": 289 }, "total": 289,
  "progress": { "status": "running", "stage": "register", "rowsVersion": 0,
                "units": [{ "id": "r7439", "label": "Ariège", "center": { "lat": 42.9455, "lng": 1.4066 }, "state": "done", "found": 289 }],
                "registerScopes": [{ "id": "dep:09", "label": "Ariège (09)", "state": "running", "pages": 7, "totalPages": 18, "found": 175 }],
                "found": 289, "expected": 292, "cap": 2000, "startedAt": "2026-09-12T10:01:02Z", "updatedAt": "2026-09-12T10:01:31Z", "finishedAt": null, "etaSeconds": 4 },
  "rows": [{ "key": "osm:node/1234", "source": "osm", "sourceId": "node/1234", "sourceUrl": "https://www.openstreetmap.org/node/1234", "name": "Le Phoebus", "city": "Foix", "postcode": "09000",
             "countryCode": "FR", "countryName": "France", "countrySource": "area", "lat": 42.9651, "lng": 1.6067, "geoSource": "source", "phone": "+33 5 61 65 10 42", "website": "https://…",
             "inside": "yes", "distanceKm": 16.4, "sources": ["osm"], "provenance": { "name": "osm", "geo": "osm" }, "unitId": "r7439", "readAt": "2026-09-12T10:01:09Z" }],
  "notes": [], "alternatives": [{ "osmType": "way", "osmId": 123, "label": "Ariège — river, France", "kind": "place", "countryCode": "FR", "countryName": "France" }],
  "durationMs": null, "createdAt": "2026-09-12T10:01:02Z" }
```

---

## 5. The page (frontend)

Every visible string lives in `wording.ts` (tested, §7). `data-testid`s named below are part of the contract for `scripts/e2e/finder.cjs`.

### 5.1 Layout

Desktop (≥ 1024 px): the find page opts out of the 1180 px column — `AdminShell`'s `<main>` gets `has-[.find-wide]:max-w-none has-[.find-wide]:px-4 has-[.find-wide]:py-3` (Tailwind 3.4 `has-*` variant; no JS, no flash) and the find page's root carries `find-wide`. Row 1: search bar (Area input · Trade picker · Sources popover · **Search** / **Stop**). Row 2: status line + progress bar (`FindProgress`). Below, a two-pane grid `grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]` with height `calc(100dvh - <header> - <rows>)` (measured with a `ResizeObserver`, min 480 px): **map** left (`data-testid="find-map"`), **list** right (`data-testid="find-list"`), each scrolling on its own; the business card slides over the list pane (420 px, with a **Back** control). Tablet (768–1023): map 45 dvh on top, list below, card as a right sheet. Phone (< 768): map fills the viewport under the bar; the list is a **bottom sheet** (`data-testid="find-sheet"`) with two positions — peek 112 px (count + chips + a **List** control) and expanded 78 dvh — toggled by its handle or the *List* / *Map* segmented control; no drag gestures; a pin tap expands the sheet straight onto that card; the card is a full-height sheet with a **Close** button. The page never scrolls sideways (`document.scrollingElement.scrollWidth === window.innerWidth`), and with the sheet peeking the document height is under 3× the viewport.

### 5.2 Search bar (`FindForm.tsx`, `AreaInput.tsx`, `TradePicker.tsx`)

- **Area** (`AreaInput`, `name="area"`): single text field, placeholder *Town, postcode, department, region or country — e.g. Foix, 09000, Ariège, Occitanie, Andorra*; hint (14 px) *Any place OpenStreetMap knows. Large areas take longer and stop at 2,000 businesses.* On `ambiguous` the candidates render as a radio list under the field (`data-testid="area-candidates"`): *Cambridge — city, United Kingdom* / *Cambridge — city, United States* (kind and country in words); picking one re-posts with `pick`. Enter submits.
- **Trade** (`TradePicker`, `role="combobox"`, `name="category"`): type to filter the 19 trades (EN label; FR label searchable too), last option *Other trade…* which reveals the custom fields with plain labels: *Map category* (select: shops · services and crafts · offices · tourism · leisure · health · amenities → the key), *Map value* (e.g. `tattoo`; hint *lower-case letters and underscores*), *Name to store*, *French activity code (optional, e.g. 96.09Z) — needed for the register*, *UK code (optional, 5 digits) — needed for Companies House*.
- **Sources** popover (button label *Sources: OpenStreetMap + French register*, `data-testid="sources"`): checkboxes with words — *OpenStreetMap (the open map: signs, phones, websites)*, *French company register (Sirene — legal identity, France only)*; *Companies House (UK register)* and *Google* are **greyed and unticked with the reason** (*needs an API key* / *switched off*) instead of ticked-and-"(off)". Defaults: the two enabled ones (plus Companies House when a key is set).
- Helper line under the bar (15 px, muted): *Public sources only, one request per second, results kept for 24 hours.* No "Country hint", no "Regions and countries are refused", no "(up to 45 s)".
- The Search button (`data-testid="find-submit"`) reads **Search** when idle and **Stop** while running (posts `/cancel`).

### 5.3 Map (`FindMap.tsx`, Leaflet 1.9.4)

- Loaded with `next/dynamic(() => import("./FindMap"), { ssr: false })` from `FindWorkspace` (a client component). `import "leaflet/dist/leaflet.css"` inside `FindMap.tsx` (bundled locally; its `url()` images resolve to `/_next/static/media/*`, which is `'self'`). Tiles `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, `maxZoom 19`, `attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'` (always visible, bottom-right), `keepBuffer: 1`, `updateWhenIdle: true`, no prefetch of any kind, tiles requested only once the map is shown (OSM tile usage policy). Standard tile style (no CSS inversion); the map is bordered by `border-line`.
- `preferCanvas: true`; pins are `L.circleMarker` (no image icons): radius 7 (9 on touch), fill `#ED1E79` (has website) / hollow with a 2 px `#ED1E79` stroke (no website) / fill `#34d399` (saved) / grey 40 % (hidden — only when the *Hidden* chip is on) / `#fbbf24` 2 px outline when `inside ≠ yes`; selected = white 3 px ring and radius + 3. A corner **legend** button (`?`, `aria-label="Legend"`) opens `Legend`: the four pin styles, the outline meaning, the status words (§5.4).
- Rows without source coordinates (`geoSource ≠ "source"`: register rows the API returned without latitude/longitude, Companies House rows) get **no pin** — they stay in the list and the card says *Not on the map — the register gives no coordinates for this establishment*; nothing is ever drawn at the area centre.
- Debug/e2e hook: `window.__dmFindPins = { total, visible, clustered, selectedKey }` updated after every render (`total` counts pins after chip filters); cluster discs are DOM elements with class `dm-pin-cluster`; single pins are canvas, so the e2e reads `__dmFindPins.total` and dispatches clicks at the container point returned by `window.__dmFindProject(key) → { x, y } | null` (`map.latLngToContainerPoint`).
- The area outline: `L.geoJSON(area.polygon)` dashed `#F15A24`, weight 2, fill 6 %, `interactive: false`; `fitBounds(polygon, { padding: [24, 24] })` when a result loads; `polygonApprox` outlines carry a tooltip *approximate outline*.
- Clustering (`mapCluster.ts`, pure, tested — input: projected points `{ key, x, y }` at the current zoom, a cell size of 56 px, a threshold): when more than **200** pins fall inside the current viewport, pins are bucketed into a 56 px grid; a bucket with ≥ 2 pins renders as a `L.divIcon` disc with the count (font 14 px, min 32 px); click → `fitBounds` of the bucket. Re-computed on `moveend`/`zoomend` (debounced 80 ms). Under 200 visible pins, no clustering.
- Sync: hover row → pin gets the selected style (no pan); click row → select + open card + `panInside` (no zoom change); click pin → select + open card + scroll the list to the row (`scrollIntoView({ block: "nearest" })`). Chips filter pins and rows together. A *List follows the map* toggle (off by default) restricts the list to pins in the viewport.
- Progress overlay: while `status === running`, a 3 px bar at the top edge of the map; finished units get a 12 px dot at their centre tinted green, failed units a hatched red dot with tooltip *Couserans — could not be searched*, running units a pulsing dot. Units are dots, not polygons (children polygons are never fetched).
- `MiniMap` (same component, `mini` prop): 220 px tall, one pin, zoom 14, no zoom control, scroll-wheel and touch-zoom off, dragging on; attribution kept. Used on the prospect page (§6.4) through a client wrapper `MiniMap.tsx` that does the `ssr: false` import.

### 5.4 List (`FindList.tsx`)

- Header (`data-testid="find-summary"`): *289 businesses in Ariège* (18 px, heading colour) · *from OpenStreetMap 289 · from the register 0 yet* (15 px muted; updates while running). Right: **Save ticked (n)** for bulk saving (checkbox 18 px per row, only where savable; batches of 300).
- **Chips** (multi-select, AND; `role="group"` *Filters*): *Has website (n)* · *No website (n)* · *Has phone (n)* · *Has email (n)* · *In the register (n)* (FR areas only) · *Saved (n)* · *Hidden (n)* (off by default; when on, dismissed rows appear greyed with an **Undo** control). A search-within field (*Filter by name or town*). **Sort** (`name="sort"`): *Nearest the centre* (default) · *Most complete first* (website + phone + email count, then distance) · *Town A–Z* (sticky group headers *Foix (27)*) · *Name A–Z*.
- Row (`data-testid="find-row"`, `data-key`, min height 48 px; the whole row is a `button`; ↑/↓ moves the selection, Enter opens the card, Space toggles the checkbox): checkbox · **Name** (16 px, heading colour; second line 14 px muted: address line, or *near Foix* when `cityApprox`, or nothing — **no dashes**) · **Town** (15 px; `postcode town`; adds the country name when the search area is a country or the row's country differs from the area's) · **Contact** (15 px: phone `whitespace-nowrap` + website domain as a link; nothing when absent) · **Status word** (15 px, `data-testid="row-status"`): *Saved · PR-3K9QX* (link) / *Not listed publicly* (muted) / *Closed in the register* / *Chain* / *Outside the area?* (`inside: no`) / blank. Sources are **not** a column; the card explains them. Rows render in pages of 200 with **Show 200 more** (the map always shows every pin).
- Attribution footer (14 px, muted): *Données © les contributeurs d'OpenStreetMap (ODbL) · Sirene/RNE via API Recherche d'entreprises — Licence Ouverte 2.0 · Companies House — OGL v3* (`ATTRIBUTION_TEXT` in `wording.ts`, also used by `RegisterBlock`).

### 5.5 Business card (`BusinessCard.tsx`, `role="dialog"`, `aria-labelledby` = the name element, `data-testid="business-card"`)

1. **Name** (22 px) · trade label · *Part of the {brand} chain* when `brand`.
2. **Where**: address line; `postcode town` (*near Foix — the source has no street address* when approximate; *town unknown* when empty); *{countryName}* (+ *(assumed from the search area)* when `countrySource = area`); **amber line** *Outside {area}?* when `inside = no`; *{distanceKm} km from the centre of {area}* (omitted when null); *Not on the map — the register gives no coordinates for this establishment* for rows without source coordinates (then no coordinate links, no *Show on map*); otherwise coordinates 5 dp with links *Open in OpenStreetMap* (`https://www.openstreetmap.org/?mlat=&mlon=#map=17/lat/lng`) and *Open in Google Maps* (`https://www.google.com/maps?q=lat,lng`, a plain link). On the phone a **Show on map** button; on desktop the pin is highlighted.
3. **Contact**: phone (`tel:` link) · email (`mailto:`) · website (domain, new tab, `ExtLink`) · socials (Facebook / Instagram / LinkedIn / X as words with the site icon). Absent items are omitted, never dashed.
4. **Register** (FR rows with `registerId`): *Listed in the French company register — {legalName}, SIRET {siret}, {legal form in words}, {active / closed}.* then *Publicly listed* or *Not listed publicly — the owner asked the register to hide the details, so this business cannot be saved or contacted.* Link *Open in the register (annuaire-entreprises)*. Legal-form words from `nature_juridique`: `1000` sole trader · `5710` SAS · `5720` SASU · `5499` SARL · `5498` EURL · `5599`/`5505` SA · `9220` association · `6540` SCI · otherwise *other legal form ({code})* (table in `wording.ts`, tested). Rows without a register match: *Not matched to a register entry yet — the register is checked again after saving.* UK: *Companies House — company {number}, {status}; registered office, not necessarily the shop.*
5. **Where it came from**: one sentence per source — *Found on OpenStreetMap (the open map anyone can edit) — {type} {id}, read {date}* / *Listed in the French company register (Sirene, public data)* / *Companies House*. Both when merged: *Found on OpenStreetMap and matched to the French register.*
6. **Actions**: primary **Save & audit** (`data-testid="card-save"`) when a website exists, else **Save** with the line *No website to audit — the audit needs one*; secondary **Not this one** (`data-testid="card-dismiss"`; posts `/dismiss`; the row disappears unless the *Hidden* chip is on, the next row is selected; an *Undo* toast for 6 s posts `undo: true`). After saving: toast *Saved as PR-XXXXX · audit queued* (or *· no website to audit*), the card shows **Open prospect** (`/admin/prospects/{id}`) and the row's status reads *Saved · PR-XXXXX*. Disabled with the reason when already saved (*Already saved — Open prospect PR-…*), not listed publicly, closed in the register, or hidden. Esc closes; focus returns to the row.

### 5.6 States (`FindProgress.tsx` + workspace)

- **Idle**: search bar + the map centred on the last searched area (or Europe at zoom 4) + *Past searches* (§5.7) in the list pane.
- **Resolving** (0–8 s): bar indeterminate, text *Finding "ariege"…* then *Ariège — department, France · about 292 restaurants on the map* (the estimate line stays for the whole run). When `alternatives` came back: a 14 px line *Not this place? Ariège — river, France* with each alternative as a link that re-posts with its `pick`.
- **Ambiguous**: candidates under the Area field (§5.2).
- **Over the cap gate** (`data-testid="cap-gate"`): an inline panel in the list pane: *About 12,000 restaurants in Occitanie. One search holds 2,000.* + *Search one department instead:* one button per child (`data-testid="cap-child"`) + **Continue with the 2,000 nearest the centre** (`data-testid="cap-continue"`) + *Change area*. Nothing runs and no progressbar shows until a choice is made.
- **Running**: `role="progressbar"` with `aria-valuemin 0`, `aria-valuemax = units.length + registerScopes.length` (≥ 1), `aria-valuenow = finished units + finished scopes`; text *Searching OpenStreetMap — 3 of 13 areas · 412 businesses so far · about 40 s left* → *Checking the French company register — 7 of 18 pages* → *Placing on the map…*; pins and rows appear as units finish; the Search button reads **Stop**. Polling `GET ?id=&after=&v=` every 2 s (4 s after 60 s; stops on a terminal status). While `retryingUntil` is set: *The map service is busy — retrying in 40 s*.
- **Done**: *1,240 businesses in Ariège · 986 on the map, 449 in the register, 195 in both · 48 s.* (`data-testid="find-status"`).
- **Capped**: amber banner with note #4 text; *Search a department* buttons from `plan.units`.
- **Partial**: amber banner note #5 + **Retry the missing areas** (`/continue`).
- **Interrupted**: note #12 + **Continue**. **Expired**: note #13 + **Run again** (re-posts the same area/trade). **Cancelled**: *Stopped after 3 of 13 areas — 412 businesses kept* + **Continue**. **Time limit**: note #14 + **Continue**.
- **Errors** (`role="alert"`): `area_not_found` → *Nothing found for "xyz". Try a town, a postcode, a department, a region or a country.*; `geocode_failed` → *The place lookup did not answer. Try again in a minute.*; `search_running` → *A search is already running ({area} · {trade}).* **Open it** / **Stop it**; `bad_category` → *Pick a trade, or fill in the custom trade (map value: lower-case letters and underscores).*; `bad_area` → *That area could not be used. Try another name.*; anything else → *The search failed. Try again.*
- **Empty**: *No restaurants found in Andorra la Vella on OpenStreetMap. The map may simply not list them yet — try a wider area or another trade.*

### 5.7 Past searches

In the idle list pane and under the results (collapsed `<details>` *Past searches*, `data-testid="past-searches"`): one row per search, whole row clickable: *Ariège · Restaurants — 289 found · 6 saved · 2 h ago* + a status word (*complete / stopped at the cap / some areas missing / stopped / interrupted / results cleared*). Times via `format.ts` `relativeOrLocal(iso)` in Europe/Paris ("2 h ago", else "12 Sep, 09:47"). Source: `GET /api/admin/find/recent` on the client (the page no longer server-renders the table), `DataTable` in card mode on phones.

---

## 6. Readability pass (frontend)

### 6.1 Type scale and primitives (admin only)

- `AdminShell` root: `text-[15px] xl:text-base leading-relaxed`; content column `max-w-content` except through the `has-[.find-wide]` rule (§5.1).
- `DataTable`: cells `text-[15px]`, padding `px-3 py-2.5` (dense `py-2`), row min-height 44 px; `thead` 13 px, `font-medium`, `tracking-wide`, `uppercase`, colour `text-fg-muted` (not faint); `minWidth` prop (default `40rem`); a **`cards`** prop renders each row as a card under 768 px (label + value pairs from the columns' headers; used by `ProspectTable` and past searches). Wide tables still scroll in their own container.
- `Badge`: `text-[13px] px-2.5 py-1`, plain words only (§6.3); optional `title` sentence kept.
- `Field` / `Select` / `Textarea`: label 15 px, input 15–16 px, hint 14 px `text-fg-muted`, error 14 px.
- `KeyValue`: `hideEmpty` prop (default `true` on the prospect page) — rows with no value are not rendered; `dt` 14 px muted, `dd` 15 px. No "—" placeholders anywhere in the admin.
- Checkboxes `h-[18px] w-[18px] accent-[#EE355E]`; links underline on hover; `text-fg-faint` (`#868F9F`, rgb(134,143,159)) reserved for placeholders and disabled text and never under 14 px; `.eyebrow` stays 12 px (secondary, uppercase, tracked — allowed).
- `Nav`: `flex-wrap` on ≥ 640 px; under 640 px a **Menu** button (`aria-expanded`, `aria-controls`) opens a vertical list with every entry (Today, Leads, Find, Prospects, Opt-outs) and Log out; never `overflow-x-auto`.
- Dates: `format.ts` `localDateTime(sqlOrIso)` → "12 Sep 2026, 09:04" in Europe/Paris everywhere (past searches, Saved, Notice, Checked, activities); `relativeOrLocal` for lists (< 24 h → "2 h ago"). Pure (`Intl.DateTimeFormat`, `fromSql` from `crm/time.ts`), usable in server pages and tested under node:test.
- Phone numbers `whitespace-nowrap`; references `font-mono text-[13px]`.

### 6.2 Prospects list (`/admin/prospects`)

- Intro: *Ready to send: the audit is done, the score is low enough, and there is a business email we may write to. Everything else is waiting for an audit, a call, or your decision.*
- Add by URL collapsed behind **Add a business by its website** (button → the form), placed after the view tabs; a **More** menu holds *Audit next 20* and *Fill in missing towns* (§3.8).
- Columns: **Prospect** (16 px name — link — + 13 px reference) · **Trade** · **Town** (`postcode town`, country name only when ≠ FR) · **Website score** (`42 · B` with a title *0–100, lower means more to fix; A good · B average · C weak*; *Not audited yet* in words) · **Website** · **Contact** (email 15 px, phone nowrap) · **Status** (badges as words, max 3 + "+n") · **Lead** · **Saved** (local date). Whole row clickable (`onClick` → push, plus the name link for keyboard/a11y). Mobile: card mode.
- Under the table a `<details>` **What the labels mean** listing every badge word with its sentence (from `wording.ts`).

### 6.3 Badge words (`ProspectBadges.tsx` + `wording.ts`; keys unchanged, labels replaced)

removed → *Not this business* · optout → *Opted out* · ceased → *Closed in the register* · partial → *Not listed publicly* · forbids → *Site forbids prospecting* · forbids-override → *Prospecting allowed (reason on file)* · not-fit → *Not a fit* · fit → *Good fit* · no-website → *No website* · call → *Call (no email)* · no-email → *No email found* · webmail → *Webmail address* · no-phone → *No phone* · gb-unknown → *Company or sole trader? unknown* · gb-sole → *UK sole trader* · chain → *Chain* · wiped → *Contact details wiped* · deadline → *Notice due in N days* · deadline-passed → *Notice overdue* · lead → *In conversation* · lead-open / lead-closed → *Lead: {stage in words}* (new · contacted · replied · meeting · proposal · won · lost · no response · stopped). Finder status words: *Saved*, *Not listed publicly*, *Closed in the register*, *Chain*, *Outside the area?*, *Hidden*.

### 6.4 Prospect page (`/admin/prospects/[id]`)

- Header: name (26 px) · *Restaurant · Foix (09000), France* · badges. Under it a **contact strip** (`data-testid="contact-strip"`): phone (tel), email (mailto), website (link), *Open in OpenStreetMap* / *Open in the register* — each a 15 px pill; then a 2-column block: `MiniMap` (single pin; caption *Coordinates from OpenStreetMap / the register / the area centre (approximate)*) beside the address and *Found by the search "Ariège · Restaurants" on 12 Sep — open* (link to `/admin/find?search=N`, via `searchSummary(id)`).
- `RegisterBlock` → title **Identity & register**: sentences as in §5.5 (4), `hideEmpty`; **Re-check the register** button kept (toast in words: *Register: active, publicly listed*); *Notice*: *Notice not sent — due 12 Oct 2026 (in 30 days)* / *Notice sent 12 Sep 2026* / *Contact details wiped 12 Oct 2026*.
- `WebsiteBlock` → **Website & contact**: editable website; *What the audit found* (email with kind in words: *generic address (contact@)* / *named person* / *sole trader's address* / *webmail* / *unknown kind*, page link; phone with *(from the site)* / *(from the source)*; socials; site builder); overrides with plain labels (*Email to use instead*, *Phone to use instead*); *Language of the report and emails*; *Fit* as three buttons (*Not decided / Good fit / Not a fit*) instead of a truncated select; *Not this business* confirm; *Allow prospecting despite the site's terms — reason*.
- Panels (`AuditBlock`, `DraftPanel`, `SendPanel`, `CallPanel`): logic untouched; wording via `wording.ts` — refusal codes rendered as sentences (`REFUSAL_TEXT`, one entry per `RefusalCode` — `country_blocked`, `no_email` → *No business email on file*, `email_webmail`, `email_sole_trader_consent`, `email_unknown_legal_form`, `optout_listed`, `emailed_recently`, `max_emails_reached` → *Daily email limit reached*, `audit_missing` → *The website has not been audited yet*, `audit_stale`, `daily_cap`, `forbids_extraction`, `register_inactive`, `register_partial`, `notice_deadline_passed` → *The 30-day notice window has passed*, `not_a_fit`, `draft_unreviewed` → *The email draft has not been reviewed*, `stage_closed`, `lead_in_conversation` → *Already in conversation*, `call_window_closed` → *Outside calling hours (weekdays 10–13, 14–20 local)*, `call_attempts_exceeded`, `call_screening_missing` → *UK number not screened against TPS yet*; test: every member of `RefusalCode` has a sentence, and the panels render `REFUSAL_TEXT[code] ?? refusal.message.en`, never the code); *SMTP off* → *Email sending is not configured on this server*; *FR rule* → *France (B2B email rules)*; *today 0/10* → *0 of 10 emails sent today*; *0/4 in 30 d* → *0 of 4 calls in the last 30 days*; section title *Why this cannot go out yet*; error toasts in sentences (`register_check_failed:*` → *The register could not be reached — nothing was sent. Try again later.*).
- Dates local (§6.1); empty key/values hidden; the *Google listing* block hidden entirely while Google is off.

### 6.5 Today (`today.ts` backend card set; `TodayCards.tsx` frontend)

`summariseToday(d)` returns `{ actions: TodayCard[], week: { newLeads: number; bySource: { label: string; n: number }[] }, housekeeping: { key; text; href?; tone }[] }` — still pure. **Exactly five action cards**, each an `<a>` link, 16 px sentence-case titles (not uppercase), 32 px numbers, one line of detail: **Calls to make** (`/admin/prospects?view=call`) · **Emails ready to send** (`n` · detail `0 of 10 sent today`, `/admin/prospects?view=ready`) · **Follow-ups** (`due · overdue`, `/admin/leads?…`, lines as today) · **Reports opened, no reply** (lines as today; `/admin/prospects`) · **Notices due within 5 days** (`/admin/prospects`). Above the cards two buttons: **Find businesses** (`/admin/find`) and **Next call** (`/admin/prospects/{id}` of the first prospect of the call view — `collectToday` adds `nextCall: { id, name } | null`; hidden when null). Under the cards one muted line *This week: 12 new leads (Diagnostic 7 · Contact 3 · Chat 2)* linking to `/admin/leads?stage=all&sort=created&dir=desc`. Below, one collapsed `<details>` **Housekeeping** (`data-testid="housekeeping"`): *Audits: 3 queued · 1 running · 0 failed this week* · *Bounces this week: 0* · *STOP replies — check the mailbox (12 emails in 30 days)* (only when `sends30d > 0`, link to Opt-outs) · *Purge last ran 2 days ago* (red only when stale) · *Google usage: 0 of 900 this month* (only when Google is on) · *Enquiries not yet in Leads: 4* + the backfill button (only when pending). `today.test.ts` asserts the five titles, their order, the week line and the housekeeping lines; `scripts/digitalm-digest.js` prints the same five cards, the week line and the housekeeping lines (keep the mirror in `/home/hermes/workspace/scripts/` identical).

---

## 7. Wording rules

Admin UI in English. Prospect-facing FR/EN strings untouched. Never in UI text, notes or error messages: *OSM*, *FR reg.*, *CH* (as an abbreviation), *partial*, *Nominatim*, *ISO2*, *tile*, *http_xxx*, *GOOGLE_PLACES*, env-variable names, refusal codes, snake_case tokens, *caveat*. Sources are always *OpenStreetMap*, *the French company register*, *Companies House*, *Google*. `wording.ts` exports every sentence (`FIND_TEXT`, `ERROR_TEXT`, `STATUS_WORDS`, `BADGE_TEXT`, `REFUSAL_TEXT`, `LEGAL_FORM_TEXT`, `ATTRIBUTION_TEXT`, `LEGEND_TEXT`) as plain data (no React, no `"use client"`); `wording.test.ts` walks every exported string and asserts the forbidden list, that every `RefusalCode`, badge key and finder status word has a sentence, and that no sentence ends with a code in parentheses. `notes.test.ts` does the same for the backend catalogue.

## 8. What stays exactly as is

Auth, CSRF, cookie, rate limits, `crm/http.ts` host allowlist and UA, cache TTLs (geocode 30 d, Overpass/register 24 h, search 24 h), Nominatim spacing (1.1 s) and Overpass spacing (1 s), register pacing (200 ms), the 19 categories + custom trade rules, `mergeBusinesses` rules and provenance, `markAlreadySaved`, save semantics (30-day notice for every prospect, audits enqueued for rows with a website, `422 partial_diffusion`, `410 search_expired`, `saved_count`), Add by URL, `POST /api/admin/prospects/[id]` keys and validation, `recheckRegister`/`wipePersonal`, ready/call/all/not_fit predicates and the 20-row ready limit, register field minimisation (directors/finances never leave the adapter), attribution text, legal strings, Leads pages, outreach/report/audit logic, digest and purge scripts' other sections, `next.config.mjs`, ports/units, the job runner (audits still run there; the search does not).

## 9. Tests

Backend `node:test` (pure modules, relative `.ts` imports, `import type`): `polygon.test.ts` (§2.4 points; hole; MultiPolygon; `circlePolygon` point count and radius), `areaQuery.test.ts` (relation / INSEE-set / around selectors, bbox clip, id and code guards, injection attempts throw), `plan.test.ts` (split rule at 5,000 and unknown, unit ordering from the centre, cap stop, level choice 6→4→8 with ≤ 200, tile fallback ordering), `geocode.test.ts` (`classifyHit` on the shapes fixture, `FR-09 → 09`, region ISO→INSEE table vs geo.gouv names, ambiguity rule, alternatives, circle fallback, postcode label), `notes.test.ts`, `townFill.test.ts`, `runner.test.ts` (reducer), `today.test.ts`, `communeLookup.test.ts` (4-dp cache key, ≤ 100 per save). Frontend: `mapCluster.test.ts` (grid buckets, threshold 200, counts, bucket bounds), `wording.test.ts`, `format.test.ts` (Europe/Paris dates incl. DST, relative times, km formatting 1 dp, `toLocaleString` thousands). E2E: `scripts/e2e/finder.cjs` (CommonJS, `require("playwright-core")` with `NODE_PATH=/home/hermes/.npm/_npx/fd3bca3c548369c0/node_modules`, chromium at `~/.cache/ms-playwright/chromium-*/chrome-linux/chrome`) run against staging: login `POST /api/admin/login` `{ password: process.env.ADMIN_PASSWORD, turnstile: "e2e", website: "" }` with `origin: https://d3v.digitalm.eu`, cookie `dm_admin`, CSRF header `x-dm-csrf` from `<meta name="dm-csrf">` for its own API calls, `waitUntil: "domcontentloaded"` (never `networkidle`), screenshots to the scratchpad `e2e-shots/`, one `step()` per acceptance item of §10 printing `OK`/`FAIL` and exiting 1 on any failure.

## 10. Acceptance (all runnable with curl/Node against staging + `scripts/e2e/finder.cjs`)

API (Node script with the staging cookie; `POST`s carry `origin` and `x-dm-csrf`):

- **A1 — Ariège by name.** `POST /api/admin/find {area:"ariege", category:"restaurant"}` returns `202` within 10 s with `area.kind="department"`, `area.countryCode="FR"`, `area.countryName="France"`, `area.admin.departement="09"`, `area.osmRelationId=7439`, `area.polygon.type ∈ {Polygon, MultiPolygon}`, `plan.expected` between 250 and 350 (292 on 12 Sep 2026), `plan.units=1`; no `hint` field sent.
- **A2 — No leak.** Polling `GET /api/admin/find?id=N` until `progress.status ∈ {done, partial}` (≤ 120 s) yields rows where 100 % have `inside ∈ {yes, approx}`, 0 rows with source coordinates fall outside the full-precision Ariège polygon (scratchpad `ariege-polygon.json`), 0 rows have `countryCode ≠ "FR"`, at least one row each with city `Foix` and `Pamiers`, and no row named *Moli dels Fanals*, *Cap del Port*, *Tredós* or *Restaurant Calmazeille*.
- **A3 — Register for a department typed by name.** The same search ends with `perSource.fr_register ≥ 300` (449 active on 12 Sep), ≥ 50 rows carry a 14-digit `registerId`, and `notes` has no `register_failed`.
- **A4 — Town.** `POST {area:"09000"}` and `{area:"Foix"}` resolve to kinds `postcode` / `town` with `admin.inseeCode="09122"`, a polygon, and finish with ≥ 25 OpenStreetMap rows and ≥ 40 register rows; every row has a non-empty `city`.
- **A5 — Region.** `POST {area:"Occitanie", category:"restaurant"}` returns `200 gate="over_cap"` with `plan.expected > 2000`, `plan.cap=2000` and `plan.units` listing 13 departments including *Ariège* and *Haute-Garonne*; re-posting with `confirmCap:true` returns `202` and the finished search has `progress.status="capped"`, `total ≤ 2000`, a note `capped` whose text contains `nearest the centre of Occitanie`, and `progress.registerScopes` covering only departments whose unit is `done`.
- **A6 — Country.** `POST {area:"France", category:"restaurant"}` returns the gate (`expected > 10000`); with `confirmCap` the search stops at ≤ 2,000 rows within 10 min, `progress.units.length ≤ 200`, units ordered by non-decreasing distance from `area.center`, the capped note lists the departments covered. `POST {area:"Andorra", category:"optician"}` resolves `kind="country"`, `countryCode="AD"`, finishes `done` with every row inside the Andorra polygon and a note `register_not_france` whose text contains `is not in France`.
- **A7 — Ambiguity, single run, cancel.** `POST {area:"Cambridge", category:"restaurant"}` returns `409 {error:"ambiguous", candidates:[…]}` with `kind` and `countryCode` per candidate and candidates from ≥ 2 countries; `POST` with `pick:{osmType:"relation", osmId:<chosen>}` returns `202`. A second `POST` while a search runs returns `409 {error:"search_running", searchId}`. `POST /api/admin/find/cancel` on a running search yields `status="cancelled"` within 5 s and `GET` keeps the rows found so far; `POST /continue` then returns `202` and the search finishes.
- **A8 — No jargon in payloads.** For every search above, no `notes[].text`, `message`, `progress.units[].error` or `alternatives[].label` contains `OSM`, `FR reg`, `http_`, `GOOGLE_PLACES`, `tile`, `Nominatim`, `ISO2` or `caveat` (case-insensitive); `npm test` includes `notes.test.ts` and `wording.test.ts` asserting the same lists.
- **A9 — Save from the card, dismiss.** `POST /api/admin/find/save {searchId, picks:[oneKey]}` returns `saved=1` with `prospectIds[0] > 0` and `references[0]` matching `PR-`; `GET /api/admin/prospects/{id}` shows `country="FR"`, `city` not null (the exact commune for a row that had `cityApprox`), `city_approx=0`, and `websiteSocials`/`source_socials` when the OpenStreetMap node had `contact:*` tags. `POST /api/admin/find/dismiss {searchId, key}` → `GET` shows that row `hidden:true`; `undo:true` reverses it; saving a hidden key returns `409 hidden`; saving a non-diffusible key still returns `422 partial_diffusion`.
- **A10 — Resumability.** After `systemctl --user restart digitalm-staging` during a running multi-unit search, `GET` returns `progress.status="interrupted"` within 2 min; `POST /api/admin/find/continue` resumes and finishes with the same `total` as an uninterrupted run of the same area/trade (units come from the 24 h cache; zero Overpass calls for the finished units — check `api_usage`).
- **A11 — Public-API manners** (staging log + `api_usage` review): during any search ≤ 1 Overpass request per second and ≤ 1 Nominatim request per 1.1 s, never a per-row Nominatim call; a repeat of a finished search within 24 h makes zero Overpass and zero Nominatim calls; the browser loads tiles only for the visible viewport and only after the map is shown.

Playwright (`scripts/e2e/finder.cjs`, desktop 1280×900 unless stated):

- **A12 — Map present.** `/admin/find?search=<Ariège id>` renders exactly one `.leaflet-container`, an SVG or canvas path for the outline, `window.__dmFindPins.total ≥ 250`, and the attribution control contains *OpenStreetMap contributors*.
- **A13 — Interaction.** Clicking the first `[data-testid=find-row]` opens `[role=dialog]` whose accessible name equals the row's business name and which contains a *Save & audit* or *Save* button, a *Not this one* button, the text *km from the centre of Ariège*, and a link to `openstreetmap.org`; Escape closes it and focus returns to the row; dispatching a click at `window.__dmFindProject(key)` for a visible pin opens the dialog for that business and its row is inside the list pane's bounding box.
- **A14 — Save from the card.** Clicking *Save & audit* shows a toast starting with *Saved*, the dialog then shows a link *Open prospect* to `/admin/prospects/<id>`, and the row's `[data-testid=row-status]` reads *Saved · PR-*.
- **A15 — Progress.** Starting a new search shows `[role=progressbar]` with `aria-valuemax ≥ 1` and text matching `/Searching OpenStreetMap|Checking the French company register/` before completion; `[data-testid=find-submit]` reads *Stop* while running; the final `[data-testid=find-status]` matches `/\d[\d,]* businesses in Ariège/`.
- **A16 — Readability.** On `/admin/find` results, `/admin/prospects` and `/admin/prospects/[id]`: the computed font-size of every `td`, row name, badge, hint and status text is ≥ 15 px (badges and table headers ≥ 13 px; `.eyebrow` excepted); every checkbox is ≥ 18×18 px; no text node with color `rgb(134, 143, 159)` is under 14 px; no element in `main` contains *OSM*, *FR reg.*, *partial*, *http_*, *GOOGLE_PLACES*, *no_email*, *audit_missing*, *call_window_closed*, *SMTP off*, *caveat*, or the string *—* as a standalone value.
- **A17 — Chips and filters.** Clicking *Has website* reduces the visible rows to those with a website link and reduces `__dmFindPins.total` accordingly; the *Hidden* chip shows dismissed rows with an *Undo* control; sort *Town A–Z* shows sticky group headers like *Foix (27)*.
- **A18 — Over-cap gate.** Typing *Occitanie* + Restaurant shows `[data-testid=cap-gate]` containing *One search holds 2,000*, 13 `[data-testid=cap-child]` buttons and one `[data-testid=cap-continue]` reading *Continue with the 2,000 nearest the centre*, and no `[role=progressbar]` until one is chosen; clicking the *Ariège* button starts a department search whose status line names Ariège.
- **A19 — Mobile 390×844.** No sideways scroll on `/admin/find` (idle and with results), `/admin/prospects`, `/admin/prospects/[id]`, `/admin` (`document.scrollingElement.scrollWidth === window.innerWidth`); the nav shows a *Menu* button that reveals Today, Leads, Find, Prospects and Opt-outs; the find page shows the map and `[data-testid=find-sheet]` with a *List* control; tapping a row opens the card as a full-height sheet with a *Close* button; with the sheet peeking, `document.scrollingElement.scrollHeight < 3 × innerHeight`.
- **A20 — Today.** `/admin` renders exactly five cards titled *Calls to make*, *Emails ready to send*, *Follow-ups*, *Reports opened, no reply*, *Notices due within 5 days*, each an `<a>`, plus buttons *Find businesses* and (when the call list is non-empty) *Next call*, and a `<details>` *Housekeeping* collapsed by default; no card title is uppercase or under 16 px.
- **A21 — Prospect page.** `/admin/prospects/[id]` for a Foix prospect shows the header *Restaurant · Foix (09000), France*, a contact strip with phone/website links, one `.leaflet-container` with one pin, a link *open* to `/admin/find?search=<id>`, a section *Identity & register* whose first sentence starts *Listed in the French company register* or *Not matched to a register entry yet*, no *—* values in key/value blocks, dates like *12 Sep 2026, 09:04*; the section *Why this cannot go out yet* lists sentences only (no snake_case tokens).
- **A22 — Build/test gates.** `npm test` green including the new tests; `NODE_OPTIONS=--max-old-space-size=1536 npx tsc --noEmit` clean; `npm run build` succeeds once on staging with no dynamic-usage warnings; `git log main..feat/finder-ux` shows only `finder-ux: …` commits, no `.env*` files, no pushes; `leaflet` (+ dev `@types/leaflet`) is the only dependency change in `package.json`.

## 11. Sequencing and effort

Day 0 (backend, 2 h): types + schema + `.env.example` appends, fixtures, `notes.ts` with text → committed on `feat/finder-ux` so the frontend starts. Backend then: geocode/polygon/kinds/alternatives + fine polygon (1 d) → plan/estimate/children + runner + routes incl. dismiss/cancel/continue/recent (1.25 d) → area queries, backoff, register scopes + point-in-polygon, country, town fill, socials, save-time commune lookup, backfill-towns (1 d) → Today card set + digest mirror + tests + docs §16 (0.5 d) = **3.75 d**. Frontend: workspace/search bar/candidates/alternatives/gate/progress against the fixture (1 d) → map + clustering + sync + debug hooks (1 d) → list + chips + sort + card + save/dismiss/undo (1 d) → mobile sheet + nav + primitives + prospects list + prospect page + Today + wording (1.25 d) = **4.25 d**. Integration on `feat/finder-ux`: staging build, e2e script, Ariège/Foix/Occitanie/France/Andorra/Cambridge runs, screenshots reviewed, fixes (**0.75 d**). Total **8.75 engineer-days**; as two people in parallel about 5 calendar days. Merge order: backend day-0 commit → frontend against the fixture → backend routes → integration → staging soak with Radu's searches → prod (separate approval, per CLAUDE.md — the prod restart needs Radu).

## 12. Risks

Overpass load and 429s on big areas (one request per unit, 1 req/s, 20/40/80 s backoff, 24 h unit cache, 200-unit ceiling, the gate before any big run); Nominatim polygons for countries are large (display threshold 0.01, 5,000-point cap, fine polygon never for regions/countries or the gate, 30 d cache); the display outline misplaces register rows within ~500 m of a region/country border (dropped and counted in note #8; department/town searches use the fine polygon; OpenStreetMap rows are exact by construction); a server restart mid-search leaves an `interrupted` search (continue is cheap thanks to the unit cache); a background promise in `next start` is not supervised — the 90 s staleness rule and the heartbeat make that visible instead of silent; Leaflet in the client bundle (+42 KB gz, admin only); `next/dynamic` with `ssr: false` must live in a client component; Tailwind `has-[]` needs a browser with `:has()` (Chrome 105+, Safari 15.4+, Firefox 121+ — Radu's).

## 13. Grafted from the list-first design — where each idea landed

1. Server-side dismiss (`/dismiss`, `searches.dismissed`, `hidden` on every read, *Hidden (n)* chip with Undo) — §3.7, §4, §5.4, §5.5, A9, A17.
2. `prospectIds` on the save response; card wording *Saved · PR-XXXXX · audit queued*; disabled-with-reason states — §4, §5.5, A9, A14.
3. Keyboard and a11y (↑/↓, Enter, Esc with focus return, `role=dialog` + `aria-labelledby`, `role=progressbar` with values) — §5.4–5.6, A13, A15.
4. No `leaflet.markercluster`: canvas `circleMarker` pins with the pin vocabulary, pure `mapCluster.ts` over 200 visible pins, `window.__dmFindPins` / `__dmFindProject` for e2e — §5.3, A12, A13, A17.
5. Adaptive polygon fetch: display outline at 0.005 / 0.01 with the 5,000-point cap; fine polygon only when a search runs and only for town/department/place, never for the gate — §2.4, §3.4.
6. Town-fill fallback: nearest commune centre within 6 km marked approximate (*near Foix*) when the department payload fails or exceeds the guard, then the Overpass admin_level-8 centres; exact commune on save through `geo.gouv /communes?lat&lon` (≤ 100 per save, 30 d cache) — §3.8.
7. Words tested on both sides: `notes.test.ts` and `wording.test.ts` with the forbidden list; every refusal code, badge key and status word has a sentence — §3.6, §7, §9, A8, A16.
8. `POST /api/admin/prospects/backfill-towns` behind **More** on the Prospects page — §3.8, §4, §6.2.
9. Today: **Next call** beside **Find businesses**; the collapsed details are **Housekeeping** — §6.5, A20.
10. Overpass estimate cached 24 h by (area selector, trade) → instant confirmation line, zero Overpass calls on a repeat — §2.5, A11.
11. The *Continue with the 2,000 nearest the centre* escape hatch is kept (the runner enforces the cap by not starting units, which is cheap) but the children chips are the primary path and the gate never fetches heavy polygons — §2.6, §5.6, A5, A6, A18.

Two small extras taken from the same review because they cost almost nothing: the non-blocking *Not this place?* alternatives line (§2.3, §5.6) and the *Most complete first* sort (§5.4). The default sort stays *Nearest the centre* so a capped search reads as what it is.

## 14. Changes from the v1 draft of 12 Sep

- Nominatim is called twice (search without polygons, then `lookup` with the polygon for the chosen hit) instead of `limit=5&polygon_geojson=1`, so ambiguity and the gate never download five polygons; `extratags=1` supplies `ref:INSEE` for French towns and the fuzzy `communes?nom=` path is gone.
- Two polygons (display + fine) per §2.4; `polygonApprox` flag; `countrySource` on rows; `readAt`; `rowsVersion` + `&v=` in the polling contract; `RegisterScope.found`; `time_limit`, `ch_needs_town`, `country_assumed` notes; `409 not_continuable`; `409 hidden` on save; `SearchSummaryV2`; `searchSummary(id)` export; `recent` returns ISO dates (client formats).
- Postcodes covering several communes become a MultiPolygon + an INSEE area set (`areaSelector.kind = "insee"` carries `codes[]`).
- `ResultRow` restates the merged fields instead of extending `MergedBusiness` (which lives in `dedupe.ts`, unreachable from `types.ts`).
- The e2e script is `scripts/e2e/finder.cjs` (CommonJS): `NODE_PATH` is ignored by ESM imports.
- The find page widens through `has-[.find-wide]` on `AdminShell`'s `<main>` rather than a layout change.
- Today keeps the weekly new-leads figure as one line under the five cards; `summariseToday` returns `{ actions, week, housekeeping }`.
- `Save ticked` posts in batches of 300 (the route's existing limit) rather than one 2,000-key request.

## 15. Decisions log (integrator only)

- 12 Sep 2026 — v2 published; branch `feat/finder-ux` created from `main` (`c7b84fe`).
- 12 Sep 2026 — QA round 1 fixes (commit "finder-ux: QA round 1 fixes"), where they differ from the sections above:
  - §2.6 gate: a **country is never counted** (no Overpass call before the owner decides) and a **region gets a 15 s count**; the gate's chips are the real administrative children **by name, A–Z** — geo.gouv departments for a French region, geo.gouv regions for France (`query` = the department code / "Occitanie, France" is what a chip posts), one Overpass children query for a region or country elsewhere — never tiles. A department or town over the cap gets no chips: the panel says to type a smaller area. *Continue with the N nearest the centre* and *Change area* sit at the top of the panel. Children for the split itself are fetched only after `confirmCap`.
  - §3.3 Overpass: two servers (`OVERPASS_URL`, `OVERPASS_FALLBACK_URL`), per-server busy marks (Retry-After honoured), an immediate retry on the free server, then waits of 15 s and 30 s (two cycles, not 20/40/80 s) before a unit fails. `mapElement` keeps `cuisine`, `opening_hours` and `description` in `tags` for the card.
  - §3.2 progress: the runner emits `stage: "merge"` before merging (UI: *Placing on the map and removing duplicates…*), a `duplicates_removed` note (folded into the finished line), and `estimate_unknown` only for multi-unit runs.
  - §2.4 outlines: display threshold 0.0005 for towns (same cached lookup as the fine polygon) and 0.001 for places.
  - §5.4 list: default sort *Most complete first*; every sort sinks rows that cannot be saved (not listed publicly, closed, hidden) to the bottom; chips *Can be saved (n)* and *Not listed publicly (n)* — the latter, like *Hidden*, off by default and revealing those rows when on; the header reads *n can be saved · from OpenStreetMap … · from the register …*; one scrolling row of chips in narrow panes.
  - §5.6 progress bar: `progressModel.ts` reserves shares for the map, register and placing stages, never reads 100 % while running, shows *searching for 12 s* and a soft ETA for single-area searches; the estimate line disappears once finished; cached results say *results read 12 min ago (kept 24 hours)*; the country is left out of *Andorra — country*.
  - §5.5 card: an *About the business* section (cuisine, opening hours in words, description), a *Search Google for "name town"* link, no raw coordinates, the not-listed sentence once (footer), a fade at the bottom of the scrolling body.
  - §5.3 legend: the panel opens under the *?* button (which never moves); on the phone it is a bottom sheet with a Close button.
  - §5.1 phone: the peeking sheet (68 px) shows only the title and the List / Map control.
  - §6: *Saved* is under the reference in the Prospects table (no clipped column); badges and table headers 14 px, `.eyebrow` 13 px, chips 15 px.
  - §6.5: `toTodaySummary()` lives in `todaySummary.ts` (plain module) — the server page never imports the `"use client"` TodayCards helpers; `scripts/e2e/finder.cjs` A0 asserts `/admin` answers 200 with five cards and A19 checks every page against the device width (390 px), including `/admin/prospects/6`.
- 12 Sep 2026 — QA round 2 fixes (commit "finder-ux: QA round 2 fixes"), where they differ from the sections above:
  - §3.4 register (block): `statut_diffusion` is a **letter** in the live API — `O` public, `P` (and `N`) hidden; `diffusionOf(company, establishment)` in `frRegisterMap.ts` maps it (legacy words still accepted, anything unknown = hidden, `statut_diffusion_etablissement` counted when present). Every register row had read as *Not listed publicly* and could not be saved. `SearchResultV2.rulesVersion` (now 2) says which rules built a cached result; `searchRules.ts` / `searchRepair.ts` re-derive an older cached result from the register pages still in `api_cache` and write it back on the first read (GET and the save route), so nothing waits for the 24 h expiry.
  - §4 API: `POST /api/admin/find` accepts `fresh?: boolean` — every unit and register page is read anew (the 24 h cache is skipped, then refilled). The page posts it from **Run again** next to *Results from 1 h ago*.
  - §5.6 states: once finished, one line (`data-testid="find-status"`): *Ariège — department, France · 572 restaurants · Results from 1 h ago · Run again* (the freshness sentence and the link only once the results are a minute old; the date is the map read time when the cache answered, else the run). The *map read … (kept 24 hours)* and duration parts are gone; `duplicates_removed` is a Details note. The onboarding lines under the Area box and the form (*Any place OpenStreetMap knows…*, *Public sources only…*) show only until a search exists.
  - §5.4 list: header *572 restaurants in Ariège* · *209 can be saved · 269 from OpenStreetMap, 357 from the French company register (54 in both)* — the sources split is shown here only. Chips **wrap** (never a sideways scroll): *Can be saved · Has website · No website* + **More filters (6)** revealing *Has phone · Has email · In the register · Saved · Not listed publicly · Hidden* (an active chip is never folded away). The website in a row is plain text (`data-testid="row-site"`); the link lives in the card, so the whole row opens the card (e2e A13b clicks the row's centre).
  - §2.3 candidates: same-name candidates say what differs — French communes carry the postcode and population (*Foix — town, 09000 (9,472 people), France*), a French arrondissement reads *Foix — arrondissement (Foix and the communes around it), France*; the county is added only when it differs between same-name candidates; an alternative whose boundary coincides with the choice's (`sameOutline`) is dropped.

## Appendix — fixtures and their derivation

- `src/lib/discover/fixtures/ariege.fine.polygon.json`: the `geojson` member of the first hit in the scratchpad `ariege-polygon.json` (Nominatim search, relation 7439, 11,964 points, 12 Sep 2026).
- `src/lib/discover/fixtures/ariege.polygon.json`: the same relation from `lookup?osm_ids=R7439&polygon_geojson=1&polygon_threshold=0.005` (205 points).
- `src/lib/discover/fixtures/nominatim-shapes.json`: the address/extratags blocks (no polygons) of the search hits for *ariege*, *Occitanie*, *France*, *Andorra*, *Foix*, *Cambridge* (UK and US), one hamlet node, *Pyrénées* — captured once, checked into the repo, licence line kept.
- `src/lib/discover/fixtures/search-ariege.sample.json`: `{ running: SearchResultV2, done: SearchResultV2 }` hand-assembled from a real Ariège/restaurant run on 12 Sep (rows trimmed to 40, names and phones as published on OpenStreetMap).
