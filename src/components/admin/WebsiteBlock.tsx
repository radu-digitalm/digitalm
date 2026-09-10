"use client";

// Website facts and the admin controls that live on the prospect page
// (contract §6): website (editable), what the audit extracted (email + kind +
// page, phone, socials, CMS — read here, written by the audit module), the
// forbids-extraction state with its override reason, contact overrides,
// locale and fit, recollect after a wipe, and "Not this business".
// Every write posts to POST /api/admin/prospects/[id] and refreshes the page.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Prospect } from "@/lib/crm/types";
import { adminFetch } from "./adminFetch";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { ConfirmButton } from "./ConfirmButton";
import { ExtLink } from "./ExtLink";
import { Field } from "./Field";
import { KeyValue, type KeyValueItem } from "./KeyValue";
import { Select } from "./Select";
import { useToast } from "./Toast";

const ERROR_TEXT: Record<string, string> = {
  bad_email: "One valid address only (no lists, no display names).",
  bad_phone: "That phone number does not look right.",
  bad_website: "That does not look like a website address.",
  bad_reason: "Give a reason of at least three characters.",
};

const FIT_OPTIONS = [
  { value: "unknown", label: "Fit: not decided" },
  { value: "fit", label: "Fit: yes" },
  { value: "not_fit", label: "Fit: no" },
];

