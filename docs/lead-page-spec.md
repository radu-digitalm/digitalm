# The lead page — one design

`/admin/leads/<id>` rebuilt. Written 21 Sep 2026, branch `fix/lead-page`.

Radu: *"is this how a service cloud lead page looks like?"* — no, and this document is the
one layout that answers it. It is not a Salesforce clone. It keeps the five load-bearing
parts of a real CRM record (highlights, a path, a fixed action bar, the record body, an
activity timeline split into upcoming and past) and throws away everything an enterprise
sales floor needs and a one-person studio does not.

Three rules run through every decision below:

1. **The page never contradicts the lead e-mail.** Every shared fact is derived by the same
   function the e-mail uses: place through `leadPlace()`, phone through `checkPostedPhone()`,
   service names through `LINE_LABEL`, the price band through `PRICE_FIT`, answer labels
   through one shared module. A node test locks this.
2. **A column is not a fact.** `leads.country` is the key `hashPhone()` normalises with. It is
   never rendered. Where the person is, is derived on read from evidence, in a fixed order.
3. **Nothing disappears.** No control is hidden because `prospect_id` is null; no row silently
   vanishes because it is empty. Empty means a short sentence, never a dash and never a gap.

---

## 1. What the five real leads must look like

The design is judged against the five rows in production (read-only). They are the test set.

| Lead | Name | Phone as stored | Dialable? | Derived Where | Their own words |
|---|---|---|---|---|---|
| LD-VQKA5 | Jojo | `+33 4187172114` | no (10 digits after +33, France uses 9) | Not proven | none — no `magic` answer |
| LD-6VF33 | Anaia | `15817015976` | no (no country code) | Not proven | "Courir après les factures impayées" |
| LD-24K4X | Steven | `+33780030320` | yes | France | "Courir après les factures impayées" |
| LD-4H4TW | Michel | none | — | Not known | "Répondre aux mêmes questions WhatsApp" |
| LD-BDQQZ | José | `+18732557953` | yes | Quebec, Canada | "Courir après les factures impayées" |

