# The free check-up: is it good enough to spend ad money on?

Review date: 18 September 2026. Written for Radu.
Six experts looked at the check-up, three checkers went back over their work, and I verified the important claims myself on the live site and in the real databases.

Every point below says whether it is **measured** (I ran it, saw it, or read it in the code) or **reasoned** (my judgement, no proof).

---

## The verdict

The check-up itself is decent work. The questions are good, the scoring is sane, the e-mail and Telegram plumbing all works, and the one person who finished it booked a call within a minute. That is not a broken funnel.

But you are not losing money in the form. You are losing it before the form and around it. Half your ad budget bought Quebec visitors and landed them on a page that says three times that you serve French businesses, with an Ariège phone number in the footer. Your English campaign bought 34 clicks and produced one wizard start. And two of your ad creatives point straight at the booking page, where 11 strangers were asked to pick a slot in your calendar and none did.

The one thing that matters most this week: **fix the ads, not the form.** Turning off the English campaign and re-pointing the two booking ads costs nothing, takes twenty minutes, and reclaims roughly a third of your spend immediately. Then fix the cookie banner, which on a cheap Android phone physically covers the only button on the page.

Do not stop the ads entirely. The French campaign is working better than anyone in the panel realised.

---

## The numbers, as I measured them

All from your own Umami database, queried on 18 September at around 12:00. These are a few hours newer than the ones in the brief, and they agree with them.

**Since the ads started (16 to 18 September):**

| | |
|---|---|
| Sessions | 102 |
| Sessions that clicked anything at all | 15 (15%) |
| Started the wizard (`dm_step_1`) | 14 |
| Reached step 2 | 5 |
| Submitted | 1 |
| Booked a call | 1 |
| Mobile | 66 (65%) |

**Split by campaign. This is the part nobody looked at:**

| Campaign | Sessions | Started the wizard | Leads |
|---|---|---|---|
| `fr-france` ("France & Quebec") | 48 | 11 (23%) | 1 |
| `en-us-uk-ca` | 34 | 1 (3%) | 0 |
| No ad tag (organic, bots) | 20 | 2 | 0 |

**Where the French campaign's visitors actually are:**

| | |
|---|---|
| Canada, Quebec | 43 |
| Canada, Ontario | 4 |
| France | 1 |

Read that again. The campaign called "France & Quebec" bought 47 Canadians and one French person.

**Where the ads send people:**

| Landing page | Sessions | Result |
|---|---|---|
| `/fr/diagnostic` | 41 | 1 lead |
| `/en/diagnostic` | 30 | 0 leads |
| `/fr/book` (ad `ad_6aa271d4a990819e86`) | 7 | 0 bookings |
| `/en/book` (ad `ad_6aa26f798c68819c`) | 4 | 0 bookings |

**Your one real lead, minute by minute** (measured, from the event log):

- 23:05:24 lands on `/fr/diagnostic`
- 23:05:34 taps Start
- 23:07:30 submits, after two minutes, not four
- 23:08:24 books the call

That person moved fast and had no trouble. The form is usable. The problem is how few people get to it.

---

## What is good

Worth saying, because the rest of this document is a list of faults.

- **The page is fast.** Largest paint 0.8 seconds, 3.2 seconds on a throttled slow connection. (measured by the mobile expert)
- **The questions are the right questions.** The branching is smart, and making the magic wand box required on 18 September was the single best change made so far. The one lead who wrote a real sentence in it produced a triage note and a reply draft you could almost send as-is. The one who left it empty produced a reply draft with invented facts in it. (measured: compare staging `DM-VTX99` against production `DM-C4DQ3`)
- **The plumbing works.** Database row, e-mail, Telegram push, CRM lead, booking hand-off. All of it fired correctly on the one real lead.
- **The French campaign's landing rate is not bad.** 23% of visitors start the wizard. For a cold ad click asking for four minutes of questions, that is respectable.
- **The AI is doing real work.** On the one real lead the rules would have proposed a security audit. The model read the answers and dropped it, correctly, because the person does not sell online. (measured: stored scores `{AUTO:3, CRM:2, SEC:1}`, stored proposal `AUTO+CRM`)

---

## What is broken, in order of what it costs you

### 1. Half your ad money is buying Quebec, and the site tells Quebec it is not for them
**Measured.** 47 of the 48 sessions from the "France & Quebec" campaign came from Canada, 43 of those from Quebec. Exactly one came from France.

