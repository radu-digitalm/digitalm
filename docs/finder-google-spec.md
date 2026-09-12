# Finder — Google Places, Google map and the Google-listing check (implementation contract v1, 12 Sep 2026)

Scope: Google as an additional source for `/admin/find` (place suggestions in the Area box, a Google map, Google places matched into the results), and a real Google-listing check in the audit and score. Repo `/home/hermes/workspace/digitalm`, branch `feat/finder-google` off `main` (sub-branches `feat/finder-google-backend`, `feat/finder-google-frontend`; every commit `finder-google: …`; never push; never commit `.env*`). This document wins over `docs/finder-ux-spec.md` and `docs/leadgen-build-spec.md` §6–§7 where they differ; everything not mentioned here is unchanged, and **with `GOOGLE_PLACES=off` (today's value) nothing changes at all** — the Leaflet/OpenStreetMap finder, the plain Area box, the hidden Google block and the unmeasured `google_listing` check stay exactly as they are.

Radu's request: *"why don't we just use Google Maps, also with place suggestions in the search? also check if they have Google My Business"*. Decision: yes — behind `GOOGLE_PLACES=on`, within the free monthly allowances, and inside Google's terms **as they apply to us**.

---

## 0. Read this first — the terms that govern, and where this contract departs from the brief

Digital M bills Google Cloud from France, so the **EEA Service Specific Terms** apply (last modified 10 Jun 2026, section B.15 "Places API (Legacy and New)"), not the non-EEA terms the brief was written against. Verified on 12 Sep 2026 (sources in the research memo behind this document). What they change:

| Brief said | The EEA terms say | This contract does |
|---|---|---|
| Places results may only be shown on a Google map, so switch the map to Google Maps | B.15.1 *No Use With any Map*: other than latitude, longitude and place_id, Places content may not be displayed on, next to or visually associated with **any** map, Google's included. B.15.3: this does not apply to the **Places UI Kit**. | A Google map is offered because Radu wants one (§5.2), not because it buys rights. Every Google name, address, rating, hour or photo shown near the map is rendered by a Places UI Kit element (Google renders it, with its own attribution). Our own code shows only pins (lat/lng + place_id) and our derived words. |
| Store every Google field with `fetched_at`, refresh/drop after 30 days | B.15.4 + A.3: `place_id` may be kept indefinitely; latitude/longitude for **30 consecutive days**; nothing else. Policy: "must not pre-fetch, cache, or store Places API content beyond the allowed exceptions". ToS 3.3.2(a)(iii): no copying and saving of business names, addresses or reviews. | Only `place_id`, lat/lng (inside the 24 h search cache) and **derived** booleans/counts from the audit (§3, decision D2) are ever written. No Google response is cached. Names/addresses from Google are used transiently for matching and then dropped. |
| Polygon-filter Google results | ToS 3.3.2(c)(iv): no point-in-polygon analysis on Places lat/lng. | Tiles are clipped by **our** polygon before the request; results are filtered by `addressComponents` (department / postcode / locality / country) — §4.4. |
| Merge Google rows (source `google`) into the list with their names | 3.3.2(a)(iii) again, plus 15.1 (list beside the map). | Google places that match an OpenStreetMap or register row enrich that row (`googlePlaceId`, *Also on Google*). Places found only on Google become **pins without a name**; opening one shows Google's own compact listing panel (UI Kit) and the way to save it is *Add by its website* (§5.5). |
| Autocomplete (New) proxied from the server with session tokens | Permitted use (1) covers autocompletion; predictions listed above the map are still content *next to a map* unless they come from the UI Kit autocomplete element (exempt). | The Area box uses the UI Kit `gmp-basic-place-autocomplete` element when Google is on (§5.3); the chosen place feeds Nominatim by name. The proxied design is kept in Appendix B as the fallback if the element proves unusable. |
| "Check if they have Google My Business" | The Place resource has no claimed/verified/owner field; the Business Profile API forbids lead-generation use. | The check says *listing found* and whether it *looks maintained* (business status, website on the listing, hours, review count, photo count). The words "claimed", "verified" and "Google My Business" never appear (§4.6). |

Decisions this contract needs from Radu (defaults apply until he answers; each is one env value or one line to flip, nothing else moves):

- **D1 — Google as a discovery source.** The EEA "Permitted Uses" list covers autocompletion (1) and *visualising and managing Places content related to a sales team's customers or opportunities* (3). A saved prospect is an opportunity; open-ended "every restaurant in Ariège" discovery is not obviously any of the nine uses. Default: **`GOOGLE_PLACES_DISCOVERY=off`** — map, suggestions and the listing check work; searches do not call Google. Radu turns it on if he is comfortable with the reading.
- **D2 — Derived audit signals.** Storing `{ operational, websiteOnListing, hours, reviews: 12, photos: 3 }` in the audit record is our measurement, not Google's content, but Google does not say so anywhere. Default: **stored**, never any string from Google.
- **D3 — The listing's website.** Copying `websiteUri` into `prospects.website` would give many no-website prospects an auditable site — and is copying content. Default: **not copied**; the Google panel on the prospect page shows it live and Radu can paste it into the editable website field himself.
- **D4 — Google map or Leaflet.** The Google map costs one Dynamic Maps load per finder page open (10,000 free/month) and grants no display rights. Default: **Google map when `NEXT_PUBLIC_GOOGLE_MAPS_KEY` and `NEXT_PUBLIC_GOOGLE_MAP_ID` are set**, Leaflet otherwise and on any load failure.
- **D5 — Autocomplete.** Default: UI Kit element (§5.3). Fallback: Appendix B.

Free-tier discipline, in one table (every call names its SKU in code — `google.ts` refuses a request whose field mask crosses the tier the call was budgeted for; §4.2):

| Call | Where | SKU | Free/month | Our cap (`api_usage` provider) |
|---|---|---|---|---|
| Text Search (bbox tile + trade) | discovery (D1), save-time match | Text Search **Pro** | 5,000 | `google_search` ≤ `GOOGLE_SEARCH_MONTHLY_CAP` (4,500) |
| Nearby Search (circle areas) | discovery (D1) | Nearby Search **Pro** | 5,000 | `google_search` (same pool) |
| Place Details, Enterprise mask | listing check of a saved prospect | Place Details **Enterprise** | 1,000 | `google_details_enterprise` ≤ `GOOGLE_PLACES_MONTHLY_CAP` (900) |
| Place Details, Essentials mask | closing an area suggestion (location + address components) | Place Details **Essentials** | 10,000 | `google_details_other` ≤ `GOOGLE_DETAILS_MONTHLY_CAP` (4,500) |
| Place Details, Pro mask | manual match candidates (name) | Place Details **Pro** | 5,000 | `google_details_other` (same pool) |
| Maps JavaScript map | finder page (browser) | Dynamic Maps | 10,000 | not countable server-side; Cloud Console budget alert (§7) |
| UI Kit compact details / autocomplete | card, prospect page, Area box (browser) | Places UI Kit Query / Autocomplete Per Session | 10,000 each | idem |
| Place Photos media | — | — | — | **never called**: the UI Kit renders photos; the audit counts `photos[].length` (free in Details) |

---

## 1. What Radu sees (Google on)

1. He types **"arie"** in the Area box: Google's suggestion list opens under it (*Ariège, France* · *Ariège, river*…), keyboard-navigable. He picks *Ariège, France*; the finder resolves it through Nominatim as today — no chooser, because the pick's coordinates settle the ambiguity — and the status line reads *Ariège — department, France · about 292 restaurants on the map*.
2. The map is **Google Maps**: the dashed orange Ariège outline, the OpenStreetMap/register pins in the same colours as today, numbered discs where pins crowd, the progress bar on top. Hover, click, *List follows the map*, chips: identical.
3. With discovery on (D1): after the register phase the progress line says *Asking Google — 6 of 9 tiles*; **blue pins** appear for places Google knows that neither OpenStreetMap nor the register listed (*23 only on Google* in the list header, a chip to hide them). Rows that Google also knows get *Also on Google · View on Google Maps* in their card. Clicking a blue pin opens a card whose body is Google's own compact listing panel (name, address, rating, hours, a photo, Google's attribution) with **Add by its website** and **Not this one**.
4. **Save & audit** on a matched row saves the place id with the prospect. The audit's *Google listing* check now scores: *Listing found · looks maintained* (10/10), *looks unmaintained* (partial), *No listing found* (0/10, flag *no Google listing found*). Prospects saved without a match are matched automatically during their audit (name + distance); the old *Find on Google* button becomes *Check again* / *Match manually*.
5. The prospect page's **Google listing** section (below the fold, collapsed) shows the status in words, when it was checked, the signals in words (*website on the listing · opening hours filled in · 37 reviews · 3 photos*), **View on Google Maps**, and *Show the Google listing* → Google's compact panel; while it is open the mini map is hidden.
6. When the allowance is used up, or Google does not answer, one sentence says so (*The monthly Google allowance is used up — try again next month.*); nothing else breaks. With `GOOGLE_PLACES=off`, none of the above exists.

---

## 2. Ownership (two engineers in parallel, one integrator)

### 2.1 Backend — exclusive