Jojo is the hard case and the page is designed around him: grade A, a call booked for 25 Sep,
a number that cannot be dialled, no free-text answer at all, and a `source` answer ("word of
mouth") that contradicts the ad click that actually brought him.

---

## 2. Layout

### Laptop (≥1024 px)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Leads / LD-VQKA5                                                             │
│ Jojo                                                    [Grade A] [New]      │  BAND 1
│ ── highlights strip ───────────────────────────────────────────────────────  │  header
│ ── reach strip: Write · Call · Where ──────────────────────────────────────  │  full
│ ── stage path: New ▸ Contacted ▸ Replied ▸ … [Mark contacted] [Change…] ───  │  width
│ ── quick actions: Write reply · Call · Log a call · Set next step · Note ──  │
└──────────────────────────────────────────────────────────────────────────────┘
┌───────────────────────────────────────────────┬──────────────────────────────┐
│ What they said                                │ Upcoming                     │
│ The facts that decide the sale (2 columns)    │ Timeline — Past              │  BAND 2 / 3
│ What to propose                               │ Related                      │  3 : 2
│ The ready reply                               │                              │
│ Ask them                                      │                              │
└───────────────────────────────────────────────┴──────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▸ Details (collapsed)                                                        │  BAND 3
└──────────────────────────────────────────────────────────────────────────────┘
```

Grid: `grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]` — the existing ratio, reused.
Above the fold at 1280×900: name, highlights, reach strip, path, quick actions and the first
lines of *What they said*.

### Phone (390 px)

One column, this order, no exceptions:

1. Breadcrumb + name + grade/urgent badges
2. Highlights (wraps to two or three lines)
3. Reach strip — **Write** and **Call** as full-width rows, 44 px minimum tap height
4. Stage line + one primary button
5. Quick actions — a 2×3 grid (not a horizontal scroller: a scroller hides its last item)
6. What they said
7. The facts (one column)
8. What to propose
9. The ready reply
10. Ask them
11. Upcoming
12. Past
13. Related
14. Details

Above the fold at 390×844: name, grade + urgent + what to propose, and the Write/Call rows.
No element may exceed the viewport width — today the raw `oppref` does, which is what makes
the page scroll sideways.

---

## 3. The blocks

Every field below names its source as `table.column` or `answers.<key> → label from`.

### BAND 1 · Header

| Element | Content | Source |
|---|---|---|
| Breadcrumb | `Leads / LD-VQKA5` | `leads.reference` |
| H1 | `leadTitle(lead)` — name, or `name · company` | `leads.name`, `leads.company` |
| Fallback H1 | `Unnamed lead · LD-XXXXX` when both are null | — |

### BAND 1 · Highlights strip — at most 7, fixed order, never reordered

| # | Item | Value | Source |
|---|---|---|---|
| 1 | Grade | Badge `A` / `B` / `C` — good / info / neutral | `enquiries.grade` |
| 2 | Urgent | Badge `URGENT`, variant `bad`, only when true | `enquiries.urgent` |
| 3 | What to propose | `Process automation + Customer follow-up (CRM)` | `enquiries.proposed` split on `+` through `LINE_LABEL` |
| 4 | Budget | `€1,500–3,500` or `budget not stated` | `answers.budget` → option `.en` |
| 5 | Wants to start | `As soon as possible` or `start not stated` | `answers.start` → option `.en` |
| 6 | Stage | Badge, `STAGE_LABELS` + `STAGE_TONE` | `leads.stage` |
| 7 | Age | `arrived 4 days ago` / `arrived 14 h ago` | `leads.created_at` |

No enquiry at all (contact / chat / booking leads): items 1–5 are replaced by one badge
reading `No check-up — came from the contact form` (or `…from the booking form`, `…from the
site chat`), from `leads.kind` through `KIND_LABELS`. Items 6 and 7 always render.

### BAND 1 · Reach strip

Three cells. Laptop: one row. Phone: three stacked full-width rows.

**Write** — `<a href="mailto:{email}">{email}</a>`. No e-mail on the row: `no address on file
— call them` (or `no address and no number on file` when both are missing).

**Call** — one of exactly three states, decided by `checkPostedPhone(leads.phone)`:

| State | Rendering |
|---|---|
| returns an E.164 string | `<a href="tel:+18732557953">+1 873 255 7953</a>` |
| returns null, `leads.phone` non-empty | the stored digits in `text-fg-muted`, no link, then: `cannot be dialled as stored — ask for it in your reply` |
| `leads.phone` is null | `no number — e-mail only` |

Jojo and Anaia take the middle state, for good. Radu decided those two rows are not
backfilled, so the page copes with them permanently.

**Where** — `leadWhere(view)` (§6). Never an ISO code, never "France" on the strength of the
country column. Always the answer and its reason in the same breath:

- `Quebec, Canada — from the +1 873 number` (José)
- `France — from the +33 number` (Steven)
- `Not proven — the number they typed cannot be used` (Jojo, Anaia)
- `Not known — no usable number and the browser did not say` (Michel)
- when the phone and the browser hint disagree, the phone wins and a second line reads
  `their browser said {country}`

### BAND 1 · Stage path

The seven forward stages as chevrons — New ▸ Contacted ▸ Replied ▸ Meeting ▸ Proposal ▸ Won,
with Lost/No response/STOP off the path. The current one is marked. One primary button names
the next move: at New it reads **Mark contacted**, at Contacted **They replied**, at Replied
**Mark meeting**, and so on. `Change stage` is a disclosure holding the existing nine-option
`StageSelect` for backward and closed moves.

Phone: the chevrons collapse to `Stage: New →` plus the same primary button.

Stage `stop`: the path renders greyed, the primary button is gone, and one line reads
`Asked not to be contacted — every way of reaching them is switched off here.` Write, Call,
Send in one tap and Log a call are all disabled with that same reason as their `title`.

### BAND 1 · Quick actions — one fixed row, every lead, every stage

`Write reply · Call · Log a call · Set next step · Add note`

Same five, same order, always present. Each scrolls to its block and focuses the first
control; *Call* is the `tel:` link when there is one, and otherwise the disabled cell carrying
the "cannot be dialled" sentence. **Nothing here is gated on `prospect_id`.** The two controls
that genuinely need a prospect — "Sent from Gmail" and the outreach call rules — move into
Details and say in one line what they need.

### BAND 2 · What they said — first block of the body, never collapsed

The block that answers *"i don't understand what the customer wants"*.

| Line | Source |
|---|---|
| Quote, verbatim, accents intact, `whitespace-pre-wrap`, 17 px | `answers.magic` under the label **The chore they want gone** |
| Further quotes | every `answers.*_other` entry, label `{question.en} (other)` — e.g. Michel's `activity_other` → `What does your business do? (other): Entretien piscine` |
| Inbound message | `leads.note` for kinds `contact`, `chat`, `booking`, under **What they sent us** — read-only |
| Empty state | `They typed nothing in their own words — the facts below are all we have.` (Jojo) |

The quotes are read-only text nodes. They are **never** rendered into an editable textarea
again: that is how a contact-form customer's only message came to sit in a box labelled
"Notes" that overwrites it on Save.

### BAND 2 · The facts that decide the sale

The same eight rows, in the same order, with byte-identical labels to the e-mail's facts
block, because both come from `saleFacts()` in the shared module. Two columns on the laptop,
one on the phone.

| Label | Source |
|---|---|
| What they do | `answers.activity` + `answers.activity_other`, joined ` — ` |
| Size | `answers.team` |
| Sells online | `answers.sellsOnline` |
| Budget | `answers.budget` |
| Wants to start | `answers.start` |
| Who decides | `answers.decision` |
| Tools today | `answers.tools` (multi, joined `, `), else `none picked` |
| Website | first non-empty of `answers.site`, `answers.C_url`, `answers.E_url`, else `not given` |

Values are the option's `.en` label. Unanswered reads `not stated` — the e-mail's word, not a
dash. Website renders as an `ExtLink` when it is a usable address.

Broken `answers` JSON: the whole block is replaced by
`The saved answers could not be read — the check-up reference below still opens the record.`
Never a 500. Real answers come from a public form with a 20 kB budget.

### BAND 2 · What to propose

- **Lines**: `enquiries.proposed` through `LINE_LABEL` — `Process automation + Customer follow-up (CRM)`
- **Price that fits**: `PRICE_FIT[answers.budget]`, e.g. `€1,500-3,500 — quote €2,000-3,500`; unknown budget → `not stated — quote the standard €1,500-3,500 range`
- **Why**: `enquiries.note_for_radu`, shown open, never behind a disclosure
- **Honest flag**: `enquiries.no_fit` (new column) as a `warn` line when present
- No triage: `The AI triage did not answer — the lines and the grade above are rule-based only.` Never an empty card.

### BAND 2 · The ready reply — open by default

Subject and body visible at 16 px, `whitespace-pre-wrap`. Source: `splitReplyDraft(enquiries.reply_draft, checkupSubject)` where `checkupSubject` is rebuilt exactly as the route builds it — `Votre check-up numérique (DM-XXXXX)` / `Your digital check-up (DM-XXXXX)` from `leads.locale`.

Three controls beneath, in this order:

1. **Send in one tap** — `replyLink(email, reply, 6000).href`. When the link could not carry the body the button says `Open a reply (the draft is above, too long to pre-fill)`; when the draft is a subject line only, `Open a reply (the draft above is a subject line only)`. Same three labels the e-mail uses.
2. **Copy** — clipboard, subject + blank line + body.
3. **I sent it** — records it (§4).

No draft: `No draft — the AI triage did not answer. Write the reply yourself; the facts above are what you have.` with the Write link beside it.

### BAND 2 · Ask them

`enquiries.call_questions` (new column, JSON array) as a numbered list, then
`enquiries.unknowns` (new column) as one line under **Still unknown**. The whole block is
hidden when both are absent — which is the case for all five existing leads, because the
triage returned them and nothing stored them. It appears from the next lead onward. The
heading is `Ask them`.

### BAND 3 · Timeline — one block, two sections

**Upcoming** first:

- `leads.next_action` with `leads.next_action_at`, e.g. `Discovery call (booked) — Thu 25 Sep, in 4 days`
- overdue: `was due 19 Sep, 2 days ago`, rendered with the `warn` badge
- quick controls: `+2 days`, `+1 week`, `Done`, `Edit`
- none set: `No next step set.` with a `Set one` button
- the editable form (next action + date) sits directly under Upcoming — **the separate
  right-hand "Next action & notes" card is deleted**, so a follow-up is set in exactly one
  place

**Past** second: the existing `activities` list, newest first, retyped at 15/16 px. Payload
lines are rendered as `label: value` with the key humanised — no `snake_case` reaches the
screen. `ipHash` stays hidden as today.

A note box sits at the foot of the timeline (and is what *Add note* jumps to).

### BAND 3 · Related — only rows that exist

- **The check-up** — `DM-C4DQ3`, links to nothing today but carries the submitted date
- dangling reference (the enquiry row is gone): `DM-ZZZZZ — this check-up is no longer in the database`
- **Prospect** — `PR-XXXXX`, name, link to `/admin/prospects/<id>`
- **Audit** — `AU-XXXXX · 42/100`, with a link to `/r/<token>` when there is one
- **Booked call** — `leads.next_action_at` when `leads.kind = "booking"`

Nothing linked → the block is not rendered at all. Never a row reading "not known".

### BAND 3 · Details — collapsed, everything the sale does not need

Opening it must not reflow the page into a second layout (it is the last block, full width).

- Every remaining check-up answer with its English label (`answerEntries()` minus the eight sale facts)
- Rule scores: `enquiries.scores` as `AUTO 3 · CRM 2 · SEC 1`, zeros dropped
- Urgency, flags
- How they heard about us — `answers.source` / `answers.source_other`, and whether it agrees with the ad click (§5)
- Language — `leads.locale` as `French` / `English`
- Legal basis — `LEGAL_BASIS[leads.legal_basis]` (`Their request` / `Legitimate interest`)
- Data from — `leads.data_source` in words (`a form on the site`, `the booking form`, `the site chat`, …) — never the raw value
- Notice sent, Replied, Closed + reason, Last activity — `fmtDateTime`
- IP — `leads.ip` (needs adding to `LEAD_COLUMNS`)
- Spam check — `Spam check: passed` / `Spam check: skipped — the checker was down` from `enquiries.flagged`
- Triage e-mail — `enquiries.mail_status` in words: `the triage e-mail went out` / `the triage e-mail failed` / `no triage e-mail was sent`
- **Where it came from** — the attribution sentence (§5) repeated, plus the campaign roll-up line, plus: source, medium, the full campaign name, the full ad id, and the full `oppref` — each with a copy button, each on its own row with `break-all` so nothing exceeds 390 px
- `oppref` caption: `ChatGPT's click id — used once to tell ChatGPT this lead came from the ad`
- `leads.country` shown here once, labelled `Country used to read the phone number` — never anywhere else on the page
- **Record a bounce** (the existing `SN-XXXXX` box) and **Sent from Gmail** (needs a linked prospect; when there is none, one line: `This needs a prospect record — inbound leads do not have one.`)

