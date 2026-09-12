"use client";

// Identity & register facts of a prospect (docs/finder-ux-spec.md §6.4):
// where the row came from, the register in plain sentences, legal form in
// words, the notice state in dates, and a live "Re-check the register"
// button. Ends with the ODbL / Licence Ouverte / OGL attribution.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Prospect } from "@/lib/crm/types";
import { adminFetch } from "./adminFetch";
import { Button } from "./Button";
import { ExtLink } from "./ExtLink";
import { localDate, localDateTime } from "./format";
import { KeyValue, type KeyValueItem } from "./KeyValue";
import { daysUntil } from "./ProspectBadges";
import { useToast } from "./Toast";
import { ATTRIBUTION_TEXT, CARD_TEXT, PROSPECT_TEXT, SOURCE_WORDS, fill, legalFormWords } from "./wording";

type RegisterCheck = { checked: boolean; registerStatus: string; diffusion: string; wiped: boolean; note: string | null };

function registerSentence(p: Prospect): React.ReactNode {
  if (!p.registerId) {
    if (p.country === "GB") return <p className="text-fg-muted">{CARD_TEXT.notMatched}</p>;
    return <p className="text-fg-muted">{CARD_TEXT.notMatched}</p>;
  }
  if (p.country === "GB" || p.source === "companies_house") {
    return <p>{fill(CARD_TEXT.companiesHouse, { number: p.registerId, status: p.registerStatus === "ceased" ? CARD_TEXT.closed : p.registerStatus === "active" ? CARD_TEXT.active : "status unknown" })}</p>;
  }
  const form = p.soleTrader === true ? "sole trader" : p.legalForm ? legalFormWords(p.legalForm) : p.soleTrader === false ? "company" : "legal form unknown";
  const state = p.registerStatus === "ceased" ? CARD_TEXT.closed : p.registerStatus === "active" ? CARD_TEXT.active : "status unknown";
  const sentence = p.legalName && p.legalName !== p.name ? fill(CARD_TEXT.listedRegister, { legalName: p.legalName, siret: p.registerId, form, state }) : fill(CARD_TEXT.listedRegisterShort, { siret: p.registerId, form, state });
  return (
    <>
      <p>{sentence}</p>
      {p.diffusion === "partial" ? <p className="text-amber-300">{CARD_TEXT.notListedPublicly}</p> : p.diffusion === "full" ? <p className="text-fg-muted">{CARD_TEXT.publiclyListed}</p> : null}
    </>
  );
}

export function RegisterBlock({ prospect: p }: { prospect: Prospect & { brand?: string | null } }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const canRecheck = !!p.registerId && (p.source === "fr_register" || p.source === "companies_house" || p.country === "FR" || p.country === "GB");

  async function recheck() {
    setBusy(true);
    try {
      const r = await adminFetch<{ registerCheck: RegisterCheck | null }>(`/api/admin/prospects/${p.id}`, { recheck_register: true });
      const c = r.registerCheck;
      if (!c || !c.checked) toast.push(c?.note ?? "Nothing to check", "info");
      else {
        const listing = c.diffusion === "partial" ? "not listed publicly" : "publicly listed";
        toast.push(`${fill(PROSPECT_TEXT.registerToast, { state: c.registerStatus === "ceased" ? "closed" : c.registerStatus, listing })}${c.wiped ? PROSPECT_TEXT.registerWiped : ""}`, c.registerStatus === "active" && !c.wiped ? "good" : "bad");
      }
      router.refresh();
    } catch {
      toast.push(PROSPECT_TEXT.registerFailed, "bad");
    } finally {
      setBusy(false);
    }
  }

  const deadlineDays = daysUntil(p.noticeDeadlineAt);
  const registerUrl = p.registerId && p.country === "FR" ? `https://annuaire-entreprises.data.gouv.fr/etablissement/${p.registerId}` : p.registerId && p.country === "GB" ? `https://find-and-update.company-information.service.gov.uk/company/${p.registerId}` : null;
  const sourceWord = SOURCE_WORDS[p.source] ?? p.source;

  const items: KeyValueItem[] = [
    {
      label: "Came from",
      value: (
        <span>
          {sourceWord}
          {p.sourceUrl ? (
            <>
              {" · "}
              <ExtLink href={p.sourceUrl}>{p.source === "osm" ? CARD_TEXT.openOsm : "open the source"}</ExtLink>
            </>
          ) : null}
        </span>
      ),
    },
    { label: "Trading name", value: p.enseigne && p.enseigne !== p.name ? p.enseigne : null },
    { label: "Legal name", value: p.legalName && p.legalName !== p.name ? p.legalName : null },
    { label: "Brand", value: p.brand ? fill(CARD_TEXT.chain, { brand: p.brand }) : null },
    { label: "Register checked", value: p.registerCheckedAt ? localDateTime(p.registerCheckedAt) : null, muted: true },
    { label: "Saved", value: localDateTime(p.savedAt), muted: true },
    {
      label: "Notice",
      value: p.noticeSentAt
        ? fill(PROSPECT_TEXT.noticeSent, { date: localDate(p.noticeSentAt) })
        : p.personalWipedAt
          ? fill(PROSPECT_TEXT.wiped, { date: localDate(p.personalWipedAt) })
          : deadlineDays === null
            ? null
            : deadlineDays > 0
              ? <span className={deadlineDays <= 5 ? "text-amber-300" : ""}>{fill(PROSPECT_TEXT.noticeNotSent, { date: localDate(p.noticeDeadlineAt), days: deadlineDays })}</span>
              : <span className="text-accent-soft">{fill(PROSPECT_TEXT.noticeOverdue, { date: localDate(p.noticeDeadlineAt) })}</span>,
    },
  ];

  return (
    <section className="card p-5" aria-label={PROSPECT_TEXT.identityTitle}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[20px] text-fg-heading">{PROSPECT_TEXT.identityTitle}</h2>
        {canRecheck ? (
          <Button size="sm" onClick={recheck} loading={busy}>
            {PROSPECT_TEXT.recheck}
          </Button>
        ) : null}
      </div>
      <div className="space-y-1 text-[16px] text-fg" data-testid="register-sentences">
        {registerSentence(p)}
        {registerUrl ? (
          <p>
            <ExtLink href={registerUrl}>{p.country === "GB" ? "Open at Companies House" : CARD_TEXT.openRegister}</ExtLink>
          </p>
        ) : null}
      </div>
      <KeyValue items={items} className="mt-4" />
      <p className="mt-4 text-[15px] text-fg-muted">{ATTRIBUTION_TEXT}</p>
    </section>
  );
}
