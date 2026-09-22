"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import {
  STEP1, ROUTER, BRANCHES, BRANCH_CORE, TOOLS, MAGIC, STEP5, CONTACT, UI, BUDGET_CAD,
  type Question, type BranchKey,
} from "@/content/diagnostic";
import { score, RESULT_CARDS, SELF_SERVE, type Scoring, type ServiceLine } from "@/lib/diagnosticScoring";
import { useTurnstile } from "@/lib/useTurnstile";
import { PhoneField } from "./PhoneField";
import { countryFromTimeZone, countryFromLanguages } from "@/lib/phone";
import { currentAttribution, attributionQuery } from "@/lib/attributionClient";

type Answers = Record<string, string | string[]>;
const DRAFT_KEY = "dm-enquiry-draft-v1";
const INPUT =
  "w-full rounded-lg border border-white/10 bg-surface-2 px-4 py-3 text-base text-fg-heading placeholder:text-fg-faint focus:border-accent focus:outline-none";

declare global {
  interface Window {
    umami?: { track: (n: string, d?: Record<string, unknown>) => void };
  }
}

function track(name: string, data?: Record<string, unknown>) {
  try { window.umami?.track(name, data); } catch { /* analytics is best-effort */ }
}

/**
 * "monsite.fr" -> "https://monsite.fr". Returns null when the value cannot be a
 * web address (a space, or a host without a dot), so we never store "mon site".
 */
function normalizeUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v || /\s/.test(v)) return null;
  const full = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  const host = full.replace(/^https?:\/\//i, "").split(/[/?#]/)[0] ?? "";
  if (!host.includes(".") || host.startsWith(".") || host.endsWith(".")) return null;
  return full;
}

/**
 * Where the browser says the visitor is, as ISO2, or null when it will not say.
 * Time zone first, then the browser languages: the same two signals
 * `guessCountry` trusts first, and deliberately NOT its `fallbackDial` step,
 * which returns the dial code the page was rendered with (+33 on /fr). Posting
 * that would file every Quebec lead as French, which is the exact thing the
 * server refuses to do.
 */
/**
 * The visitor's IANA time zone ("America/Toronto"), or null when the browser
 * will not say. Stored beside the country hint so a lead with no usable number
 * can still be placed, and so Radu knows what o'clock it is where they are.
 */
function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function browserCountry(): string | null {
  try {
    return (
      countryFromTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ??
      countryFromLanguages(navigator.languages)
    );
  } catch {
    return null; // exotic browser: say nothing rather than guess
  }
}

/** "a, b et c" — plain enumeration, so the blocked line reads like a sentence. */
function joinWords(items: string[], and: string): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]!}`;
}

/**
 * Ends the reminder like a sentence. A line that already closes on a quoted
 * question ("… ? »" / "…?”") keeps that mark and takes no extra full stop,
 * which is what French typography expects.
 */
function endStop(s: string): string {
  return !s || /[.!?…]\s*[»”]?$/.test(s) ? s : `${s}.`;
}

/**
 * "Votre site web (si vous en avez un)" -> "Votre site web". The reminder only
 * ever names a field the visitor has to fill in, so a trailing aside about it
 * being optional would contradict the line it appears in.
 */
function plainName(label: string): string {
  const stripped = label.replace(/\s*\([^()]*\)\s*$/, "").trim();
  return stripped || label;
}

/** Question labels can run long; the reminder has to stay one short line. */
function shortLabel(s: string, max = 52): string {
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > 24 ? cut.slice(0, space) : cut).trim()}…`;
}

/** Every question in the tables, including the ones kept only to read old answers back. */
const ALL_QUESTIONS: Question[] = [
  ...STEP1, ROUTER, ...Object.values(BRANCHES).flat(), TOOLS, MAGIC, ...STEP5, ...CONTACT,
];

/** What a visitor is actually asked: a retired question is data, never a screen. */
const shown = (qs: Question[]): Question[] => qs.filter((q) => !q.retired);