---

## 4. Every action the page offers

| Action | Where | What it does | What it writes |
|---|---|---|---|
| **Write** | reach strip, quick actions | opens `mailto:{email}` | nothing |
| **Call** | reach strip, quick actions | opens `tel:{E.164}`; absent or undialable → disabled cell with its sentence | nothing |
| **Send in one tap** | ready reply | opens `mailto:` pre-filled by `replyLink()` | nothing |
| **Copy** | ready reply | subject + body to the clipboard | nothing |
| **I sent it** | ready reply, quick actions | records the reply Radu just sent by hand | `POST /api/admin/leads/[id]/activity {kind:"sent"}` → `activities` row (kind `email_out`, channel `email`, actor `admin`, summary `Reply sent by hand — {subject}`); `leads.last_activity_at`; stage `new`→`contacted` via `stagePatch` (+ a `stage_change` activity); `enquiries.last_contact_at` moves (email\_out is a contact kind) |
| **They replied** | stage path (at Contacted), quick actions | the customer answered | `POST …/activity {kind:"mark_replied", text?}` → existing `markReplied()`: `activities` row (kind `email_in`, actor `prospect`), stage → `replied`, `leads.replied_at` |
| **Log a call** | quick actions | outcome + one note, **with or without a prospect** | `POST …/activity {kind:"call", outcome, text}` → `activities` row (kind `call`, channel `phone`, actor `admin`, summary `Call — {outcome} · {note}`, payload `{outcome}`); `leads.last_activity_at`; `enquiries.last_contact_at` |
| **Mark contacted / Mark meeting / …** | stage path primary button | one tap forward | `POST /api/admin/leads/[id] {stage}` → `leads.stage`, `replied_at`, `closed_at`, `close_reason` via `stagePatch` + a `stage_change` activity |
| **Change stage** | stage path disclosure | backward and closed moves | same route, same writes |
| **Mark STOP** | Details | opt-out list first, then the stage | `POST /api/admin/optouts {lead_id}` then `POST /api/admin/leads/[id] {stage:"stop"}` |
| **Set next step / Edit** | Upcoming | action text + date | `POST /api/admin/leads/[id] {next_action, next_action_at}` → those two columns only. It no longer posts `note`. |
| **+2 days / +1 week** | Upcoming | moves the date | same route, `next_action_at` only |
| **Done** | Upcoming | clears the follow-up and says so | `POST /api/admin/leads/[id] {next_action:"", next_action_at:""}` **and** `POST …/activity {kind:"note", text:"Next step done — {old text}"}` |
| **Add note** | quick actions, timeline foot | appends to the timeline | `POST …/activity {kind:"note", text}` → `activities` row (kind `note`, actor `admin`) |
| **Fix the number** | reach strip, only when the repair is unambiguous | offers, never performs: `418 is Quebec — set this number to +1 418 717 2114?` | on press: `POST /api/admin/leads/[id] {phone:"+14187172114"}` → `leads.phone`, `leads.phone_hash`; plus a `note` activity `Phone corrected from "+33 4187172114" to "+1 418 717 2114"` |
| **Edit name / company / e-mail / phone** | inline pencil on the header and the reach strip | corrects a wrong fact | `POST /api/admin/leads/[id] {name\|company\|email\|phone}` — the route already accepts all four |
| **Copy** (ad id, campaign, click id, IP) | Details | clipboard | nothing |
| **Record a bounce** | Details | unchanged | `POST …/activity {kind:"bounce", send_reference}` |
| **Sent from Gmail** | Details, needs a prospect | unchanged | `POST /api/admin/prospects/[id]/manual-send` |

