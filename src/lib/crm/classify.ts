// Pure classification helpers shared by every CRM module (contract §3
// "Foundation helpers"). No imports at all: this file runs under node --test,
// in the edge middleware and in client components (ExtLink applies safeHttpUrl
// to every admin href), so even node:crypto is off limits — the SHA-256 for
// hashEmail/hashPhone is a compact local implementation, tested against Node's.
import type { EmailKind } from "./types.ts";

// ---- email ------------------------------------------------------------------

export const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** True for a syntactically plausible address of at most 254 chars. */
export function validEmail(s: unknown): boolean {
  return typeof s === "string" && s.length <= 254 && EMAIL_RE.test(s);
}

/** Trimmed, lower-cased address or null when invalid. */
export function normaliseEmail(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim().toLowerCase();
  return validEmail(t) ? t : null;
}

// Consumer mailbox providers: an address here is personal, never emailed.
// Bare names match any TLD (gmail.com, gmail.fr…); full domains match exactly.
export const WEBMAIL_DOMAINS = [
  "gmail", "googlemail", "outlook", "hotmail", "live", "yahoo", "orange.fr", "wanadoo.fr", "free.fr", "sfr.fr",
  "laposte.net", "bbox.fr", "neuf.fr", "icloud", "me.com", "aol", "protonmail", "proton.me", "gmx", "yandex",
] as const;

// Role addresses: the mailbox of the business, not of a person.
export const GENERIC_LOCALS = [
  "contact", "info", "bonjour", "hello", "hi", "accueil", "boutique", "commercial", "reservation", "reservations",
  "resa", "office", "admin", "mail", "sales", "secretariat", "direction", "cabinet", "agence", "atelier", "garage",
  "restaurant", "salon",
] as const;

const WEBMAIL_FULL = new Set<string>(WEBMAIL_DOMAINS.filter((d) => d.includes(".")));
const WEBMAIL_BRANDS = new Set<string>(WEBMAIL_DOMAINS.filter((d) => !d.includes(".")));
const GENERIC = new Set<string>(GENERIC_LOCALS);

export function isWebmailDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  if (WEBMAIL_FULL.has(d)) return true;
  const labels = d.split(".");
  if (labels.length >= 2 && WEBMAIL_FULL.has(labels.slice(-2).join("."))) return true;
  // Any non-TLD label — covers yahoo.co.uk, mail.yahoo.com, outlook.fr.
  return labels.slice(0, -1).some((l) => WEBMAIL_BRANDS.has(l));
}

/**
 * webmail → sole_trader (when the register says so) → generic (role mailbox)
 * → named. `domainKey` is accepted for symmetry with the extractor's call site;
 * the rule itself does not depend on it.
 */
export function classifyEmail(
  email: string,
  opts: { domainKey?: string | null; soleTrader?: boolean | null } = {},
): EmailKind {
  const e = normaliseEmail(email);
  if (!e) return "unknown";
  const at = e.lastIndexOf("@");
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (isWebmailDomain(domain)) return "webmail";
  if (opts.soleTrader === true) return "sole_trader";
  const base = local.replace(/[^a-z]/g, "");
  if (GENERIC.has(local) || GENERIC.has(base)) return "generic";
  return "named";
}

// ---- URLs -------------------------------------------------------------------

/** http(s) URL without credentials, ≤ 500 chars, normalised; null otherwise. */
export function safeHttpUrl(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t || t.length > 500) return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (!u.hostname) return null;
  return u.toString();
}