/** url-kind answers, normalised on submit so a bare domain arrives usable. */
const URL_QUESTION_IDS: string[] = ALL_QUESTIONS.filter((q) => q.kind === "url").map((q) => q.id);

/** Questions with an option that an earlier answer can take away (router card E). */
const CONDITIONAL_QUESTIONS: Question[] = ALL_QUESTIONS.filter((q) => q.options?.some((o) => o.showIf));

/**
 * The answer keys the wizard still knows about. A draft saved before a question
 * was cut is resumed without it: the route looks some ids up by name, and a key
 * no screen can show any more is a fact nobody checked.
 */
const KNOWN_ANSWER_KEYS = new Set<string>([
  ...shown(ALL_QUESTIONS).map((q) => q.id),
  ...ALL_QUESTIONS.flatMap((q) => (q.noneOption ? [q.noneOption.key] : [])),
]);

/** Both paths are six screens: the counter never moves under the visitor. */
const TOTAL_STEPS = 6;

export function DiagnosticWizard({ locale }: { locale: Locale }) {
  const t = UI[locale];
  const L = locale;
  const [step, setStep] = useState(0); // 0 intro, 1..6, 7 results
  const [answers, setAnswers] = useState<Answers>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [tried, setTried] = useState(false); // they pressed Continue while it was not available
  const [showResume, setShowResume] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [result, setResult] = useState<Scoring | null>(null);
  const [serverProposed, setServerProposed] = useState<ServiceLine[] | null>(null);
  const [rationale, setRationale] = useState<string | null>(null);
  // Server render and first client render have to agree, so the guess happens
  // after hydration, exactly as PhoneField does it.
  const [country, setCountry] = useState<string | null>(null);
  const { token: tsToken, container: tsDiv } = useTurnstile(step === 6);
  const topRef = useRef<HTMLDivElement | null>(null);
  const scrolledFor = useRef<number | null>(null);
  const sending = useRef(false);

  // ----- put the new step at the top of the screen -----
  // Asking for the scroll in the same tick as setStep measures the step that is
  // leaving, so the visitor landed hundreds of pixels below the new question
  // (measured on mobile, 18 Sep 2026). The scroll waits for the new step to be
  // painted instead. It never runs on the first paint, so arriving on the page
  // (or resuming a draft on load) does not move it.
  useEffect(() => {
    const previous = scrolledFor.current;
    scrolledFor.current = step;
    if (previous === null || previous === step) return;
    const frame = requestAnimationFrame(() => {
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
      topRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [step]);

  // A new step starts quiet: the "what is missing" line waits for a tap again.
  useEffect(() => { setTried(false); }, [step]);

  useEffect(() => { setCountry(browserCountry()); }, []);

  // ----- draft autosave / resume -----
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.step > 0 && d.step < 7) setShowResume(true);
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (step > 0 && step < 7) {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ step, answers, other })); } catch { /* full/blocked */ }
    }
  }, [step, answers, other]);

  function resume() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}");
      const saved = (d.answers ?? {}) as Answers;
      const kept: Answers = {};
      for (const [k, v] of Object.entries(saved)) if (KNOWN_ANSWER_KEYS.has(k)) kept[k] = v;
      setAnswers(kept); setOther(d.other || {}); setStep(d.step || 1);
    } catch { setStep(1); }
    setShowResume(false);
  }
  function startOver() {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    setShowResume(false);
  }

  // ----- branch logic -----
  // "Je ne sais pas trop" routes to branch U instead of skipping the deep dive.
  // Half of everyone who gets past the router picks that card, and what used to
  // reach Radu from them was a trade, a headcount and a mood.
  const pains = answers.pains;
  const picked: BranchKey[] = useMemo(() => {
    const raw = Array.isArray(pains) ? (pains as string[]) : [];
    return raw
      .map((p) => (p === "unsure" ? "U" : p))
      .filter((b): b is BranchKey => Object.prototype.hasOwnProperty.call(BRANCHES, b));
  }, [pains]);
  const branchQuestions: Question[] = useMemo(() => {
    if (picked.length === 0) return [];
    if (picked.length === 1) return BRANCHES[picked[0]!];
    return picked.flatMap((b) => BRANCHES[b].filter((q) => BRANCH_CORE[b].includes(q.id)));
  }, [picked]);

  // A card an earlier answer takes away (the security card, once they say they
  // do not sell online) must not stay selected out of sight: the branch and the
  // score would follow a question the visitor was never shown. Pruned in an
  // effect, never during render.
  useEffect(() => {
    setAnswers((a) => {
      let next: Answers | null = null;
      for (const q of CONDITIONAL_QUESTIONS) {
        const v = a[q.id];
        const hidden = (id: string) => {
          const o = q.options?.find((x) => x.id === id);
          return !!o?.showIf && !o.showIf(a);
        };
        if (Array.isArray(v)) {
          const kept = v.filter((id) => !hidden(id));
          if (kept.length !== v.length) { next = next ?? { ...a }; next[q.id] = kept; }
        } else if (typeof v === "string" && v && hidden(v)) {
          next = next ?? { ...a };
          delete next[q.id];
        }
      }
      return next ?? a;
    });
  }, [answers]);

  const stepQuestions: Question[][] = [
    [], shown(STEP1), [ROUTER], shown(branchQuestions), [TOOLS, MAGIC], shown(STEP5), shown(CONTACT),
  ];

  function next() {
    const n = step + 1;
    // Deep-dive already asked for an address: carry it over instead of asking twice.
    if (n === 6) {
      setAnswers((a) => {
        if (typeof a.site === "string" && a.site.trim()) return a;
        const seed = [a.C_url, a.E_url].find((v) => typeof v === "string" && normalizeUrl(v) !== null);
        return typeof seed === "string" ? { ...a, site: seed } : a;
      });
    }
    setStep(n);
    track(`dm_step_${n}`, picked.length ? { branch: picked.join("+") } : undefined);
  }
  function back() {
    setStep(Math.max(0, step - 1));
  }

  /** `required`, or `requiredIf` satisfied by what they answered earlier. */
  function isRequired(q: Question): boolean {
    return q.required === true || (q.requiredIf ? q.requiredIf(answers) : false);
  }

  function answered(q: Question): boolean {
    const v = answers[q.id];
    // "Je n'en ai pas encore" is an answer, and a more useful one than a blank.
    if (q.noneOption && answers[q.noneOption.key] === "none") return true;
    if (q.kind === "chips-multi" || q.kind === "cards") return Array.isArray(v) && v.length > 0;
    if (q.kind === "email") return typeof v === "string" && /.+@.+\..+/.test(v);
    if (q.kind === "url") return typeof v === "string" && normalizeUrl(v) !== null;
    // The one required sentence in the form has to be words: a full stop or a
    // stray space used to satisfy it. "Je ne sais pas" still passes, on purpose,
    // because the triage has to see a thin answer rather than have it blocked.
    if (q.kind === "textarea") {
      return typeof v === "string" && v.trim().length >= 3 && /\p{L}/u.test(v);
    }
    return typeof v === "string" && v.trim().length > 0;
  }

  /** A selected "other" option that has to say what — e.g. activity -> Other. */
  function otherDetailRequired(q: Question): boolean {
    const v = answers[q.id];
    const chosen = (id: string) => (Array.isArray(v) ? v.includes(id) : v === id);
    return (q.options ?? []).some((o) => o.other && o.otherRequired && chosen(o.id));
  }

  function otherDetailMissing(q: Question): boolean {
    return otherDetailRequired(q) && !(other[q.id] ?? "").trim();
  }

  // What this step is still waiting for. `currentValid` is unchanged in meaning:
  // every required question answered, every "other" detail filled in.
  const stepQs: Question[] = stepQuestions[step] ?? [];
  const missingAnswers = stepQs.filter((q) => isRequired(q) && !answered(q));
  const missingDetails = stepQs.filter((q) => otherDetailMissing(q));
  const currentValid = missingAnswers.length === 0 && missingDetails.length === 0;

  /** Names of the questions still open, trimmed and quoted, at most three. */
  function nameList(qs: Question[]): string {
    const c = t.blocked;
    const shown = qs.slice(0, 3).map((q) => c.quote(shortLabel(plainName(L === "fr" ? q.fr : q.en))));
    const rest = qs.length - shown.length;
    return joinWords(rest > 0 ? [...shown, c.more(rest)] : shown, c.and);
  }

  // One sentence, always finished. A step can be waiting for an unanswered
  // question AND for the free text behind a selected "Autre" (step 1 does it),
  // and gluing the two halves with a space read as one run-on line.
  function blockedText(): string {
    const c = t.blocked;
    const only = stepQs.length === 1; // a single question needs no naming
    if (missingAnswers.length && missingDetails.length) {
      return endStop(c.both(nameList(missingAnswers), nameList(missingDetails)));
    }
    if (missingAnswers.length) {
      return endStop(only ? c.generic : c.answer(nameList(missingAnswers)));
    }
    if (missingDetails.length) {
      return endStop(only ? c.detailGeneric : c.detail(nameList(missingDetails)));
    }
    return "";
  }

  // Quiet by default: the reminder shows once they have tried the button, or
  // once they have answered something on this screen and the rest is missing.
  const blockedMsg =
    !currentValid && (tried || stepQs.some((q) => answered(q))) ? blockedText() : "";

  function tryNext() {
    if (!currentValid) { setTried(true); return; }
    next();
  }
  function trySubmit() {
    if (busy || sending.current) return;
    if (!currentValid) { setTried(true); return; }
    void submit();
  }

  // Turnstile is handled by the shared useTurnstile(step === 6) hook above.

  // ----- submit -----
  async function submit() {
    if (sending.current) return; // the button is no longer `disabled`; guard a double tap
    sending.current = true;
    setBusy(true); setError(false);
    const merged: Answers = { ...answers };
    for (const id of URL_QUESTION_IDS) {
      const v = merged[id];
      if (typeof v !== "string") continue;
      const normalised = normalizeUrl(v);
      if (normalised) merged[id] = normalised;
    }
    for (const [qid, txt] of Object.entries(other)) {
      if (txt.trim()) merged[`${qid}_other`] = txt.trim();
    }
    try {
      // Campaign attribution (utm_* / ChatGPT oppref) from the page URL — forwarded, never stored.
      const attribution = currentAttribution();
      const res = await fetch("/api/enquiry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // `phoneCountry` is only ever the browser's own answer (see
        // browserCountry): the server uses it for "Where" when the number
        // carries no dial code, so a guess from the page locale would be worse
        // than nothing. `undefined` drops out of the JSON.
        body: JSON.stringify({ locale: L, answers: merged, turnstile: tsToken.current, website: "", attribution, phoneCountry: country ?? undefined, browserTz: browserTimeZone() ?? undefined }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error("rejected");
      setReference(json.reference);
      setResult(score(merged));
      if (Array.isArray(json.proposed)) setServerProposed(json.proposed);
      if (typeof json.rationale === "string" && json.rationale) setRationale(json.rationale);
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      setStep(7);
      track("dm_submit", { grade: json.grade });
    } catch {
      setError(true);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  // ----- renderers -----
  function toggle(q: Question, id: string) {
    setAnswers((a) => {
      if (q.kind === "chips" || q.kind === "text") return { ...a, [q.id]: id };
      const cur = Array.isArray(a[q.id]) ? [...(a[q.id] as string[])] : [];
      const i = cur.indexOf(id);
      if (i >= 0) cur.splice(i, 1);
      else {
        // An option declared `exclusive` stands alone ("je ne sais pas trop",
        // "rien de tout ça"): picking it clears the rest, picking anything else
        // clears it. Declared on the option, not hardcoded on the question id.
        const exclusiveIds = (q.options ?? []).filter((o) => o.exclusive).map((o) => o.id);
        if (exclusiveIds.includes(id)) return { ...a, [q.id]: [id] };
        for (const ex of exclusiveIds) {
          const at = cur.indexOf(ex);
          if (at >= 0) cur.splice(at, 1);
        }
        if (q.max && cur.length >= q.max) cur.shift();
        cur.push(id);
      }
      return { ...a, [q.id]: cur };
    });
  }

  /** The one-tap escape under a required text field ("Je n'en ai pas encore"). */
  function toggleNone(q: Question, key: string) {
    setAnswers((a) => {
      const next = { ...a };
      if (next[key] === "none") { delete next[key]; return next; }
      next[key] = "none";
      delete next[q.id]; // the field is cleared and disabled while it is on
      return next;
    });
  }

  /**
   * The chip as the visitor reads it. Only the budget chips change, and only
   * for a visitor the browser puts in Canada: the euro band stays, with a
   * rounded Canadian figure after it. `o.id` is untouched, so the stored
   * answer, the scoring and the price grid all still see the euro band.
   */
  function optionLabel(q: Question, o: { id: string; en: string; fr: string }): string {
    const base = L === "fr" ? o.fr : o.en;
    if (q.id !== "budget" || country !== "CA") return base;
    const hint = BUDGET_CAD[o.id];
    return hint ? `${base} ${L === "fr" ? hint.fr : hint.en}` : base;
  }

  function renderQ(q: Question) {
    const label = L === "fr" ? q.fr : q.en;
    const hint = L === "fr" ? q.hintFr : q.hintEn;
    const ph = L === "fr" ? q.placeholderFr : q.placeholderEn;
    const val = answers[q.id];

    if (q.kind === "chips" || q.kind === "chips-multi" || q.kind === "cards") {
      const selected = (id: string) =>
        q.kind === "chips" ? val === id : Array.isArray(val) && val.includes(id);
      const isCards = q.kind === "cards";
      // Only the options this visitor's earlier answers still allow.
      const options = (q.options ?? []).filter((o) => !o.showIf || o.showIf(answers));
      return (
        <div key={q.id} className="mt-6 first:mt-0">
          <p className="text-base font-medium text-fg-heading">
            {label} {isRequired(q) ? null : <span className="text-fg-faint">·</span>}
          </p>
          {hint ? <p className="mt-1 text-sm text-fg-faint">{hint}</p> : null}
          <div className={isCards ? "mt-3 grid gap-2" : "mt-3 flex flex-wrap gap-2"}>
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => toggle(q, o.id)}
                aria-pressed={selected(o.id)}
                className={
                  (isCards
                    ? "w-full rounded-xl border px-4 py-3.5 text-left text-sm leading-snug "
                    : "inline-flex min-h-[2.75rem] items-center rounded-full border px-4 py-2 text-sm ") +
                  (selected(o.id)
                    ? "border-accent bg-accent/15 text-fg-heading"
                    : "border-white/10 bg-surface-2 text-fg-muted hover:border-accent/40 hover:text-fg-heading")
                }
              >
                {optionLabel(q, o)}
              </button>
            ))}
          </div>
          {options.some((o) => o.other && selected(o.id)) ? (
            <input
              value={other[q.id] ?? ""}
              onChange={(e) => setOther((s) => ({ ...s, [q.id]: e.target.value }))}
              placeholder={t.otherPlaceholder}
              aria-label={label}
              aria-required={otherDetailRequired(q) || undefined}
              className={`${INPUT} mt-3`}
            />
          ) : null}
        </div>
      );
    }

    if (q.kind === "textarea") {
      return (
        <div key={q.id} className="mt-6 first:mt-0">
          <p className="text-base font-medium text-fg-heading">{label}</p>
          {hint ? <p className="mt-1 text-sm text-fg-faint">{hint}</p> : null}
          {/* No tap-to-prefill starters: this sentence has to be theirs. The
              placeholder is a grey example the browser never submits. */}
          <textarea
            value={(val as string) ?? ""}
            onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
            rows={3}
            placeholder={ph}
            aria-required={isRequired(q) || undefined}
            className={`${INPUT} mt-3 resize-y`}
          />
        </div>
      );
    }

    // The phone question uses the same field, and therefore the same rules, as
    // the booking and contact forms: country picked from the browser, the
    // number checked against it, E.164 stored. The wizard has no <form>, so
    // the field publishes through `onValueChange` instead of hidden inputs.
    // It stays optional: an empty field stores an empty answer, never a bare
    // dial code. A number that does not check out is kept exactly as typed —
    // the server repairs what it can and Radu still gets something to read.
    if (q.kind === "tel") {
      return (
        <div key={q.id} className="mt-4 first:mt-0">
          <PhoneField
            id={`dm-${q.id}`}
            label={label}
            required={isRequired(q)}
            note={hint}
            defaultDial={L === "fr" ? "+33" : "+44"}
            initialValue={typeof val === "string" ? val : ""}
            onValueChange={(v) => {
              const next = v.valid ? v.e164 : v.raw.trim();
              setAnswers((a) => ((a[q.id] ?? "") === next ? a : { ...a, [q.id]: next }));
            }}
            fieldClass={INPUT}
            labelClass="mb-1.5 block text-sm text-fg-muted"
          />
        </div>
      );
    }

    // text / email / url
    const required = isRequired(q);
    const hintText = (required ? (L === "fr" ? q.hintRequiredFr : q.hintRequiredEn) : undefined) ?? hint;
    const typed = typeof val === "string" ? val.trim() : "";
    const none = q.noneOption;
    const noneOn = !!none && answers[none.key] === "none";
    // Same inline treatment as the booking form: only once they have left the field.
    const badUrl = q.kind === "url" && typed.length > 0 && normalizeUrl(typed) === null && touched[q.id] === true;
    return (
      <div key={q.id} className="mt-4 first:mt-0">
        <label className="mb-1.5 block text-sm text-fg-muted" htmlFor={`dm-${q.id}`}>{label}</label>
        <input
          id={`dm-${q.id}`}
          type={q.kind === "text" ? "text" : q.kind}
          value={noneOn ? "" : ((val as string) ?? "")}
          onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
          onBlur={() => setTouched((s) => (s[q.id] ? s : { ...s, [q.id]: true }))}
          placeholder={ph}
          disabled={noneOn}
          className={`${INPUT}${noneOn ? " opacity-50" : ""}`}
          aria-required={required || undefined}
          aria-invalid={badUrl || undefined}
          aria-describedby={badUrl ? `dm-${q.id}-error` : hintText ? `dm-${q.id}-hint` : undefined}
          autoComplete={q.id === "email" ? "email" : q.id === "firstName" ? "given-name" : q.id === "phone" ? "tel" : q.id === "company" ? "organization" : q.kind === "url" ? "url" : "off"}
        />
        {badUrl ? (
          <p id={`dm-${q.id}-error`} role="alert" className="mt-1 text-xs text-accent-soft">{t.urlInvalid}</p>
        ) : hintText ? (
          <p id={`dm-${q.id}-hint`} className="mt-1 text-xs text-fg-faint">{hintText}</p>
        ) : null}
        {/* The way out of a required field, one tap, and a fact in its own
            right: "they have none yet" is not "they did not answer". */}
        {none ? (
          <button
            type="button"
            onClick={() => toggleNone(q, none.key)}
            aria-pressed={noneOn}
            className={
              "mt-2 inline-flex min-h-[2.5rem] items-center rounded-full border px-3.5 py-2 text-xs " +
              (noneOn
                ? "border-accent bg-accent/15 text-fg-heading"
                : "border-white/10 bg-surface-2 text-fg-muted hover:border-accent/40 hover:text-fg-heading")
            }
          >
            {L === "fr" ? none.fr : none.en}
          </button>
        ) : null}
      </div>
    );
  }

  // ----- screens -----
  if (step === 0) {
    return (
      <div ref={topRef} className="card scroll-mt-24 p-6 md:scroll-mt-28 md:p-10">
        {showResume ? (
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm">
            <span className="text-fg-heading">{t.resume}</span>
            <button onClick={resume} className="font-medium text-accent-soft underline">{t.resumeYes}</button>
            <button onClick={startOver} className="text-fg-muted underline">{t.resumeNo}</button>
          </div>
        ) : null}
        <p className="eyebrow">{t.introEyebrow}</p>
        <h1 className="display-tight mt-4 text-display-m">{t.introTitle}</h1>
        <p className="mt-4 leading-relaxed text-fg-muted">{t.introSub}</p>
        <p className="mt-3 text-sm text-fg-faint">{t.introTrust}</p>
        <button
          onClick={() => { setStep(1); track("dm_step_1"); }}
          className="btn-primary mt-7 inline-flex px-7 py-3.5 text-sm"
        >
          {t.start}
        </button>
      </div>
    );
  }

  if (step === 7 && result) {
    // The server's list wins when it sent one, empty included: "we cannot name a
    // line from these answers" is an honest answer and the rules must not
    // overrule it. There is no invented fallback line any more.
    const cards: readonly ServiceLine[] = serverProposed ?? result.proposed;
    const selfServe =
      cards.length === 0 ||
      result.flags.includes("thin") ||
      (result.grade === "C" && !serverProposed?.length);
    // The AI paragraph is best-effort: when the model returns nothing usable the
    // screen falls back to the rule-based reading instead of an empty box.
    const aiSummary = typeof rationale === "string" ? rationale.trim() : "";
    const summary =
      aiSummary ||
      (selfServe
        ? t.resultFallback.none
        : t.resultFallback.lead(
            joinWords(cards.map((line) => RESULT_CARDS[line][L].title), t.resultFallback.and),
          ));
    // Pre-fill the booking form from what they just told us — one less form to retype.
    const bookParams = new URLSearchParams();
    if (typeof answers.firstName === "string" && answers.firstName) bookParams.set("name", answers.firstName as string);
    if (typeof answers.email === "string" && answers.email) bookParams.set("email", answers.email as string);
    if (typeof answers.phone === "string" && answers.phone) bookParams.set("phone", answers.phone as string);
    if (reference) bookParams.set("ref", reference);
    // Keep campaign attribution (utm_* / oppref) through the hand-off to /book.
    new URLSearchParams(attributionQuery()).forEach((v, k) => bookParams.set(k, v));
    const bookHref = `/${L}/book?${bookParams.toString()}`;
    return (
      <div ref={topRef} className="card scroll-mt-24 p-6 md:scroll-mt-28 md:p-10">
        <p className="eyebrow">{t.introEyebrow}</p>
        <h1 className="display-tight mt-4 text-display-m">{t.resultsTitle}</h1>
        {typeof answers.magic === "string" && answers.magic.trim() ? (
          <blockquote className="mt-4 break-words border-l-2 border-accent/60 pl-4 text-sm italic leading-relaxed text-fg-muted">
            {t.youToldUs} <span className="text-fg-heading">« {(answers.magic as string).trim()} »</span>
          </blockquote>
        ) : null}
        <p className="mt-4 break-words rounded-lg border border-accent/25 bg-accent/10 px-4 py-3 text-sm leading-relaxed text-fg-heading">
          {summary}
        </p>
        {selfServe ? (
          <div className="mt-6">
            <p className="text-sm font-semibold text-fg-heading">{t.selfServeTitle}</p>
            <ul className="mt-3 space-y-2">
              {SELF_SERVE[L].map((tip) => (
                <li key={tip} className="flex gap-2 text-sm leading-relaxed text-fg-muted">
                  <span aria-hidden className="mt-0.5 text-accent-soft">→</span>{tip}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mt-6 grid gap-4">
            {cards.map((line) => (
              <div key={line} className="rounded-xl border border-accent/25 bg-surface-2 p-5">
                <h2 className="text-lg text-fg-heading">{RESULT_CARDS[line][L].title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-fg-muted">{RESULT_CARDS[line][L].body}</p>
              </div>
            ))}
          </div>
        )}
        <p className="mt-6 text-sm text-fg-muted">{t.resultsReply}</p>
        <a href={bookHref} className="btn-primary mt-4 inline-flex px-6 py-3 text-sm">{t.resultsBook}</a>
        {reference ? <p className="mt-6 text-xs text-fg-faint">{t.resultsRef(reference)}</p> : null}
      </div>
    );
  }

  // steps 1..6
  // Every path has a step 3 now, so the counter is a plain count: no visible
  // step, no conditional total, nothing that can move under the visitor.
  // Capped short of full: the last screen is a form nobody has submitted yet,
  // and a bar at 100 % above it reads as "finished".
  const pct = Math.min(95, Math.round((step / TOTAL_STEPS) * 100));

  return (
    <div ref={topRef} className="card scroll-mt-24 p-6 md:scroll-mt-28 md:p-10">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-mono text-xs uppercase tracking-wide text-fg-faint">
          {t.stepOf(step, TOTAL_STEPS)}
        </p>
        <p className="text-sm text-fg-muted">{t.stepNames[step - 1]}</p>
      </div>
      <div aria-hidden className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>

      {step === 6 ? <p className="mt-6 text-sm leading-relaxed text-fg-muted">{t.contactHeader}</p> : null}

      <div className="mt-6">{(stepQuestions[step] ?? []).map(renderQ)}</div>

      {step === 6 ? (
        <>
          <div ref={tsDiv} />
          <p className="mt-5 text-xs leading-relaxed text-fg-faint">
            {t.privacy}{" "}
            <a className="underline" href={`/${L}/legal/confidentialite`} target="_blank" rel="noopener noreferrer">
              {t.privacyLink}
            </a>.
          </p>
        </>
      ) : null}

      {/* The button stays reachable and keeps `aria-disabled`, so a tap on a
          greyed-out button can answer the visitor instead of doing nothing. */}
      <div className="mt-7 flex items-center gap-4">
        <button onClick={back} className="-ml-3 inline-flex min-h-[2.75rem] items-center px-3 text-sm text-fg-muted underline hover:text-fg-heading">{t.back}</button>
        {step < 6 ? (
          <button
            onClick={tryNext}
            aria-disabled={!currentValid || undefined}
            aria-describedby="dm-blocked"
            className={`btn-primary ml-auto inline-flex px-6 py-3 text-sm${currentValid ? "" : " opacity-50"}`}
          >
            {t.continue}
          </button>
        ) : (
          <button
            onClick={trySubmit}
            aria-disabled={!currentValid || busy || undefined}
            aria-busy={busy || undefined}
            aria-describedby="dm-blocked"
            className={`btn-primary ml-auto inline-flex px-6 py-3 text-sm${currentValid && !busy ? "" : " opacity-50"}`}
          >
            {busy ? t.sending : t.see}
          </button>
        )}
      </div>
      <p
        id="dm-blocked"
        aria-live="polite"
        className={blockedMsg ? "mt-3 text-sm leading-relaxed text-fg-muted" : "sr-only"}
      >
        {blockedMsg}
      </p>
      {error ? <p role="alert" className="mt-3 text-sm text-accent-soft">{t.error}</p> : null}
    </div>
  );
}
