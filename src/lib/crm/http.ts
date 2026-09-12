// Outbound HTTP to the fixed public APIs of contract §11 — and nothing else.
// The base URLs are read once at boot and must be https; any other origin is
// refused before a socket opens. Prospect websites never go through here: the
// audit module has its own SSRF-safe crawler (§7.1).
import { safeHttpUrl } from "@/lib/crm/classify";

const DEFAULTS = {
  OVERPASS_URL: "https://overpass-api.de/api/interpreter",
  // The second server of the overpass-api.de pair, addressed directly (full planet, areas generated) when the
  // first answer is busy or the DNS round-robin lands on a dead node; "off" disables it. Other public mirrors
  // checked on 12 Sep 2026 either lack area files (overpass.openstreetmap.fr) or time out (kumi, private.coffee).
  OVERPASS_FALLBACK_URL: "https://z.overpass-api.de/api/interpreter",
  NOMINATIM_URL: "https://nominatim.openstreetmap.org",
  FR_REGISTER_URL: "https://recherche-entreprises.api.gouv.fr",
  PAGESPEED_URL: "https://www.googleapis.com/pagespeedonline/v5/runPagespeed",
} as const;

function httpsFromEnv(name: keyof typeof DEFAULTS): string {
  const raw = process.env[name];
  if (!raw) return DEFAULTS[name];
  if (raw.trim().toLowerCase() === "off") return "";
  const safe = safeHttpUrl(raw);
  if (safe && safe.startsWith("https://")) return safe.replace(/\/$/, "");
  console.warn(`crm/http: ${name} is not an https URL — using the default`);
  return DEFAULTS[name];
}

/** The only origins fetchJson will talk to. */
export const HOSTS = {
  overpass: httpsFromEnv("OVERPASS_URL"),
  /** "" when switched off. */
  overpassFallback: httpsFromEnv("OVERPASS_FALLBACK_URL"),
  nominatim: httpsFromEnv("NOMINATIM_URL"),
  frRegister: httpsFromEnv("FR_REGISTER_URL"),
  pagespeed: httpsFromEnv("PAGESPEED_URL"),
  geoGouv: "https://geo.api.gouv.fr",
  companiesHouse: "https://api.company-information.service.gov.uk",
} as const;

const ALLOWED_ORIGINS = new Set(
  Object.values(HOSTS)
    .filter((u) => u !== "")
    .map((u) => new URL(u).origin),
);

/** Identifying User-Agent required by the Nominatim / Overpass usage policies. */
export const CRM_USER_AGENT = "DigitalM-Prospecting/1.0 (https://digitalm.eu; contact@digitalm.eu)";

export class HttpError extends Error {
  status: number;
  code: string;
  /** From a Retry-After header on 429 / 503, in milliseconds (capped at 10 min); undefined otherwise. */
  retryAfterMs?: number;
  constructor(code: string, status = 0, message = code, retryAfterMs?: number) {
    super(message);
    this.name = "HttpError";
    this.code = code;
    this.status = status;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

const RETRY_AFTER_MAX_MS = 10 * 60_000;

/** Retry-After as milliseconds (seconds or an HTTP date); undefined when absent or unreadable. */
export function retryAfterMs(header: string | null | undefined, now = Date.now()): number | undefined {
  const v = header?.trim();
  if (!v) return undefined;
  if (/^\d+$/.test(v)) return Math.min(RETRY_AFTER_MAX_MS, Number(v) * 1000);
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return undefined;
  return Math.max(0, Math.min(RETRY_AFTER_MAX_MS, t - now));
}

export function isAllowedApiUrl(url: string): boolean {
  try {
    return ALLOWED_ORIGINS.has(new URL(url).origin);
  } catch {
    return false;
  }
}

/**
 * GET/POST JSON from an allow-listed origin with a timeout. Throws HttpError
 * (`host_not_allowed`, `timeout`, `network`, `http_<status>`, `bad_json`);
 * response bodies are never logged.
 */
export async function fetchJson<T = unknown>(
  url: string,
  opts: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ status: number; data: T }> {
  if (!isAllowedApiUrl(url)) throw new HttpError("host_not_allowed");
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: { accept: "application/json", "user-agent": CRM_USER_AGENT, ...opts.headers },
      body: opts.body,
      signal,
      redirect: "error",
    });
  } catch (e) {
    if (timeout.aborted) throw new HttpError("timeout");
    if (opts.signal?.aborted) throw new HttpError("aborted");
    throw new HttpError("network", 0, e instanceof Error ? e.message.slice(0, 200) : "network");
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    const wait = res.status === 429 || res.status === 503 ? retryAfterMs(res.headers.get("retry-after")) : undefined;
    throw new HttpError(`http_${res.status}`, res.status, `http_${res.status}`, wait);
  }
  try {
    return { status: res.status, data: (await res.json()) as T };
  } catch {
    throw new HttpError("bad_json", res.status);
  }
}

// ---- pacing ------------------------------------------------------------------

const lanes = new Map<string, { chain: Promise<unknown>; lastStart: number }>();

/**
 * Run `fn` on a named lane: never in parallel with another call on the same
 * lane, and at least `minGapMs` after the previous call started (Nominatim
 * 1100 ms, Overpass 1000 ms, FR register 200 ms, Companies House 500 ms).
 */
export function spaced<T>(lane: string, minGapMs: number, fn: () => Promise<T>): Promise<T> {
  const l = lanes.get(lane) ?? { chain: Promise.resolve(), lastStart: 0 };
  const next = l.chain.then(async () => {
    const wait = l.lastStart + minGapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    l.lastStart = Date.now();
    return fn();
  });
  // Keep the chain alive whatever fn does; errors surface to the caller only.
  l.chain = next.catch(() => undefined);
  lanes.set(lane, l);
  return next;
}
