// The only crawler in the project (contract §0, §7.1): node:http/https with the
// socket pinned to the DNS-vetted IPv4, redirects re-validated by hand (max 3),
// 8 s per request, 2 MB cap, text/html only (text/plain for robots.txt and
// llms.txt), robots.txt honoured, ≤ 3 pages at 1 req/s per host. Pages live in
// memory only; the caller reduces them to scalars (extract.ts) and keeps
// {url, status, bytes} per request.
//
// Errors: an SsrfError anywhere in the home chain propagates (the audit then
// fails with "ssrf:…"); every other network failure is captured in the result.
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import { LookupError, SsrfError, parseTarget, pinnedLookup, vetTarget } from "./ssrf.ts";
import type { LookupFn, VettedTarget } from "./ssrf.ts";
import { checkTls } from "./tls.ts";
import type { TlsInfo } from "./tls.ts";
import { CONTACT_LINK_RE, LEGAL_LINK_RE, findLinks, pickLink } from "./extract.ts";
import type { CrawledPage } from "../crm/types.ts";

export const DEFAULT_CRAWLER_UA = "DigitalM-AuditBot/1.0 (+https://digitalm.eu/fr/legal/mentions-legales; contact@digitalm.eu)";
/** Product token robots.txt groups are matched against. */
export const ROBOTS_TOKEN = "DigitalM-AuditBot";
export const FETCH_TIMEOUT_MS = 8_000;
export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 3;
export const HOST_GAP_MS = 1_000;
export const SLOW_MS = 5_000;

const HTML_TYPES = /^(text\/html|application\/xhtml\+xml)\b/i;
const TEXT_TYPES = /^text\/(plain|markdown)\b/i;
const ACCEPT_HTML = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5";
const ACCEPT_TEXT = "text/plain,text/markdown;q=0.9,*/*;q=0.5";

export function crawlerUserAgent(): string {
  const ua = process.env.CRAWLER_USER_AGENT?.trim();
  return ua && ua.length <= 300 ? ua : DEFAULT_CRAWLER_UA;
}

// ---- errors and records -----------------------------------------------------------------

export type Hop = { url: string; status: number; bytes: number };

/** A network failure (timeout, refused, dns…); `hops` keeps what was fetched before it. */
export class FetchError extends Error {
  code: string;
  hops: Hop[];
  constructor(code: string, hops: Hop[] = [], detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "FetchError";
    this.code = code;
    this.hops = hops;
  }
}

function errorCode(e: unknown): string {
  if (e instanceof FetchError) return e.code;
  if (e instanceof LookupError) return e.code;
  const code = (e as { code?: string })?.code;
  const msg = e instanceof Error ? e.message : "";
  if (code === "ETIMEDOUT" || msg === "timeout") return "timeout";
  if (code === "ECONNREFUSED") return "refused";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
  if (code === "ECONNRESET" || code === "EPIPE") return "reset";
  if (msg === "aborted") return "aborted";
  return "network";
}

// ---- robots.txt --------------------------------------------------------------------------

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}
export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}
export interface RobotsRules {
  groups: RobotsGroup[];
}

export function parseRobots(text: string): RobotsRules {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/).slice(0, 5000)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      if (key === "disallow" && value === "") continue; // "Disallow:" alone allows everything
      current.rules.push({ allow: key === "allow", pattern: value });
    }
  }
  return { groups };
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** The group for a product token: the longest matching user-agent, else "*", else null. */
export function robotsGroupFor(rules: RobotsRules, token: string): RobotsGroup | null {
  const t = token.toLowerCase();
  let best: RobotsGroup | null = null;
  let bestLen = -1;
  let star: RobotsGroup | null = null;
  for (const g of rules.groups) {
    for (const a of g.agents) {
      if (a === "*") {
        if (!star) star = g;
        continue;
      }
      if (!a) continue;
      if ((t.includes(a) || a.includes(t)) && a.length > bestLen) {
        best = g;
        bestLen = a.length;
      }
    }
  }
  return best ?? star;
}

/** Longest-match evaluation of a path for a product token (allow wins ties; no rule → allowed). */
export function robotsAllows(rules: RobotsRules | null, token: string, path: string): boolean {
  if (!rules) return true;
  const group = robotsGroupFor(rules, token);
  if (!group) return true;
  let verdict = true;
  let bestLen = -1;
  for (const r of group.rules) {
    let re: RegExp;
    try {
      re = patternToRegex(r.pattern);
    } catch {
      continue;
    }
    if (!re.test(path)) continue;
    const len = r.pattern.length;
    if (len > bestLen || (len === bestLen && r.allow)) {
      bestLen = len;
      verdict = r.allow;
    }
  }
  return verdict;
}

