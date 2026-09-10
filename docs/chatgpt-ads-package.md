# ChatGPT Ads — Digital M launch package (final, 10 Sep 2026)

Two campaigns, 5 ad groups, 15 ads (12 FR, 3 EN). All review fixes applied. Every title is ≤ 50 characters and every subtext ≤ 52 (counted in NFC with Python, accents and spaces included). Every landing URL returned HTTP 200 to the OAI-AdsBot user agent today, UTMs attached.

---

## 1. What ChatGPT Ads is

- **Where it shows:** one card below a ChatGPT answer, labelled "Ad". Square image on the left, then "Digital M", a title (max 50 characters), a subtext (max 52) and the link. The logo is taken from the site favicon.
- **Who sees it:** ChatGPT Free and Go users, 18+, in France (live since 24 Aug 2026). Never Plus, Pro or Business users. Nobody in a Temporary Chat.
- **How matching works:** no keywords. Each ad group carries "context hints" — plain sentences saying who the offer helps and when. OpenAI matches hints + title + subtext + landing page to the conversation in progress. In France (EEA) there is no personalisation: only the current chat counts, so the ad must make sense to someone mid-question.
- **What it costs:** you pay per click (Clicks objective). Relevance-weighted second-price auction. "Maximum results" bids automatically; or set a max CPC (OpenAI suggests 3–5 USD to start). Minimum daily budget 15 € in a EUR account; one day can spend up to 2× the daily amount, 7× over a week.
- **Review:** title, subtext, image and landing page are checked together, automatically, with human escalation. A rejected ad can be edited and resubmitted. Landing pages must be readable by OAI-AdsBot — ours are.
- **Reporting:** impressions, clicks, spend, CTR, average CPC in Ads Manager, up to 7 h late. UTMs set per ad carry through to Umami.

---

## 2. The €500 promo — how it really works

**Verified (OpenAI Ad Credit Terms + public pages)**
- Public wording is in dollars: "spend $500, get $500 ad credit". Your email says €500. The email is the legal "Offer", so what it states is what counts. **Not verified:** € vs $.
- You spend the first 500 in real money. The credit is issued after that, then covers later spend only. Credit never counts toward the 500 threshold.
- The credit expires 90 days after it is issued; unused balance is lost. No stacking with other credits. VAT is charged on the amount after credit.
- OpenAI can revoke the credit if the account breaks policy or is unpaid.

**Reported, not verified (agency write-ups of the same offer in the UK):**
- New advertisers only — no prior spend by any account linked to the business. One credit per business, one account.
- Accept through the link in the email. The 500 must be spent on qualifying campaigns within 14 days of accepting.
- **Check in the email:** acceptance deadline; when the 14 days start; currency; what "qualifying campaigns" means; link to offer terms (ads.openai.com/promotion, logged in).

**Eligibility — decide before creating the account**
- Country, currency and legal entity are fixed at account creation and cannot be changed. The billing card must match that country.
- Digital M is a trading name of Digital Management Ltd (UK, no. 09457882). Both the UK and France are "available" countries. **Not known:** whether the French €500 offer requires a French billing entity, and whether a UK Ltd with a French address can open the account as France / EUR.
- Ask first: reply to the promo email or write to ads-support@openai.com — "Can Digital Management Ltd (UK company, French address in Ferrières-sur-Ariège, EUR card) create the advertiser account as a France-based entity and accept the €500 offer, or must it register as a UK entity?" Do not open two accounts to test both: the offer is reported as one per business.
- If the answer is UK / GBP: minimum £15 per day, France can still be targeted, contract with OpenAI OpCo LLC. If France / EUR: contract with OpenAI Ireland Ltd, VAT ID added under Billing → Settings.

**Budget plan — first 500 € in 3–5 weeks**
- Campaign 1 "Occitanie local": 20 € / day from Monday 14 Sep.
- Campaign 2 "France TPE": 15 € / day (the EUR minimum) from Monday 28 Sep — or from 21 Sep if campaign 1 is under about 500 impressions a day after its first week.
- On paper: 280 € after two weeks, then 35 € / day → 500 € around day 21. New accounts on automatic bidding usually spend less than planned, so expect 3–5 weeks.
- If the email fixes a 14-day window: start both on day 1, campaign 1 at 25 € / day and campaign 2 at 15 € / day ≈ 500 € in 13 days.
- Once the credit lands you have 90 days to use it; put it on whichever ad group earned clicks.

