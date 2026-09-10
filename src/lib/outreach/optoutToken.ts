// Pure half of the opt-out flow (contract §9 "Opt-out"): token generation and
// validation, and the three accepted bodies of POST /api/o/[token] — JSON
// `{confirm:true}`, a form `confirm=1`, or the exact one-click body
// `List-Unsubscribe=One-Click` (RFC 8058). No DB, no next/*, so node --test
// loads it; optout.ts adds the database side.
import { randomBytes } from "node:crypto";

/** 32 random bytes as base64url — 43 chars, like report tokens (contract §2). */
export function newOptoutToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Lookups only run on a plausible token: base64url, 20–64 chars (ours are 43). */
export const OPTOUT_TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

export function isOptoutToken(s: unknown): s is string {
  return typeof s === "string" && OPTOUT_TOKEN_RE.test(s);
}

export type OptoutBody = { kind: "json" | "form" | "one_click" } | { kind: "invalid" };

export const ONE_CLICK_BODY = "List-Unsubscribe=One-Click";

/** Classify a raw POST body by its content type; anything else is invalid. */
export function parseOptoutBody(raw: string, contentType: string | null): OptoutBody {
  const body = raw.trim();
  if (body === ONE_CLICK_BODY) return { kind: "one_click" };
  const ct = (contentType ?? "").toLowerCase();
  if (ct.startsWith("application/json")) {
    try {
      const j = JSON.parse(body) as unknown;
      return j && typeof j === "object" && (j as { confirm?: unknown }).confirm === true ? { kind: "json" } : { kind: "invalid" };
    } catch {
      return { kind: "invalid" };
    }
  }
  if (ct.startsWith("application/x-www-form-urlencoded") || ct.startsWith("multipart/form-data") || ct === "") {
    if (body.length > 2000) return { kind: "invalid" };
    const params = new URLSearchParams(body);
    const confirm = params.get("confirm");
    return confirm === "1" || confirm === "true" || confirm === "on" ? { kind: "form" } : { kind: "invalid" };
  }
  return { kind: "invalid" };
}