export const AI_BOTS = { gptbot: "GPTBot", claudebot: "ClaudeBot", perplexitybot: "PerplexityBot", googleExtended: "Google-Extended" } as const;
export type AiBotKey = keyof typeof AI_BOTS;

export function aiBotsAllowed(rules: RobotsRules): Record<AiBotKey, boolean> {
  const out = {} as Record<AiBotKey, boolean>;
  for (const [key, token] of Object.entries(AI_BOTS) as [AiBotKey, string][]) out[key] = robotsAllows(rules, token, "/");
  return out;
}

// ---- one request -------------------------------------------------------------------------

interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  bytes: number;
  truncated: boolean;
  timedOut: boolean;
  /** Request time, socket open to last byte. */
  ms: number;
}

function flatHeaders(res: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers)) {
    if (typeof v === "string") out[k] = v.slice(0, 1000);
    else if (Array.isArray(v)) out[k] = v.join(", ").slice(0, 1000);
  }
  return out;
}

/**
 * Tests only: where the socket goes once a target has passed vetting, so a
 * local server can stand in for a public host. Production callers never set
 * it; vetting (scheme, port, host, DNS) runs before it either way.
 */
export type SocketOverride = (t: VettedTarget) => { ip: string; port: number };

/** GET on a vetted target; the socket goes to `t.ip` whatever DNS says now. */
function fetchOnce(t: VettedTarget, opts: { ua: string; accept: string; wantBody: boolean; signal?: AbortSignal; socket?: SocketOverride }): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const requester = t.https ? httpsRequest : httpRequest;
    const defaultPort = t.https ? 443 : 80;
    const hostHeader = t.port === defaultPort ? t.hostname : `${t.hostname}:${t.port}`;
    const dest = opts.socket ? opts.socket(t) : { ip: t.ip, port: t.port };
    const req = requester({
      host: t.hostname,
      port: dest.port,
      path: `${t.url.pathname}${t.url.search}` || "/",
      method: "GET",
      lookup: pinnedLookup(dest.ip),
      autoSelectFamily: false,
      agent: false,
      timeout: FETCH_TIMEOUT_MS,
      headers: {
        host: hostHeader,
        "user-agent": opts.ua,
        accept: opts.accept,
        "accept-language": "fr,en;q=0.8",
        "accept-encoding": "identity",
        connection: "close",
      },
      ...(t.https ? { servername: t.hostname, rejectUnauthorized: false } : {}),
    });
    let done = false;
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    let response: IncomingMessage | null = null;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(hard);
      opts.signal?.removeEventListener("abort", onAbort);
      if (err) {
        reject(err);
        return;
      }
      resolve({ status: response!.statusCode ?? 0, headers: flatHeaders(response!), body: Buffer.concat(chunks), bytes, truncated, timedOut, ms: Date.now() - started });
    };
    const onAbort = () => req.destroy(new Error("aborted"));
    // Headers already in: keep what we have (a slow body is still a page) and drop the socket.
    const onTimeout = () => {
      timedOut = true;
      if (response) {
        finish();
        req.destroy();
      } else req.destroy(new Error("timeout"));
    };
    const hard = setTimeout(onTimeout, FETCH_TIMEOUT_MS);
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    req.on("timeout", onTimeout);
    req.on("error", (e) => finish(e));
    req.on("response", (res) => {
      response = res;
      res.on("error", () => finish());
      if (!opts.wantBody) {
        finish();
        req.destroy();
        return;
      }
      res.on("data", (chunk: Buffer) => {
        if (done) return;
        const room = MAX_BYTES - bytes;
        if (chunk.length >= room) {
          chunks.push(chunk.subarray(0, room));
          bytes = MAX_BYTES;
          truncated = true;
          finish();
          req.destroy();
          return;
        }
        chunks.push(chunk);
        bytes += chunk.length;
      });
      res.on("end", () => finish());
      res.on("close", () => finish());
    });
    req.end();
  });
}