---

## 3. Rejection risk

- **The issue:** OpenAI's ad policy (v1.5, Aug 2026) lists consumer categories — household goods, local services, travel, digital products / education. B2B agency services are not named. Rejection is possible, not certain (OpenAI's own customer stories include B2B software).
- **How the copy lowers the risk:** Digital M is presented as a local service — address in Ferrières-sur-Ariège, "on se déplace", free check-up or free call, published fixed prices. Submit the Occitanie campaign first, and inside it the ad "Une agence IA en Ariège qu'on peut rencontrer" first, so the account's category read is "local services". No superlatives, guarantees, ratings, client counts, competitor names; no chat-bubble images, no OpenAI marks; every number in the copy is printed on its landing page.
- **If an ad is rejected:** hover the status for the reason, edit, resubmit the same day. Fallbacks are ready in section 6: a brand-free subtext for the security ad, and a place-cue subtext ("agence basée en Ariège") for each France-wide ad — the Ariège address is printed in the footer of every page. If a whole category rejection persists, write to ads-support@openai.com with the local-service reasoning.

---

## 4. Business profile

- **Advertiser name:** Digital M
- **Website:** https://digitalm.eu (ads deep-link to /fr/… and /en/… pages, never the root, which redirects)
- **Legal name for verification:** Digital Management Ltd, company no. 09457882, 67 Meridian Centre, Havant, Hampshire, PO9 1UN — or the French establishment details, depending on what support answers (section 2). Type the legal name exactly as in the official register.
- **Logo:** favicon is picked up automatically; also upload the wordmark in Settings.
- **Description (FR) — paste as is:**

> Digital M, agence IA installée à Ferrières-sur-Ariège (09), près de Foix. Nous aidons les commerçants, artisans, TPE et PME, en Occitanie et partout en France, à mettre l'IA au travail : assistants IA, automatisation des devis, sites et boutiques en ligne, audits de sécurité. Prix fixes, annoncés à l'avance. Digital M est le nom commercial de Digital Management Ltd, société immatriculée en Angleterre et au pays de Galles (n° 09457882).

---

## 5. Campaign plan

| Campaign | Objective | Locations (as the picker names them) | Platforms | Daily budget | Bid |
|---|---|---|---|---|---|
| DM · Occitanie local (FR + EN) | Clicks (CPC) | Occitanie, France | Web, iOS app, Android app | 20 € | Maximum results for 7 days; from day 8, manual max CPC 3 € if average CPC is above 3 € |
| DM · France TPE (check-up gratuit) | Clicks (CPC) | France | Web, iOS app, Android app | 15 € | Maximum results for 7 days; then manual max CPC 2,50 € if average CPC is above 3 € |

- Start: campaign 1 on Monday 14 Sep 2026, no end date. Campaign 2 on Monday 28 Sep (rules in section 2).
- "Occitanie, France" is one region row in the picker and covers Ariège, Haute-Garonne and the neighbouring departments the site lists as served. Department and town names return no result; only regions and postal codes work.
- Pause the EN ad group after 14 days if it has impressions but no clicks. Pause campaign 2 first if spend runs ahead of learning.

### Ad groups

**AG1 FR · Une agence IA près de chez vous (Ariège / Toulouse)** — campaign 1
Theme: un commerçant, un artisan ou une PME de l'Ariège ou de la Haute-Garonne qui cherche quelqu'un de proche et joignable pour l'IA — un assistant sur son site, de l'automatisation, un avis honnête.
Context hints:
- un commerçant ou un artisan en Ariège qui se demande par où commencer avec l'IA pour son activité
- une PME de Toulouse ou de Haute-Garonne qui cherche une agence IA proche, qu'elle peut rencontrer
- un gérant qui cherche une agence IA joignable par téléphone et qui peut venir le voir
- un gérant qui veut un assistant sur son site pour répondre aux questions fréquentes et prendre les rendez-vous, même le soir
- un commerçant qui n'arrive pas à répondre aux messages de ses clients pendant le coup de feu et cherche une solution
- un propriétaire de gîte, d'hôtel ou de restaurant en Occitanie qui veut répondre plus vite aux demandes de réservation
- une petite entreprise près de Foix, Pamiers, Saint-Girons ou Toulouse qui perd du temps à recopier ses devis et ses factures d'un outil à l'autre, et qui oublie des relances
- un dirigeant qui veut savoir honnêtement si l'IA vaut le coup pour sa petite entreprise avant de dépenser quoi que ce soit

