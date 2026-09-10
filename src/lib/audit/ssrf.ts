// SSRF guard for every request our crawler makes to a prospect's site
// (contract §7.1 and §10). A URL is accepted only when it is http(s) on port
// 80/443 without credentials, its hostname is not a local/internal name, and
// EVERY address DNS returns for it is public. The caller then opens the socket
// to the vetted IPv4 itself (pinnedLookup) so a rebinding answer between the
// check and the connect cannot swap the target.
//
// No Next or DB imports: this file runs under node --test (strip-only mode —
// no enums, namespaces or parameter properties) and is imported by relative
// path from the rest of src/lib/audit.
import { promises as dns } from "node:dns";
import { BlockList, isIP, isIPv4 } from "node:net";

// ---- errors -------------------------------------------------------------------

/** A policy refusal: the message always starts with "ssrf:" (acceptance tests key on it). */
export class SsrfError extends Error {
  code: string;
  constructor(code: string, detail?: string) {
    super(detail ? `ssrf:${code} ${detail}` : `ssrf:${code}`);
    this.name = "SsrfError";
    this.code = `ssrf:${code}`;
  }
}

/** DNS gave no usable answer (NXDOMAIN, SERVFAIL, IPv6-only host) — a plain fetch failure, not a refusal. */
export class LookupError extends Error {
  code: string;
  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "LookupError";
    this.code = code;
  }
}

// ---- address rules --------------------------------------------------------------

