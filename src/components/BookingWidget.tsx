"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { useTurnstile } from "@/lib/useTurnstile";
import { PhoneField } from "./PhoneField";

type Copy = {
  eyebrow: string;
  title: string;
  sub: string;
  benefits: string[];
  trust: string[];
  step1: string;
  step2: string;
  pickFirst: string;
  pickHint: string;
  noSlots: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  needs: string;
  preferred: string;
  submit: string;
  request: string;
  submitting: string;
  change: string;
  successBooked: string;
  successRequested: string;
  error: string;
};

type Availability = { configured: boolean; tz: string; slotMin: number; slots: string[] };

const INPUT =
  "w-full rounded-lg border border-white/10 bg-surface-2 px-4 py-3 text-base text-fg-heading placeholder:text-fg-faint focus:border-accent focus:outline-none";

export function BookingWidget({ locale, copy }: { locale: Locale; copy: Copy }) {
  const tag = locale === "fr" ? "fr-FR" : "en-GB";
  const [data, setData] = useState<Availability | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"booked" | "requested" | "error" | null>(null);
  const { token, container } = useTurnstile(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/availability")
      .then((r) => r.json())
      .then((d: Availability) => alive && setData(d))
      .catch(() => alive && setData({ configured: false, tz: "", slotMin: 30, slots: [] }));
    return () => {
      alive = false;
    };
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const dial = String(fd.get("dialcode") || "");
    const num = String(fd.get("phoneNumber") || "");
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: fd.get("name"),
          email: fd.get("email"),
          phone: num ? `${dial} ${num}`.trim() : "",
          company: fd.get("company"),
          needs: fd.get("needs"),
          preferred: fd.get("preferred"),
          website: fd.get("website"),
          start: selected ?? "",
          locale,
          turnstile: token.current,
        }),
      });
      const json = await res.json();
      setResult(json.ok ? (json.mode === "booked" ? "booked" : "requested") : "error");
    } catch {
      setResult("error");
    } finally {
      setBusy(false);
    }
  }

  const Header = (
    <div>
      <p className="eyebrow">{copy.eyebrow}</p>
      <h2 className="mt-3 text-display-m">{copy.title}</h2>
      <p className="mt-3 text-sm leading-relaxed text-fg-muted">{copy.sub}</p>
      <ul className="mt-4 space-y-1.5">
        {copy.benefits.map((b) => (
          <li key={b} className="flex gap-2 text-sm leading-relaxed text-fg-muted">
            <span aria-hidden className="mt-0.5 text-accent-soft">✓</span>
            {b}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        {copy.trust.map((t) => (
          <span key={t} className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent-soft">
            {t}
          </span>
        ))}
      </div>
    </div>
  );

  if (result === "booked" || result === "requested") {
    return (
      <div id="book" className="card p-6 md:p-8">
        {Header}
        <p className="mt-5 rounded-lg border border-accent/30 bg-surface-2 px-4 py-3 text-sm text-fg-heading">
          {result === "booked" ? copy.successBooked : copy.successRequested}
        </p>
      </div>
    );
  }

  const configured = data?.configured ?? false;
  const slots = data?.slots ?? [];
  const liveNoSlots = configured && slots.length === 0;

  // Group live slots by local day.
  const groups: { label: string; items: { iso: string; time: string }[] }[] = [];
  for (const iso of slots) {
    const dt = new Date(iso);
    const label = dt.toLocaleDateString(tag, { weekday: "long", day: "numeric", month: "long" });
    const time = dt.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" });
    let g = groups.find((x) => x.label === label);
    if (!g) groups.push((g = { label, items: [] }));
    g.items.push({ iso, time });
  }

  const fields = (
    <>
      {/* Honeypot — hidden from users, catches bots. */}
      <div className="hidden" aria-hidden="true">
        <input type="text" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="name" required placeholder={copy.name} aria-label={copy.name} className={INPUT} autoComplete="name" />
        <input name="email" type="email" required placeholder={copy.email} aria-label={copy.email} className={INPUT} autoComplete="email" />
      </div>
      <div className="mt-3">
        <PhoneField
          label={copy.phone}
          defaultDial={locale === "fr" ? "+33" : "+44"}
          fieldClass={INPUT}
          labelClass="mb-1.5 block text-sm text-fg-muted"
        />
      </div>
      <input name="company" placeholder={copy.company} aria-label={copy.company} className={`${INPUT} mt-3`} autoComplete="organization" />
      <textarea name="needs" rows={2} placeholder={copy.needs} aria-label={copy.needs} className={`${INPUT} mt-3 resize-y`} />
    </>
  );

  return (
    <div id="book" className="card p-6 md:p-8">
      {Header}

      {/* Invisible Turnstile widget — its token rides along with the POST. */}
      <div ref={container} />

      {data === null ? (
        <p className="mt-5 text-sm text-fg-faint">…</p>
      ) : liveNoSlots ? (
        <p className="mt-5 text-sm text-fg-muted">{copy.noSlots}</p>
      ) : configured ? (
        <form onSubmit={submit} className="mt-6">
          <p className="text-sm font-semibold text-fg-heading">{copy.step1}</p>
          <p className="mt-1 font-mono text-xs text-fg-faint">{copy.pickHint}</p>
          <div className="mt-3 max-h-64 space-y-4 overflow-y-auto pr-1">
            {groups.map((g) => (
              <div key={g.label}>
                <p className="text-sm font-medium capitalize text-fg-muted">{g.label}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {g.items.map((s) => (
                    <button
                      key={s.iso}
                      type="button"
                      onClick={() => setSelected(s.iso)}
                      aria-pressed={selected === s.iso}
                      className={`inline-flex min-h-[2.75rem] min-w-[4rem] items-center justify-center rounded-lg border px-3 font-mono text-sm transition-colors ${
                        selected === s.iso
                          ? "border-accent bg-accent/15 text-fg-heading"
                          : "border-white/10 bg-surface-2 text-fg-muted hover:border-accent/40 hover:text-fg-heading"
                      }`}
                    >
                      {s.time}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-6 text-sm font-semibold text-fg-heading">{copy.step2}</p>
          <div className="mt-3">{fields}</div>

          {selected ? (
            <p className="mt-4 rounded-lg border border-accent/30 bg-accent/10 px-4 py-2.5 text-sm capitalize text-fg-heading">
              {new Date(selected).toLocaleString(tag, {
                weekday: "long",
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
              })}
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="ml-3 text-xs normal-case text-fg-muted underline hover:text-fg-heading"
              >
                {copy.change}
              </button>
            </p>
          ) : (
            <p className="mt-4 text-sm text-fg-faint">{copy.pickFirst}</p>
          )}

          <button
            type="submit"
            disabled={busy || !selected}
            className="btn-primary mt-4 inline-flex w-full justify-center px-5 py-3 text-sm disabled:opacity-50"
          >
            {busy ? copy.submitting : copy.submit}
          </button>
          {result === "error" ? (
            <p role="alert" className="mt-3 text-sm text-accent-soft">{copy.error}</p>
          ) : null}
        </form>
      ) : (
        // Fallback: no live calendar — request a call by email.
        <form onSubmit={submit} className="mt-5">
          {fields}
          <textarea
            name="preferred"
            rows={2}
            placeholder={copy.preferred}
            aria-label={copy.preferred}
            className={`${INPUT} mt-3 resize-y`}
          />
          <button
            type="submit"
            disabled={busy}
            className="btn-primary mt-5 inline-flex w-full justify-center px-5 py-3 text-sm disabled:opacity-50"
          >
            {busy ? copy.submitting : copy.request}
          </button>
          {result === "error" ? (
            <p role="alert" className="mt-3 text-sm text-accent-soft">{copy.error}</p>
          ) : null}
        </form>
      )}
    </div>
  );
}
