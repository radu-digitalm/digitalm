# Finder — Google: live checklist (what is left once billing is on)

Status 12 Sep 2026: `feat/finder-google` is merged into `main` (tests 327/327, `tsc` clean). No key exists yet, so every Google call is a no-op today and the finder is exactly the Leaflet/OpenStreetMap one. This page lists **the console steps Radu does**, **the env lines to add**, and **the live acceptance run** the integrator does on staging once the keys exist. Contract: `docs/finder-google-spec.md` (§3 terms as code, §6 env, §7 security, §8.3 live checklist, §9 acceptance).

Nothing here touches `digitalm-prod/` until Part D; staging first, as always.

---

## Part A — Cloud Console (Radu, ~20 minutes)

One Google Cloud project, billing attached (the free monthly allowances per SKU only apply with billing on). Do the steps in this order.

**A1 — Enable the APIs.** *APIs & Services → Library*, enable exactly these three:

1. **Places API (New)** — the server-side searches, suggestion look-ups and listing checks. Do **not** enable the legacy *Places API*; the client sends `X-Goog-FieldMask` requests to `places.googleapis.com/v1` only.
2. **Maps JavaScript API** — the finder map in the browser.
3. **Places UI Kit** — a separate API in the library (`placewidgets.googleapis.com`, direct link: https://console.cloud.google.com/apis/library/placewidgets.googleapis.com). The Area-box suggestions and the listing panels are its elements (`gmp-basic-place-autocomplete`, `gmp-place-details`, `gmp-place-details-compact`), billed as *Places UI Kit* SKUs (10,000 free per month each for Query and Autocomplete Per Session).

**A2 — Server key.** *APIs & Services → Credentials → Create credentials → API key*, then edit it:

- Name: `digitalm-places-server`.
- Application restrictions: **IP addresses** → the VPS egress address `92.222.91.167` (confirm from the box: `curl -s https://api.ipify.org`).
- API restrictions: **Restrict key** → *Places API (New)* only.
- This is `GOOGLE_PLACES_KEY`. It lives in `.env.local` / prod `.env` only — never in a browser, a log, git or Telegram.

**A3 — Browser key.** Same path, a second key:

- Name: `digitalm-maps-browser`.
- Application restrictions: **Websites** → add `https://digitalm.eu/*` and `https://d3v.digitalm.eu/*` (nothing else — no `http://`, no `127.0.0.1`; an unlisted origin must fall back to Leaflet, that is test L1).
- API restrictions: **Restrict key** → *Maps JavaScript API* and *Places UI Kit* (not Places API (New): the browser never calls the web service).
- This is `NEXT_PUBLIC_GOOGLE_MAPS_KEY`. It is public by nature; the referrer list plus the per-day quotas of A5 are what bounds it.

**A4 — Map ID** (Advanced Markers need one). *Google Maps Platform → Map Management → Create Map ID*:

- Name: `digitalm-finder`; Map type: **JavaScript**; rendering: **Vector**; leave **Tilt** and **Rotation** unticked (a flat 2D map — the finder never tilts). No custom style is needed; the default style is fine.
- Copy the id (a short string like `1a2b3c4d5e6f7a8b`) → `NEXT_PUBLIC_GOOGLE_MAP_ID`. Google documents `DEMO_MAP_ID` for testing; it is acceptable on staging until the real id exists, not in prod.

**A5 — Per-day quotas and the budget alert.** *APIs & Services → Quotas* (these are the only enforceable hard stop for the browser key — a referrer can be spoofed by a non-browser client; the server pools are additionally capped in our own `api_usage`):

| API | Quota | Set to |
| --- | --- | --- |
| Maps JavaScript API | map loads per day | **500** |
| Places UI Kit | requests per day | **1,000** |
| Places API (New) | requests per day | **400** |

Then *Billing → Budgets & alerts*: one budget of **€5 / month** on this project, e-mail alert at 50 % / 90 % / 100 % (secondary signal only — it fires after spend).

**A6 — Hand-over.** Paste the two keys and the map id straight into `/home/hermes/workspace/digitalm/.env.local` (staging) yourself, or hand them to the integrator through a private channel — not through the chat transcript, a commit or Telegram. The prod file (`digitalm-prod/.env`) waits for Part D.

---

## Part B — Env lines and the staging build

`.env.local` of `digitalm/` (staging). The full block with comments is in `.env.example` under `# ---- Google`; only these lines change from their defaults:

```bash
GOOGLE_PLACES=on
GOOGLE_PLACES_DISCOVERY=off          # switch on after L6 passes (decision D1 of the spec)
GOOGLE_PLACES_KEY=<server key from A2>
NEXT_PUBLIC_GOOGLE_MAPS_KEY=<browser key from A3>
NEXT_PUBLIC_GOOGLE_MAP_ID=<map id from A4>   # DEMO_MAP_ID until the real one exists (staging only)
```

Leave the caps at their `.env.example` defaults (`GOOGLE_PLACES_MONTHLY_CAP=900`, `GOOGLE_SEARCH_MONTHLY_CAP=4500`, `GOOGLE_DETAILS_MONTHLY_CAP=4500`, `GOOGLE_SEARCH_MAX_REQUESTS=30`, `GOOGLE_CHECK_DAILY_CAP=30`) except while running L8.

The `NEXT_PUBLIC_*` values are **baked in at build time**, so after editing the file:

```bash
npm --prefix /home/hermes/workspace/digitalm ci          # the merge adds @googlemaps/markerclusterer (+ @types/google.maps)
npm --prefix /home/hermes/workspace/digitalm run build    # one next build at a time on this box
systemctl --user restart digitalm-staging
curl -s --retry 60 --retry-all-errors --retry-connrefused -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/fr
```

Sanity before the tests: the admin CSP now allows Google (it is emitted only when the browser key was set at build time):

```bash
curl -sI https://d3v.digitalm.eu/admin/login | grep -i '^content-security-policy' | grep -c 'maps.googleapis.com'   # 1
curl -sI https://d3v.digitalm.eu/fr | grep -i '^content-security-policy' | grep -c 'maps.googleapis.com'            # 0 — the public site is untouched
```

---

## Part C — Live acceptance on staging (integrator)

Spec §8.3 items L0–L10 and §9 items G1–G10, with the commands. Run on `https://d3v.digitalm.eu` with the staging DB `/home/hermes/data/enquiries-staging.db`. Every item prints its expected result; stop and fix at the first miss.

**Set-up for the API items.** A staging cookie and the CSRF token (the password goes through a file, never argv; staging's Turnstile test keys accept `"e2e"`):

```bash
BASE=https://d3v.digitalm.eu
S=$SCRATCHPAD   # or any 0700 directory
printf '{"password":"%s","turnstile":"e2e","website":""}' "$(cat $S/admin-password)" > $S/login.json && chmod 600 $S/login.json
curl -s -c $S/jar -H 'content-type: application/json' -H "origin: $BASE" -d @$S/login.json $BASE/api/admin/login   # {"ok":true}
CSRF=$(curl -s -b $S/jar $BASE/admin | grep -o 'name="dm-csrf" content="[^"]*"' | cut -d'"' -f4)
post() { curl -s -b $S/jar -H "origin: $BASE" -H "x-dm-csrf: $CSRF" -H 'content-type: application/json' -d "$2" "$BASE$1"; }
get()  { curl -s -b $S/jar "$BASE$1"; }
rm -f $S/login.json
```

SQL on the staging DB (there is no `sqlite3` binary on the box — use the repo's `better-sqlite3`, read-only):

```bash
sql() { node -e 'const D=require("/home/hermes/workspace/digitalm/node_modules/better-sqlite3");const db=new D("/home/hermes/data/enquiries-staging.db",{readonly:true});console.log(JSON.stringify(db.prepare(process.argv[1]).all()))' "$1"; }
```

The e2e run (Playwright, headless Chromium already in `~/.cache/ms-playwright`):

```bash
ADMIN_PASSWORD="$(cat $S/admin-password)" NODE_PATH=/home/hermes/.npm/_npx/fd3bca3c548369c0/node_modules \
  ONLY=A0,G0,G1,G8,G9 node /home/hermes/workspace/digitalm/scripts/e2e/finder.cjs
```

### L0 — Records (gate for prod, not for staging)

- [ ] The privacy notice (FR/EN), the Art. 30 register rows and the LIA re-assessment line (`docs/leadgen-lia.md`, "Google Places switched on (date)… Signed: Radu") are dated and signed, committed and deployed to prod **before** `GOOGLE_PLACES=on` goes into prod `.env`. Staging may run L1–L10 before that.

### L1 — Keys and quotas

- [ ] Server key: a Text Search with the Pro mask answers 200 from the box (the key goes through a 600-perm header file — never on a command line, which other users of the box can read in `ps`):
  ```bash
  printf 'X-Goog-Api-Key: %s\n' "$(grep '^GOOGLE_PLACES_KEY=' /home/hermes/workspace/digitalm/.env.local | cut -d= -f2-)" > $S/goog-h && chmod 600 $S/goog-h
  curl -s -o /dev/null -w '%{http_code}\n' -X POST https://places.googleapis.com/v1/places:searchText -H @$S/goog-h \
    -H 'X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress,places.location,places.types,places.businessStatus' \
    -H 'content-type: application/json' -d '{"textQuery":"restaurant Foix","pageSize":1,"languageCode":"en","regionCode":"FR"}'   # 200
  rm -f $S/goog-h
  ```
  The same call from any other machine → 403 (IP restriction). A mask containing `websiteUri` is refused by our client before any socket (`GoogleError("mask_tier")`) — covered by `googleRequests.test.ts`, no live call needed.
- [ ] Browser key: `https://d3v.digitalm.eu/admin/find` shows the Google map; `http://127.0.0.1:3001/admin/find` (an unlisted origin) shows the Leaflet map under one line of explanation — the fallback of spec §5.2.
- [ ] *APIs & Services → Quotas* shows the three per-day caps of A5; the €5 budget exists.

### L2 — SKUs (after the searches and audits of L3–L7)

- [ ] *APIs & Services → Metrics*, filtered to the last hour, shows **only**: Text Search Pro (≤ 30 + 1 + 1), Place Details Enterprise (1 per audited prospect), Place Details Essentials (1 per suggestion pick), Dynamic Maps (page opens), Places UI Kit Query (panels opened), Places UI Kit Autocomplete Per Session (1 per pick). **No** Place Details Pro, no Enterprise + Atmosphere, no Photos.

### L3 — Area suggestions

- [ ] Typing *arie* in the Area box lists Google's suggestions; Enter on *Ariège, France* starts a department search with no chooser and the box then reads *Ariège, France*.
- [ ] In the browser console, `gmp-select` was observed with `place.id` present (log once, then remove the log line); `input` events come from the element (otherwise the plain Field fallback is in force — note it in Appendix C).
- [ ] API (G2): `post /api/admin/find '{"area":"arie","category":"restaurant","suggestion":{"placeId":"<the Ariège id>"}}'` → `202`, `area.kind = "department"`, `area.osmRelationId = 7439`, `queryArea` contains *Ariège*; `api_usage.google_details_other` **+1**. `"area":""` with the same id → `202` too. A malformed `placeId` → `400 bad_suggestion`. With `GOOGLE_DETAILS_MONTHLY_CAP=0` (restart) and `"area":""` → `400 suggestion_unresolved`; with `"area":"arie"` → resolves from the text as today.

### L4 — Map

- [ ] Ariège / restaurant: Google map with the dashed outline, ≥ 250 pins, clusters at zoom 9, hover and click sync between list and map; `window.__dmFindPins.total ≥ 250`; `© OpenStreetMap contributors` visible on the map in the phone layout.
- [ ] A second search from the same page: `window.__dmGmapLoads === 1` (one Map instance per page open — one Dynamic Maps load).

### L5 — Nothing stored

- [ ] After L3–L4 and L7:
  ```bash
  sql "SELECT COUNT(*) n FROM api_cache WHERE provider LIKE 'google%' OR payload LIKE '%displayName%' OR payload LIKE '%formattedAddress%' OR payload LIKE '%websiteUri%'"   # [{"n":0}]
  sql "SELECT provider, day, count FROM api_usage WHERE provider LIKE 'google%' ORDER BY day DESC"   # google_search / google_details_enterprise / google_details_other on the Pacific day
  sql "SELECT COUNT(*) n FROM prospects WHERE google_place_id IS NOT NULL AND google_place_id NOT GLOB '[A-Za-z0-9_-]*'"   # [{"n":0}]
  grep -c -i -E 'x-goog-api-key|AIza[0-9A-Za-z_-]{30}' /home/hermes/workspace/digitalm/staging.log   # 0 — no key in the log
  ```
  and by eye: no place name from Google in `staging.log`.

### L6 — Discovery (only with `GOOGLE_PLACES_DISCOVERY=on`, restart)

- [ ] The finished Ariège search has `progress.google.state = "done"`, `progress.google.requests ≤ 30`, `googlePins.length > 0`, every `placeId` matching `/^[A-Za-z0-9_-]{10,72}$/`, **no pin with a `name` key**, ≥ 1 row with `googlePlaceId` and `onGoogle: true`, note `google_matched` (G3). No blue pin outside the department by eye — a blue pin in Andorra is a bug in `googleInside`. Matched ≥ 60 % of the OpenStreetMap restaurant rows (plausibility).
- [ ] Dismiss (G5): `post /api/admin/find/dismiss '{"searchId":<id>,"key":"google:<placeId of the search>"}'` → `200`, the pin reads `hidden: true` on the next `get`; `"undo":true` reverses it; `google:bad id` → `400`; a well-formed id not in the search → `404`.

### L7 — Audit and the prospect page

- [ ] Save a Foix row from the finder (with or without a website), let its audit run: `get /api/admin/prospects/<id>` shows `googlePlaceId`, `googleListing = "found"`, `googleMatch = "auto"`, `googleCheckedAt`; `audits.checks.google_listing.measured = true`, `points` in 0–10, `details` keys ⊆ `{listing, operational, websiteOnListing, hours, reviews, photos, fetchedAt, checkedAt, reason, attributions}` (G6).
- [ ] A saved row with coordinates that matches nothing → `googleListing = "unverified"`, `details.reason = "no_match"`, `measured = false`. A prospect added by URL alone (no coordinates, no postcode) → no `googleCheckedAt` and no `google_search` increment.
- [ ] `post /api/admin/prospects/<id>/google '{"action":"reject"}'` → `not_found`, `googleMatch = "manual"`, `no-gbp` in the next audit's flags, columns left untouched by that audit.
- [ ] The report line reads *Your Google listing is in place and complete* (or the partial sentence) and nothing else about the listing; the prospect page's Google section shows the status in words, *Data: …* when Google named a provider, and the full panel with the website visible; the mini map disappears while the section is open; `AuditBlock` shows status words only (G9 via e2e).

### L8 — Caps (set, restart, test, restore)

- [ ] `GOOGLE_PLACES_MONTHLY_CAP=0` → **Check again** on a prospect → `429 google_monthly_cap` with `pool = "google_details_enterprise"`, no `api_usage` increment, the sentence in the UI (G7).
- [ ] `GOOGLE_SEARCH_MONTHLY_CAP=0` → a search finishes `done` with note `google_allowance`, `progress.google.state = "failed"`, `error = "allowance"`.
- [ ] `GOOGLE_SEARCH_MONTHLY_CAP=510` with ≥ 10 searches already counted this month → discovery stops (note #21) while **Match manually** still works.
- [ ] Restore the three values, restart, re-run one search to confirm.

### L9 — Words and e2e

- [ ] The e2e command above: `G0` reports the Google map, `G1` (off means unchanged — run it once more with `GOOGLE_PLACES=off` after L10), `G8` and `G9` green; no forbidden token on any admin page (*claimed*, *verified*, *GMB*, *Google My Business*, *OSM*, *FR reg.*, *partial*, *caveat*).

### L10 — Billing

- [ ] The next day, *Billing → Reports* filtered to the project shows **€0.00** for the test day (everything inside the free tier).

### G10 — Build and repo gates (already done at merge time, re-check before prod)

- [ ] `npm test` green, `tsc` clean, `npm run build` once on staging; `git log` shows no `.env*` file; `package.json` diff = `@googlemaps/markerclusterer` + dev `@types/google.maps`; `public/brand/google-maps-logo.svg` and `-outlined.svg` present.

---

---

## Part C — run of 2026-09-12 on staging (integrator)

Staging (`d3v.digitalm.eu`) runs Google mode since 2026-09-12 19:45 UTC: `GOOGLE_PLACES=on`, `GOOGLE_PLACES_DISCOVERY=off`, both keys, Map ID (raster). Prod is untouched (`GOOGLE_PLACES=off`).

**Console (Part A, done by the integrator in Radu's browser session — no billing changes):**
- A3: browser key `digitalm Maps browser` restricted to *Maps JavaScript API + Places UI Kit*; referrers `https://digitalm.eu/*`, `https://d3v.digitalm.eu/*`. Server key unchanged (Places API (New), IP `92.222.91.167`).
- A5 quotas set: Places API (New) `SearchTextRequest per day` 75,000 → **400** and `GetPlaceRequest per day` 125,000 → **400** (the console has per-method quotas, not one "requests per day"); Maps JavaScript API `Map loads per day` unlimited → **500**; Places UI Kit `Session Requests per day` unlimited → **1,000** and `Advanced Query Requests per day` 8,000 → **1,000**.
- A5 budget alert (€5/month): **not created** — it is a billing-account setting, Radu's to make (*Billing → Budgets & alerts*, e-mail at 50/90/100 %).
- Still open from the key round: the project's unrestricted default "Maps Platform API Key" — Radu decides whether to delete it.

**Acceptance:**

| Item | Result |
| --- | --- |
| L1 keys | Server key Text Search from the box → 200. Browser key: Google map on `d3v.digitalm.eu`; from `http://127.0.0.1:3001` Google refuses the referrer and the page shows Leaflet under "The Google map could not be loaded — showing OpenStreetMap instead." Quotas as above. |
| L3 suggestions | *arie* → Google suggestions; Enter on *Ariège, France* → `gmp-select` with `place.id`, the box reads *Ariège, France*, the search starts with `suggestion.placeId`, no chooser; `area.kind = department`, `osmRelationId = 7439`; `api_usage.google_details_other` +1 per pick. `"area":""` + id → 202; malformed id → 400 `bad_suggestion`. (e2e step **G2** now covers this.) |
| L4 map | Ariège / restaurant: 559 pins, 35 cluster discs at zoom 9, one Map instance across a second search (`__dmGmapLoads === 1`), © OpenStreetMap contributors on the phone layout. |
| L5 nothing stored | `api_cache` Google rows 0; `api_usage` only `google_search` / `google_details_enterprise` / `google_details_other`; no malformed place id; no key or Google place name in `staging.log`. |
| L6 discovery | not run (discovery off — D1). |
| L7 audit | Saved Foix row → `googlePlaceId`, `googleListing = found`, `googleMatch = auto`, `googleCheckedAt`; audit `google_listing` pass 10/10, `measured = true`, details keys ⊆ the allowed set; one `google_search` + one `google_details_enterprise` per audited prospect. `reject` → `not_found` / `manual`, next audit carries `no-gbp` and leaves the columns alone. Report (FR): *Votre fiche Google est en place et complète.* / *Nous n'avons pas trouvé de fiche Google pour votre établissement.* Prospect page: collapsed section "Google listing · Listing found · looks maintained", signals and the Google Maps logo only after opening. |
| L8 caps | `GOOGLE_PLACES_MONTHLY_CAP=0` → **Check again** answers 429 `google_monthly_cap`, pool `google_details_enterprise`, no `api_usage` increment (after the fix below); restored → the check runs again. Search-pool caps (`GOOGLE_SEARCH_MONTHLY_CAP`) not exercised — discovery off. |
| L9 words / e2e | `npm test` green (fail 0). e2e in Google mode: A0, A12–A21, G0, G2, G8, G9 green (G1 is the off-mode step). Full run log in the session scratchpad. |
| L10 billing | to read on 2026-09-13 (*Billing → Reports*, expect €0.00). |
| G10 | `tsc` clean, one build per change, no `.env*` in git. |

**Defects found by the run and fixed (all in `main`):**
1. Find page crashed in Google mode ("This page couldn't load"): `MarkerClusterer.render()` before the overlay's `onAdd` (`fromLatLngToDivPixel` of undefined) and the viewport algorithm with zero markers before its first `load()` (`'range'` of undefined). Guarded draw + seeded index in `GoogleFindMap.tsx`.
2. Area box: the UI Kit element was unmounted after the first keystroke (value non-empty while `editing` was false); typing *arie* left *a* in a plain field. Fixed in `GoogleAreaInput.tsx`; after a plain-text search the box now shows the submitted text.
3. Listing check spent a Pro search before finding the Enterprise pool capped — now probed first (`googleAllowance`).
4. Phone layout: long audit-flag badges overflowed 390 px (`Badge` wraps now); the UI Kit element's 406 px intrinsic width widened the find form (`contain: inline-size` + `min-w-0` grid cells).
5. e2e: G0 waits for the dynamic map; A12/A13/A15/A17/A18/A19/G9 made map-mode aware (Google or Leaflet), the portalled admin drawer, saved rows, visible text only.

**Before prod (Part D) — Radu:** L0 records (privacy notice FR/EN, Art. 30 rows, LIA line, signed and dated); the EEA permitted-use decision for discovery (recommendation: keep `GOOGLE_PLACES_DISCOVERY=off`; Google is used for suggestions, the map and the listing check on saved prospects); the €5 budget alert; the five env lines in `digitalm-prod/.env.local`; then the promote + restart of Part D.

## Part D — Going live on prod (after L0–L10 are green)

1. L0 committed and deployed (records first).
2. Radu adds the same five lines to `/home/hermes/workspace/digitalm-prod/.env` (real Map ID, not `DEMO_MAP_ID`; `GOOGLE_PLACES_DISCOVERY` per decision D1 — off until L6 has been judged worth the search-pool spend).
3. Promote `src/`, `public/`, `package.json`, `package-lock.json`, `next.config.mjs` → `digitalm-prod/`; `npm --prefix /home/hermes/workspace/digitalm-prod ci`; `npm --prefix /home/hermes/workspace/digitalm-prod run build` (the browser key is baked in here).
4. **Radu restarts**: `sudo systemctl restart digitalm.service` (see `CLAUDE.md` — never a bare kill of the unit's PID).
5. Smoke: `/fr`, `/en` 200 with the unchanged public CSP; `/admin/find` shows the Google map; one audit on a prod prospect measures `google_listing`; Today shows the Google usage card.
6. A week later: *Metrics* still shows only the SKUs of L2 and the billing report reads €0.00.

## Part E — What is deliberately not there

- No *claimed* / *verified* status — Google's API has no such field; the audit says *listing found · looks maintained* from business status, website on the listing, hours, review count and photo count.
- No photos, reviews or opening-hours text are fetched or stored; no `websiteUri` is ever fetched by us (a website typed by Radu goes through the normal SSRF rules).
- Discovery is off by default (D1); everything else in Google mode works without it.
- Nothing from Google on the Leaflet map, ever: with the browser key blank the finder stays on Leaflet and receives no Google pins.
