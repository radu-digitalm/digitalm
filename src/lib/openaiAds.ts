// ChatGPT Ads conversion tracking — server-side Conversions API only.
// https://developers.openai.com/ads/conversions-api
//
// We deliberately do not load OpenAI's browser pixel: it would need new CSP
// origins and a script on every page. Instead the ad click lands with an
// `oppref` query parameter (OpenAI's privacy-preserving click id); the
// middleware stores it in a first-party cookie and the API routes that record
// a real conversion (diagnostic completed, booking) post it back here.
// Events are only sent when that cookie exists — visitors who never clicked a
// ChatGPT ad are never reported to OpenAI. No-op until both env vars are set.

export const OPPREF_COOKIE = "__oppref"; // same name the official pixel uses
export const OPPREF_MAX_AGE = 30 * 24 * 3600; // seconds — matches a 30-day click window

const PIXEL_ID = process.env.OPENAI_ADS_PIXEL_ID;
const API_KEY = process.env.OPENAI_ADS_CAPI_KEY;
const ENDPOINT = "https://bzr.openai.com/v1/events";

export type AdsEvent = "lead_created" | "appointment_scheduled" | "registration_completed";

export function adsConfigured(): boolean {
  return Boolean(PIXEL_ID && API_KEY);
}

/** Read the click id the middleware stored on the landing page, if any. */
export function opprefFrom(req: Request): string | null {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === OPPREF_COOKIE) {
      const val = decodeURIComponent(v.join("=")).trim();
      return val && val.length <= 256 ? val : null;
    }
  }
  return null;
}

/**
 * Report a conversion to ChatGPT Ads. Fire-and-forget: never delays or fails
 * the request. `id` must be stable (the enquiry reference) so a retry or a
 * second integration can't double-count.
 */
export function adsConversion(
  event: AdsEvent,
  opts: { id: string; sourceUrl: string; req: Request; ip?: string },
): void {
  if (!adsConfigured()) return;
  const oppref = opprefFrom(opts.req);
  if (!oppref) return;

  const user: Record<string, string> = {};
  if (opts.ip && opts.ip !== "unknown") user.ip_address = opts.ip;
  const ua = opts.req.headers.get("user-agent");
  if (ua) user.user_agent = ua.slice(0, 512);

  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 4000);
  fetch(`${ENDPOINT}?pid=${encodeURIComponent(PIXEL_ID!)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      validate_only: false,
      events: [
        {
          id: `${event}_${opts.id}`,
          type: event,
          timestamp_ms: Date.now(),
          oppref,
          source_url: opts.sourceUrl,
          action_source: "web",
          user,
          data: { type: "customer_action" },
        },
      ],
    }),
    signal: ctl.signal,
  })
    .then(async (r) => {
      if (!r.ok) console.warn("adsConversion rejected", event, r.status, (await r.text()).slice(0, 300));
    })
    .catch((e) => console.warn("adsConversion failed", event, e?.code ?? e?.message))
    .finally(() => clearTimeout(t));
}
