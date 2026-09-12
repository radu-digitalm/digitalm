"use client";

// Add a prospect from its website (contract §6 "Add by URL"), collapsed behind
// one button (docs/finder-ux-spec.md §6.2). Country is required — defaulted
// from the ccTLD (".fr" → FR, ".co.uk" → GB) else FR — the row gets source
// `manual`, the 30-day notice deadline and a queued audit.
// From the finder's Google-only card (docs/finder-google-spec.md §5.5) the
// form is `inline` with the place id attached and `noName`: the business name
// is taken from the site after the audit's crawl, never typed from a Google
// panel; `onSaved` gets the answer (a new prospect, or an existing one the
// listing was attached to) instead of a navigation.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { countryFromTld } from "@/lib/crm/classify";
import { AdminFetchError } from "./adminFetch";
import { Button } from "./Button";
import { Field } from "./Field";
import { addProspectByUrl, type AddByUrlResponse } from "./finderApi";
import { useToast } from "./Toast";
import { PROSPECT_TEXT } from "./wording";

export type AddByUrlProps = {
  className?: string;
  /** Attach this Google place to the prospect (`google_match = 'manual'`, listing found). */
  googlePlaceId?: string;
  /** Initial country (ISO2); otherwise from the ccTLD, else FR. */
  country?: string;
  /** No name field — the name comes from the site. */
  noName?: boolean;
  /** Always open, with a Cancel control instead of the collapsing button. */
  inline?: boolean;
  /** Called with the answer instead of navigating to the new prospect. */
  onSaved?: (r: AddByUrlResponse) => void;
  onCancel?: () => void;
};

export function AddByUrl({ className = "", googlePlaceId, country: initialCountry, noName = false, inline = false, onSaved, onCancel }: AddByUrlProps) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(inline);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [country, setCountry] = useState(initialCountry && /^[A-Z]{2}$/.test(initialCountry) ? initialCountry : "FR");
  const [countryTouched, setCountryTouched] = useState(!!initialCountry);
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
      const r = await addProspectByUrl({ url: url.trim(), name: noName ? undefined : name.trim() || undefined, country, googlePlaceId });
      setUrl("");
      setName("");
      if (onSaved) {
        onSaved(r);
        return;
      }
      toast.push(`Added ${r.reference}${r.auditQueued ? " · audit queued" : ""}`, "good");
      router.push(`/admin/prospects/${r.id}`);
    } catch (err) {
      const e = err instanceof AdminFetchError ? err : null;
      const body = (e?.body ?? {}) as { reference?: string; id?: number; placeAttached?: boolean };
      const code = e?.code ?? "";
      if (code === "already_saved" && onSaved && typeof body.id === "number" && typeof body.reference === "string") {
        onSaved({ ok: true, id: body.id, reference: body.reference, auditQueued: false, existing: true, placeAttached: body.placeAttached === true });
      } else if (code === "already_saved") {
        setError(`Already saved as ${body.reference ?? "an existing prospect"}.`);
        if (body.id) router.push(`/admin/prospects/${body.id}`);
      } else if (code === "bad_url") setError("That does not look like a website address.");
      else if (code === "bad_country") setError("Country must be a two-letter code, e.g. FR or GB.");
      else if (code === "bad_place_id") setError("The Google listing could not be attached — the business was not added.");
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

  const grid = inline ? "grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem] sm:items-end" : "grid gap-3 sm:grid-cols-[2fr_1.5fr_6rem_auto_auto] sm:items-end";
  return (
    <form onSubmit={submit} className={`card ${grid} p-4 ${className}`} noValidate aria-label={PROSPECT_TEXT.addByWebsite} data-testid="add-by-url">
      <Field label="Website" name="url" value={url} onChange={(e) => onUrl(e.target.value)} placeholder="https://www.example.fr" autoComplete="off" required autoFocus inputMode="url" />
      {noName ? null : <Field label="Name (optional)" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="defaults to the domain" autoComplete="off" />}
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
      <div className={`flex flex-wrap gap-2 ${inline ? "sm:col-span-2" : "contents"}`}>
        <Button type="submit" variant="primary" loading={busy}>
          Add
        </Button>
        <Button
          onClick={() => {
            if (onCancel) onCancel();
            else setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
      {error ? (
        <p role="alert" className={`text-[15px] text-accent-soft ${inline ? "sm:col-span-2" : "sm:col-span-5"}`}>
          {error}
        </p>
      ) : null}
    </form>
  );
}