**AG2 FR · Site, boutique en ligne et sécurité, au prix annoncé** — campaign 1
Theme: un commerce, un artisan ou un producteur d'Occitanie qui veut un site ou une boutique en ligne faits par une équipe proche, à prix fixe annoncé d'avance, en restant propriétaire du résultat — ou qui s'inquiète de la sécurité de sa boutique actuelle.
Context hints:
- un artisan ou un commerçant en Ariège ou en Haute-Garonne qui veut faire créer un site internet sans se ruiner
- un commerçant qui veut ouvrir une boutique en ligne et se demande combien ça coûte et par où commencer
- quelqu'un qui compare des devis de création de site et veut un prix fixe annoncé à l'avance, sans abonnement caché
- un commerçant qui veut être sûr que le site, le code et le nom de domaine lui appartiennent une fois livrés
- un producteur ou un artisan qui veut vendre ses produits en ligne sans y passer ses soirées
- un gérant qui s'inquiète de la sécurité de sa boutique WooCommerce ou PrestaShop et des données de paiement de ses clients

**AG3 EN · English-speaking business owners in Occitanie** — campaign 1
Theme: an English-speaking owner of a gîte, B&B, shop, trade or small company in the Ariège or around Toulouse who wants a local AI agency they can meet, and a plain answer on whether AI is worth it.
Context hints:
- an English-speaking owner of a gîte, B&B or shop in the Ariège or near Toulouse asking how AI could help their small business
- someone in south-west France looking for a local AI agency they can meet in person
- an expat running a business in the Ariège or Haute-Garonne who wants a website with AI built in, at a fixed price agreed up front
- a small business owner in Occitanie who wants an assistant on their website to answer enquiries and take bookings while they are out
- a tradesperson or shop owner spending evenings re-typing quotes, invoices and follow-ups between different tools
- someone who wants an honest opinion on whether AI is worth it for their small business before spending any money

**AG4 FR · Par où commencer avec l'IA ?** — campaign 2
Theme: le dirigeant de TPE ou de PME qui ne sait pas par où commencer avec l'IA et veut un premier avis gratuit, simple et honnête → check-up gratuit (/fr/diagnostic) ou appel gratuit de 30 minutes (/fr/book).
Context hints:
- un commerçant ou un artisan qui se demande par où commencer avec l'IA dans son entreprise
- un patron de boutique qui veut un premier avis simple, sans jargon, sur l'IA et l'automatisation
- une personne qui cherche un diagnostic ou un audit gratuit de ses besoins en IA avant de dépenser quoi que ce soit
- un dirigeant de TPE ou de PME qui veut savoir honnêtement si l'IA vaut le coup pour son activité
- une petite entreprise sans service informatique qui veut savoir si l'IA peut lui faire gagner du temps
- quelqu'un qui demande quels outils d'intelligence artificielle sont vraiment utiles pour une TPE ou une PME
- un dirigeant de PME qui préfère parler à quelqu'un avant de lancer un projet d'intelligence artificielle

**AG5 FR · Devis, relances, réponses : le répétitif** — campaign 2
Theme: le temps perdu sur le répétitif d'une petite entreprise — devis recopiés, relances oubliées, double saisie, messages sans réponse — et ce qu'une IA ajoutée au site existant peut prendre en charge → check-up gratuit (/fr/diagnostic) ou forfait à prix fixe (/fr/pme).
Context hints:
- un artisan qui passe ses soirées à taper des devis et à relancer des clients, et qui se demande comment automatiser tout ça
- une petite entreprise qui ressaisit les mêmes informations dans plusieurs outils et veut arrêter la double saisie
- quelqu'un qui utilise déjà l'IA pour rédiger ses devis ou ses réponses clients et voudrait que cela se fasse tout seul, sans copier-coller
- une entreprise qui reçoit les mêmes questions par e-mail, téléphone et WhatsApp et veut y répondre plus vite
- quelqu'un qui demande comment ajouter un assistant ou un chatbot en français sur le site de sa petite entreprise
- une PME qui veut relier ses outils entre eux sans embaucher un développeur
- une petite entreprise qui perd des demandes de devis parce qu'elle répond trop tard