Every mutation keeps the existing pattern: `adminFetch` (CSRF header) → toast → `router.refresh()`.
Stage, note and call additionally insert optimistically into the rendered timeline so the page
does not appear to argue with the person using it.

---

## 5. The attribution sentence

One sentence, built on read from `leads.attribution`, never from the frozen `leads.source_label`
(which stays as the fallback for rows with no attribution JSON — chat, messenger, outreach).

Shape:

```
{Paid|Unpaid} ad on {channel}. {Name} clicked it and {what they did}. Campaign "{name}"{ — that is the ad's name, not where {Name} is}. Ad …{last 6} ({n} of your {total} leads).
```

- `utm_medium = cpc` → "Paid"; an `oppref` present → the channel is ChatGPT.
- "what they did": `filled the check-up`; when the lead's kind is `booking` and a `merged`
  activity follows `lead_created` within the hour, `filled the check-up, then booked a call a
  minute later`.
- The name clause is added **only** when the derived Where is known and disagrees with a place
  word in the campaign name. Steven is genuinely in France, so his sentence carries no clause.
- The ad id is shortened **from the end**: the two live ads are `…2fca0c` and `…1b030e` and
  share their first eight characters, so any leading truncation would render them identical.

The five sentences, verbatim:

- **LD-VQKA5** — `Paid ad on ChatGPT. Jojo clicked it, filled the check-up, then booked a call a minute later. Campaign "fr-france" — that is the ad's name, not where Jojo is. Ad …2fca0c (3 of your 5 leads).`
- **LD-6VF33** — `Paid ad on ChatGPT. Anaia clicked it and filled the check-up. Campaign "fr-france" — that is the ad's name, not where Anaia is. Ad …2fca0c (3 of your 5 leads).`
- **LD-24K4X** — `Paid ad on ChatGPT. Steven clicked it and filled the check-up. Campaign "fr-france". Ad …1b030e (2 of your 5 leads).`
- **LD-4H4TW** — `Paid ad on ChatGPT. Michel clicked it and filled the check-up. Campaign "fr-france" — that is the ad's name, not where Michel is. Ad …1b030e (2 of your 5 leads).`
- **LD-BDQQZ** — `Paid ad on ChatGPT. José clicked it and filled the check-up. Campaign "fr-france" — that is the ad's name, not where José is. Ad …2fca0c (3 of your 5 leads).`

Second line — what the customer said, from `answers.source` / `answers.source_other`:

- Jojo → `Jojo said he heard about you by word of mouth — that does not match the ad click.`
- Anaia → `Anaia said she found you through ChatGPT — that matches.`
- Steven → `Steven chose "Something else" and did not say what.`
- Michel → `Michel did not answer how he heard about you.`
- José → `José said he found you through ChatGPT — that matches.`

The gendered pronoun is not guessed: the sentence is built as `{Name} said they heard about
you by word of mouth …` in code. The five above are shown with "he"/"she" only as a reading
aid in this document.

Campaign roll-up, one line, in Details:
`Campaign "fr-france": 5 leads so far — 4 in Quebec, 1 in France.` Computed from `leads` by
deriving each lead's Where the same way this page does. It is what tells Radu a
France-targeted campaign is buying Canadian clicks, and it lives in Details rather than in the
header because it is a fact about the ad, not about this person.

The sentence renderer must never emit `oppref`, the substring `utm`, or an `=` pair. A test asserts it.

---

## 6. Where — the order of trust

`leadWhere({ phone, browserCountry, ip, country })` returns `{ text, reason, second }`,
computed server-side and passed to the component as plain strings.

1. **A phone that passes `checkPostedPhone()`**, after `repairPostedPhone()` has been given a
   chance. Its dial code decides; `+1` is split CA/US by the area code, and the Canadian
   province is named. → `leadPlace({ phone })`.
2. **The stored browser hint** — `leads.browser_country`, written from the visitor's time zone
   then their browser languages. → `leadPlace({ country: browserCountry })`.
3. **Nothing.** → `Not known — no usable number and the browser did not say.`

The page language is never evidence. The campaign name is never evidence. `leads.country` is
never evidence — it is the locale fallback wearing a country's clothes, which is exactly how
three of the five rows became French.

