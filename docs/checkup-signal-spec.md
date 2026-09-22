# Check-up signal: one decision

Branch `feat/checkup-signal`. Written 22 Sep 2026, against the five real check-ups
in production (DM-JED9Y, DM-M9EZ7, DM-BSRA8, DM-88HKT, DM-8FPFT) and 60 days of
Umami sessions (340 opens, 100 starts, 33 answer the router, 23 pass it, 15 reach
the contact screen, 6 submit).

## The decision in one paragraph

The check-up lets a visitor finish without stating a single fact, and the pipeline
is built so that a priced proposal must come out anyway. Three things cause it and
all three are ours: the "I do not know" card skips the deep dive entirely, the
magic-wand starter chips answer the most valuable question for the customer in one
tap, and the triage prompt plus `PRICE_FIT.unsure` both order a 1,500-3,500 EUR
band that is not even on our price grid. So: the "I do not know" card gets a real
branch of two tap-only questions, the starter chips are deleted, `decision` and
`source` are cut to pay for it, the security card is hidden from people who can
never buy it, and the triage is rebuilt so that "we do not know enough to quote" is
a representable, code-enforced answer instead of a sentence the model is asked to
volunteer. No new question is added to the contact screen; one is removed from it
and one optional field becomes required with a one-tap escape.

Not more questions. Better ones in the place of the ones that produce nothing.

## What must not be undone

The consent bar clear of the start button, the scroll to the top of each step, the
stable step counter, the blocked-Continue sentence, the required "Autre" detail,
the required magic answer, the website field required when they sell on their own
site, the phone validated against the browser's country, and the one lead e-mail
and CRM page reading from the same labelled answers. Every item below is compatible
with all of them; the step counter in fact becomes simpler, because the total is 6
for everyone.

---

# 1. The question set after the change

Order as the visitor meets it. "unchanged" means not one character moves.

## Step 1 of 6: Votre activité / Your business

| id | kind | required | change |
|---|---|---|---|
| `activity` | chips | yes | unchanged (Autre detail still required) |
| `team` | chips | yes | unchanged |
| `sellsOnline` | chips | yes | unchanged |

## Step 2 of 6: Où ça coince / Where it hurts

`pains`, cards, required, max 2. Wording unchanged. Two mechanical changes:

- Card E ("Je m'inquiète pour la sécurité de notre boutique en ligne") is hidden
  when `sellsOnline === "no"`. It stays visible for `own-site`, `marketplaces` and
  `want-to`: DM-88HKT answered `want-to` and then described a custom-built shop and
  a bank asking about it, so `want-to` is not evidence that there is no shop. Only
  "Non, et ça nous va" is.
- `unsure` becomes a declared `exclusive` option instead of a hardcoded rule in the
  wizard, and it now routes to a branch instead of skipping one.

## Step 3 of 6: Regardons de plus près / Let's look closer

Branches A, B, C, D unchanged. Branch E unchanged except `E_url`, which becomes
required and loses "(facultatif)":

- `E_url` EN "Your shop address" / FR "L'adresse de votre boutique",
  `required: true`, hint EN "So we can look at it before we reply." /
  FR "Pour qu'on y jette un œil avant de vous répondre."
  (The one lead in five with a real shop has no address on file anywhere.)

**New branch U, for "Honnêtement, je ne sais pas trop".** Three questions, two
required, no typing unless they pick "un logiciel".

**U_week** - `chips-multi`, `required`, `max: 2`, `exclusive` on `none`

- EN: "Last week, what took the most time away from your real work?"
- FR: "La semaine dernière, qu'est-ce qui vous a pris le plus de temps en dehors de votre vrai travail ?"
- hintEN: "Pick up to two. Think of last week, not of a normal week."
- hintFR: "Choisissez-en jusqu'à deux. Pensez à la semaine dernière, pas à une semaine normale."

| id | EN | FR |
|---|---|---|
| `replies` | Answering customers (messages, calls, e-mails) | Répondre aux clients (messages, appels, e-mails) |
| `quotes` | Writing quotes or invoices | Faire des devis ou des factures |
| `chasing` | Chasing people who did not reply or did not pay | Relancer ceux qui n'ont pas répondu ou pas payé |
| `retyping` | Typing the same information in two places | Ressaisir les mêmes informations à deux endroits |
| `planning` | Sorting out appointments and the schedule | Gérer les rendez-vous et le planning |
| `searching` | Looking for information I could not find again | Chercher une information que je ne retrouvais plus |
| `none` (exclusive) | None of that, last week went fine | Rien de tout ça, la semaine s'est bien passée |

Every option is a symptom they lived through last week. None of them asks a
non-technical person to name a cause, which is the thing they just told us they
cannot do.

**U_where** - `chips`, `required`