---

## 6. Ads — copy to paste

Paste from this file (accents are NFC). If the editor's counter shows one more than stated, retype the accented word in place. Optional: type a no-break space before « : », « ? » and inside « 500 € » / « 4 min » / « 30 min » — same count, avoids a lone « ? » on a new line; drop it if the editor strips it. Check the preview at phone width: three titles are 49–50 characters and may wrap.

### AG1 FR · Une agence IA près de chez vous

**occ-toulouse-devis-relances**
- Title (45/50): `Devis, relances, SAV : l'IA peut s'en charger`
- Subtext (49/52): `En Ariège, à moins d'une heure du sud toulousain.`
- URL: `https://digitalm.eu/fr/agence-ia-toulouse?utm_source=chatgpt&utm_medium=cpc&utm_campaign=occitanie-local&utm_content=occ-toulouse-devis-relances`

**occ-ariege-rencontrer** — submit this one first
- Title (45/50): `Une agence IA en Ariège qu'on peut rencontrer`
- Subtext (51/52): `Près de Foix. On se déplace. Appel gratuit, 30 min.`
- URL: `https://digitalm.eu/fr/agence-ia-ariege?utm_source=chatgpt&utm_medium=cpc&utm_campaign=occitanie-local&utm_content=occ-ariege-rencontrer`

**occ-assistant-jour-nuit**
- Title (47/50): `Un assistant répond à vos clients, jour et nuit`
- Subtext (48/52): `Dans votre style. Dès 500 €, prix fixé d'avance.`
- URL: `https://digitalm.eu/fr/agence-ia-ariege?utm_source=chatgpt&utm_medium=cpc&utm_campaign=occitanie-local&utm_content=occ-assistant-jour-nuit`

### AG2 FR · Site, boutique en ligne et sécurité

**occ-site-concu-en-ariege**
- Title (48/50): `Un site pour votre activité, conçu dans l'Ariège`
- Subtext (49/52): `Dès 500 €, en ligne en quelques jours. Prix fixe.`
- URL: `https://digitalm.eu/fr/creation-site-internet-ariege?utm_source=chatgpt&utm_medium=cpc&utm_campaign=occitanie-local&utm_content=occ-site-concu-en-ariege`

**occ-boutique-ia-integree**
- Title (47/50): `Une vraie boutique en ligne, avec l'IA intégrée`
- Subtext (50/52): `Catalogue, paiement, livraison. Formation incluse.`
- URL: `https://digitalm.eu/fr/pme?utm_source=chatgpt&utm_medium=cpc&utm_campaign=occitanie-local&utm_content=occ-boutique-ia-integree`

**occ-boutique-failles**
- Title (46/50): `Votre boutique en ligne a-t-elle des failles ?`
- Subtext (48/52): `Audit PrestaShop ou WooCommerce, dès 500 €/jour.`
- URL: `https://digitalm.eu/fr/audit-securite-site-ecommerce?utm_source=chatgpt&utm_medium=cpc&utm_campaign=occitanie-local&utm_content=occ-boutique-failles`
- The subtext names two platforms (nominative use; the landing page names them too). If you prefer zero brand-name risk, or if it is rejected, use: Subtext (48/52): `Audit de sécurité, dès 500 €/jour. En Occitanie.` — no platform names in the image either.

### AG3 EN · English-speaking business owners in Occitanie

**occ-en-agency-meet**
- Title (48/50): `An AI agency in the Ariège you can actually meet`
- Subtext (49/52): `Near Foix, south of Toulouse. We can come to you.`
- URL: `https://digitalm.eu/en/agence-ia-ariege?utm_source=chatgpt&utm_medium=cpc&utm_campaign=occitanie-local&utm_content=occ-en-agency-meet`

**occ-en-checkup-plate**
- Title (45/50): `See what technology could take off your plate`
- Subtext (50/52): `Free check-up for shops, trades and online stores.`
- URL: `https://digitalm.eu/en/diagnostic?utm_source=chatgpt&utm_medium=cpc&utm_campaign=occitanie-local&utm_content=occ-en-checkup-plate`

**occ-en-call-honest**
- Title (44/50): `We'll tell you honestly if AI isn't worth it`
- Subtext (51/52): `Free 30-minute call. You leave with concrete ideas.`
- URL: `https://digitalm.eu/en/book?utm_source=chatgpt&utm_medium=cpc&utm_campaign=occitanie-local&utm_content=occ-en-call-honest`