`leadPlace()` is never called with `lead.country`. Verified trap:
`leadPlace({ phone: "+33 4187172114", country: "FR" })` → `"France"`,
`leadPlace({ phone: null, country: "FR" })` → `"France"` — the helper is right, the argument
is not. The only value that may reach its `country` argument is the browser hint.

When the stored phone exists but cannot be dialled, the text is
`Not proven — the number they typed cannot be used` rather than a country. When the phone and
the browser hint name different countries, the phone wins and `second` carries
`their browser said {country}`.

The IP is shown in Details as a value, never resolved into a country on this page.

`countryFromE164()` is fixed to return `null` when the digits cannot be a number for the
country its dial code claims — the same national-length and NANP-shape check
`checkPostedPhone()` already applies. `countryFromE164("+33 4187172114")` currently returns
`"FR"`; after the fix it returns `null`, and the three hooks fall through instead of asserting
a country. Existing rows are untouched.

---

## 7. New storage — additive only

Exact lines for `EXTRA_COLUMNS` in `src/lib/crm/schema.ts` (append under `// @@crm:inbox`):

```ts
["enquiries", "browser_country", "TEXT"],   // lead-page: ISO2 the visitor's browser reported (time zone, then languages)
["enquiries", "browser_tz", "TEXT"],        // lead-page: the visitor's IANA time zone, for their local hour
["enquiries", "call_questions", "TEXT"],    // lead-page: JSON string[] — the triage's questions for the call
["enquiries", "unknowns", "TEXT"],          // lead-page: the triage's one line of what we still do not know
["enquiries", "no_fit", "TEXT"],            // lead-page: the triage's honest "nothing we sell fits", with its reason
["leads", "browser_country", "TEXT"],       // lead-page: the same hint on the lead, for rows with no check-up
["leads", "browser_tz", "TEXT"],            // lead-page: the same time zone on the lead
```

Written going forward only. The five existing rows stay empty and fall through to rank 3 of
the order of trust, and their *Ask them* block simply does not render. **No backfill of
`/home/hermes/data/enquiries.db`, ever.**

Nothing else is added. The price band is re-derived from `answers.budget` through `PRICE_FIT`,
so it needs no column. `leads.ip` already exists and only needs adding to `LEAD_COLUMNS`.

---

## 8. Where the three evaluations disagree — and what we chose

| Question | Choice | Why, in one line |
|---|---|---|
| Country: `leadPlace({phone, country: lead.country})` (benchmark) or never read the column (data) | **Never read the column** | Fed the locale guess, the correct helper reproduces all three wrong answers. |
| `oppref`: off the page entirely (ours) or in Details (benchmark, data) | **In Details, with a copy button** | Deleting it means SQL the day OpenAI support asks for it; it is three lines down a collapsed block either way. |
| "Mark replied" also used for the reply Radu sends (benchmark) | **Two buttons: "I sent it" and "They replied"** | One writes `email_out`, the other `email_in`; the old name hid which direction the message went. |
| Radu's private note: in the next-step block (benchmark) or separated (ours) | **One note box, appending to the timeline; `leads.note` becomes read-only** | The next-step form's textarea is what makes a contact-form customer's only message one Save away from gone. |
| Country editable from the page (ours) | **No** | The column is never rendered, so editing it fixes nothing visible; "Fix the number" writes `phone`, which is what actually moves Where. |
| Campaign roll-up in the header (data) | **In Details** | It is a fact about the ad, not about the person whose page this is. |
| Reverse-DNS on the IP (data) | **Not now** | A DNS round trip on every page open to produce a hint, when the browser time zone fixes it properly from the next lead onward. |
| "AUTO+CRM" → "Automation + Customer follow-up" (benchmark) | **`LINE_LABEL` verbatim: "Process automation + Customer follow-up (CRM)"** | The page may not contradict the e-mail, and the e-mail uses `LINE_LABEL`. |

---

## 9. Wording, type and theme

- English only. Plain words. Nothing under 15 px; the scale is 17 / 16 / 15.
- Section headings: `text-[15px] uppercase tracking-wide text-fg-faint`. Labels 15 px. Values and body 16 px. Quotes and the H1 17 px and up.
- No hardcoded colours. Tokens only: `text-fg`, `text-fg-muted`, `text-fg-heading`, `text-fg-faint`, `border-line`, `bg-surface-2`, `.card`, `.eyebrow`, `.link-accent`, and the five `Badge` variants. Grade and urgency are Badge variants, so the light admin theme lands on top of this work without touching it.
- Everything rendered passes the forbidden-token lists in `src/components/admin/wording.ts` and `src/lib/discover/notes.ts`. In practice that bans, on this page: any `snake_case` token (so no `utm_source`, no `next_action`, no `legal_basis`), the words *partial*, *caveat*, *verified*, *claimed*, and the abbreviation *ISO2*. "Spam check: passed", not "verified".
- Dates: `fmtDate` / `fmtDateTime` (Europe/Paris, `en-GB`). The due-date input stays a native `type="date"`; its rendering is the browser's business.

---

## 10. Empty and broken states — one short sentence each, never a dash

| Case | Sentence |
|---|---|
| No phone | `no number — e-mail only` |
| Phone not dialable | `cannot be dialled as stored — ask for it in your reply` |
| No e-mail | `no address on file — call them` |
| No company | the H1 is the name alone; no "Company" row appears |
| No website | `not given` in the facts row |
| No check-up behind the lead | highlights read `No check-up — came from the contact form`; the facts, propose, reply and ask blocks do not render |
| Dangling check-up reference | `DM-ZZZZZ — this check-up is no longer in the database` |
| Unreadable `answers` JSON | `The saved answers could not be read — the check-up reference below still opens the record.` |
| No triage | `The AI triage did not answer — the lines and the grade above are rule-based only.` |
| No reply draft | `No draft — the AI triage did not answer. Write the reply yourself; the facts above are what you have.` |
| Triage e-mail failed | `The triage e-mail failed to send — the lead was saved anyway.` |
| No free-text answer | `They typed nothing in their own words — the facts below are all we have.` |
| No prospect | Related omits the row; the Gmail control in Details reads `This needs a prospect record — inbound leads do not have one.` |
| No next step | `No next step set.` + a `Set one` button |
| Stage STOP | `Asked not to be contacted — every way of reaching them is switched off here.` |
| No activities at all | `Nothing has happened yet.` |