/** Ranges never connected to (contract §7.1 step 2), as [network, prefix, family]. */
export const BLOCKED_RANGES: [string, number, "ipv4" | "ipv6"][] = [
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["169.254.0.0", 16, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.0.0.0", 24, "ipv4"],
  ["192.0.2.0", 24, "ipv4"],
  ["192.88.99.0", 24, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["198.18.0.0", 15, "ipv4"],
  ["198.51.100.0", 24, "ipv4"],
  ["203.0.113.0", 24, "ipv4"],
  ["224.0.0.0", 4, "ipv4"],
  ["240.0.0.0", 4, "ipv4"],
  ["255.255.255.255", 32, "ipv4"],
  ["::", 128, "ipv6"],
  ["::1", 128, "ipv6"],
  ["64:ff9b::", 96, "ipv6"],
  ["100::", 64, "ipv6"],
  ["2001:db8::", 32, "ipv6"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"],
];

const blockList = new BlockList();
for (const [net, prefix, family] of BLOCKED_RANGES) blockList.addSubnet(net, prefix, family);

/** Eight 16-bit groups of an IPv6 literal (zone id dropped, embedded dotted quad folded), or null. */
export function expandIpv6(ip: string): number[] | null {
  let s = ip.trim().toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  const dotted = s.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) {
    const o = dotted.slice(2, 6).map(Number);
    if (o.some((n) => n > 255)) return null;
    s = `${dotted[1]}${(((o[0]! << 8) | o[1]!) >>> 0).toString(16)}:${(((o[2]! << 8) | o[3]!) >>> 0).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...new Array<string>(fill).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(Number.parseInt(g, 16));
  }
  return out;
}

/**
 * The IPv4 address embedded in an IPv4-mapped (::ffff:a.b.c.d) or the
 * deprecated IPv4-compatible (::a.b.c.d) IPv6 address; null for any other.
 */
export function unmapIpv4(ip: string): string | null {
  const g = expandIpv6(ip);
  if (!g) return null;
  const zeroHead = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
  if (!zeroHead) return null;
  const mapped = g[5] === 0xffff;
  const compatible = g[5] === 0 && (g[6] !== 0 || (g[7] !== 0 && g[7] !== 1)); // not :: or ::1
  if (!mapped && !compatible) return null;
  return `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
}

/** True only for a syntactically valid IP outside every blocked range (mapped v6 re-tested as v4). */
export function isPublicIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !blockList.check(ip, "ipv4");
  if (family !== 6) return false;
  const v4 = unmapIpv4(ip);
  if (v4) return isPublicIp(v4);
  const groups = expandIpv6(ip);
  if (!groups) return false;
  return !blockList.check(groups.map((n) => n.toString(16)).join(":"), "ipv6");
}

// ---- hostname and URL rules ----------------------------------------------------------

// localhost, *.localhost, *.local, *.internal (metadata.google.internal), *.home.arpa
const BLOCKED_HOST_RE = /(^|\.)(localhost|local|internal|home\.arpa)$/i;

export const MAX_URL_LENGTH = 2048;

export function hostnameAllowed(hostname: string): boolean {
  const h = hostname.replace(/\.$/, "").toLowerCase();
  if (!h) return false;
  return !BLOCKED_HOST_RE.test(h);
}

export interface Target {
  url: URL;
  https: boolean;
  /** Hostname without brackets, trailing dot dropped, lower-case. */
  hostname: string;
  port: number;
  /** Set when the hostname is an IP literal (no DNS needed). */
  ipLiteral: string | null;
}

export interface VettedTarget extends Target {
  /** The public IPv4 the socket is pinned to. */
  ip: string;
  /** Every address the lookup returned (all vetted). */
  addresses: string[];
}

/** Parse and apply the static rules (scheme, credentials, port, hostname). Throws SsrfError. */
export function parseTarget(raw: string): Target {
  if (typeof raw !== "string" || !raw.trim()) throw new SsrfError("url", "empty");
  if (raw.length > MAX_URL_LENGTH) throw new SsrfError("url", "too long");
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new SsrfError("url", "unparseable");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SsrfError("scheme", url.protocol);
  if (url.username || url.password) throw new SsrfError("credentials");
  const https = url.protocol === "https:";
  const port = url.port === "" ? (https ? 443 : 80) : Number.parseInt(url.port, 10);
  if (port !== 80 && port !== 443) throw new SsrfError("port", String(port));
  let hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  let ipLiteral: string | null = null;
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    ipLiteral = hostname.slice(1, -1);
    hostname = ipLiteral;
  } else if (isIPv4(hostname)) {
    ipLiteral = hostname;
  }
  if (!hostname) throw new SsrfError("host", "empty");
  if (!ipLiteral && !hostnameAllowed(hostname)) throw new SsrfError("host", hostname);
  return { url, https, hostname, port, ipLiteral };
}

export type LookupFn = (hostname: string, options: { all: true }) => Promise<{ address: string; family: number }[]>;

const defaultLookup: LookupFn = (hostname, options) => dns.lookup(hostname, options);

/**
 * Static rules + DNS: every answer must be public, and one of them must be
 * IPv4 (the box has no IPv6 egress). `lookup` is injectable for tests.
 */
export async function vetTarget(raw: string, opts: { lookup?: LookupFn } = {}): Promise<VettedTarget> {
  const t = parseTarget(raw);
  if (t.ipLiteral) {
    if (!isPublicIp(t.ipLiteral)) throw new SsrfError("private_ip", t.ipLiteral);
    const v4 = isIPv4(t.ipLiteral) ? t.ipLiteral : unmapIpv4(t.ipLiteral);
    if (!v4) throw new LookupError("no_ipv4", t.ipLiteral);
    return { ...t, ip: v4, addresses: [t.ipLiteral] };
  }
  let answers: { address: string; family: number }[];
  try {
    answers = await (opts.lookup ?? defaultLookup)(t.hostname, { all: true });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    throw new LookupError("dns", typeof code === "string" ? code : "lookup failed");
  }
  if (!Array.isArray(answers) || answers.length === 0) throw new LookupError("dns", "no answer");
  for (const a of answers) {
    if (typeof a?.address !== "string" || !isPublicIp(a.address)) throw new SsrfError("private_ip", String(a?.address));
  }
  const v4 = answers.find((a) => a.family === 4 || isIPv4(a.address));
  if (!v4) throw new LookupError("no_ipv4", t.hostname);
  return { ...t, ip: v4.address, addresses: answers.map((a) => a.address) };
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;

/**
 * `lookup` option for http.request / net.connect / tls.connect that answers
 * with the vetted IPv4 only. Handles both callback shapes (`all: true` gets an
 * array); pass `autoSelectFamily: false` alongside it.
 */
export function pinnedLookup(ip: string): (hostname: string, options: { all?: boolean } | undefined, callback: LookupCallback) => void {
  return (_hostname, options, callback) => {
    if (options && options.all) callback(null, [{ address: ip, family: 4 }]);
    else callback(null, ip, 4);
  };
}
