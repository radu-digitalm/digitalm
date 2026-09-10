# Prospecting tool for Digital M — decision plan (10 Sep 2026)

Legend: (V) checked on the linked page · (estimate) my number · (U) not confirmed on a primary page

## 1. What LeadsGorilla does, in one paragraph

You type a trade and a town; it pulls local businesses from Google Maps and Facebook pages, gives each a secret "LeadsScore" (lower = less optimised = easier to sell to), and lets you filter by rating, review count and claimed/unclaimed listing. It runs on your own Google Cloud key with a credit card attached (V https://leadsgorilla.reamaze.com/kb/google-api-keys/google-leads-location-error-this-page-cant-load-google-maps-correctly). For each business it makes a branded PDF audit (listing status, reviews, mobile site, SSL, schema, socials, 3-pack rank), then sends templated or AI-written cold emails from your Gmail or SMTP, with follow-ups and a basic lead list (V https://leadsgorilla.io/home/, https://leadsgorilla.ai/3-0/). Prices differ by page: $37–47 one-time, $57–97 a month, or $197–397 a month for the new "AI sales agents" version, plus Google API spend on top (V https://leadsgorilla.io/, https://leadsgorilla.ai/). Reviews are split: 4.3/5 on Trustpilot with 22% one-star, mostly refunds and API-key trouble (V https://www.trustpilot.com/review/leadsgorilla.io). No AI-readiness check exists on any page I could reach.

### What we'd build instead

- **Copy:** trade + town search, a short technical check of each website, a transparent "worst first" score, a one-page report link as the door-opener, a short email with follow-up reminders.
- **Skip:** the secret score, Facebook/Yelp/citation reports, claimed/unclaimed (Google's API does not expose it — V https://developers.google.com/my-business/content/overview), reseller licences, phone scripts sold as add-ons, any scraping of Google Maps, Pages Jaunes or LinkedIn.
- **Do better because we know our own stack:** an AI-readiness check (AI bots blocked, llms.txt, chat or WhatsApp, structured data) that is exactly our pitch; each finding mapped to one of our fixed packages (WEB, AGENT, SEC, AUTO); and one inbox that also holds the diagnostics, bookings, contact-form and ChatGPT Ads leads we already receive. LeadsGorilla cannot do that.

## 2. The MVP

Built inside digitalm.eu (same Next.js app, same SQLite file, same mail, Telegram and OpenAI plumbing). One shared password. No new server, port or service.

### Screens

- **/admin/login** — password + Turnstile + honeypot; 5 tries per 10 minutes per IP; signed cookie, 7 days; a version number in .env logs everyone out when rotated.
- **/admin (Today)** — follow-ups due and overdue; new leads last 7 days by source (ChatGPT Ads FR/EN, Google, direct, outreach); reports opened with no reply; emails sent today vs cap; audits queued/running; Google calls this month vs 900.
- **/admin/leads** — every lead in one table: reference, kind (diagnostic, booking, contact, chat, Messenger, outreach, manual), name/company, source label, stage, next action, last activity. Filters, search, inline stage change, "Add lead".
- **/admin/leads/[id]** — facts (email + kind, phone, locale, legal basis, where the data came from, notice sent date), stage, next action + note, timeline (notes, emails out, calls, report views, opt-out), actions (note, log call, send email, copy call script, mark replied, mark STOP, "sent from Gmail / by phone"), linked diagnostic and audit cards.
- **/admin/find** — commune (from communes.ts) or postcode + trade (about 15 trades) → live results from the French company register; sole-trader and diffusion flags; "already saved" marker; tick rows → save. Nothing unticked is stored. Past searches listed. "Add by URL" for a business you already know.
- **/admin/prospects** — saved businesses, worst score first. Default view "ready to send" (audited, score under threshold, usable address, not opposed, not contacted in 90 days, notice deadline not passed), capped at 20. Badges: needs website / email / phone, call instead, 30-day notice deadline, not a fit. Bulk "Audit next 20", "Find on Google".
- **/admin/prospects/[id]** — register block (SIRET, legal name, enseigne, trade, sole-trader flag, address, diffusion status, source URL, date saved); website block (URL, email + kind + page found on, phone from the site's tel: link, socials, CMS — every value carries its source); Google block ("Find on Google", "Show Google card" live and attributed, "Not this business", "Use this website"); audit block (score, grade, ten checks with values and weights, flags, fits, "Run again"); drafts (subject, email, call script, note for you; editable; "Regenerate"); send panel (recipient, legal block preview, any blocking reason in plain words, Send).
- **/admin/optouts** — the opposition list: hashed email/phone, channel, date, linked lead. Manual add.
- **/r/[token] (public, noindex)** — the one-page report the prospect opens. Served on a 20+ character random token, not the AU-XXXXX reference; expires 90 days after sending.
- **/o/[token] (public)** — "stop receiving our emails": one confirm button, no login, no reason asked.

### The pipeline in 6 steps

1. **Find** — /admin/find calls the free register (https://recherche-entreprises.api.gouv.fr) by trade code + postcode, at most 5 requests a second, each page cached 24 h. The app keeps only name, enseigne, SIRET, legal form, address, coordinates and diffusion status; directors and finances in the answer are dropped before they reach the screen. You tick, we save. Partial-diffusion rows cannot be saved. Missing coordinates fall back to the commune centre.
2. **Enrich** — for a saved business, "Find on Google" runs one Text Search (name, address, location fields), compares name and distance in memory, stores only the place_id, and discards the rest. One Place Details call reads the website address once; our own crawler then fetches the site (home, contact, mentions légales; robots.txt respected; 1 request a second) and stores the address it resolved itself, the contact email and its kind (company generic / named / sole-trader / private webmail), the phone from a tel: link, socials and CMS. If the mentions légales or CGU page forbids extraction for prospecting, the site is flagged: no email stored, no send, unless you override with a reason. **Without a Google key you type the URL by hand; everything else still works.**
3. **Audit** — "Run audit" / "Audit next 20" put jobs in a queue; a runner inside the app takes one at a time (claimed with an atomic database update, stale jobs re-queued after 5 minutes, resumed after a restart). Per request: 8 s for page fetches, socket timeout on the TLS check, 90 s for PageSpeed, which runs in parallel with the crawl. Cap 50 audits a day. No website = a "no site" audit, the simplest pitch.
4. **Score** — a pure function with visible weights (below). Flags map to the package that fits.
5. **Report** — /r/[token] rendered only from stored checks, in the audit's language (FR or EN); each open is logged on the lead (reference only sent to Umami).
6. **Reach out and follow up** — "Draft" makes subject, email, 30-second call script and a note for you in one model call, from the checks only. You edit, press Send. Code adds the legal block and the stop link, refuses the send when any rule fails (private address, opposition list, emailed in the last 90 days, audit older than 90 days, daily cap, site forbids extraction, SIRET no longer in the register, address outside France), writes the send log **before** talking to SMTP, then updates it. Phone-only prospects get a "call" action with the hours and a 4-per-30-days counter. The 08:00 Telegram digest lists what is due. Second email by hand after 7 days without reply, never a third; closed as no_response after 21 days.

### The score (what counts)

Ten checks, weights sum to 100. Score = points earned ÷ weights measured × 100; "not measured" leaves the denominator, but a PageSpeed timeout counts as amber, not "not measured", so slow sites do not gain from it.

| Check | Weight | Pass when |
|---|---|---|
| Site reachable | 10 | Homepage answers |
| HTTPS | 10 | Valid certificate, http→https redirect, HSTS |
| Speed on a phone | 15 | PageSpeed mobile performance score |
| Mobile and SEO basics | 10 | PageSpeed SEO score, viewport, title, description |
| Contact and booking | 10 | tel:, email or form, booking link |
| Social links | 5 | Facebook / Instagram / LinkedIn / TikTok / YouTube found |
| Structured data | 10 | LocalBusiness/Organization JSON-LD with phone and hours |
| AI readiness | 15 | AI bots not blocked in robots.txt, llms.txt, chat or WhatsApp |
| Google listing | 10 | Counted only after you opened the card once and confirmed; grey "not verified" before that |
| Housekeeping | 5 | Current copyright year, mentions légales page, no mixed content |

Grade A ≥ 75, B 50–74, C < 50. Flags: no-site, no-ssl, cert-expiring, slow-mobile, not-mobile, no-contact, no-booking, no-socials, no-schema, blocks-ai, no-chat, no-gbp, stale-site, forbids-extraction.

### The report (sections)

- Title "Votre présence en ligne : {business}" (EN version for businesses that prefer English)
- Score meter and grade
- Top 3 findings in plain words
- Full list of the ten checks, green / amber / grey
- "What we would do first" — 3 lines, with the package and its fixed price
- Google line in our own words only: "fiche Google trouvée" or "nous n'avons pas trouvé de fiche Google sous ce nom"; never ratings or review text
- Buttons to /diagnostic and /book carrying utm_source=outreach&utm_campaign=AU-XXXXX, so any diagnostic or booking lands on the same lead
- Footer: Digital M / Digital Management Ltd, French address, privacy link; print stylesheet (PDF = browser print)

### What stays manual

- Ticking which register rows to save; typing a URL when Google is off
- Opening the Google card and confirming "this is the business"
- Reading and editing every draft; pressing Send
- Logging replies and calls; the second email after 7 days
- "Not a fit" and "do not contact" decisions
- Approving the FR/EN legal wording before the first send

## 3. Data sources and cost

| Source | What for | Cost | Rule to respect |
|---|---|---|---|
| API Recherche d'entreprises (V https://recherche-entreprises.api.gouv.fr/docs/) | Find businesses by trade + postcode: SIREN/SIRET, names, legal form, address, coordinates, active and diffusion status | Free, no key; 7 requests/s per IP, 25 per page | Licence Ouverte 2.0 (V https://www.data.gouv.fr/dataservices/672cf684c3488a0c533f7094). No phone, website or email in the register. Save only full-diffusion rows; re-check the SIRET before every send and call (V https://www.insee.fr/fr/information/7456564). Keep ≤ 5 req/s, cache 24 h; the service may throttle heavy use (V https://recherche-entreprises.api.gouv.fr/openapi.json) |
| The business's own website (our crawler) | Contact email, phone, socials, CMS, all technical checks | Free; 3 pages per site, 1 request/s | robots.txt respected; sites whose CGU forbid extraction are flagged and not emailed (V https://www.cnil.fr/fr/focus-interet-legitime-collecte-par-moissonnage); tell the source at first contact (V https://www.cnil.fr/fr/la-reutilisation-des-donnees-publiquement-accessibles-en-ligne-des-fins-de-demarchage-commercial) |
| Google Places API (New): Text Search + Place Details (V https://developers.google.com/maps/billing-and-pricing/pricing, updated 2026-09-01) | Match the register row to a Google listing; read the website address once; live card on your screen | Text Search Pro fields: 5,000 free/month, then $32 per 1,000. Place Details Enterprise (website, phone, rating, hours): 1,000 free/month, then $20 per 1,000. Hard stop at 900 in the app. Needs billing enabled on project flowing-radio-476215-v4 + a key restricted to Places and the server IP (V https://developers.google.com/maps/documentation/places/web-service/cloud-setup) | Store only the place_id; never copy names, addresses, phones or reviews into our database (V https://cloud.google.com/maps-platform/terms §3.2.3, https://cloud.google.com/terms/maps-platform/eea §3.3.2). Which of the two contracts applies depends on the billing account address: EEA terms only if it is in the EEA (V https://cloud.google.com/maps-platform/terms). Manual phone/website edits disabled while the card is open |
| PageSpeed Insights API v5 (V https://developers.google.com/speed/docs/insights/v5/get-started) | Mobile performance and SEO scores, LCP | Free; key recommended for automated use | Daily quota 25,000 and 400 per 100 s is third-party reported only (U https://dev.to/addyosmani/monitoring-performance-with-the-pagespeed-insights-api-33k7); one run per site, reused 30 days |
| OpenAI via the existing key (gpt-4.1-mini) | Subject, email, call script, note — one call per audit | About €1–5 a month at 440 audits (estimate; https://openai.com/api/pricing/) | Accept the API DPA (V https://openai.com/policies/data-processing-addendum/); name OpenAI on the privacy page; for sole traders send the enseigne or "the business", not the person's name; model sees only checks, trade, town, prices |
| Gmail SMTP through Google Workspace (existing mail.ts) | Sending the outreach email | Included; limits 2,000 messages/day per user (V https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace). Optional separate outreach@ user: €6.80 per user per month on Business Starter (V https://workspace.google.com/pricing) | Workspace's use policy bans unsolicited bulk promotion (V https://workspace.google.com/terms/use_policy.html); send from a separate user so a suspension cannot touch contact@; a different From address needs a verified "send as" alias or its own login (V https://support.google.com/mail/answer/22370); cap 10–20 a day, one recipient per message |
| Telegram via hermes CLI + one hermes cron entry (existing) | 08:00 digest and instant pings | Free | One new project cron entry (needs your OK under our shared-server rules); references only, no email addresses in Telegram |
| Not used, not allowed | Google Maps pages, Pages Jaunes, LinkedIn bots; Facebook/Yelp discovery; Hunter/Snov named-email finding; OpenStreetMap (v2) | — | Maps terms forbid building listings databases (V https://www.google.com/help/terms_maps/); Pages Jaunes CGU allow manual use only (V https://www.pagesjaunes.fr/infoslegales/mentionslegales/); LinkedIn §8.2 (V https://www.linkedin.com/legal/user-agreement) |

## 4. Legal checklist

1. **Email on the B2B basis only.** No consent needed when the message relates to the person's trade, they were told, they can object simply and free, and every message names the sender and carries a way to stop (V https://www.cnil.fr/fr/la-prospection-commerciale-par-courrier-electronique-sms-mms-et-automate-dappel, Art. L34-5 CPCE V https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000042155961/). A company's contact@ skips the personal-data clocks; a sole trader's contact@ is personal data and is treated like a named address. Private webmail addresses are never emailed: phone instead.
2. **Tell them within a month or wipe.** The notice (who we are, source, why, rights) goes out at first contact and never later than one month after we saved the data (Art. 14 V https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre3#Article14; CNIL 2024 recommendations p.49 V https://www.cnil.fr/sites/cnil/files/2024-06/recommandations_reutilisateurs_donnees_publiees_sur_internet.pdf). Code enforces it: at day 30 with no notice sent, sole-trader rows are deleted and company rows lose email, phone and contact name.
3. **Opt-out is its own line, above the notice**, in every email and on the call ("Pour ne plus recevoir nos messages : répondez STOP ou cliquez ici") (Art. 21(4) V https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre3#Article21). Any stop → opposition list within the hour, kept as long as we prospect, checked before every send and call (V https://www.cnil.fr/fr/comment-utiliser-une-liste-repoussoir-pour-respecter-lopposition-la-prospection).
4. **Paperwork before the first send:** a "Prospection" section on the privacy page listing data categories, sources (own website, Sirene), recipients (Google Workspace, OpenAI, Google Maps Platform), the legitimate interest in one sentence, retention, rights, CNIL complaint, and that report opens are logged; a one-page balancing test and a register entry (Art. 30 V https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre4#Article30); a statement that Digital Management Ltd processes this data from its establishment in Ferrières-sur-Ariège with the CNIL as authority — or appoint an EU representative (Art. 27 V https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre4#Article27). The French address goes in the email footer.
5. **Retention:** prospects deleted 3 years after the later of collection and their last message to us (V https://www.cnil.fr/fr/questions-reponses-sur-les-referentiels-relatifs-la-gestion-des-activites-commerciales-et-des); no-response and not-a-fit prospects with no reply lose personal fields after 12 months; IPs and IP hashes nulled at 12 months; only the last 3 audits per business kept; opposition entries never deleted. Periods written on the privacy page.
6. **Phone:** business lines only; 10h–13h / 14h–20h weekdays; at most 4 attempts in 30 days; the script opens with who we are, where the number came from, why, and "you can refuse, I note it now" (V https://www.cnil.fr/fr/prospection-commerciale-par-telephone-hors-automate-dappel-quelles-sont-les-regles); the first answered call sets the notice date. Calls to consumers need prior consent since 11 Aug 2026 (Art. L223-1 V https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069565/LEGISCTA000032221441/).
7. **Source rules:** only full-diffusion register rows; SIRET re-checked before each send or call and personal fields wiped if the business opted out (V https://www.insee.fr/fr/information/7456564); only place_id stored from Google, nothing copied from the card; OpenAI DPA accepted; no bots on Maps, Pages Jaunes or LinkedIn.
8. **UK / US / Canada stay off until v2.** Sends are blocked when the address or domain is outside France. UK companies are opt-out only, but UK sole traders and partnerships need consent (V https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/); US is opt-out only but must say it is an ad, show a postal address and honour stops within 10 business days (V https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business); Canada is consent-based (U, not opened this session).

## 5. Build order

Two blocks. Every step ships something you can use; if a day slips, the earlier steps still work.

**Block A — first 10 days: inbox, digest, audit + report you send by hand**

- **Step 1 — Login + one inbox (4 days).** Session helper (Node crypto, no new library), /admin/login, admin root layout, middleware exclusion for /admin, /r/, /o/, robots rules, leads + activities tables with backfill of existing enquiries, list + detail with stage, next action, notes, timeline (days 1–2). Then insertLead() in the book, contact, chat and Messenger handlers, "Add lead", same-email merge (days 3–4). Your tasks: pick the password; enable Google billing and create the Places and PageSpeed keys; check SPF/DKIM/DMARC; decide the sending mailbox. **You get:** every lead, including ChatGPT Ads ones with their campaign label, in one list on staging and prod.
- **Step 2 — Morning digest + housekeeping (1 day).** 08:00 Telegram digest (follow-ups due + new leads by source; more sections added as later steps land), instant pings on new lead and stage change, the broken purge job fixed, last-contact date finally updated. **You get:** reminders without opening the admin.
- **Step 3a — Audit engine + score (2.5 days).** businesses, audits, jobs, api_usage tables; database-driven runner started from instrumentation.ts; crawler, TLS, HTML, robots/llms checks; PageSpeed client with 30-day reuse; auditScore() with weights, flags, fits. The FR/EN copy for the ten checks goes to you as a sheet on day 1 of this step.
- **Step 3b — Audit view + report (2 days).** "Add by URL", /admin/prospects/[id] audit block, /r/[token] in FR/EN with print stylesheet and view logging, branded not-found page. **You get:** paste a URL, get a score in about a minute and a report link you can send from Gmail today.

Block A total: 9.5 days + about half a day of your copy review = 10.

**Block B — next 9 days: send, opt-out, find, Google**

- **Step 4 — Drafts + send + opt-out + paperwork (3 days).** Model drafts with template fallback; sendMail() gets a `from` / outreach account option; legal block built by code; send panel with every blocking rule and the daily cap; send log written before SMTP; optouts table, /o/[token], /admin/optouts, "Mark STOP", "Sent from Gmail / by phone"; call log with counter, hours and the notice line; privacy-page section, balancing test and register entry in docs/. Footer and /o wording go to you on day 1 of this step. **You get:** lawful outreach end to end on businesses you already know.
- **Step 5 — Find businesses + Google match + daily list (3.5 days).** trades.ts, /admin/find on the register with sole-trader and diffusion flags and a searches history table, "Find on Google" with in-memory matching, one-time website read + our own crawl, email classification and "site forbids extraction" flag, /admin/prospects with the "ready to send" view, badges, 30-day notice rule, call-instead rows, "Audit next 20", "Not a fit", utm_campaign merge. **You get:** the 20-a-day routine from search to send without leaving the admin.
- **Step 6 — Google card + guards, then production (2 days).** "Show Google card" live and attributed, "Not this business", "Use this website", api_usage hard stop at 900 with discovery first, GOOGLE_PLACES=off switch (day 1). Purge script extended to leads, businesses and audits, README and .env.example, VACUUM INTO backup, prod deploy at a quiet hour, first 20 real audits with you and the fixes they need (day 2). **You get:** the full ten-point score and a production admin at digitalm.eu/admin.

Block B total: 8.5 days + about half a day of your wording review = 9.

**Total effort: about 19 working days** for one senior developer with an AI assistant (18 build days + about 1 day of your reviews spread across the steps). The earlier 10-day figure did not survive a line count of the existing code: the comparable diagnostic feature took 3 days for about 1,700 lines, and this is roughly three times that.

**Monthly running cost (estimate, 20 businesses a day, about 440 a month):** €0–10 without a separate mailbox. Register, PageSpeed, own checks, Telegram and Umami are free; Google stays at €0 because Text Search stays under its 5,000 free calls and Place Details stops at 900 of the 1,000 free (about 440 for website discovery + up to 440 card views — tight); OpenAI drafts about €1–5. Add €6.80 a month for an outreach@ Workspace seat (Business Starter price; your plan's price applies). Each extra 1,000 Place Details beyond the free tier is $20 (V pricing page above). Your own setup time: about half a day.

## 6. Risks

- **Surface area, not build time.** About 60 files and 150 bilingual strings; the two-block plan keeps a usable tool at every step, and the cut list if a day slips is: Google card, call script, EN report copy, PageSpeed 30-day reuse. None blocks the daily routine.
- **Google quota or wrong match.** Discovery and card views share 900 free calls; a bad name match stores a wrong place_id. Mitigation: match on name + distance before storing, "Not this business" clears it, the listing check stays grey until you confirmed, a €10 budget alert in the Cloud console, and the whole pipeline works with Google off (you type the URL).
- **A cold email that breaks a rule** (no notice, private address, someone who said stop, a sole trader saved 40 days ago, a UK address). Mitigation: every rule is code, not a checklist — the send is refused and the reason shown; day-30 wipe; SIRET re-check; the opposition list is never purged.
- **Deliverability and the Workspace use policy.** 20 cold emails a day from contact@ risks the mailbox that carries client mail. Mitigation: separate outreach@ user or verified alias, SPF/DKIM/DMARC checked first, start at 5–10 a day, bounces visible in the send log.

## 7. Decisions for Radu

1. **Trades first:** confirm the 15-trade list (restaurants, bars, hotels, gîtes, campsites, bakeries, butchers, hairdressers, beauty, garages, plumbers, electricians, joiners, painters, roofers, estate agents, opticians, dentists, gyms) — or cut it to five to start.
2. **Territory:** Ariège only, or Ariège + the south of Haute-Garonne and Toulouse from day one (30 communes are already in communes.ts).
3. **Score threshold** for "ready to send": under 60 (grades B and C), or only grade C.
4. **Email first or call first** for phone-only prospects (proposed: email when a usable address exists, call otherwise, within the hours above).
5. **Google:** enable billing on flowing-radio-476215-v4 and create the key; check the billing account country (EEA address → EEA terms; UK address → standard terms); stay at the 900 hard stop or accept about $10 a month over it.
6. **Sending identity:** new outreach@ Workspace user (€6.80/month on Starter), or a verified "send as" alias on radu@; and the daily cap to start with (10 or 20).
7. **Languages:** FR reports and emails for Occitanie; keep the EN report for French businesses that prefer English; EN markets (UK/US/Canada) in v2 — confirm.
8. **Timeline:** all 19 days in one run, or Block A (10 days) first and send reports by hand from Gmail for a few weeks before Block B.
9. **Legal stance:** state the French establishment (Ferrières-sur-Ariège) as the place of processing with the CNIL as authority, or appoint an EU representative; accept the OpenAI API DPA on the account; sign off the FR/EN footer, the /o page and the privacy section.
10. **Access:** the shared password now; tell me if a second person (wife or helper) needs access so Google sign-in is planned.
11. **Scheduler:** approve one new hermes cron entry at 08:00 for the digest (shared-server rule 9).

## 8. Unverified

- PageSpeed Insights quota (25,000/day, 400 per 100 s) — third-party guide only; the real figure shows in the Cloud console.
- Whether billing is enabled on Cloud project flowing-radio-476215-v4, and the country of its billing account (decides EEA vs standard Google terms).
- Which Google Workspace plan digitalm.eu is on (the €6.80 seat price is Business Starter).
- Whether Google's use policy is applied to lawful, low-volume B2B prospecting in practice — Google's wording only.
- Treating a sole trader's contact@ as personal data and the day-30 wipe rule — CNIL reading, not a published decision on this exact case.
- CNIL 2024 recommendations (fiche n°2 pages 43–49) quoted from the reviewer's reading of the PDF; the PDF was not opened by me.
- Canada CASL details and the UK ICO pages — some returned 403 during research; CASL not opened.
- Register coordinates missing on new establishments — observed on one July 2026 row; fallback to commune centre covers it.
- Whether Turbopack shares one runner instance between instrumentation.ts and the route handlers — the design no longer depends on it (database-driven claim).
- OpenAI's Data Privacy Framework status in 2026 — inconsistent sources; rely on the SCCs in the DPA.
- nginx read timeout on this server (owner's config, assumed default 60 s) — the job queue removes the dependency.
- LeadsGorilla's score formula, G2 rating and upsell prices — reseller and review pages only.
- INSEE Sirene API header name, Pappers pricing, Overpass area tags, Yelp per-1,000 prices — not needed for the MVP.