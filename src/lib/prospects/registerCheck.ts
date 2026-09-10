// Live register re-check (contract §6 "Views" → recheckRegister). Outreach
// calls it before every send and call; the RegisterBlock has a button for it.
// FR SIRETs go to the API Recherche d'entreprises, GB company numbers to
// Companies House. Updates register_status, diffusion, register_checked_at,
// legal_form and — for companies whose nature_juridique is not 1000 —
// sole_trader = 0 (the notice deadline itself stays). A switch to partial
// diffusion wipes the personal contact fields at once. An identifier the
// register no longer knows is recorded as `ceased` (READY_WHERE and
// CALL_WHERE exclude it), never as `unknown`, which would read as unchecked.
import { HttpError } from "@/lib/crm/http";
import { enquiriesDb } from "@/lib/enquiries";
import { COMPANY_NUMBER_RE, companiesHouseKey, recheckCompany } from "@/lib/discover/companiesHouse";
import { SIRET_RE, recheckSiret } from "@/lib/discover/frRegister";
import type { Prospect } from "@/lib/crm/types";
import { getProspect, wipePersonal, type ProspectRecord } from "./store";

export type RegisterCheck = {
  checked: boolean;
  registry: "fr_register" | "companies_house" | null;
  registerStatus: Prospect["registerStatus"];
  diffusion: Prospect["diffusion"];
  soleTrader: boolean | null;
  wiped: boolean;
  checkedAt: string | null;
  note: string | null;
};

function registryFor(p: Pick<Prospect, "source" | "registerId" | "country">): "fr_register" | "companies_house" | null {
  if (!p.registerId) return null;
  if (p.source === "fr_register" || (p.country === "FR" && SIRET_RE.test(p.registerId))) return "fr_register";
  if (p.source === "companies_house" || (p.country === "GB" && COMPANY_NUMBER_RE.test(p.registerId))) return "companies_house";
  return null;
}

/**
 * Re-check one prospect against its register. Never throws on "nothing to
 * check" (returns `checked: false` with a note); network failures throw
 * HttpError so callers can refuse rather than guess.
 */
export async function recheckRegister(input: ProspectRecord | Prospect | number): Promise<RegisterCheck> {
  const p = typeof input === "number" ? getProspect(input) : input;
  const unchecked = (note: string): RegisterCheck => ({
    checked: false,
    registry: null,
    registerStatus: p?.registerStatus ?? "unknown",
    diffusion: p?.diffusion ?? "na",
    soleTrader: p?.soleTrader ?? null,
    wiped: false,
    checkedAt: p?.registerCheckedAt ?? null,
    note,
  });
  if (!p) return unchecked("Prospect not found");
  const registry = registryFor(p);
  if (!registry || !p.registerId) return unchecked("No register identifier on this prospect");

  let registerStatus: Prospect["registerStatus"] = "unknown";
  let diffusion: Prospect["diffusion"] = p.diffusion;
  let soleTrader: boolean | null = p.soleTrader;
  let legalForm: string | null = p.legalForm;
  let note: string | null = null;

  if (registry === "fr_register") {
    const r = await recheckSiret(p.registerId);
    if (!r.found) {
      // A SIRET that has left the register is a hard refusal (plan step 6):
      // treated as ceased, never as "not checked yet".
      registerStatus = "ceased";
      note = "SIRET no longer in the register — treated as ceased";
    } else {
      registerStatus = r.active ? "active" : "ceased";
      diffusion = r.diffusion;
      if (r.soleTrader !== null) soleTrader = r.soleTrader;
      if (r.legalForm) legalForm = r.legalForm;
    }
  } else {
    if (!companiesHouseKey()) throw new HttpError("companies_house_off", 0, "Companies House key not configured");
    const r = await recheckCompany(p.registerId);
    if (!r.found) {
      registerStatus = "ceased";
      note = "Company number no longer at Companies House — treated as ceased";
    } else {
      registerStatus = r.active ? "active" : "ceased";
      soleTrader = false;
      if (r.legalForm) legalForm = r.legalForm;
    }
  }

  const db = enquiriesDb();
  db.prepare(
    "UPDATE prospects SET register_status = ?, diffusion = ?, register_checked_at = datetime('now'), sole_trader = ?, legal_form = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(registerStatus, diffusion, soleTrader === null ? null : soleTrader ? 1 : 0, legalForm, p.id);

  let wiped = false;
  if (diffusion === "partial" && p.diffusion !== "partial") {
    wipePersonal(p, { keepGenericEmail: false });
    wiped = true;
    note = "Register switched to partial diffusion — personal contact fields wiped";
  }
  const checkedAt = (db.prepare("SELECT register_checked_at AS t FROM prospects WHERE id = ?").get(p.id) as { t: string | null } | undefined)?.t ?? null;
  return { checked: true, registry, registerStatus, diffusion, soleTrader, wiped, checkedAt, note };
}
