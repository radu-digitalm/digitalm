// Shared Cloudflare Turnstile verification for all public POST endpoints.
// Fail-closed on bad/missing token, fail-open-with-flag on Cloudflare outage,
// skipped entirely when TURNSTILE_SECRET_KEY is unset (local dev).

export type TurnstileResult = "ok" | "bad" | "outage" | "skipped";

export async function verifyTurnstile(token: string, ip: string): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return "skipped";
  if (!token) return "bad";
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
      signal: ctl.signal,
    });
    clearTimeout(t);
    const json = await res.json();
    return json.success ? "ok" : "bad";
  } catch {
    return "outage";
  }
}

// Session allowance so interactive flows (chat) verify once, not per message.
const verified = new Map<string, number>();
const TTL = 6 * 60 * 60_000;

export function markVerified(ip: string): void {
  if (verified.size > 5000) {
    const now = Date.now();
    for (const [k, v] of verified) if (v < now) verified.delete(k);
  }
  verified.set(ip, Date.now() + TTL);
}

export function isRecentlyVerified(ip: string): boolean {
  const exp = verified.get(ip);
  return !!exp && exp > Date.now();
}