What a Quebec shopkeeper sees on that page:
- The footer lists Ariège villages and a phone number written "04 12 12 09 09", which cannot be dialled from Canada and is not even a tappable link. (`src/components/SiteFooter.tsx:33`; the correct international form `+33 4 12 12 09 09` already exists at `src/lib/localBusiness.ts:12`)
- The site copy says "petites entreprises françaises" and "pensée pour les TPE et PME françaises" three times. (`src/content/fr.ts:33, 60, 76`)
- Budgets in euros only. (`src/content/diagnostic.ts:369-373`)
- A privacy page about French law only. No mention of Quebec's Loi 25.
- The words "Québec", "Canada" and "à distance" appear nowhere on the site. Zero hits across both language files.

And when a Quebec lead does come in, your CRM files them as French. Your one real lead is stored with country "FR" and phone "+33 4187172114", which is a Quebec 418 number wearing a French dialling code. It cannot be dialled. (measured, lead row `LD-VQKA5`)

**Cost:** roughly half of £180 so far, and growing with every pound. You are paying to bring people to a page that quietly tells them to go away.

**Fix:** either point the French campaign at France only, or make the page honest about working remotely. Given that Quebec is where the traffic and the one lead actually came from, make the page honest. One line on the check-up intro, shown to everyone:

> "Nous travaillons à distance, en visio, au Québec comme en France."

Change "TPE et PME françaises" to "petites entreprises". Show the phone as `+33 4 12 12 09 09` as a tappable link. Add a Canadian dollar hint to the budget chips using the time zone you already read for the phone field (`src/lib/phone.ts:335` already maps `america/montreal` to CA):

> "1 500 à 3 500 € (environ 2 300 à 5 300 $ CA)"

### 2. The English campaign is dead and should be paused today
**Measured.** 34 sessions, 1 wizard start, 0 leads. The French campaign gets 23% of visitors to start. The English one gets 3%. Same page, same wizard, same code.

That is roughly a third of the spend producing nothing. At this sample size it is not certain, but it is one start in thirty-four, and there is no reason to keep paying while you fix everything else.

**Cost:** roughly £60 so far.

**Fix:** pause `en-us-uk-ca` now. Put the whole budget on French. Restart it in October once the page is fixed, with different ad copy, and judge it on 100 clicks rather than 34.

### 3. Two ad creatives send people straight to the booking page, and nobody books
**Measured.** Ad `ad_6aa271d4a990819e86` sent 7 sessions to `/fr/book`. Ad `ad_6aa26f798c68819c` sent 4 sessions to `/en/book`. Zero bookings from all 11. Every one of them looked at the page once and left.

Asking a stranger who has never heard of you to open your calendar and pick a slot is a very big first ask. The one person who did book had already spent two minutes answering questions first.

**Cost:** roughly £20 so far, and about 11% of clicks.

**Fix:** re-point both ads at `/diagnostic`. Keep the booking page for people who arrive from the check-up, or from your own e-mails.

### 4. On a cheap Android phone the cookie banner sits on top of the only button
**Measured, by me, on the live site just now.**

At 360 by 640 pixels, which is the most common cheap Android screen:
- The "Commencer" button sits at y=507, height 48.
- The cookie banner sits at y=318, height 322, which is half the screen.
- Asking the browser what is at the centre of the button returns the cookie banner, not the button.

A person who taps the button gets nothing. They do not tap twice. They leave, and you have already paid for the click.

At 390 by 844 (an iPhone) the banner starts at y=545 and only clips the bottom edge of the button, so the tap still works. So this is not everyone, but it is a real share of the 65% of your traffic that is on mobile.

The banner is pinned to the bottom of the screen and never goes away until the visitor makes a choice. (`src/components/CookieConsent.tsx:62`, `fixed inset-x-0 bottom-0 z-50`)

**Fix:** make the banner one short line with two small buttons, no taller than about 110 pixels, and add the same amount of empty space at the bottom of the page while it is showing so it can never cover anything. Shorten the French text, which is currently twice as long as it needs to be and is what makes the banner tall. Check afterwards at 360x640, 360x740 and 390x844.

### 5. Tapping "Continuer" leaves you looking at the bottom of the next page
**Measured.** After every step change the page does not move back to the top. The first question of the new step ends up 232 pixels above the top of the screen on an iPhone, and 410 to 727 pixels above it on a 360-wide Android. On a short step you land on the site footer.

