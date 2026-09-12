"use client";

// Website & contact block of the prospect page (docs/finder-ux-spec.md §6.4):
// the editable website, what the audit found (email kind in words, phone with
// its origin, socials, site builder), the overrides with plain labels, the
// language, Fit as three buttons, the "Not this business" confirm and the
// override reason when the site forbids prospecting. Every write posts to
// POST /api/admin/prospects/[id] and refreshes the page (same requests and
// keys as before — wording and layout only).
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Prospect } from "@/lib/crm/types";
import { adminFetch } from "./adminFetch";
import { Button } from "./Button";
import { ConfirmButton } from "./ConfirmButton";
import { ExtLink } from "./ExtLink";
import { Field } from "./Field";
import { localDateTime } from "./format";
import { KeyValue, type KeyValueItem } from "./KeyValue";
import { Select } from "./Select";
import { useToast } from "./Toast";
import { CARD_TEXT, PROSPECT_TEXT } from "./wording";

const ERROR_TEXT: Record<string, string> = {
  bad_email: "One valid address only (no lists, no display names).",
  bad_phone: "That phone number does not look right.",
  bad_website: "That does not look like a website address.",
  bad_reason: "Give a reason of at least three characters.",
};

const SOCIAL_WORD: Record<string, string> = { facebook: CARD_TEXT.facebook, instagram: CARD_TEXT.instagram, linkedin: CARD_TEXT.linkedin, twitter: CARD_TEXT.twitter, x: CARD_TEXT.twitter };

