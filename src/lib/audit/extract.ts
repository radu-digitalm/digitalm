// Reduce crawled pages to scalars (contract §7.1 step 7). Nothing here keeps
// HTML: titles ≤ 200, descriptions ≤ 300, URLs ≤ 500 through safeHttpUrl,
// control characters stripped, email = first mailto: address matching EMAIL_RE.
//
// The page is tokenised ONCE, linearly (indexOf-driven, ≤ 3 KB per tag, ≤ 50k
// tags, ≤ 512 KB of HTML), and every attribute question is asked of a single
// tag string — never of the whole document. Prospect HTML is hostile input
// that runs inside the process serving the site, so no pattern here may
// re-scan to the end of the document per opener. The only regexes applied to
// the full text are literal alternations (CMS / booking / chat signatures)
// or bounded lookarounds (copyright years). Pure: runs under node --test.
import { EMAIL_RE, domainOf, safeHttpUrl } from "../crm/classify.ts";

export interface PageLike {
  url: string;
  finalUrl: string;
  text: string;
  contentType: string | null;
}

export interface JsonLdSummary {
  present: boolean;
  /** The first business-like @type found, e.g. "Restaurant". */
  type: string | null;
  localBusiness: boolean;
  telephone: boolean;
  openingHours: boolean;
  /** The business node's `name` (≤ 120 chars) — the site-name write-back of finder-google §4.5. */
  name?: string;
}

export interface Extraction {
  title: string | null;
  description: string | null;
  hasViewport: boolean;
  email: string | null;
  /** URL of the page the email was found on (≤ 500 chars). */
  emailPage: string | null;
  phone: string | null;
  socials: Record<string, string>;
  cms: string | null;
  ecommerce: boolean;
  hasTel: boolean;
  hasMailto: boolean;
  hasEmailForm: boolean;
  booking: string | null;
  chat: string | null;
  jsonLd: JsonLdSummary;
  cookieBanner: boolean;
  /** http:// sub-resources found on https pages. */
  mixedContent: number;
  copyrightYear: number | null;
  legalLink: boolean;
  forbidsExtraction: boolean;
  pagesScanned: number;
}

// ---- limits ------------------------------------------------------------------------

/** HTML handed to the extractor per page; the crawler's 2 MB cap is a transfer limit, this is the parse limit. */
export const MAX_HTML = 512 * 1024;
/** A "tag" longer than this is malformed input and is skipped whole (never re-scanned). */
export const MAX_TAG = 3 * 1024;
export const MAX_TAGS = 50_000;
const MAX_SCRIPT_BODY = 200_000;
const MAX_TAG_TEXT = 500;

// ---- text helpers ------------------------------------------------------------------

const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function stripControl(s: string): string {
  return s.replace(CONTROL_RE, "");
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", eacute: "é", egrave: "è", ecirc: "ê", agrave: "à",
  acirc: "â", ccedil: "ç", ocirc: "ô", ugrave: "ù", ucirc: "û", icirc: "î", iuml: "ï", euml: "ë", oelig: "œ", laquo: "«", raquo: "»",
  rsquo: "’", lsquo: "‘", ndash: "–", mdash: "—", hellip: "…", euro: "€",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, body: string) => {
    const b = body.toLowerCase();
    if (b.startsWith("#x")) {
      const cp = Number.parseInt(b.slice(2), 16);
      return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
    }
    if (b.startsWith("#")) {
      const cp = Number.parseInt(b.slice(1), 10);
      return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
    }
    return NAMED_ENTITIES[b] ?? m;
  });
}

/** Trim, collapse whitespace, drop control chars, cap the length. */
export function clean(s: string, max: number): string {
  const t = stripControl(decodeEntities(s)).replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) : t;
}

/** Lower-case, accents folded — for matching French wording. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// ---- tokeniser -----------------------------------------------------------------------

export interface HtmlTag {
  /** The tag as written, "<a href=…>" (≤ MAX_TAG chars). */
  raw: string;
  /** Lower-case element name; "" for a doctype or processing instruction. */
  name: string;
  close: boolean;
  /** Text that follows this tag up to the next one (entities intact, ≤ 500 chars). */
  text: string;
  /** Raw body of a <script> element (≤ 200 KB); absent elsewhere. */
  body?: string;
  attrs?: Map<string, string>;
}