The code does try. `src/components/DiagnosticWizard.tsx:116` asks the page to scroll to the top of the card. But it asks before the new step has been drawn, so it scrolls against the old layout and never runs again.

This happens at every single transition. The visitor has already scrolled down to reach "Continuer" (on step 1 that button sits at y=910 on an 844-pixel screen, so it is below the fold). They tap it, the page does not come back up, and they are staring at a list of options with no heading. It reads as broken.

**Cost:** this is the best explanation for the 5-out-of-14 survival rate from step 1 to step 2.

**Fix:** move the scroll so it happens after the new step is drawn, and jump instantly rather than smoothly.

### 6. The AI writes broken French about a third of the time, and the safety net never fires
**Measured, by me, in your real databases.**

Of the 11 French triage rows on staging, 4 contain corrupted text. The single English row is clean. Examples straight out of the database:

- "Vous nous avez indiqu** e9** que vous ressaisissez les m** ea**mes informations"
- "Automatisation de la prise de r** e9**servations"

That garbled text is what the visitor reads on the results screen, and it is the same text in the reply draft that lands in your inbox as "ready to send".

Your production lead is not clean either. `DM-C4DQ3` has 3 stray control characters, in the e-mail subject line you received.

There is a guard built to catch exactly this, at `src/lib/diagnosticTriage.ts:34-39`. I ran it against every corrupted row. **It returns false on all of them.** It looks for a space before the hex pair, and the real corruption has an invisible zero byte there instead, which does not count as a space. So the retry never runs and the fallback never runs.

The AI expert isolated the cause by experiment: it is the accented characters and the fancy punctuation (the long dashes, arrows and dots) inside the schema description lines at `diagnosticTriage.ts:17` and `:23`. Rewriting those lines in plain ASCII produced zero corrupted outputs in 20 runs. The same model writing plain text with no schema produced zero in 8 runs.

One more thing I found: staging row `DM-33HHH` has an empty reply draft and an empty note. The AI returned nothing at all for that visitor, and they saw no personalised paragraph.

**Fix, in this order:**
1. Rewrite the five schema description lines in plain ASCII. No long dashes, no arrows, no dots, no accented example text. The rules themselves stay identical. This is the actual cause.
2. Repair the guard so it catches any invisible character followed by hex digits, not just a space.
3. Add a small repair pass that turns those codes back into the right letters before anything is stored or shown, so even a corrupted answer is still usable.

Do not simply hide the paragraph when corruption is detected, which is what one expert suggested. That paragraph is the whole payoff. Repair it rather than dropping it.

### 7. The reply draft the AI writes for you is not sendable
**Measured, three drafts out of three.**

`src/app/api/enquiry/route.ts:107` deliberately strips the first name and the company out of what the AI is shown:

```
if (["firstName", "email", "company", "phone", "source", "magic"].includes(id)) continue;
```

Meanwhile the instructions at `diagnosticTriage.ts:23` tell the model to write a "greeting with their first name". It has no name to use. So:

- Your real lead is called Jojo. The draft opens "Bonjour,"
- Staging lead Marc. Opens "Bonjour,"
- Staging lead Sarah, company "The Copper Pot", a restaurant. Opens "Hello," and never once names the restaurant.

Worse, the model quotes the cheapest thing in your catalogue to everyone. The restaurant said in its own words that it loses about 10 bookings a week and declared a budget of 3 500 to 7 000 euros. The draft offered it "typically starts from €500". That is a seventh of what they said they would spend. A price written down is very hard to raise later.

**Fix:** two lines of work.
1. Delete `firstName` and `company` from that skip list. Nothing else changes.
2. Tell the model in the prompt that the declared budget is a floor to work up to, not a ceiling to undercut. Something like: never quote below the middle of the band they chose, and when no budget is given, quote the standard project range rather than the entry item.

### 8. The results screen talks about the visitor in the third person
**Measured, and reproduced independently by a checker: 5 runs out of 8.**

What real visitors read on their own results screen:

- "Le client veut réduire la gestion manuelle..."
- "Leur problématique est claire : le suivi manuel des stocks..."
- "They clearly have a problem with slow or missed responses..."

This sits directly above the "Réserver un appel gratuit de 30 min" button. It reads like an internal sales note that leaked onto the page, at the exact moment the visitor decides whether to book.

The cause is that the prompt frames everything as a briefing about "a prospect" (`diagnosticTriage.ts:64`), and the only instruction to write to the person is buried in a one-line field description at `:21`. Plus it does not know their name, per the point above.