function decodeBody(raw: RawResponse): string {
  let buf = raw.body;
  const enc = (raw.headers["content-encoding"] ?? "").toLowerCase();
  try {
    if (enc.includes("br")) buf = brotliDecompressSync(buf, { maxOutputLength: MAX_BYTES });
    else if (enc.includes("gzip")) buf = gunzipSync(buf, { maxOutputLength: MAX_BYTES });
    else if (enc.includes("deflate")) buf = inflateSync(buf, { maxOutputLength: MAX_BYTES });
  } catch {
    // Truncated or bogus stream: decode what arrived as-is.
  }
  const ct = raw.headers["content-type"] ?? "";
  let charset = ct.match(/charset\s*=\s*"?([a-z0-9_-]+)/i)?.[1]?.toLowerCase() ?? null;
  if (!charset) {
    const head = buf.subarray(0, 4096).toString("latin1");
    charset = head.match(/<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_-]+)/i)?.[1]?.toLowerCase() ?? null;
  }
  if (charset && charset !== "utf-8" && charset !== "utf8") {
    try {
      return new TextDecoder(charset).decode(buf);
    } catch {
      /* unknown label → utf-8 */
    }
  }
  return buf.toString("utf8");
}

// ---- pacing (1 req/s per host, sequential per audit) ------------------------------------------

const lastStart = new Map<string, number>();

async function pace(hostname: string): Promise<void> {
  const wait = (lastStart.get(hostname) ?? 0) + HOST_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastStart.set(hostname, Date.now());
  if (lastStart.size > 500) {
    const cutoff = Date.now() - 60_000;
    for (const [h, t] of lastStart) if (t < cutoff) lastStart.delete(h);
  }
}

// ---- fetch with manual redirects ----------------------------------------------------------------

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  headers: Record<string, string>;
  body: string;
  bytes: number;
  truncated: boolean;
  timedOut: boolean;
  ms: number;
  hops: Hop[];
  target: VettedTarget;
}

export interface FetchOptions {
  ua?: string;
  accept?: string;
  /** Body kept only for these content types; others come back with body "". */
  types?: RegExp;
  wantBody?: boolean;
  follow?: boolean;
  signal?: AbortSignal;
  lookup?: LookupFn;
  socket?: SocketOverride;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * GET `url` (re-vetting every hop, ≤ MAX_REDIRECTS). Throws SsrfError on a
 * refused hop, FetchError on any network failure; never follows into a
 * private address because each Location goes through vetTarget again.
 */
export async function fetchUrl(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const ua = opts.ua ?? crawlerUserAgent();
  const hops: Hop[] = [];
  let requestMs = 0;
  let current = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const t = await vetTarget(current, { lookup: opts.lookup });
    if (opts.signal?.aborted) throw new FetchError("aborted", hops);
    await pace(t.hostname);
    let raw: RawResponse;
    try {
      raw = await fetchOnce(t, { ua, accept: opts.accept ?? ACCEPT_HTML, wantBody: opts.wantBody !== false, signal: opts.signal, socket: opts.socket });
    } catch (e) {
      throw new FetchError(errorCode(e), hops, e instanceof Error ? e.message.slice(0, 120) : undefined);
    }
    hops.push({ url: current.slice(0, 500), status: raw.status, bytes: raw.bytes });
    requestMs += raw.ms;
    const location = raw.headers.location;
    if (isRedirect(raw.status) && location && opts.follow !== false && i < MAX_REDIRECTS) {
      let next: string;
      try {
        next = new URL(location, current).toString();
      } catch {
        throw new FetchError("bad_redirect", hops);
      }
      current = next;
      continue;
    }
    const contentType = raw.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() ?? null;
    const keep = opts.wantBody !== false && (!opts.types || (contentType !== null && opts.types.test(contentType)));
    return {
      url,
      finalUrl: current,
      status: raw.status,
      contentType,
      headers: raw.headers,
      body: keep ? decodeBody(raw) : "",
      bytes: raw.bytes,
      truncated: raw.truncated,
      timedOut: raw.timedOut,
      ms: requestMs,
      hops,
      target: t,
    };
  }
  throw new FetchError("too_many_redirects", hops);
}

// ---- the site crawl -------------------------------------------------------------------------------

export interface SiteCrawl {
  website: string;
  hostname: string;
  /** Origin of the final home URL (or of the input when the home never answered). */
  origin: string;
  finalUrl: string | null;
  home: CrawledPage | null;
  homeStatus: number;
  homeError: string | null;
  homeMs: number;
  homeTruncated: boolean;
  homeBlockedByRobots: boolean;
  httpsFinal: boolean;
  /** null = not probed (no home). */
  httpToHttpsRedirect: boolean | null;
  hsts: boolean | null;
  tls: TlsInfo | null;
  pages: CrawledPage[];
  contact: CrawledPage | null;
  legal: CrawledPage | null;
  /** null = robots.txt unreachable (5xx / network); 4xx counts as "no rules". */
  robots: RobotsRules | null;
  robotsStatus: number | null;
  aiBots: Record<AiBotKey, boolean> | null;
  llmsTxt: boolean;
  skipped: { url: string; reason: "robots" | "ssrf" | "error" | "not_html" }[];
  crawl: Hop[];
}

