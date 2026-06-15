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
