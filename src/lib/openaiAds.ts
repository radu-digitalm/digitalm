// ChatGPT Ads conversion tracking — server-side Conversions API only.
// https://developers.openai.com/ads/conversions-api
//
// We deliberately do not load OpenAI's browser pixel: it would need new CSP
// origins, a script on every page and a tracking cookie — and our privacy
// page promises none. Instead the ad click lands with an `oppref` query
// parameter (OpenAI's privacy-preserving click id). The diagnostic wizard and
// the booking widget read it from the landing URL and post it back with the
// form; the API route forwards it here when a real conversion happens.
// Nothing is stored on the visitor's device, and visitors who never clicked a
// ChatGPT ad are never reported. No-op until both env vars are set.

const PIXEL_ID = process.env.OPENAI_ADS_PIXEL_ID;
const API_KEY = process.env.OPENAI_ADS_CAPI_KEY;
const ENDPOINT = "https://bzr.openai.com/v1/events";

export type AdsEvent = "lead_created" | "appointment_scheduled" | "registration_completed";

export function adsConfigured(): boolean {
  return Boolean(PIXEL_ID && API_KEY);
}

/** Validate a click id coming from the client; OpenAI says pass it unmodified. */
export function cleanOppref(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s && s.length <= 256 && /^[\x21-\x7e]+$/.test(s) ? s : null;
}

/**
 * Report a conversion to ChatGPT Ads. Fire-and-forget: never delays or fails
 * the request. `id` must be stable (the enquiry reference) so a retry or a
 * second integration can't double-count. Only the click id, the event and the
 * page are sent — no name, e-mail, IP or user agent.
 */
export function adsConversion(
  event: AdsEvent,
  opts: { id: string; sourceUrl: string; oppref: unknown },
): void {
  if (!adsConfigured()) return;
  const oppref = cleanOppref(opts.oppref);
  if (!oppref) return;

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
