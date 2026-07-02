// Tiny in-memory per-IP rate limiter (single Node process — fine for this site).
// Protects the API routes from spam and AI-token drain without any dependency.

type Hit = { count: number; reset: number };
const buckets = new Map<string, Hit>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}

export function clientIp(req: Request): string {
  // nginx sets X-Real-IP from the actual socket address — spoof-proof.
  // Never trust the first X-Forwarded-For entry (client-controlled).
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  // Fallback: last XFF hop (appended by our proxy, not the client).
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",");
    return hops[hops.length - 1]!.trim();
  }
  return "unknown";
}