export interface HtmlTokens {
  tags: HtmlTag[];
  /** Visible text: comments, scripts, styles and noscript removed, entities intact. */
  text: string;
  /** The (capped) source, for literal signature scans only. */
  html: string;
}

// Elements whose content is not markup: skipped to their closing tag in one indexOf.
const RAW_TEXT = new Set(["script", "style", "noscript"]);
const TAG_NAME_RE = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/;

function isSpace(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
}

/** Attributes of one tag, first occurrence wins, names lower-cased. Linear scan, no regex. */
function parseAttrs(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  const n = raw.length;
  let i = 1;
  while (i < n && !isSpace(raw.charCodeAt(i)) && raw[i] !== ">") i++; // "/name"
  for (;;) {
    while (i < n && (isSpace(raw.charCodeAt(i)) || raw[i] === "/")) i++;
    if (i >= n || raw[i] === ">") break;
    const nameStart = i;
    while (i < n && !isSpace(raw.charCodeAt(i)) && raw[i] !== "=" && raw[i] !== ">" && raw[i] !== "/") i++;
    const name = raw.slice(nameStart, i).toLowerCase();
    if (!name) {
      i++; // a stray "=" or quote: step over it so the scan always advances
      continue;
    }
    while (i < n && isSpace(raw.charCodeAt(i))) i++;
    let value = "";
    if (raw[i] === "=") {
      i++;
      while (i < n && isSpace(raw.charCodeAt(i))) i++;
      const q = raw[i];
      if (q === '"' || q === "'") {
        const end = raw.indexOf(q, i + 1);
        value = raw.slice(i + 1, end < 0 ? n : end);
        i = end < 0 ? n : end + 1;
      } else {
        const start = i;
        while (i < n && !isSpace(raw.charCodeAt(i)) && raw[i] !== ">") i++;
        value = raw.slice(start, i);
      }
    }
    if (!out.has(name)) out.set(name, value);
  }
  return out;
}

function attr(tag: HtmlTag, name: string): string | null {
  tag.attrs ??= parseAttrs(tag.raw);
  return tag.attrs.get(name) ?? null;
}

/**
 * One linear pass over the document: tags (≤ MAX_TAG each, ≤ MAX_TAGS),
 * the visible text, and script bodies. A string is capped at MAX_HTML first;
 * tokens passed back in are returned as they are, so callers share one parse.
 */
export function tokenise(input: string | HtmlTokens): HtmlTokens {
  if (typeof input !== "string") return input;
  const html = input.length > MAX_HTML ? input.slice(0, MAX_HTML) : input;
  const lower = html.toLowerCase();
  const tags: HtmlTag[] = [];
  const textParts: string[] = [];
  let last: HtmlTag | null = null;
  const pushText = (s: string) => {
    if (!s) return;
    textParts.push(s);
    if (last && last.text.length < MAX_TAG_TEXT) last.text += s.slice(0, MAX_TAG_TEXT - last.text.length);
  };
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      pushText(html.slice(i));
      break;
    }
    pushText(html.slice(i, lt));
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    const gt = html.indexOf(">", lt + 1);
    if (gt < 0) break; // unterminated: what follows is not a document
    if (gt - lt > MAX_TAG) {
      i = gt + 1; // malformed span: skipped whole, never re-scanned
      continue;
    }
    const raw = html.slice(lt, gt + 1);
    const m = TAG_NAME_RE.exec(raw);
    const tag: HtmlTag = { raw, name: m ? m[2]!.toLowerCase() : "", close: !!m && m[1] === "/", text: "" };
    i = gt + 1;
    if (!tag.close && RAW_TEXT.has(tag.name) && !raw.endsWith("/>")) {
      const end = lower.indexOf(`</${tag.name}`, i);
      if (tag.name === "script") tag.body = html.slice(i, Math.min(end < 0 ? html.length : end, i + MAX_SCRIPT_BODY));
      if (end < 0) i = html.length;
      else {
        const gt2 = html.indexOf(">", end);
        i = gt2 < 0 ? html.length : gt2 + 1;
      }
    }
    tags.push(tag);
    last = tag;
    if (tags.length >= MAX_TAGS) break;
  }
  return { tags, text: textParts.join(" "), html };
}

