// Server-side Umami events, fired from API routes. Client-side tracking
// disappears for adblock users, so conversion counts (diagnostic completed,
// booking made, contact message) are recorded here too — exact, unblockable.
// Fire-and-forget: analytics must never delay or fail a request.

const UMAMI = "http://127.0.0.1:3002/anal1t1c5/api/send";
const WEBSITE = process.env.NEXT_PUBLIC_ANALYTICS_ID;

export function serverTrack(name: string, data?: Record<string, string | number>): void {
  if (!WEBSITE) return;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 3000);
  fetch(UMAMI, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Umami runs isbot() on the UA and silently drops "bot" hits (responds
      // {"beep":"boop"}). A browser-like UA is required for the event to count.
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({
      type: "event",
      payload: {
        website: WEBSITE,
        hostname: "digitalm.eu",
        url: "/server",
        name,
        data,
      },
    }),
    signal: ctl.signal,
  })
    .catch((e) => console.warn("serverTrack failed", name, e?.code ?? e?.message))
    .finally(() => clearTimeout(t));
}
