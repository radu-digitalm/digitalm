# Digital M — website

Bilingual (EN/FR) marketing site for Digital M. Next.js 16 (App Router, SSG) +
Tailwind + TypeScript. No CMS, no database — content lives in `src/content/`.

## Configuration / keys

All keys and secrets go in **`.env.local`** (gitignored). Copy `.env.example` if
you need a fresh template. After editing server-side values, restart the app.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Base URL (staging vs production). Build-time — rebuild after change. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` | Contact-form email sending. Blank `SMTP_HOST` → form falls back to a prefilled mailto link. |
| `CONTACT_FORM_TO` / `CONTACT_FORM_FROM` | Recipient / sender for contact-form mail. |
| `ANTHROPIC_API_KEY` / `CHAT_MODEL` | On-site AI assistant. |

## Develop

```bash
npm install
npm run dev          # http://localhost:3000
npm run verify       # typecheck + production build
```

## Deploy (staging — d3v.digitalm.eu)

The host serves staging via nginx → `127.0.0.1:3001`. To ship a new build:

```bash
npm run build
# stop the current :3001 process by PID, then:
setsid nohup node_modules/.bin/next start -H 127.0.0.1 -p 3001 \
  > staging.log 2>&1 < /dev/null &
```

Do **not** touch the live `digitalm.eu` placeholder until production cutover is
approved.

## Structure

- `src/content/{en,fr}.ts` — all copy (typed against `types.ts`).
- `src/app/[locale]/` — pages (home, services, work, contact, legal).
- `src/app/api/contact/route.ts` — SMTP contact handler.
- `src/components/` — shared UI (header, footer, signature, consent, chat).
- `public/media/` — brand imagery (webp, optimised from imagen PNGs).
- `src/app/(tools)/` — second root layout (noindex, no analytics/consent/chat): `/admin/*` (CRM) and `/r/[token]` (prospect reports).
- `src/lib/crm/` — CRM foundation (schema, auth, jobs, predicates); `src/lib/{inbox,discover,prospects,audit,report,drafts}/` — the modules.

## Admin CRM (`/admin`)

Contract: `docs/leadgen-build-spec.md` (plan `docs/leadgen-crm-plan.md`, decisions `docs/leadgen-decisions.md`). The CRM tables live in the same SQLite file as the enquiries (`ENQUIRIES_DB_PATH`; staging `/home/hermes/data/enquiries-staging.db`) and are created by `applyCrmSchema()` at the end of `enquiriesDb()` — additive, idempotent.

**Login.** One shared password, scrypt-hashed, signed HttpOnly cookie, Turnstile, per-IP and global rate limits. Hash it on the box (stdin, never argv) and paste the result into `.env.local`:

```bash
node scripts/crm-hash-password.js      # prompts on stdin → ADMIN_PASSWORD_HASH=scrypt$16384$8$1$…
openssl rand -hex 32                   # → ADMIN_SESSION_SECRET (rotating it logs everyone out)
```

**Env keys.** See the `# @@crm:*` blocks at the end of `.env.example`: `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET`, `ADMIN_SESSION_VERSION`, `CRM_JOB_RUNNER`; finder hosts and keys (`OVERPASS_URL`, `NOMINATIM_URL`, `FR_REGISTER_URL`, `COMPANIES_HOUSE_KEY`, `GOOGLE_PLACES*`, `READY_SCORE_MAX`); audit (`AUDIT_DAILY_CAP`, `PAGESPEED_API_KEY`, `PAGESPEED_URL`, `CRAWLER_USER_AGENT`); report (`OPENAI_MODEL_DRAFTS`, `REPORT_TTL_DAYS`); outreach (`OUTREACH_FROM_NAME`, `OUTREACH_DAILY_CAP`, `OUTREACH_COUNTRY_ALLOW`); `LEAD_TELEGRAM=off` silences every Telegram ping. Prod `.env.local` needs the new keys before the cutover (spec §13).

**Tests and checks.**

```bash
npm test                                   # node:test, pure modules only (no DB, no next/*)
NODE_OPTIONS=--max-old-space-size=1536 npx tsc --noEmit   # memory-capped on this box
```

**Job runner.** `src/instrumentation.ts` starts the in-process audit runner (`src/lib/crm/jobs.ts`, one job at a time, 6-minute abort) in the Node runtime. Set `CRM_JOB_RUNNER=off` for one-off scripts or a second process that must not pick up jobs. The crawler only ever fetches the prospect's own site (SSRF-vetted, 2 MB / 8 s, robots.txt honoured).

**Scripts (Node, prod `better-sqlite3`, read the prod `.env.local` for `ENQUIRIES_DB_PATH` unless `--db`):**

- `scripts/digitalm-digest.js [--db PATH] [--telegram]` — read-only Today digest. Scheduling approved: 08:00 via hermes cron (`~/.hermes/scripts/run-digitalm-digest.sh`).
- `scripts/digitalm-purge.js [--db PATH] [--apply] [--backup-dir DIR]` — retention purge (spec §9). Dry run by default (DB opened read-only); `--apply` takes a `VACUUM INTO` backup first (`/home/hermes/data/backups`, 8 kept) and writes `settings.purge_last_run_at`, which Today and the digest show in red when older than 2 days. **Scheduling is still an approval item** (daily 04:00, replacing hermes job `518a81934ab4`) — until it runs, the 30-day notice rule is advisory only.

Both scripts are mirrored to `/home/hermes/workspace/scripts/` (the path the schedulers use); keep the copies identical.

The outreach module (per-country contact rules, opt-out registry, legal footers, refusal engine) is merged; see `docs/leadgen-build-spec.md` §9.

**Staging smoke (spec §13).** After `npm run build` and `systemctl --user restart digitalm-staging`: `/fr`, `/en`, `/fr/diagnostic` still 200; `/admin/login` 200; `curl -H 'RSC: 1' :3001/admin/leads` without a cookie → 307, never data; log in; every admin page 200; Add by URL → audit done → draft; `/r/x` → branded 404 with `X-Robots-Tag: noindex` and `Cache-Control: no-store`; `/api/admin/jobs` → 401 without a cookie; digest and purge scripts run on the staging DB with `--db`.

**Finder map (Leaflet).** The finder is map-first. `leaflet@1.9.4` is the one runtime dependency added on top of the spec §0 stack (run `npm ci` in prod when the lock changes). `src/components/admin/FindMap.tsx` imports `leaflet/dist/leaflet.css` locally (no CDN, no new CSP entry — its images land in `/_next/static/media/`), draws OpenStreetMap tiles from `https://tile.openstreetmap.org` (already covered by the CSP `img-src https:`) and always shows the attribution "© OpenStreetMap contributors" linking to openstreetmap.org/copyright. OSM tile usage policy: tiles are requested only for the visible viewport once the map is on screen — never prefetched, never cached server-side. Search areas are polygons (the real administrative outline, dashed on the map), not bounding rectangles, so "Ariège" no longer pulls in Andorra or a strip of Spain; every business with coordinates gets a pin, a click on a pin or a row opens the business card, and saving happens from the card.

<!-- @@finder-ux:backend -->
**Finder (map-first, `docs/finder-ux-spec.md`).** Any area OpenStreetMap knows — town, French postcode, department (name or code), region, country — resolves to a polygon (Nominatim search + lookup, geo.gouv contours for postcodes; 30 d cache) and an Overpass *area* selector, so nothing outside the outline is ever requested. `POST /api/admin/find` resolves, estimates (one cached `out count`), gates areas over `FIND_MAX_ROWS` (default 2,000; the answer lists the administrative children as one-click sub-searches, `confirmCap: true` runs the nearest units to the centre) and starts the search in the background of the `next start` process (`src/lib/discover/runner.ts`, one search at a time, heartbeat every 15 s, state in `searches.status/progress/plan` + the 24 h `search:{id}` cache). Units (whole area, admin-level 6/4/8 children, or 0.25° tiles clipped by the area) run ≥ 1 s apart on two Overpass servers (`OVERPASS_URL`, `OVERPASS_FALLBACK_URL`: a busy answer marks that server busy and the retry goes to the other one at once; only when both are busy does a unit wait 15 s, then 30 s, before failing) with a 24 h per-unit cache, so `POST /api/admin/find/continue` after a restart or a stop costs only the missing units. A country is gated without an Overpass count and a region's count gets 15 s; the gate lists real administrative children by name (geo.gouv for France), never grid cells. The French register is read by postcode / department / radius (≤ 40 pages each) and every row with coordinates is point-in-polygon tested against the fine outline. `GET /api/admin/find?id=N&after=K&v=V` polls; `cancel`, `dismiss` ("Not this one", kept server-side), `recent` and `save` (returns `prospectIds`, refuses hidden keys with 409, looks up the exact commune for approximate towns) complete the API; `POST /api/admin/prospects/backfill-towns` names prospects saved without a town. Env: `FIND_MAX_ROWS`, `FIND_MAX_UNITS`, `FIND_MAX_MS`. Pure modules with `node:test`: `polygon`, `areaQuery`, `plan`, `progress` (reducer), `notes`, `townFill`, `geocodeRules`, `frRegisterMap` (register scopes), `communeRules`. Fixtures under `src/lib/discover/fixtures/` (`search-ariege.sample.json` carries a running and a finished `SearchResultV2`).

<!-- @@finder-ux:frontend -->
**Finder page (`/admin/find`, frontend).** `FindWorkspace.tsx` owns one search end to end: the search bar (`FindForm`, `AreaInput`, `TradePicker`), a Leaflet 1.9.4 map over OpenStreetMap tiles (`FindMap`: dashed area outline — a bounding box is labelled *approximate outline* —, canvas pins in the legend's vocabulary, grid clustering over 200 visible pins, unit dots for split areas), the list (`FindList`: chips, filter, sort with sticky town headers, *List follows the map*, pages of 200, bulk save in batches of 300), the honest progress strip (`FindProgress`: units done / expected, retry countdown, Stop → Continue, the over-cap gate with the children as one-click sub-searches, the ambiguity chooser) and the business card (`BusinessCard`: every field, source links, *Save & audit*, *Not this one* with a 6 s Undo). Polling is `GET /api/admin/find?id&after&v` every 2 s (4 s after a minute) with a reset whenever `rowsVersion` changes; past searches load from `/recent`. Every visible sentence lives in `wording.ts` (tested for forbidden tokens — no "OSM", "FR reg.", "partial", "diffusion", "caveat"); `format.ts` and `mapCluster.ts` are pure and tested. Layouts: two panes from 1024 px, map over a self-scrolling list on tablets, map + bottom sheet on phones. The readability pass (15 px base, 16 from xl; words instead of codes in badges and panels; whole-row clicks; `KeyValue` hides empty values) covers `/admin/prospects`, `/admin/prospects/[id]` (header, contact strip, `MiniMap`, *Found by the search …* line) and Today. Acceptance: `ADMIN_PASSWORD=… NODE_PATH=<playwright node_modules> node scripts/e2e/finder.cjs` against staging (A12–A21 of the spec).