---

## 11. Never copy

Explicit non-goals, so nobody adds them later: lead conversion into account / contact /
opportunity; a quote or product object; tabs across the record; per-stage guidance text;
activity type filters; a "recent records" rail; field-level permissions or a page-layout
editor; a component palette; a 0–100 lead score (the grade already says it); e-mail open
tracking. Each is enterprise weight that buys a one-person studio nothing.

---

## 12. The three units

Exclusive file ownership. A unit that needs an edit in another unit's file reports it as a
blocker with the exact edit; it does not make it.

### U1 — the page and its view model

**Owns**

- `src/components/admin/LeadDetail.tsx` (rewrite)
- `src/components/admin/lead/Highlights.tsx`, `ReachStrip.tsx`, `TheirWords.tsx`, `SaleFacts.tsx`, `WhatToPropose.tsx`, `ReadyReply.tsx`, `AskThem.tsx`, `RelatedBlock.tsx`, `DetailsBlock.tsx` (new)
- `src/app/(tools)/admin/(gated)/leads/[id]/page.tsx`
- `src/lib/inbox/leadView.ts` (new, server-side view-model builder)
- `src/lib/inbox/leads.ts`
- `src/lib/crm/types.ts`
- `src/lib/diagnostic/answers.ts` + `src/lib/diagnostic/answers.test.ts` (new)
- `src/lib/mail.ts` — **two additive edits only**: `export` on `mailtoLink` and `replyLink`. Nothing else in that file changes.

**Brief**

1. **The shared answers module** `src/lib/diagnostic/answers.ts`. Pure, no DB, no React, loadable by `node --test` (relative imports carry `.ts`, `import type` for types). It lifts, unchanged in behaviour, `labelFor()` (route.ts:67) and the entries loop (route.ts:156-170). Exports:
   - `parseAnswers(raw: string | null): { ok: boolean; answers: Record<string, unknown> }` — `parseJson` with a `{}` default and `ok:false` on failure.
   - `answerEntries(answers): { id, label, value, freeText, typed }[]` — English labels from `src/content/diagnostic.ts`, `_other` handled as `{question.en} (other)`.
   - `saleFacts(answers): { label: string; value: string }[]` — the eight rows of §3, in order, with the labels the e-mail uses today, word for word.
   - `ownWords(answers): { label: string; text: string }[]` — `magic` first under `The chore they want gone`, then every free-text entry.
   - `LINE_LABEL`, `PRICE_FIT`, `STANDARD_PRICE`, `priceFitFor(budgetId)`, `proposedLabel(proposed)`, `websiteOf(answers)`, `heardAbout(answers)`.
   - Every exported string is ASCII-safe for the model path; the visitor's own text is returned verbatim, accents intact.
2. **The query.** In `src/lib/inbox/leads.ts`: widen `getEnquirySummary()` to also select `answers`, `scores`, `flagged`, `ip`, `source`, `call_questions`, `unknowns`, `no_fit`, `browser_country`, `browser_tz`, and extend `EnquirySummary` accordingly (parsed, not raw). Add `ip`, `browser_country`, `browser_tz` to `LEAD_COLUMNS`, to `LeadRow`, to `rowToLead()`, to `LeadInput`, to the INSERT and to the `Lead` type in `src/lib/crm/types.ts` (`ip: string | null`, `browserCountry: string | null`, `browserTz: string | null`). Add `campaignLeadRows(campaign: string): { reference, phone, country, browserCountry, attribution }[]` for the roll-up. Nothing else in `insertLead`'s merge or hashing logic moves.
3. **The view model** `src/lib/inbox/leadView.ts`: `buildLeadView({ lead, enquiry, prospect, activities })` returns a plain-data `LeadView` — highlights, reach (with the three phone states resolved), where (from U3's `leadWhere`), sale facts, own words, propose, reply (subject, body, href, prefill label), ask-them, upcoming, related, details rows, the attribution sentence and second line (from U3's module). It runs on the server, so it may import `src/lib/mail.ts`; `LeadDetail.tsx` stays a client component and receives only strings, numbers and booleans.
4. **The component.** Bands exactly as §3, layouts exactly as §2, wording exactly as §§9–10. Action components come from U2 by the props contract in U2's brief; U1 composes them and never posts to a route itself.
5. **Tests** (`node:test`, `.ts` extensions on relative imports): `saleFacts()` returns the eight labels in the e-mail's order, asserted against the literal strings in `src/app/api/enquiry/route.ts`'s facts block (the consistency gate); `parseAnswers("{\"activity\":\"retail\",\"team\":")` returns `ok:false` and does not throw; `answerEntries` maps `pains:["D"]` and `D_where:["spreadsheets"]` to readable English; `ownWords` of Jojo's answers is empty; `proposedLabel("AUTO+CRM")` is `Process automation + Customer follow-up (CRM)`.

**Depends on** U3's `src/lib/inbox/where.ts` and `src/lib/inbox/attributionSentence.ts` — build against the signatures in U3's brief.

**Must not** touch any route under `src/app/api/`, `NextActionForm.tsx`, `StageSelect.tsx`, `Timeline.tsx`, `hooks.ts`, `phone.ts` or `schema.ts`.

---

### U2 — the actions and what they write

**Owns**