export interface CrawlOptions {
  signal?: AbortSignal;
  log?: (m: string) => void;
  lookup?: LookupFn;
  socket?: SocketOverride;
  ua?: string;
}

function toPage(r: FetchResult): CrawledPage {
  return { url: r.url, finalUrl: r.finalUrl, status: r.status, contentType: r.contentType, headers: r.headers, text: r.body, fetchedAt: new Date().toISOString() };
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return "/";
  }
}

async function fetchRobots(origin: string, opts: CrawlOptions, crawl: Hop[]): Promise<{ rules: RobotsRules | null; status: number | null }> {
  try {
    const r = await fetchUrl(`${origin}/robots.txt`, { ua: opts.ua, accept: ACCEPT_TEXT, types: TEXT_TYPES, signal: opts.signal, lookup: opts.lookup, socket: opts.socket });
    crawl.push(...r.hops);
    if (r.status >= 200 && r.status < 300) return { rules: r.contentType && TEXT_TYPES.test(r.contentType) ? parseRobots(r.body) : parseRobots(""), status: r.status };
    if (r.status >= 400 && r.status < 500) return { rules: parseRobots(""), status: r.status };
    return { rules: null, status: r.status };
  } catch (e) {
    if (e instanceof SsrfError) throw e;
    if (e instanceof FetchError) crawl.push(...e.hops);
    return { rules: null, status: null };
  }
}

/**
 * Crawl one prospect site: robots.txt, home (≤ 3 redirects), TLS on the vetted
 * IP, http→https probe, contact + legal pages, llms.txt. Throws SsrfError only
 * when the home chain is refused; everything else lands in the result.
 */