- EN: "On a Monday morning, where do you find what you have to do?"
- FR: "Le lundi matin, où retrouvez-vous ce que vous avez à faire ?"

| id | EN | FR |
|---|---|---|
| `paper` | On paper: a notebook, a diary, a board | Sur papier : un carnet, un agenda, un tableau |
| `head` | Mostly in my head | Surtout dans ma tête |
| `sheet` | In a spreadsheet (Excel, Google Sheets) | Dans un tableur (Excel, Google Sheets) |
| `inbox` | In my inbox and my messages | Dans ma boîte mail et mes messages |
| `software` (other) | In software made for that (which one?) | Dans un logiciel prévu pour ça (lequel ?) |

**B_channels** - the existing object, reused by reference from `BRANCHES.B`, still
optional, not one new word to translate. It tells us where an assistant would have
to live for a person who cannot name their own problem. `answerEntries` keys by id,
so a shared object stores and prints exactly once.

`BRANCH_CORE.U = ["U_week", "U_where"]` so the Record stays total; `unsure` is
exclusive, so U can never be combined with another branch in practice.

## Step 4 of 6: Vos outils et votre baguette magique

`tools`: unchanged (see "Not doing" for why the 11 chips stay for now).

`magic`: same id, still required, starters deleted, reworded, placeholder added.

- EN: "If you could hand one task to someone else tomorrow morning, which one would it be?"
- FR: "Si vous pouviez confier une seule tâche à quelqu'un d'autre demain matin, ce serait laquelle ?"
- hintEN: "One sentence in your own words is enough. It is the answer that helps us most, even if it has nothing to do with computers."
- hintFR: "Une phrase, avec vos mots, suffit. C'est la réponse qui nous aide le plus, même si elle n'a rien d'informatique."
- placeholderEN: "For example: the Saturday-morning paperwork nobody else can do."
- placeholderFR: "Par exemple : la paperasse du samedi matin que personne d'autre ne peut faire."

The example is deliberately not one of the five service lines. If someone copies it
we can see that they did, and the triage cannot latch onto it. Placeholder text is
never submitted as a value.

## Step 5 of 6: Côté pratique

| id | change |
|---|---|
| `start` | unchanged |
| `budget` | option `unsure` relabelled, id and scoring untouched: EN "No idea yet, tell me what it costs" / FR "Je ne sais pas encore, dites-moi ce que ça coûte" |
| `decision` | **CUT** |

## Step 6 of 6: Vos coordonnées

| id | change |
|---|---|
| `firstName`, `email` | unchanged |
| `company` | now **required**, with a one-tap escape (below) |
| `phone` | unchanged |
| `site` | reworded, same `requiredIf` |
| `source` | **CUT** |

`company`

- EN "Business name" / FR "Nom de votre entreprise" (the "(optional)" is gone)
- hintEN: "It lets us look you up before we reply." / hintFR: "Cela nous permet de vous trouver avant de vous répondre."
- escape chip, rendered under the field, EN "I do not have one yet" /
  FR "Je n'en ai pas encore". Tapping it clears and disables the input and writes
  `companyNone: "none"` into the answers. That satisfies `required`.

`site`

- EN "Your website, Facebook page or Google listing" /
  FR "Votre site, votre page Facebook ou votre fiche Google"
- hintEN "Anything we can look at before we reply." /
  hintFR "N'importe quoi qu'on puisse regarder avant de vous répondre."
- `requiredIf (a) => a.sellsOnline === "own-site"` and both `hintRequired*` strings
  unchanged.

`UI.metaDesc` still says "environ 12 questions": the pain path is 12 to 13 and the
unsure path is 13. No copy change needed there.

---

# 2. Branch behaviour for someone who does not know their problem

Today: `next()` jumps step 3 when `branchQuestions` is empty, the visitor answers
nothing between the router and the tools screen, and 12 of the 23 sessions that get
past the router (52 per cent) go that way. The deep dive they skip is the cheapest
step in the whole form: 12 s median, against 25 s for step 1, 23 s for tools+magic,
17 s for the practical bits, 65 s for the contact screen. The branch is not silent
because questions are expensive. It is silent because nobody wrote it.

After:

1. `picked` maps `"unsure"` to `"U"` and keeps the rest, so `branchQuestions` is
   never empty once the router is answered.
2. The skip machinery is deleted: the `n === 3` lines in `next()` and `back()`, and
   the `skipsDeepDive` / `visibleStep` / `totalSteps` branch. `totalSteps` is 6 for
   everyone and `visibleStep === step`.
3. The Umami label `branch: picked.join("+")` now reports `U`, so the path that was
   invisible becomes measurable from the first day.

A lead who picks "je ne sais pas trop" arrives with: a trade, a headcount, whether
they sell online, one or two symptoms from last week, where their work lives on a
Monday morning, optionally their channels, their own sentence on the magic
question, timing and budget. That is five usable facts where there are zero today.