**Fix:** rewrite that field description so it is unmissable. Roughly: one or two warm sentences written directly to the person, in their language, using "vous". They read this themselves. Never write "le client", "leur", "the client" or "they". Write "vous". Mirror their own words back. Put the same rule in the body of the prompt too.

### 9. Nothing is captured until the last of six steps
**Measured.** First name and e-mail live only on step 6, and both are required. (`src/content/diagnostic.ts:391-393`) Nothing is saved on the server until the whole thing is submitted.

Over 45 days, 19 people started the wizard and 1 submitted. Eighteen people told you something real about their business and then vanished with no name and no way to reach them. Those were the most qualified visitors your ads have produced.

**Fix (reasoned, this is the one I am least certain about):** ask for the e-mail straight after the pain question, framed as "où envoyer vos résultats ?", and present the rest as optional extra. At the very least, when someone who has answered two or more questions tries to leave, offer one line and one box: "vous voulez recevoir vos résultats par e-mail ?"

### 10. The first screen asks before it gives
**Reasoned, with measured support.** The landing screen is 45 words, one button, and no questions. The first thing you ask a stranger who arrived mid-thought from an ad is to commit to four minutes. The first thing you offer is a promise they cannot sample. No example of a finished result, no proof, no named person, no price.

I am less confident about this than the panel was, because the French campaign's 23% start rate is not actually bad. But the fix is cheap and the upside is real.

**Fix:** put the first real question on the landing page itself, the pain question with its six big cards, so the visitor's first action is answering rather than agreeing to answer. Keep the headline. Add the two reassurance lines your booking page already uses and that already work: "Gratuit, sans engagement" and "vous repartez avec 2 ou 3 idées concrètes même si on ne travaille jamais ensemble". Show a short example of a finished check-up underneath.

Also fix the wording, which is translated English. `src/content/diagnostic.ts:470` says "Voyez ce que la technologie pourrait vous enlever des épaules". In French you take a weight off someone's shoulders, you do not take things off their shoulders. Better:

> "En 4 minutes, voyez ce que vous pouvez arrêter de faire à la main"

And the intro trust line names nobody, while three places on the site promise "Notre équipe vous répond personnellement" for a one-person studio. A sceptical artisan reads "notre équipe" and assumes a call centre. Better:

> "C'est Radu, le fondateur, qui lit chaque réponse et vous répond lui-même. Aucun démarchage, aucune liste de diffusion."

### 11. Step 1 asks three questions at once and the step count changes under them
**Measured.** Step 1 puts trade, team size and sell-online on one screen, 14 chips in total. The Continue button sits below the fold. It is greyed out until all three are answered, with no explanation, and tapping it does nothing at all: no message, no scroll to the missing question, nothing.

Meanwhile the progress header goes "Étape 1 sur 5", then "Étape 2 sur 5", then "Étape 3 sur 6". The finish line moves at exactly the moment the visitor engages. (`DiagnosticWizard.tsx:404`)

And the least rewarding screen in the whole form is the first one after they commit. It asks about your filing, not their problem.

**Fix:** one question per screen. Lead with the pain question, which is the one that hooks them. Move trade, team size and sell-online later. Always show the same total, or show a bar with no numbers. When Continue is not available, say why in one line: "Choisissez une réponse pour continuer".

### 12. Three questions never change anything, and one of them collects a wrong answer
**Measured.** "Où avez-vous entendu parler de nous ?" is never read by the scoring, and it is the biggest block on the final screen at 7 chips. Your real lead answered "Bouche-à-oreille" while the site already knew, from the ad tag, that they came from ChatGPT. The form's own answer contradicts the truth you already had.

`B_channels` is also never read, and is thrown away entirely when two router cards are picked.

**Fix:** cut both. Keep the decision-maker question, because the new grading below needs it.

### 13. The A/B/C grade is really just "when do you want to start?"
**Measured.** Someone simulated the scoring across 103,680 combinations. In 112 of the 120 possible combinations of start date, budget and decision-maker, those three answers alone decide the grade, no matter what else the person says. All three completions so far are grade A, including the thinnest possible one.

The grade is the first thing in the Telegram push and the e-mail subject. When everything is an A, it tells you nothing.

**Fix:** make the grade answer "can I sell to this person?". A only when there is a company name or a website, and a quantified pain, and either a budget or a decision-maker. B when one is missing. C otherwise. Keep the start date as a tiebreak.

