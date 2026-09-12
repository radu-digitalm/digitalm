"use client";

// Add a prospect from its website (contract §6 "Add by URL"), collapsed behind
// one button (docs/finder-ux-spec.md §6.2). Country is required — defaulted
// from the ccTLD (".fr" → FR, ".co.uk" → GB) else FR — the row gets source
// `manual`, the 30-day notice deadline and a queued audit.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { countryFromTld } from "@/lib/crm/classify";
import { adminFetch } from "./adminFetch";
import { Button } from "./Button";
import { Field } from "./Field";
import { useToast } from "./Toast";
import { PROSPECT_TEXT } from "./wording";

export function AddByUrl({ className = "" }: { className?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [country, setCountry] = useState("FR");
  const [countryTouched, setCountryTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onUrl(v: string) {
    setUrl(v);
    if (!countryTouched) setCountry(countryFromTld(v) ?? "FR");
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!url.trim()) {
      setError("Type the website address.");
      return;
    }
    if (!/^[A-Z]{2}$/.test(country)) {
      setError("Country must be a two-letter code, e.g. FR or GB.");
      return;
    }
    setBusy(true);
    try {
      const r = await adminFetch<{ id: number; reference: string; auditQueued: boolean }>("/api/admin/prospects", { url: url.trim(), name: name.trim() || undefined, country });
      toast.push(`Added ${r.reference}${r.auditQueued ? " · audit queued" : ""}`, "good");
      setUrl("");
      setName("");
      router.push(`/admin/prospects/${r.id}`);
    } catch (err) {
      const e = err as { code?: string; body?: { reference?: string; id?: number } };
      if (e.code === "already_saved") {
        setError(`Already saved as ${e.body?.reference ?? "an existing prospect"}.`);
        if (e.body?.id) router.push(`/admin/prospects/${e.body.id}`);
      } else if (e.code === "bad_url") setError("That does not look like a website address.");
      else if (e.code === "bad_country") setError("Country must be a two-letter code, e.g. FR or GB.");
      else setError("The business could not be added. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)} className={className} aria-expanded={false}>
        {PROSPECT_TEXT.addByWebsite}
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className={`card grid gap-3 p-4 sm:grid-cols-[2fr_1.5fr_6rem_auto_auto] sm:items-end ${className}`} noValidate aria-label={PROSPECT_TEXT.addByWebsite}>
      <Field label="Website" name="url" value={url} onChange={(e) => onUrl(e.target.value)} placeholder="https://www.example.fr" autoComplete="off" required autoFocus />
      <Field label="Name (optional)" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="defaults to the domain" autoComplete="off" />
      <Field
        label="Country"
        name="country"
        value={country}
        onChange={(e) => {
          setCountryTouched(true);
          setCountry(e.target.value.toUpperCase().slice(0, 2));
        }}
        maxLength={2}
        autoComplete="off"
        required
      />
      <Button type="submit" variant="primary" loading={busy}>
        Add
      </Button>
      <Button onClick={() => setOpen(false)}>Cancel</Button>
      {error ? (
        <p role="alert" className="text-[16px] text-accent-soft sm:col-span-5">
          {error}
        </p>
      ) : null}
    </form>
  );
}
