// Lead attribution — which campaign brought the person who just filled a form.
//
// The client reads utm_* (and OpenAI's `oppref` click id) from the page URL
// at submit time and posts them with the form; nothing is stored on the
// visitor's device. `CarryParams` keeps those parameters on internal links to
// /diagnostic, /book and /contact so a lead that landed on a service page and
// then clicked through is still attributed. Server side we validate, keep the
// values with the lead, tag the Telegram/email alert and the Umami event, and
// (for ChatGPT Ads) report the conversion back to OpenAI.

export const ATTRIBUTION_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "oppref"] as const;
export type AttributionKey = (typeof ATTRIBUTION_KEYS)[number];
export type Attribution = Partial<Record<AttributionKey, string>>;

const MAX = { oppref: 256, default: 100 } as const;

/** Validate what the client sent — short printable strings only. */
export function readAttribution(raw: unknown): Attribution {
  const out: Attribution = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of ATTRIBUTION_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v !== "string") continue;
    const s = v.trim();
    const max = k === "oppref" ? MAX.oppref : MAX.default;
    if (s && s.length <= max && /^[^\x00-\x1f\x7f]+$/.test(s)) out[k] = s;
  }
  return out;
}

/** Short human label for alerts: "ChatGPT Ads · occitanie-local / occ-ariege-rencontrer". */
export function attributionLabel(a: Attribution): string | null {
  const src = a.utm_source?.toLowerCase();
  if (!src && !a.oppref) return null;
  const name =
    src === "chatgpt" || a.oppref ? "ChatGPT Ads" :
    src === "google" ? "Google" :
    src === "facebook" || src === "meta" || src === "instagram" ? "Meta" :
    src === "linkedin" ? "LinkedIn" :
    src ?? "ad";
  const detail = [a.utm_campaign, a.utm_content].filter(Boolean).join(" / ");
  return detail ? `${name} · ${detail}` : name;
}

/** Compact value for the Umami event and the database (empty string when unattributed). */
export function attributionSource(a: Attribution): string {
  if (a.utm_source) return a.utm_source.toLowerCase();
  if (a.oppref) return "chatgpt";
  return "";
}