### 14. You do not ask where the business is
**Measured.** There is no country or region question anywhere in the check-up. The CRM defaults everyone to France. Given that 47 of 48 French-campaign visitors are Canadian, this is not a small oversight.

**Fix:** one required chip question: "Où se trouve votre entreprise ?", with France, Québec, Canada, Royaume-Uni, États-Unis, and "ailleurs". Use it for the phone country instead of guessing from the language.

### 15. Company and website are optional, and that is why your one lead was thin
**Reasoned, with measured support.** Company is marked "(facultatif)". Phone is "(facultatif)" with the hint "Uniquement si vous préférez un rapide coup de fil". Your one real lead gave none of the three. You got a first name, a gmail address, and "Autre" as the trade. That is exactly the "didn't capture enough info" you complained about.

**Fix:** require "company name or website, either one". Replace the optional phone with a required question that does not feel like a demand: "Comment vous recontacter ?" with the choices e-mail, téléphone, WhatsApp. Choosing phone or WhatsApp reveals the number field.

### 16. The visitor waits for the AI before seeing anything
**Measured.** The server waits for the spam check (up to 5 seconds) and then for the AI (4.7 seconds typical, 10.5 seconds worst of 32 runs) before returning anything at all. The button just says "Analyse de vos réponses...".

None of the results screen needs that wait. The service cards are fixed text and the score is worked out in the browser. Only one paragraph comes from the AI. And the row is not written to the database until the AI returns, so someone who gives up during the wait may be lost entirely.

**Fix:** show the results immediately from the rules, save the enquiry straight away, and let the AI paragraph appear a few seconds later, or not at all if it is slow.

### 17. If the send fails, four minutes of answers disappear
**Measured on staging.** The server refuses more than 5 submissions in 10 minutes from one address, and returns an error before anything is written. The page then shows one line: "Une erreur est survenue. Écrivez-nous à contact@digitalm.eu." No retry button, and their answers are gone from the screen.

This has cost nothing yet, because the volume is too low. It will bite the moment the ads work, because mobile visitors behind one carrier gateway share one address.

**Fix:** raise the cap, save the answers whatever happens, and show a "Réessayer" button that re-sends the same answers. Only mention the e-mail address if the second try also fails.

### 18. The privacy page does not say who receives the data
**Measured.** Three outside companies see check-up data: OpenAI reads every answer, Telegram receives the lead's first name, company, phone, e-mail and the whole reply draft, and Cloudflare checks the last step. The privacy page names none of them for the check-up, and nothing anywhere says data leaves the EU or the UK. Your own internal record even claims the opposite: "Notifications Telegram : références uniquement, jamais de données nominatives".

Separately, the cookie banner says "Avec votre consentement, nous activons aussi... une mesure d'audience basique", but the analytics script loads unconditionally whatever the visitor chooses. (`src/app/[locale]/layout.tsx:114-120`, with the comment "Cookieless, no consent gate needed" at line 89.) Saying you ask and then not listening is the exact thing French regulators fine, and anyone can reproduce it in thirty seconds.

And the analytics are not anonymous, despite the privacy page saying twice that they are. The ChatGPT click id is kept in the visit record and is also stored next to the named lead. Joining them resolves a visit to a person with a name, e-mail and IP. I did not re-run that join myself, but a checker did.

**Fix:** add one plain-language section to the privacy page called "Le check-up numérique" saying what you ask, why, that an AI service in the United States reads the answers, that the alert reaches your phone through Telegram, that Cloudflare checks the last step, that a human writes the final reply, how long it is kept, and how to have it deleted. Reword the cookie banner to match what actually happens. Add `data-exclude-search="true"` to the analytics tag so the click id stops being written to the visit database.

The cheapest win here: stop putting the name, phone and e-mail in the Telegram push. Send the reference, the grade and a link to the admin. Your own record already claims that is what you do.

---

## The AI model: the answer

**You are using `gpt-4.1-mini`, and you should keep it. You do not need a different one.**

Two things worth knowing.

**First, the setting does not do what you think.** The triage reads a setting called `OPENAI_MODEL`, which is set nowhere. Your settings file sets `OPENAI_MODEL_CHAT`, which the chat widget, the Messenger bot and the booking page read. Today this makes no difference, because the hardcoded fallback and the configured value are the same model. But the next time you change the model in the settings file expecting the whole site to move, the lead triage, which is the only part that touches money, will quietly stay behind. Make the triage read the same setting as everything else. (measured: `diagnosticTriage.ts:9` versus `chat/route.ts:19`, and `grep OPENAI_MODEL=` returns nothing in any environment file)