---

# 3. The starter chips

Deleted. Not softened, not turned into an append-instead-of-replace, not kept as
grey examples with a hidden `magicTyped` flag.

Evidence: 5 of the 7 magic answers ever stored are byte-identical to a chip,
trailing space included, because the wizard writes `txt.replace(/…$/, " ")` into the
box. Three of the five picked the first chip in the list. The question was made
required while the one-tap escape was still there, so the most valuable field in
the form is currently satisfied by a sentence we wrote. It then outranks the
answers the customer chose on purpose, because the prompt says to trust their words
over the rules: DM-88HKT picked the security card and got a subject line about
unpaid invoices; DM-BSRA8 picked scattered customer data and got one about WhatsApp.

Removed together: the `starters` array on `MAGIC`, the `starters` field on the
`Question` type (no other question uses it), and the `q.starters ? (...)` block in
the textarea renderer. The textarea gains the `placeholder` attribute it never had,
reading `placeholderFr` / `placeholderEn` exactly as the input branch does.

A light guard replaces the chip as the thing that satisfies `required`: for
`kind === "textarea"`, `answered()` requires `trim().length >= 3` and at least one
letter (`/\p{L}/u`). No further: "je ne sais pas" is a legitimate answer and has to
reach the triage as the thin-answer signal, not be blocked at the form.

Because the chips no longer exist, nothing downstream has to detect a tapped chip:
no `magicIsStarter` flag, no `magicTyped` column. The prompt sentence about tapped
suggestions stays anyway, as cheap insurance for the historical rows Radu re-reads.

---

# 4. What is cut to pay for it

**`decision` ("Qui décide ?")** - 7 of 7 leads answered "Moi seul(e)", including the
6-20 employee pool-maintenance business. The only value that does anything in
`score()` is `researching`, which has never been picked. Zero variance in nine
months, on a screen that loses 22 per cent of the people who reach it. For a solo or
2-5 person business the answer is already implied by `team` on step 1.

**`source` ("Comment nous avez-vous connus ?")** - 6 of 7 rows carry
`utm_source=chatgpt` captured automatically. The one lead whose self-report differed
said "Bouche-à-oreille" on a ChatGPT cpc click. Two others typed "Chat gpt" into the
Other box, telling us what the utm already said. The enquiry route already refuses
to show it to the model, and the lead e-mail prints "Heard about us" directly above
"Attribution", which is the same fact measured properly. It sits on the 65 s screen
that loses 60 per cent of arrivals, and it is a seven-option scan.

Kept for the historical rows: the `enquiries.source` column, `heardAbout()`, and
`labelFor`'s fallback to the raw id. New rows simply store `null`.

---

# 5. Triage rules

Marked **prompt** (what we ask the model), **schema** (what it is physically able to
write down) or **code** (what we check after the answer comes back). The prompt is
where we ask for honesty; the schema is where we remove the places dishonesty can be
written down; code after the answer is the only place we get it.

### The thin signal

- **code** `score()` pushes the flag `"thin"` when `proposed.length === 0`, that is,
  when not one of the five lines could be named from a fact the customer stated.
  One rule, one place, read identically by the wizard (client) and the route
  (server), which is the whole point of that module. It also pushes `"no-symptom"`
  when `U_week === ["none"]`.
- **code** `diagnosticTriage.signalOf(answers, scoring)` returns
  `{ thin: scoring.flags.includes("thin"), missing: string[] }`. It defines nothing
  of its own; it reads the flag and computes the checklist.
- Measured blast radius: 1 of the 7 production check-ups (exactly DM-JED9Y, the lead
  Radu complained about), 6 of 31 on staging. After the U branch ships it gets
  rarer, because an unsure lead who names one symptom scores 3.

### Stop inventing a price