- `src/lib/discover/**`: **new** `googleRequests.ts` (pure: field masks, request bodies, response parsers, `signalsOf`, `placeIdOk`), `googleTiles.ts` (pure), `googleInside.ts` (pure), `googleMatch.ts` (pure), `googleDiscover.ts` (the search phase), `googleSuggest.ts` (pick resolution), `googleCheck.ts` (save-time match + listing check), rewritten `google.ts` (the I/O client: caps, counters, errors); tests `googleRequests.test.ts`, `googleTiles.test.ts`, `googleInside.test.ts`, `googleMatch.test.ts`, `googleCheck.test.ts`; fixtures `src/lib/discover/fixtures/google/*.json` (synthetic, §8.1); edits in `runner.ts`, `progress.ts`, `notes.ts` (+ tests), `dedupe.ts` (`googlePlaceId` propagation), `geocode.ts` (`resolveArea` hint), `index.ts` (exports).
- `src/lib/audit/{checks.ts, score.ts, job.ts}` (+ tests), `src/lib/report/findings.ts` (+ test), `src/content/auditChecks.ts` (the FR/EN copy of the check).
- `src/lib/prospects/store.ts` (+ `googleSignals`), `src/lib/inbox/today.ts` (+ test), `src/lib/crm/http.ts` (one `HOSTS` line), `src/lib/crm/apiUsage.ts` (unchanged API; new provider names only).
- Routes: `src/app/api/admin/find/route.ts` (`suggestion`), `find/dismiss/route.ts` (`google:` keys), `prospects/[id]/google/route.ts` (rewritten), `prospects/route.ts` (`googlePlaceId` on Add by URL), `prospects/[id]/route.ts` (GET fields).
- `scripts/digitalm-purge.js` + its mirror in `/home/hermes/workspace/scripts/` (step 12), `scripts/digitalm-digest.js` + mirror (housekeeping line).

### 2.2 Frontend — exclusive

- `src/components/admin/**`: **new** `googleMaps.ts` (loader singleton + `googleMapsPlaceUrl`, tested in `format.test.ts`), `GoogleFindMap.tsx`, `GoogleAreaInput.tsx`, `GoogleListingPanel.tsx` (the UI Kit compact element wrapper), `GoogleOnlyCard.tsx`, `GoogleAttribution.tsx`; rewritten `GoogleBlock.tsx`; edits in `FindWorkspace.tsx`, `FindList.tsx` (chip, header count), `Legend.tsx`, `BusinessCard.tsx` (Google section), `AreaInput.tsx` (delegation), `AddByUrl.tsx` (`placeId` prefill), `AuditBlock.tsx` (detail words), `TodayCards.tsx`/`todaySummary.ts` (housekeeping line), `finderApi.ts` (shapes), `wording.ts` + `wording.test.ts` (`GOOGLE_TEXT`), `src/app/globals.css` (inside the existing `/* @@admin */` block: `.dm-gpin*`, `.dm-gcluster`, `.dm-google-attr`).
- Pages `src/app/(tools)/admin/(gated)/{find/page.tsx, prospects/[id]/page.tsx}` (props only).
- `next.config.mjs` — the `/admin/:path*` CSP entry of §5.1 and nothing else.
- `package.json` + lock — adds `@googlemaps/markerclusterer@2.6.2` and dev `@types/google.maps@^3.66`; nothing else.
- `scripts/e2e/finder.cjs` — items G-e2e of §9 appended.

### 2.3 Shared, append-only under markers

| File | Marker | Inserted by | Appended by |
|---|---|---|---|
| `src/lib/crm/types.ts` (end of file) | `// @@finder-google:types` | backend, day 0 | backend only (§4.1); frontend imports through `finderApi.ts` |
| `src/lib/crm/schema.ts` `EXTRA_COLUMNS` | existing `// @@crm:finder` | — | backend (§4.1) |
| `.env.example` | existing `# @@crm:finder` | — | backend rewrites the four `GOOGLE_*` lines into the §6 block |
| `README.md` "Admin CRM" (after the finder-ux markers) | `<!-- @@finder-google:backend -->` then `<!-- @@finder-google:frontend -->` | backend, day 0 | each engineer under their own marker |
| `docs/leadgen-build-spec.md` (end of file) | `## 17. finder-google` | backend | backend only — a pointer to this document plus the §4.8 API additions |

### 2.4 Rules

- No other shared edits. `src/lib/crm/{apiCache,auth,db,time,classify,jobs,jobHandlers}.ts`, `src/instrumentation.ts`, `src/middleware.ts` untouched; no new job kind (the listing check runs inside the audit job). One `next build` at a time on the box — only the integrator builds staging; engineers run `NODE_OPTIONS=--max-old-space-size=1536 npx tsc --noEmit` and `npm test`. Never touch `digitalm-prod/`.
- Day 0 (backend, first two hours): §4.1 types + schema + `.env.example` block, `notes.ts` codes with text, the synthetic fixtures (§8.1) and `googleRequests.ts` masks committed on `feat/finder-google` — the frontend builds against `search-ariege.sample.json` extended with `googlePins` and `progress.google`.
- No keys exist yet: every Google call is a no-op with a note when `GOOGLE_PLACES!=on` or a key is missing; unit tests use fixtures; the live checklist (§8.3) runs once Radu's billing is on.
- The integrator resolves contract questions by appending to Appendix C.

---

## 3. Google's terms as code rules (each has a test or a live-checklist item)