**Second, a "smarter" model would make things worse, not better.** The code gives up on the AI after 18 seconds and falls back to the plain rules. Measured on your real prompt: `gpt-4.1-mini` takes 4.7 seconds on average, worst case 10.5. `gpt-5.4-mini` takes 4.5. But `gpt-5-mini` took 21.5 and 24.1 seconds, and `gpt-5.6-luna` took 13.9 and 22.2. Both of those would blow past your cut-off on most calls. Every check-up would silently lose its personalised paragraph, its reply draft and its note, with no error anywhere. It would look like the AI was switched off.

**The cost.** Measured from the real prompt (1,927 characters of instructions plus a 1,718-character schema plus about 600 characters of answers) and the real outputs (2,036 characters on average across 11 stored rows), one check-up is roughly 1,200 tokens in and 800 tokens out.

At `gpt-4.1-mini` list prices, that is about **$1.80, or roughly £1.40, per 1,000 finished check-ups.** (The token counts are measured. The price per token is from the published rate card, so treat the final figure as an estimate, but the order of magnitude is not in doubt.)

Put that next to what you are actually spending: £180 bought 102 clicks, which is about £1.76 per click. **One ad click costs you about the same as a thousand check-ups' worth of AI.** The model is the cheapest thing in this entire funnel. Nobody should spend another minute worrying about it.

**What the model should be asked to do differently.** Not a bigger model, three more questions:

- "What do we still not know about this lead?" Your verdict on the one real lead was that the check-up did not capture enough. The model had every answer in front of it and could have told you in one line: no company name, no phone, no website, trade unstated.
- "What are the two questions to ask first on the call?"
- Let it say honestly when nothing fits. Right now it is forced to recommend at least one service, always.

**One more model-adjacent problem.** The chat bubble sits on the check-up page, and its script does not list process automation as a service, even though automation is what your triage recommends most. It leads with Vision Direct, EssilorLuxottica and Missguided. A small business owner who opens the chat while hesitating over a €500 check-up gets told about enterprise Salesforce work. The Messenger bot has a different and more current script, and a comment in the code admits the two have drifted. Rewrite one script that both read, listing all five services with the from-€500 prices.

---

## The plan

### This week

In this order. The first three are free and take twenty minutes.

1. **Pause the English campaign.** 34 clicks, 1 wizard start, 0 leads, against 23% for French. Reclaims about a third of the spend.
2. **Re-point the two booking-page ads at the check-up.** 11 clicks, 0 bookings.
3. **Decide about Quebec** (see the decisions section below). If you keep the traffic, add the "à distance, au Québec comme en France" line and fix the phone number in the footer the same day.
4. **Fix the cookie banner** so it can never cover the Start button. A few hours of work. This is a hard block on the most common Android screen size.
5. **Fix the scroll after "Continuer".** A few hours. Every step transition currently dumps the visitor at the bottom of the next screen.
6. **Fix the broken French.** Plain ASCII in the five schema description lines, repair the guard, add a repair pass. A few hours, and it is the difference between the payoff screen working and it reading as illiterate.
7. **Give the AI the name and the company, and tell it not to quote the floor price.** Two small edits. Turns the reply draft from unusable into something you can send from your phone.
8. **Tell the AI to write "vous", not "le client".** One field description and one prompt line.

### Next

1. Put the pain question on the landing page and go one question per screen. Fix the step count so it never changes. A day.
2. Ask for the e-mail right after the pain question. A day. This is the change that stops you throwing away everyone who abandons.
3. Add the location question, require company-or-website, and get a phone number through a "how should we reach you?" question. A few hours.
4. Show the results screen immediately and let the AI paragraph arrive after. A day.
5. Rewrite the translated-English question labels. A few hours. The worst offenders: "Zone de budget confortable ?" becomes "Quel budget avez-vous en tête ?"; "Votre copie" becomes "Vos coordonnées"; "Qu'est-ce que ça casse concrètement ?" becomes "Qu'est-ce que ça vous coûte concrètement ?"; "Si vous pouviez agiter une baguette magique" becomes "D'un coup de baguette magique, quelle corvée feriez-vous disparaître demain matin ?"; "Vu notre travail ailleurs" becomes "J'ai vu votre travail ailleurs".
6. Add the privacy section and reword the cookie banner. A few hours. Stop sending names and phone numbers to Telegram.
7. Fix the retry on a failed submission and raise the rate limit. A few hours.
8. Rewrite the chat widget script so it lists all five services. A few hours.