### AG4 FR · Par où commencer avec l'IA ?

**fr-par-ou-commencer**
- Title (50/50): `Par où commencer avec l'IA dans votre entreprise ?`
- Subtext (44/52): `Un check-up gratuit de 4 min vous le montre.`
- URL: `https://digitalm.eu/fr/diagnostic?utm_source=chatgpt&utm_medium=cpc&utm_campaign=france-tpe&utm_content=fr-par-ou-commencer`
- If the title truncates on phone or the ad is rejected: Title (28/50) `Par où commencer avec l'IA ?` / Subtext (49/52) `Check-up gratuit (4 min), agence basée en Ariège.`

**fr-enlever-des-epaules**
- Title (45/50): `Ce que l'IA pourrait vous enlever des épaules`
- Subtext (48/52): `Check-up gratuit, sans connaissances techniques.`
- URL: `https://digitalm.eu/fr/diagnostic?utm_source=chatgpt&utm_medium=cpc&utm_campaign=france-tpe&utm_content=fr-enlever-des-epaules`
- Fallback subtext if rejected (49/52): `Check-up gratuit, par une agence basée en Ariège.`

**fr-vaut-elle-le-coup**
- Title (46/50): `L'IA vaut-elle le coup pour votre entreprise ?`
- Subtext (50/52): `Appel gratuit, 30 min. On vous le dit franchement.`
- URL: `https://digitalm.eu/fr/book?utm_source=chatgpt&utm_medium=cpc&utm_campaign=france-tpe&utm_content=fr-vaut-elle-le-coup`
- Fallback subtext if rejected (48/52): `Appel gratuit de 30 min, agence basée en Ariège.`

### AG5 FR · Devis, relances, réponses : le répétitif

**fr-devis-recopies**
- Title (49/50): `Vous recopiez vos devis et oubliez vos relances ?`
- Subtext (50/52): `Check-up gratuit, 4 min, puis une réponse humaine.`
- URL: `https://digitalm.eu/fr/diagnostic?utm_source=chatgpt&utm_medium=cpc&utm_campaign=france-tpe&utm_content=fr-devis-recopies`
- Fallback subtext if rejected (49/52): `Check-up gratuit (4 min), agence basée en Ariège.`

**fr-trop-de-messages**
- Title (44/50): `Trop de messages, pas le temps de répondre ?`
- Subtext (39/52): `L'IA sur votre site, en quelques jours.`
- URL: `https://digitalm.eu/fr/pme?utm_source=chatgpt&utm_medium=cpc&utm_campaign=france-tpe&utm_content=fr-trop-de-messages`
- Fallback subtext if rejected (46/52): `L'IA sur votre site, par une agence en Ariège.`

**fr-ia-prend-le-relais**
- Title (48/50): `Devis, réponses, planning : l'IA prend le relais`
- Subtext (50/52): `Ajoutée à votre site actuel, dès 500 €, prix fixe.`
- URL: `https://digitalm.eu/fr/pme?utm_source=chatgpt&utm_medium=cpc&utm_campaign=france-tpe&utm_content=fr-ia-prend-le-relais`
- Fallback subtext if rejected (47/52): `Dès 500 €, prix fixe, par une agence en Ariège.`

**Images:** two square PNGs, 800×800, plain background, no clutter: (1) Digital M wordmark + « Agence IA · Ariège » for the local and pricing ads; (2) wordmark + « Check-up gratuit » / "Free check-up" for the diagnostic and call ads. No chat bubbles, no OpenAI or ChatGPT marks, no platform logos.

---

## 7. Quick-start values

Type these into the promo preview (ads.openai.com/promotion) in place of the auto-generated draft:

- **Title (45/50):** `Une agence IA en Ariège qu'on peut rencontrer`
- **Subtext (51/52):** `Près de Foix. On se déplace. Appel gratuit, 30 min.`
- **Image:** replace the cropped OG image with the 800×800 « Agence IA · Ariège » PNG
- **Objective:** Clicks
- **Locations:** remove "United States", add `Occitanie, France`
- **Bid:** Maximum results
- **Daily budget:** `20` € (down from $100)
- **Destination URL:** `https://digitalm.eu/fr/agence-ia-ariege?utm_source=chatgpt&utm_medium=cpc&utm_campaign=occitanie-local&utm_content=occ-ariege-rencontrer`