const FIT_OPTIONS: { value: Prospect["fit"]; label: string }[] = [
  { value: "unknown", label: PROSPECT_TEXT.fitUnknown },
  { value: "fit", label: PROSPECT_TEXT.fitYes },
  { value: "not_fit", label: PROSPECT_TEXT.fitNo },
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
      toast.push(ERROR_TEXT[code] ?? "That change could not be saved. Try again.", "bad");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const socials = p.websiteSocials ? Object.entries(p.websiteSocials).filter(([, v]) => !!v) : [];
  const emailKind = p.websiteEmailKind ? PROSPECT_TEXT.emailKind[p.websiteEmailKind] ?? p.websiteEmailKind : null;
  const found: KeyValueItem[] = [
    {
      label: CARD_TEXT.email,
      value: p.websiteEmail ? (
        <span className="break-all">
          <a href={`mailto:${p.websiteEmail}`} className="link-accent">
            {p.websiteEmail}
          </a>
          {emailKind ? <span className="text-fg-muted"> — {emailKind}</span> : null}
          {p.websiteEmailPage ? (
            <>
              {" · "}
              <ExtLink href={p.websiteEmailPage}>page</ExtLink>
            </>
          ) : null}
        </span>
      ) : p.sourceEmail ? (
        <span className="break-all">
          <a href={`mailto:${p.sourceEmail}`} className="link-accent">
            {p.sourceEmail}
          </a>
          <span className="text-fg-muted"> {PROSPECT_TEXT.fromSource}</span>
        </span>
      ) : p.forbidsExtraction ? (
        <span className="text-fg-muted">not stored — the site forbids prospecting</span>
      ) : p.personalWipedAt ? (
        <span className="text-fg-muted">wiped after the notice period</span>
      ) : null,
    },
    {
      label: CARD_TEXT.phone,
      value:
        p.websitePhone || p.sourcePhone ? (
          <span className="whitespace-nowrap">
            <a href={`tel:${(p.websitePhone ?? p.sourcePhone ?? "").replace(/[^\d+]/g, "")}`} className="link-accent">
              {p.websitePhone ?? p.sourcePhone}
            </a>
            <span className="text-fg-muted"> {p.websitePhone ? PROSPECT_TEXT.fromSite : PROSPECT_TEXT.fromSource}</span>
          </span>
        ) : null,
    },
    {
      label: "Socials",
      value:
        socials.length > 0 ? (
          <span className="inline-flex flex-wrap gap-x-3 gap-y-1">
            {socials.map(([k, v]) => (
              <ExtLink key={k} href={v}>
                {SOCIAL_WORD[k.toLowerCase()] ?? k}
              </ExtLink>
            ))}
          </span>
        ) : null,
    },
    { label: "Site builder", value: p.websiteCms },
    { label: "Website score", value: p.latestAuditId && p.latestScore !== null ? `${p.latestScore} · ${p.latestGrade ?? ""}`.trim() : null },
    {
      label: "Prospecting",
      value: p.forbidsExtraction ? (
        <span className={p.forbidsOverrideReason ? "text-amber-300" : "text-accent-soft"}>
          {p.forbidsOverrideReason ? `The site's terms forbid it — allowed anyway: ${p.forbidsOverrideReason}` : "The site's terms forbid it — nothing is sent without a reason on file"}
        </span>
      ) : null,
    },
    { label: "Email to use instead", value: p.contactEmailOverride },
    { label: "Phone to use instead", value: p.contactPhoneOverride },
  ];

  return (
    <section className="card space-y-5 p-5" aria-label={PROSPECT_TEXT.websiteTitle}>
      <h2 className="text-[19px] text-fg-heading">{PROSPECT_TEXT.websiteTitle}</h2>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void patch("website", { website: website.trim() || null }, website.trim() ? "Website saved — run an audit to refresh the facts" : "Website removed");
        }}
      >
        <Field label={CARD_TEXT.website} name="website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" className="min-w-[14rem] flex-1" autoComplete="off" hint={p.website ? undefined : "Add one to enable the audit"} />
        <Button type="submit" loading={busy === "website"}>
          Save
        </Button>
        {p.website ? (
          <span className="pb-2 text-[15px]">
            <ExtLink href={p.website} />
          </span>
        ) : null}
      </form>

      <div>
        <h3 className="mb-2 text-[13px] font-medium uppercase tracking-wide text-fg-muted">{PROSPECT_TEXT.whatAuditFound}</h3>
        <KeyValue items={found} />
        {found.every((f) => f.value === null || f.value === undefined || f.value === "") ? <p className="text-[15px] text-fg-muted">{p.latestAuditId ? "The audit found no contact details on the site." : PROSPECT_TEXT.notAudited}</p> : null}
      </div>

      <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void patch("email", { contact_email_override: emailOverride.trim() || null }, emailOverride.trim() ? "Email saved" : "Email cleared");
          }}
        >
          <Field label={PROSPECT_TEXT.emailOverride} name="contact_email_override" value={emailOverride} onChange={(e) => setEmailOverride(e.target.value)} placeholder="contact@example.fr" hint="One business address — a webmail address is refused here and again at send time" className="flex-1" autoComplete="off" />
          <Button type="submit" loading={busy === "email"}>
            Save
          </Button>
        </form>

        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void patch("phone", { contact_phone_override: phoneOverride.trim() || null }, phoneOverride.trim() ? "Phone saved" : "Phone cleared");
          }}
        >
          <Field label={PROSPECT_TEXT.phoneOverride} name="contact_phone_override" value={phoneOverride} onChange={(e) => setPhoneOverride(e.target.value)} placeholder="+33 5 61 …" className="flex-1" autoComplete="off" />
          <Button type="submit" loading={busy === "phone"}>
            Save
          </Button>
        </form>

        <Select label={PROSPECT_TEXT.language} name="locale" defaultValue={p.locale} options={[{ value: "fr", label: "Français" }, { value: "en", label: "English" }]} onChange={(e) => void patch("locale", { locale: e.target.value }, e.target.value === "fr" ? "Report and emails in French" : "Report and emails in English")} />

        <div>
          <p className="mb-1.5 block text-[15px] text-fg-muted">{PROSPECT_TEXT.fit}</p>
          <div className="flex overflow-hidden rounded-lg border border-line" role="group" aria-label={PROSPECT_TEXT.fit}>
            {FIT_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={p.fit === o.value}
                disabled={busy === "fit"}
                onClick={() => void patch("fit", { fit: o.value, not_fit_reason: o.value === "not_fit" ? notFitReason.trim() || null : null }, `Fit: ${o.label.toLowerCase()}`)}
                className={`flex-1 px-3 py-2 text-[15px] ${p.fit === o.value ? "bg-surface-3 text-fg-heading" : "text-fg-muted hover:bg-surface-2 hover:text-fg-heading"}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {p.fit === "not_fit" ? (
            <Field
              label={PROSPECT_TEXT.fitReason}
              name="not_fit_reason"
              value={notFitReason}
              onChange={(e) => setNotFitReason(e.target.value)}
              onBlur={() => (notFitReason.trim() !== (p.notFitReason ?? "") ? void patch("fit", { fit: "not_fit", not_fit_reason: notFitReason.trim() || null }, "Reason saved") : undefined)}
              className="mt-2"
              autoComplete="off"
            />
          ) : null}
        </div>

        {p.forbidsExtraction ? (
          <form
            className="flex items-end gap-2 sm:col-span-2"
            onSubmit={(e) => {
              e.preventDefault();
              void patch("reason", { forbids_override_reason: reason.trim() || null }, reason.trim() ? "Reason saved (noted in the timeline)" : "Reason removed");
            }}
          >
            <Field label={PROSPECT_TEXT.overrideReason} name="forbids_override_reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. the owner asked for the audit by phone on …" hint="Recorded as a note; sending stays refused without it" className="flex-1" autoComplete="off" />
            <Button type="submit" loading={busy === "reason"}>
              Save
            </Button>
          </form>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        {p.personalWipedAt ? (
          <Button size="sm" onClick={() => void patch("recollect", { recollect: true }, "Contact details may be collected again — new 30-day notice deadline")} loading={busy === "recollect"}>
            Collect contact details again
          </Button>
        ) : null}
        <span className="flex-1" />
        {p.deletedAt ? (
          <span className="text-[14px] text-fg-muted">Removed {localDateTime(p.deletedAt)}</span>
        ) : (
          <ConfirmButton
            label={PROSPECT_TEXT.notThisBusiness}
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
