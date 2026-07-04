"use client";

// Interactive ROI mini-calculator: drag hours/week of repetitive admin,
// see the yearly cost live, then jump into the free check-up. Numbers use
// tabular-nums so nothing shifts while dragging.
import { useState } from "react";
import Link from "next/link";
import type { Locale } from "@/lib/i18n";

type Copy = {
  eyebrow: string;
  title: string;
  sliderLabel: string;
  hoursUnit: string;
  yearlyHours: string;
  yearlyValue: string;
  rateNote: string;
  cta: string;
};

const WEEKS = 47;
const RATE = 30; // €/h — deliberately conservative

export function RoiCalculator({ locale, copy }: { locale: Locale; copy: Copy }) {
  const [hours, setHours] = useState(6);
  const yearlyHours = hours * WEEKS;
  const yearlyValue = yearlyHours * RATE;
  const fmt = new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB");

  return (
    <section className="cv-auto container-x py-20 md:py-24">
      <div className="gradient-border reveal rounded-2xl p-6 md:p-10">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h2 className="mt-4 max-w-2xl text-display-m">{copy.title}</h2>

        <div className="mt-8 grid gap-10 md:grid-cols-[1.2fr_1fr] md:items-center">
          <div>
            <label htmlFor="roi-hours" className="block text-sm leading-relaxed text-fg-muted">
              {copy.sliderLabel}
            </label>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
              <input
                id="roi-hours"
                type="range"
                min={1}
                max={30}
                step={1}
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
                className="roi-slider h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10"
              />
              <span className="shrink-0 font-display text-2xl font-medium tabular-nums text-fg-heading sm:w-32 sm:text-right">
                {hours} <span className="font-mono text-xs font-normal text-fg-faint">{copy.hoursUnit}</span>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line">
            <div className="bg-surface p-5">
              <p className="gradient-text font-display text-3xl font-medium tabular-nums">
                {fmt.format(yearlyHours)}
              </p>
              <p className="mt-2 text-sm text-fg-muted">{copy.yearlyHours}</p>
            </div>
            <div className="bg-surface p-5">
              <p className="font-display text-3xl font-medium tabular-nums text-fg-heading">
                {fmt.format(yearlyValue)} €
              </p>
              <p className="mt-2 text-sm text-fg-muted">{copy.yearlyValue}</p>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-5">
          <Link
            href={`/${locale}/diagnostic`}
            className="btn-primary inline-flex px-5 py-3 text-sm"
            onClick={() => {
              try {
                (window as unknown as { umami?: { track: (n: string, d?: object) => void } }).umami?.track("roi_calc_cta", { hours });
              } catch { /* best-effort */ }
            }}
          >
            {copy.cta}
          </Link>
          <p className="max-w-md font-mono text-xs leading-relaxed text-fg-faint">{copy.rateNote}</p>
        </div>
      </div>
    </section>
  );
}