---

## 8. Setup checklist

Steps marked **[Radu]** need you personally (terms, identity, money).

1. **[Radu]** Read the promo email: acceptance deadline, when the 14-day window starts, € or $, "qualifying campaigns", link to offer terms.
2. **[Radu]** Send the entity question to ads-support@openai.com (or reply to the email) — section 2. Wait for the answer before step 5; the country and currency cannot be changed later.
3. Prepare the two 800×800 PNG images (section 6). Can be delegated.
4. Open ads.openai.com/promotion, paste https://digitalm.eu, replace the draft with the quick-start values (section 7).
5. **[Radu]** Click "Continue" — this accepts the Ad Tools Terms.
6. **[Radu]** Sign in / create the advertiser account with radu@digitalm.eu. Choose country, currency and time zone as decided in step 2 — permanent.
7. **[Radu]** Billing profile (legal name, address, invoice email) + payment method (card from the same country) + VAT ID under Billing → Settings. Expect a temporary card hold.
8. **[Radu]** Business verification: legal name exactly as in the register, address, registration number, documents if asked. No identity check is required. Do not resubmit while it is pending.
9. Settings → upload the logo.
10. Build campaign 1 (Occitanie): 3 ad groups, 9 ads from section 6, start Monday 14 Sep, budget 20 € / day, Maximum results. Submit the "rencontrer" ad first, then the rest.
11. Build campaign 2 (France): 2 ad groups, 6 ads, 15 € / day, start date Monday 28 Sep (or as decided in section 2).
12. **[Radu]** Check each ad in the preview at phone width, then launch. Ads only serve once billing and verification are complete.
13. Day 8: read impressions per day and average CPC; apply the bid rule; decide the campaign 2 start.
14. Day 14: pause the EN ad group if it has impressions but no clicks. Day 21 onward: watch for the 500 € mark and the credit.

---

## 9. Tracking

- **Umami (digitalm.eu/anal1t1c5):** filter the site by `utm_source = chatgpt`; `utm_campaign` (occitanie-local / france-tpe) tells the campaign, `utm_content` the ad. Ads Manager's own click and spend figures lag up to 7 h.
- **Conversions already exist:** the check-up completion (DM-XXXXX reference) and the booked call are recorded server-side today (enquiries store + Telegram push). Compare their counts before and after 14 Sep; the check-up passes its `ref` to /book so a call that starts on /diagnostic can be recognised.
- **Optional next step — Conversions API, server-side, no CSP change:** once the account exists, create a Pixel ID in the Conversions tab and POST `lead_created` (check-up done) and `appointment_scheduled` (call booked) with the click id `oppref` that OpenAI adds to the landing URL. Two things to do first: (a) forward `utm_*` and `oppref` from the landing URL into the wizard's /book link — today `src/components/DiagnosticWizard.tsx` (lines 281–286) builds that link from name / email / phone / ref only, so a call that starts on /diagnostic would not carry the click id; (b) update the privacy page, which currently says the site uses no advertising or tracking cookies.

---

## 10. Unresolved / to confirm in the UI

- Promo: € or $; acceptance deadline; whether the 14-day window runs from acceptance or from account creation; what counts as a "qualifying campaign"; whether a French billing entity is required for the French offer.
- Entity: register Digital Management Ltd as UK (GBP) or via the French establishment (EUR)? Answer from ads-support@openai.com before creating the account. Which currency the credit is issued in.
- Category: whether "AI agency / B2B services" passes review. Plan is local-services framing + fallbacks; nothing is guaranteed.
- Onboarding flow: whether the website-based ad preview is fully live for a French account and what the "recommended plan" screen says; whether the "Add new ad" prefill is offered.
- Verification: turnaround time and which documents are requested for a UK company with a French address.
- Editor behaviour: whether it keeps no-break spaces; how 49–50-character titles render at phone width; any limit on the number or length of context hints; image minimum size; logo pixel size.
- Bidding: no French CPC benchmarks exist; the 3 € / 2,50 € manual caps are a day-8 decision, not a fact.
- Security ad: keep the platform names (PrestaShop, WooCommerce) or use the brand-free subtext — your call before first submission.
- Before any conversion tracking: privacy page update + utm/oppref forwarded through the wizard → /book link.