- **prompt** Delete "When no budget was stated, quote the standard project range
  (1,500 to 3,500 EUR) rather than the cheapest item, and offer a smaller first step
  as an option." Replace with: "When no budget was stated, do not invent one. You may
  name a price ONLY by quoting a package from the grid above, word for word, as our
  standard price, and you must say it is our standard price and not a quote for them."
  (ASCII only, per that file's encoding rule.)
- **prompt** In `leadBlock`, a missing or `unsure` budget renders as
  `Budget: NOT GIVEN`, not "Budget they declared: not decided yet". Above the
  answers, add: "These facts are MISSING: {signal.missing}. A missing answer is not
  a soft answer. 'Not sure yet' under budget means NO BUDGET WAS GIVEN. 'Honestly
  not sure' under the problem question means THEY DESCRIBED NO PROBLEM."
- **schema** `subjectSummary`: "Email subject tail for Radu, 90 characters at most:
  the need in a few words, then the timing. NEVER a price, a budget or any figure.
  Write it in the lead's language." Delete "then the budget band" and delete the
  example `1,5k-3,5k`. A plausible fake figure in an example is a figure that ships:
  that example is the number in Radu's subject line.
- **schema** `noteForRadu`: a price range only when they declared a budget; when they
  did not, the two facts to get on the call before any price.
- **schema** `replyDraft` (propose mode): "a price range only when they declared a
  budget; when they did not, one sentence saying you will price it after a short call."
- **code** `GRID` is exported as one constant, used both to render the prompt's
  PUBLISHED PACKAGE GRID and to derive the set of allowed figures `{500, 800, 1200,
  2500}`. For a lead who declared no budget, every money token in the draft and the
  note must be in that set; when they declared a band, their band's floor is allowed
  too, as today. 1,500-3,500 becomes unquotable by construction, because it is not
  one of our prices.
- **code** `moneyTokens(s)`: normalise thin and no-break spaces, then match a number
  followed by EUR / € / euros / k / $ / CA$, or any bare run of 3+ digits outside a
  URL. Must catch "1 500 à 3 500 EUR", "1,5k-3,5k €", "à partir de 500 €",
  "800 et 1 200"; must leave "2 à 3 jours", "30 minutes", "24 h sur 24" and the
  booking URL alone.
- **code** The subject line is taken away from the model: strip every money token
  from `subjectSummary`, then append a tail built from the stored budget id, that is
  the customer's own band label when they picked one, and "budget non précisé" /
  "no budget given" when they did not. Cap the result at 110 characters. A subject
  line can then only ever contain a figure the customer physically tapped. (The tail
  is appended after the model call, so it may carry its accent; the ASCII rule covers
  the prompt, not what we write for Radu's inbox.)
- **code** `PRICE_FIT.unsure` and `STANDARD_PRICE` become
  `"not stated - ask before quoting, do not name a band"`. They reach the lead
  e-mail and the CRM lead page with no model involved at all, so the prompt fix
  alone would not have stopped the band.
- **code** The route passes `price` to the e-mail only when `fit === "fits"`.

### Make "not enough to quote" representable

- **schema** Two schemas selected by `thin`. `TriageProposeSchema` is today's, minus
  the money defects. `TriageAskSchema` has no priced field at all: no `proposed`, no
  offer phases, no price range, no budget tail. A field that does not exist cannot be
  filled in, and that is a stronger guarantee than any sentence in a prompt.
- **schema** `proposed: z.array(z.enum(LINES)).max(3)`, no `.min(1)`. Description:
  "Service lines you are confident about, best first. EMPTY ARRAY when the answers do
  not support naming one. Guessing is worse than an empty array."
- **schema** `noFit: z.string()` is replaced by `fit: z.enum(["fits","unclear","no-fit"])`
  plus `fitReason: z.string().max(240)` (English, internal, empty when `fit` is
  "fits"). An empty string is a default; an enum is a decision the model has to make.
  Descriptions, ASCII: fits = at least one of the five services clearly matches
  something they described; unclear = they did not say enough to tell; no-fit =
  nothing we sell matches this person's situation at all.
- **schema** `callQuestions: z.array(z.string().max(200)).min(2).max(3)`, and the
  description says two or three, matching the schema (it currently says "exactly two"
  while allowing one).
- **schema** `TriageAskSchema.replyDraft`, max 1400: "A short reply email in the
  lead's language. Structure: 'Objet: ...' / 'Subject: ...', greeting with their
  exact first name, one sentence mirroring their own words, then two or three
  SPECIFIC questions as a short numbered list, then the booking link, then 'Radu,
  Digital M'. NO prices, NO figures, NO offer phases, NO packages: we do not know
  enough to propose anything yet. Asking is the product here."
- **prompt** Delete "and still fill the other fields with the least bad option".
  Replace with: "When nothing we sell fits, set fit to no-fit, leave proposed empty,
  and write a short reply that thanks them and asks what they are actually trying to
  fix. That is a complete, correct answer."
- **code** `fit` is clamped: when `signal.thin` is true and the model answered
  "fits", force "unclear". A lead where not one line could be named from a stated
  fact is not a confident fit, whatever the model says.
- **code** Serialise `fit` into the existing `no_fit` TEXT column: "fits" writes
  NULL, "unclear" writes `"Not enough in the answers to say what fits. Ask before
  quoting. " + fitReason`, "no-fit" writes `fitReason`. Every existing consumer
  (`leads.ts`, `leadView.ts`, `LeadDetail.tsx`, `mail.ts`) keeps working untouched,
  and NULL finally means one thing. A triage that never ran also writes NULL, and is
  told apart by `note_for_radu IS NULL`, which the e-mail already prints as "AI
  triage: unavailable".
- **code** Delete `if (!proposed.length) return null` (diagnosticTriage.ts:425-426).
  An honest empty proposal must not throw away the draft, the call questions and the
  on-screen rationale as punishment.

### Keep the model honest about their words

- **prompt** Replace "If their own words (especially the magic-wand answer) point
  somewhere else, trust the words over the rules" with "Trust what they typed
  themselves over the rules. Text they tapped from a suggestion is not evidence of
  anything."
- **prompt** "Never propose SEC unless they sell online" becomes "Do not propose SEC
  unless they sell online or described their shop's platform", so a lead like
  DM-88HKT is no longer argued out of the one service line he asked about.

### The two guarantees on the draft

- **code** Thin mode: if `moneyTokens(replyDraft)` or `moneyTokens(noteForRadu)` is
  non-empty, retry once; if the retry leaks too, fall back to a deterministic draft
  built from `callQuestions`:

  FR: `Objet : Quelques questions avant de vous proposer quoi que ce soit` / blank /
  `Bonjour {firstName},` / blank / `Merci pour votre check-up. Vous avez écrit : « {magic} ». Pour vous répondre utilement plutôt que de vous envoyer une offre toute faite, j'ai besoin de deux ou trois précisions :` /
  blank / `1. {q1}` `2. {q2}` `3. {q3}` / blank /
  `Une ligne par question suffit, ou réservez un appel de 30 minutes quand cela vous arrange : https://digitalm.eu/fr/book` /
  blank / `Radu, Digital M`

  EN: `Subject: A few questions before I suggest anything` / blank / `Hi {firstName},` /
  blank / `Thanks for completing the check-up. You wrote: "{magic}". Rather than send you an off-the-shelf offer, I would like two or three things cleared up first:` /
  blank / numbered questions / blank /
  `One line each is plenty, or book a 30-minute call whenever it suits you: https://digitalm.eu/en/book` /
  blank / `Radu, Digital M`

- **code** Every mode: the draft must contain the stored first name and must end with
  "Radu, Digital M". One of five live drafts greets nobody ("Bonjour,") and signs
  "L'équipe Digital M" for a one-person studio, which is the whole advantage thrown
  away in two lines. On failure, retry once; if it fails again, store no draft. The
  e-mail's existing no-draft line becomes: "The draft did not pass its checks (no
  first name, or not signed by Radu). Write this one yourself." A draft Radu has to
  proofread is worse than no draft, because he will eventually stop proofreading.

### Say what is missing, from data

- **code** `unknowns` is the code-computed `signal.missing`, joined with "; ", with
  the model's line appended after it, never instead of it. The model may add nuance;
  it may never subtract a fact. Checklist, in this order: no business name (and not
  the declared "I do not have one yet"), no phone number, no website or page to look
  at, no budget given, main problem not named (pains = unsure), no symptom named
  (U_week = none), hours unknown, just exploring. In 4 of 4 replays the model's own
  line forgot the missing phone number, which is the fact that decides whether
  speed-to-lead is even possible.

---

# 6. The tap budget, honestly

Median seconds per step, Umami, 60 days: step 1 = 25 s (3 questions), router = 16 s
(1), deep dive = 12 s (2 to 3), tools+magic = 23 s, practical = 17 s (3), contact =
65 s, whole form = 231 s.

**Pain path** (the 11 of 23 who pick a card): two questions fewer (`decision`,
`source`), about minus 13 s and minus 2 taps. Plus the magic answer now has to be
typed: 8 to 15 s for the roughly 80 per cent who would have tapped a chip, 0 s for
anyone who was going to type anyway. Plus the business name: one tap on the escape
chip, or 5 to 8 s of typing. Net: 1 tap fewer, and somewhere between 0 and +10 s.

**Unsure path** (the 12 of 23 who pick "je ne sais pas trop"): one screen more,
two required taps plus one optional, about 12 to 16 s measured against the existing
deep dive. Minus the same 13 s from the two cuts. Net: roughly flat in time, plus 3
to 5 usable facts where there are zero today. That path is currently one screen
SHORTER than the pain path, so this restores parity rather than adding length.

**Contact screen**, the one that loses 60 per cent of arrivals: one seven-option
question removed, one field made required with a one-tap escape. Net elements on
that screen: fewer than today. Nothing else is added to it.

The only change in this plan that adds time is typing the magic answer, and it is
the one that pays for everything downstream: the one lead in seven who typed their
own sentence is also the only lead who ever produced specific call questions.

**Measurement, because n is small.** The wizard already tracks `dm_step_1..6` and
`dm_submit`, and the branch label now includes `U`. Watch three numbers for two
weeks: the share of `dm_step_4` sessions carrying branch U (baseline 12 of 23),
step 4 to step 5 survival (baseline 18 of 23, the proxy for the cost of typing the
magic answer), and the share of stored `magic` values under 15 characters. If step 4
survival drops more than 10 points, cut the `tools` question entirely before
touching the magic question again: `U_where` already carries the only part of
`tools` that has ever moved a recommendation.

---

# 7. Constraints

- No new dependency.
- The answers payload stays a flat `Record<string, string | string[]>`. Keys added:
  `U_week`, `U_where`, `U_where_other`, `companyNone`. No key is renamed. `magic`,
  `pains`, `budget`, `site`, `B_channels` keep their ids and their stored values.
- No new storage. `fit` serialises into the existing `no_fit` TEXT column,
  `signal.missing` into the existing `unknowns` TEXT column, and `thin` is already
  queryable (`SELECT ... WHERE proposed = '-'`). **No `EXTRA_COLUMNS` line is added
  by this change.** If a later unit does need one, the shape is
  `["enquiries", "<column>", "TEXT"],` in `src/lib/crm/schema.ts`.
- Nothing shipped is undone. The one-tap mailto reply survives, moved to the end of
  the plain-text part instead of sitting between the draft and the CRM link.
- Every user-facing string is FR and EN, vouvoiement, no anglicisms, no em dashes.
- Encoding: everything that reaches the model stays ASCII (`toAscii` on our strings,
  the person's own text verbatim). The existing "the prompt is pure ASCII" assertion
  is extended to both prompt modes.

---

# 8. The three units

Exclusive files. Anything outside your list is a blocker with the exact edit, in
your final report. Commit only your own files; end the message with a blank line
then `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

Gates for everyone: `npx tsc --noEmit -p .` and `npm test`.

**Landing order: U3, then U2, then U1.** U3 removes the "Who decides" fact row
before U1 removes the question that feeds it, so no commit is ever red on its own.

## U1 - the questions and the flow

Files: `src/content/diagnostic.ts`, `src/components/DiagnosticWizard.tsx`.

1. Types: add `exclusive?: true` and `showIf?: (answers: Record<string, unknown>) => boolean`
   to `Option`; delete `starters` from `Question`; add
   `noneOption?: { key: string; en: string; fr: string }` to `Question`.
   Extend `BranchKey` with `"U"`.
2. Router: `exclusive: true` on `unsure`; `showIf: (a) => a.sellsOnline !== "no"` on
   card E. In `toggle()`, replace the two hardcoded `q.id === "pains" && id === "unsure"`
   lines with a generic test on `exclusive` (picking it clears everything else;
   picking anything else clears it).
3. `renderQ` filters options through `showIf`. A selected option that becomes hidden
   is dropped from the stored answer in an effect, never during render, so the branch
   and the score can never reference a card that is no longer offered.
4. Add `U_week`, `U_where` exactly as section 1 gives them, and
   `BRANCHES.U = [U_WEEK, U_WHERE, B_CHANNELS]` where `B_CHANNELS` is the same object
   literal referenced from `BRANCHES.B`. Add `U: ["U_week", "U_where"]` to
   `BRANCH_CORE`.
5. `picked` maps `"unsure"` to `"U"` instead of filtering it out. Delete the
   `n === 3` lines in `next()` and `back()`, and the `skipsDeepDive` / `visibleStep`
   / `totalSteps` branch: `totalSteps = 6`, `visibleStep = step`.
6. `MAGIC`: delete `starters`, new EN/FR wording, new hints, new placeholders, still
   required. Delete the `q.starters ? (...)` block in the textarea renderer and give
   the textarea a `placeholder`. In `answered()`, a textarea needs
   `trim().length >= 3` and `/\p{L}/u`.
7. `E_url` required, "(facultatif)" / "(optional)" removed from its label, hint added.
8. Budget option `unsure` relabelled (id untouched). `decision` cut from `STEP5`.
   `source` cut from `CONTACT`.
9. `company` required with the `noneOption` escape chip writing
   `companyNone: "none"`; `answered()` treats the question as answered when that key
   is set, and the input is cleared and disabled while it is. `site` reworded.
10. Results screen: `const selfServe = result.flags.includes("thin") || (result.grade === "C" && !serverProposed?.length)`.
    Delete the hardcoded `["AUTO"]` fallback: when there is nothing to show, show the
    self-serve tips, never an invented line. (`!serverProposed` is false for `[]`, so
    without this the honest empty proposal would keep being hidden.)

Check on staging with the browser: complete the check-up once down the U branch and
once down branch A, confirm "Étape 3 sur 6" on both, the router card E gone for
"Non, et ça nous va", and Continue blocked with its sentence on an empty magic box.

## U2 - the triage and its guarantees

Files: `src/lib/diagnosticTriage.ts`, `src/lib/diagnosticTriage.test.ts`,
`src/app/api/enquiry/route.ts`.

1. Export `GRID` and build the prompt's PUBLISHED PACKAGE GRID from it; derive
   `ALLOWED_FIGURES = {500, 800, 1200, 2500}` from the same constant.
2. `signalOf(answers, scoring) => { thin, missing }` per section 5.
3. Two schemas, `TriageProposeSchema` and `TriageAskSchema`, selected by `thin`, with
   every schema edit in section 5. `fit` + `fitReason` replace `noFit` in both.
4. Prompt edits in section 5, all ASCII. `leadBlock` gains the MISSING block and
   `Budget: NOT GIVEN`.
5. Post-answer code: money-token strip and budget tail on the subject, thin-mode
   money retry then deterministic fallback draft, grid-figure check for a no-budget
   lead, first-name and sign-off check, `fit` clamp, `unknowns` composition. Delete
   `if (!proposed.length) return null`.
6. Route: `TriageLead` gains `budgetId`; `price` is passed to the mail only when
   `fit === "fits"`; the `{ label: "Who decides" }` line leaves `facts[]`; the
   `{ label: "Heard about us" }` line leaves `diagnostics[]` ("Attribution" directly
   beneath says the same thing from data); `source` is still read and still stored
   (null for new rows); `companyNone` is read so the e-mail can say "they have none
   yet" rather than "not given"; `no_fit` and `unknowns` are stored from the new
   code-computed values.
7. Tests, pure, no network: `signalOf` thin for DM-JED9Y's stored answers and not
   thin for the other four; `moneyTokens` on the eight strings in section 5; the
   subject builder strips a model figure and appends the customer's own band, and
   appends "budget non précisé" when there is none; the fit clamp turns "fits" into
   "unclear" on a thin lead; `unknowns` contains "no phone number" whenever phone is
   empty; `buildTriagePrompt` is pure ASCII in both modes and the thin prompt
   contains no figure at all.

## U3 - the scoring, the thin signal and what the e-mail says

Files: `src/lib/diagnosticScoring.ts`, `src/lib/diagnosticScoring.test.ts` (new),
`src/lib/diagnostic/answers.ts`, `src/lib/diagnostic/answers.test.ts`,
`src/lib/mail.ts`, `src/lib/inbox/leadView.test.ts` (the row count only).
No `src/lib/crm/schema.ts` change: this plan adds no column.

1. Score the new answers so an unsure lead is no longer all zeroes.
   `U_week`: `replies` AGENT +3; `quotes` AUTO +3; `chasing` CRM +3 and AUTO +1;
   `retyping` AUTO +3 and CRM +1; `planning` AGENT +2 and AUTO +1; `searching` CRM +3;
   `none` scores nothing and pushes the flag `"no-symptom"`. The weight 3 matches a
   router card, so an unsure lead lands on the same scale as a pain lead.
   `U_where`: `paper` or `head` gives WEB +1 and the existing `"basics-first"` flag,
   and deliberately NOT the -1 AUTO / -1 CRM penalty the `tools: paper` rule applies,
   which would cancel the U_week signal; `sheet` or `inbox` gives CRM +1; `software`
   gives nothing.
2. Push the flag `"thin"` when `proposed.length === 0`. Grade stays C. This is the
   single machine-readable definition of "there is not enough here to propose
   anything", read by both the wizard and the route.
3. The security clamp reads the branch answers as evidence:
   `const sellsOnline = a.sellsOnline === "own-site" || a.sellsOnline === "marketplaces" || !!a.E_platform || !!a.E_url;`
   Answering the E deep dive IS the proof that a shop exists. Add `E_trigger === "asked"`
   to the urgency bump at +1 (a bank asking is a deadline; `gdpr` is not).
   Remove `researching` and the `decision?: string` field with the cut question.
4. `answers.ts`: `PRICE_FIT.unsure` and `STANDARD_PRICE` become
   `"not stated - ask before quoting, do not name a band"`. Drop the
   `{ label: "Who decides" }` entry from `saleFacts` and `"decision"` from
   `SALE_FACT_IDS`. When an option with `other: true` is selected and the matching
   `_other` value exists, print the typed text in its place ("Travail social", never
   "Other (tell us) - Travail social") and stop emitting the separate `_other` entry,
   so "their own words" holds their sentence and not their trade.
5. Promote the branch answers: `saleFacts` puts the deep-dive answers first, under
   the heading "What they told us goes wrong", above the demographic chips.
   DM-BSRA8's "Spreadsheets / Everyone keeps their own info" and DM-88HKT's "A
   partner or bank asked" have to be in the first screenful, not under the mailto.
6. `mail.ts`, the plain-text part: THE DETAIL prints only what THE FACTS does not
   (`SALE_FACT_IDS` already lists them); "Lead in the CRM: <url>" moves up to a short
   LINKS block right after the reply; the long one-tap mailto moves to its own block
   at the very end, after THE DETAIL, so the ~1,900 characters of percent-encoding
   are no longer between the draft and the link. The one-tap reply itself is not
   touched. WHAT TO PROPOSE, when there is nothing to propose, prints the honest
   banner instead of "Lines: (none scored)": "Not enough here to quote. Ask the
   questions below before proposing anything." The no-draft line becomes the
   checks-failed sentence from section 5. Header gains one legend line:
   `Grade C = they said they are only exploring (A: wants to start now and the budget
   covers it; B: in between). It is urgency and budget fit, never lead quality.`
7. `answers.test.ts`: the two pinned price strings, the eight-label assertion becomes
   seven with the indices shifted, and a new assertion that no string containing a
   euro figure is reachable from `budget = "unsure"`.
   `leadView.test.ts:234`: `8` becomes `7`. That one number is the only edit allowed
   in that file; `leadView.ts` itself is a blocker below.
   New `diagnosticScoring.test.ts`: the U weights, the thin flag on DM-JED9Y's stored
   answers, and SEC surviving for a `want-to` lead who answered `E_platform`.

## Blockers, with the exact edit

Not owned by any unit. Each unit repeats the ones it depends on in its report.

1. `src/lib/inbox/leadView.ts:568` -
   `price: enquiry.noFit ? null : priceFitFor(answers ? String(answers.budget ?? "") : ""),`
   so the lead page cannot print "Price that fits" immediately beside the badge that
   says nothing fits.
2. `src/components/admin/LeadDetail.tsx:789` - keep the price line, which is already
   conditional, and add beside the grade the one-line legend from U3 item 6. Better
   still, print the sentence instead of the letter: "Wants to start now" / "Just
   exploring". Nothing anywhere currently tells Radu what A, B or C mean.
3. `src/components/admin/LeadDetail.tsx`, reply block - when the draft is absent
   because it failed its checks, print "The draft did not pass its checks (no first
   name, or not signed by Radu). Write this one yourself." rather than an empty box.
4. `src/lib/inbox/leadView.ts:657` - the "The rest of the check-up" section keeps its
   filter, but the promoted branch answers arrive through `saleFacts`, so confirm the
   page does not print them twice after U3 lands.

---

# 9. For Radu, in plain words

**What each code means.** `DM-JED9Y` is the check-up's reference: `DM` for a check-up
enquiry (`LD` leads, `PR` prospects, `AU` audits, `SN` outreach sends), then five
characters from an alphabet with no 0, O, 1, I or L in it, so it can be read down the
phone without anyone asking "is that a one or an ell". The customer sees the same
code in their confirmation e-mail. `C` is not a quality mark and not a verdict on the
person: it is urgency plus budget fit, nothing else. "Dès que possible" scores 3,
"dans 1 à 3 mois" 2, "plus tard cette année" 1, "je me renseigne" 0; unanswered
messages add 1 and a security incident adds 2. A needs at least 2 and a budget that
covers the floor of the top line; B needs at least 1; everything else is C. Alberto
answered "je me renseigne", so 0, so C. It means "he told us he is only looking".
`AUTO+CRM` is the shortlist to pitch, best first: AGENT is the AI assistant, AUTO
process automation, WEB site and e-commerce, CRM customer follow-up, SEC the
e-commerce security audit. `A` to `E` on the pain question are the five cards, and
the letter also picks which deep dive follows; `E_trigger`, `D_where` and the like
are that deep dive's answer keys.

**Do we understand what these customers want?** Of the five, one: DM-BSRA8, the pool
company, six to twenty people, customer information in spreadsheets, everyone keeping
their own copy. That is a CRM sale and the answers say so. DM-88HKT is the one we got
wrong and it is the best lead in the batch: he worries about his shop's security, an
agency built the shop, and a partner or a bank asked him about it. That is a
deadline, on a published service line. The scoring zeroed it because an earlier chip
said he does not sell online yet, and the draft told him to come back "lorsque vous
serez prêt à vendre en ligne". The other three we do not understand, and the honest
reason is that we never asked: two of the three answered the pain question with "je
ne sais pas trop" and were then asked nothing at all, and three of the five magic
answers are our own suggestion chips, tapped. For Alberto, DM-JED9Y, the only true
facts are: a social worker, on his own, no website, only looking, no budget stated,
and one sentence of his own, "enlever un peu les mauvaises nouvelles". The
1.500-3.500 EUR in his subject line is not something he said and not something we
sell: it is the label of a budget chip he was shown and did not pick, and two of our
own rules ordered it printed. After this change that lead reaches you as "not enough
to quote yet, here are the three things to ask him", which is the true answer.
