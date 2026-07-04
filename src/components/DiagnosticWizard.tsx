"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n";
import {
  STEP1, ROUTER, BRANCHES, BRANCH_CORE, TOOLS, MAGIC, STEP5, CONTACT, UI,
  type Question, type BranchKey,
} from "@/content/diagnostic";
import { score, RESULT_CARDS, SELF_SERVE, type Scoring, type ServiceLine } from "@/lib/diagnosticScoring";
import { useTurnstile } from "@/lib/useTurnstile";

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

export function DiagnosticWizard({ locale }: { locale: Locale }) {
  const t = UI[locale];
  const L = locale;
  const [step, setStep] = useState(0); // 0 intro, 1..6, 7 results
  const [answers, setAnswers] = useState<Answers>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [showResume, setShowResume] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [result, setResult] = useState<Scoring | null>(null);
  const [serverProposed, setServerProposed] = useState<ServiceLine[] | null>(null);
  const [rationale, setRationale] = useState<string | null>(null);
  const { token: tsToken, container: tsDiv } = useTurnstile(step === 6);
  const topRef = useRef<HTMLDivElement | null>(null);

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
      setAnswers(d.answers || {}); setOther(d.other || {}); setStep(d.step || 1);
    } catch { setStep(1); }
    setShowResume(false);
  }
  function startOver() {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    setShowResume(false);
  }

  // ----- branch logic -----
  const picked = (answers.pains as string[] | undefined)?.filter((p) => p !== "unsure") as BranchKey[] | undefined;
  const branchQuestions: Question[] = useMemo(() => {
    if (!picked || picked.length === 0) return [];
    if (picked.length === 1) return BRANCHES[picked[0]!];
    return picked.flatMap((b) => BRANCHES[b].filter((q) => BRANCH_CORE[b].includes(q.id)));
  }, [picked]);

  const stepQuestions: Question[][] = [
    [], STEP1, [ROUTER], branchQuestions, [TOOLS, MAGIC], STEP5, CONTACT,
  ];

  function next() {
    let n = step + 1;
    if (n === 3 && branchQuestions.length === 0) n = 4; // "unsure" skips deep-dive
    setStep(n);
    track(`dm_step_${n}`, picked?.length ? { branch: picked.join("+") } : undefined);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function back() {
    let n = step - 1;
    if (n === 3 && branchQuestions.length === 0) n = 2;
    setStep(Math.max(0, n));
  }

  const currentValid = (stepQuestions[step] ?? []).every((q) => {
    if (!q.required) return true;
    const v = answers[q.id];
    if (q.kind === "chips-multi" || q.kind === "cards") return Array.isArray(v) && v.length > 0;
    if (q.kind === "email") return typeof v === "string" && /.+@.+\..+/.test(v);
    return typeof v === "string" && v.trim().length > 0;
  });

  // Turnstile is handled by the shared useTurnstile(step === 6) hook above.

  // ----- submit -----
  async function submit() {
    setBusy(true); setError(false);
    const merged: Answers = { ...answers };
    for (const [qid, txt] of Object.entries(other)) {
      if (txt.trim()) merged[`${qid}_other`] = txt.trim();
    }
    try {
      const res = await fetch("/api/enquiry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: L, answers: merged, turnstile: tsToken.current, website: "" }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error("rejected");
      setReference(json.reference);
      setResult(score(merged));
      if (Array.isArray(json.proposed) && json.proposed.length) setServerProposed(json.proposed);
      if (typeof json.rationale === "string" && json.rationale) setRationale(json.rationale);
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      setStep(7);
      track("dm_submit", { grade: json.grade });
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      setError(true);
    } finally {
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
        // "unsure" on the router is exclusive.
        if (q.id === "pains" && id === "unsure") return { ...a, [q.id]: ["unsure"] };
        if (q.id === "pains" && cur.includes("unsure")) cur.splice(cur.indexOf("unsure"), 1);
        if (q.max && cur.length >= q.max) cur.shift();
        cur.push(id);
      }
      return { ...a, [q.id]: cur };
    });
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
      return (
        <div key={q.id} className="mt-6 first:mt-0">
          <p className="text-base font-medium text-fg-heading">
            {label} {q.required ? null : <span className="text-fg-faint">·</span>}
          </p>
          {hint ? <p className="mt-1 text-sm text-fg-faint">{hint}</p> : null}
          <div className={isCards ? "mt-3 grid gap-2" : "mt-3 flex flex-wrap gap-2"}>
            {q.options?.map((o) => (
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
                {L === "fr" ? o.fr : o.en}
              </button>
            ))}
          </div>
          {q.options?.some((o) => o.other && selected(o.id)) ? (
            <input
              value={other[q.id] ?? ""}
              onChange={(e) => setOther((s) => ({ ...s, [q.id]: e.target.value }))}
              placeholder={t.otherPlaceholder}
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
          {q.starters ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {q.starters.map((s) => {
                const txt = L === "fr" ? s.fr : s.en;
                return (
                  <button
                    key={txt}
                    type="button"
                    onClick={() => setAnswers((a) => ({ ...a, [q.id]: txt.replace(/…$/, " ") }))}
                    className="inline-flex min-h-[2.5rem] items-center rounded-full border border-white/10 bg-surface-2 px-3.5 py-2 text-xs text-fg-muted hover:border-accent/40 hover:text-fg-heading"
                  >
                    {txt}
                  </button>
                );
              })}
            </div>
          ) : null}
          <textarea
            value={(val as string) ?? ""}
            onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
            rows={3}
            className={`${INPUT} mt-3 resize-y`}
          />
        </div>
      );
    }

    // text / email / tel / url
    return (
      <div key={q.id} className="mt-4 first:mt-0">
        <label className="mb-1.5 block text-sm text-fg-muted" htmlFor={`dm-${q.id}`}>{label}</label>
        <input
          id={`dm-${q.id}`}
          type={q.kind === "text" ? "text" : q.kind}
          value={(val as string) ?? ""}
          onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
          placeholder={ph}
          className={INPUT}
          autoComplete={q.id === "email" ? "email" : q.id === "firstName" ? "given-name" : q.id === "phone" ? "tel" : q.id === "company" ? "organization" : "off"}
        />
        {hint ? <p className="mt-1 text-xs text-fg-faint">{hint}</p> : null}
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
    const cards: readonly ServiceLine[] =
      serverProposed ?? (result.proposed.length ? result.proposed : (["AUTO"] as const));
    // Pre-fill the booking form from what they just told us — one less form to retype.
    const bookParams = new URLSearchParams();
    if (typeof answers.firstName === "string" && answers.firstName) bookParams.set("name", answers.firstName as string);
    if (typeof answers.email === "string" && answers.email) bookParams.set("email", answers.email as string);
    if (typeof answers.phone === "string" && answers.phone) bookParams.set("phone", answers.phone as string);
    if (reference) bookParams.set("ref", reference);
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
        {rationale ? (
          <p className="mt-4 break-words rounded-lg border border-accent/25 bg-accent/10 px-4 py-3 text-sm leading-relaxed text-fg-heading">
            {rationale}
          </p>
        ) : null}
        {result.grade === "C" && !serverProposed ? (
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
  const visibleStep = step > 3 && branchQuestions.length === 0 ? step - 1 : step;
  const totalSteps = branchQuestions.length === 0 ? 5 : 6;
  const pct = 15 + (visibleStep / (totalSteps + 1)) * 85;

  return (
    <div ref={topRef} className="card scroll-mt-24 p-6 md:scroll-mt-28 md:p-10">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-mono text-xs uppercase tracking-wide text-fg-faint">
          {t.stepOf(visibleStep, totalSteps)}
        </p>
        <p className="text-sm text-fg-muted">{t.stepNames[step - 1]}</p>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
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

      <div className="mt-7 flex items-center gap-4">
        <button onClick={back} className="-ml-3 inline-flex min-h-[2.75rem] items-center px-3 text-sm text-fg-muted underline hover:text-fg-heading">{t.back}</button>
        {step < 6 ? (
          <button onClick={next} disabled={!currentValid} className="btn-primary ml-auto inline-flex px-6 py-3 text-sm disabled:opacity-50">
            {t.continue}
          </button>
        ) : (
          <button onClick={submit} disabled={!currentValid || busy} className="btn-primary ml-auto inline-flex px-6 py-3 text-sm disabled:opacity-50">
            {busy ? t.sending : t.see}
          </button>
        )}
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-accent-soft">{t.error}</p> : null}
    </div>
  );
}