export async function fetchSite(website: string, opts: CrawlOptions = {}): Promise<SiteCrawl> {
  const log = opts.log ?? (() => undefined);
  const start = parseTarget(website); // static refusals (scheme/port/host) surface before any socket
  const origin0 = start.url.origin;
  // `main` = home chain + pages (audits.crawl[0] is the home request); `aux` = robots/probe/llms.
  const main: Hop[] = [];
  const aux: Hop[] = [];
  const skipped: SiteCrawl["skipped"] = [];

  // 1. robots.txt on the input origin.
  let robots = await fetchRobots(origin0, opts, aux);
  const homePath = `${start.url.pathname}${start.url.search}`;
  const homeBlockedByRobots = robots.rules !== null && !robotsAllows(robots.rules, ROBOTS_TOKEN, homePath);

  // 2. home page.
  let home: FetchResult | null = null;
  let homeError: string | null = null;
  let homeMs = 0;
  if (homeBlockedByRobots) {
    skipped.push({ url: website.slice(0, 500), reason: "robots" });
    log("home disallowed by robots.txt");
  } else {
    const t0 = Date.now();
    try {
      home = await fetchUrl(website, { ua: opts.ua, accept: ACCEPT_HTML, types: HTML_TYPES, signal: opts.signal, lookup: opts.lookup, socket: opts.socket });
      main.push(...home.hops);
      homeMs = home.ms; // request time only (pacing and DNS excluded)
    } catch (e) {
      if (e instanceof SsrfError) throw e;
      homeError = errorCode(e);
      if (e instanceof FetchError) main.push(...e.hops);
      homeMs = Date.now() - t0;
    }
  }

  const finalUrl = home?.finalUrl ?? null;
  const origin = finalUrl ? new URL(finalUrl).origin : origin0;
  const hostname = home?.target.hostname ?? start.hostname;
  if (home && origin !== origin0) robots = await fetchRobots(origin, opts, aux);
  const httpsFinal = (finalUrl ?? website).startsWith("https://");

  // 3. TLS on the vetted IP (the final host, or the input host when the home never answered).
  let tls: TlsInfo | null = null;
  let vetted: VettedTarget | null = home?.target ?? null;
  if (!vetted && homeError !== "dns" && homeError !== "no_ipv4") {
    try {
      vetted = await vetTarget(`https://${start.hostname}/`, { lookup: opts.lookup });
    } catch (e) {
      if (e instanceof SsrfError) throw e;
    }
  }
  if (vetted) tls = await checkTls(hostname, vetted.ip, { signal: opts.signal });

  // http → https: observed in the chain, else probed on port 80 of the final host.
  let httpToHttpsRedirect: boolean | null = null;
  if (home) {
    if (website.startsWith("http://") && httpsFinal) httpToHttpsRedirect = true;
    else if (httpsFinal) {
      try {
        const probe = await fetchUrl(`http://${hostname}/`, { ua: opts.ua, wantBody: false, follow: false, signal: opts.signal, lookup: opts.lookup, socket: opts.socket });
        aux.push(...probe.hops);
        httpToHttpsRedirect = isRedirect(probe.status) && /^https:\/\//i.test(probe.headers.location ?? "");
      } catch (e) {
        if (e instanceof SsrfError) throw e;
        if (e instanceof FetchError) aux.push(...e.hops);
        httpToHttpsRedirect = false;
      }
    } else httpToHttpsRedirect = false;
  }
  const hsts = home ? httpsFinal && /max-age\s*=\s*[1-9]/i.test(home.headers["strict-transport-security"] ?? "") : null;

  // 4. contact + legal pages from the home links (same registrable domain only).
  const pages: CrawledPage[] = [];
  let contact: CrawledPage | null = null;
  let legal: CrawledPage | null = null;
  const homeIsHtml = !!home && home.status >= 200 && home.status < 300 && !!home.contentType && HTML_TYPES.test(home.contentType);
  if (home && homeIsHtml) {
    pages.push(toPage(home));
    const links = findLinks(home.body, home.finalUrl);
    const contactUrl = pickLink(links, CONTACT_LINK_RE, home.finalUrl);
    const legalUrl = pickLink(links, LEGAL_LINK_RE, home.finalUrl);
    for (const [kind, u] of [
      ["contact", contactUrl],
      ["legal", legalUrl],
    ] as const) {
      if (!u || (kind === "legal" && u === contactUrl)) continue;
      if (opts.signal?.aborted) break;
      if (robots.rules && !robotsAllows(robots.rules, ROBOTS_TOKEN, pathOf(u))) {
        skipped.push({ url: u, reason: "robots" });
        continue;
      }
      try {
        const r = await fetchUrl(u, { ua: opts.ua, accept: ACCEPT_HTML, types: HTML_TYPES, signal: opts.signal, lookup: opts.lookup, socket: opts.socket });
        main.push(...r.hops);
        if (r.status >= 200 && r.status < 300 && r.contentType && HTML_TYPES.test(r.contentType)) {
          const p = toPage(r);
          pages.push(p);
          if (kind === "contact") contact = p;
          else legal = p;
        } else skipped.push({ url: u, reason: r.status >= 200 && r.status < 300 ? "not_html" : "error" });
      } catch (e) {
        if (e instanceof FetchError) main.push(...e.hops);
        skipped.push({ url: u, reason: e instanceof SsrfError ? "ssrf" : "error" });
      }
    }
  }

  // 5. llms.txt on the final origin.
  let llmsTxt = false;
  if (home && !opts.signal?.aborted && (!robots.rules || robotsAllows(robots.rules, ROBOTS_TOKEN, "/llms.txt"))) {
    try {
      const r = await fetchUrl(`${origin}/llms.txt`, { ua: opts.ua, accept: ACCEPT_TEXT, types: TEXT_TYPES, signal: opts.signal, lookup: opts.lookup, socket: opts.socket });
      aux.push(...r.hops);
      llmsTxt = r.status === 200 && !!r.contentType && TEXT_TYPES.test(r.contentType) && r.body.trim().length > 0;
    } catch (e) {
      if (e instanceof FetchError) aux.push(...e.hops);
    }
  }

  const crawl = [...main, ...aux].slice(0, 30);
  log(`crawl ${hostname}: home ${home ? home.status : homeError} in ${homeMs} ms, ${pages.length} page(s), ${crawl.length} request(s)`);
  return {
    website,
    hostname,
    origin,
    finalUrl,
    home: home && homeIsHtml ? pages[0]! : home ? toPage(home) : null,
    homeStatus: home?.status ?? 0,
    homeError,
    homeMs,
    homeTruncated: home?.truncated ?? false,
    homeBlockedByRobots,
    httpsFinal,
    httpToHttpsRedirect,
    hsts,
    tls,
    pages,
    contact,
    legal,
    robots: robots.rules,
    robotsStatus: robots.status,
    aiBots: robots.rules ? aiBotsAllowed(robots.rules) : null,
    llmsTxt,
    skipped,
    crawl,
  };
}