export function WebsiteBlock({ prospect: p }: { prospect: Prospect }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [website, setWebsite] = useState(p.website ?? "");
  const [emailOverride, setEmailOverride] = useState(p.contactEmailOverride ?? "");
  const [phoneOverride, setPhoneOverride] = useState(p.contactPhoneOverride ?? "");
  const [reason, setReason] = useState(p.forbidsOverrideReason ?? "");
  const [notFitReason, setNotFitReason] = useState(p.notFitReason ?? "");

  async function patch(label: string, body: Record<string, unknown>, done?: string) {
    setBusy(label);
    try {
      await adminFetch(`/api/admin/prospects/${p.id}`, body);
      toast.push(done ?? "Saved", "good");
      router.refresh();
      return true;
    } catch (e) {
      const code = (e as { code?: string }).code ?? "error";
      toast.push(ERROR_TEXT[code] ?? `Failed (${code})`, "bad");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const socials = p.websiteSocials ? Object.entries(p.websiteSocials) : [];
  const items: KeyValueItem[] = [
    {
      label: "Website",
      value: p.website ? (
        <span>
          <ExtLink href={p.website} /> <span className="text-xs text-fg-faint">from {p.websiteSource ?? "unknown"}{p.domainKey ? ` · ${p.domainKey}` : ""}</span>
        </span>
      ) : (
        <span className="text-fg-faint">none — add one below to enable audits</span>
      ),
    },
    {
      label: "Email",
      value: p.websiteEmail ? (
        <span className="break-all">
          {p.websiteEmail}{" "}
          <Badge variant={p.websiteEmailKind === "webmail" || p.websiteEmailKind === "unknown" ? "warn" : "neutral"} className="ml-1">
            {p.websiteEmailKind ?? "unknown"}
          </Badge>
          {p.websiteEmailPage ? (
            <span className="ml-2 text-xs">
              <ExtLink href={p.websiteEmailPage}>page</ExtLink>
            </span>
          ) : null}
        </span>
      ) : p.sourceEmail ? (
        <span className="break-all">
          {p.sourceEmail} <span className="text-xs text-fg-faint">(from the source, not the site)</span>
        </span>
      ) : (
        <span className="text-fg-faint">{p.forbidsExtraction ? "not stored — the site forbids extraction" : p.personalWipedAt ? "wiped" : "none found yet"}</span>
      ),
    },
    {
      label: "Phone",
      value: p.websitePhone ?? p.sourcePhone ? (
        <span>
          {p.websitePhone ?? p.sourcePhone} <span className="text-xs text-fg-faint">({p.websitePhone ? "site" : "source"})</span>
        </span>
      ) : null,
    },
    {
      label: "Socials",
      value: socials.length > 0 ? (
        <span className="inline-flex flex-wrap gap-2">
          {socials.map(([k, v]) => (
            <ExtLink key={k} href={v}>
              {k}
            </ExtLink>
          ))}
        </span>
      ) : null,
    },
    { label: "CMS", value: p.websiteCms },
    {
      label: "Extraction",
      value: p.forbidsExtraction ? (
        <span className="inline-flex flex-wrap items-center gap-2">
          <Badge variant={p.forbidsOverrideReason ? "warn" : "bad"}>{p.forbidsOverrideReason ? "forbidden — override on file" : "forbidden by the site's legal page"}</Badge>
          {p.forbidsOverrideReason ? <span className="text-xs text-fg-muted">{p.forbidsOverrideReason}</span> : null}
        </span>
      ) : (
        <span className="text-fg-muted">allowed</span>
      ),
    },
    {
      label: "Overrides",
      value: p.contactEmailOverride || p.contactPhoneOverride ? (
        <span className="break-all">
          {p.contactEmailOverride ?? ""}
          {p.contactEmailOverride && p.contactPhoneOverride ? " · " : ""}
          {p.contactPhoneOverride ?? ""}
        </span>
      ) : null,
    },
    {
      label: "Audit",
      value: p.latestAuditId ? (
        <span>
          score {p.latestScore ?? "—"} · grade {p.latestGrade ?? "—"}
        </span>
      ) : (
        <span className="text-fg-faint">not audited yet</span>
      ),
    },
  ];

  return (
    <section className="card space-y-5 p-5" aria-label="Website">
      <h2 className="text-lg text-fg-heading">Website</h2>
      <KeyValue items={items} />

      <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void patch("website", { website: website.trim() || null }, website.trim() ? "Website saved — run an audit to refresh the facts" : "Website removed");
          }}
        >
          <Field label="Website" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" className="flex-1" autoComplete="off" />
          <Button type="submit" size="md" loading={busy === "website"}>
            Save
          </Button>
        </form>

        <div className="flex items-end gap-2">
          <Select label="Language of the report and emails" name="locale" defaultValue={p.locale} className="flex-1" options={[{ value: "fr", label: "Français" }, { value: "en", label: "English" }]} onChange={(e) => void patch("locale", { locale: e.target.value }, `Locale set to ${e.target.value}`)} />
        </div>

        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void patch("email", { contact_email_override: emailOverride.trim() || null }, emailOverride.trim() ? "Email override saved" : "Email override cleared");
          }}
        >
          <Field label="Email override" name="contact_email_override" value={emailOverride} onChange={(e) => setEmailOverride(e.target.value)} placeholder="contact@example.fr" hint="One business address; a webmail address (gmail, orange.fr…) is refused here and again at send time" className="flex-1" autoComplete="off" />
          <Button type="submit" loading={busy === "email"}>
            Save
          </Button>
        </form>

        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void patch("phone", { contact_phone_override: phoneOverride.trim() || null }, phoneOverride.trim() ? "Phone override saved" : "Phone override cleared");
          }}
        >
          <Field label="Phone override" name="contact_phone_override" value={phoneOverride} onChange={(e) => setPhoneOverride(e.target.value)} placeholder="+33 5 61 …" className="flex-1" autoComplete="off" />
          <Button type="submit" loading={busy === "phone"}>
            Save
          </Button>
        </form>

        <div className="flex items-end gap-2">
          <Select label="Fit" name="fit" defaultValue={p.fit} className="flex-1" options={FIT_OPTIONS} onChange={(e) => void patch("fit", { fit: e.target.value, not_fit_reason: notFitReason.trim() || null }, `Fit: ${e.target.value}`)} />
          <Field label="Reason (when not a fit)" name="not_fit_reason" value={notFitReason} onChange={(e) => setNotFitReason(e.target.value)} onBlur={() => (p.fit === "not_fit" && notFitReason.trim() !== (p.notFitReason ?? "") ? void patch("fit", { fit: "not_fit", not_fit_reason: notFitReason.trim() || null }, "Reason saved") : undefined)} className="flex-1" autoComplete="off" />
        </div>

        {p.forbidsExtraction ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void patch("reason", { forbids_override_reason: reason.trim() || null }, reason.trim() ? "Override reason saved (noted in the timeline)" : "Override removed");
            }}
          >
            <Field label="Extraction override reason" name="forbids_override_reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. owner asked for the audit by phone on …" hint="Recorded as a note; sending stays refused without it" className="flex-1" autoComplete="off" />
            <Button type="submit" loading={busy === "reason"}>
              Save
            </Button>
          </form>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        {p.personalWipedAt ? (
          <Button size="sm" onClick={() => void patch("recollect", { recollect: true }, "Contact fields may be collected again — new 30-day notice deadline")} loading={busy === "recollect"}>
            Recollect contact details
          </Button>
        ) : null}
        <span className="flex-1" />
        {p.deletedAt ? (
          <span className="text-xs text-fg-faint">Removed {p.deletedAt}</span>
        ) : (
          <ConfirmButton
            label="Not this business"
            confirmLabel="Remove from every view?"
            size="sm"
            loading={busy === "not_this"}
            onConfirm={async () => {
              if (await patch("not_this", { not_this_business: true }, "Removed — it will not be listed or contacted")) router.push("/admin/prospects?view=all");
            }}
          />
        )}
      </div>
    </section>
  );
}
