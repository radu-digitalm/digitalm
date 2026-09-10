// UK Companies House (advanced company search, OGL v3). Contract §6
// "companies_house": only with COMPANIES_HOUSE_KEY and for GB areas; one GET
// per SIC code, ≤ 2 req/s, cached 24 h. Registered offices only — no
// coordinates, `registeredOfficeOnly = true` so the results table can say
// "registered office, not the shop"; dedupe keeps OSM coordinates as geo truth.
import { DAY_MS, cached } from "@/lib/crm/apiCache";
import { countApiUsage } from "@/lib/crm/apiUsage";
import { HOSTS, HttpError, fetchJson, spaced } from "@/lib/crm/http";
import type { Area, Business, Category } from "@/lib/crm/types";
import type { AdapterResult, RichAdapter } from "./index";

const GAP_MS = 500; // 2 req/s
const PAGE_SIZE = 100;
const REQUEST_RESERVE_MS = 2_000;

export const COMPANY_NUMBER_RE = /^[A-Z0-9]{8}$/i;

type ChItem = {
  company_name?: string;
  company_number?: string;
  company_type?: string;
  company_status?: string;
  registered_office_address?: { address_line_1?: string; locality?: string; postal_code?: string };
  sic_codes?: string[];
};

export function companiesHouseKey(): string | null {
  const k = (process.env.COMPANIES_HOUSE_KEY ?? "").trim();
  return k ? k : null;
}

function authHeader(key: string): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` };
}

function slimItem(x: unknown): ChItem | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : undefined);
  const ro = o.registered_office_address && typeof o.registered_office_address === "object" ? (o.registered_office_address as Record<string, unknown>) : {};
  const rstr = (k: string) => (typeof ro[k] === "string" ? (ro[k] as string) : undefined);
  return {
    company_name: str("company_name"),
    company_number: str("company_number"),
    company_type: str("company_type"),
    company_status: str("company_status"),
    registered_office_address: { address_line_1: rstr("address_line_1"), locality: rstr("locality"), postal_code: rstr("postal_code") },
    sic_codes: Array.isArray(o.sic_codes) ? o.sic_codes.filter((s): s is string => typeof s === "string") : [],
  };
}

function tidy(s: string | undefined, max = 120): string | undefined {
  const t = s?.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
}

export function mapCompany(c: ChItem): Business | null {
  const name = tidy(c.company_name);
  const number = tidy(c.company_number, 12)?.toUpperCase();
  if (!name || !number) return null;
  const ro = c.registered_office_address ?? {};
  return {
    source: "companies_house",
    sourceId: number,
    sourceUrl: `https://find-and-update.company-information.service.gov.uk/company/${number}`,
    name,
    legalName: name,
    addressLine: tidy(ro.address_line_1, 200),
    postcode: tidy(ro.postal_code, 12),
    city: tidy(ro.locality, 80),
    countryCode: "GB",
    geoSource: "none",
    registerId: number,
    legalForm: tidy(c.company_type, 40),
    soleTrader: false,
    active: c.company_status === "active",
    registeredOfficeOnly: true,
  };
}

async function fetchSic(sic: string, locality: string, key: string, signal: AbortSignal): Promise<ChItem[]> {
  const qs = new URLSearchParams({ sic_codes: sic, location: locality, company_status: "active", size: String(PAGE_SIZE), start_index: "0" });
  const url = `${HOSTS.companiesHouse}/advanced-search/companies?${qs.toString()}`;
  const { value, hit } = await cached<{ items: ChItem[] }>("companies_house", { url }, DAY_MS, async () => {
    const res = await spaced("companies_house", GAP_MS, () => fetchJson<{ items?: unknown[] }>(url, { headers: authHeader(key), timeoutMs: 15_000, signal }));
    return { items: (res.data.items ?? []).map(slimItem).filter((x): x is ChItem => x !== null) };
  });
  if (!hit) countApiUsage("companies_house");
  return value.items;
}

export async function searchCompaniesHouse(area: Area, category: Category, opts: { budgetMs: number; signal: AbortSignal }): Promise<AdapterResult> {
  const deadline = Date.now() + opts.budgetMs;
  const rows: Business[] = [];
  const notes: string[] = [];
  let partial = false;
  const key = companiesHouseKey();
  if (!key) return { rows, partial, notes: ["Companies House is off (no COMPANIES_HOUSE_KEY)"] };
  if (category.sic.length === 0) return { rows, partial, notes: ["Companies House: no SIC code for this trade"] };
  const locality = (area.admin?.locality ?? area.label.split(",")[0] ?? "").trim();
  if (!locality) return { rows, partial, notes: ["Companies House: no locality to filter on"] };
  const seen = new Set<string>();
  for (const sic of category.sic) {
    if (opts.signal.aborted || Date.now() + REQUEST_RESERVE_MS > deadline) {
      partial = true;
      notes.push("Companies House: stopped early (time budget)");
      break;
    }
    try {
      const items = await fetchSic(sic, locality, key, opts.signal);
      for (const it of items) {
        const b = mapCompany(it);
        if (b && !seen.has(b.sourceId)) {
          seen.add(b.sourceId);
          rows.push(b);
        }
      }
      if (items.length >= PAGE_SIZE) notes.push(`Companies House: SIC ${sic} returned the first ${PAGE_SIZE} only`);
    } catch (e) {
      partial = true;
      const code = e instanceof HttpError ? e.code : "error";
      notes.push(`Companies House: request failed (${code})`);
      if (code === "http_401" || code === "http_403") break;
    }
  }
  if (rows.length > 0) notes.push(`Companies House: ${rows.length} registered office${rows.length === 1 ? "" : "s"} matched on "${locality}" — addresses are registered offices, not shops, and may fall outside the map area`);
  return { rows, partial, notes };
}

export const companiesHouseAdapter: RichAdapter = {
  id: "companies_house",
  enabled: () => companiesHouseKey() !== null,
  supports: (area) => area.countryCode === "GB",
  searchRich: searchCompaniesHouse,
  async search(area, category, opts) {
    return (await searchCompaniesHouse(area, category, opts)).rows;
  },
};

export type CompanyCheck = { found: boolean; active: boolean; legalForm: string | null };

/** Live (uncached) status of one company number: GET /company/{number}. */
export async function recheckCompany(number: string): Promise<CompanyCheck> {
  const key = companiesHouseKey();
  if (!key) throw new HttpError("companies_house_off", 0);
  const n = number.trim().toUpperCase();
  if (!COMPANY_NUMBER_RE.test(n)) throw new HttpError("bad_company_number", 400);
  try {
    const res = await spaced("companies_house", GAP_MS, () =>
      fetchJson<{ company_status?: string; type?: string }>(`${HOSTS.companiesHouse}/company/${encodeURIComponent(n)}`, { headers: authHeader(key), timeoutMs: 15_000 }),
    );
    countApiUsage("companies_house");
    return { found: true, active: res.data.company_status === "active", legalForm: typeof res.data.type === "string" ? res.data.type : null };
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return { found: false, active: false, legalForm: null };
    throw e;
  }
}
