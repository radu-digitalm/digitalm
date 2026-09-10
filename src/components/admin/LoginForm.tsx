"use client";

// Shared-password login. Posts JSON { password, turnstile, website, next } to
// /api/admin/login exactly like ContactForm posts to /api/contact: invisible
// Turnstile widget, honeypot field, then a full navigation so the new cookie
// is on the next request.
import { useState } from "react";
import { useTurnstile } from "@/lib/useTurnstile";

type Status = "idle" | "sending" | "error";

const fieldClass =
  "w-full rounded-lg border border-white/10 bg-surface-2 px-4 py-3 text-fg-heading placeholder:text-fg-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40";
const labelClass = "mb-1.5 block text-sm text-fg-muted";

function messageFor(status: number, code: string | undefined): string {
  if (status === 401) return "Wrong password.";
  if (status === 429) return "Too many attempts — wait ten minutes and try again.";
  if (status === 403) return "Verification failed — reload the page and try again.";
  if (status === 503 || code === "login_disabled") return "Login is not configured on this server.";
  if (status === 500) return "Server configuration error — check the session secret.";
  return "Something went wrong — try again.";
}

export function LoginForm({ next }: { next: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const { token, container } = useTurnstile(true);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    setStatus("sending");
    setError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password: data.password ?? "", turnstile: token.current, website: data.website ?? "", next }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; redirect?: string };
      if (!res.ok || !json.ok) {
        setError(messageFor(res.status, json.error));
        setStatus("error");
        try { window.turnstile?.reset(); } catch { /* widget may not be rendered */ }
        return;
      }
      window.location.assign(json.redirect || next);
    } catch {
      setError("Network error — try again.");
      setStatus("error");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {/* Honeypot — hidden from users, catches bots. */}
      <div className="hidden" aria-hidden="true">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {/* Invisible Turnstile widget — its token rides along with the POST. */}
      <div ref={container} />

      <div>
        <label htmlFor="password" className={labelClass}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          autoFocus
          className={fieldClass}
        />
      </div>

      {status === "error" && (
        <p role="alert" className="text-sm text-accent-soft">
          {error}
        </p>
      )}

      <button type="submit" disabled={status === "sending"} className="btn-primary w-full px-5 py-3 text-sm disabled:opacity-60">
        {status === "sending" ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