### Later

1. Rebuild the A/B/C grade around "can I sell to this person?" rather than "when do you want to start?". A day. Only matters once volume rises.
2. Add one more free-text box after the magic wand, required: "Qu'avez-vous déjà essayé ?". The free text is where all the sales value is.
3. Add the one-field escape hatch: "Pas maintenant ? Donnez-moi votre site et je vous envoie les 3 choses que je corrigerais, sous 48 h, gratuitement." The audit engine to do it already exists in the repo, it is just only reachable from the admin. A day.
4. Show one headline recommendation instead of three cards, and give the result a number the visitor can repeat to a partner.
5. Accessibility: label the magic wand box, add proper headings to each step, lighten the small grey text one notch, move the chat bubble off the submit button.
6. Extend the daily purge so inbound leads are deleted on the same three-year clock as their answers. Today the answers are deleted after three years and the person's name, e-mail and phone are kept forever, which contradicts what your privacy page promises.
7. Quebec's Loi 25, if you keep the Quebec traffic: name yourself as the person responsible for personal information, and add two sentences saying information may be processed outside Quebec. Half a day.

### Not worth doing

- **Switching to a bigger AI model.** Measured: the two current large models take 14 to 24 seconds against an 18-second cut-off. It would silently break the triage.
- **Currency conversion on the budget chips as a separate project.** Just add a Canadian dollar hint in the same line as the euro figure. A full multi-currency system is not worth it for one optional question.
- **Building the "free 48h express audit" just to honour the text at `src/lib/diagnosticScoring.ts:133` and `:138`.** One expert called this a live trust leak on the page paid traffic lands on. It is not, and the checkers were right to refute it. That text only appears on a branch that requires the AI to return no proposal, and the AI is forced to return at least one, so the branch cannot run while the AI is up. Nobody has ever seen it. It is dead code. Just delete the sentence, or build the escape hatch above and make it true.
- **Adding more chip questions.** The measured evidence points the other way. One rich sentence in the magic wand box produced a focused proposal and a draft quoting the prospect's own words. An empty one produced a subject line with invented facts in it. More chips means more taps on the screens where people already leave.
- **Gating the analytics script behind consent.** Your Umami is self-hosted and sets no cookie, so it probably does not need consent at all. The problem is that the banner says you ask. Fix the words, not the code, and keep the measurement, which you need more than ever right now.
- **Worrying about the AI bill.** About £1.40 per 1,000 check-ups.

---

## Decisions only you can make

1. **Quebec, yes or no?** Half your paid traffic is there and so is your only lead. But your site, your prices, your phone number, your legal pages and your local SEO are all built for Ariège. Either commit to it and adapt the copy, or point the campaign at France only and accept a smaller audience. Do not leave it as it is.
2. **Do you want to take phone calls from strangers?** Requiring a contact method changes what kind of leads arrive. Speed of reply is the biggest lever on winning small-business work, but only if you actually want to pick up the phone.
3. **How much more do you want to spend before deciding?** £180 and one lead is not enough to conclude anything. My suggestion is to do the "this week" list first, then spend another £200 on French only, then judge. Spending more before the fixes just buys the same losses again.
4. **"Notre équipe" or "Radu"?** Three places on the site promise a team. Saying it is you is more trustworthy to a small business and it is true, but it also tells them you are one person.
5. **The check-up or the call?** Right now the check-up is the only real door. You could also offer "just book a call" prominently on the same page. The evidence is ambiguous: 11 people who landed straight on the booking page did nothing, but 7 others navigated to it from the check-up without finishing.

---

## What I did not check

- Whether the ad creatives themselves match what the landing page promises. I can see the click ids but not the ad copy.
- The legal conclusions about Loi 25 and the RGPD. I verified what the site does and does not say. Whether that is compliant is a question for a lawyer.
- The 2:1 contrast figure on the disabled Continue button, and the exact page-speed numbers. Reported by the mobile expert, not re-measured by me.
- The join between the analytics click id and the named lead. Reported and re-verified by a checker, not by me.
- Prices per token for the newer OpenAI models. The token counts are measured; the money figure uses the published rate card.
