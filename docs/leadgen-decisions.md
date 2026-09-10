# Lead-gen CRM — decisions (10 Sep 2026)

Radu's answers on top of `leadgen-crm-plan.md`:

- **Scope:** build everything (both blocks, ~19 days) in one run, on branch `feat/admin-crm`.
- **Territory:** worldwide. The finder takes any geographic area typed by Radu (town / region / country) plus a trade; no default limitation to Ariège.
- **Google Places:** off for now (`GOOGLE_PLACES=off`), adapter kept so a key can be added later. Discovery sources: OpenStreetMap Overpass (worldwide), API Recherche d'entreprises (France), Companies House (UK, optional key).
- **Sending:** from the existing site mailbox (`CONTACT_FORM_FROM`, display name "Radu — Digital M"), `OUTREACH_FROM` env override kept. Daily cap starts at 10.
- **Per-country email rules:** France (CNIL B2B), United Kingdom (PECR — corporate only, sole traders call-only), United States (CAN-SPAM). Canada and all other countries: no in-app email, call/manual only.
- **Cron:** approved — one entry in hermes's crontab at 08:00 for the Telegram digest (`scripts/leadgen-digest.py`, idempotent).
- **Auth:** one shared password (scrypt + signed cookie), second sign-in method later.
- **Languages:** FR + EN reports/emails; language defaults from country, overridable.
- **Defaults chosen by the agent (change any time):** ~15 trades list + free-text category; "ready to send" threshold score < 60; email when a usable professional address exists, otherwise call (weekdays 10–13 / 14–20 local, max 4 attempts per 30 days); French establishment address in footers; legal texts to be signed off by Radu before the first send.
