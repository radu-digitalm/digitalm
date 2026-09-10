// Reduce crawled pages to scalars (contract §7.1 step 7). Nothing here keeps
// HTML: titles ≤ 200, descriptions ≤ 300, URLs ≤ 500 through safeHttpUrl,
// control characters stripped, email = first mailto: address matching EMAIL_RE.
// Regex-based on purpose (no DOM dependency); every pattern is linear on the
// 2 MB inputs the crawler can hand over. Pure: runs under node --test.
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

/** Visible text of an HTML document (scripts, styles and tags removed), whitespace collapsed. */
export function htmlToText(html: string): string {
  return stripControl(
    decodeEntities(
      html
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, " ")
        .replace(/<[^>]{0,5000}>/g, " "),
    ),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Lower-case, accents folded — for matching French wording. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"));
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? null;
}

// ---- links -------------------------------------------------------------------------

export interface Link {
  /** Absolute http(s) URL (≤ 500 chars) — null when the href is mailto:/tel:/javascript:/relative-unresolvable. */
  href: string | null;
  raw: string;
  text: string;
}

const ANCHOR_RE = /<a\b([^>]{0,3000})>([\s\S]{0,500}?)<\/a\s*>/gi;
const HREF_RE = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

/** Every href on the page, resolved against `baseUrl`; raw values kept for mailto:/tel: scans. */
export function findLinks(html: string, baseUrl: string): Link[] {
  const out: Link[] = [];
  let base = baseUrl;
  const baseTag = html.match(/<base\b[^>]*\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  if (baseTag) {
    const b = safeHttpUrl(resolve(baseTag[1] ?? baseTag[2] ?? "", baseUrl) ?? "");
    if (b) base = b;
  }
  const seen = new Set<string>();
  for (const m of html.matchAll(ANCHOR_RE)) {
    const raw = decodeEntities(attr(` ${m[1]}`, "href") ?? "").trim();
    if (!raw) continue;
    const text = clean(m[2]!.replace(/<[^>]*>/g, " "), 120);
    const href = resolve(raw, base);
    const key = `${href ?? raw}|${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ href, raw, text });
    if (out.length >= 2000) break;
  }
  // hrefs outside <a> (e.g. <link>, <area>) — raw only, for mailto/tel and social scans.
  for (const m of html.matchAll(HREF_RE)) {
    const raw = decodeEntities(m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (!raw || !/^(mailto|tel):/i.test(raw)) continue;
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

// href="mailto:…" / href='tel:…' / bare href=mailto:… — quoted values may contain spaces.
const MAILTO_RE = /href\s*=\s*(?:"\s*mailto:([^"]*)"|'\s*mailto:([^']*)'|mailto:([^\s>]+))/gi;
const TEL_RE = /href\s*=\s*(?:"\s*tel:([^"]*)"|'\s*tel:([^']*)'|tel:([^\s>]+))/gi;

/** First valid address of the first mailto: on the page ("mailto:a@x.fr,b@y.fr?subject=…" → a@x.fr). */
export function firstMailto(html: string): string | null {
  for (const m of html.matchAll(MAILTO_RE)) {
    let value = decodeEntities(m[1] ?? m[2] ?? m[3] ?? "");
    try {
      value = decodeURIComponent(value);
    } catch {
      /* keep as is */
    }
    const beforeQuery = value.split("?")[0] ?? "";
    for (const part of beforeQuery.split(/[,;]/)) {
      const candidate = stripControl(part).trim().toLowerCase();
      if (candidate.length <= 254 && EMAIL_RE.test(candidate)) return candidate;
    }
  }
  return null;
}

/** First tel: link, normalised to digits with an optional leading "+" (≤ 24 chars). */
export function firstTel(html: string): string | null {
  for (const m of html.matchAll(TEL_RE)) {
    let value = decodeEntities(m[1] ?? m[2] ?? m[3] ?? "");
    try {
      value = decodeURIComponent(value);
    } catch {
      /* keep as is */
    }
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

/** CMS from the generator meta or well-known asset paths; shop platforms first. */
export function detectCms(html: string): string | null {
  const gen = html.match(/<meta\b[^>]*\sname\s*=\s*["']generator["'][^>]*\scontent\s*=\s*["']([^"']{1,80})["']/i)
    ?? html.match(/<meta\b[^>]*\scontent\s*=\s*["']([^"']{1,80})["'][^>]*\sname\s*=\s*["']generator["']/i);
  if (gen) {
    const g = gen[1]!;
    if (/woocommerce/i.test(html)) return "WooCommerce";
    const known = CMS_SIGNATURES.find(([name]) => g.toLowerCase().includes(name.toLowerCase().split(" ")[0]!));
    if (known) return known[0];
    return clean(g.replace(/\s*[\d.]+.*$/, ""), 40) || null;
  }
  for (const [name, re] of CMS_SIGNATURES) if (re.test(html)) return name;
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
export function detectBooking(html: string, links: Link[]): string | null {
  for (const [name, re] of BOOKING_PROVIDERS) if (re.test(html)) return name;
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

export function detectChat(html: string): string | null {
  for (const [name, re] of CHAT_PROVIDERS) if (re.test(html)) return name;
  return null;
}

const COOKIE_RE = /tarteaucitron|axeptio|cookiebot|onetrust|didomi|complianz|cookieyes|usercentrics|iubenda|quantcast|cookie-law-info|cookie[-_]?consent|cookie[-_]?banner|cookie[-_]?notice|cookie[-_]?bar|cmp-container|cc-window/i;

export function detectCookieBanner(html: string): boolean {
  return COOKIE_RE.test(html);
}

const EMAIL_INPUT_RE = /<input\b[^>]*\s(?:type\s*=\s*["']?email|name\s*=\s*["']?(?:e-?mail|courriel|mail|your-email)\b)/i;

export function hasEmailForm(html: string): boolean {
  return EMAIL_INPUT_RE.test(html);
}

export function hasViewportMeta(html: string): boolean {
  return /<meta\b[^>]*\sname\s*=\s*["']viewport["']/i.test(html);
}

export function pageTitle(html: string): string | null {
  const m = html.match(/<title\b[^>]*>([\s\S]{0,2000}?)<\/title\s*>/i);
  const t = m ? clean(m[1]!, 200) : "";
  return t || null;
}

export function metaDescription(html: string): string | null {
  for (const m of html.matchAll(/<meta\b[^>]{0,2000}>/gi)) {
    const tag = m[0];
    const name = (attr(tag, "name") ?? attr(tag, "property") ?? "").toLowerCase();
    if (name !== "description" && name !== "og:description") continue;
    const content = attr(tag, "content");
    if (content) {
      const d = clean(content, 300);
      if (d) return d;
    }
  }
  return null;
}

// Sub-resources only: <a href="http://…"> and <link rel="canonical"> are not mixed content.
const MIXED_TAG_RE = /<(script|img|iframe|source|video|audio|embed|object|track)\b[^>]*\s(?:src|data|poster|srcset)\s*=\s*["']?http:\/\//gi;
const MIXED_LINK_RE = /<link\b[^>]*\shref\s*=\s*["']?http:\/\/[^>]*>/gi;
const MIXED_CSS_RE = /url\(\s*["']?http:\/\//gi;

/** Count http:// sub-resources (scripts, images, frames, stylesheets, css url()) — meaningful on https pages only. */
export function countMixedContent(html: string): number {
  let n = 0;
  for (const _m of html.matchAll(MIXED_TAG_RE)) n++;
  for (const m of html.matchAll(MIXED_LINK_RE)) if (/rel\s*=\s*["']?[^"'>]*(stylesheet|icon|preload|prefetch|modulepreload)/i.test(m[0])) n++;
  for (const _m of html.matchAll(MIXED_CSS_RE)) n++;
  return n;
}

const COPYRIGHT_RE = /(?:©|&copy;|&#169;|&#xa9;|\(c\)|copyright)[^\d<]{0,60}?((?:19|20)\d\d)(?:\s*[-–—]\s*((?:19|20)\d\d))?/gi;

/** Latest year written next to a copyright mark, or null. */
export function copyrightYear(html: string): number | null {
  let best: number | null = null;
  for (const m of html.matchAll(COPYRIGHT_RE)) {
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

/** Walk every JSON-LD block for a business-like node with telephone and opening hours. */
export function summariseJsonLd(html: string): JsonLdSummary {
  const out: JsonLdSummary = { present: false, type: null, localBusiness: false, telephone: false, openingHours: false };
  const blocks = html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]{0,200000}?)<\/script\s*>/gi);
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
      if (findWithin(rec, "telephone", 0)) out.telephone = true;
      if (findWithin(rec, "openingHours", 0) || findWithin(rec, "openingHoursSpecification", 0)) out.openingHours = true;
    }
    for (const [k, v] of Object.entries(rec)) {
      if (k === "@graph" || (v && typeof v === "object")) visit(v, depth + 1);
    }
  };
  for (const m of blocks) {
    const raw = m[1]!.replace(/^\s*<!--/, "").replace(/-->\s*$/, "").replace(/^\s*\/\/<!\[CDATA\[|\/\/\]\]>\s*$/g, "").trim();
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
 * Reduce the crawled pages (home first) to the Extraction scalars. `now` is
 * only used for the copyright rule by the caller; the year itself is returned.
 */
export function extractSite(pages: PageLike[]): Extraction {
  const home = pages[0] ?? null;
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
  if (home && home.text) {
    out.title = pageTitle(home.text);
    out.description = metaDescription(home.text);
    out.hasViewport = hasViewportMeta(home.text);
    out.cms = detectCms(home.text);
  }
  for (const page of pages) {
    const html = page.text;
    if (!html) continue;
    out.pagesScanned++;
    const links = findLinks(html, page.finalUrl);
    if (!out.email) {
      const email = firstMailto(html);
      if (email) {
        out.email = email;
        out.emailPage = safeHttpUrl(page.finalUrl) ?? safeHttpUrl(page.url);
      }
    }
    if (!out.phone) out.phone = firstTel(html);
    if (/href\s*=\s*["']?\s*tel:/i.test(html)) out.hasTel = true;
    if (/href\s*=\s*["']?\s*mailto:/i.test(html)) out.hasMailto = true;
    if (hasEmailForm(html)) out.hasEmailForm = true;
    for (const [k, v] of Object.entries(findSocials(links))) if (!out.socials[k]) out.socials[k] = v;
    if (!out.booking) out.booking = detectBooking(html, links);
    if (!out.chat) out.chat = detectChat(html);
    if (!out.jsonLd.localBusiness) {
      const j = summariseJsonLd(html);
      if (j.present) out.jsonLd = { ...j, present: true };
    }
    if (detectCookieBanner(html)) out.cookieBanner = true;
    if (page.finalUrl.startsWith("https://")) out.mixedContent += countMixedContent(html);
    const year = copyrightYear(html);
    if (year !== null && (out.copyrightYear === null || year > out.copyrightYear)) out.copyrightYear = year;
    if (links.some((l) => l.href && LEGAL_LINK_RE.test(fold(new URL(l.href).pathname)))) out.legalLink = true;
    if (links.some((l) => l.href && CART_RE.test(new URL(l.href).pathname))) out.ecommerce = true;
    if (forbidsExtraction(htmlToText(html))) out.forbidsExtraction = true;
  }
  if (out.cms && SHOP_CMS.has(out.cms)) out.ecommerce = true;
  return out;
}
