# Digital M lead-gen CRM — implementation contract (v2, 10 Sep 2026, post-review)

Build contract for `/home/hermes/workspace/digitalm/docs/leadgen-crm-plan.md` plus Radu's decisions (worldwide discovery, FR/GB/US sending rules, one shared password, both blocks in one run), revised after the security/code-fit and legal/product reviews. Six engineers work in parallel from it on branch `feat/admin-crm`. This document wins over the plan, the decisions doc and the v1 draft on any difference.

## 0. Ground rules

- Repo `/home/hermes/workspace/digitalm` (staging :3001, DB `/home/hermes/data/enquiries-staging.db`); prod = rsync of `src/`, `public/`, `scripts/`, `next.config.mjs`, `package.json`, `package-lock.json` into `digitalm-prod/` (`npm ci` there when the lock changed), build, `kill` the `digitalm.service` main PID. Never touch the prod tree from a feature branch. Read `/home/hermes/workspace/CLAUDE.md` first.
- Stack as found: Next 16.2.6 App Router, React 19, TS 5.9 strict, Tailwind 3.4 (`content: ["./src/**/*.{ts,tsx,mdx}"]`), `better-sqlite3` 12 (WAL), `nodemailer` 9, `ai` 6 + `@ai-sdk/openai` + `zod` 4, Node 22.22 (type stripping on by default; `undici` is NOT installed and is not added). No new runtime dependency. No new port, service or unit.
- Next 16 facts every file respects: `cookies()`/`headers()` are async; page and route `params` are `Promise<{…}>` (`const { id } = await params`); respond with `NextResponse.json` like the existing routes. Admin pages: `export const dynamic = "force-dynamic"; export const runtime = "nodejs"`. DB-touching API routes: `runtime = "nodejs"`.
- Migrations additive only (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` exactly as `src/lib/enquiries.ts` does). No top-level DB access anywhere in `src/lib/crm/**` (enquiries.ts ↔ crm/refs.ts is a cycle; `newReference(prefix = "DM", db = enquiriesDb())` is called inside functions only).
- Tests: `node:test`. `package.json` gets `"test": "node --test 'src/**/*.test.ts'"`, `tsconfig.json` gets `allowImportingTsExtensions: true`. A `*.test.ts` sits beside its module, imports by relative path with the `.ts` extension, uses `import type` for every type, and only tests modules that import nothing from `next/*` or the DB (`classify.ts`, `auth.ts` sign/verify, `authEdge.ts`, `score.ts`, `ssrf.ts`, `rules.ts`, `refusals.ts`, `legal.ts`, `dedupe.ts`, `templates.ts`). No enums, namespaces or parameter properties in those modules (strip-only mode). Verified on this box: glob + type stripping + `import type` run green.
- Prospect-facing strings exist in FR and EN; admin UI is English only. Never log secrets, email bodies or addresses; Telegram and Umami get references only.
- No scraping of Google Maps, Pages Jaunes, LinkedIn, Facebook. The only crawler is ours, on the prospect's site, under §7.1.
- One PR per module; a module never edits another module's file; shared files only through §1.2. Sort/filter identifiers come from a fixed `Record<string,string>` allowlist, values via `?`, `LIKE` terms escaped with `ESCAPE '\'`.

## 1. Module map and ownership

| Key | Scope | Days |
|---|---|---|
| foundation | schema, types, refs, auth (Node + edge), `/admin` shell, middleware (edge auth + public rate limits), robots/headers, job runner, api cache/usage, http, classify, UI primitives, stubs, tests setup | 3.5 |
| inbox | leads/activities, hooks in the 5 routes, backfill, Today, `/admin/leads`, `/admin/leads/[id]`, `ensureLeadForProspect`, digest script | 3.0 |
| finder | geocode, Overpass, FR register, Companies House, Google stub, dedupe, categories + custom trade, `/admin/find`, `/admin/prospects`, `/admin/prospects/[id]`, Add by URL, register re-check, wipe/recollect | 4.0 |
| audit | SSRF-safe crawler (node:http/https), ten checks, PageSpeed, score, job, `AuditBlock` + its GET | 3.5 |
| report | `/r/[token]` FR/EN, print CSS, view logging, drafts + templates + follow-up, `DraftPanel` + its GET | 2.5 |
| outreach | rules, refusals, legal blocks, send/manual-send, `/o/[token]`, `/api/o`, opt-outs, calls, `SendPanel`/`CallPanel` + their GETs, purge script, privacy/mentions text, LIA + Art. 30 docs | 3.5 |

### 1.1 Exclusive files

**foundation** creates `src/lib/crm/{schema,types,db,refs,classify,auth,authEdge,jobs,jobHandlers,apiUsage,apiCache,http,nav}.ts` (+ `classify.test.ts`, `auth.test.ts`, `authEdge.test.ts`), `src/instrumentation.ts`, `src/app/(tools)/layout.tsx`, `src/app/(tools)/not-found.tsx`, `src/app/(tools)/admin/(gated)/layout.tsx` (shell + `<meta name="dm-csrf">` only — NOT the gate), `src/app/(tools)/admin/login/page.tsx`, `src/components/admin/LoginForm.tsx` (client, posts JSON `{ password, turnstile, website, next }` like `ContactForm`), `src/app/api/admin/{login,logout,jobs}/route.ts`, `src/components/admin/{AdminShell,Nav,DataTable,Badge,Button,Field,Select,Textarea,Toast,ConfirmButton,EmptyState,KeyValue,Meter,ExtLink}.tsx`, `src/components/admin/adminFetch.ts`, stubs `src/components/admin/{AuditBlock,DraftPanel,SendPanel,CallPanel}.tsx` (props `{ prospectId: number }`, render `null`; replaced whole by their owners), `scripts/crm-hash-password.js`. One-off edits nobody else touches: `src/lib/enquiries.ts` (call `applyCrmSchema(db)` at the end of `enquiriesDb()`; `newReference()` delegates to `crm/refs.ts`), `src/middleware.ts`, `src/app/robots.ts`, `next.config.mjs`, `package.json`, `tsconfig.json`, `.env.example` (marker lines + its block), `src/content/{en,fr}.ts` (one marker comment inside `legal.privacy.sections` and one inside `legal.notice.sections`), `docs/leadgen-decisions.md` (script name → `digitalm-digest.js`, from-name env).

**inbox** creates `src/lib/inbox/{leads,hooks,today}.ts`, `src/app/(tools)/admin/(gated)/page.tsx`, `.../(gated)/leads/page.tsx`, `.../(gated)/leads/[id]/page.tsx`, `src/app/api/admin/leads/route.ts`, `.../leads/backfill/route.ts`, `.../leads/[id]/route.ts`, `.../leads/[id]/activity/route.ts`, `src/components/admin/{LeadTable,LeadDetail,Timeline,StageSelect,NextActionForm,AddLeadForm,TodayCards}.tsx`, `/home/hermes/workspace/scripts/digitalm-digest.js`. Appends under `// @@crm:inbox` in `src/app/api/{enquiry,contact,book,chat,messenger}/route.ts`.

**finder** creates `src/lib/discover/{categories,geocode,overpass,frRegister,companiesHouse,google,dedupe,index}.ts` (+ `dedupe.test.ts`), `src/lib/prospects/{store,registerCheck}.ts`, `src/app/(tools)/admin/(gated)/find/page.tsx`, `.../(gated)/prospects/page.tsx`, `.../(gated)/prospects/[id]/page.tsx`, `src/app/api/admin/find/route.ts`, `.../find/save/route.ts`, `src/app/api/admin/prospects/route.ts`, `.../prospects/[id]/route.ts`, `.../prospects/audit-next/route.ts`, `.../prospects/[id]/google/route.ts`, `src/components/admin/{FindForm,ResultsTable,ProspectTable,ProspectBadges,RegisterBlock,WebsiteBlock,GoogleBlock,AddByUrl}.tsx`.

**audit** creates `src/lib/audit/{ssrf,crawler,tls,pagespeed,extract,checks,score,job}.ts` (+ `ssrf.test.ts`, `score.test.ts`), `src/content/auditChecks.ts`, `src/components/admin/AuditBlock.tsx`, `src/app/api/admin/prospects/[id]/audit/route.ts` (GET + POST). Appends one line under `// @@jobs:audit`.

**report** creates `src/app/(tools)/r/[token]/page.tsx`, `.../r/[token]/report.css`, `src/components/report/{ReportPage,ScoreMeter,CheckList,Findings,FirstSteps,ReportFooter}.tsx`, `src/content/report.ts` (incl. `BANNED_WORDS`), `src/lib/report/{findings,view}.ts`, `src/lib/drafts/{generate,templates,store}.ts` (+ `templates.test.ts`), `src/components/admin/DraftPanel.tsx`, `src/app/api/admin/prospects/[id]/draft/route.ts` (GET + POST), `src/app/api/admin/drafts/[id]/route.ts`.

**outreach** creates `src/lib/outreach/{rules,refusals,legal,send,optout,calls}.ts` (+ tests), `src/content/outreach.ts`, `src/app/(tools)/o/[token]/{page,not-found}.tsx`, `src/app/api/o/[token]/route.ts`, `src/app/(tools)/admin/(gated)/optouts/page.tsx`, `src/app/api/admin/optouts/route.ts`, `src/app/api/admin/prospects/[id]/{send,call,manual-send}/route.ts` (GET + POST), `src/components/admin/{SendPanel,CallPanel,OptoutTable}.tsx`, `/home/hermes/workspace/scripts/digitalm-purge.js`, `docs/leadgen-lia.md`, `docs/leadgen-registre-art30.md`. Additive edit of `src/lib/mail.ts` under `// @@crm:outreach` (§3.9); fills the privacy and notice markers in `en.ts`/`fr.ts` and may change `legal.privacy.updated` / `legal.notice.updated`.

### 1.2 Append protocol (shared files)

`foundation` inserts fixed marker comments, one blank line between adjacent markers; a module appends only under its own marker, never reorders.

| File | Markers | Filled by |
|---|---|---|
| `src/lib/crm/schema.ts` → `EXTRA_COLUMNS: [table, column, decl][]` | `// @@crm:foundation` … `// @@crm:outreach` (six) | inbox `['enquiries','lead_id','INTEGER']`; outreach `['prospects','tps_checked_at','TEXT']` |
| `src/lib/crm/jobHandlers.ts` → `handlers` | `// @@jobs:audit`, `// @@jobs:outreach`, `// @@jobs:inbox` | audit registers `audit` |
| `.env.example` (end) | `# @@crm:foundation` … `# @@crm:outreach` | each module its own keys |
| `src/content/{en,fr}.ts` last element of `legal.privacy.sections` / `legal.notice.sections` | `// @@crm:outreach privacy section`, `// @@crm:outreach notice section` | outreach |
| `src/app/api/{enquiry,contact,book,chat,messenger}/route.ts` | `// @@crm:inbox` | inbox |
| `src/lib/mail.ts` | `// @@crm:outreach` | outreach |

## 2. Data model

`schema_sql` goes verbatim into `schema.ts` (validated 10 Sep on this box with the project's better-sqlite3: runs twice on a fresh WAL DB, 12 CRM tables + `enquiries`, 28 explicit indexes, partial unique indexes and the claim UPDATE behave). Extra columns: `enquiries.lead_id INTEGER` (inbox), `prospects.tps_checked_at TEXT` (outreach). Writers: `leads` inbox (+finder sets `prospect_id`); `activities` inbox, report (`report_view`), outreach (`email_out`, `call`, `optout`, `send_refused`, `manual_send`), audit (`audit_done`), finder (`recollect`); `prospects` finder (identity, register, geo, locale, fit, google, wipe/recollect), audit (`website_*`, `forbids_extraction`, `latest_*`), outreach (`notice_*`, `last_emailed_at`, `last_called_at`, `opted_out_at`, `tps_checked_at`, overrides); `audits` audit (+report view counters, outreach `report_expires_at`); `jobs` foundation; `drafts` report; `sends`, `optouts` outreach; `searches` finder; `api_usage`, `api_cache`, `settings` foundation helpers (`settings.purge_last_run_at` written by the purge script, `settings.outreach_daily_cap_override`).

References (`crm/refs.ts`): `newReference(prefix: "DM"|"LD"|"PR"|"AU"|"SN" = "DM", db = enquiriesDb())`, same 30-char alphabet, 5 chars, uniqueness checked in the prefix's table. Report and opt-out links use `crypto.randomBytes(32).toString("base64url")` (43 chars), never references.

## 3. TypeScript contracts (`src/lib/crm/types.ts`, published day 0)

```ts
export type LeadKind = "diagnostic"|"booking"|"contact"|"chat"|"messenger"|"outreach"|"manual";
export type LeadStage = "new"|"contacted"|"replied"|"meeting"|"proposal"|"won"|"lost"|"no_response"|"stop";
export interface Lead { id:number; reference:string; kind:LeadKind; stage:LeadStage; name:string|null; company:string|null; email:string|null; emailHash:string|null; phone:string|null; phoneHash:string|null; locale:"fr"|"en"; country:string; sourceLabel:string|null; sourceUtm:string|null; attribution:Attribution|null; enquiryReference:string|null; prospectId:number|null; legalBasis:"request"|"legitimate_interest"; dataSource:"form"|"chat"|"messenger"|"booking"|"register"|"osm"|"companies_house"|"website"|"manual"; noticeSentAt:string|null; nextAction:string|null; nextActionAt:string|null; note:string|null; lastActivityAt:string; repliedAt:string|null; closedAt:string|null; closeReason:string|null; createdAt:string; updatedAt:string; }
export type ActivityKind = "note"|"email_out"|"email_in"|"call"|"report_view"|"optout"|"stage_change"|"lead_created"|"merged"|"send_refused"|"audit_done"|"notice_sent"|"manual_send"|"bounce"|"recollect";
export interface Activity { id:number; leadId:number|null; prospectId:number|null; kind:ActivityKind; channel:"email"|"phone"|"web"|"telegram"|"system"|null; summary:string; payload:Record<string,unknown>|null; actor:"admin"|"system"|"prospect"; createdAt:string; }
export interface Prospect { id:number; reference:string; leadId:number|null; name:string; legalName:string|null; enseigne:string|null; nameKey:string; tradeKey:string|null; country:string; addressLine:string|null; postcode:string|null; city:string|null; region:string|null; lat:number|null; lng:number|null; geoSource:"source"|"centre"|"manual"|null; source:"osm"|"fr_register"|"companies_house"|"google"|"manual"; sourceId:string|null; sourceUrl:string|null; registerId:string|null; registerStatus:"active"|"ceased"|"unknown"; registerCheckedAt:string|null; diffusion:"full"|"partial"|"na"; legalForm:string|null; soleTrader:boolean|null; website:string|null; websiteSource:string|null; domainKey:string|null; websiteEmail:string|null; websiteEmailKind:EmailKind|null; websiteEmailPage:string|null; websitePhone:string|null; websiteSocials:Record<string,string>|null; websiteCms:string|null; sourcePhone:string|null; sourceEmail:string|null; forbidsExtraction:boolean; forbidsOverrideReason:string|null; googlePlaceId:string|null; googleListing:"unverified"|"found"|"not_found"; googleConfirmedAt:string|null; locale:"fr"|"en"; localeOverridden:boolean; latestAuditId:number|null; latestScore:number|null; latestGrade:"A"|"B"|"C"|null; fit:"unknown"|"fit"|"not_fit"; notFitReason:string|null; contactEmailOverride:string|null; contactPhoneOverride:string|null; noticeSentAt:string|null; noticeDeadlineAt:string|null; personalWipedAt:string|null; lastEmailedAt:string|null; lastCalledAt:string|null; optedOutAt:string|null; tpsCheckedAt:string|null; searchId:number|null; savedAt:string; updatedAt:string; deletedAt:string|null; }
export interface Audit { id:number; reference:string; prospectId:number; status:"queued"|"running"|"done"|"failed"; locale:"fr"|"en"; website:string|null; checks:AuditChecks|null; score:number|null; grade:"A"|"B"|"C"|null; flags:Flag[]; fits:FitSuggestion[]; top:CheckKey[]; pagespeed:PsiSummary|null; crawl:{url:string;status:number;bytes:number}[]; reportToken:string; reportExpiresAt:string|null; reportFirstViewedAt:string|null; reportViews:number; error:string|null; startedAt:string|null; finishedAt:string|null; createdAt:string; }

export interface Area { label:string; countryCode:string; center:{lat:number;lng:number}; bbox:[south:number,west:number,north:number,east:number]; admin?:{postcodes?:string[];inseeCode?:string;departement?:string;locality?:string}; provider:"geo_gouv"|"nominatim"; }
export interface Category { key:string; label:{fr:string;en:string}; osm:{k:string;v:string}[]; naf:string[]; sic:string[]; custom?:boolean; } // key "custom:<slug>" for free-text trades
export type DiscoverySource = "osm"|"fr_register"|"companies_house"|"google";
export interface Business { source:DiscoverySource; sourceId:string; sourceUrl:string; sources?:DiscoverySource[]; name:string; legalName?:string; enseigne?:string; addressLine?:string; postcode?:string; city?:string; region?:string; countryCode:string; lat?:number; lng?:number; geoSource:"source"|"centre"|"none"; website?:string; phone?:string; email?:string; registerId?:string; legalForm?:string; soleTrader?:boolean; diffusion?:"full"|"partial"; active?:boolean; brand?:string; registeredOfficeOnly?:boolean; tags?:Record<string,string>; alreadySaved?:{prospectId:number;reference:string}; }
export interface DiscoveryAdapter { id:DiscoverySource; enabled():boolean; supports(area:Area):boolean; search(area:Area, category:Category, opts:{budgetMs:number; signal:AbortSignal}):Promise<Business[]>; }
export const googleAdapter: DiscoveryAdapter = { id:"google", enabled:()=>process.env.GOOGLE_PLACES==="on" && !!process.env.GOOGLE_PLACES_KEY, supports:()=>true, async search(){ return []; } };

export type EmailKind = "generic"|"named"|"sole_trader"|"webmail"|"unknown";
export type CheckKey = "reachable"|"https"|"speed"|"seo_basics"|"contact"|"socials"|"schema"|"ai_ready"|"google_listing"|"housekeeping";
export const CHECK_WEIGHTS: Record<CheckKey,number> = { reachable:10, https:10, speed:15, seo_basics:10, contact:10, socials:5, schema:10, ai_ready:15, google_listing:10, housekeeping:5 };
export type CheckStatus = "pass"|"partial"|"fail"|"not_measured";
export interface CheckResult { key:CheckKey; status:CheckStatus; points:number; measured:boolean; details:Record<string,string|number|boolean|null>; }
export type AuditChecks = Record<CheckKey,CheckResult>;
export type Flag = "no-site"|"no-ssl"|"cert-expiring"|"slow-mobile"|"not-mobile"|"no-contact"|"no-booking"|"no-socials"|"no-schema"|"blocks-ai"|"no-chat"|"no-gbp"|"stale-site"|"mixed-content"|"forbids-extraction";
export interface FitSuggestion { pkg:"WEB"|"AGENT"|"SEC"|"AUTO"; flags:Flag[]; }
export interface Score { score:number; grade:"A"|"B"|"C"; earned:number; measured:number; flags:Flag[]; fits:FitSuggestion[]; top:CheckKey[]; }
export interface CrawledPage { url:string; finalUrl:string; status:number; contentType:string|null; headers:Record<string,string>; text:string; fetchedAt:string; } // memory only
export interface PsiSummary { performance:number|null; seo:number|null; lcpMs:number|null; cls:number|null; viewport:boolean|null; title:boolean|null; description:boolean|null; fetchedAt:string; timedOut:boolean; }

export type JobKind = "audit"|"noop"|"send"; // "send" reserved, no handler in v1
export interface Job { id:number; kind:JobKind; payload:Record<string,unknown>; dedupeKey:string|null; status:"queued"|"running"|"done"|"failed"|"cancelled"; priority:number; runAfter:string; attempts:number; maxAttempts:number; claimedAt:string|null; claimToken:string|null; lastError:string|null; result:unknown; createdAt:string; finishedAt:string|null; }
export type JobHandler = (job:Job, ctx:{heartbeat():void; signal:AbortSignal; log(m:string):void}) => Promise<unknown>;

export interface CallWindow { tz:string; days:number[]; ranges:[string,string][]; }
export type CallPolicy = true|"screened"|"manual";
export interface SendRule { country:string; emailAllowed:boolean; soleTraderEmail:"allowed_with_notice"|"consent_required"|"blocked"; unknownLegalFormEmail:"allowed"|"call_only"; requiresPostalAddress:boolean; requiresAdIdentification:boolean; optOutHonourDays:number; noticeDeadlineDays:number; reEmailAfterDays:number; auditMaxAgeDays:number; maxEmailsPer90d:number; footer:"fr"|"en_uk"|"en_us"; defaultLocale:"fr"|"en"; callAllowed:CallPolicy; callWindow:CallWindow; maxCallAttempts30d:number; legalRefs:string[]; }
export type RefusalCode = "country_blocked"|"no_email"|"email_webmail"|"email_sole_trader_consent"|"email_unknown_legal_form"|"optout_listed"|"emailed_recently"|"max_emails_reached"|"audit_missing"|"audit_stale"|"daily_cap"|"forbids_extraction"|"register_inactive"|"register_partial"|"notice_deadline_passed"|"not_a_fit"|"draft_unreviewed"|"stage_closed"|"lead_in_conversation"|"call_window_closed"|"call_attempts_exceeded"|"call_screening_missing";
export interface Refusal { code:RefusalCode; message:{fr:string;en:string}; }
export interface Draft { id:number; prospectId:number; auditId:number; locale:"fr"|"en"; subject:string; body:string; callScript:string; noteForOwner:string; model:string|null; fallback:boolean; generatedAt:string; editedAt:string|null; reviewedAt:string|null; }
export interface AdminSession { method:"password"|"google"; subject:string; iat:number; exp:number; nonce:string; }
```

`jobs.ts`: `enqueue(kind, payload, opts?:{priority?; runAfter?:Date; dedupeKey?; maxAttempts?}) → {id; deduped}`, `kickJobs()`, `startJobRunner()` (idempotent; on start every `running` row is re-queued at once — single process). Runner: tick 5 s and on kick; concurrency 1; claim `UPDATE jobs SET status='running', claimed_at=now, claim_token=?, attempts=attempts+1 WHERE id=(SELECT id FROM jobs WHERE status='queued' AND run_after<=now ORDER BY priority,id LIMIT 1)` with `changes===1`; heartbeat every 30 s; `running` older than 5 min re-queued or failed at `max_attempts`; retry delay `60 s × attempts`; abort at 6 min; off when `CRM_JOB_RUNNER=off`. `instrumentation.ts` dynamic-imports it only when `NEXT_RUNTIME === "nodejs"`.

**Rule table** (`rules.ts`, unit-tested): FR `emailAllowed true, allowed_with_notice, allowed, postal/ad false, optOutHonourDays 0, footer fr, locale fr, callAllowed true, Europe/Paris Mon–Fri 10:00–13:00 + 14:00–20:00`; GB `true, consent_required, call_only, false, 0, en_uk, en, callAllowed "screened", Europe/London Mon–Fri 09:00–17:30`; US `true, allowed_with_notice, allowed, requiresPostalAddress + requiresAdIdentification true, optOutHonourDays 10, en_us, en, true, America/New_York Mon–Fri 09:00–17:00`; `*` (CA and all others) `emailAllowed false, blocked, call_only, en_uk, en, callAllowed "manual", window as GB`. Everywhere: `noticeDeadlineDays 30`, `reEmailAfterDays 90`, `auditMaxAgeDays 90`, `maxEmailsPer90d 2`, `maxCallAttempts30d 4`, opt-outs honoured immediately. `emailEnabled(cc) = rules[cc]?.emailAllowed === true && OUTREACH_COUNTRY_ALLOW.has(cc)` — the env can only restrict (test: `FR,GB,US,CA` → CA still `country_blocked`).

**Foundation helpers** (`classify.ts`, pure): `classifyEmail(email,{domainKey,soleTrader})` → `webmail` (gmail/googlemail/outlook/hotmail/live/yahoo/orange.fr/wanadoo.fr/free.fr/sfr.fr/laposte.net/bbox.fr/neuf.fr/icloud/me.com/aol/protonmail/proton.me/gmx/yandex) else `sole_trader` when `soleTrader===true` else `generic` (local part in contact, info, bonjour, hello, hi, accueil, boutique, commercial, reservation(s), resa, office, admin, mail, sales, secretariat, direction, cabinet, agence, atelier, garage, restaurant, salon) else `named`; `EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/` (≤ 254 chars) and `validEmail(s)`; `safeHttpUrl(s): string|null` (`new URL`, http/https only, no credentials, ≤ 500 chars) applied in every adapter, in `extract.ts` before storing and by `ExtLink` on every admin `href` (failures render as text; all external links `target="_blank" rel="noopener noreferrer nofollow"`); `localeForCountry(cc)` (`FR → fr`, else `en`); `domainOf(url)`; `normaliseName`; `hashEmail`; `hashPhone` (E.164 digits); `countryFromTld`; `haversineM`.

**Scoring** (`auditScore`, pure): pass = weight, partial = round(weight/2), fail = 0, `not_measured` leaves the denominator; `score = round(100 × earned / measured)`; A ≥ 75, B 50–74, C < 50; PSI timeout = `partial`, measured; `top` = three measured checks with the largest `weight − points`; no website → all `not_measured` except `reachable = fail`, score 0, grade C, flag `no-site`, fit WEB.

**Auth** (`auth.ts`, Node): `verifyPassword(plain): boolean`, `sessionCookie(method, subject): string`, `readSession(cookie?: string): AdminSession|null`, `requireAdmin(path?: string): Promise<AdminSession>` (server components; `redirect('/admin/login?next=' + encodeURIComponent(path))`), `requireAdminApi(req): Promise<AdminSession|NextResponse>` (401 JSON), `csrfTokenFor(s): string`, `checkCsrf(req, s): boolean`, `guardAdminPost(req): Promise<AdminSession|NextResponse>` (401/403 or session). `authEdge.ts` (Web Crypto only, no Node imports): `verifySessionEdge(cookie, secret, version): Promise<AdminSession|null>` — same format, same test vectors. **Every `(gated)` page begins with `const session = await requireAdmin("/admin/…")`; the layout is never the gate** (App Router skips shared layouts on soft navigation).

**`sendMail` extension** (outreach, additive under `// @@crm:outreach`): `opts.from?: string`, `opts.replyTo?`, `opts.headers?: Record<string,string>`, `opts.attempts?: number` (default 4 = today's behaviour), `opts.to` passed as `{ address }` objects only; returns `Promise<{ messageId: string|null }>`; `export { esc };`.

## 4. Routes, shell, middleware

Routes with auth are in `routes`. **Middleware** (`src/middleware.ts`, edge): matcher stays `"/((?!_next|api|anal1t1c5|anal1t1c5/|.*\\..*).*)"`; before the locale logic: (a) `/admin` and `/admin/*` except `/admin/login` → `verifySessionEdge(dm_admin)`; invalid → 307 to `/admin/login?next=<path>` (this also covers RSC/soft-navigation requests); (b) `/r/*` → `rateLimit("r:"+ip, 60, 10 min)`, `/o/*` → `rateLimit("o:"+ip, 30, 10 min)`; over → `new NextResponse("Too many requests", { status: 429 })`; (c) `/admin*`, `/r/*`, `/o/*` → `NextResponse.next()` (no locale redirect). `rateLimit.ts` has no Node imports and runs in the edge build (separate bucket instance is fine). `robots.ts` production: `disallow: ["/anal1t1c5/", "/admin", "/r/", "/o/"]`. `next.config.mjs` `headers()`: `X-Robots-Tag: noindex, nofollow` + `Cache-Control: no-store` on `/admin`, `/admin/:path*`, `/r/:path*`, `/o/:path*`, `/api/admin/:path*`, `/api/o/:path*`.

Shell: `src/app/(tools)/layout.tsx` is a second root layout (`<html lang="en">`, `fontVariables`, `globals.css`, `export const metadata = { robots: { index: false, follow: false } }`; no analytics script, no `CookieConsent`, no `ChatWidget`, no `CarryParams`); pages set `lang` on their top element. `(tools)/not-found.tsx` is the branded bilingual 404 in the style of `src/app/[locale]/not-found.tsx`. The gate is per page (§3); `/admin/login` sits outside `(gated)`. Nav: Today `/admin` · Leads · Find · Prospects · Opt-outs · Log out. `adminFetch(url, body)` sends `x-dm-csrf`, `credentials: "same-origin"`, throws the JSON `error` on non-2xx. Panels `AuditBlock`, `DraftPanel`, `SendPanel`, `CallPanel` take `{ prospectId }` only and self-load from `GET /api/admin/prospects/[id]/{audit,draft,send,call}` (owner routes), so finder's page composes them without importing other modules' libs. Admin links to `/r/{token}` are plain `<a target="_blank" rel="noopener">`, never `<Link>`. Primitives Tailwind-only, dark theme (`bg-ink`, `card`, `btn-primary`, `btn-ghost` exist); `Badge` variants `neutral|good|warn|bad|info`; `Meter` 0–100 with grade colour.

## 5. Inbox behaviour

- `insertLead(input) → { lead, merged }`; merge on `email_hash` (or `phone_hash` when phone-only) with an open lead within 180 days → activity `merged`, `kind` upgraded only to `booking`, earliest `created_at` kept. `addActivity(input)` also runs `UPDATE enquiries SET last_contact_at = datetime('now') WHERE reference = ?` for `email_out|email_in|call|manual_send` on leads with `enquiry_reference`. `ensureLeadForProspect(prospectId: number, init: { kind: "outreach"; stage: "contacted"; nextAction: string; nextActionAt: string }): Lead` (creates or returns `prospects.lead_id`, sets it when empty).
- Hooks (`hooks.ts`, never throw, never await network): enquiry → `diagnostic` (`enquiry_reference`, `source_label = attributionLabel(attr)`, `legal_basis request`, `notice_sent_at = created_at`); contact → `contact`; book → `booking` (one guarded call after each successful branch — `booked` and `requested` — before its `return`); chat `submit_lead` and messenger `leadTool` → first statement inside `execute`, before the `mailConfigured()` check, so the lead survives a mail outage. `attr.utm_campaign` matching `/^AU-[23456789A-Z]{5}$/` → `attachByCampaign()` sets `prospect_id`, `source_label = "Outreach report AU-…"`, and `prospects.lead_id` when empty.
- `POST /api/admin/leads/backfill` is idempotent. `POST /api/admin/leads/[id]/activity` accepts only `{ kind: "note" | "mark_replied" | "bounce", … }` (`bounce` takes `send_reference` → `sends.status='bounced'`, `prospects.website_email_kind='unknown'`); "Log call" and "Sent from Gmail" buttons on the lead page post to outreach's `/api/admin/prospects/[id]/{call,manual-send}` and are hidden when `prospect_id` is null. Stage change → activity `stage_change {from,to}`; "Mark STOP" posts `/api/admin/optouts { lead_id }` then stage `stop`. Stage-change Telegram pings are dropped by design.
- Today (`today.ts`, raw SQL only, no imports from `lib/prospects` or `lib/outreach`; uses `READY_WHERE`, `CALL_WHERE` and `outreachDailyCap()` exported by `crm/db.ts`): follow-ups due/overdue; new leads 7 d by `source_label`; reports opened with no reply; emails sent today vs cap; audits queued/running/failed; ready-to-send and call-list counts; Google calls this month vs 900; notice deadlines within 5 days; bounces this week; "STOP replies: check the mailbox" with sends in the last 30 days and a link to `/admin/optouts`; red card "Purge last ran N days ago" when `settings.purge_last_run_at` is older than 2 days or missing; Backfill button while pending > 0.
- Instant Telegram pings (references only): first report view, opt-out, send failed, audit failed; chat/messenger hooks add "CHAT lead LD-…" / "MESSENGER lead LD-…".
- Digest `/home/hermes/workspace/scripts/digitalm-digest.js`: Node, `require("/home/hermes/workspace/digitalm-prod/node_modules/better-sqlite3")`, opens `ENQUIRIES_DB_PATH` (or `--db PATH`) `{ readonly: true }`, prints the Today sections plus yesterday's sends, opt-outs in 24 h, API counters, the STOP-replies line and the purge-age line; exits 0; `--telegram` pipes stdout to `/home/hermes/.local/bin/hermes send -t telegram -q`. Writes nothing. Scheduling (§13, after Radu's approval): hermes cron no-agent job `0 8 * * *` with wrapper `~/.hermes/scripts/run-digitalm-digest.sh` (`exec /home/hermes/.local/bin/node /home/hermes/workspace/scripts/digitalm-digest.js "$@"`) and `--deliver telegram` (hermes prefixes its scripts dir, so a bare `node …` fails as the purge job does today); a user crontab line is the alternative. Supersedes `scripts/leadgen-digest.py` in the decisions doc.

## 6. Finder behaviour

**Geocoding** `geocodeArea(query, hint?)`: French input (5-digit postcode, 2-digit department, FR hint, or Nominatim says FR) → `https://geo.api.gouv.fr/communes?nom=…&fields=nom,code,codesPostaux,centre,contour,population&boost=population&limit=1` (or `?codePostal=`), bbox = extent of `contour`, `admin.postcodes`; a department → `/departements/{code}` + `communes?codeDepartement=` extent. Elsewhere → `${NOMINATIM_URL}/search?q=…&format=jsonv2&limit=1&addressdetails=1`, `User-Agent: DigitalM-Prospecting/1.0 (https://digitalm.eu; contact@digitalm.eu)`, global spacing ≥ 1100 ms, never parallel, cache 30 d (`api_cache` provider `nominatim`); Nominatim `boundingbox` is `[s,n,w,e]` — convert. Refuse bbox > 1.5 deg² with `area_too_large`. Tiles ≤ 0.25°, max 24, sequential. Area-level lookups only, never per row.

**osm**: `POST ${OVERPASS_URL}` `data=[out:json][timeout:25][maxsize:33554432];(nwr["amenity"="restaurant"](s,w,n,e);…);out center tags 250;`; same UA, 1 req/s, concurrency 1, one retry after 10 s on 429/504, cache 24 h by tile (4 dp) + category. Map `name` (required), `addr:*`, `lat/lon` or `center`, `website|contact:website|url` through `safeHttpUrl`, `phone|contact:phone`, `email|contact:email` through `validEmail`, `brand`; `sourceUrl = https://www.openstreetmap.org/{type}/{id}`; `soleTrader` undefined.

**fr_register**: `GET ${FR_REGISTER_URL}/search?activite_principale={naf}&etat_administratif=A&page=N&per_page=25` + `code_postal=` per known postcode, else `departement=`, else `lat=&long=&radius=` (≤ 50 km); ≤ 10 pages per postcode; ≤ 5 req/s; cache 24 h per URL. Keep `nom_complet, nom_raison_sociale, sigle, siren, nature_juridique, activite_principale, etat_administratif, statut_diffusion` and from `matching_etablissements[]` (else `siege`) `siret, adresse, code_postal, libelle_commune, latitude, longitude, liste_enseignes, etat_administratif`; delete `dirigeants`, `finances`, `complements`, `collectivite_territoriale` inside the adapter. `soleTrader = nature_juridique === "1000"`; `diffusion = statut_diffusion === "diffusible" ? "full" : "partial"`; missing coordinates → area centre. `sourceUrl = https://annuaire-entreprises.data.gouv.fr/etablissement/{siret}`. `recheckSiret(siret)` = `/search?q={siret}&per_page=1` → `{ active, diffusion }`.

**companies_house**: only with `COMPANIES_HOUSE_KEY` and `area.countryCode === "GB"`. `GET https://api.company-information.service.gov.uk/advanced-search/companies?sic_codes={sic}&location={locality}&company_status=active&size=100&start_index=0`, `Authorization: Basic base64(key+":")`, ≤ 2 req/s, cache 24 h. Keep `company_name, company_number, company_type, company_status, registered_office_address.{address_line_1,locality,postal_code}, sic_codes`; no coordinates; `soleTrader = false`; `registeredOfficeOnly = true` (ResultsTable shows "registered office, not the shop"; merges keep OSM coordinates/postcode as geo truth; notes say when CH rows fall outside the bbox). `recheckCompany(number)` = `/company/{number}` status `active`.

**Categories** (`categories.ts`, 19 fixed keys, re-checked against NAF rév. 2 / SIC 2007 on 10 Sep; finder confirms once more before merge): restaurant amenity=restaurant 56.10A 56101 · bar amenity=bar|pub 56.30Z 56302 · hotel tourism=hotel 55.10Z 55100 · gite tourism=guest_house|chalet 55.20Z 55209 · campsite tourism=camp_site 55.30Z 55300 · bakery shop=bakery 10.71C 10710,47240 · butcher shop=butcher 47.22Z 47220 · hairdresser shop=hairdresser 96.02A 96020 · beauty shop=beauty 96.02B 96020 · garage shop=car_repair 45.20A 45200 · plumber craft=plumber 43.22A 43220 · electrician craft=electrician 43.21A 43210 · joiner craft=carpenter|joiner 43.32A 43320 · painter craft=painter 43.34Z 43341 · roofer craft=roofer 43.91B 43910 · estate_agent office=estate_agent 68.31Z 68310 · optician shop=optician 47.78A 47782 · dentist amenity=dentist 86.23Z 86230 · gym leisure=fitness_centre 93.13Z 93130. **Custom trade**: `FindForm` "Other trade" → `Category { key: "custom:<slug>", label, osm: [{k, v}] }` from a select of OSM keys (amenity|shop|craft|office|tourism|leisure|healthcare) + free value (`[a-z_]{2,40}`), optional NAF (`\d\d\.\d\d[A-Z]`) and SIC (`\d{5}`); `searches.category_key` stores `custom:…`; `prospects.trade_key` stores the label.

**Search / dedupe / save**: `runSearch(area, category, sources)` runs enabled adapters sequentially within 40 s; over budget → `partial: true` + `notes`. `mergeBusinesses`: (1) same `source+sourceId`; (2) same `domainKey`; (3) `normaliseName` equal AND (haversine < 150 m, or same postcode when a side has no coordinates). Merged rows keep register identity, OSM website/phone/email/coords, list `sources`. `alreadySaved` by `(source, source_id)`, `domain_key`, or name+distance. Result (≤ 300 rows) cached at `api_cache` key `search:{searchId}` 24 h. Results footer: "Données © les contributeurs d'OpenStreetMap (ODbL) · Sirene/RNE via API Recherche d'entreprises — Licence Ouverte 2.0 · Companies House — OGL v3" (also in `RegisterBlock`). `POST /api/admin/find/save { searchId, picks }` re-reads the cache, 422 on any `diffusion: "partial"` pick, inserts with `country`, `locale = localeForCountry(country)`, **`notice_deadline_at = datetime(saved_at, '+30 days')` for every prospect, every country**, `trade_key`, `search_id`; enqueues `audit` (`dedupeKey "audit:{id}"`) for every saved row with a website; returns `{ saved, auditsQueued, withoutWebsite }` (toast "Saved 7 · 5 audits queued · 2 without a website"). Add by URL `POST /api/admin/prospects { url, name?, country }` (country required; UI default `countryFromTld(url)` else FR) → `source manual`, `domain_key`, same deadline, audit enqueued. `/google` → 501 `{ error: "google_off" }` while off. `POST /api/admin/prospects/[id]` patches `fit`, `locale`, `website`, overrides (`contact_email_override` through `validEmail`, 422 otherwise), `forbids_override_reason` (writes an activity `note`), `not_this_business`, and `{ recollect: true }` (clears `personal_wiped_at`, sets a fresh `notice_deadline_at = now + 30 d`, activity `recollect`; the next audit may store contact fields again).

**Views** (`listProspects`, predicate = `READY_WHERE` from `crm/db.ts`): `ready` = `deleted_at IS NULL AND fit<>'not_fit' AND opted_out_at IS NULL AND diffusion<>'partial' AND latest_audit_id IS NOT NULL AND latest_score < READY_SCORE_MAX AND audit.finished_at > now−90d AND (last_emailed_at IS NULL OR < now−90d) AND (notice_sent_at IS NOT NULL OR notice_deadline_at > now OR personal_wiped_at IS NOT NULL) AND usable email (override, or website_email with kind ∉ {webmail, unknown}) AND forbids_extraction=0 AND country IN (email-enabled) AND register_status<>'ceased' AND (country<>'GB' OR (sole_trader=0 AND register_id IS NOT NULL)) AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.id=prospects.lead_id AND l.stage IN ('replied','meeting','proposal','won','lost','stop')) ORDER BY latest_score LIMIT 20`; `call` (`CALL_WHERE`) = no usable email, a phone exists, rule `callAllowed` ≠ blocked, attempts 30 d < 4, same opt-out and lead-stage exclusions; `all`; `not_fit`. Badges: needs website/email/phone, call instead, notice deadline in N days, not a fit, chain (`brand`), partial register, wiped. `recheckRegister(prospect)` updates `register_status`, `diffusion`, `register_checked_at`, clears `notice_deadline_at` handling for companies matched with `nature_juridique ≠ 1000` only by setting `sole_trader = 0` (the deadline itself stays); a switch to `partial` calls `wipePersonal()`. `wipePersonal(p, { keepGenericEmail })` nulls `website_email` (kept when `keepGenericEmail && website_email_kind='generic'`), `website_email_page`, `website_phone`, `source_email`, `source_phone`, both overrides; sets `personal_wiped_at`. While `personal_wiped_at` is set, the audit job does not store contact fields.

## 7. Audit behaviour

### 7.1 SSRF-safe fetching (every request to a prospect's site; `ssrf.ts` unit-tested)

1. `http:`/`https:` only, ports 80/443, no credentials; refuse `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.home.arpa`, `metadata.google.internal`.
2. `dns.promises.lookup(host, { all: true })`; refuse if ANY answer is in a `net.BlockList` holding `0.0.0.0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.88.99/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4, 240/4, 255.255.255.255/32, ::/128, ::1/128, 64:ff9b::/96, 100::/64, 2001:db8::/32, fc00::/7, fe80::/10, ff00::/8`; IPv4-mapped `::ffff:a.b.c.d` unwrapped by hand and re-tested as v4. Connect to the first vetted IPv4 (the box has no IPv6 egress).
3. `node:http`/`node:https` `request({ host: hostname, servername: hostname, port, lookup: (h, o, cb) => cb(null, vettedIp, 4), agent: false, headers: { host: hostname, "accept-encoding": "identity", "user-agent": CRAWLER_USER_AGENT } })` — the socket goes to the vetted address, so a rebinding answer cannot be swapped in. `tls.ts` uses `tls.connect({ host: vettedIp, servername: hostname })` for the certificate check.
4. Never follow redirects: on 3xx, run steps 1–3 on `Location` (max 3).
5. 8 s per request; bytes counted on `data`, `req.destroy()` at 2 MB; `text/html`/`application/xhtml+xml` only (`text/plain` for robots.txt and llms.txt).
6. robots.txt first, longest-match for our UA then `*`; disallowed pages skipped → affected checks `not_measured`.
7. ≤ 3 pages: home, first link matching `/contact|nous-contacter|contact-us/i`, first matching `/mentions|legal|legales|cgu|cgv|terms|privacy|confidentialite/i`; 1 req/s per host. Nothing crawled is stored as HTML: `extract.ts` reduces pages to scalars (titles ≤ 200, descriptions ≤ 300, URLs ≤ 500 through `safeHttpUrl`, control chars stripped; email = first `mailto:` matching `EMAIL_RE`, page recorded in `website_email_page`; e-commerce signal = `/cart|panier|checkout/` links or WooCommerce/PrestaShop/Shopify CMS); `audits.crawl` keeps `{url,status,bytes}` only.

### 7.2 The ten checks

| key | pass | partial | fail | flags |
|---|---|---|---|---|
| reachable | final 2xx on home | resolved but > 5 s | timeout/4xx/5xx/refused | no-site |
| https | https final + cert valid > 30 d + http→https redirect + HSTS | https works but redirect or HSTS missing, or cert < 30 d | no https | no-ssl, cert-expiring |
| speed | PSI mobile perf ≥ 0.70 | 0.40–0.69 or PSI timeout | < 0.40 | slow-mobile |
| seo_basics | PSI SEO ≥ 0.90 + viewport + title + description | one missing or SEO 0.70–0.89 | no viewport or SEO < 0.70 | not-mobile |
| contact | tel: or (mailto:/form with email input) AND booking link (calendly, planity, treatwell, zenchef, thefork/lafourchette, resy, opentable, /reservation, /rendez-vous, /book, google appointments) | contact, no booking | none | no-contact, no-booking |
| socials | ≥ 1 facebook/instagram/linkedin/tiktok/youtube link | — | none | no-socials |
| schema | JSON-LD LocalBusiness/Organization/Restaurant/Store (or subtype) with telephone AND openingHours | JSON-LD without those | none | no-schema |
| ai_ready | robots.txt allows GPTBot, ClaudeBot, PerplexityBot, Google-Extended AND (llms.txt 200 OR chat/WhatsApp: wa.me, api.whatsapp.com, crisp, tawk, intercom, tidio, hubspot, brevo) | bots allowed, no llms/chat | any bot disallowed | blocks-ai, no-chat |
| google_listing | `found` after confirmation | — | `not_found` after confirmation | no-gbp; `not_measured` until confirmed |
| housekeeping | copyright year ≥ current−1 AND legal link AND no `http://` sub-resource on https | one miss | two+ | stale-site, mixed-content |

`forbids-extraction`: legal page matches `interdit(e)? .{0,40}(extraction|prospection|démarchage)`, `extraction .{0,60}interdite`, `no (commercial )?solicitation`, `data mining .{0,30}prohibited`, `scraping .{0,30}(prohibited|forbidden)` → `forbids_extraction = 1`, `website_email` left empty. Fits: WEB ← no-site, no-ssl, cert-expiring, mixed-content, slow-mobile, not-mobile, stale-site, no-schema, no-socials; AGENT ← no-chat, blocks-ai, no-contact; AUTO ← no-booking; SEC ← no-ssl, cert-expiring, mixed-content **only when the e-commerce signal is present** (then WEB drops those flags). Package labels in `auditChecks.ts`, verbatim from `/pme`: WEB "Site essentiel — à partir de 500 €" / "Site essentiel — from €500" (or "Site + IA — à partir de 2 500 €" / "Site + AI — from €2,500" when no-site); AGENT and AUTO "L'IA sur votre site — à partir de 500 €" / "AI on your site — from €500"; SEC "Audit de sécurité e-commerce — à partir de 500 €/jour" / "E-commerce security audit — from €500/day". The report wording for blocks-ai is "les assistants IA ne peuvent pas lire votre site" / "AI assistants cannot read your site", never "error".

### 7.3 Job

`auditJob({prospectId})`: `api_usage("audit", today) < AUDIT_DAILY_CAP` else re-schedule to 06:00 Europe/Paris next day with a visible note; create `audits` row (`running`, `report_token`); `fetchSite` ∥ `pagespeed` (`Promise.allSettled`); `runChecks`; `auditScore`; `extract` → `prospects.website_*` (skipped when `personal_wiped_at` is set), `forbids_extraction`, `latest_*`; finish; activity `audit_done`; count `audit` and `pagespeed`. PSI: `GET ${PAGESPEED_URL}?url=&strategy=mobile&category=performance&category=seo[&key=]`, 90 s, cache 30 d by origin, keep `PsiSummary` only. Older audits beyond the last 3 are removed only by the purge script. `AuditBlock` (self-loads `GET …/audit`): score, grade, ten rows, flags, fits, "Run again" (deduped), queue position.

## 8. Report and drafts

**`/r/[token]`**: `force-dynamic`; `audits WHERE report_token = ?` → unknown: `notFound()` (branded 404); `report_expires_at < now`: the expired view rendered with status 200 ("Ce rapport a expiré / This report has expired", link to `/{locale}/diagnostic`, already noindex). Language = `audit.locale`. Rendered only from stored checks/score/flags/fits/top + `safeDisplayName`, town, trade, via JSX text nodes; the only external `href` is the prospect's `website` through `safeHttpUrl`. Sections: title "Votre présence en ligne : {business}" / "Your online presence: {business}"; meter + grade; top 3 findings; ten checks; "What we would do first" (3 lines, package + price from `auditChecks.ts`); Google line in our words only; buttons to `/{locale}/diagnostic` and `/{locale}/book` with `?utm_source=outreach&utm_medium=email&utm_campaign={AU-ref}`; footer Digital M / Digital Management Ltd, 3 Résidence des Écoles, 09000 Ferrières-sur-Ariège, France, `privacyUrl(locale)`. `report.css` `@media print`: white, no buttons, 15 mm margins, no page break inside a check row. `logView()` runs only when `report_expires_at` is set (after a send) and skips when: UA matches `/bot|crawler|spider|preview|facebookexternalhit|Slackbot|WhatsApp|TelegramBot/i`; `readSession(dm_admin)` is valid; `next-router-prefetch`, `purpose: prefetch` or `sec-purpose: prefetch` present; `sec-fetch-dest` exists and ≠ `document`. Then `report_views++`, `report_first_viewed_at` once, activity `report_view` (`{ipHash}` only), `serverTrack("report_view", { ref })`, first view pings Telegram.

**Drafts** `generateDraft({ locale, prospect:{displayName,town,trade,country,soleTrader}, checks, score, fits, reportUrl })`. `safeDisplayName(p)` in `generate.ts`: when `sole_trader = 1`, the enseigne only if no token (≥ 3 letters) of `legal_name` appears in it, else "votre établissement" / "your business"; same function for the report title and the subject (test: enseigne "MARTIN PLOMBERIE" vs legal name "PAUL MARTIN" → generic). Model `OPENAI_MODEL_DRAFTS` (default `gpt-4.1-mini`), `generateObject`, `AbortSignal.timeout(20_000)`, schema `{ subject: 8–80; email: 200–1400 (no legal block); callScript: 100–700 (opens with who we are, where the number came from, why, "you can refuse, I note it now"); noteForOwner: 40–500 }`. Prompt gets findings in plain words, flags, fits with prices, trade, town, report URL, the writing rules and `BANNED_WORDS` (`src/content/report.ts`, the nine words copied from the `/api/chat` prompt). Guards: `isMangled()` from `src/lib/diagnosticTriage.ts` on all fields → one retry then template; email must contain `reportUrl` (else appended); template if the email contains an email address, a phone pattern or a banned word. `templates.ts` builds the same four fields in FR/EN plus `followUp(locale)` (short 7-day follow-up body). `DraftPanel` (self-loads `GET …/draft`): four editable fields, Regenerate, Save (`edited_at`, `reviewed_at = now`); send refused while `reviewed_at` is null.

## 9. Outreach

**Refusals** `evaluateRefusals({prospect, audit, draft, rule, todaySent, sentCount90d, optedOut, lead, registerCheck})` returns every failing code with FR/EN plain words (`src/content/outreach.ts`): `country_blocked` ("Pas d'e-mail depuis l'outil pour ce pays : appelez ou écrivez à la main." / "No in-app email for this country: call or write by hand."), `no_email`, `email_webmail`, `email_sole_trader_consent` (GB `sole_trader = 1`), `email_unknown_legal_form` (GB, `register_id IS NULL` or `sole_trader IS NULL`), `optout_listed`, `emailed_recently` (< 90 d), `max_emails_reached` (`sent` rows with channel `email|manual_email` in 90 d ≥ 2 — "no third"), `audit_missing`, `audit_stale`, `daily_cap`, `forbids_extraction` (unless `forbids_override_reason`), `register_inactive`, `register_partial`, `notice_deadline_passed` (every country: `notice_sent_at IS NULL AND notice_deadline_at < now AND personal_wiped_at IS NULL`), `not_a_fit`, `draft_unreviewed`, `stage_closed` (`won|lost|stop|no_response`), `lead_in_conversation` (`replied|meeting|proposal`: "Ce contact est en discussion : pas d'e-mail de prospection." / "This contact is in conversation: no prospecting email."). Calls: `optout_listed` (phone), `register_inactive`/`register_partial`, `call_window_closed`, `call_attempts_exceeded`, `call_screening_missing` (GB: `tps_checked_at` older than 28 days or null — "Vérifiez le numéro sur TPS et CTPS avant d'appeler (PECR reg. 21)." / "Screen the number against TPS and CTPS before calling (PECR reg 21)."). CSRF (`checkCsrf`) applies to `/api/admin/*` only.

**Send** `sendOutreach({prospectId, draftId})`: (1) load prospect, latest done audit, draft, rule; live `recheckRegister`; refusals. (2) Refusals → `sends` row `refused` with codes, activity `send_refused`, `{ok:false, refusals}`. (3) `to = contact_email_override ?? website_email`, re-validated with `EMAIL_RE`, passed as `{ address: to }` (no display name), else `no_email`; `from = "${OUTREACH_FROM_NAME}" <${OUTREACH_FROM ?? CONTACT_FORM_FROM}>`; `subject` with `[\r\n]` stripped; `text = draft.body + "\n\n" + legalFooter(rule, ctx, locale)`; `html` = escaped paragraphs (`esc`) + same footer (opt-out line its own paragraph above the notice); `replyTo = OUTREACH_REPLY_TO ?? from`; headers `List-Unsubscribe: <${SITE_URL}/api/o/{token}>, <mailto:{replyTo}?subject=STOP%20{SN-ref}>`, `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (humans get `/o/{token}` in the footer). (4) Insert `sends` `pending` with `optout_token`, `body_text`, `legal_block`, `country`, `rule_key` — committed before SMTP. (5) `sendMail({ …, attempts: 1 })`; success → `sent`, `sent_at`, `smtp_message_id`, `prospects.last_emailed_at`, `notice_sent_at ??= now`, `audits.report_expires_at ??= now + REPORT_TTL_DAYS`, `ensureLeadForProspect(id, { kind:"outreach", stage:"contacted", nextAction:"Relance si pas de réponse", nextActionAt: today+7 })`, activity `email_out`, `api_usage("outreach_email")`, `serverTrack("outreach_sent", {ref})`; failure → `failed`, `error = code`, Telegram alert, no retry (sends are manual, one at a time; nginx's 60 s read timeout would otherwise hide the result). Daily cap counts `sent` rows since 00:00 Europe/Paris against `OUTREACH_DAILY_CAP` (or `settings.outreach_daily_cap_override`, lower only).

**Manual send** (`send.ts`): `prepareManualSend(prospectId, draftId | "followup"): { sendId, reference, subject, text }` runs the same refusals, inserts `sends` (`channel 'manual_email'`, `status 'pending'`, `optout_token`, `legal_block`, `body_text = body + legalFooter`) and returns the text with `{optout_url}` resolved; `recordManualSend(sendId)` flips it to `sent` and applies the same prospect/lead/audit updates, activity `manual_send`; refused (409) for a row that was not prepared. `SendPanel` (self-loads `GET …/send` → recipient, legal block preview, refusals, cap): Send · "Copy email with legal block" (clipboard) · "I sent it from Gmail". The 7-day follow-up uses `followUp(locale)` through the same path; `max_emails_reached` stops a third.

**Opt-out**: `/o/[token]` (language = the send's prospect locale; unknown token → `notFound()` → `o/[token]/not-found.tsx` with the INVALID LINK text in FR and EN, 404) with one button posting a form to `/api/o/[token]`. `src/app/api/o/[token]/route.ts`: `GET` → 303 to `/o/{token}`; `POST` accepts JSON `{confirm:true}`, form `confirm=1` (→ 303 `/o/{token}?done=1`) or a body exactly `List-Unsubscribe=One-Click` (→ 200); one-click bodies limited per token (`rateLimit("o1:"+token, 5, 1 min)`), the others `rateLimit("oapi:"+ip, 10, 10 min)`; no CSRF check. Effect: `optouts` (`email_hash` of `sends.to_email`, `source link|one_click`, ids), `prospects.opted_out_at`, lead stage `stop`, activity `optout`, Telegram ping; idempotent (second POST → "already recorded"); tokens never expire. `POST /api/admin/optouts` accepts `{ email }` or `{ phone }` (hashed at once, raw never stored), `{ lead_id }`, `{ prospect_id }`, or `{ send_reference: "SN-XXXXX", source: "reply_stop" }` (resolves `to_hash`, `prospect_id`, `lead_id`). `isOptedOut` runs before every send and call.

**Calls** `logCall({prospectId, outcome:"no_answer"|"answered"|"refused"|"callback"|"wrong_number", note, tpsChecked?})`: (1) `recheckRegister` unless `register_checked_at` < 24 h; refuse `register_inactive`/`register_partial`; (2) opt-out, window, attempts, GB screening (`tpsChecked: true` sets `tps_checked_at = now` first); (3) activity `call {outcome}`, `last_called_at`; `answered` sets `notice_sent_at` when null; `refused` → opt-out (phone + email when known), stage `stop`; `callback` sets `next_action_at`. `CallPanel` (self-loads `GET …/call`): window status in the rule's tz, attempts n/4, opener lines from `outreach.ts`, the draft's script; GB shows the checkbox "Screened against TPS and CTPS today (PECR reg 21)"; `callAllowed: "manual"` shows "No call rule for {country} — check local law first (DE §7 UWG, AT §174 TKG)" and still logs outcomes.

**Purge** `/home/hermes/workspace/scripts/digitalm-purge.js` (Node, prod better-sqlite3, `--dry-run` default, `--apply`, `--db`; opens the DB read-write only with `--apply`): (1) `mkdir -p /home/hermes/data/backups`, `VACUUM INTO` dated backup (keep 8) before writes; (2) enquiries: IP null at 12 m, delete 3 y after `last_contact_at` (replaces `purge-enquiries.js`, which stays untouched until the hermes job is repointed); `UPDATE leads SET ip = NULL WHERE ip IS NOT NULL AND created_at < datetime('now','-12 months')`; (3) leads `contacted` with no reply and last `email_out`/`manual_send` > 21 d → `no_response`; (4) `prospects WHERE notice_sent_at IS NULL AND notice_deadline_at < now AND personal_wiped_at IS NULL AND deleted_at IS NULL`: `sole_trader = 1` → delete row + audits + drafts (sends keep hashes only); `sole_trader = 0` → `wipePersonal({ keepGenericEmail: true })`; `sole_trader IS NULL` → `wipePersonal({ keepGenericEmail: false })`; (5) `no_response`/`not_fit` prospects without reply → `wipePersonal` at 12 m; (6) `activities.payload.ipHash` null at 12 m; (7) prospects deleted 3 y after the later of `saved_at` and last inbound activity; (8) newest 3 audits per prospect kept; (9) `jobs` done/failed > 30 d and expired `api_cache` removed; (10) `optouts` never touched; (11) `settings.purge_last_run_at = now`. Schedule (approval item, §13): replace hermes cron `518a81934ab4` by a daily no-agent job `0 4 * * *` running wrapper `~/.hermes/scripts/run-digitalm-purge.sh` (`exec /home/hermes/.local/bin/node /home/hermes/workspace/scripts/digitalm-purge.js --apply`).

**Legal docs** (outreach): `docs/leadgen-lia.md` (purpose, necessity, balancing, safeguards: B2B only, no webmail, 30-day notice/wipe, opposition list, 90-day re-contact, two emails max, retention; records the French-establishment vs Art. 27 stance) and `docs/leadgen-registre-art30.md` (FR + EN: controller, establishment, purposes, categories, data subjects, recipients Google Workspace/OpenAI/PageSpeed/OVH, transfers, retention, security measures).

## 10. Security rules

- Cookie `dm_admin = v1.<payloadB64>.<sigB64>`; `payload = base64url(JSON{iat,exp,method,subject,nonce})`; `sig = base64url(HMAC-SHA256(ADMIN_SESSION_SECRET, "v"+ADMIN_SESSION_VERSION+"|"+payloadB64))`; verify checks `sig.length === expected.length` before `timingSafeEqual`, then expiry and version; `HttpOnly; Secure` (https SITE_URL); `SameSite=Lax; Path=/; Max-Age=604800`. Secret ≥ 32 chars or login returns 500. `csrfTokenFor(s) = base64url(HMAC-SHA256(secret, "csrf|" + s.nonce))`, same length-guarded compare. Password `scryptSync(plain, salt, 64, {N:16384,r:8,p:1})` vs `ADMIN_PASSWORD_HASH = "scrypt$16384$8$1$<saltB64>$<hashB64>"` from `scripts/crm-hash-password.js` (stdin, never argv).
- Login: `rateLimit("admin-login:"+ip, 5, 10 min)` + `rateLimit("admin-login:*", 30, 10 min)`; `verifyTurnstile` from `@/lib/turnstile` (`bad` → 403, `outage` → allowed and logged, `skipped` when unset); honeypot `website`; 500 ms sleep on failure; redirect to `next` only when it starts with `/admin`.
- CSRF on `/api/admin/*`: JSON `POST` with `Origin === SITE_URL` (from `@/lib/seo`; `Referer` prefix accepted when `Origin` absent; both absent → 403) and `x-dm-csrf === csrfTokenFor(session)`. No server actions, no GET side effects. Public `/api/o/*` is exempt (token + per-token/per-IP limits).
- Public rate limits (middleware): `/r` 60/10 min, `/o` 30/10 min per IP; `/api/o` in the route; login 5/10 min. Tokens found by unique-index lookup only.
- SSRF: §7.1 for any URL from a prospect, a source or an admin field; `crm/http.ts` only reaches the fixed hosts in §11 (`OVERPASS_URL`/`NOMINATIM_URL`/`FR_REGISTER_URL`/`PAGESPEED_URL` read once at boot, https only).
- Output: React text nodes; `esc()` for every interpolated email value; `safeHttpUrl` on every href from foreign data; no raw crawled HTML anywhere.
- Secrets: never log `ADMIN_*`, `SMTP_*`, `OPENAI_*`, `COMPANIES_HOUSE_KEY`, `PAGESPEED_API_KEY`, `GOOGLE_PLACES_KEY`; `sends.body_text` never returned by list endpoints. Minimisation: Telegram/Umami references only; register adapter drops directors/finances; Google (later) stores `place_id` only.

## 11. Environment and hosts

Keys in `env_keys`. Public-API hosts: `https://overpass-api.de/api/interpreter`, `https://nominatim.openstreetmap.org`, `https://geo.api.gouv.fr`, `https://recherche-entreprises.api.gouv.fr`, `https://api.company-information.service.gov.uk`, `https://www.googleapis.com/pagespeedonline/v5`. Staging runs the job runner on its own DB; with no SMTP, sends fail visibly there.

## 12. Legal strings

Exact strings are in `legal_text` (FR footer, EN rendering of the FR-rule block `en_footer_fr`, EN footers UK/US, `/o` page FR/EN, privacy sections FR/EN) and live in `src/content/outreach.ts` and `en.ts`/`fr.ts`. `legalFooter(rule, ctx, locale)` picks `FOOTERS[rule.footer][locale]` (`fr` → fr or en_footer_fr; `en_uk`/`en_us` → en). Rules: the opt-out line is the first line of the block, alone, after a blank line and a `—` rule, in text and HTML. Placeholders from `legal.ts`: `{optout_url}` (`${SITE_URL}/o/{token}`), `{identity_source}` + `{identity_url}` from `prospects.source` ("le registre national des entreprises (annuaire-entreprises.data.gouv.fr)" / "OpenStreetMap (données © les contributeurs d'OpenStreetMap, ODbL)" / "Companies House" / "votre site internet {domain}" and EN "the French national business register (annuaire-entreprises.data.gouv.fr)" / "OpenStreetMap (data © OpenStreetMap contributors, ODbL)" / "Companies House" / "your website {domain}"), `{saved_date}`, `{email_source}` = "votre site internet {domain} (page {website_email_page})" / "your website {domain} (page …)" with `{audit_date}` — the email sentence is omitted when the address came from the identity source itself; `{trade}` falls back to "votre activité professionnelle" / "your business" when `trade_key` is null; `{privacy_url}` = `privacyUrl(locale)` = `${SITE_URL}/${locale}/legal/confidentialite`; dates dd/mm/yyyy FR, d Month yyyy EN. Outreach also appends an "Établissement en France" / "French establishment" entry to `legal.notice.sections` with a SIRET placeholder. Radu signs every string, the LIA and the register entry before the first production send.

## 13. Acceptance and integration

Per-module lists are in `modules[].acceptance`. Integration checklist before prod: (1) `npm run typecheck`, `npm run build` (no dynamic-usage warnings in the tools group), `npm test` green; (2) staging build + `systemctl --user restart digitalm-staging`; smoke `/fr`, `/en`, `/fr/diagnostic` still 200 and static; `/admin/login` 200; `curl -H 'RSC: 1' :3001/admin/leads` without cookie → 307, never data; login; every admin page 200; pipeline Add by URL → audit done → report opens → draft → refused send shows refusals, not a 500; `/o/{token}` and `POST /api/o/{token}` work; digest and purge scripts run on the staging DB (`--db`); (3) prod `.env.local` gets the new keys; `VACUUM INTO` backup of the prod DB; (4) rsync per §0; build; kill the `digitalm.service` main PID; wait for :3000; smoke `https://digitalm.eu`; (5) Radu: password hashed on the box; SPF/DKIM/DMARC for the sending mailbox; §12 wording, LIA and Art. 30 entry signed; French establishment SIRET registered or an Art. 27 EU representative appointed; **two scheduler approvals** — digest 08:00 (`/home/hermes/workspace/scripts/digitalm-digest.js`) and daily 04:00 purge (`digitalm-purge.js --apply`, replacing hermes job `518a81934ab4`); after both run once on staging, `hermes cron list` shows a successful last run; first 20 real audits together.

## 14. Effort and merge order

| Order | Module | Days | Depends on |
|---|---|---|---|
| 1 | foundation | 3.5 | — |
| 2 | inbox | 3.0 | foundation (`READY_WHERE`, `CALL_WHERE`, `outreachDailyCap` come from `crm/db.ts`, so inbox merges before finder/outreach) |
| 3 | audit | 3.5 | foundation |
| 4 | finder | 4.0 | foundation; reads audit's `website_*` |
| 5 | report | 2.5 | foundation, audit |
| 6 | outreach | 3.5 | foundation, finder (`recheckRegister`, `wipePersonal`), report (drafts, `followUp`, report URL), inbox (`ensureLeadForProspect`) |

Sum 20.0 days. Days 0–3.5 foundation lands while others build pure code and UI against stubs; then inbox, audit, finder merge in that order (each rebases); then report, outreach; then the integration checklist, a staging soak with the first 20 real audits, and prod.

## 15. Changes after review

- Auth: gate moved from the `(gated)` layout to every page (`requireAdmin(path)`), plus an edge cookie check in middleware (`authEdge.ts`); cookie format `v1.<payload>.<sig>` with length-guarded compare; `csrfTokenFor` defined; async signatures; `LoginForm.tsx` + shared `verifyTurnstile`; CSRF origin = `SITE_URL`, scoped to `/api/admin/*`.
- SSRF: `undici` dropped; `node:http`/`https` with `lookup` override, `net.BlockList`, `tls.connect` pinned to the vetted IP, redirects re-validated by hand.
- Build order: `READY_WHERE`/`CALL_WHERE`/`outreachDailyCap()` in `crm/db.ts`; inbox activity route limited to note/mark_replied/bounce; `ensureLeadForProspect` owned by inbox; panels self-load from GET routes.
- Pages cannot return 410/429: expired report = 200 view; per-IP limits moved to middleware; `o/[token]/not-found.tsx`.
- One-click: `List-Unsubscribe` points at `/api/o/{token}` (GET → 303), per-token limit for one-click bodies, mailto uses `replyTo`.
- Email injection: `EMAIL_RE` at extraction, PATCH and send; `{ address }` recipients; CRLF stripped from subject.
- `sendMail` gains `attempts`, `from`, `headers`, `esc` export; outreach sends with `attempts: 1`.
- View logging skips admin sessions, prefetches, non-document fetches and pre-send opens; admin uses plain `<a>` to reports.
- Prod rsync list includes `next.config.mjs`, `package.json`, lock; headers cover bare `/admin` and `/api/o`; tools layout noindex, no analytics/consent/chat.
- Tests: foundation owns `package.json`/`tsconfig.json`; `node --test` conventions fixed (verified on the box).
- Legal: 30-day notice deadline on every prospect in every country; purge distinguishes sole trader / company / unknown; `recollect` action; refusal `notice_deadline_passed` everywhere; `max_emails_reached`, `lead_in_conversation`, `call_screening_missing`; GB calls `screened` with `tps_checked_at`, `*` calls `manual`; manual sends prepared with the legal block (`prepareManualSend`/`recordManualSend`), follow-up template; `logCall` re-checks the register; footer chosen by rule AND locale (`en_footer_fr` added); two-part source notice with ODbL attribution; UK footer no longer cites reg 22 as permission; US footer carries lawful basis and rights; `{privacy_url}` defined; retention wording harmonised; reply-STOP path (`send_reference`) + Today/digest reminders; bounce path; `enquiries.last_contact_at` and `leads.ip` maintained; AUTO → "L'IA sur votre site", SEC only with e-commerce signals, EN labels verbatim from `/pme`; `safeDisplayName`; `OUTREACH_FROM_NAME` default "Radu — Digital M"; free-text categories; save enqueues audits; attribution footers; CH registered-office note; French establishment / Art. 27 sign-off item; LIA + Art. 30 docs owned by outreach; purge scheduling as its own approval item with `purge_last_run_at` monitoring; stage-change pings dropped by design; `safeHttpUrl` everywhere; identifier allowlists; `Prospect` and `Audit` interfaces spelled out; job signatures in `jobs.ts`; `JobKind` includes `send`; 06:00 Europe/Paris; running jobs re-queued at start; hook positions fixed; env can only restrict countries.

## Appendix A — schema SQL

```sql
-- Digital M CRM — additive schema. Applied by applyCrmSchema(db) in src/lib/crm/schema.ts,
-- called at the end of enquiriesDb(). Every statement is idempotent. Extra columns on
-- existing tables go through the PRAGMA table_info + ALTER TABLE ADD COLUMN loop, as
-- src/lib/enquiries.ts already does (listed under EXTRA COLUMNS).
-- Validated 2026-09-10 on this box (better-sqlite3 12): runs twice on a fresh WAL DB;
-- 12 CRM tables (+ enquiries), 28 explicit indexes; partial unique indexes and the
-- job claim UPDATE behave as specified.

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,                       -- LD-XXXXX
  kind TEXT NOT NULL,                                   -- diagnostic|booking|contact|chat|messenger|outreach|manual
  stage TEXT NOT NULL DEFAULT 'new',                    -- new|contacted|replied|meeting|proposal|won|lost|no_response|stop
  name TEXT,
  company TEXT,
  email TEXT,
  email_hash TEXT,                                      -- sha256(lower(trim(email)))
  phone TEXT,
  phone_hash TEXT,                                      -- sha256(E.164 digits)
  locale TEXT NOT NULL DEFAULT 'fr',                    -- fr|en
  country TEXT NOT NULL DEFAULT 'FR',                   -- ISO 3166-1 alpha-2
  source_label TEXT,
  source_utm TEXT,
  attribution TEXT,                                     -- JSON utm_*/oppref
  enquiry_reference TEXT,                               -- DM-XXXXX
  prospect_id INTEGER,
  legal_basis TEXT NOT NULL DEFAULT 'request',          -- request|legitimate_interest
  data_source TEXT NOT NULL DEFAULT 'form',             -- form|chat|messenger|booking|register|osm|companies_house|website|manual
  notice_sent_at TEXT,
  next_action TEXT,
  next_action_at TEXT,                                  -- YYYY-MM-DD (Europe/Paris)
  note TEXT,
  last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
  replied_at TEXT,
  closed_at TEXT,
  close_reason TEXT,
  ip TEXT,                                              -- nulled by the purge at 12 months
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS leads_stage_next ON leads(stage, next_action_at);
CREATE INDEX IF NOT EXISTS leads_email_hash ON leads(email_hash);
CREATE INDEX IF NOT EXISTS leads_phone_hash ON leads(phone_hash);
CREATE INDEX IF NOT EXISTS leads_prospect ON leads(prospect_id);
CREATE INDEX IF NOT EXISTS leads_enquiry ON leads(enquiry_reference);
CREATE INDEX IF NOT EXISTS leads_created ON leads(created_at);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER,
  prospect_id INTEGER,
  kind TEXT NOT NULL,                                   -- note|email_out|email_in|call|report_view|optout|stage_change|lead_created|merged|send_refused|audit_done|notice_sent|manual_send|bounce|recollect
  channel TEXT,                                         -- email|phone|web|telegram|system
  summary TEXT NOT NULL,
  payload TEXT,                                         -- JSON, scalars only; ip stored as ipHash
  actor TEXT NOT NULL DEFAULT 'admin',                  -- admin|system|prospect
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS activities_lead ON activities(lead_id, created_at);
CREATE INDEX IF NOT EXISTS activities_prospect ON activities(prospect_id, created_at);
CREATE INDEX IF NOT EXISTS activities_kind ON activities(kind, created_at);

CREATE TABLE IF NOT EXISTS prospects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,                       -- PR-XXXXX
  lead_id INTEGER,
  name TEXT NOT NULL,
  legal_name TEXT,
  enseigne TEXT,
  name_key TEXT NOT NULL,                               -- normaliseName(name)
  trade_key TEXT,                                       -- categories.ts key, or the custom label
  country TEXT NOT NULL,                                -- ISO 3166-1 alpha-2, never null
  address_line TEXT,
  postcode TEXT,
  city TEXT,
  region TEXT,
  lat REAL,
  lng REAL,
  geo_source TEXT,                                      -- source|centre|manual
  source TEXT NOT NULL,                                 -- osm|fr_register|companies_house|google|manual
  source_id TEXT,                                       -- osm "node/123", FR SIRET, CH company number
  source_url TEXT,
  register_id TEXT,                                     -- SIRET / company number
  register_status TEXT NOT NULL DEFAULT 'unknown',      -- active|ceased|unknown
  register_checked_at TEXT,
  diffusion TEXT NOT NULL DEFAULT 'na',                 -- full|partial|na
  legal_form TEXT,
  sole_trader INTEGER,                                  -- 1|0|NULL unknown
  website TEXT,
  website_source TEXT,                                  -- register|osm|companies_house|manual|google|crawl
  domain_key TEXT,                                      -- registrable domain of website
  website_email TEXT,                                   -- first mailto matching EMAIL_RE
  website_email_kind TEXT,                              -- generic|named|sole_trader|webmail|unknown
  website_email_page TEXT,
  website_phone TEXT,
  website_socials TEXT,                                 -- JSON {facebook:url,...} (safeHttpUrl-validated)
  website_cms TEXT,
  source_phone TEXT,                                    -- from discovery tags (OSM contact:*)
  source_email TEXT,
  forbids_extraction INTEGER NOT NULL DEFAULT 0,
  forbids_override_reason TEXT,
  google_place_id TEXT,
  google_listing TEXT NOT NULL DEFAULT 'unverified',    -- unverified|found|not_found
  google_confirmed_at TEXT,
  locale TEXT NOT NULL,                                 -- fr|en (default from country)
  locale_overridden INTEGER NOT NULL DEFAULT 0,
  latest_audit_id INTEGER,
  latest_score INTEGER,
  latest_grade TEXT,
  fit TEXT NOT NULL DEFAULT 'unknown',                  -- unknown|fit|not_fit
  not_fit_reason TEXT,
  contact_email_override TEXT,
  contact_phone_override TEXT,
  notice_sent_at TEXT,
  notice_deadline_at TEXT,                              -- saved_at + 30 d for EVERY prospect (reset by recollect)
  personal_wiped_at TEXT,
  last_emailed_at TEXT,
  last_called_at TEXT,
  opted_out_at TEXT,
  search_id INTEGER,
  saved_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS prospects_source_uq ON prospects(source, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS prospects_domain ON prospects(domain_key);
CREATE INDEX IF NOT EXISTS prospects_name_country ON prospects(name_key, country);
CREATE INDEX IF NOT EXISTS prospects_ready ON prospects(deleted_at, fit, opted_out_at, latest_score);
CREATE INDEX IF NOT EXISTS prospects_country ON prospects(country);
CREATE INDEX IF NOT EXISTS prospects_notice ON prospects(notice_deadline_at, notice_sent_at);
CREATE INDEX IF NOT EXISTS prospects_lead ON prospects(lead_id);

CREATE TABLE IF NOT EXISTS audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,                       -- AU-XXXXX
  prospect_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',                -- queued|running|done|failed
  locale TEXT NOT NULL,                                 -- fr|en (copied from prospect at run time)
  website TEXT,
  checks TEXT,                                          -- JSON AuditChecks (scalars only)
  score INTEGER,
  grade TEXT,
  flags TEXT NOT NULL DEFAULT '[]',                     -- JSON Flag[]
  fits TEXT NOT NULL DEFAULT '[]',                      -- JSON FitSuggestion[]
  top TEXT NOT NULL DEFAULT '[]',                       -- JSON CheckKey[]
  pagespeed TEXT,                                       -- JSON PsiSummary
  crawl TEXT NOT NULL DEFAULT '[]',                     -- JSON [{url,status,bytes}] — never HTML
  report_token TEXT NOT NULL UNIQUE,                    -- 43-char base64url, generated at creation
  report_expires_at TEXT,                               -- set at first send (+REPORT_TTL_DAYS); null = not yet sent, views not logged
  report_first_viewed_at TEXT,
  report_views INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS audits_prospect ON audits(prospect_id, created_at);
CREATE INDEX IF NOT EXISTS audits_status ON audits(status);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                                   -- audit|noop|send
  payload TEXT NOT NULL DEFAULT '{}',                   -- JSON
  dedupe_key TEXT,                                      -- e.g. "audit:42"
  status TEXT NOT NULL DEFAULT 'queued',                -- queued|running|done|failed|cancelled
  priority INTEGER NOT NULL DEFAULT 5,                  -- lower runs first
  run_after TEXT NOT NULL DEFAULT (datetime('now')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  claimed_at TEXT,
  claim_token TEXT,
  last_error TEXT,
  result TEXT,                                          -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS jobs_pick ON jobs(status, run_after, priority, id);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedupe_uq ON jobs(kind, dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued','running');

CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id INTEGER NOT NULL,
  audit_id INTEGER NOT NULL,
  locale TEXT NOT NULL,                                 -- fr|en
  subject TEXT NOT NULL,
  body TEXT NOT NULL,                                   -- email body WITHOUT legal block
  call_script TEXT NOT NULL,
  note_for_owner TEXT NOT NULL,
  model TEXT,                                           -- null when template
  fallback INTEGER NOT NULL DEFAULT 0,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  edited_at TEXT,
  reviewed_at TEXT                                      -- send refused while null
);
CREATE INDEX IF NOT EXISTS drafts_prospect ON drafts(prospect_id, generated_at);

CREATE TABLE IF NOT EXISTS sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,                       -- SN-XXXXX
  prospect_id INTEGER NOT NULL,
  lead_id INTEGER,
  audit_id INTEGER,
  draft_id INTEGER,
  channel TEXT NOT NULL,                                -- email|manual_email|call
  to_email TEXT,
  to_hash TEXT,
  from_email TEXT,
  subject TEXT,
  body_text TEXT,                                       -- full text as sent (body + legal block); manual_email rows too
  legal_block TEXT,
  optout_token TEXT UNIQUE,                             -- 43-char base64url; never expires; manual_email rows too
  status TEXT NOT NULL DEFAULT 'pending',               -- pending|sent|failed|refused|bounced
  refusal_codes TEXT NOT NULL DEFAULT '[]',             -- JSON RefusalCode[]
  smtp_message_id TEXT,
  error TEXT,                                           -- error code only, never credentials
  country TEXT NOT NULL,
  rule_key TEXT NOT NULL,                               -- FR|GB|US|*
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sends_prospect ON sends(prospect_id, created_at);
CREATE INDEX IF NOT EXISTS sends_status_sent ON sends(status, sent_at);
CREATE INDEX IF NOT EXISTS sends_to_hash ON sends(to_hash);

CREATE TABLE IF NOT EXISTS optouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_hash TEXT,
  phone_hash TEXT,
  channel TEXT NOT NULL,                                -- email|phone|both
  source TEXT NOT NULL,                                 -- link|one_click|reply_stop|call|manual
  lead_id INTEGER,
  prospect_id INTEGER,
  send_id INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS optouts_email ON optouts(email_hash);
CREATE INDEX IF NOT EXISTS optouts_phone ON optouts(phone_hash);

CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_area TEXT NOT NULL,
  area TEXT NOT NULL,                                   -- JSON Area (geocoded)
  category_key TEXT NOT NULL,                           -- categories.ts key or "custom:<slug>"
  sources TEXT NOT NULL,                                -- JSON DiscoverySource[]
  result_count INTEGER NOT NULL DEFAULT 0,
  per_source TEXT NOT NULL DEFAULT '{}',                -- JSON {osm: n, fr_register: n, ...}
  saved_count INTEGER NOT NULL DEFAULT 0,
  partial INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS searches_created ON searches(created_at);

CREATE TABLE IF NOT EXISTS api_usage (
  provider TEXT NOT NULL,                               -- overpass|nominatim|geo_gouv|fr_register|companies_house|pagespeed|openai_drafts|google_places|audit|outreach_email
  day TEXT NOT NULL,                                    -- YYYY-MM-DD (UTC)
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, day)
);

CREATE TABLE IF NOT EXISTS api_cache (
  cache_key TEXT PRIMARY KEY,                           -- "<provider>:<sha256(request)>" or "search:<id>"
  provider TEXT NOT NULL,
  payload TEXT NOT NULL,                                -- JSON
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS api_cache_expires ON api_cache(expires_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,                                 -- outreach_daily_cap_override | purge_last_run_at
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- EXTRA COLUMNS (ALTER TABLE ... ADD COLUMN via the table_info loop; markers in schema.ts)
-- @@crm:inbox
--   enquiries.lead_id INTEGER
-- @@crm:outreach
--   prospects.tps_checked_at TEXT                      -- GB: last TPS/CTPS screening (valid 28 days)
```

## Appendix B — env keys

- `ADMIN_PASSWORD_HASH` — scrypt hash of the shared admin password, format scrypt$16384$8$1$<saltB64>$<hashB64>; produced by scripts/crm-hash-password.js (reads stdin). Login disabled while unset.
- `ADMIN_SESSION_SECRET` — HMAC-SHA256 key for the dm_admin cookie (Node auth.ts and edge authEdge.ts); ≥ 32 random bytes hex (openssl rand -hex 32). Rotating it logs everyone out.
- `ADMIN_SESSION_VERSION` — Integer baked into the cookie signature; bump to invalidate every session. (default: `1`)
- `CRM_JOB_RUNNER` — on|off — start the in-app job runner from instrumentation.ts (on for staging and prod). (default: `on`)
- `READY_SCORE_MAX` — Prospects with latest_score below this appear in the 'ready to send' view. (default: `60`)
- `OUTREACH_FROM` — Sender address for outreach emails; falls back to CONTACT_FORM_FROM. Must be the SMTP user or a verified send-as alias. (default: `(CONTACT_FORM_FROM)`)
- `OUTREACH_FROM_NAME` — Display name on outreach emails (Radu's recorded decision). (default: `Radu — Digital M`)
- `OUTREACH_REPLY_TO` — Reply-To for outreach emails; also the mailto target in List-Unsubscribe. (default: `(OUTREACH_FROM)`)
- `OUTREACH_DAILY_CAP` — Maximum in-app outreach emails per Europe/Paris day; settings.outreach_daily_cap_override can only lower it. (default: `10`)
- `OUTREACH_COUNTRY_ALLOW` — Comma list of ISO2 countries allowed to receive in-app email. Restrict-only: a country is emailable only when its SendRule allows email AND it is listed (adding CA does nothing until a CA rule exists). (default: `FR,GB,US`)
- `AUDIT_DAILY_CAP` — Maximum audits per day; extra jobs are rescheduled to 06:00 Europe/Paris next day. (default: `50`)
- `PAGESPEED_API_KEY` — Optional Google PageSpeed Insights key. Blank = keyless endpoint.
- `PAGESPEED_URL` — PSI base URL (override only for tests; read once at boot, https only). (default: `https://www.googleapis.com/pagespeedonline/v5/runPagespeed`)
- `CRAWLER_USER_AGENT` — User-Agent for our crawler on prospect sites (robots.txt honoured under this token). (default: `DigitalM-AuditBot/1.0 (+https://digitalm.eu/fr/legal/mentions-legales; contact@digitalm.eu)`)
- `OVERPASS_URL` — Overpass API endpoint (https only; public instance limits: 1 req/s, cache 24 h). (default: `https://overpass-api.de/api/interpreter`)
- `NOMINATIM_URL` — Nominatim base URL (1 req/s, identifying User-Agent, cache 30 d, area-level lookups only). (default: `https://nominatim.openstreetmap.org`)
- `FR_REGISTER_URL` — API Recherche d'entreprises base URL (≤ 5 req/s, cache 24 h). (default: `https://recherche-entreprises.api.gouv.fr`)
- `COMPANIES_HOUSE_KEY` — Optional UK Companies House API key; adapter off when blank.
- `GOOGLE_PLACES` — on|off — Google Places adapter and 'Find on Google' (stub returning [] while off). (default: `off`)
- `GOOGLE_PLACES_KEY` — Places API key (only read when GOOGLE_PLACES=on).
- `GOOGLE_PLACES_MONTHLY_CAP` — Hard stop for Places calls per month. (default: `900`)
- `OPENAI_MODEL_DRAFTS` — Model for outreach drafts via generateObject (reuses OPENAI_API_KEY). (default: `gpt-4.1-mini`)
- `REPORT_TTL_DAYS` — Days a /r/[token] report stays readable after the first send. (default: `90`)
- `LEAD_TELEGRAM` — Existing key; 'off' silences all Telegram pings including the new CRM ones. (default: `(unset = on)`)
- `ENQUIRIES_DB_PATH` — Existing key; the CRM tables live in the same SQLite file (staging: /home/hermes/data/enquiries-staging.db). (default: `/home/hermes/data/enquiries.db`)

## Appendix C — routes

| path | kind | auth | purpose |
|---|---|---|---|
| `/admin/login` | page | public; outside (gated); Turnstile + honeypot; 5/10 min per IP | Shared-password login form via LoginForm (foundation) |
| `/api/admin/login` | api | public; rate-limited; shared verifyTurnstile; scrypt verify | Sets the dm_admin v1 HMAC cookie (foundation) |
| `/api/admin/logout` | api | cookie + CSRF (POST) | Clears the cookie (foundation) |
| `/api/admin/jobs` | api | cookie (+CSRF on POST) | GET queue status; POST requeue/cancel a job (foundation) |
| `/admin` | page | middleware edge check + requireAdmin('/admin') | Today cards incl. purge age, STOP-replies reminder, bounces (inbox) |
| `/admin/leads` | page | edge + requireAdmin | All leads, filters, search, inline stage (inbox) |
| `/admin/leads/[id]` | page | edge + requireAdmin | Lead facts, stage, next action, timeline; call/Gmail buttons post to outreach routes (inbox) |
| `/api/admin/leads` | api | cookie + CSRF | POST create a manual lead (inbox) |
| `/api/admin/leads/backfill` | api | cookie + CSRF | POST idempotent backfill of enquiries into leads (inbox) |
| `/api/admin/leads/[id]` | api | cookie + CSRF | POST patch stage / next action / note / merge (inbox) |
| `/api/admin/leads/[id]/activity` | api | cookie + CSRF | POST note, mark_replied, bounce {send_reference} only (inbox) |
| `/admin/find` | page | edge + requireAdmin | Area + category (19 keys or custom) search across OSM / FR register / Companies House; tick to save; attribution footer; past searches (finder) |
| `/api/admin/find` | api | cookie + CSRF | POST run a search, ≤ 45 s, cached 24 h (finder) |
| `/api/admin/find/save` | api | cookie + CSRF | POST save ticked rows with 30-day notice deadline, enqueue audits; 422 on partial-diffusion picks (finder) |
| `/admin/prospects` | page | edge + requireAdmin | Views ready / call / all / not_fit from READY_WHERE and CALL_WHERE, badges, bulk Audit next 20 (finder) |
| `/admin/prospects/[id]` | page | edge + requireAdmin | Register, website, Google blocks plus the four self-loading panels (finder page; panels from audit/report/outreach) |
| `/api/admin/prospects` | api | cookie + CSRF | POST add by URL with country (finder) |
| `/api/admin/prospects/[id]` | api | cookie + CSRF | POST patch fit / locale / website / validated overrides / forbids override reason / not-this-business / recollect (finder) |
| `/api/admin/prospects/audit-next` | api | cookie + CSRF | POST enqueue up to 20 deduped audit jobs (finder) |
| `/api/admin/prospects/[id]/google` | api | cookie + CSRF | POST find / confirm / clear; 501 google_off while GOOGLE_PLACES=off (finder) |
| `/api/admin/prospects/[id]/audit` | api | cookie (+CSRF on POST) | GET AuditBlock state (latest audit, queue position); POST enqueue one audit, deduped (audit) |
| `/api/admin/prospects/[id]/draft` | api | cookie (+CSRF on POST) | GET DraftPanel state; POST generate or regenerate the four-field draft (report) |
| `/api/admin/drafts/[id]` | api | cookie + CSRF | POST save edits; sets edited_at and reviewed_at (report) |
| `/r/[token]` | public-page | 43-char token; 60/10 min per IP in middleware; X-Robots-Tag noindex; 404 unknown; expired view with 200 | The prospect's one-page FR/EN report with print CSS and bot/admin/prefetch-filtered view logging (report) |
| `/api/admin/prospects/[id]/send` | api | cookie (+CSRF on POST) | GET SendPanel state (recipient, legal block preview, refusals, cap); POST send the reviewed draft or return every refusal (outreach) |
| `/api/admin/prospects/[id]/manual-send` | api | cookie + CSRF | POST {action:'prepare', draftId|'followup'} → text with legal block and pending send; POST {action:'record', sendId} → marks sent (outreach) |
| `/api/admin/prospects/[id]/call` | api | cookie (+CSRF on POST) | GET CallPanel state (window, attempts, screening, script); POST log a call with outcome; register re-check, hours, 4/30 d, GB TPS screening (outreach) |
| `/o/[token]` | public-page | token; 30/10 min per IP in middleware; unknown → 404 with invalid-link text | Opt-out confirmation page FR/EN, one button posting a form to /api/o/[token] (outreach) |
| `/api/o/[token]` | api | token; no CSRF; JSON/form 10/10 min per IP; one-click 5/min per token | GET → 303 to /o/[token]; POST records the opt-out (JSON, form → 303 ?done=1, or List-Unsubscribe=One-Click → 200), idempotent (outreach) |
| `/admin/optouts` | page | edge + requireAdmin | Opposition list with hashes, channel, date, links; manual add by email/phone/lead/prospect/send reference (outreach) |
| `/api/admin/optouts` | api | cookie + CSRF | POST manual add by email/phone/lead_id/prospect_id or {send_reference, source:'reply_stop'}; used by Mark STOP (outreach) |

## Appendix D — legal text

### fr_footer

—
Pour ne plus recevoir nos messages : répondez STOP à cet e-mail ou cliquez ici : {optout_url}

Digital M — nom commercial de Digital Management Ltd, société immatriculée en Angleterre et au pays de Galles (n° 09457882), établissement en France : 3 Résidence des Écoles, 09000 Ferrières-sur-Ariège. Contact : contact@digitalm.eu.
Pourquoi vous recevez ce message : nous avons relevé le nom et l'adresse de votre établissement sur {identity_source} ({identity_url}) le {saved_date}, et votre adresse e-mail professionnelle sur {email_source} le {audit_date}, dans le cadre de votre activité de {trade}. Nous vous écrivons sur la base de notre intérêt légitime — la prospection commerciale entre professionnels, en rapport avec votre activité (art. 6.1.f du RGPD ; art. L34-5 du CPCE).
Vos données (dénomination, adresse, e-mail et téléphone professionnels, éléments techniques publics de votre site) sont conservées au maximum 3 ans après notre dernier échange (12 mois sans réponse de votre part), puis supprimées. Vous pouvez à tout moment demander l'accès, la rectification ou la suppression de vos données, ou vous opposer à leur traitement, en écrivant à contact@digitalm.eu, et introduire une réclamation auprès de la CNIL. Détails : {privacy_url}
Si vous exercez en entreprise individuelle, ce message vaut information au titre de l'article 14 du RGPD.

### en_footer_fr

—
To stop receiving our emails: reply STOP or click here: {optout_url}

Digital M is a trading name of Digital Management Ltd, registered in England and Wales (company no. 09457882), French establishment: 3 Résidence des Écoles, 09000 Ferrières-sur-Ariège, France. Contact: contact@digitalm.eu.
Why you are receiving this: we found your business's name and address on {identity_source} ({identity_url}) on {saved_date}, and your business email address on {email_source} on {audit_date}, in connection with your {trade} business. We are writing under our legitimate interest — business-to-business prospecting related to your trade (Article 6(1)(f) GDPR; art. L34-5 of the French CPCE).
We keep the details we hold (business name, address, business email and phone, public technical facts about your website) for at most 3 years after our last exchange (12 months without a reply), then delete them. You can ask to access, correct or delete them, or object to their use, at any time by emailing contact@digitalm.eu, and you can complain to the CNIL (cnil.fr). Details: {privacy_url}
If you trade as a sole trader, this message is the information notice under Article 14 GDPR.

### en_footer_uk

—
To stop receiving our emails: reply STOP or click here: {optout_url}

Digital M is a trading name of Digital Management Ltd, registered in England and Wales (company no. 09457882), 67 Meridian Centre, Havant, Hampshire, PO9 1UN, United Kingdom. Contact: contact@digitalm.eu.
Why you are receiving this: we found your business's name and address on {identity_source} ({identity_url}) on {saved_date}, and your business email address on {email_source} on {audit_date}, in connection with your {trade} business. We are writing to you as a corporate subscriber: regulation 22 of the Privacy and Electronic Communications Regulations 2003 does not require your prior consent for this message, and you can opt out at any time (regulation 23). Our lawful basis is our legitimate interest under Article 6(1)(f) of the UK GDPR.
We keep the details we hold (business name, address, business email and phone, public technical facts about your website) for at most 3 years after our last exchange (12 months without a reply). You can ask to access, correct or delete them, or object to their use, at any time by emailing contact@digitalm.eu, and you can complain to the Information Commissioner's Office (ico.org.uk). Details: {privacy_url}

### en_footer_us

—
To stop receiving our emails: reply STOP or click here: {optout_url} — we honour every request at once, and in any case within 10 business days.

This is a commercial message (advertisement) from Digital M, a trading name of Digital Management Ltd, 67 Meridian Centre, Havant, Hampshire, PO9 1UN, United Kingdom. Contact: contact@digitalm.eu.
Why you are receiving this: we found your business's name and address on {identity_source} ({identity_url}) on {saved_date}, and your business email address on {email_source} on {audit_date}, and are writing about services related to your {trade} business. We keep the details we hold for at most 3 years after our last exchange (12 months without a reply); you can ask us to delete them at any time by emailing contact@digitalm.eu. Lawful basis: our legitimate interest (Article 6(1)(f) GDPR / UK GDPR) in offering trade-related services to businesses. You can ask to access, correct or delete your details, or object to their use, at contact@digitalm.eu, and you can complain to the Information Commissioner's Office (ico.org.uk). Privacy notice: {privacy_url}

### fr_optout_page

TITRE : Ne plus recevoir nos e-mails

TEXTE : Vous vous apprêtez à demander à Digital M (Digital Management Ltd) de ne plus vous envoyer d'e-mails de prospection. Aucune identification, aucune raison à donner. Votre adresse sera ajoutée à notre liste d'opposition, consultée avant chaque envoi et conservée sans limite de durée, tant que nous faisons de la prospection — c'est ce qui garantit que vous ne serez plus contacté.

BOUTON : Confirmer : ne plus me contacter

CONFIRMÉ : C'est noté. Vous ne recevrez plus d'e-mails de prospection de notre part. Si vous souhaitez aussi la suppression de vos données, écrivez à contact@digitalm.eu.

DÉJÀ ENREGISTRÉ : Cette demande a déjà été enregistrée. Vous ne recevez plus nos e-mails de prospection.

LIEN INVALIDE : Ce lien n'est pas valide. Pour ne plus recevoir nos e-mails, écrivez STOP à contact@digitalm.eu.

PIED DE PAGE : Digital M — Digital Management Ltd · 3 Résidence des Écoles, 09000 Ferrières-sur-Ariège · Politique de confidentialité : {privacy_url}

### en_optout_page

TITLE: Stop receiving our emails

TEXT: You are about to ask Digital M (Digital Management Ltd) to stop sending you prospecting emails. No sign-in, no reason needed. Your address will be added to our suppression list, which is checked before every send and kept indefinitely, for as long as we prospect — that is what guarantees you will not be contacted again.

BUTTON: Confirm: do not contact me

DONE: Done. You will not receive any more prospecting emails from us. If you also want your data deleted, email contact@digitalm.eu.

ALREADY RECORDED: This request was already recorded. You no longer receive our prospecting emails.

INVALID LINK: This link is not valid. To stop receiving our emails, write STOP to contact@digitalm.eu.

FOOTER: Digital M — Digital Management Ltd · 67 Meridian Centre, Havant, Hampshire, PO9 1UN, United Kingdom · Privacy policy: {privacy_url}

### fr_privacy_section

TITRE : Prospection commerciale auprès des professionnels

Digital M démarche des entreprises et des professionnels (restaurants, artisans, commerces, hébergements…) pour leur proposer des services en rapport avec leur activité : site web, assistant IA, automatisation, sécurité. Données traitées : dénomination, enseigne, forme juridique, numéro SIRET ou d'immatriculation, adresse, coordonnées géographiques, site web, adresse e-mail et téléphone professionnels, liens vers les réseaux sociaux, et les constats techniques publics de votre site (HTTPS, vitesse, données structurées, etc.) qui composent le rapport que nous vous adressons. Sources : le registre national des entreprises (annuaire-entreprises.data.gouv.fr, base Sirene, licence ouverte), OpenStreetMap (données © les contributeurs d'OpenStreetMap, ODbL), Companies House (Royaume-Uni), et le site internet de votre entreprise, consulté par notre propre outil dans le respect de son fichier robots.txt et de ses mentions légales — nous ne collectons rien sur Google Maps, les Pages Jaunes, LinkedIn ou Facebook. Base juridique : notre intérêt légitime à proposer nos services aux professionnels dont l'activité y correspond (art. 6.1.f du RGPD ; art. L34-5 du CPCE), sans jamais démarcher d'adresses personnelles ; au plus deux e-mails, puis plus aucun sans réponse de votre part. Destinataires : Google Workspace (envoi des e-mails), OpenAI (rédaction assistée à partir des seuls constats techniques, jamais de données nominatives), Google PageSpeed Insights (test de vitesse de votre site), OVH (hébergement) ; Google Maps Platform si nous vérifions l'existence de votre fiche Google (nous ne conservons alors qu'un identifiant de fiche). Nous enregistrons l'ouverture du rapport que nous vous envoyons (date, référence), sans cookie. Durées : 3 ans après notre dernier échange, ou 12 mois sans réponse de votre part ; les adresses IP et leurs empreintes sont supprimées sous 12 mois ; votre demande de ne plus être contacté est conservée sans limite de durée dans notre liste d'opposition, tant que nous faisons de la prospection, afin d'être respectée. Nous vous informons dès notre premier message et au plus tard un mois après la collecte ; passé ce délai sans contact, les données d'un entrepreneur individuel sont supprimées et les coordonnées nominatives d'une société sont effacées. Ce traitement est effectué par Digital Management Ltd depuis son établissement en France (3 Résidence des Écoles, 09000 Ferrières-sur-Ariège) ; l'autorité de contrôle compétente est la CNIL. Vous pouvez à tout moment vous opposer, gratuitement et sans motif, en répondant STOP à l'un de nos e-mails, en cliquant sur le lien de désinscription, ou en écrivant à contact@digitalm.eu ; vous disposez aussi des droits d'accès, de rectification et d'effacement, et du droit d'introduire une réclamation auprès de la CNIL (cnil.fr).

### en_privacy_section

TITLE: Business-to-business prospecting

Digital M contacts businesses and trade professionals (restaurants, tradespeople, shops, accommodation and similar) to offer services related to their activity: websites, AI assistants, automation, security. Data processed: business name and trading name, legal form, registration number, address, coordinates, website, business email and phone, social-media links, and the public technical facts about your website (HTTPS, speed, structured data and so on) that make up the report we send you. Sources: the French national business register (annuaire-entreprises.data.gouv.fr, Sirene, open licence), OpenStreetMap (data © OpenStreetMap contributors, ODbL), Companies House (UK), and your own website, read by our own tool while honouring its robots.txt and terms — we collect nothing from Google Maps, Pages Jaunes, LinkedIn or Facebook. Legal basis: our legitimate interest in offering our services to businesses whose activity matches them (Article 6(1)(f) UK GDPR / EU GDPR; for French recipients art. L34-5 CPCE; for UK recipients regulation 22 PECR does not require prior consent from corporate subscribers and regulation 23 gives you the right to opt out — sole traders and partnerships are not emailed without consent; for US recipients the CAN-SPAM Act: our emails are identified as advertising, carry a postal address and an opt-out honoured within 10 business days). We never email personal addresses, and we send at most two emails, then none without a reply from you. Recipients: Google Workspace (email), OpenAI (assisted drafting from technical findings only, never personal data), Google PageSpeed Insights (website speed test), OVH (hosting); Google Maps Platform if we check whether your business has a Google listing (we then keep only a listing identifier). We log when the report we send you is opened (date, reference), without cookies. Retention: 3 years after our last exchange, or 12 months without a reply; IP addresses and their hashes are deleted within 12 months; your request not to be contacted is kept indefinitely on our suppression list, for as long as we prospect, so that it is honoured. You are informed in our first message and at the latest one month after collection; after that deadline without contact, a sole trader's data is deleted and a company's named contact details are erased. This processing is carried out by Digital Management Ltd (67 Meridian Centre, Havant, Hampshire, PO9 1UN, United Kingdom) from its French establishment (3 Résidence des Écoles, 09000 Ferrières-sur-Ariège); the competent supervisory authority for EU recipients is the CNIL, and for UK recipients the Information Commissioner's Office. You can object at any time, free of charge and without giving a reason, by replying STOP to any of our emails, by clicking the unsubscribe link, or by emailing contact@digitalm.eu; you also have the rights of access, rectification and erasure, and the right to complain to the CNIL (cnil.fr) or the ICO (ico.org.uk).

## Appendix E — modules

### foundation (3.5 d)
Schema + additive migrations (applyCrmSchema), crm/types.ts (full Prospect/Audit interfaces), newReference(prefix, db?), scrypt + HMAC v1 cookie auth (Node auth.ts and Web Crypto authEdge.ts), rate-limited Turnstile login with LoginForm, per-page requireAdmin, (tools) root layout (noindex, no analytics) + (gated) shell (not a gate), middleware edge auth for /admin and per-IP limits for /r and /o, robots/next.config headers, DB-driven job runner from instrumentation.ts (re-queues running rows at start), api_cache/api_usage/http helpers, classify helpers incl. EMAIL_RE/safeHttpUrl, READY_WHERE/CALL_WHERE/outreachDailyCap in crm/db.ts, admin UI primitives incl. ExtLink, panel stubs taking {prospectId}, password hash script, node:test setup in package.json/tsconfig.json.

Owns: src/lib/crm/schema.ts, src/lib/crm/types.ts, src/lib/crm/db.ts, src/lib/crm/refs.ts, src/lib/crm/classify.ts, src/lib/crm/classify.test.ts, src/lib/crm/auth.ts, src/lib/crm/auth.test.ts, src/lib/crm/authEdge.ts, src/lib/crm/authEdge.test.ts, src/lib/crm/jobs.ts, src/lib/crm/jobHandlers.ts, src/lib/crm/apiUsage.ts, src/lib/crm/apiCache.ts, src/lib/crm/http.ts, src/lib/crm/nav.ts, src/instrumentation.ts, src/app/(tools)/layout.tsx, src/app/(tools)/not-found.tsx, src/app/(tools)/admin/(gated)/layout.tsx, src/app/(tools)/admin/login/page.tsx, src/components/admin/LoginForm.tsx, src/app/api/admin/login/route.ts, src/app/api/admin/logout/route.ts, src/app/api/admin/jobs/route.ts, src/components/admin/AdminShell.tsx, src/components/admin/Nav.tsx, src/components/admin/DataTable.tsx, src/components/admin/Badge.tsx, src/components/admin/Button.tsx, src/components/admin/Field.tsx, src/components/admin/Select.tsx, src/components/admin/Textarea.tsx, src/components/admin/Toast.tsx, src/components/admin/ConfirmButton.tsx, src/components/admin/EmptyState.tsx, src/components/admin/KeyValue.tsx, src/components/admin/Meter.tsx, src/components/admin/ExtLink.tsx, src/components/admin/adminFetch.ts

Shared appends: .env.example — inserts the six '# @@crm:<module>' marker lines (one blank line between) and fills '# @@crm:foundation', src/content/en.ts and src/content/fr.ts — inserts '// @@crm:outreach privacy section' as last element of legal.privacy.sections and '// @@crm:outreach notice section' as last element of legal.notice.sections, src/lib/crm/schema.ts EXTRA_COLUMNS — creates the six '// @@crm:<module>' markers, src/lib/crm/jobHandlers.ts — creates '// @@jobs:audit', '// @@jobs:outreach', '// @@jobs:inbox' markers

Depends on: 

Acceptance:
- curl -sI :3001/admin → 307 to /admin/login?next=%2Fadmin; curl -sI :3001/admin/login → 200 with no locale redirect; curl -sI :3001/r/x → 404 from the (tools) group, not /en/r/x
- curl -H 'RSC: 1' -H 'Next-Router-State-Tree: <tree copied from a logged-in response>' :3001/admin/leads without a cookie → 307 to login, response contains no lead data (middleware layer); with the middleware disabled locally the page itself still redirects (page layer)
- POST /api/admin/login with a wrong password 6 times → the 6th is 429; correct password → Set-Cookie dm_admin=v1.<payload>.<sig>; HttpOnly; SameSite=Lax; Path=/; a cookie with a truncated signature → 307, never a 500
- Set ADMIN_SESSION_VERSION=2 and restart → the old cookie gets 307 to login
- POST /api/admin/logout without x-dm-csrf → 403; with Origin https://evil.example → 403; with -H "Origin: $SITE_URL" and the right token → 200 and cookie cleared
- Prod-mode build: /robots.txt contains Disallow: /admin, /r/, /o/; /admin, /admin/login and /r/x responses carry X-Robots-Tag: noindex, nofollow and Cache-Control: no-store
- 61 requests to /r/x from one IP in 10 min → the 61st is 429 from middleware
- sqlite3 enquiries-staging.db .tables lists leads, activities, prospects, audits, jobs, drafts, sends, optouts, searches, api_usage, api_cache, settings; enquiries.lead_id and prospects.tps_checked_at exist once the markers are filled
- newReference('PR') 1000 times → 1000 distinct PR- refs; newReference() still returns DM-
- Insert a noop job → done within 10 s; a running job with claimed_at 6 min old → re-queued next tick; kill -9 the server mid-job → the job is re-queued at the next start and completes
- npm test green for classifyEmail, normaliseName, domainOf, safeHttpUrl (javascript:, data:, credentials refused), cookie sign/verify with authEdge and auth agreeing on the same vectors, csrfTokenFor
### inbox (3 d)
Leads and activities store (addActivity updates enquiries.last_contact_at), ensureLeadForProspect, append-only lead hooks in the enquiry/contact/book/chat/messenger routes at the fixed positions, idempotent backfill, same-email merge, utm_campaign=AU- attachment, /admin Today from raw SQL (incl. purge-age, STOP-replies and bounce cards), /admin/leads list and detail (activity route limited to note/mark_replied/bounce; call and Gmail buttons post to outreach routes), instant Telegram pings, read-only 08:00 digest script.

Owns: src/lib/inbox/leads.ts, src/lib/inbox/hooks.ts, src/lib/inbox/today.ts, src/app/(tools)/admin/(gated)/page.tsx, src/app/(tools)/admin/(gated)/leads/page.tsx, src/app/(tools)/admin/(gated)/leads/[id]/page.tsx, src/app/api/admin/leads/route.ts, src/app/api/admin/leads/backfill/route.ts, src/app/api/admin/leads/[id]/route.ts, src/app/api/admin/leads/[id]/activity/route.ts, src/components/admin/LeadTable.tsx, src/components/admin/LeadDetail.tsx, src/components/admin/Timeline.tsx, src/components/admin/StageSelect.tsx, src/components/admin/NextActionForm.tsx, src/components/admin/AddLeadForm.tsx, src/components/admin/TodayCards.tsx, /home/hermes/workspace/scripts/digitalm-digest.js

Shared appends: src/app/api/enquiry/route.ts — one import + one guarded call under '// @@crm:inbox' after the enquiry row is written, src/app/api/contact/route.ts — same, after validation, before the mail send, src/app/api/book/route.ts — same, after each successful branch (booked and requested), before its return, src/app/api/chat/route.ts — same, first statement inside the submit_lead execute, before the mailConfigured() check, src/app/api/messenger/route.ts — same, first statement inside the leadTool execute, src/lib/crm/schema.ts — '// @@crm:inbox': ['enquiries','lead_id','INTEGER'], .env.example — '# @@crm:inbox' (no new keys; documents LEAD_TELEGRAM reuse)

Depends on: foundation

Acceptance:
- POST /api/enquiry on staging → leads row kind=diagnostic with enquiry_reference and enquiries.lead_id set; /api/contact → contact; /api/book (both modes) → booking; chat submit_lead with SMTP_HOST blank → a chat lead is still created
- Second contact with the same email within 180 days → no new lead, one 'merged' activity on the existing lead
- POST /api/admin/leads/backfill twice → second response {created: 0}
- POST /api/admin/leads/[id] {stage:'replied'} → stage_change activity with {from,to}; activity route with kind 'call' → 400 (outreach owns calls); kind 'bounce' with send_reference → sends.status bounced and prospects.website_email_kind unknown
- Adding an email_out activity on a lead with enquiry_reference → enquiries.last_contact_at updated
- A diagnostic submitted with ?utm_campaign=AU-XXXXX of an existing audit → lead.prospect_id set and source_label 'Outreach report AU-XXXXX'
- node /home/hermes/workspace/scripts/digitalm-digest.js --db /home/hermes/data/enquiries-staging.db prints every section incl. 'STOP replies' and 'Purge last ran', exits 0, output contains no '@'; two runs leave PRAGMA data_version unchanged
- Today shows follow-ups due/overdue, new leads 7 d by source, emails today vs cap, audits queued/running, ready-to-send and call counts, Google month counter, bounces this week, a red purge card when settings.purge_last_run_at is missing
### finder (4 d)
Worldwide discovery: geocoding (geo.api.gouv.fr for France, Nominatim elsewhere, tiling, caching), Overpass/FR register/Companies House adapters behind DiscoveryAdapter with safeHttpUrl/validEmail on every foreign value, Google stub returning [], dedupe across sources, 19 categories + custom trade, /admin/find with tick-to-save (30-day notice deadline on every row, audits enqueued, attribution footer), /admin/prospects views from READY_WHERE/CALL_WHERE with badges, /admin/prospects/[id] page composing the self-loading panels, Add by URL, register re-check, wipePersonal and recollect, Audit next 20.

Owns: src/lib/discover/categories.ts, src/lib/discover/geocode.ts, src/lib/discover/overpass.ts, src/lib/discover/frRegister.ts, src/lib/discover/companiesHouse.ts, src/lib/discover/google.ts, src/lib/discover/dedupe.ts, src/lib/discover/dedupe.test.ts, src/lib/discover/index.ts, src/lib/prospects/store.ts, src/lib/prospects/registerCheck.ts, src/app/(tools)/admin/(gated)/find/page.tsx, src/app/(tools)/admin/(gated)/prospects/page.tsx, src/app/(tools)/admin/(gated)/prospects/[id]/page.tsx, src/app/api/admin/find/route.ts, src/app/api/admin/find/save/route.ts, src/app/api/admin/prospects/route.ts, src/app/api/admin/prospects/[id]/route.ts, src/app/api/admin/prospects/audit-next/route.ts, src/app/api/admin/prospects/[id]/google/route.ts, src/components/admin/FindForm.tsx, src/components/admin/ResultsTable.tsx, src/components/admin/ProspectTable.tsx, src/components/admin/ProspectBadges.tsx, src/components/admin/RegisterBlock.tsx, src/components/admin/WebsiteBlock.tsx, src/components/admin/GoogleBlock.tsx, src/components/admin/AddByUrl.tsx

Shared appends: .env.example — '# @@crm:finder': OVERPASS_URL, NOMINATIM_URL, FR_REGISTER_URL, COMPANIES_HOUSE_KEY, GOOGLE_PLACES, GOOGLE_PLACES_KEY, GOOGLE_PLACES_MONTHLY_CAP, READY_SCORE_MAX, src/lib/crm/schema.ts — '// @@crm:finder' only if a column beyond §2 is needed

Depends on: foundation

Acceptance:
- geocodeArea('Foix') → FR, provider geo_gouv, postcodes ['09000']; 'Havant' → GB nominatim; 'Portland, Oregon' → US; 'France' → area_too_large
- Five geocodes of five new towns take ≥ 4.4 s (Nominatim spacing); the same five again < 200 ms with api_usage nominatim unchanged
- POST /api/admin/find {area:'Foix', category:'bakery'} → rows from osm and fr_register with sourceUrl; no key 'dirigeants' anywhere in the JSON; a business present in both sources appears once with sources ['osm','fr_register']; an OSM website tag 'javascript:alert(1)' is dropped
- Custom trade {key:'custom:tattoo', osm:[{k:'shop',v:'tattoo'}]} runs against OSM only; searches.category_key = 'custom:tattoo'
- Save with a diffusion:'partial' pick → 422 listing it; two valid picks → two PR- references, both with notice_deadline_at = saved_at + 30 d, audits queued for those with a website, response {saved:2, auditsQueued, withoutWebsite}; the same save again → alreadySaved, zero new rows
- 'Havant' + hairdresser with COMPANIES_HOUSE_KEY → CH rows with soleTrader false and the 'registered office' marker; without the key → notes say Companies House is off
- GOOGLE_PLACES=off: googleAdapter.search() resolves [] with no HTTP; POST /prospects/[id]/google → 501 {error:'google_off'}
- Add by URL with country 'CA' → prospect saved country=CA locale=en, audit job enqueued, never listed in the ready view; a GB prospect with sole_trader NULL never appears in ready
- PATCH contact_email_override 'a@b.fr,c@d.fr' → 422; register re-check on a SIRET that became partial → contact fields nulled, personal_wiped_at set; PATCH {recollect:true} → personal_wiped_at null, new notice_deadline_at, activity recollect
- /admin/prospects/[id] renders RegisterBlock, WebsiteBlock, GoogleBlock and the four panels with only {prospectId} props; results footer shows the ODbL / Licence Ouverte / OGL attribution
### audit (3.5 d)
SSRF-safe crawler on node:http/https with DNS-vetted lookup override and net.BlockList (no undici), redirects re-validated by hand, 8 s, 2 MB, robots.txt, 3 pages at 1 req/s; TLS check pinned to the vetted IP; PageSpeed v5 mobile with 30-day reuse; extraction to scalars (EMAIL_RE, safeHttpUrl, e-commerce signal, forbids-extraction); the ten weighted checks; pure auditScore with flags/fits/top; audit job with daily cap (06:00 Europe/Paris reschedule) that respects personal_wiped_at; AuditBlock + its GET; FR/EN check copy with /pme package labels.

Owns: src/lib/audit/ssrf.ts, src/lib/audit/ssrf.test.ts, src/lib/audit/crawler.ts, src/lib/audit/tls.ts, src/lib/audit/pagespeed.ts, src/lib/audit/extract.ts, src/lib/audit/checks.ts, src/lib/audit/score.ts, src/lib/audit/score.test.ts, src/lib/audit/job.ts, src/content/auditChecks.ts, src/components/admin/AuditBlock.tsx (replaces stub), src/app/api/admin/prospects/[id]/audit/route.ts (GET panel state + POST enqueue)

Shared appends: src/lib/crm/jobHandlers.ts — one line under '// @@jobs:audit', .env.example — '# @@crm:audit': AUDIT_DAILY_CAP, PAGESPEED_API_KEY, PAGESPEED_URL, CRAWLER_USER_AGENT

Depends on: foundation

Acceptance:
- Audits for http://127.0.0.1:3002/, http://169.254.169.254/, http://[::1]/, http://[::ffff:127.0.0.1]/, a hostname resolving to 10.0.0.5, and a public URL that 302s to http://127.0.0.1/ each finish failed with error starting 'ssrf:' and no request reaches the target (verified with a listener on :3002 access log)
- A hostname whose first DNS answer is public and second is 127.0.0.1 → refused; the socket for an allowed host connects to the vetted IP (assert via a local test server and the lookup spy)
- A 3 MB HTML page → crawl[0].bytes = 2097152 and the audit completes
- robots.txt disallowing /contact → contact page skipped, contact check still measured from the home page
- https://digitalm.eu scores ≥ 75 with ai_ready pass (llms.txt) and google_listing not_measured
- No website → score 0, grade C, flags ['no-site'], fit WEB; a brochure site without https → fit WEB (not SEC); a WooCommerce site without https → fit SEC
- PSI unreachable (PAGESPEED_URL at a dead host) → speed partial, measured true
- The 51st audit of the day is re-scheduled to 06:00 Europe/Paris next day with a visible note
- 'Audit next 20' → ≤ 20 jobs; a repeated click reports deduped and creates no duplicate jobs; a prospect with personal_wiped_at set keeps website_email null after a new audit
- Unit tests: isPublicIp table (incl. mapped v6), auditScore on fixtures (all pass = 100; PSI timeout counts as partial; not_measured excluded); a mailto with two addresses → first valid address only
### report (2.5 d)
/r/[token] FR/EN report rendered only from stored checks with print stylesheet, branded 404, expired view (200), view logging that ignores bots, admin sessions, prefetches and pre-send opens, utm-tagged CTAs; safeDisplayName; LLM drafts via generateObject with zod caps, isMangled reuse, BANNED_WORDS/PII guards and FR/EN template fallback plus followUp template; DraftPanel with review gate + its GET.

Owns: src/app/(tools)/r/[token]/page.tsx, src/app/(tools)/r/[token]/report.css, src/components/report/ReportPage.tsx, src/components/report/ScoreMeter.tsx, src/components/report/CheckList.tsx, src/components/report/Findings.tsx, src/components/report/FirstSteps.tsx, src/components/report/ReportFooter.tsx, src/content/report.ts, src/lib/report/findings.ts, src/lib/report/view.ts, src/lib/drafts/generate.ts, src/lib/drafts/templates.ts, src/lib/drafts/templates.test.ts, src/lib/drafts/store.ts, src/components/admin/DraftPanel.tsx (replaces stub), src/app/api/admin/prospects/[id]/draft/route.ts (GET panel state + POST generate), src/app/api/admin/drafts/[id]/route.ts

Shared appends: .env.example — '# @@crm:report': OPENAI_MODEL_DRAFTS, REPORT_TTL_DAYS

Depends on: foundation, audit

Acceptance:
- GET /r/{token} → 200 FR for a fr prospect, EN for en; X-Robots-Tag present; before any send (report_expires_at null) no view is logged; after a send report_views increments and a report_view activity is written; with User-Agent Slackbot, with a valid dm_admin cookie, or with sec-fetch-dest: image → no view logged
- Prospect named <img src=x onerror=alert(1)> → page source contains &lt;img and no <img outside our markup; website 'javascript:alert(1)' renders as text
- Unknown token → branded 404; report_expires_at in the past → 200 expired view linking /{locale}/diagnostic
- Playwright emulateMedia print → buttons hidden, white background
- CTA links carry utm_source=outreach&utm_medium=email&utm_campaign=AU-…
- safeDisplayName: sole trader with enseigne 'MARTIN PLOMBERIE' and legal_name 'PAUL MARTIN' → 'votre établissement'; enseigne 'LE FOURNIL' → 'LE FOURNIL'
- generateDraft with OPENAI_API_KEY unset → fallback true, four fields within caps; with key → fallback false; mocked mangled response → one retry then template; a draft containing an email address or 'game-changer' → template; followUp('fr') and followUp('en') within caps
- POST /api/admin/drafts/[id] sets reviewed_at; GET …/send reports draft_unreviewed before that
### outreach (3.5 d)
Per-country SendRule table (FR/GB/US, default blocked incl. CA, env can only restrict, 30-day notice everywhere, GB calls screened, * calls manual), refusal engine returning every failing rule in FR/EN incl. max_emails_reached, lead_in_conversation and call_screening_missing, send engine writing the log before SMTP with attempts:1, legal footers chosen by rule and locale with two-part source notice, List-Unsubscribe to /api/o, prepared manual sends and 7-day follow-up with the legal block, /o/[token] page + not-found, /api/o GET/POST (JSON, form, one-click per-token limit), /admin/optouts with manual add incl. reply-STOP by send reference, call log with register re-check, hours, TPS checkbox and 4/30 d counter, retention purge script with VACUUM INTO backup and purge_last_run_at, privacy and notice sections, LIA and Art. 30 register docs.

Owns: src/lib/outreach/rules.ts, src/lib/outreach/rules.test.ts, src/lib/outreach/refusals.ts, src/lib/outreach/refusals.test.ts, src/lib/outreach/legal.ts, src/lib/outreach/legal.test.ts, src/lib/outreach/send.ts, src/lib/outreach/optout.ts, src/lib/outreach/calls.ts, src/content/outreach.ts, src/app/(tools)/o/[token]/page.tsx, src/app/(tools)/o/[token]/not-found.tsx, src/app/api/o/[token]/route.ts, src/app/(tools)/admin/(gated)/optouts/page.tsx, src/app/api/admin/optouts/route.ts, src/app/api/admin/prospects/[id]/send/route.ts (GET panel state + POST send), src/app/api/admin/prospects/[id]/call/route.ts (GET panel state + POST log), src/app/api/admin/prospects/[id]/manual-send/route.ts (POST prepare | record), src/components/admin/SendPanel.tsx (replaces stub), src/components/admin/CallPanel.tsx (replaces stub), src/components/admin/OptoutTable.tsx, /home/hermes/workspace/scripts/digitalm-purge.js, docs/leadgen-lia.md, docs/leadgen-registre-art30.md

Shared appends: src/lib/mail.ts — additive under '// @@crm:outreach': from?, replyTo?, headers?, attempts?, {address} recipients, return {messageId}, export { esc }, src/content/en.ts and src/content/fr.ts — fill '// @@crm:outreach privacy section' with the Prospection section and '// @@crm:outreach notice section' with the French-establishment entry (SIRET placeholder); may update legal.privacy.updated and legal.notice.updated, src/lib/crm/schema.ts — '// @@crm:outreach': ['prospects','tps_checked_at','TEXT'], .env.example — '# @@crm:outreach': OUTREACH_FROM, OUTREACH_FROM_NAME, OUTREACH_REPLY_TO, OUTREACH_DAILY_CAP, OUTREACH_COUNTRY_ALLOW (restrict-only note)

Depends on: foundation, finder, report, inbox

Acceptance:
- Send with SMTP_HOST at a dead host → returns within 15 s; a sends row exists with status failed, body_text and legal_block filled, created_at earlier than the SMTP error log line; Telegram alert fired
- Each refusal code reproduced with a fixture listed in the PR: webmail address, opted-out hash, emailed 10 d ago, two sends in 90 d (max_emails_reached), audit 91 d old, 10 sends today, forbids_extraction=1, register ceased, any-country prospect saved 31 d ago without notice (notice_deadline_passed), GB sole_trader=1, GB sole_trader=NULL, country=CA, OUTREACH_COUNTRY_ALLOW=FR,GB,US,CA still CA blocked, unreviewed draft, lead stage stop, lead stage replied (lead_in_conversation)
- Successful send on staging to CONTACT_FORM_TO: From is "Radu — Digital M" <…>; text ends with the FR block, the opt-out line is the first line after the rule and stands alone; the notice names the identity source and the website page the address came from; List-Unsubscribe points at /api/o/{token} and List-Unsubscribe-Post present; prospects.notice_sent_at, last_emailed_at and audits.report_expires_at set; lead kind=outreach with next_action_at = +7 d; a fr prospect with locale en gets the en_footer_fr block
- prepareManualSend returns text containing the resolved opt-out URL and creates a pending manual_email row; recordManualSend on an unprepared id → 409; after record → sent, same prospect/lead updates; a third email (any channel) → max_emails_reached
- GET /o/{token} → 200 FR text; unknown token → 404 with the INVALID LINK text; GET /api/o/{token} → 303 to /o/{token}; POST /api/o/{token} JSON → optouts row, opted_out_at, lead stage stop; second POST → already recorded; POST body List-Unsubscribe=One-Click → 200 and the 6th within a minute for the same token → 429; next send refused optout_listed; POST /api/admin/optouts {send_reference, source:'reply_stop'} → row with the send's to_hash
- US prospect footer contains 67 Meridian Centre, the word advertisement, Article 6(1)(f) and ico.org.uk; UK footer says reg 22 does not require consent and cites reg 23; FR footer contains 3 Résidence des Écoles, 09000 Ferrières-sur-Ariège; OSM-sourced footer contains 'ODbL'
- Calls: 4 in 30 d → 5th refused call_attempts_exceeded; 13:30 Paris → call_window_closed; GB without the TPS checkbox → call_screening_missing, with it → logged and tps_checked_at set; country DE → panel shows the manual-rule warning and still logs; outcome refused → optout row with phone_hash; a SIRET that ceased → register_inactive before any call
- digitalm-purge.js dry run prints counts and writes nothing (DB opened read-only); --apply creates /home/hermes/data/backups/ and a dated backup, deletes the fixture sole trader past day 30, wipes a GB company past day 30 keeping its generic contact@, nulls leads.ip older than 12 m, keeps optouts intact, keeps ≤ 3 audits per prospect, writes settings.purge_last_run_at

## Appendix F — open questions

- Scheduler (two approval items under shared-server rule 9): (1) digest — hermes cron no-agent job `0 8 * * *`, wrapper ~/.hermes/scripts/run-digitalm-digest.sh → /home/hermes/.local/bin/node /home/hermes/workspace/scripts/digitalm-digest.js, `--deliver telegram` (supersedes `scripts/leadgen-digest.py` in the decisions doc); (2) purge — replace hermes job 518a81934ab4 (monthly, broken since 1 Sep: hermes prefixes its scripts dir so `node …` is not found) by a daily `0 4 * * *` no-agent job running digitalm-purge.js --apply via a wrapper. A user crontab (currently empty) is the alternative for both. The hermes 120 s script timeout is enough for both scripts on this DB size.
- Radu signs off before the first production send: FR footer, en_footer_fr, EN UK/US footers, the /o page texts, the privacy and mentions-légales sections (src/content/outreach.ts, en.ts, fr.ts), docs/leadgen-lia.md and docs/leadgen-registre-art30.md.
- French establishment: the footers and privacy text rely on the Ferrières-sur-Ariège establishment; the SIRET does not exist yet (INPI registration pending). Either the SIRET lands before the first send (placeholder in legal.notice.sections) or an Art. 27 EU representative is appointed; the LIA records which.
- Sending identity: OUTREACH_FROM defaults to CONTACT_FORM_FROM (contact@digitalm.eu) with display name 'Radu — Digital M'. Sending 10/day from the mailbox that carries client mail is the plan's stated deliverability risk; a separate outreach@ Workspace user or a verified send-as alias is recommended before raising the cap. SPF/DKIM/DMARC to be checked for whichever address is used.
- GB calls are 'screened': PECR reg 21 forbids live marketing calls to TPS/CTPS-registered numbers, and screening needs a TPS licence. Decide whether to buy TPS/CTPS access or to treat GB as manual/no-call; until then the CallPanel checkbox is Radu's attestation.
- Notice deadline on every prospect (30 days, every country): rows saved and never contacted are wiped or deleted by the purge. This makes the daily purge load-bearing; if the purge does not run, Today and the digest show a red warning, but nothing else enforces it.
- READY_SCORE_MAX default 60 (grades B and C); plan decision 3 offered 'only grade C' (< 50).
- Categories: the 19 NAF/SIC codes were re-checked from memory against NAF rév. 2 and UK SIC 2007 on 10 Sep (10.71C vs 47.24Z for bakeries kept as manufacture + retail); the finder engineer confirms against the INSEE and ONS lists before merge.
- Nominatim and Overpass public instances forbid heavy use; the contract limits them to 1 req/s, area-level geocoding with 30-day caching and 24-hour Overpass caching. If volumes grow, switch NOMINATIM_URL/OVERPASS_URL to a self-hosted or paid instance.
- US call windows use America/New_York when the prospect's timezone is unknown; a per-prospect timezone from coordinates is a small follow-up.
- Non-French EU recipients (BE, CH, LU, DE, AT…): email blocked and calls 'manual' for every country other than FR/GB/US; adding a country means one SendRule row, a footer variant, and Radu's legal check (DE §7 UWG and AT §174 TKG restrict cold B2B calls).
- Staging has no SMTP by design, so the successful-send acceptance test needs SMTP_* temporarily pointed at a mailbox delivering to CONTACT_FORM_TO; agree who does that and when.
- Google Places stays off (GOOGLE_PLACES=off); google_listing stays grey and its 10 points leave the denominator until billing is enabled and the adapter is implemented (interface and 900/month hard stop in place).
- The AI-readiness check treats blocked GPTBot/ClaudeBot/PerplexityBot/Google-Extended as a fail; the report wording says 'AI assistants cannot read your site', not 'error' — confirm Radu is happy with that framing.
- Foundation grows to 3.5 days (edge auth, tests setup, panel GET conventions) and outreach to 3.5 (manual-send flow, LIA/register docs): total 20 days instead of 19.
## 16. finder-ux

The finder described in §6 was redesigned on 12 Sep 2026: **`docs/finder-ux-spec.md` wins over §6 wherever they differ** (polygon areas instead of bounding rectangles, regions and countries accepted behind a cap gate, a background runner with progress instead of a 40 s budget, plain-word notes). API contract (spec §4), all under the existing auth/CSRF rules:

- `POST /api/admin/find` `{ area, category, sources?, pick?: { osmType, osmId }, confirmCap? }` → `202 { ok, searchId, area: ResolvedArea, plan: { expected, cap, units, estimateMs }, alternatives? }` started · `200 { ok, gate: "over_cap", area, plan: { expected, cap, units: [{ id, label, code, countryCode }], estimateMs } }` not started (`expected` is `null` when the map service could not count a region or country — the gate still shows) · `409 ambiguous { candidates }` · `409 search_running { searchId, area, trade }` · `404 area_not_found` · `502 geocode_failed` · `400 bad_area | bad_category | bad_request`.
- `GET /api/admin/find?id=N[&after=K&v=V]` → `200 { ok, ...SearchResultV2 }`; with `after` and a matching `v` (`progress.rowsVersion`) `rows` holds only the rows from index K, `total` the full length; `404 search_expired`.
- `POST /api/admin/find/cancel { searchId }` → `{ ok, status }` · `POST /api/admin/find/continue { searchId }` → `202` (`409 not_continuable`, `409 search_running`, `410 search_expired`) · `POST /api/admin/find/dismiss { searchId, key, undo? }` → `{ ok, hidden }` · `GET /api/admin/find/recent?limit=20` → `{ ok, searches: SearchSummaryV2[] }` · `POST /api/admin/find/save { searchId, picks }` → the §6 response plus `prospectIds` (`409 hidden { picks }`, `422 partial_diffusion { picks }`, `410 search_expired`) · `POST /api/admin/prospects/backfill-towns {}` → `{ ok, filled, remaining }`.
- Types: `src/lib/crm/types.ts` under `// @@finder-ux:types` (`ResolvedArea`, `SearchProgress`, `ResultRow`, `SearchResultV2`, `SearchSummaryV2`, `SearchNote`). Schema: `searches.status/progress/plan/dismissed`, `prospects.city_approx/source_socials`. Env: `FIND_MAX_ROWS=2000`, `FIND_MAX_UNITS=200`, `FIND_MAX_MS=600000`.