/** Text of an element: what follows its opening tag until its closing tag (a few tags deep). */
function innerText(tags: HtmlTag[], at: number, maxTags = 40): string {
  const open = tags[at]!;
  let text = open.text;
  for (let j = at + 1; j < tags.length && j <= at + maxTags; j++) {
    const t = tags[j]!;
    if (t.name === open.name) break; // its closing tag, or a nested opener of the same kind
    text += ` ${t.text}`;
    if (text.length > 4 * MAX_TAG_TEXT) break;
  }
  return text;
}

/** Visible text of an HTML document (scripts, styles and tags removed), whitespace collapsed. */
export function htmlToText(html: string | HtmlTokens): string {
  return stripControl(decodeEntities(tokenise(html).text))
    .replace(/\s+/g, " ")
    .trim();
}

// ---- links -------------------------------------------------------------------------

export interface Link {
  /** Absolute http(s) URL (≤ 500 chars) — null when the href is mailto:/tel:/javascript:/relative-unresolvable. */
  href: string | null;
  raw: string;
  text: string;
}

const MAILTO_OR_TEL_RE = /^(mailto|tel):/i;

/** Every href on the page, resolved against `baseUrl`; raw values kept for mailto:/tel: scans. */
export function findLinks(html: string | HtmlTokens, baseUrl: string): Link[] {
  const { tags } = tokenise(html);
  const out: Link[] = [];
  let base = baseUrl;
  const baseTag = tags.find((t) => t.name === "base" && !t.close && attr(t, "href"));
  if (baseTag) {
    const b = safeHttpUrl(resolve(attr(baseTag, "href") ?? "", baseUrl) ?? "");
    if (b) base = b;
  }
  const seen = new Set<string>();
  for (let i = 0; i < tags.length && out.length < 2000; i++) {
    const t = tags[i]!;
    if (t.name !== "a" || t.close) continue;
    const raw = decodeEntities(attr(t, "href") ?? "").trim();
    if (!raw) continue;
    const text = clean(innerText(tags, i), 120);
    const href = resolve(raw, base);
    const key = `${href ?? raw}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ href, raw, text });
  }
  // hrefs outside <a> (e.g. <link>, <area>) — raw only, for mailto/tel and social scans.
  for (const t of tags) {
    if (t.name === "a" || t.close) continue;
    const raw = decodeEntities(attr(t, "href") ?? "").trim();
    if (!raw || !MAILTO_OR_TEL_RE.test(raw)) continue;
    const key = `${raw}|`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ href: null, raw, text: "" });
  }
  return out;
}

function resolve(raw: string, base: string): string | null {
  if (/^(mailto|tel|javascript|data|sms|whatsapp|fax|callto):/i.test(raw)) return null;
  try {
    return safeHttpUrl(new URL(raw, base).toString());
  } catch {
    return null;
  }
}

export const CONTACT_LINK_RE = /contact|nous-contacter|contact-us/i;
export const LEGAL_LINK_RE = /mentions|legal|legales|cgu|cgv|terms|privacy|confidentialite/i;

/** First same-domain link whose href (accent-folded) matches `re`, excluding the page itself. */
export function pickLink(links: Link[], re: RegExp, homeUrl: string): string | null {
  const domain = domainOf(homeUrl);
  const home = stripHash(homeUrl);
  for (const l of links) {
    if (!l.href) continue;
    if (domainOf(l.href) !== domain) continue;
    const target = stripHash(l.href);
    if (target === home) continue;
    if (re.test(fold(new URL(target).pathname + new URL(target).search))) return target;
  }
  return null;
}

function stripHash(u: string): string {
  const i = u.indexOf("#");
  return i >= 0 ? u.slice(0, i) : u;
}

// ---- scalar extractors -------------------------------------------------------------

/** Every href value on the page that starts with `scheme:` (mailto/tel), decoded, in document order. */
function hrefsWithScheme(html: string | HtmlTokens, scheme: "mailto" | "tel"): string[] {
  const out: string[] = [];
  for (const t of tokenise(html).tags) {
    if (t.close) continue;
    const href = attr(t, "href");
    if (href === null) continue;
    let value = decodeEntities(href).trim();
    if (!value.slice(0, scheme.length + 1).toLowerCase().startsWith(`${scheme}:`)) continue;
    value = value.slice(scheme.length + 1);
    try {
      value = decodeURIComponent(value);
    } catch {
      /* keep as is */
    }
    out.push(value);
  }
  return out;
}

/** First valid address of the first mailto: on the page ("mailto:a@x.fr,b@y.fr?subject=…" → a@x.fr). */
export function firstMailto(html: string | HtmlTokens): string | null {
  for (const value of hrefsWithScheme(html, "mailto")) {
    const beforeQuery = value.split("?")[0] ?? "";
    for (const part of beforeQuery.split(/[,;]/)) {
      const candidate = stripControl(part).trim().toLowerCase();
      if (candidate.length <= 254 && EMAIL_RE.test(candidate)) return candidate;
    }
  }
  return null;
}

/** First tel: link, normalised to digits with an optional leading "+" (≤ 24 chars). */
export function firstTel(html: string | HtmlTokens): string | null {
  for (const value of hrefsWithScheme(html, "tel")) {
    let s = value.replace(/\(0\)/g, "").replace(/[^\d+]/g, "");
    if (s.startsWith("00")) s = `+${s.slice(2)}`;
    s = s.replace(/(?!^)\+/g, "");
    const digits = s.replace(/\D/g, "");
    if (digits.length >= 6 && digits.length <= 15) return s.slice(0, 24);
  }
  return null;
}

const SOCIAL_HOSTS: [string, RegExp][] = [
  ["facebook", /(^|\.)(facebook\.com|fb\.com|fb\.me)$/i],
  ["instagram", /(^|\.)instagram\.com$/i],
  ["linkedin", /(^|\.)linkedin\.com$/i],
  ["tiktok", /(^|\.)tiktok\.com$/i],
  ["youtube", /(^|\.)(youtube\.com|youtu\.be)$/i],
];
const SOCIAL_SHARE_RE = /sharer|share\.php|shareArticle|\/share\b|\/intent\/|\/plugins\/|\/dialog\/|\/login|\/embed\//i;

/** First profile link per network (share/embed links skipped), values through safeHttpUrl. */
export function findSocials(links: Link[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of links) {
    if (!l.href) continue;
    let host: string;
    let path: string;
    try {
      const u = new URL(l.href);
      host = u.hostname;
      path = u.pathname + u.search;
    } catch {
      continue;
    }
    if (SOCIAL_SHARE_RE.test(path)) continue;
    if (path === "/" || path === "") continue;
    for (const [name, re] of SOCIAL_HOSTS) {
      if (!out[name] && re.test(host)) out[name] = l.href;
    }
  }
  return out;
}

const CMS_SIGNATURES: [string, RegExp][] = [
  ["WooCommerce", /woocommerce/i],
  ["PrestaShop", /prestashop|\/modules\/ps_|var prestashop/i],
  ["Shopify", /cdn\.shopify\.com|Shopify\.theme|shopify-section/i],
  ["Wix", /wix\.com|_wixCssModules|wixstatic\.com/i],
  ["Squarespace", /squarespace\.com|static1\.squarespace/i],
  ["Webflow", /webflow\.com|data-wf-page/i],
  ["Jimdo", /jimdo\.com|jimdosite|cc-m-/i],
  ["Weebly", /weebly\.com|weeblysite/i],
  ["SiteW", /sitew\.(com|fr)/i],
  ["e-monsite", /e-monsite\.com/i],
  ["Odoo", /odoo\.com|\/web\/assets\/|odoo-website/i],
  ["Duda", /duda\.co|dudamobile|multiscreensite/i],
  ["HubSpot CMS", /hs-sites\.com|hubspotusercontent|hsforms\.net/i],
  ["Joomla", /\/media\/jui\/|joomla/i],
  ["Drupal", /drupal-settings-json|\/sites\/default\/files\//i],
  ["TYPO3", /typo3conf|typo3temp/i],
  ["WordPress", /wp-content\/|wp-includes\/|wp-json/i],
];

/** The <meta> tags of the page whose name/property (lower-cased) equals `key`. */
function metaTags(tokens: HtmlTokens, key: string): HtmlTag[] {
  const out: HtmlTag[] = [];
  for (const t of tokens.tags) {
    if (t.name !== "meta" || t.close) continue;
    const name = (attr(t, "name") ?? attr(t, "property") ?? "").trim().toLowerCase();
    if (name === key) out.push(t);
  }
  return out;
}

/** CMS from the generator meta or well-known asset paths; shop platforms first. */
export function detectCms(html: string | HtmlTokens): string | null {
  const tokens = tokenise(html);
  const gen = metaTags(tokens, "generator")
    .map((t) => (attr(t, "content") ?? "").trim())
    .find((c) => c.length >= 1 && c.length <= 80);
  if (gen) {
    if (/woocommerce/i.test(tokens.html)) return "WooCommerce";
    const known = CMS_SIGNATURES.find(([name]) => gen.toLowerCase().includes(name.toLowerCase().split(" ")[0]!));
    if (known) return known[0];
    return clean(gen.replace(/\s*[\d.]+.*$/, ""), 40) || null;
  }
  for (const [name, re] of CMS_SIGNATURES) if (re.test(tokens.html)) return name;
  return null;
}

const SHOP_CMS = new Set(["WooCommerce", "PrestaShop", "Shopify"]);
const CART_RE = /\/(cart|panier|checkout|commande|caisse)(\/|$|\?|#|\.)/i;

const BOOKING_PROVIDERS: [string, RegExp][] = [
  ["calendly", /calendly\.com/i],
  ["planity", /planity\.com/i],
  ["treatwell", /treatwell\./i],
  ["zenchef", /zenchef\.com/i],
  ["thefork", /thefork\.|lafourchette\./i],
  ["resy", /resy\.com/i],
  ["opentable", /opentable\./i],
  ["google", /reserve\.google\.com|calendar\.app\.google|google\.com\/calendar\/appointments|google\.com\/maps\/reserve/i],
];
const BOOKING_PATH_RE = /\/(reservation|reservations|reserver|rendez-vous|rendezvous|rdv|prendre-rendez-vous|book|booking|book-now|book-online|appointment|appointments)(\/|$|\?|#|-|\.)/i;

/** Booking provider key from links / embedded widgets, or a path-based hint; null when none. */
export function detectBooking(html: string | HtmlTokens, links: Link[]): string | null {
  const source = tokenise(html).html;
  for (const [name, re] of BOOKING_PROVIDERS) if (re.test(source)) return name;
  for (const l of links) {
    if (!l.href) continue;
    try {
      const u = new URL(l.href);
      if (BOOKING_PATH_RE.test(fold(u.pathname))) return "site";
    } catch {
      /* skip */
    }
  }
  return null;
}

const CHAT_PROVIDERS: [string, RegExp][] = [
  ["whatsapp", /wa\.me\/|api\.whatsapp\.com|web\.whatsapp\.com\/send/i],
  ["crisp", /client\.crisp\.chat|crisp\.chat/i],
  ["tawk", /tawk\.to/i],
  ["intercom", /widget\.intercom\.io|intercomcdn\.com|window\.intercomSettings/i],
  ["tidio", /tidio\.co|tidiochat/i],
  ["hubspot", /js\.hs-scripts\.com|hubspot\.com\/conversations|hs-chat/i],
  ["brevo", /brevo\.com|sibautomation|conversations-widget|sendinblue/i],
];

export function detectChat(html: string | HtmlTokens): string | null {
  const source = tokenise(html).html;
  for (const [name, re] of CHAT_PROVIDERS) if (re.test(source)) return name;
  return null;
}

const COOKIE_RE = /tarteaucitron|axeptio|cookiebot|onetrust|didomi|complianz|cookieyes|usercentrics|iubenda|quantcast|cookie-law-info|cookie[-_]?consent|cookie[-_]?banner|cookie[-_]?notice|cookie[-_]?bar|cmp-container|cc-window/i;

export function detectCookieBanner(html: string | HtmlTokens): boolean {
  return COOKIE_RE.test(tokenise(html).html);
}

const EMAIL_INPUT_NAME_RE = /^(?:e-?mail|courriel|mail|your-email)\b/i;

export function hasEmailForm(html: string | HtmlTokens): boolean {
  for (const t of tokenise(html).tags) {
    if (t.name !== "input" || t.close) continue;
    if ((attr(t, "type") ?? "").trim().toLowerCase() === "email") return true;
    if (EMAIL_INPUT_NAME_RE.test((attr(t, "name") ?? "").trim())) return true;
  }
  return false;
}

export function hasViewportMeta(html: string | HtmlTokens): boolean {
  return metaTags(tokenise(html), "viewport").length > 0;
}

export function pageTitle(html: string | HtmlTokens): string | null {
  const { tags } = tokenise(html);
  const at = tags.findIndex((t) => t.name === "title" && !t.close);
  if (at < 0) return null;
  const t = clean(innerText(tags, at, 10), 200);
  return t || null;
}

export function metaDescription(html: string | HtmlTokens): string | null {
  const tokens = tokenise(html);
  for (const key of ["description", "og:description"]) {
    for (const t of metaTags(tokens, key)) {
      const content = attr(t, "content");
      if (content) {
        const d = clean(content, 300);
        if (d) return d;
      }
    }
  }
  return null;
}

// Sub-resources only: <a href="http://…"> and <link rel="canonical"> are not mixed content.
const MIXED_TAGS = new Set(["script", "img", "iframe", "source", "video", "audio", "embed", "object", "track"]);
const MIXED_ATTRS = ["src", "data", "poster", "srcset"];
const MIXED_LINK_REL_RE = /stylesheet|icon|preload|prefetch|modulepreload/i;
const MIXED_CSS_RE = /url\(\s*["']?http:\/\//gi;

function isPlainHttp(v: string | null): boolean {
  return v !== null && /^\s*http:\/\//i.test(v);
}

/** Count http:// sub-resources (scripts, images, frames, stylesheets, css url()) — meaningful on https pages only. */
export function countMixedContent(html: string | HtmlTokens): number {
  const tokens = tokenise(html);
  let n = 0;
  for (const t of tokens.tags) {
    if (t.close) continue;
    if (MIXED_TAGS.has(t.name)) {
      if (MIXED_ATTRS.some((a) => isPlainHttp(attr(t, a)))) n++;
    } else if (t.name === "link") {
      if (isPlainHttp(attr(t, "href")) && MIXED_LINK_REL_RE.test(attr(t, "rel") ?? "")) n++;
    }
  }
  for (const _m of tokens.html.matchAll(MIXED_CSS_RE)) n++;
  return n;
}

const COPYRIGHT_RE = /(?:©|&copy;|&#169;|&#xa9;|\(c\)|copyright)[^\d<]{0,60}?((?:19|20)\d\d)(?:\s*[-–—]\s*((?:19|20)\d\d))?/gi;

/** Latest year written next to a copyright mark, or null. */
export function copyrightYear(html: string | HtmlTokens): number | null {
  let best: number | null = null;
  for (const m of tokenise(html).html.matchAll(COPYRIGHT_RE)) {
    for (const y of [m[1], m[2]]) {
      if (!y) continue;
      const n = Number.parseInt(y, 10);
      if (best === null || n > best) best = n;
    }
  }
  return best;
}

const FORBIDS_RES: RegExp[] = [
  /interdit(e)?\s.{0,40}(extraction|prospection|demarchage)/,
  /extraction\s.{0,60}interdite/,
  /no (commercial )?solicitation/,
  /data mining\s.{0,30}prohibited/,
  /scraping\s.{0,30}(prohibited|forbidden)/,
];

/** True when the visible text carries a "no extraction / no prospecting" clause (§7.2). */
export function forbidsExtraction(text: string): boolean {
  const t = fold(text);
  return FORBIDS_RES.some((re) => re.test(t));
}

const BUSINESS_TYPES = new Set([
  "organization", "localbusiness", "restaurant", "store", "bakery", "barorpub", "cafeorcoffeeshop", "fastfoodrestaurant", "icecreamshop", "winery",
  "brewery", "distillery", "hotel", "lodgingbusiness", "bedandbreakfast", "campground", "hostel", "motel", "resort", "vacationrental", "hairsalon",
  "beautysalon", "daysalon", "nailsalon", "tattooparlor", "healthandbeautybusiness", "dentist", "physician", "medicalclinic", "medicalbusiness",
  "optician", "pharmacy", "veterinarycare", "autorepair", "autobodyshop", "autodealer", "automotivebusiness", "gasstation", "motorcyclerepair",
  "homeandconstructionbusiness", "plumber", "electrician", "roofingcontractor", "generalcontractor", "housepainter", "locksmith", "hvacbusiness",
  "movingcompany", "realestateagent", "professionalservice", "legalservice", "attorney", "notary", "accountingservice", "insuranceagency",
  "financialservice", "travelagency", "sportsactivitylocation", "exercisegym", "healthclub", "bowlingalley", "stadiumorarena", "florist", "furniturestore",
  "clothingstore", "shoestore", "jewelrystore", "grocerystore", "conveniencestore", "hardwarestore", "bikestore", "bookstore", "computerstore",
  "electronicsstore", "gardenstore", "hobbyshop", "liquorstore", "mobilephonestore", "musicstore", "officeequipmentstore", "outletstore",
  "petstore", "sportinggoodsstore", "toystore", "wholesalestore", "departmentstore", "childcare", "drycleaningorlaundry", "employmentagency",
  "entertainmentbusiness", "artgallery", "nightclub", "casino", "comedyclub", "movietheater", "amusementpark", "internetcafe", "library",
  "radiostation", "recyclingcenter", "selfstorage", "shoppingcenter", "touristinformationcenter", "animalshelter", "archiveorganization",
  "automatedteller", "corporation", "ngo", "educationalorganization", "school", "governmentorganization", "sportsorganization", "dancegroup",
  "butcher", "delicatessen", "boulangerie",
]);
const BUSINESS_SUFFIX_RE = /(business|store|shop|salon|restaurant|cafe|bakery|bar|pub|hotel|dentist|physician|clinic|agent|agency|garage|repair|contractor|plumber|electrician|roofer|optician|gym|center|centre|spa|winery|brewery|school|pharmacy|florist|butcher|dealer|locksmith|hospital|lodging|resort|motel|campground|attorney|notary|organization|service|studio|boutique|market|supermarket|grocery|bistro|diner)$/i;

function isBusinessType(t: string): boolean {
  const k = t.replace(/^https?:\/\/schema\.org\//i, "").toLowerCase();
  return BUSINESS_TYPES.has(k) || BUSINESS_SUFFIX_RE.test(k);
}

function typesOf(node: Record<string, unknown>): string[] {
  const t = node["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

function hasNonEmpty(v: unknown): boolean {
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0 && v.some(hasNonEmpty);
  if (v && typeof v === "object") return Object.keys(v).length > 0;
  return false;
}

function findWithin(node: unknown, key: string, depth: number): boolean {
  if (depth > 4 || !node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((n) => findWithin(n, key, depth + 1));
  const rec = node as Record<string, unknown>;
  if (hasNonEmpty(rec[key])) return true;
  return Object.values(rec).some((v) => v && typeof v === "object" && findWithin(v, key, depth + 1));
}

const LD_JSON_TYPE_RE = /^\s*application\/ld\+json\s*$/i;

/** Walk every JSON-LD block for a business-like node with telephone and opening hours. */
export function summariseJsonLd(html: string | HtmlTokens): JsonLdSummary {
  const out: JsonLdSummary = { present: false, type: null, localBusiness: false, telephone: false, openingHours: false };
  let budget = 400;
  const visit = (node: unknown, depth: number) => {
    if (budget-- <= 0 || depth > 6 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, depth + 1);
      return;
    }
    const rec = node as Record<string, unknown>;
    const types = typesOf(rec);
    const business = types.find(isBusinessType);
    if (business) {
      if (!out.type) out.type = business.replace(/^https?:\/\/schema\.org\//i, "").slice(0, 60);
      out.localBusiness = true;
      if (!out.name && typeof rec.name === "string") {
        const name = stripControl(rec.name).replace(/\s+/g, " ").trim().slice(0, 120);
        if (name) out.name = name;
      }
      if (findWithin(rec, "telephone", 0)) out.telephone = true;
      if (findWithin(rec, "openingHours", 0) || findWithin(rec, "openingHoursSpecification", 0)) out.openingHours = true;
    }
    for (const [k, v] of Object.entries(rec)) {
      if (k === "@graph" || (v && typeof v === "object")) visit(v, depth + 1);
    }
  };
  for (const t of tokenise(html).tags) {
    if (t.name !== "script" || t.close || t.body === undefined) continue;
    if (!LD_JSON_TYPE_RE.test(attr(t, "type") ?? "")) continue;
    const raw = t.body.replace(/^\s*<!--/, "").replace(/-->\s*$/, "").replace(/^\s*\/\/<!\[CDATA\[|\/\/\]\]>\s*$/g, "").trim();
    if (!raw) continue;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      continue;
    }
    out.present = true;
    visit(json, 0);
  }
  return out;
}

// ---- the reducer -------------------------------------------------------------------

/**
 * Reduce the crawled pages (home first) to the Extraction scalars. Each page
 * is tokenised once and every extractor reads the same tokens. `now` is only
 * used for the copyright rule by the caller; the year itself is returned.
 */
export function extractSite(pages: PageLike[]): Extraction {
  const out: Extraction = {
    title: null,
    description: null,
    hasViewport: false,
    email: null,
    emailPage: null,
    phone: null,
    socials: {},
    cms: null,
    ecommerce: false,
    hasTel: false,
    hasMailto: false,
    hasEmailForm: false,
    booking: null,
    chat: null,
    jsonLd: { present: false, type: null, localBusiness: false, telephone: false, openingHours: false },
    cookieBanner: false,
    mixedContent: 0,
    copyrightYear: null,
    legalLink: false,
    forbidsExtraction: false,
    pagesScanned: 0,
  };
  pages.forEach((page, index) => {
    if (!page.text) return;
    const tokens = tokenise(page.text);
    if (index === 0) {
      out.title = pageTitle(tokens);
      out.description = metaDescription(tokens);
      out.hasViewport = hasViewportMeta(tokens);
      out.cms = detectCms(tokens);
    }
    out.pagesScanned++;
    const links = findLinks(tokens, page.finalUrl);
    if (!out.email) {
      const email = firstMailto(tokens);
      if (email) {
        out.email = email;
        out.emailPage = safeHttpUrl(page.finalUrl) ?? safeHttpUrl(page.url);
      }
    }
    if (!out.phone) out.phone = firstTel(tokens);
    if (links.some((l) => /^tel:/i.test(l.raw))) out.hasTel = true;
    if (links.some((l) => /^mailto:/i.test(l.raw))) out.hasMailto = true;
    if (hasEmailForm(tokens)) out.hasEmailForm = true;
    for (const [k, v] of Object.entries(findSocials(links))) if (!out.socials[k]) out.socials[k] = v;
    if (!out.booking) out.booking = detectBooking(tokens, links);
    if (!out.chat) out.chat = detectChat(tokens);
    if (!out.jsonLd.localBusiness) {
      const j = summariseJsonLd(tokens);
      if (j.present) out.jsonLd = { ...j, present: true };
    }
    if (detectCookieBanner(tokens)) out.cookieBanner = true;
    if (page.finalUrl.startsWith("https://")) out.mixedContent += countMixedContent(tokens);
    const year = copyrightYear(tokens);
    if (year !== null && (out.copyrightYear === null || year > out.copyrightYear)) out.copyrightYear = year;
    if (links.some((l) => l.href && LEGAL_LINK_RE.test(fold(new URL(l.href).pathname)))) out.legalLink = true;
    if (links.some((l) => l.href && CART_RE.test(new URL(l.href).pathname))) out.ecommerce = true;
    if (forbidsExtraction(htmlToText(tokens))) out.forbidsExtraction = true;
  });
  if (out.cms && SHOP_CMS.has(out.cms)) out.ecommerce = true;
  return out;
}
