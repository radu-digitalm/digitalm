import { safeHttpUrl } from "@/lib/crm/classify";
import { REPORT_UI } from "@/content/report";
import { checkCounts, checkRows, firstSteps, googleLine, topFindings } from "@/lib/report/findings";
import type { ReportData } from "@/lib/report/view";
import { CheckList } from "./CheckList";
import { Findings } from "./Findings";
import { FirstSteps } from "./FirstSteps";
import { ReportFooter } from "./ReportFooter";
import { ScoreMeter } from "./ScoreMeter";

// The prospect's one-page report (contract §8). Server component rendered
// only from the stored audit (checks, score, flags, fits, top) plus the safe
// display name, town and trade — every value lands in a JSX text node. The
// only foreign href is the prospect's website through safeHttpUrl(); the CTA
// links are same-origin paths tagged with the audit reference so a diagnostic
// or a booking that follows is attributed to this report.

function utm(locale: "fr" | "en", path: string, ref: string): string {
  const q = new URLSearchParams({ utm_source: "outreach", utm_medium: "email", utm_campaign: ref });
  return `/${locale}/${path}?${q.toString()}`;
}

function formatDate(sql: string | null, locale: "fr" | "en"): string {
  if (!sql) return "";
  const d = new Date(sql.includes("T") ? sql : `${sql.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return "";
  return locale === "fr"
    ? new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Paris" }).format(d)
    : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }).format(d);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function ReportPage({ data }: { data: ReportData }) {
  const { audit, locale } = data;
  const ui = REPORT_UI[locale];
  const rows = checkRows(audit.checks, audit.flags, locale);
  const findings = topFindings(audit.checks, audit.flags, audit.top, locale);
  const steps = firstSteps(audit.fits, audit.flags, locale);
  const counts = checkCounts(audit.checks);
  const site = data.website ? safeHttpUrl(data.website) : null;
  const trade = data.trade ? data.trade.charAt(0).toUpperCase() + data.trade.slice(1) : null;
  const where = [trade, data.town].filter(Boolean).join(" · ");

  return (
    <main lang={locale} className="report min-h-screen bg-ink text-fg">
      <div className="mx-auto max-w-3xl px-6 py-10 md:py-14">
        <header>
          <p className="eyebrow">
            {ui.eyebrow} · {audit.reference}
          </p>
          <h1 className="mt-3 text-3xl md:text-4xl">{ui.title.replace("{business}", data.business)}</h1>
          {where ? <p className="mt-2 text-fg-muted">{where}</p> : null}
          <p className="mt-3 text-sm text-fg-muted">
            {site ? (
              <>
                {ui.siteChecked}
                {locale === "fr" ? " : " : ": "}
                <a href={site} target="_blank" rel="noopener noreferrer nofollow" className="link-accent">
                  {hostOf(site)}
                </a>
              </>
            ) : data.website ? (
              <>
                {ui.siteChecked}
                {locale === "fr" ? " : " : ": "}
                <span className="break-all">{data.website}</span>
              </>
            ) : (
              ui.noWebsite
            )}
            {audit.finishedAt ? ` · ${ui.checkedOn} ${formatDate(audit.finishedAt, locale)}` : ""}
          </p>
        </header>

        <ScoreMeter score={audit.score} grade={audit.grade} measured={counts.measured} locale={locale} />
        <Findings rows={findings} locale={locale} />
        <CheckList rows={rows} locale={locale} />

        <section className="mt-6" aria-labelledby="report-google">
          <h2 id="report-google" className="text-base text-fg-heading">
            {ui.googleHeading}
          </h2>
          <p className="mt-1 text-sm text-fg-muted">{googleLine(audit.checks, locale)}</p>
        </section>

        <FirstSteps steps={steps} locale={locale} />

        <section className="no-print card mt-10 p-6" aria-labelledby="report-cta">
          <h2 id="report-cta" className="text-2xl">
            {ui.ctaHeading}
          </h2>
          <p className="mt-1 text-sm text-fg-muted">{ui.ctaIntro}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a href={utm(locale, "diagnostic", audit.reference)} className="btn-primary inline-flex items-center px-5 py-3 text-sm">
              {ui.ctaDiagnostic}
            </a>
            <a href={utm(locale, "book", audit.reference)} className="btn-ghost inline-flex items-center px-5 py-3 text-sm">
              {ui.ctaBook}
            </a>
          </div>
        </section>

        <p className="mt-8 text-xs text-fg-faint">{ui.methodNote}</p>
        <ReportFooter locale={locale} privacyHref={`/${locale}/legal/confidentialite`} />
      </div>
    </main>
  );
}

/** The 200 view for a report past report_expires_at: no findings, a link to the free diagnostic. */
export function ReportExpired({ data }: { data: ReportData }) {
  const { locale } = data;
  const ui = REPORT_UI[locale];
  return (
    <main lang={locale} className="report flex min-h-screen items-center justify-center bg-ink px-6 py-20 text-fg">
      <div className="w-full max-w-lg text-center">
        <p className="eyebrow">{ui.eyebrow}</p>
        <h1 className="mt-4 text-3xl md:text-4xl">{ui.expiredHeading}</h1>
        <p className="mt-4 text-fg-muted">{ui.expiredBody}</p>
        <div className="no-print mt-8">
          <a href={utm(locale, "diagnostic", data.audit.reference)} className="btn-primary inline-flex items-center px-5 py-3 text-sm">
            {ui.expiredCta}
          </a>
        </div>
        <ReportFooter locale={locale} privacyHref={`/${locale}/legal/confidentialite`} />
      </div>
    </main>
  );
}
