// Legal block builder (contract §12): picks the footer by rule AND locale,
// resolves the placeholders (opt-out link, two-part source notice with dates,
// trade, privacy URL) and renders it as text and as HTML. The opt-out line is
// the first line of the block, alone, after a blank line and a "—" rule, in
// both renderings. Pure — no DB, no next/*, no env — so node --test loads it;
// the caller passes SITE_URL in the context.
import type { Prospect, SendRule } from "../crm/types.ts";
import { safeHttpUrl } from "../crm/classify.ts";
import { fromSql } from "../crm/time.ts";
import { EMAIL_CLAUSES, EMAIL_SOURCE, FALLBACK_TRADE, FOOTERS, IDENTITY_SOURCES, WEBSITE_IDENTITY } from "../../content/outreach.ts";
import type { OutreachLocale } from "../../content/outreach.ts";

export interface LegalContext {
  /** SITE_URL without a trailing slash. */
  siteUrl: string;
  /** The send's opt-out token (43-char base64url); a preview may pass a placeholder. */
  token: string;
  prospect: Pick<Prospect, "source" | "website" | "domainKey" | "savedAt" | "tradeKey">;
  /** Trade in words (tradeWords / tradeLabel); null → the fallback wording. */
  trade: string | null;
  /**
   * Where the email address was found. `{ domain, page, auditDate }` names the
   * prospect's site (page when known) and the audit date; null means the
   * address came from the identity source itself and the sentence is omitted.
   */
  emailSource: { domain: string; page: string | null; auditDate: string | null } | null;
}

// ---- URLs and dates -----------------------------------------------------------------------

export function optoutUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/$/, "")}/o/${token}`;
}

export function privacyUrl(siteUrl: string, locale: OutreachLocale): string {
  return `${siteUrl.replace(/\/$/, "")}/${locale}/legal/confidentialite`;
}

/** dd/mm/yyyy in FR, "d Month yyyy" in EN (Europe/Paris civil date); "" when unset. */
export function formatLegalDate(sql: string | null | undefined, locale: OutreachLocale): string {
  const d = fromSql(sql);
  if (!d) return "";
  return locale === "fr"
    ? new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Paris" }).format(d)
    : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }).format(d);
}

/** Registrable domain shown in the notice: domain_key, else the website's host, else "". */
export function domainForNotice(p: Pick<Prospect, "website" | "domainKey">): string {
  if (p.domainKey) return p.domainKey;
  const safe = p.website ? safeHttpUrl(p.website) : null;
  return safe ? new URL(safe).hostname.replace(/^www\./, "") : "";
}

/** Two-part source notice: the label of the identity source and its public URL. */
export function identitySource(p: Pick<Prospect, "source" | "website" | "domainKey">, locale: OutreachLocale): { label: string; url: string } {
  if (p.source !== "manual") {
    const s = IDENTITY_SOURCES[p.source];
    return { label: s.label[locale], url: s.url };
  }
  const domain = domainForNotice(p);
  const site = p.website ? safeHttpUrl(p.website) : null;
  return { label: WEBSITE_IDENTITY[locale].replace("{domain}", domain), url: site ?? (domain ? `https://${domain}` : "") };
}

// ---- rendering ------------------------------------------------------------------------------

export function footerLocale(rule: SendRule, locale: OutreachLocale): OutreachLocale {
  return rule.footer === "fr" ? locale : "en";
}

/** The raw template for a rule and locale (fr rule → FR or EN; UK/US rules → EN). */
export function footerTemplate(rule: SendRule, locale: OutreachLocale): string {
  return FOOTERS[rule.footer][footerLocale(rule, locale)];
}

interface Resolved {
  text: string;
  urls: { optout: string; identity: string; privacy: string };
}

/** Text placeholders resolved, URL placeholders left in place (the HTML renderer turns them into links). */
function resolve(rule: SendRule, ctx: LegalContext, locale: OutreachLocale): Resolved {
  const lang = footerLocale(rule, locale);
  let text = footerTemplate(rule, locale);
  const identity = identitySource(ctx.prospect, lang);
  const urls = { optout: optoutUrl(ctx.siteUrl, ctx.token), identity: identity.url, privacy: privacyUrl(ctx.siteUrl, lang) };

  if (ctx.emailSource) {
    const src = EMAIL_SOURCE[lang];
    const emailSource = (ctx.emailSource.page ? src.withPage : src.withoutPage)
      .replace("{domain}", ctx.emailSource.domain)
      .replace("{page}", ctx.emailSource.page ?? "");
    text = text.replace("{email_source}", emailSource).replace("{audit_date}", formatLegalDate(ctx.emailSource.auditDate, lang));
  } else {
    text = text.replace(EMAIL_CLAUSES[lang], "");
  }
  text = text
    .replace("{identity_source}", identity.label)
    .replace("{saved_date}", formatLegalDate(ctx.prospect.savedAt, lang))
    .replace("{trade}", (ctx.trade ?? "").trim() || FALLBACK_TRADE[lang]);
  return { text, urls };
}

/** The legal block as plain text: "—", the opt-out line alone, a blank line, the notice paragraphs. */
export function legalFooter(rule: SendRule, ctx: LegalContext, locale: OutreachLocale): string {
  const { text, urls } = resolve(rule, ctx, locale);
  return text.replace("{optout_url}", urls.optout).replace("{identity_url}", urls.identity).replace("{privacy_url}", urls.privacy);
}

const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function link(url: string): string {
  const e = esc(url);
  return `<a href="${e}" style="color:#555;">${e}</a>`;
}

const P_NOTICE = 'style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#666;"';

/** The same block as HTML: a "—" paragraph, the opt-out line as its own paragraph, then the notice paragraphs. */
export function legalFooterHtml(rule: SendRule, ctx: LegalContext, locale: OutreachLocale): string {
  const { text, urls } = resolve(rule, ctx, locale);
  const lines = text.split("\n");
  // lines[0] is "—", lines[1] the opt-out line, lines[2] blank, the rest the notice.
  const optout = lines[1] ?? "";
  const notice = lines.slice(3).filter((l) => l.trim().length > 0);
  const fill = (s: string) => esc(s).replace("{optout_url}", link(urls.optout)).replace("{identity_url}", link(urls.identity)).replace("{privacy_url}", link(urls.privacy));
  return [
    `<p style="margin:24px 0 0;color:#999;">—</p>`,
    `<p style="margin:8px 0 16px;font-size:13px;line-height:1.5;color:#333;">${fill(optout)}</p>`,
    ...notice.map((l) => `<p ${P_NOTICE}>${fill(l)}</p>`),
  ].join("\n");
}

/** Draft body → escaped HTML paragraphs (blank line = new paragraph, single newline = <br>). */
export function bodyHtml(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#222;">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/** Full text and HTML of an outreach email: the body, then the legal block. */
export function renderEmail(body: string, rule: SendRule, ctx: LegalContext, locale: OutreachLocale): { text: string; html: string; legal: string } {
  const legal = legalFooter(rule, ctx, locale);
  const text = `${body.replace(/\r\n?/g, "\n").trimEnd()}\n\n${legal}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;">\n${bodyHtml(body)}\n${legalFooterHtml(rule, ctx, locale)}\n</div>`;
  return { text, html, legal };
}

/** Subject with CR/LF stripped (header injection) and trimmed to 200 chars. */
export function cleanSubject(s: string): string {
  return s.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}