- `src/app/api/admin/leads/[id]/activity/route.ts`
- `src/app/api/admin/leads/[id]/route.ts`
- `src/components/admin/NextActionForm.tsx` (rewrite)
- `src/components/admin/Timeline.tsx`
- `src/components/admin/lead/QuickActions.tsx`, `StagePath.tsx`, `LogCallBox.tsx`, `NoteBox.tsx`, `InlineFact.tsx`, `Upcoming.tsx` (new)
- `src/lib/inbox/stages.ts` (the forward-path list only) + `src/lib/inbox/stages.test.ts`

**Brief**

1. **Two new activity kinds.** In the lead activity route add, beside `note` / `mark_replied` / `bounce`:
   - `{ kind: "sent", text? }` → `addActivity({ leadId, prospectId, kind: "email_out", channel: "email", actor: "admin", summary: text || "Reply sent by hand" })`, then advance `new` → `contacted` through the existing stage path (`updateLead(id, { stage: "contacted" })` when and only when the current stage is `new`). Returns `{ ok, activity, lead }`.
   - `{ kind: "call", outcome, text? }` → `addActivity({ leadId, prospectId, kind: "call", channel: "phone", actor: "admin", summary: "Call — {outcome label}{ · text}", payload: { outcome } })`. `outcome` is validated against the existing five values (`no_answer`, `answered`, `callback`, `refused`, `wrong_number`); anything else is a 422. **It must work with `prospect_id` null** — that is the whole point; the prospect call route with its TPS and call-window rules stays where it is, for outreach.
   Both return 404 on an unknown lead and 422 on a bad body, like the three existing kinds.
2. **`/api/admin/leads/[id]`** keeps its current patch keys. Do **not** add `country`. Confirm `phone` still round-trips through `updateLead` so "Fix the number" and the inline phone edit work; the phone hash follows automatically.
3. **`StagePath.tsx`.** Seven forward stages as chevrons from a new `FORWARD_STAGES` export in `stages.ts` (`new, contacted, replied, meeting, proposal, won` for the path; `lost`, `no_response`, `stop` off it). One primary button naming the next move. `Change stage` is a `<details>` holding the existing `StageSelect` — whose props and behaviour must not change, because `LeadTable.tsx` renders it per row. Phone: `Stage: New →` plus the button.
4. **`QuickActions.tsx`.** The five fixed cells of §3, same order, never gated on a prospect. Props: `{ leadId, stage, email, telHref, phoneNote }`. A cell whose action is impossible stays visible, is disabled, and carries its sentence.
5. **`NextActionForm.tsx` rewritten as Upcoming + form.** It renders the upcoming line (`in 4 days`, `was due …, 2 days ago` with the `warn` badge), the chips `+2 days`, `+1 week`, `Done`, `Edit`, and the editable action + date. **It no longer renders or posts `note`.** `Done` clears both columns and posts the note activity of §4.
6. **`NoteBox.tsx`** — one box, appends to the timeline, reachable from the quick actions and from the foot of the timeline.
7. **`LogCallBox.tsx`** — outcome select + note + button, posting the new `call` kind.
8. **`InlineFact.tsx`** — a label, a value, a pencil; on save posts the single key to `/api/admin/leads/[id]`. Used for name, company, e-mail, phone. Also carries the "Fix the number" offer when `repairPostedPhone()` (passed in as a prop by U1) yields a different, dialable number: it posts `{ phone }` and then a `note` activity naming the old and the new value.
9. **`Timeline.tsx`** — split into the `Upcoming` slot (rendered by the parent, passed as `children`) and `Past`. Retype at 15/16 px with the existing tokens. Humanise payload keys so no `snake_case` reaches the screen; keep `ipHash` hidden. Empty: `Nothing has happened yet.`
10. **Optimistic insert.** Note, call, "I sent it" and stage changes insert their row into the rendered list immediately and reconcile on `router.refresh()`.
11. **Tests**: the new `FORWARD_STAGES` list and the "next move" function in `stages.test.ts` (pure, `node:test`).

**Props contract U1 builds against** (do not change without telling U1):

```ts
<StagePath leadId stage />            <QuickActions leadId stage email telHref phoneNote />
<Upcoming leadId nextAction nextActionAt />   <LogCallBox leadId />
<NoteBox leadId />                    <InlineFact leadId field label value repair? />
<Timeline activities>{upcoming}</Timeline>
```

**Must not** touch `LeadDetail.tsx`, `leads.ts`, `leadView.ts`, `answers.ts`, `mail.ts`, `phone.ts`, `hooks.ts`, `schema.ts` or the enquiry route.

---

### U3 — record correctness and the two leftovers

**Owns**

- `src/lib/phone.ts` + `src/lib/phone.test.ts`
- `src/lib/inbox/where.ts` + `src/lib/inbox/where.test.ts` (new)
- `src/lib/inbox/attributionSentence.ts` + `src/lib/inbox/attributionSentence.test.ts` (new)
- `src/lib/inbox/hooks.ts`
- `src/app/api/enquiry/route.ts`
- `src/lib/crm/schema.ts`
- `src/components/DiagnosticWizard.tsx`
- `src/components/ChatWidget.tsx`, `src/app/[locale]/layout.tsx`
- `src/lib/diagnosticTriage.ts`

**Brief**

1. **`countryFromE164()`** (phone.ts:301) returns `null` whenever `checkPostedPhone()` on the same input returns `null` — the same national-length and NANP-shape check. `countryFromE164("+33 4187172114")` → `null`. Its three callers in `hooks.ts` then fall through to `insertLead`'s locale default instead of asserting a country. Existing rows are untouched; only new leads change.
2. **`src/lib/inbox/where.ts`** — the order of trust of §6, server-only, may import `leadPlace` from `src/lib/mail.ts`:

```ts
export interface WhereEvidence { phone: string | null; browserCountry: string | null; }
export interface WhereResult { text: string; reason: string | null; second: string | null; known: boolean; }
export function leadWhere(e: WhereEvidence): WhereResult;
/** The three phone states of §3, shared by the page and anything else that shows a number. */
export function phoneState(phone: string | null):
  | { kind: "dialable"; e164: string; href: string }
  | { kind: "unusable"; stored: string; note: string; repair: string | null }
  | { kind: "none"; note: string };
```

   `leadWhere` must never accept `lead.country`; its type makes that impossible. `repair` is
   `repairPostedPhone()`'s output when it differs from the stored value and is dialable —
   `"+33 4187172114"` → `null` (the repair to `+1 418 717 2114` is inferred from the area code
   and is offered by `phoneState` only when the digits are an unambiguous NANP number), and
   `"15817015976"` → `"+15817015976"`.
3. **`src/lib/inbox/attributionSentence.ts`** — §5, pure, `node:test`-loadable:

```ts
export function attributionSentence(a: Attribution, ctx: { name: string; kind: LeadKind; booked: boolean; where: string | null; adCount: number; total: number }): string | null;
export function heardAboutLine(name: string, answers: Record<string, unknown>): string | null;
export function shortAdId(adId: string): string;   // last 6 characters, prefixed "…"
```

   Returns `null` when there is no attribution JSON, so the caller falls back to
   `leads.source_label`. It must never emit the click id, the substring `utm`, or an `=` pair.
4. **Browser hints through the pipe.** `DiagnosticWizard.tsx` posts `browserTz` beside the
   existing `phoneCountry` (`Intl.DateTimeFormat().resolvedOptions().timeZone`, inside the same
   try/catch, `undefined` when the browser will not say). The enquiry route reads both, writes
   them into the `enquiries` INSERT, and passes them to `leadFromEnquiry`; `hooks.ts` threads
   them into `insertLead` as `browserCountry` / `browserTz`. Do the same for the contact and
   booking hooks' signatures so their routes can pass the values when they gain them.
   `leads.browser_country` is the only value that may ever reach `leadPlace()`'s `country`
   argument.
5. **Persist what the e-mail already shows.** The enquiry route additionally writes
   `call_questions` (JSON array), `unknowns` and `no_fit` from the live triage object, so
   *Ask them* works from the next lead on. The five existing rows keep them null and the block
   does not render.
6. **`src/lib/crm/schema.ts`** — the seven `EXTRA_COLUMNS` lines of §7, verbatim, under `// @@crm:inbox`.
7. **The enquiry route imports the shared module.** Replace the private `labelFor()` (line 67),
   the entries loop (lines 156-170), `LINE_LABEL` (lines 29-35) and `PRICE_FIT` (lines 40-46)
   with imports from U1's `src/lib/diagnostic/answers.ts`, and build the e-mail's facts block
   from `saleFacts()`. Behaviour is identical — the route already uses `q.en` and the same
   tables — and this is what stops the page and the e-mail drifting apart. Co-ordinate the
   landing order with U1: the module must exist first.
8. **Leftover — the triage model variable.** `src/lib/diagnosticTriage.ts:27` reads
   `OPENAI_MODEL`, a name that appears nowhere in `.env.example` or `.env.local`, while its two
   siblings are `OPENAI_MODEL_CHAT` and `OPENAI_MODEL_DRAFTS`. Change it to
   `process.env.OPENAI_MODEL_TRIAGE || process.env.OPENAI_MODEL || "gpt-4.1-mini"` and document
   it in the file's header comment. **Do not edit any `.env` file** — report the line
   `OPENAI_MODEL_TRIAGE=gpt-4.1-mini` as a blocker for the integrator to add to `.env.example`
   beside `OPENAI_MODEL_CHAT`.
9. **Leftover — the chat bubble overlap.** `ChatWidget`'s launcher is
   `fixed bottom-5 right-5 z-40`, 56 px, rendered from `src/app/[locale]/layout.tsx` on every
   public page. Measured on staging at 390×844: it sits on top of the check-up's answer chips
   (over "Oui, sur notre propre site" at step 1) and, at the foot of the page, on top of the
   legal notice in the footer. Two changes: (a) `ChatWidget` returns `null` on the check-up
   route — `usePathname()` ending in `/diagnostic` — because a chat bubble competing with the
   funnel it feeds is the overlap; (b) the public footer gains `pb-20 sm:pb-6` so the legal
   line clears the launcher everywhere else. Verify at 390 px with a screenshot before and
   after. `CookieConsent`'s own launcher-aware measuring code is correct and is not touched.
10. **Tests**: `countryFromE164("+33 4187172114") === null`; `leadWhere({ phone: null, browserCountry: null })` is `Not known…` and never `France`; `leadWhere` has no way to be passed `lead.country`; `phoneState("15817015976")` is `unusable` with a repair of `+15817015976`; `shortAdId` of the two live ad ids produces two different strings; `attributionSentence` never emits the click id, `utm`, or `=`; the five sentences of §5 are asserted verbatim against fixtures.

**Must not** touch `LeadDetail.tsx`, `leads.ts`, `leadView.ts`, `answers.ts`, `mail.ts`, `Timeline.tsx`, `NextActionForm.tsx`, `StageSelect.tsx` or any admin route.

---

## 13. Gates

- `cd /home/hermes/workspace/digitalm && npx tsc --noEmit -p .`
- `cd /home/hermes/workspace/digitalm && npm test`
- Staging only for the browser: 1280×900 and 390×844 on `/admin/leads/LD-…`, with no
  horizontal page scroll and no element wider than the viewport at 390 px.
- Never write to `/home/hermes/data/enquiries.db`; `/home/hermes/data/enquiries-staging.db` is
  the one to seed against.
- Never run `npm run build`, never edit a `.env` file, never submit a form on `digitalm.eu`,
  never submit the booking form anywhere.
