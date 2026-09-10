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

**Outreach module status.** The outreach module (sends, opt-outs, calls, legal blocks, `/o/[token]`) is not merged; `src/lib/crm/features.ts` (`OUTREACH_MODULE = false`) hides every control that would contact a prospect. No prospect may be contacted from a build with the flag off. The privacy and notice sections, `docs/leadgen-lia.md` and `docs/leadgen-registre-art30.md` are drafted for Radu's signature.

**Staging smoke (spec §13).** After `npm run build` and `systemctl --user restart digitalm-staging`: `/fr`, `/en`, `/fr/diagnostic` still 200; `/admin/login` 200; `curl -H 'RSC: 1' :3001/admin/leads` without a cookie → 307, never data; log in; every admin page 200; Add by URL → audit done → draft; `/r/x` → branded 404 with `X-Robots-Tag: noindex` and `Cache-Control: no-store`; `/api/admin/jobs` → 401 without a cookie; digest and purge scripts run on the staging DB with `--db`.
