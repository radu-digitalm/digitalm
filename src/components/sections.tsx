import Link from "next/link";
import { getContent } from "@/content";
import type { Locale } from "@/lib/i18n";
import type { Pillar, Smb, Testimonial } from "@/content/types";
import { Signature } from "./Signature";

export function Eyebrow({
  children,
  withDot = true,
}: {
  children: React.ReactNode;
  withDot?: boolean;
}) {
  return (
    <p className="eyebrow inline-flex items-center gap-2">
      {withDot && (
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-gradient" aria-hidden="true" />
      )}
      {children}
    </p>
  );
}

export function PillarCard({ pillar }: { pillar: Pillar }) {
  const [num, label] = pillar.kicker.split("/").map((s) => s.trim());
  return (
    <article
      className={`card card-hover reveal relative flex flex-col p-6 md:p-7 ${
        pillar.lead ? "gradient-border" : ""
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-5xl font-light leading-none text-fg-faint/40 md:text-6xl">
            {num}
          </span>
          <span className="font-mono text-xs text-fg-faint">/ {label}</span>
        </div>
        {pillar.lead && (
          <span className="rounded-full bg-brand-gradient px-2.5 py-1 font-mono text-xs font-medium text-ink">
            Lead offer
          </span>
        )}
      </div>
      <h3 className="mt-5 text-xl">{pillar.title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-fg-muted">{pillar.summary}</p>
      <ul className="mt-5 space-y-2.5 text-sm">
        {pillar.points.map((point, i) => (
          <li key={i} className="flex gap-3 text-fg">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
      <p className="mt-6 border-t border-white/[0.07] pt-4 font-mono text-xs leading-relaxed text-fg-faint">
        {pillar.proof}
      </p>
    </article>
  );
}

export function CtaBand({
  locale,
  title,
  body,
}: {
  locale: Locale;
  title: string;
  body: string;
  button: string;
}) {
  const c = getContent(locale);
  return (
    <section className="container-x py-20">
      <div className="card relative overflow-hidden p-8 md:p-14">
        <div
          className="pointer-events-none absolute -right-24 -top-40 h-[600px] w-[600px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(237,30,121,0.14), rgba(241,90,36,0.05) 50%, transparent 70%)",
          }}
          aria-hidden="true"
        />
        <div className="relative max-w-2xl">
          <h2 className="display-tight text-display-l">{title}</h2>
          <p className="mt-4 text-fg-muted">{body}</p>
          <Link
            href={`/${locale}/book`}
            className="btn-primary mt-7 inline-flex px-5 py-3 text-sm"
          >
            {c.nav.cta}
          </Link>
          <p className="mt-4 font-mono text-xs text-fg-faint">
            {c.contact.form.responsePromise}
          </p>
        </div>
      </div>
    </section>
  );
}

export function Testimonials({
  heading,
  items,
}: {
  heading: { eyebrow: string; title: string };
  items: Testimonial[];
}) {
  return (
    <section className="cv-auto container-x py-20 md:py-24">
      <div className="max-w-2xl">
        <Eyebrow>{heading.eyebrow}</Eyebrow>
        <h2 className="mt-5 text-display-l">{heading.title}</h2>
      </div>
      <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {items.map((t) => (
          <figure key={t.name} className="card card-hover reveal flex flex-col p-6">
            <blockquote className="flex-1 border-l-2 border-accent/50 pl-4 text-sm leading-relaxed text-fg">
              {t.quote}
            </blockquote>
            <figcaption className="mt-5 border-t border-white/[0.07] pt-4">
              <p className="text-sm font-medium text-fg-heading">{t.name}</p>
              <p className="mt-0.5 font-mono text-xs text-fg-faint">{t.role}</p>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

/** The "access tier" band — affordable AI + websites for TPE/PME, deliberately
 *  downshifted and placed after the enterprise proof so credibility transfers down. */
export function SmbBand({ locale, smb }: { locale: Locale; smb: Smb }) {
  return (
    <section className="container-x py-8">
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-ink-soft p-8 md:p-12">
        <div className="absolute inset-y-0 left-0 w-0.5 bg-brand-gradient" aria-hidden="true" />
        <div className="grid items-center gap-10 md:grid-cols-[1fr_0.8fr]">
          <div>
            <Eyebrow>{smb.eyebrow}</Eyebrow>
            <h2 className="mt-4 text-display-m">{smb.title}</h2>
            <p className="mt-4 max-w-[48ch] leading-relaxed text-fg-muted">{smb.body}</p>
            <p className="mt-4 font-mono text-xs leading-relaxed text-fg-faint">{smb.proof}</p>
            <p className="mt-5">
              <span className="inline-flex rounded-full border border-white/10 bg-surface-2 px-3 py-1 font-mono text-[11px] text-accent-soft">
                {smb.priceChip}
              </span>
            </p>
            <div>
              <Link
                href={`/${locale}/pme`}
                className="btn-ghost mt-5 inline-flex px-5 py-3 text-sm"
              >
                {smb.cta}
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <Signature pulse={false} className="hidden h-28 w-auto shrink-0 sm:block" />
            <ul className="flex-1 divide-y divide-white/10 rounded-lg border border-white/10">
              {smb.points.map((p, i) => (
                <li key={i} className="px-4 py-3 text-sm leading-relaxed text-fg">
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ProcessBand({
  process,
}: {
  process: {
    eyebrow: string;
    title: string;
    steps: { title: string; detail: string }[];
  };
}) {
  return (
    <section className="cv-auto container-x py-16 md:py-20">
      <div className="max-w-2xl">
        <Eyebrow>{process.eyebrow}</Eyebrow>
        <h2 className="mt-5 text-display-l">{process.title}</h2>
      </div>
      <ol className="mt-10 grid gap-6 md:grid-cols-4">
        {process.steps.map((step, i) => (
          <li key={i}>
            <span className="font-display text-4xl font-light leading-none text-fg-faint/40">
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3 className="mt-3 text-base text-fg-heading">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-fg-muted">{step.detail}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Faq({
  faq,
}: {
  faq: { eyebrow: string; title: string; items: { q: string; a: string }[] };
}) {
  return (
    <section className="cv-auto container-x py-16 md:py-20">
      <div className="max-w-2xl">
        <Eyebrow>{faq.eyebrow}</Eyebrow>
        <h2 className="mt-5 text-display-l">{faq.title}</h2>
      </div>
      <div className="mt-10 max-w-3xl divide-y divide-white/[0.07] border-y border-white/[0.07]">
        {faq.items.map((item, i) => (
          <details key={i} className="group py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-fg-heading [&::-webkit-details-marker]:hidden">
              <span className="text-base font-medium">{item.q}</span>
              <svg
                className="shrink-0 text-fg-faint transition-transform group-open:rotate-45"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </summary>
            <p className="mt-3 max-w-prose text-sm leading-relaxed text-fg-muted">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