1. **Persisted Google data = `place_id`, lat/lng (≤ 30 days), derived booleans/counts.** `googleRequests.test.ts` asserts `signalsOf()` returns only booleans, numbers and `fetchedAt`; `googleDiscover` returns `GooglePin { placeId, lat, lng, fetchedAt }` and row patches `{ googlePlaceId, onGoogle }` only; a static test reads `google.ts`/`googleDiscover.ts`/`googleCheck.ts` and asserts they import nothing from `apiCache` and never call `console.log/error` with a response body. Live: `SELECT COUNT(*) FROM api_cache WHERE provider LIKE 'google%' OR payload LIKE '%displayName%' OR payload LIKE '%formattedAddress%'` = 0 after a search and an audit.
2. **No Google response cached, no bulk pre-fetch.** The client never uses `cached()`; discovery runs only inside a search Radu started, never for the over-cap gate, never for `plan` children, never for units that did not run; `continue` re-asks Google (counted).
3. **No point-in-polygon on Google coordinates.** `googleInside()` reads `addressComponents` only; `polygon.ts` functions are called on **our** tiles' corners, never on a place's `location` (`googleTiles.test.ts` + a grep-style test that `googleDiscover.ts` and `googleInside.ts` do not import `pointInPolygon`).
4. **No Google content beside a map except through the Places UI Kit.** Google-only pins carry no name (`title` empty, tooltip *On Google only*); the card body for them and the *Show the Google listing* panels are `<gmp-place-details-compact>`; the prospect page hides `MiniMap` while its Google section is open; manual-match candidates (§4.6) render only inside that open section. e2e G8.
5. **Attribution.** Wherever our UI shows something derived from Places (the *Also on Google* line, the status and signals on the prospect page, the *only on Google* count) the `GoogleAttribution` component renders the Google Maps logo (`public/brand/google-maps-logo.svg`, the official asset Radu downloads from Google's attribution page; until it exists, the text **Google Maps** with `translate="no"`, one line, never localised). UI Kit panels carry Google's own attribution. `attributions[]` returned by Details are shown in the signals block when present (they are third-party data-provider names, required to be shown; never stored — displayed only from the live `check` response).
6. **Field masks by tier.** `MASK_SEARCH_PRO`, `MASK_DETAILS_ENTERPRISE`, `MASK_DETAILS_PRO`, `MASK_DETAILS_ESSENTIALS` are frozen constants; `googleRequests.test.ts` holds the tier table of Appendix A and fails if any mask contains a field of a higher tier than its name. `google.ts` refuses (throws `GoogleError("mask_tier")`) a request whose mask is not one of the four constants.
7. **Keys.** The server key is read in `google.ts` only, sent as a header, never logged, never in a URL; the browser key is `NEXT_PUBLIC_` and restricted (§7). A test asserts no file under `src/components` references `GOOGLE_PLACES_KEY`.
8. **Words.** "claimed", "verified", "Google My Business", "GMB" never appear (added to `FORBIDDEN_TOKENS` in `wording.ts` and to `notes.test.ts`); "Google Business Profile" only in the prospect-facing check copy where it already is.

---

## 4. Backend

### 4.1 Types, schema, switches

Appended to `src/lib/crm/types.ts` under `// @@finder-google:types` (the `googleAdapter` stub above it stays; its `search()` is no longer called — the runner calls `googleDiscover` directly, and `enabled()` remains the single on/off truth):

```ts
// @@finder-google:types — docs/finder-google-spec.md §4.1. Backend appends here; frontend imports only.
export type GoogleMatch = "auto" | "manual";
/** Derived from one Place Details answer; never a string from Google. */
export interface GoogleSignals { operational: boolean | null; websiteOnListing: boolean; hours: boolean; reviews: number; photos: number; fetchedAt: string }
/** A place Google knows that no other source listed — lat/lng may live at most 30 days (the search cache keeps them 24 h). */
export interface GooglePin { placeId: string; lat: number; lng: number; fetchedAt: string; hidden?: boolean }
export interface GoogleProgress { state: UnitState; tiles: number; tilesDone: number; requests: number; found: number; matched: number; only: number; dropped: number; error?: "busy" | "timeout" | "network" | "refused" | "allowance" }
export interface GoogleUsage { checks: { used: number; cap: number }; searches: { used: number; cap: number }; other: { used: number; cap: number } }
export type GoogleCandidate = { placeId: string; name: string; addressLine: string; distanceM: number | null }; // transient (§4.6), never stored
```

Optional fields added in place (same file, same block rule — the backend edits its own earlier blocks): `Business.googlePlaceId?: string`; `ResultRow.onGoogle?: boolean`; `SearchProgress.google?: GoogleProgress`; `SearchResultV2.googlePins?: GooglePin[]`; `Prospect.googleCheckedAt: string | null`, `Prospect.googleMatch: GoogleMatch | null`, `Prospect.googleSignals: GoogleSignals | null` (read from the latest audit, not a column).

Schema — `EXTRA_COLUMNS` under `// @@crm:finder`: `["prospects","google_checked_at","TEXT"]` (last match/check attempt), `["prospects","google_match","TEXT"]` (`auto|manual|NULL`). Existing columns `google_place_id`, `google_listing`, `google_confirmed_at` keep their meaning (`confirmed_at` = when the state was set).

Switches (`google.ts`): `googlePlacesOn()` = `GOOGLE_PLACES === "on" && !!GOOGLE_PLACES_KEY` (unchanged); `googleDiscoveryOn()` = `googlePlacesOn() && GOOGLE_PLACES_DISCOVERY === "on"`; `googleMapConfigured()` = `googlePlacesOn() && !!NEXT_PUBLIC_GOOGLE_MAPS_KEY && !!NEXT_PUBLIC_GOOGLE_MAP_ID` (server-side read of the public vars, passed to pages as props). `GOOGLE_PLACES=on` without a key → note #17 on the find page and the Today housekeeping line *Google is switched on, but its key is missing.*

### 4.2 The client (`google.ts`, I/O) and the pure request module (`googleRequests.ts`)

`googleRequests.ts` (pure, tested, no imports beyond types and `classify.ts`):

- Masks (Appendix A tiers): `MASK_SEARCH_PRO = "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location,places.types,places.primaryType,places.businessStatus,places.pureServiceAreaBusiness,places.attributions,nextPageToken"` (note: no `places.photos` — Pro in search, unneeded); `MASK_DETAILS_ENTERPRISE = "id,businessStatus,websiteUri,nationalPhoneNumber,regularOpeningHours,rating,userRatingCount,photos,pureServiceAreaBusiness,attributions"`; `MASK_DETAILS_PRO = "id,displayName,formattedAddress,location,businessStatus,attributions"`; `MASK_DETAILS_ESSENTIALS = "id,formattedAddress,addressComponents,location,viewport,types"`.
- Builders: `textSearchBody({ textQuery, includedType, rect, languageCode, regionCode, pageToken? })` → `{ textQuery, includedType?, strictTypeFiltering: !!includedType, languageCode, regionCode, pageSize: 20, locationRestriction: { rectangle: { low: {latitude: s, longitude: w}, high: {latitude: n, longitude: e} } }, pageToken? }`; `nearbySearchBody({ includedTypes, center, radiusM })` (radius clamped to 50,000); `matchSearchBody({ name, city, lat?, lng?, countryCode })` → `textQuery: "<name> <city>"`, `locationBias: { circle: { center, radius: 2000 } }` when coordinates exist else `regionCode` only, `pageSize: 5`. Trade table `GOOGLE_TYPES: Record<categoryKey, { includedType: string | null; query: { fr: string; en: string } }>`: restaurant→`restaurant`, bar→`bar`, hotel→`hotel`, gite→`bed_and_breakfast`, campsite→`campground`, bakery→`bakery`, butcher→`butcher_shop`, hairdresser→`hair_salon`, beauty→`beauty_salon`, garage→`car_repair`, plumber→`plumber`, electrician→`electrician`, joiner→**null** (text "menuisier" / "joiner"), painter→`painter`, roofer→`roofing_contractor`, estate_agent→`real_estate_agency`, optician→**null** (text "opticien" / "optician"), dentist→`dentist`, gym→`gym`; custom trades → null + the custom label. `textQuery` language follows the area's country (`fr` for FR/BE/CH/LU/MC/AD, else `en`); `regionCode` = area country code lower-case.
- Parsers (return **our** shapes, drop everything else): `parseSearch(json) → { places: GooglePlace[]; nextPageToken: string | null }` with `GooglePlace = { placeId, name, lat, lng, postcode: string | null, country: string | null, adminLevel1: string | null, adminLevel2: string | null, locality: string | null, postalTown: string | null, operational: boolean | null, serviceArea: boolean }` (names normalised at parse time: `name` kept only for the matching step, address strings never leave the module); `parseDetailsEnterprise(json) → GoogleSignals` via `signalsOf`: `operational = businessStatus === "OPERATIONAL" ? true : businessStatus ? false : null`, `websiteOnListing = !!websiteUri`, `hours = !!regularOpeningHours?.periods?.length`, `reviews = userRatingCount ?? 0`, `photos = photos?.length ?? 0`, `fetchedAt = now`; `parseDetailsEssentials(json) → { placeId, lat, lng, countryCode, adminLevel1, adminLevel2, locality, postalCode, kindHint: AreaKind | null, query: string }` where `kindHint` comes from `types` (`country`→country, `administrative_area_level_1`→region, `administrative_area_level_2`→department, `locality|postal_town|sublocality`→town, `postal_code`→postcode, else place) and `query` = the component matching the primary type + ", " + country long text (fallback `formattedAddress`); `parseDetailsPro(json) → GoogleCandidate` (name, first line of `formattedAddress`); `parseError(status, json) → GoogleErrorCode`. `placeIdOk(id)` = `/^[A-Za-z0-9_-]{10,300}$/`.

`google.ts` (I/O; thin, covered by the live checklist): `googleFetch<T>(kind: "search" | "details_enterprise" | "details_pro" | "details_essentials", path, { method, body?, mask, signal })`:

1. Off → throws `GoogleError("off")`; key missing → `GoogleError("no_key")`.
2. Cap for the kind's pool (`google_search` / `google_details_enterprise` / `google_details_other`) reached → `GoogleError("allowance", pool)` **before** any socket.
3. `spaced("google", 100)` → `fetchJson(HOSTS.googlePlaces + path, { method, headers: { "content-type": "application/json", "x-goog-api-key": key, "x-goog-fieldmask": mask }, body, timeoutMs: 15_000, signal })` — `HOSTS.googlePlaces = "https://places.googleapis.com"` is the one line added to `crm/http.ts`.
4. Success → `countApiUsage(pool)` (+ `google_places` kept as the grand total for the legacy Today card until §4.7 lands) → parse. `HttpError` → `GoogleError`: 403 → `refused` (key restriction / API not enabled; logged as `google: refused (403)` and nothing else), 429 → `busy` (Retry-After honoured once, ≤ 30 s, then `busy`), 400 → `bad_request`, timeout/network → `timeout`/`network`, other 5xx → `unavailable`. Response bodies and the key are never logged.

`googleUsage(): GoogleUsage` reads the three pools against `GOOGLE_PLACES_MONTHLY_CAP` (900), `GOOGLE_SEARCH_MONTHLY_CAP` (4,500), `GOOGLE_DETAILS_MONTHLY_CAP` (4,500) through `intEnv`.

### 4.3 Discovery phase (`googleDiscover.ts`, runner integration) — only with D1 on

Runner (`runner.ts`): a new phase after the register phase and before `merge`, when `sources.includes("google")`:
- `!googlePlacesOn()` → note #10 `google_off` (as today); on but `!googleDiscoveryOn()` → note #18 `google_discovery_off`; both cases: no request, `progress.google` absent.
- Otherwise `emit({ type: "stage", stage: "google" })` (`SearchProgress.stage` gains `"google"`; the UI says *Asking Google — 6 of 9 tiles*), then `googleDiscover({ area, category, expected: plan.expected, osmRows, registerRows, unitsRan, signal, budget: GOOGLE_SEARCH_MAX_REQUESTS })` returns `{ patches: Map<key, { googlePlaceId }>; pins: GooglePin[]; progress: GoogleProgress; notes: SearchNote[] }`. Patches are applied to the identity rows before `mergeBusinesses`; `dedupe.ts mergeCluster` copies `googlePlaceId` from any member (first by `IDENTITY_RANK`) and sets `onGoogle` in `mergedToRow`. Pins go to `result.googlePins` (hidden keys `google:<placeId>` from `searches.dismissed` mark `hidden: true` on read, like rows). A failed phase (`busy` three times, `refused`, `allowance`) ends with `progress.google.state = "failed"` + note #19/#20/#21; the search status is **not** `partial` because of Google alone (the OpenStreetMap/register result stands) — `continue` re-runs a failed Google phase only.
- Continue/re-run: Google is asked again (no cache); a `capped` search asks Google only for the tiles intersecting the units that ran.

Tiles (`googleTiles.ts`, pure, tested): `initialTiles(area, expected)`: `n = clamp(ceil(((expected ?? 60) × 1.3) / 50), 1, 16)` cells on a `ceil(√n) × ceil(√n)` grid over `area.bbox`; drop cells whose rectangle does not intersect the display polygon (bbox overlap **and** any corner or the centre inside via `pointInPolygon` on our tile points — rule 3); order from the centre outward. `kind = place` areas (circles) use one Nearby Search (`radiusM = area.radiusKm × 1000`, ≤ 50 km) instead. Paging: up to 3 pages per tile; a tile whose third page is full (60 results, no `nextPageToken`… or a token still present) is **saturated** → `splitTile` into four quadrants (depth ≤ 3) appended to the queue. Budget: `GOOGLE_SEARCH_MAX_REQUESTS` (default 30) requests per search; when it runs out the remaining tiles are `skipped` and note #22 `google_partial` says how many tiles were covered. Repeats across overlapping pages are de-duplicated by `placeId`.

Inside filter (`googleInside.ts`, pure, tested) — `googleInside(place, area): "yes" | "approx" | "no"`, from address components only: `country ≠ area.countryCode` → no. Then by kind: **department** (FR): `postcode` prefix = department code (`09`, `2A/2B → 20`, `97x`) or `adminLevel2 ≈ area.label` → yes; a present but different postcode/department → no; nothing present → approx. **region** (FR): `adminLevel1 ≈ area.label` → yes / different → no / absent → approx. **town / postcode**: `postcode ∈ admin.postcodes` or `locality|postalTown ≈ area.label` (or any commune name of a multi-commune postcode) → yes / different → no / absent → approx. **country**: yes. **place** (circle): yes (the Nearby circle is the area). Non-FR department/region: `adminLevel1|2 ≈ area.label` (normalised, accent-insensitive) → yes/no/approx. `≈` = `normaliseName` equality. `no` → dropped and counted (note #23 `google_outside_dropped`); `approx` → kept; Google pins carry `inside` implicitly (the card says *Outside {area}?* only for rows, never for anonymous pins).

Matching (`googleMatch.ts`, pure, tested) — `matchPlace(place, rows: MatchRow[]): { key: string } | null` where `MatchRow = { key, name, lat?, lng?, geoSource, postcode? }`: candidates share a name key (`normaliseName`) **or** a trade-word-stripped token overlap ≥ 0.6 (Jaccard over tokens ≥ 3 chars; the stripped words are the category's FR/EN labels and `restaurant|bar|hotel|hôtel|salon|garage|cabinet|sarl|sas|eurl`); a candidate with source coordinates must be within **150 m**; a candidate without (register rows placed at the centre) must share the postcode; the nearest wins. `googleDiscover` matches each place against `osmRows` then `registerRows`; matched → patch; unmatched → pin. `matched`/`only`/`dropped` counts feed note #24 `google_matched` (folded into the finished line: *… 372 from the register (54 in both) · 201 also on Google · 23 only on Google*).

### 4.4 Area suggestions — resolving a pick (`googleSuggest.ts`)

`POST /api/admin/find` accepts `suggestion?: { placeId: string; lat?: number; lng?: number }` (the Area box sends `place.id` from the UI Kit element, §5.3, plus coordinates when the element exposes them). Server: `placeIdOk` else `400 bad_suggestion`; when Google is on, `resolveSuggestion(suggestion)` = Details **Essentials** (`MASK_DETAILS_ESSENTIALS`, `google_details_other`, ≤ 4 s) → `{ query, lat, lng, countryCode, kindHint }` (the Essentials call is skipped when lat/lng came from the client **and** `area` text is a full name — then `query = area`); then `resolveArea(query, undefined, hint)` where the new optional `hint: { lat, lng, countryCode, kind? }` makes `geocode.ts` **auto-pick** among ambiguous candidates: keep those whose country matches, then the one whose bbox contains the point (and whose kind matches the hint when given); no candidate fits → the `409 ambiguous` chooser as today. `searches.query_area` stores the derived query (*Ariège, France*). Any Google failure (off, allowance, refused, timeout) falls back to `resolveArea(area)` with the typed text — the search never fails because of a suggestion. Rate: `rateLimit("google-suggest:" + ip, 60, 10 min)` on requests carrying `suggestion`.

### 4.5 Save-time match ("Find on Google" becomes automatic) and the listing check (`googleCheck.ts`)

- **Save** (`saveFromSearch`, `addByUrl` with `googlePlaceId`): a row/pick with `googlePlaceId` → `insertProspect` writes `google_place_id`, `google_listing = 'found'`, `google_match = 'auto'` (`'manual'` for Add by URL), `google_confirmed_at = now`. No Google call at save time.
- **Audit job** (`runAuditJob`, before `runChecks`): `const google = await googleListingFor(prospect, { fresh: job.payload.fresh === true, signal, log })`:
  1. Google off → `{ status: prospect.google_listing, signals: null }` (today's behaviour: `found`/`not_found` only by manual confirmation, `unverified` → not measured).
  2. No `place_id`, `google_listing ≠ 'not_found'` **or** (`not_found` set by `auto` more than 30 days ago) → **match**: one Text Search Pro (`matchSearchBody`, `google_search` pool) → `matchPlace` over the ≤ 5 candidates with the prospect as the row (name key, coordinates → 300 m, else postcode) → hit: `google_place_id`, `google_listing='found'`, `google_match='auto'`; miss: `google_listing='not_found'`, `google_match='auto'`; both set `google_checked_at = now`. `google_match = 'manual'` (Radu confirmed or rejected) is never overridden automatically.
  3. `place_id` present → **signals**: reuse the latest audit's `google_listing.details` when `fetchedAt` < 30 days and not `fresh`; else Details **Enterprise** (`google_details_enterprise` pool, cap 900) → `signalsOf`; on `allowance`/`busy`/`timeout` → `{ status: "found", signals: null, reason }` (no retry inside the job; the job never fails because of Google).
  4. `runChecks({ …, google })`.
- Every prospect saved while Google is on gets an audit job (today: only rows with a website): `saveFromSearch` and `addByUrl` enqueue `audit` for every saved row when `googlePlacesOn()`; no-website audits do `noSiteChecks` + the Google check only (no crawl, no PageSpeed) and still count one unit of `AUDIT_DAILY_CAP` (the cap line on the AuditBlock explains *includes Google-only checks*).
- `POST /api/admin/prospects/[id]/google` (rewritten; `rateLimit("google-check:" + ip, 30, 10 min)`): `{ action: "check" }` → steps 2–3 inline (≤ 8 s), returns `{ ok, prospect, signals, attributions: string[], usage }`; `{ action: "find" }` → Text Search Pro (`matchSearchBody`, `pageSize 5`) → `{ ok, candidates: GoogleCandidate[], usage }` (transient; shown only inside the open Google section, §5.6); `{ action: "confirm", placeId }` → `google_match='manual'`, `found`, then `check`; `{ action: "reject" }` → `not_found`, `google_match='manual'`, `place_id NULL`; `{ action: "clear" }` → `unverified`, `google_match NULL` (auto-match may run again). Errors: `501 google_off`, `429 google_monthly_cap { pool }`, `502 google_unavailable`, `502 google_refused`. `GET /api/admin/prospects/[id]` adds `googleCheckedAt`, `googleMatch`, `googleSignals` (from `audits.checks` of `latest_audit_id`, via `store.ts googleSignals(prospectId)`).

### 4.6 Scoring (`checks.ts`, `score.ts`) and wording (`auditChecks.ts`, `findings.ts`)

`ChecksInput.google: { status: "unverified" | "found" | "not_found"; signals: GoogleSignals | null; reason?: "allowance" | "unavailable" }` replaces `googleListing`. `googleListing(google)`:

| Case | status | points | details |
|---|---|---|---|
| `unverified` | not_measured | — | `{ listing: "unverified" }` |
| `not_found` | fail | 0 | `{ listing: "not_found", checkedAt }` (flag `no-gbp`, unchanged) |
| `found`, signals null | not_measured | — | `{ listing: "found", reason }` — the UI says *Listing found — details not checked (allowance used up / Google did not answer)* |
| `found` + signals | pass ≥ 9 · partial 4–8 | 4 exists + 1 operational + 2 website on the listing + 1 hours + 1 reviews ≥ 5 + 1 photos ≥ 1 | `{ listing: "found", operational, websiteOnListing, hours, reviews, photos, fetchedAt }` |

`makeCheck` gains an optional `points` override (clamped to the weight) so the sub-scores carry into `auditScore` unchanged; `score.test.ts` covers 10 → pass, 8 → partial (points 8, not 5), 4 → partial, not_found → fail + `no-gbp`. **Grade cap**: `auditScore` sets `grade = "C"` whenever `flags` contains `no-site` (a no-website business with a perfect listing would otherwise read 50 = B); score number unchanged; tested. Report copy (`src/content/auditChecks.ts`, prospect-facing, FR/EN): pass → *Votre fiche Google est en place et tenue à jour.* / *Your Google listing is in place and looked after.*; partial → *Votre fiche Google existe, mais elle est incomplète (site, horaires, photos ou avis manquants).* / *Your Google listing exists, but it is incomplete (website, hours, photos or reviews missing).*; fail and not_measured unchanged. `findings.ts googleLine` unchanged (our words only, never a quote from a listing); `findings.test.ts` updated. Draft templates (`drafts/templates`) mention the listing only through the existing flag words — no change.

### 4.7 Counters, Today, purge — the 30-day rule

- `api_usage` providers: `google_search`, `google_details_enterprise`, `google_details_other` (plus the legacy grand total `google_places` for one release; Today switches to the pools). `today.ts` `collectToday` adds `googleSearchMonth`, `googleSearchCap`, `googleOtherMonth`, `googleOtherCap`, `googleKeyMissing`; the housekeeping line (only when Google is on) reads *Google usage: 12 of 900 listing checks · 40 of 4,500 searches this month* (tone `warn` ≥ 90 %, `bad` at the cap), or *Google is switched on, but its key is missing.*; `today.test.ts` and the digest mirror follow.
- Nothing Google-derived needs refreshing on a timer because nothing beyond the exceptions is stored: `place_id` (kept), lat/lng only inside `api_cache["search:{id}"]` (24 h TTL < 30 days), signals as derived numbers with `fetchedAt`. `scripts/digitalm-purge.js` gains **step 12 — Google**: `DELETE FROM api_cache WHERE provider LIKE 'google%'` (safety net; the client never writes any) and a count of `audits` whose `google_listing.details.fetchedAt` is older than 30 days reported as *Google signals older than 30 days: n (re-checked at the next audit)* — no deletion (they are our measurements, D2). The prospect page labels signals older than 30 days *checked 45 days ago — re-check* (§5.6); `Audit next 20` and **Check again** refresh them.

### 4.8 API contract (all under the existing auth/CSRF rules; error shape `{ ok:false, error, message? }`)

- `POST /api/admin/find` body adds `suggestion?: { placeId, lat?, lng? }` (§4.4). Responses unchanged; `queryArea` may be the derived query.
- `GET /api/admin/find?id=` — `SearchResultV2` adds `googlePins?: GooglePin[]` (full list on every read; hidden ones flagged), `progress.google?: GoogleProgress`, `progress.stage` may be `"google"`, rows may carry `googlePlaceId` and `onGoogle`.
- `POST /api/admin/find/dismiss { searchId, key, undo? }` — `key` may be `google:<placeId>` (validated with `placeIdOk`); stored in `searches.dismissed` like row keys.
- `POST /api/admin/find/save` — unchanged; saved rows carry their `googlePlaceId` into `prospects`.
- `POST /api/admin/prospects { url, name?, country, googlePlaceId? }` — Add by URL stores the place id (`google_match='manual'`, `found`); `400 bad_place_id` on a malformed id.
- `POST /api/admin/prospects/[id]/google` — §4.5 actions. `GET /api/admin/prospects/[id]` — §4.5 fields.
- Library exports (`index.ts`): `googlePlacesOn`, `googleDiscoveryOn`, `googleMapConfigured`, `googleUsage`, `GoogleError`, `GOOGLE_TYPES`.

Notes catalogue additions (`notes.ts`, tested for text and forbidden tokens): 17 `google_no_key` — "Google is switched on, but its key is missing." · 18 `google_discovery_off` — "Google is used for the map, place suggestions and listing checks, not yet to find businesses." · 19 `google_failed` — "Google did not answer, so nothing from Google is shown for this search." · 20 `google_refused` — "Google refused the request — the key's restrictions need a look." · 21 `google_allowance` — "The monthly Google search allowance is used up — Google was not asked for this search." · 22 `google_partial` — "Google was asked for {done} of {total} parts of {area}; some businesses known only to Google may be missing." · 23 `google_outside_dropped` — "{n} Google results outside {area} were left out." · 24 `google_matched` — "{matched} also on Google · {only} only on Google."

---

## 5. Frontend

### 5.1 Loading Maps JavaScript, and the CSP

`googleMaps.ts` (client, singleton): `loadGoogleMaps(): Promise<typeof google.maps>` injects once `<script src="https://maps.googleapis.com/maps/api/js?key=<NEXT_PUBLIC_GOOGLE_MAPS_KEY>&v=weekly&loading=async&language=en&region=FR&callback=__dmGmapsReady">`, resolves on the callback, rejects after 10 s or on `error`; callers then `await google.maps.importLibrary("maps" | "marker" | "places")`. `googleMapsPlaceUrl(placeId)` → `https://www.google.com/maps/place/?q=place_id:<encoded>` (null when `placeIdOk` fails). Nothing loads until a component that needs it mounts (the finder page with the Google map; the Area box; a *Show the Google listing* panel when opened).

`next.config.mjs` — one added `headers()` entry after the global one, only when `process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY` is set at build time (the public site's CSP is untouched; Next applies the last matching entry for the same header key):

```
source: "/admin/:path*"
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://maps.googleapis.com https://*.gstatic.com https://*.google.com blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https: blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://challenges.cloudflare.com https://maps.googleapis.com https://*.googleapis.com https://*.gstatic.com https://*.google.com data: blob:; frame-src 'self' https://challenges.cloudflare.com https://*.google.com; worker-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'
```

`X-Robots-Tag` / `Cache-Control` of that entry stay as they are. `NEXT_PUBLIC_*` values are build-time: staging needs them in `.env.local` before `npm run build`.

### 5.2 `GoogleFindMap.tsx` — same props as `FindMap`, same behaviour, Google underneath (D4)

`FindWorkspace` picks the map: `googleMap` prop (from `googleMapConfigured()`) → `dynamic(() => import("./GoogleFindMap"), { ssr: false })`, else `FindMap` (Leaflet). `GoogleFindMap` renders the Leaflet `FindMap` itself when `loadGoogleMaps()` rejects, with a one-line note above the map (`GOOGLE_TEXT.mapFailed`: *The Google map could not be loaded — showing OpenStreetMap instead.*), so a wrong key or a blocked script never leaves the page without a map.

- One `new google.maps.Map(el, { mapId: NEXT_PUBLIC_GOOGLE_MAP_ID, center, zoom, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, gestureHandling: "greedy", clickableIcons: false })` per mount = one Dynamic Maps load; the `mini` prop is **not** implemented here — `MiniMap` stays Leaflet everywhere (no map loads spent on one pin, and the prospect page's Google section rule of §3.4 stays simple).
- Pins: `AdvancedMarkerElement` with `content` = a `<div class="dm-gpin …">` carrying the pin vocabulary as classes (`dm-gpin-website`, `-nowebsite`, `-saved`, `-hidden`, `-outside`, `-selected`, `-hovered`, `-google` for Google-only pins in **blue** `#3B82F6`), `title` = the row's name (empty for Google-only pins), `gmpClickable: true`, `gmp-click` → `onSelect(key)`. Pin keys for Google-only pins are `google:<placeId>`.
- Clustering: `@googlemaps/markerclusterer` (`MarkerClusterer({ map, markers, algorithmOptions: { radius: 56, maxZoom: 17 }, renderer })`) with a renderer drawing the same numbered disc as Leaflet (`dm-gcluster`, sizes from `mapCluster.ts clusterSize`); the selected pin is kept out of the clusterer (added to the map directly). `window.__dmFindPins = { total, visible, clustered, selectedKey }` after every render; `window.__dmFindProject(key)` uses a hidden `OverlayView` (`dmProjector`) → `getProjection().fromLatLngToContainerPixel(latLng)`; cluster discs are DOM elements with class `dm-gcluster` (the e2e accepts either class).
- Outline: `google.maps.Polygon` per polygon (outer ring + holes as `paths`), `strokeOpacity 0`, `fillColor #F15A24`, `fillOpacity 0.06`, `clickable: false`, plus one `Polyline` per ring with the documented dash pattern (`icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 2 }, offset: "0", repeat: "12px" }]`, `strokeColor #F15A24`); `polygonApprox` outlines get a `title` tooltip element *approximate outline*; `fitBounds(bbox, 24)` on a new area or `fitSignal`.
- Sync: `hoverKey`/`selectedKey` restyle the marker content; click row → `panTo` only when the pin is outside the bounds padded by 10 % (never a zoom change); `onViewport` on `idle` (debounced 80 ms) with `getBounds()`; chips filter markers and rows together; *List follows the map* unchanged. Unit dots: small `AdvancedMarkerElement`s with `dm-unit*` classes. Progress bar overlay and the legend button: same DOM as today.
- Attribution for our data on Google's map: a small `© OpenStreetMap contributors` line (link to the copyright page) at the map's bottom-left (`dm-osm-attr`), because on the phone the map fills the viewport and the list footer is off-screen. Google's own attribution is the map's.

### 5.3 The Area box with suggestions (`GoogleAreaInput.tsx`, D5)

When `googleOn` and the Maps script loads, `AreaInput` renders `GoogleAreaInput`: a `<gmp-basic-place-autocomplete>` element (`await importLibrary("places")`) with `includedPrimaryTypes = ["(regions)"]`, `requestedLanguage = "en"`, `placeholder = FIND_TEXT.areaPlaceholder`, styled through its CSS custom properties to the admin field look (15–16 px, `border-line`, `bg-surface`); labelled by the existing *Area* `<label for>`; the element's own list is keyboard-navigable (arrow keys, Enter, Esc). `gmp-select` → `onSuggestion({ placeId: event.place.id, lat: event.place.location?.lat(), lng: event.place.location?.lng() })` (the element's populated fields are not documented beyond `id` — the server handles both, §4.4) and the workspace posts `{ area: <input text>, suggestion, category, … }`. Typing and pressing Enter without picking posts the text as today. When the script fails, when Google is off, or on the ambiguity chooser (candidates), the plain `Field` is rendered — same `name="area"`, same tests. Sessions are billed per selection by the UI Kit (10,000 free); no session token code on our side.

### 5.4 List, chips, legend, progress

- `FindList` header: the sources sentence gains *· 201 also on Google · 23 only on Google* when `progress.google` exists; chip **Only on Google (n)** (`Chip = … | "google_only"`, primary row, **on by default** when pins exist — it toggles the blue pins, it filters no rows); `counts.google_only = googlePins.filter(!hidden).length`.
- `Legend`: *Blue pin — on Google only (open it to see the listing)*; the *?* panel gains one line *Google data is shown by Google's own panels* with the `GoogleAttribution` mark.
- `FindProgress`: stage `google` → *Asking Google — {done} of {total} tiles*; a failed Google phase shows note #19–#21 as a muted line under the finished status (never an amber banner — the search is complete without Google).
- `progressModel.ts`: the Google stage takes a 10 % share when present.

### 5.5 Business card — Google sections, and the Google-only card

- Rows with `googlePlaceId`: in **Where it came from**, one line *Also on Google* + `GoogleAttribution` + **View on Google Maps** (`googleMapsPlaceUrl`, `rel="noopener noreferrer nofollow"`, new tab); under it a `<details>` **Show the Google listing** (`data-testid="card-google-listing"`) whose body is `GoogleListingPanel` (§5.7). The plain *Open in Google Maps* coordinate link of today stays for every pinned row.
- `GoogleOnlyCard.tsx` (`role="dialog"`, `data-testid="google-only-card"`, opened by `select("google:<placeId>")`): title *On Google only* (`h2`, 22 px), one muted sentence (`GOOGLE_TEXT.googleOnlyHint`: *Google knows this business; OpenStreetMap and the French company register do not. Open the listing to see who it is, then add it by its website to save it.*), the `GoogleListingPanel` (loaded at once — this card exists to show it), **View on Google Maps**, then actions: **Add by its website** (`data-testid="google-add-by-url"`; opens the Add-by-URL form in the card with `country = area.countryCode` and a hidden `googlePlaceId`; Radu types the site and the name he reads in Google's panel; success → toast *Saved as PR-… · audit queued*, the pin turns green) and **Not this one** (dismiss key `google:<placeId>`, Undo toast). Esc/Back as the business card. When the Maps script failed, the panel area says *Google's listing panel could not be loaded* and the link remains.

### 5.6 Prospect page — `GoogleBlock.tsx` rewritten

Hidden while Google is off (as today). Placed **after** `AuditBlock` (below the fold), as a `<details data-testid="google-block">` collapsed by default with the summary *Google listing · {status word}*; while open it sets `data-google-open` on `document.documentElement`, and `MiniMap`'s wrapper carries `[html[data-google-open]_&]:hidden` (Tailwind arbitrary variant) — rule §3.4.

Inside: status badge — *Listing found · looks maintained* (pass) / *Listing found · looks unmaintained* (partial) / *Listing found · details not checked* (found, no signals) / *No listing found* / *Not checked yet*; a line *Checked {relative} · matched automatically | confirmed by you* (`googleCheckedAt`, `googleMatch`), *checked 45 days ago — re-check* past 30 days; signals as words (`GOOGLE_TEXT.signal*`: *open according to Google* / *marked closed on Google*, *website on the listing* / *no website on the listing*, *opening hours filled in* / *no opening hours*, *{n} reviews*, *{n} photos*) with `GoogleAttribution`; `attributions` from the last `check` response listed as *Data: {names}* while present; **View on Google Maps**; a nested `<details>` **Show the Google listing** → `GoogleListingPanel`; buttons **Check again** (`action: "check"`), **Match manually** (`action: "find"` → the ≤ 5 candidates as *{name} — {addressLine} · {distance} m* with **Use** → `confirm`; rendered only here, inside the open section), **Not this listing** (`reject`), **Clear** (`clear`, shown when not `unverified`). Toasts in sentences: `google_off` → *Google is switched off for now*; `google_monthly_cap` → *The monthly Google allowance is used up — try again next month.*; `google_unavailable` → *Google did not answer. Try again later.*; `google_refused` → *Google refused the request — the key's restrictions need a look.* `AuditBlock`'s detail line for `google_listing` reads the words above from `details` (never the raw `listing` token).

### 5.7 `GoogleListingPanel.tsx`, `GoogleAttribution.tsx`, wording

- `GoogleListingPanel({ placeId })`: `await loadGoogleMaps(); await importLibrary("places")`; renders `<gmp-place-details-compact orientation="vertical"><gmp-place-details-place-request place={placeId}/><gmp-place-standard-content/></gmp-place-details-compact>` (Google renders name, address, rating, open state, a photo with its author credit and the Google attribution — nothing of it passes through our code; `gmp-load` → nothing to read but `place.id`; `gmp-error` → *Google's listing panel could not be loaded*). One UI Kit query per mount; the panel mounts only when its `<details>` opens.
- `GoogleAttribution()`: `<span class="dm-google-attr" translate="no">` with the logo image when `public/brand/google-maps-logo.svg` exists at build time (a small build-time flag from `fs.existsSync` in the server page, passed down) else the text *Google Maps*; 16 px high, 10 px clear space.
- `wording.ts` `GOOGLE_TEXT` holds every sentence above (`attribution: "Google Maps"`, `mapFailed`, `onlyOnGoogle`, `onlyOnGoogleChip: "Only on Google ({n})"`, `alsoOnGoogle`, `viewOnGoogleMaps`, `showListing`, `googleOnlyHint`, `addByWebsite`, `panelFailed`, status words, `checkedLine`, `recheck`, signal words, button labels, toasts, `asking: "Asking Google — {done} of {total} tiles"`); `FORBIDDEN_TOKENS` adds `/\bclaimed\b/i`, `/\bverified\b/i`, `/Google My Business/i`, `/\bGMB\b/`; `wording.test.ts` walks `GOOGLE_TEXT` too.

### 5.8 Today

`TodayCards`/`todaySummary.ts`: the housekeeping line of §4.7 replaces *Google usage: 0 of 900 this month*; the key-missing sentence has tone `warn`.

---

## 6. Environment — `.env.example` block (backend replaces today's four `GOOGLE_*` lines under `# @@crm:finder`)

```
# ---- Google (docs/finder-google-spec.md) ------------------------------------
# on|off — Google in the CRM: the finder map (Google Maps), place suggestions in the Area box, the
# Google-listing check of saved prospects and the Google section on the prospect page.
# off = the OpenStreetMap map and no Google call anywhere (today's behaviour).
GOOGLE_PLACES=off
# on|off — also ask Google Places when finding businesses (§0, decision D1). off = searches never call Google;
# everything else above still works.
GOOGLE_PLACES_DISCOVERY=off
# Server-side Places API (New) key. Restrict it in Cloud Console to this server's egress IP and to the
# "Places API (New)" API only. Never sent to a browser, never logged.
GOOGLE_PLACES_KEY=
# Monthly hard stops, counted per Google SKU family in api_usage (90 % of the free allowances):
# listing checks = Place Details Enterprise (1,000 free) · searches = Text/Nearby Search Pro (5,000 free) ·
# other details = Place Details Essentials/Pro (area suggestions, manual matching; 10,000 / 5,000 free).
GOOGLE_PLACES_MONTHLY_CAP=900
GOOGLE_SEARCH_MONTHLY_CAP=4500
GOOGLE_DETAILS_MONTHLY_CAP=4500
# Google requests one search may spend on discovery (each answers at most 20 places).
GOOGLE_SEARCH_MAX_REQUESTS=30
# Browser key (build-time — rebuild after changing). Restrict it to HTTP referrers https://digitalm.eu/* and
# https://d3v.digitalm.eu/* and to the "Maps JavaScript API" and "Places UI Kit" APIs. Blank = the
# OpenStreetMap map even with GOOGLE_PLACES=on.
NEXT_PUBLIC_GOOGLE_MAPS_KEY=
# Map ID (Cloud Console → Map Management), required for the markers on the Google map. DEMO_MAP_ID works on staging.
NEXT_PUBLIC_GOOGLE_MAP_ID=
```

Keys: `GOOGLE_PLACES`, `GOOGLE_PLACES_DISCOVERY`, `GOOGLE_PLACES_KEY`, `GOOGLE_PLACES_MONTHLY_CAP`, `GOOGLE_SEARCH_MONTHLY_CAP`, `GOOGLE_DETAILS_MONTHLY_CAP`, `GOOGLE_SEARCH_MAX_REQUESTS`, `NEXT_PUBLIC_GOOGLE_MAPS_KEY`, `NEXT_PUBLIC_GOOGLE_MAP_ID`. Cloud Console side (Radu, §8.3 L1): two keys, one project, billing on, APIs enabled: *Places API (New)*, *Maps JavaScript API*, *Places UI Kit*; a budget alert at €5.

---

## 7. Security

- **Server key**: read only in `src/lib/discover/google.ts`, sent as `x-goog-api-key`, never in a URL, never logged (`fetchJson` logs nothing; `google.ts` logs error codes only). Added to the "never log" list of `leadgen-build-spec.md` §10 (already there). IP-restricted to the VPS egress address + API-restricted to Places API (New) — a leaked key is useless elsewhere.
- **Browser key**: `NEXT_PUBLIC_GOOGLE_MAPS_KEY` is public by nature; referrer-restricted to the two hosts and API-restricted to Maps JavaScript API + Places UI Kit (not Places API (New) — the browser never calls the web service). Test §3.7: no `GOOGLE_PLACES_KEY` under `src/components`.
- **SSRF unchanged**: Google is a fixed origin in `HOSTS`; no URL from data is ever fetched (`googleMapsUri` is not requested — the *View on Google Maps* link is built from the validated place id; `websiteUri` is never fetched by us — D3 — and if Radu pastes it into the website field it goes through the existing `coerceHttpUrl` + audit SSRF rules).
- **Rate limits**: `google-suggest` 60 / 10 min per IP on `POST /api/admin/find` with a `suggestion`; `google-check` 30 / 10 min per IP on `/prospects/[id]/google`; the monthly pools stop everything else. All routes stay behind `guardAdminPost`/`requireAdminApi`.
- **Input validation**: `placeIdOk` on every place id from a client or a fixture; `suggestion.lat/lng` finite and in range; dismiss keys `google:<id>` validated; candidate lists ≤ 5, strings ≤ 200 chars, rendered as React text nodes.
- **CSP**: admin pages only (§5.1); the public site's CSP is unchanged. `frame-src *.google.com` exists only because the Maps script may open Google's own frames (Street View is disabled; the UI Kit needs none today) — dropped if the live checklist shows no frame is requested.
- **Data minimisation** as in §3: no names/addresses/reviews/photos from Google in SQLite or logs; matching happens in memory and the response is discarded; fixtures are synthetic.

---

## 8. Tests

### 8.1 Fixtures (`src/lib/discover/fixtures/google/`, synthetic — made-up names and ids in the documented shapes, never captured live content)

`text-search.tile1.page1.json` (20 places, `nextPageToken`), `text-search.tile1.page2.json` (12 places, no token) — including one place with `country = AD`, one with postcode `66xxx`, one without address components; `text-search.saturated.json` (20 + token, three times); `nearby-search.json`; `details.enterprise.maintained.json` (OPERATIONAL, website, hours with periods, rating 4.5, 37 reviews, 3 photos, `attributions: []`), `details.enterprise.unmaintained.json` (OPERATIONAL, no website, no hours, 2 reviews, 0 photos), `details.enterprise.closed.json` (CLOSED_PERMANENTLY), `details.essentials.ariege.json` (types `administrative_area_level_2, political`, components Ariège / Occitanie / France, location, viewport), `details.essentials.cambridge-uk.json`, `details.pro.candidate.json`, `error.403.json`, `error.429.json`; `search-ariege.sample.json` gains `googlePins` (3) and `progress.google` in its `done` result.

### 8.2 Unit (`node:test`, pure modules, relative `.ts` imports)

- `googleRequests.test.ts`: the four masks vs the tier table (no higher-tier field; `nextPageToken` allowed); `textSearchBody` (rectangle low/high order, `strictTypeFiltering` only with a type, `pageSize 20`, page token carried, language by country); `nearbySearchBody` radius clamp; `matchSearchBody` bias circle vs region only; `parseSearch` keeps only our fields and drops unknown ones; `signalsOf` on the three Enterprise fixtures → `{10, 5, 4}`-point inputs and only booleans/numbers + `fetchedAt`; `parseDetailsEssentials` → kind hints and queries for Ariège and Cambridge; `placeIdOk`; `GOOGLE_TYPES` covers every `CATEGORIES` key and every `includedType` is in the Table A list embedded in the test.
- `googleTiles.test.ts`: `n` from expected (292 → 8 → 3×3 grid, cells outside the Ariège fixture polygon dropped — the Andorra corner cell goes), one tile when unknown, ordering from the centre, `splitTile` quadrants and depth cap, budget stop with the skipped count.
- `googleInside.test.ts`: department 09 (postcode `09000` yes, `66500` no, `AD` no, none → approx, `2A` → `20`), region Occitanie, town Foix (postcode set, locality), country Andorra, non-FR Cambridge (`adminLevel2` Cambridgeshire), place circle → yes.
- `googleMatch.test.ts`: same name 40 m → match; same name 400 m → none; "Le Phoebus Restaurant" vs "Le Phoebus" (stripped word) → match; different name 10 m → none; register row without coordinates + same postcode → match; nearest of two; a place matched to at most one row.
- `googleCheck.test.ts` (pure decision table, injected callers): off → passthrough; no id + unverified → match called; `manual` never re-matched; `not_found` by `auto` 31 days ago → re-matched; signals reused < 30 days unless fresh; `allowance` → found without signals; the job never throws on `GoogleError`.
- `checks.test.ts` / `score.test.ts`: §4.6 table; points 8 → partial keeps 8; grade cap C with `no-site`; flags unchanged otherwise. `findings.test.ts`: the new pass/partial copy FR/EN. `notes.test.ts`: codes 17–24. `today.test.ts`: the housekeeping line and the key-missing line. Static tests of §3.1/§3.3/§3.7.
- Frontend: `wording.test.ts` (`GOOGLE_TEXT`, new forbidden tokens), `format.test.ts` (`googleMapsPlaceUrl` valid/invalid ids), `progressModel.test.ts` (Google stage share), `mapCluster.test.ts` unchanged (the clusterer is Google's; our disc sizing is still tested).
- Gates: `npm test` green; `NODE_OPTIONS=--max-old-space-size=1536 npx tsc --noEmit` clean; no `.env*` in `git log main..feat/finder-google`.

### 8.3 Live checklist (once Radu's keys exist; integrator, on staging with `--db` staging)

- **L1 Keys.** Server key: IP + API (Places API (New)) restricted; `curl` Text Search with `MASK_SEARCH_PRO` → 200; with a mask containing `websiteUri` the client refuses locally (`mask_tier`) before any call. Browser key: referrer + API (Maps JS, Places UI Kit) restricted; loading the finder from an unlisted origin shows the Leaflet fallback and the note.
- **L2 SKUs.** After one Ariège/restaurant search with discovery on, one prospect audit, one suggestion pick and one manual match, the Cloud Console *APIs & Services → Metrics* shows only: Text Search Pro (≤ 30 + 1), Place Details Enterprise (1), Place Details Essentials (1), Place Details Pro (1), Dynamic Maps (page opens), Places UI Kit Query (panels opened), Places UI Kit Autocomplete Per Session (1). No Enterprise + Atmosphere, no Photos.
- **L3 Autocomplete element.** Typing *arie* lists suggestions; Enter on *Ariège, France* starts a department search with no chooser; the payload of `gmp-select` is logged once in the console (`place.id` present; note in Appendix C whether `location` was populated) then the log line is removed.
- **L4 Map.** Google map with the outline, ≥ 250 pins for Ariège, clusters at zoom 9, hover/click sync, `__dmFindPins.total ≥ 250`, `© OpenStreetMap contributors` visible on the phone layout.
- **L5 Nothing stored.** The SQL of §3.1 returns 0 after L2; `api_usage` has `google_search`, `google_details_enterprise`, `google_details_other` rows; `staging.log` contains no place name and no key.
- **L6 Discovery.** `googlePins` non-empty, no pin outside the department by eye (blue pins in Andorra = a bug in `googleInside`); `note google_matched` counts plausible (matched ≥ 60 % of OSM rows for restaurants).
- **L7 Audit.** A saved Foix prospect audited → `google_listing` measured with signals; the report line reads *Your Google listing is in place and looked after* (or the partial sentence); the prospect page section shows the words and the compact panel; the mini map disappears while the section is open.
- **L8 Caps.** With `GOOGLE_PLACES_MONTHLY_CAP=0` on staging, **Check again** → 429 and the sentence; a search with `GOOGLE_SEARCH_MONTHLY_CAP=0` finishes `done` with note #21; restore the values.
- **L9 Words.** `scripts/e2e/finder.cjs` G-items (§9) green; no forbidden token in any admin page.
- **L10 Billing.** 24 h later the billing report shows €0.00 for the day.

---

## 9. Acceptance (API with the staging cookie; e2e in `scripts/e2e/finder.cjs`, items G1–G9; all skipped with a printed *skipped — Google off* when `GOOGLE_PLACES` is off)

- **G1 — Off means unchanged.** With `GOOGLE_PLACES=off`: `/admin/find` renders one `.leaflet-container`, the Area box is a plain input, `GET ?id` has no `googlePins` and no `progress.google`, the prospect page has no `[data-testid=google-block]`, and every finder-ux item A1–A22 still passes.
- **G2 — Suggestion pick.** `POST /api/admin/find { area: "arie", category: "restaurant", suggestion: { placeId: <Ariège id from L3> } }` → `202` with `area.kind = "department"`, `area.osmRelationId = 7439`, `queryArea` containing *Ariège*; `api_usage.google_details_other` +1 (or +0 when the element supplied coordinates); with a malformed `placeId` → `400 bad_suggestion`; with Google off → the request resolves from `area` as today.
- **G3 — Discovery payload.** With `GOOGLE_PLACES_DISCOVERY=on`, the finished Ariège search has `progress.google.state = "done"`, `progress.google.requests ≤ 30`, `googlePins.length > 0`, every pin `placeId` matching `/^[A-Za-z0-9_-]{10,300}$/`, no pin with a `name` key, ≥ 1 row with `googlePlaceId` and `onGoogle: true`, note `google_matched`; `notes[].text` contain none of the forbidden tokens nor *claimed* / *verified*.
- **G4 — No Google content at rest.** After G3 and G6: `SELECT COUNT(*) FROM api_cache WHERE provider LIKE 'google%' OR payload LIKE '%displayName%' OR payload LIKE '%formattedAddress%' OR payload LIKE '%websiteUri%'` = 0; `SELECT COUNT(*) FROM prospects WHERE google_place_id IS NOT NULL AND google_place_id NOT GLOB '[A-Za-z0-9_-]*'` = 0.
- **G5 — Dismiss a Google pin.** `POST /api/admin/find/dismiss { searchId, key: "google:<placeId>" }` → the pin reads `hidden: true` on the next `GET`; `undo: true` reverses it; `key: "google:bad id"` → `400`.
- **G6 — Audit check.** `POST /api/admin/find/save` of a row with `googlePlaceId` → `GET /api/admin/prospects/{id}` shows `googlePlaceId`, `googleListing = "found"`, `googleMatch = "auto"`; after its audit, `audits.checks.google_listing.measured = true` with `points` in 0–10 and `details` keys ⊆ `{listing, operational, websiteOnListing, hours, reviews, photos, fetchedAt, checkedAt, reason}`; a saved row without a place id gets `googleMatch = "auto"` and `googleCheckedAt` set by its audit; `POST …/google { action: "reject" }` → `not_found`, `googleMatch = "manual"`, and a new audit leaves it untouched.
- **G7 — Caps and failures.** `GOOGLE_PLACES_MONTHLY_CAP=0` → `POST …/google { action: "check" }` → `429 google_monthly_cap` with `pool = "google_details_enterprise"` and no `api_usage` increment; `GOOGLE_SEARCH_MONTHLY_CAP=0` → a search finishes `done` with note `google_allowance` and `progress.google.state = "failed"`, `error = "allowance"`.
- **G8 — e2e, Google map and cards.** `/admin/find?search=<Ariège id>` renders no `.leaflet-container` and one `div[aria-label="Map of the businesses found"]` containing a `gmp-advanced-marker` (or `.dm-gcluster`), `window.__dmFindPins.total ≥ 250`; clicking `__dmFindProject(<osm key>)` opens the business card; clicking a blue pin (`__dmFindProject("google:…")`) opens `[data-testid=google-only-card]` whose title is *On Google only* and which contains a `gmp-place-details-compact` element and a link to `google.com/maps/place/?q=place_id:`; no text node of the card outside that element equals a Google business name (the e2e compares against the panel's rendered heading); the *Only on Google* chip hides the blue pins.
- **G9 — e2e, prospect page.** `/admin/prospects/[id]` for a prospect with a place id: `[data-testid=google-block]` is a collapsed `<details>` placed after the audit section; opening it hides `[data-testid=mini-map]`, shows a status word from the §5.6 list, the *Google Maps* attribution (`[translate=no]` text or the logo image), a *View on Google Maps* link, and no element in `main` contains *claimed*, *verified*, *GMB* or *Google My Business*; closing it brings the mini map back.
- **G10 — Build/test gates.** `npm test` green; `tsc` clean; `npm run build` once on staging; `git log main..feat/finder-google` shows only `finder-google: …` commits, no `.env*`; `package.json` diff = `@googlemaps/markerclusterer` + dev `@types/google.maps`.

---

## 10. Sequencing and effort

Day 0 (backend, 2 h): types + schema + `.env.example` block + notes 17–24 + synthetic fixtures + `googleRequests.ts` masks and parsers — committed so the frontend has shapes and a sample. Backend then: client with pools/caps/errors + tiles + inside + match + the runner phase + progress/notes (1.5 d) → suggestion resolution + `resolveArea` hint (0.5 d) → save-time match, the audit check, scoring, report copy, the `/google` route, Add-by-URL place id, Today + digest + purge step (1.25 d) → tests, README/spec pointers (0.5 d) = **4.25 d**. Frontend: loader + CSP + `GoogleFindMap` (markers, clusterer, outline, projector, fallback, attribution) (1.5 d) → `GoogleAreaInput` (0.5 d) → pins/chip/legend/progress + card sections + `GoogleOnlyCard` + Add-by-URL prefill (1 d) → `GoogleBlock` rewrite + `GoogleListingPanel` + `AuditBlock` words + Today line (0.75 d) → wording/tests (0.25 d) = **4 d**. Integration: staging build, live checklist L1–L10 (needs the keys), e2e G1–G10, fixes = **1 d**. Total **9.25 engineer-days**; two people in parallel ≈ 5–6 calendar days, the last day gated on Radu's keys. Merge order: backend day 0 → frontend against the fixture → backend routes → integration on `feat/finder-google` → staging soak with Google off (G1) then on → prod (separate approval; the prod restart needs Radu; prod `.env.local` gets the §6 block with `GOOGLE_PLACES_DISCOVERY` per D1).

## 11. Risks

- The UI Kit elements are young: the `gmp-select` payload and the compact element's CSS hooks may differ from the reference read on 12 Sep — L3 verifies, Appendix B is the autocomplete fallback, and the compact panel degrades to the *View on Google Maps* link.
- 2,000 Advanced Markers are DOM nodes; the clusterer keeps the visible count small, but a phone at zoom 9 over France with 2,000 pins may stutter — the clusterer's `radius` is the knob; Leaflet stays one env value away.
- Discovery spends up to 30 Pro requests per search (5,000 free): ~150 searches a month before the pool stops it; the note says so and the search still completes.
- Terms readings D1–D3 are Radu's; the defaults are the conservative ones and every Google feature is one env value to switch off.
- `NEXT_PUBLIC_*` values are baked at build time — a key rotation means a rebuild on staging and on prod.

---

## Appendix A — request/response shapes and SKU tiers (verified 12 Sep 2026)

- Base `https://places.googleapis.com/v1`; headers `X-Goog-Api-Key`, `X-Goog-FieldMask` (comma-separated, no spaces, `places.` prefix on search endpoints, none on Details); billed at the highest tier present in the mask.
- **Text Search** `POST /places:searchText` — `textQuery` (required), `includedType` (one Table A type), `strictTypeFiltering`, `locationRestriction.rectangle { low: SW, high: NE }` (rectangle only; categorical queries), `locationBias` (circle ≤ 50 km or rectangle; exclusive with restriction), `pageSize` 1–20, `pageToken` (max 60 results across pages; other params must not change between pages; `nextPageToken` must be in the mask), `rankPreference`, `languageCode`, `regionCode`. Tiers: IDs Only = `places.id, places.name, places.attributions, places.consumerAlert, places.movedPlace, places.movedPlaceId, nextPageToken`; Essentials-level fields (`addressComponents, addressDescriptor, adrFormatAddress, formattedAddress, location, plusCode, postalAddress, shortFormattedAddress, types, viewport`) bill **Pro** on search; Pro = `accessibilityOptions, businessStatus, containingPlaces, displayName, googleMapsLinks, googleMapsTypeLabel, googleMapsUri, iconBackgroundColor, iconMaskBaseUri, openingDate, photos, primaryType, primaryTypeDisplayName, pureServiceAreaBusiness, searchUri, subDestinations, timeZone, utcOffsetMinutes`; Enterprise = `currentOpeningHours, currentSecondaryOpeningHours, internationalPhoneNumber, nationalPhoneNumber, priceLevel, priceRange, rating, regularOpeningHours, regularSecondaryOpeningHours, transitStation, userRatingCount, websiteUri`; Enterprise + Atmosphere = reviews, summaries, serves*/dineIn/takeout….
- **Nearby Search** `POST /places:searchNearby` — `locationRestriction.circle { center, radius ≤ 50,000 }` only, `includedTypes[]`, `maxResultCount` 1–20, no pagination; same tiers.
- **Place Details** `GET /places/{id}?languageCode=&regionCode=` — IDs Only (free, unlimited) = `attributions, consumerAlert, id, movedPlace, movedPlaceId, name, photos`; Essentials (10,000 free) = `addressComponents, addressDescriptor, adrFormatAddress, formattedAddress, location, plusCode, postalAddress, shortFormattedAddress, types, viewport`; Pro (5,000) = `accessibilityOptions, businessStatus, containingPlaces, displayName, googleMapsLinks, googleMapsTypeLabel, googleMapsUri, iconBackgroundColor, iconMaskBaseUri, openingDate, primaryType, primaryTypeDisplayName, pureServiceAreaBusiness, subDestinations, timeZone, utcOffsetMinutes`; Enterprise (1,000) = `currentOpeningHours, currentSecondaryOpeningHours, internationalPhoneNumber, nationalPhoneNumber, priceLevel, priceRange, rating, regularOpeningHours, regularSecondaryOpeningHours, transitStation, userRatingCount, websiteUri`. `businessStatus ∈ OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY | FUTURE_OPENING | BUSINESS_STATUS_UNSPECIFIED`. No claimed/verified/owner field exists.
- **Place types**: Table A includes `restaurant, bar, hotel, bed_and_breakfast, campground, bakery, butcher_shop, hair_salon, beauty_salon, car_repair, plumber, electrician, painter, roofing_contractor, real_estate_agency, dentist, gym`; `carpenter` and `optician` are not filterable (text query only). Table B (`(regions)`, `(cities)`, `locality`, `administrative_area_level_1/2`, `country`, `postal_code`) only in Autocomplete `includedPrimaryTypes`.
- **Places UI Kit** (Maps JS `places` library): `gmp-basic-place-autocomplete` (properties `includedPrimaryTypes, includedRegionCodes, locationBias, locationRestriction, origin, requestedLanguage, requestedRegion, placeholder, …`; event `gmp-select` = `PlaceSelectEvent` carrying a `Place` — populated fields not specified in the reference); `gmp-place-details-compact` (`orientation`, read-only `place` "containing the ID, location, and viewport of the currently rendered place"; events `gmp-load`, `gmp-error`) with `gmp-place-details-place-request place="<id>"` and `gmp-place-standard-content` / `gmp-place-all-content` / `gmp-place-content-config` children. EEA SST B.15.3: the map and permitted-use restrictions "do not apply to the Places UI Kit". Billing: UI Kit Query 10,000 free then $1/1,000; Autocomplete Per Session 10,000 free then $10/1,000.
- **Maps JavaScript**: one Dynamic Maps load per `new google.maps.Map()` (10,000 free, $7/1,000); pans and zooms are free; Advanced Markers need a `mapId` (`DEMO_MAP_ID` for tests); `@googlemaps/markerclusterer@2.6.2` accepts `AdvancedMarkerElement`; `@types/google.maps@3.66`.
- **Pricing model** since 1 Mar 2025: per-SKU free monthly events (Essentials 10,000 / Pro 5,000 / Enterprise 1,000; some Essentials unlimited), reset on the 1st at midnight Pacific.

## Appendix B — fallback for D5: server-proxied Autocomplete (New) with session tokens

Only if L3 shows the UI Kit element unusable (styling, keyboard, or a broken `gmp-select`), and only with Radu's acceptance that predictions listed above the map are Google content next to a map (EEA SST B.15.1, permitted use (1)):

- `POST /api/admin/find/suggest { input: string (2–120 chars), sessionToken: uuid v4 }` (admin, CSRF, `rateLimit("google-suggest:" + ip, 60, 1 min)`, `maxDuration 10`) → `POST /places:autocomplete { input, sessionToken, includedPrimaryTypes: ["(regions)"], languageCode: "en" }` (no mask) → `{ ok, suggestions: [{ placeId, main, secondary, types }] }` (≤ 5, ≤ 120 chars each; transient). Counted as `google_autocomplete` (10,000 free) with its own cap `GOOGLE_AUTOCOMPLETE_MONTHLY_CAP=9000`.
- The client keeps one token per typing session (`crypto.randomUUID()`), debounces 250 ms, renders a `role="listbox"` under the Area field (arrow keys, Enter, Esc, `aria-activedescendant`), and on pick posts `/api/admin/find` with `suggestion: { placeId, sessionToken }`; the server closes the session with the Details **Essentials** call of §4.4 carrying `?sessionToken=` (autocomplete requests beyond the first 12 in the session are then free); the token is discarded after the close. An abandoned session bills per request — within the free tier at our volume. `GoogleAttribution` sits at the bottom of the list.

## Appendix C — decisions log (integrator only)

- 12 Sep 2026 — v1 published on `feat/finder-google` (from `main` `b778ee8`). Defaults: D1 discovery off, D2 derived signals stored, D3 website not copied, D4 Google map when the browser key + Map ID are set, D5 UI Kit autocomplete. Awaiting Radu's billing and keys; the live checklist is the last gate.
