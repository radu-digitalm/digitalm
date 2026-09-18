"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { useTurnstile } from "@/lib/useTurnstile";
import { PhoneField } from "./PhoneField";
import { currentAttribution } from "@/lib/attributionClient";
import {
  SITE_TZ,
  bothTimes,
  formatInZone,
  sameInstantClock,
  zoneCity,
  zoneLabel,
} from "@/lib/tz";

type Copy = {
  eyebrow: string;
  title: string;
  sub: string;
  benefits: string[];
  trust: string[];
  step1: string;
  step2: string;
  pickFirst: string;
  pickHintLocal: string;
  pickHintBoth: string;
  atSite: string;
  bookedWhen: string;
  bookedWhenSame: string;
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

const DAY: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" };
const DAY_TIME: Intl.DateTimeFormatOptions = { ...DAY, hour: "2-digit", minute: "2-digit" };

/** Fill {placeholders} in a copy string. */
function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m: string, k: string) => vars[k] ?? m);
}

export function BookingWidget({ locale, copy }: { locale: Locale; copy: Copy }) {
  const tag = locale === "fr" ? "fr-FR" : "en-GB";
  const [data, setData] = useState<Availability | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"booked" | "requested" | "error" | null>(null);
  const { token, container } = useTurnstile(true);

  // The browser already knows where the visitor is: no IP lookup, no third
  // party, nothing extra stored. Read once on mount (never during SSR).
  const [visitorTz, setVisitorTz] = useState("");
  useEffect(() => {
    try {
      setVisitorTz(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
    } catch {
      /* stay on the site zone */
    }
  }, []);

  // Pre-fill from the diagnostic hand-off (?name=&email=&phone=&ref=) so the
  // lead doesn't retype what they just gave us. Read once on mount.
  const [prefill, setPrefill] = useState<{ name?: string; email?: string; ref?: string }>({});
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setPrefill({
      name: p.get("name") ?? undefined,
      email: p.get("email") ?? undefined,
      ref: p.get("ref") ?? undefined,
    });
  }, []);

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
          tz: visitorTz,
          ref: prefill.ref,
          attribution: currentAttribution(),
          turnstile: token.current,
        }),
      });
      const json = await res.json();
      setResult(json.ok ? (json.mode === "booked" ? "booked" : "requested") : "error");
      if (json.ok) {
        try { (window as unknown as { umami?: { track: (n: string) => void } }).umami?.track(json.mode === "booked" ? "book_confirmed" : "book_requested"); } catch { /* best-effort */ }
      }
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

  // Where the visitor is vs where Digital M is. Falls back to the site zone,
  // so nothing below can read as "your time" when we do not know it.
  const siteTz = data?.tz || SITE_TZ;
  const localTz = visitorTz || siteTz;
  const siteCity = zoneCity(siteTz);

  /** "10:00 chez vous, soit 16:00 à Paris" for one instant. */
  function whenLine(iso: string): string {
    const at = new Date(iso);
    const t = bothTimes(at, localTz, siteTz, tag);
    const local = formatInZone(at, localTz, tag, DAY_TIME);
    return t.differ
      ? fill(copy.bookedWhen, { local, site: t.site, city: siteCity })
      : fill(copy.bookedWhenSame, { local });
  }

  if (result === "booked" || result === "requested") {
    return (
      <div id="book" className="card p-6 md:p-8">
        {Header}
        <p className="mt-5 rounded-lg border border-accent/30 bg-surface-2 px-4 py-3 text-sm text-fg-heading">
          {result === "booked" ? copy.successBooked : copy.successRequested}
        </p>
        {result === "booked" && selected ? (
          <p className="mt-2 text-sm text-fg-muted">{whenLine(selected)}</p>
        ) : null}
      </div>
    );
  }

  const configured = data?.configured ?? false;
  const slots = data?.slots ?? [];
  const liveNoSlots = configured && slots.length === 0;

  // Group live slots by the visitor's own day, each slot carrying the Paris
  // time too when the two clocks disagree (DST is per-slot, not per-page).
  const groups: { label: string; items: { iso: string; time: string; site: string }[] }[] = [];
  for (const iso of slots) {
    const dt = new Date(iso);
    const label = formatInZone(dt, localTz, tag, DAY);
    const t = bothTimes(dt, localTz, siteTz, tag);
    let g = groups.find((x) => x.label === label);
    if (!g) groups.push((g = { label, items: [] }));
    g.items.push({ iso, time: t.local, site: t.differ ? t.site : "" });
  }

  // Paris time for the slot the visitor picked, when it differs from theirs.
  const selectedTimes = selected ? bothTimes(new Date(selected), localTz, siteTz, tag) : null;
  const selectedSite = selectedTimes?.differ ? selectedTimes.site : "";

  // The hint above the list names both zones whenever they differ.
  const hintAt = slots[0] ? new Date(slots[0]) : new Date();
  const hint = sameInstantClock(localTz, siteTz, hintAt)
    ? fill(copy.pickHintLocal, { city: zoneCity(localTz) })
    : fill(copy.pickHintBoth, {
        local: zoneLabel(localTz, hintAt, tag),
        site: zoneLabel(siteTz, hintAt, tag),
      });

  const fields = (
    <>
      {/* Honeypot — hidden from users, catches bots. */}
      <div className="hidden" aria-hidden="true">
        <input type="text" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input key={`n-${prefill.name ?? ""}`} name="name" required placeholder={copy.name} aria-label={copy.name} defaultValue={prefill.name} className={INPUT} autoComplete="name" />
        <input key={`e-${prefill.email ?? ""}`} name="email" type="email" required placeholder={copy.email} aria-label={copy.email} defaultValue={prefill.email} className={INPUT} autoComplete="email" />
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
          <p className="mt-1 text-xs leading-relaxed text-fg-faint">{hint}</p>
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
                      className={`inline-flex min-h-[2.75rem] min-w-[4rem] flex-col items-center justify-center rounded-lg border px-3 py-1.5 font-mono text-sm leading-tight transition-colors ${
                        selected === s.iso
                          ? "border-accent bg-accent/15 text-fg-heading"
                          : "border-white/10 bg-surface-2 text-fg-muted hover:border-accent/40 hover:text-fg-heading"
                      }`}
                    >
                      <span>{s.time}</span>
                      {s.site ? (
                        <span className="text-[0.65rem] text-fg-faint">
                          {fill(copy.atSite, { time: s.site, city: siteCity })}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-6 text-sm font-semibold text-fg-heading">{copy.step2}</p>
          <div className="mt-3">{fields}</div>

          {selected ? (
            <p className="mt-4 rounded-lg border border-accent/30 bg-accent/10 px-4 py-2.5 text-sm text-fg-heading">
              <span className="capitalize">{formatInZone(new Date(selected), localTz, tag, DAY_TIME)}</span>
              {selectedSite ? (
                <span className="text-fg-muted"> · {fill(copy.atSite, { time: selectedSite, city: siteCity })}</span>
              ) : null}
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="ml-2 inline-flex min-h-[2.25rem] items-center px-2 text-xs normal-case text-fg-muted underline hover:text-fg-heading"
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
