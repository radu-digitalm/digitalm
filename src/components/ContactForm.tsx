"use client";

import { useState } from "react";
import type { SiteContent } from "@/content/types";
import { useTurnstile } from "@/lib/useTurnstile";
import { PhoneField } from "./PhoneField";

type FormText = SiteContent["contact"]["form"];
type Status = "idle" | "sending" | "success" | "error";

const fieldClass =
  "w-full rounded-lg border border-white/10 bg-surface-2 px-4 py-3 text-fg-heading placeholder:text-fg-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40";
const labelClass = "mb-1.5 block text-sm text-fg-muted";

export function ContactForm({
  text,
  locale,
  email,
}: {
  text: FormText;
  locale: string;
  email: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [mailto, setMailto] = useState<string>(`mailto:${email}`);
  const { token, container } = useTurnstile(true);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries()) as Record<
      string,
      string
    >;
    data.phone = data.phoneNumber
      ? `${data.dialcode || ""} ${data.phoneNumber}`.trim()
      : "";

    // Build a prefilled mailto as a fallback in case server delivery is down.
    const subject = `Digital M — ${data.name || ""}`.trim();
    const lines: string[] = [`Name: ${data.name || ""}`];
    if (data.phone) lines.push(`Phone: ${data.phone}`);
    if (data.company) lines.push(`Company: ${data.company}`);
    lines.push("", data.message || "");
    const body = lines.join("\n");
    setMailto(
      `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    );

    setStatus("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...data, locale, turnstile: token.current }),
      });
      if (!res.ok) throw new Error("request failed");
      setStatus("success");
      form.reset();
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div
        role="status"
        className="card border border-accent/30 p-6 text-sm leading-relaxed text-fg"
      >
        {text.success}
      </div>
    );
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

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className={labelClass}>
            {text.name} <span className="text-accent">*</span>
          </label>
          <input id="name" name="name" required className={fieldClass} autoComplete="name" />
        </div>
        <div>
          <label htmlFor="email" className={labelClass}>
            {text.emailField} <span className="text-accent">*</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className={fieldClass}
            autoComplete="email"
          />
        </div>
      </div>

      <PhoneField
        label={text.phone}
        defaultDial={locale === "fr" ? "+33" : "+44"}
        fieldClass={fieldClass}
        labelClass={labelClass}
      />
      <div>
        <label htmlFor="company" className={labelClass}>
          {text.company}
        </label>
        <input
          id="company"
          name="company"
          className={fieldClass}
          autoComplete="organization"
        />
      </div>

      <div>
        <label htmlFor="message" className={labelClass}>
          {text.message} <span className="text-accent">*</span>
        </label>
        <textarea id="message" name="message" required rows={5} className={fieldClass} />
      </div>

      {status === "error" && (
        <p role="alert" className="text-sm text-accent-soft">
          {text.error}{" "}
          <a className="link-accent" href={mailto}>
            {email}
          </a>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="submit"
          disabled={status === "sending"}
          className="btn-primary px-5 py-3 text-sm disabled:opacity-60"
        >
          {status === "sending" ? text.sending : text.submit}
        </button>
        <p className="text-xs text-fg-faint">{text.responsePromise}</p>
      </div>
    </form>
  );
}
