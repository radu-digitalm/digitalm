"use client";

// "Add lead" on /admin/leads: a collapsible form posting to /api/admin/leads,
// then a navigation to the new (or merged) lead.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Lead } from "@/lib/crm/types";
import { Button } from "./Button";
import { Field } from "./Field";
import { Select } from "./Select";
import { Textarea } from "./Textarea";
import { adminFetch } from "./adminFetch";
import { useToast } from "./Toast";

const ERRORS: Record<string, string> = {
  name: "A name is required.",
  contact: "An email or a phone number is required.",
  email: "That email address does not look valid.",
  country: "Country must be a two-letter code.",
};

export function AddLeadForm() {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    setBusy(true);
    setError("");
    try {
      const res = await adminFetch<{ ok: true; lead: Lead; merged: boolean }>("/api/admin/leads", data);
      toast.push(res.merged ? `Merged into ${res.lead.reference}` : `Created ${res.lead.reference}`, "good");
      router.push(`/admin/leads/${res.lead.id}`);
    } catch (err) {
      const code = (err as Error).message;
      setError(ERRORS[code] ?? `Not saved: ${code}`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        Add lead
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="card w-full space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base text-fg-heading">New lead</h2>
        <Button size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="name" required maxLength={200} autoFocus />
        <Field label="Company" name="company" maxLength={200} />
        <Field label="Email" name="email" type="email" maxLength={254} />
        <Field label="Phone" name="phone" maxLength={50} />
        <Field label="Country" name="country" defaultValue="FR" maxLength={2} hint="Two-letter code" />
        <Select label="Language" name="locale" defaultValue="fr" options={[{ value: "fr", label: "French" }, { value: "en", label: "English" }]} />
      </div>
      <Field label="Where from" name="source_label" placeholder="Met at…, referral from…" maxLength={200} />
      <Textarea label="Notes" name="note" rows={3} maxLength={4000} />
      {error ? (
        <p role="alert" className="text-sm text-accent-soft">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" loading={busy}>
        Save lead
      </Button>
    </form>
  );
}