/** Like safeHttpUrl but accepts a bare host ("example.fr") by prepending https://. */
export function coerceHttpUrl(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t) return null;
  return safeHttpUrl(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`);
}

// Second-level labels under which a third label is the registrable part
// (example.co.uk, example.com.au, example.gouv.fr). A heuristic — no public
// suffix list is shipped — good enough for a dedupe key.
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "gouv", "ac", "edu", "asso", "nom", "ltd", "plc"]);

/** Registrable domain of a URL, lower-case, without "www." — the prospect's domain_key. */
export function domainOf(url: string): string | null {
  const safe = safeHttpUrl(url);
  if (!safe) return null;
  let host = new URL(safe).hostname.toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return host;
  host = host.replace(/^www\./, "");
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".") || null;
  const tld = labels[labels.length - 1]!;
  const sld = labels[labels.length - 2]!;
  const keep = tld.length === 2 && SECOND_LEVEL.has(sld) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

const TLD_COUNTRY: Record<string, string> = {
  fr: "FR", uk: "GB", gb: "GB", us: "US", de: "DE", be: "BE", ch: "CH", es: "ES", it: "IT", nl: "NL", ca: "CA",
  ie: "IE", pt: "PT", lu: "LU", at: "AT", mc: "MC", dk: "DK", se: "SE", no: "NO", fi: "FI", pl: "PL", cz: "CZ",
  ro: "RO", au: "AU", nz: "NZ",
};

/** ISO2 country hinted by a ccTLD (".fr" → FR, ".co.uk" → GB); null for .com/.eu/.net… */
export function countryFromTld(url: string): string | null {
  const safe = coerceHttpUrl(url);
  if (!safe) return null;
  const host = new URL(safe).hostname.toLowerCase();
  const tld = host.slice(host.lastIndexOf(".") + 1);
  return TLD_COUNTRY[tld] ?? null;
}

export function localeForCountry(cc: string | null | undefined): "fr" | "en" {
  return (cc ?? "").toUpperCase() === "FR" ? "fr" : "en";
}

// ---- names ------------------------------------------------------------------

const LEGAL_FORMS = new Set([
  "sarl", "sas", "sasu", "eurl", "sa", "sci", "snc", "ei", "eirl", "sel", "selarl", "scp", "scm", "gie", "ltd",
  "limited", "llp", "plc", "llc", "inc", "co", "cie", "gmbh", "ag", "bv", "nv", "srl", "sl", "sprl",
]);

/**
 * Comparison key for a business name: lower-case, accents and punctuation
 * stripped, legal-form tokens removed from the ends, single spaces.
 */
export function normaliseName(name: string): string {
  const tokens = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  while (tokens.length > 1 && LEGAL_FORMS.has(tokens[0]!)) tokens.shift();
  while (tokens.length > 1 && LEGAL_FORMS.has(tokens[tokens.length - 1]!)) tokens.pop();
  return tokens.join(" ");
}

// ---- hashes -----------------------------------------------------------------

export function hashEmail(email: string): string {
  return sha256Hex(email.trim().toLowerCase());
}

// Dial codes for national numbers written with a trunk prefix (06…, 07…).
const DIAL: Record<string, string> = { FR: "33", GB: "44", US: "1", BE: "32", CH: "41", DE: "49", ES: "34", IT: "39" };

/** E.164 digits ("33612345678") for a phone in any common notation; null when too short. */
export function e164Digits(phone: string, country = "FR"): string | null {
  let s = phone.trim().replace(/\(0\)/g, ""); // "+33 (0)6 …" trunk-in-parentheses
  const intl = s.startsWith("+") || s.startsWith("00");
  s = s.replace(/\D/g, "");
  if (intl) s = s.replace(/^00/, "");
  else if (s.startsWith("0") && DIAL[country.toUpperCase()]) s = DIAL[country.toUpperCase()] + s.slice(1);
  else if (country.toUpperCase() === "US" && s.length === 10) s = `1${s}`;
  return s.length >= 6 && s.length <= 15 ? s : null;
}

export function hashPhone(phone: string, country = "FR"): string | null {
  const digits = e164Digits(phone, country);
  return digits ? sha256Hex(digits) : null;
}

// ---- geo --------------------------------------------------------------------

/** Great-circle distance in metres. */
export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// ---- SHA-256 (FIPS 180-4), hex output ----------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const padded = new Uint8Array((((bytes.length + 9 + 63) >> 6) << 6));
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  const bitLen = bytes.length * 8;
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(padded.length - 4, bitLen >>> 0);

  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, hh = h[7]!;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0; h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0; h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + hh) >>> 0;
  }
  let out = "";
  for (let i = 0; i < 8; i++) out += h[i]!.toString(16).padStart(8, "0");
  return out;
}
