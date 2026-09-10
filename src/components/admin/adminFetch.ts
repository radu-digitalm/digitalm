"use client";

// Client-side calls to /api/admin/*. POSTs carry the CSRF token the (gated)
// layout puts in <meta name="dm-csrf"> (contract §10) and same-origin cookies;
// any non-2xx throws the JSON `error` code so panels can show it in a toast.
// A 401 means the session expired: go back through the login page.

export class AdminFetchError extends Error {
  status: number;
  code: string;
  body: unknown;
  constructor(status: number, code: string, body: unknown) {
    super(code);
    this.name = "AdminFetchError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export function csrfToken(): string {
  if (typeof document === "undefined") return "";
  return document.querySelector<HTMLMetaElement>('meta[name="dm-csrf"]')?.content ?? "";
}

async function handle<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as unknown;
  if (res.ok) return json as T;
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.assign(`/admin/login?next=${encodeURIComponent(window.location.pathname)}`);
  }
  const err = json && typeof json === "object" ? (json as { error?: unknown }).error : undefined;
  throw new AdminFetchError(res.status, typeof err === "string" && err ? err : `http_${res.status}`, json);
}

/** POST JSON with the CSRF header; resolves to the parsed JSON body. */
export async function adminFetch<T = unknown>(url: string, body: unknown = {}): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dm-csrf": csrfToken() },
    credentials: "same-origin",
    body: JSON.stringify(body ?? {}),
  });
  return handle<T>(res);
}

/** GET JSON (panels self-load their state from the owner routes). */
export async function adminGet<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin", headers: { accept: "application/json" }, cache: "no-store" });
  return handle<T>(res);
}
