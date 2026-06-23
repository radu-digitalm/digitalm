import { createSign } from "crypto";
import { readFileSync } from "fs";

// Service-account access to a Google Workspace calendar via domain-wide
// delegation — no external SDK: we sign a JWT (RS256) with Node crypto and
// exchange it for an access token, impersonating the booking mailbox.

type SAKey = { client_email: string; private_key: string };

export const BOOKING_CALENDAR_ID =
  process.env.BOOKING_CALENDAR_ID || "contact@digitalm.eu";
const SUBJECT = process.env.BOOKING_IMPERSONATE || BOOKING_CALENDAR_ID;
const SCOPE = "https://www.googleapis.com/auth/calendar";

let cachedKey: SAKey | null | undefined;
function loadKey(): SAKey | null {
  if (cachedKey !== undefined) return cachedKey;
  try {
    const raw = process.env.GOOGLE_CALENDAR_KEY_JSON
      ? process.env.GOOGLE_CALENDAR_KEY_JSON
      : process.env.GOOGLE_CALENDAR_KEY_FILE
        ? readFileSync(process.env.GOOGLE_CALENDAR_KEY_FILE, "utf8")
        : "";
    if (!raw) return (cachedKey = null);
    const k = JSON.parse(raw);
    cachedKey =
      k.client_email && k.private_key
        ? { client_email: k.client_email, private_key: k.private_key }
        : null;
  } catch {
    cachedKey = null;
  }
  return cachedKey;
}

/** True when the service-account key is present so live booking is possible. */
export function calendarConfigured(): boolean {
  return loadKey() !== null;
}

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

let tokenCache: { token: string; exp: number } | null = null;
async function getAccessToken(): Promise<string | null> {
  const key = loadKey();
  if (!key) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - 60 > nowSec) return tokenCache.token;

  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: key.client_email,
      sub: SUBJECT,
      scope: SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: nowSec,
      exp: nowSec + 3600,
    }),
  );
  const input = `${head}.${claim}`;
  const sig = b64url(createSign("RSA-SHA256").update(input).sign(key.private_key));

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${input}.${sig}`,
    }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;
  tokenCache = { token: json.access_token, exp: nowSec + (json.expires_in || 3600) };
  return json.access_token;
}

export async function getBusy(
  timeMinISO: string,
  timeMaxISO: string,
): Promise<{ start: string; end: string }[]> {
  const token = await getAccessToken();
  if (!token) return [];
  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      items: [{ id: BOOKING_CALENDAR_ID }],
    }),
  });
  const json = (await res.json()) as {
    calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
  };
  return json?.calendars?.[BOOKING_CALENDAR_ID]?.busy ?? [];
}

export async function createBooking(opts: {
  startISO: string;
  endISO: string;
  summary: string;
  description: string;
  attendeeEmail: string;
  attendeeName?: string;
  tz: string;
}): Promise<boolean> {
  const token = await getAccessToken();
  if (!token) return false;
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      BOOKING_CALENDAR_ID,
    )}/events?sendUpdates=all`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        summary: opts.summary,
        description: opts.description,
        start: { dateTime: opts.startISO, timeZone: opts.tz },
        end: { dateTime: opts.endISO, timeZone: opts.tz },
        attendees: [{ email: opts.attendeeEmail, displayName: opts.attendeeName }],
        reminders: { useDefault: true },
      }),
    },
  );
  const json = (await res.json()) as { id?: string };
  return !!json.id;
}
