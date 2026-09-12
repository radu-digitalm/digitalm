// Shared TypeScript contracts for the lead-gen CRM (docs/leadgen-build-spec.md §3).
// Published on day 0 so every module builds against the same shapes. Types only,
// plus the two small constants the contract pins here (CHECK_WEIGHTS, googleAdapter).
// No enums, namespaces or parameter properties: this file is loaded by node --test
// in strip-only mode through the modules it types.
import type { Attribution } from "@/lib/attribution";

export type { Attribution };

export type LeadKind = "diagnostic" | "booking" | "contact" | "chat" | "messenger" | "outreach" | "manual";
export type LeadStage = "new" | "contacted" | "replied" | "meeting" | "proposal" | "won" | "lost" | "no_response" | "stop";
export interface Lead {
  id: number;
  reference: string;
  kind: LeadKind;
  stage: LeadStage;
  name: string | null;
  company: string | null;
  email: string | null;
  emailHash: string | null;
  phone: string | null;
  phoneHash: string | null;
  locale: "fr" | "en";
  country: string;
  sourceLabel: string | null;
  sourceUtm: string | null;
  attribution: Attribution | null;
  enquiryReference: string | null;
  prospectId: number | null;
  legalBasis: "request" | "legitimate_interest";
  dataSource: "form" | "chat" | "messenger" | "booking" | "register" | "osm" | "companies_house" | "website" | "manual";
  noticeSentAt: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
  note: string | null;
  lastActivityAt: string;
  repliedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  createdAt: string;
  updatedAt: string;
}
export type ActivityKind = "note" | "email_out" | "email_in" | "call" | "report_view" | "optout" | "stage_change" | "lead_created" | "merged" | "send_refused" | "audit_done" | "notice_sent" | "manual_send" | "bounce" | "recollect";
export interface Activity {
  id: number;
  leadId: number | null;
  prospectId: number | null;
  kind: ActivityKind;
  channel: "email" | "phone" | "web" | "telegram" | "system" | null;
  summary: string;
  payload: Record<string, unknown> | null;
  actor: "admin" | "system" | "prospect";
  createdAt: string;
}
export interface Prospect {
  id: number;
  reference: string;
  leadId: number | null;
  name: string;
  legalName: string | null;
  enseigne: string | null;
  nameKey: string;
  tradeKey: string | null;
  country: string;
  addressLine: string | null;
  postcode: string | null;
  city: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  geoSource: "source" | "centre" | "manual" | null;
  source: "osm" | "fr_register" | "companies_house" | "google" | "manual";
  sourceId: string | null;
  sourceUrl: string | null;
  registerId: string | null;
  registerStatus: "active" | "ceased" | "unknown";
  registerCheckedAt: string | null;
  diffusion: "full" | "partial" | "na";
  legalForm: string | null;
  soleTrader: boolean | null;
  website: string | null;
  websiteSource: string | null;
  domainKey: string | null;
  websiteEmail: string | null;
  websiteEmailKind: EmailKind | null;
  websiteEmailPage: string | null;
  websitePhone: string | null;
  websiteSocials: Record<string, string> | null;
  websiteCms: string | null;
  sourcePhone: string | null;
  sourceEmail: string | null;
  forbidsExtraction: boolean;
  forbidsOverrideReason: string | null;
  googlePlaceId: string | null;
  googleListing: "unverified" | "found" | "not_found";
  googleConfirmedAt: string | null;
  locale: "fr" | "en";
  localeOverridden: boolean;
  latestAuditId: number | null;
  latestScore: number | null;
  latestGrade: "A" | "B" | "C" | null;
  fit: "unknown" | "fit" | "not_fit";
  notFitReason: string | null;
  contactEmailOverride: string | null;
  contactPhoneOverride: string | null;
  noticeSentAt: string | null;
  noticeDeadlineAt: string | null;
  personalWipedAt: string | null;
  lastEmailedAt: string | null;
  lastCalledAt: string | null;
  optedOutAt: string | null;
  tpsCheckedAt: string | null;
  searchId: number | null;
  savedAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
export interface Audit {
  id: number;
  reference: string;
  prospectId: number;
  status: "queued" | "running" | "done" | "failed";
  locale: "fr" | "en";
  website: string | null;
  checks: AuditChecks | null;
  score: number | null;
  grade: "A" | "B" | "C" | null;
  flags: Flag[];
  fits: FitSuggestion[];
  top: CheckKey[];
  pagespeed: PsiSummary | null;
  crawl: { url: string; status: number; bytes: number }[];
  reportToken: string;
  reportExpiresAt: string | null;
  reportFirstViewedAt: string | null;
  reportViews: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface Area {
  label: string;
  countryCode: string;
  center: { lat: number; lng: number };
  bbox: [south: number, west: number, north: number, east: number];
  admin?: { postcodes?: string[]; inseeCode?: string; departement?: string; locality?: string };
  provider: "geo_gouv" | "nominatim";
}
export interface Category {
  key: string;
  label: { fr: string; en: string };
  osm: { k: string; v: string }[];
  naf: string[];
  sic: string[];
  custom?: boolean;
} // key "custom:<slug>" for free-text trades
export type DiscoverySource = "osm" | "fr_register" | "companies_house" | "google";
export interface Business {
  source: DiscoverySource;
  sourceId: string;
  sourceUrl: string;
  sources?: DiscoverySource[];
  name: string;
  legalName?: string;
  enseigne?: string;
  addressLine?: string;
  postcode?: string;
  city?: string;
  region?: string;
  countryCode: string;
  lat?: number;
  lng?: number;
  geoSource: "source" | "centre" | "none";
  website?: string;
  phone?: string;
  email?: string;
  registerId?: string;
  legalForm?: string;
  soleTrader?: boolean;
  diffusion?: "full" | "partial";
  active?: boolean;
  brand?: string;
  registeredOfficeOnly?: boolean;
  tags?: Record<string, string>;
  alreadySaved?: { prospectId: number; reference: string };
}
export interface DiscoveryAdapter {
  id: DiscoverySource;
  enabled(): boolean;
  supports(area: Area): boolean;
  search(area: Area, category: Category, opts: { budgetMs: number; signal: AbortSignal }): Promise<Business[]>;
}
export const googleAdapter: DiscoveryAdapter = {
  id: "google",
  enabled: () => process.env.GOOGLE_PLACES === "on" && !!process.env.GOOGLE_PLACES_KEY,
  supports: () => true,
  async search() {
    return [];
  },
};

export type EmailKind = "generic" | "named" | "sole_trader" | "webmail" | "unknown";
export type CheckKey = "reachable" | "https" | "speed" | "seo_basics" | "contact" | "socials" | "schema" | "ai_ready" | "google_listing" | "housekeeping";
export const CHECK_WEIGHTS: Record<CheckKey, number> = {
  reachable: 10,
  https: 10,
  speed: 15,
  seo_basics: 10,
  contact: 10,
  socials: 5,
  schema: 10,
  ai_ready: 15,
  google_listing: 10,
  housekeeping: 5,
};
export type CheckStatus = "pass" | "partial" | "fail" | "not_measured";
export interface CheckResult {
  key: CheckKey;
  status: CheckStatus;
  points: number;
  measured: boolean;
  details: Record<string, string | number | boolean | null>;
}
export type AuditChecks = Record<CheckKey, CheckResult>;
export type Flag = "no-site" | "no-ssl" | "cert-expiring" | "slow-mobile" | "not-mobile" | "no-contact" | "no-booking" | "no-socials" | "no-schema" | "blocks-ai" | "no-chat" | "no-gbp" | "stale-site" | "mixed-content" | "forbids-extraction";
export interface FitSuggestion {
  pkg: "WEB" | "AGENT" | "SEC" | "AUTO";
  flags: Flag[];
}
export interface Score {
  score: number;
  grade: "A" | "B" | "C";
  earned: number;
  measured: number;
  flags: Flag[];
  fits: FitSuggestion[];
  top: CheckKey[];
}
export interface CrawledPage {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string | null;
  headers: Record<string, string>;
  text: string;
  fetchedAt: string;
} // memory only
export interface PsiSummary {
  performance: number | null;
  seo: number | null;
  lcpMs: number | null;
  cls: number | null;
  viewport: boolean | null;
  title: boolean | null;
  description: boolean | null;
  fetchedAt: string;
  timedOut: boolean;
}

export type JobKind = "audit" | "noop" | "send"; // "send" reserved, no handler in v1
export interface Job {
  id: number;
  kind: JobKind;
  payload: Record<string, unknown>;
  dedupeKey: string | null;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  priority: number;
  runAfter: string;
  attempts: number;
  maxAttempts: number;
  claimedAt: string | null;
  claimToken: string | null;
  lastError: string | null;
  result: unknown;
  createdAt: string;
  finishedAt: string | null;
}
export type JobHandler = (job: Job, ctx: { heartbeat(): void; signal: AbortSignal; log(m: string): void }) => Promise<unknown>;

export interface CallWindow {
  tz: string;
  days: number[];
  ranges: [string, string][];
}
export type CallPolicy = true | "screened" | "manual";
export interface SendRule {
  country: string;
  emailAllowed: boolean;
  soleTraderEmail: "allowed_with_notice" | "consent_required" | "blocked";
  unknownLegalFormEmail: "allowed" | "call_only";
  requiresPostalAddress: boolean;
  requiresAdIdentification: boolean;
  optOutHonourDays: number;
  noticeDeadlineDays: number;
  reEmailAfterDays: number;
  auditMaxAgeDays: number;
  maxEmailsPer90d: number;
  footer: "fr" | "en_uk" | "en_us";
  defaultLocale: "fr" | "en";
  callAllowed: CallPolicy;
  callWindow: CallWindow;
  maxCallAttempts30d: number;
  legalRefs: string[];
}
export type RefusalCode = "country_blocked" | "no_email" | "email_webmail" | "email_sole_trader_consent" | "email_unknown_legal_form" | "optout_listed" | "emailed_recently" | "max_emails_reached" | "audit_missing" | "audit_stale" | "daily_cap" | "forbids_extraction" | "register_inactive" | "register_partial" | "notice_deadline_passed" | "not_a_fit" | "draft_unreviewed" | "stage_closed" | "lead_in_conversation" | "call_window_closed" | "call_attempts_exceeded" | "call_screening_missing";
export interface Refusal {
  code: RefusalCode;
  message: { fr: string; en: string };
}
export interface Draft {
  id: number;
  prospectId: number;
  auditId: number;
  locale: "fr" | "en";
  subject: string;
  body: string;
  callScript: string;
  noteForOwner: string;
  model: string | null;
  fallback: boolean;
  generatedAt: string;
  editedAt: string | null;
  reviewedAt: string | null;
}
export interface AdminSession {
  method: "password" | "google";
  subject: string;
  iat: number;
  exp: number;
  nonce: string;
}

// @@finder-ux:types — finder-ux (docs/finder-ux-spec.md §3.1). Backend appends here; frontend imports only.
export type AreaKind = "town" | "postcode" | "department" | "region" | "country" | "place";
export type AreaSelector =
  | { kind: "relation"; relId: number }
  | { kind: "insee"; codes: string[] }
  | { kind: "around"; lat: number; lng: number; m: number };
export interface GeoPolygon {
  type: "Polygon" | "MultiPolygon";
  coordinates: unknown;
}
export interface ResolvedArea extends Area {
  kind: AreaKind;
  countryName: string; // "France" — Nominatim address.country; geo.gouv paths → "France"
  polygon: GeoPolygon | null; // display outline (§2.4); null only for legacy cached areas
  polygonApprox?: boolean; // true when the outline is a circle or a legacy bbox
  osmRelationId?: number;
  areaSelector: AreaSelector;
  admin?: Area["admin"] & { inseeCodes?: string[]; departements?: string[]; regionCode?: string };
  radiusKm: number; // bbox radius from the centre (register near_point)
}
export type SearchStatus = "running" | "done" | "capped" | "partial" | "failed" | "cancelled" | "interrupted" | "expired";
export type UnitState = "pending" | "running" | "done" | "failed" | "skipped";
export interface SearchUnit {
  id: string;
  label: string;
  code?: string;
  center: { lat: number; lng: number };
  state: UnitState;
  found: number;
  truncated?: boolean;
  error?: string;
}
export interface RegisterScope {
  id: string;
  label: string;
  state: UnitState;
  pages: number;
  totalPages: number | null;
  found: number;
}
export interface SearchProgress {
  status: SearchStatus;
  stage: "osm" | "register" | "merge" | "finished";
  units: SearchUnit[]; // OpenStreetMap units in run order
  registerScopes: RegisterScope[];
  found: number; // rows so far (OpenStreetMap rows while running; merged rows once finished)
  expected: number | null; // Overpass count, null when unknown
  cap: number;
  rowsVersion: number; // bumps when the row list is reordered/replaced (merge); the client refetches from 0
  retryingUntil?: string | null; // set while waiting out a busy map service (UI: "retrying in 40 s")
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  etaSeconds: number | null; // (units left) × observed mean unit time, after ≥ 2 finished units
}
export interface SearchNote {
  code: string;
  text: string;
  params?: Record<string, string | number>;
}
export interface ResultRow extends Business {
  key: string; // "<source>:<sourceId>" of the identity row — the pick key
  sources: DiscoverySource[];
  provenance: Partial<Record<"website" | "phone" | "email" | "geo" | "address" | "name", DiscoverySource>>;
  inside: "yes" | "approx" | "no"; // polygon membership (OpenStreetMap rows are always "yes")
  distanceKm: number | null; // haversine from area.center, 1 dp; null without coordinates
  cityApprox?: boolean; // city filled from the nearest commune centre (§3.8)
  socials?: Record<string, string>; // OpenStreetMap contact:* (safeHttpUrl-validated)
  countryName: string;
  countrySource: "source" | "area"; // "area" = assumed from the search area
  hidden?: boolean; // "Not this one" (§3.7)
  unitId?: string;
  readAt?: string; // ISO, when the source was read (card: "read 12 Sep")
}
export interface SearchResultV2 {
  version: 2;
  searchId: number;
  queryArea: string;
  area: ResolvedArea;
  category: { key: string; label: { fr: string; en: string }; custom: boolean };
  sources: DiscoverySource[];
  rows: ResultRow[]; // full list, or a slice when ?after= is used
  total: number; // rows.length of the full list
  perSource: Partial<Record<DiscoverySource, number>>;
  progress: SearchProgress;
  notes: SearchNote[];
  alternatives?: { osmType: "relation" | "node" | "way"; osmId: number; label: string; kind: AreaKind; countryCode: string; countryName: string }[];
  durationMs: number | null;
  createdAt: string; // ISO 8601 UTC
}
export interface SearchSummaryV2 {
  id: number;
  queryArea: string;
  areaLabel: string;
  areaKind: AreaKind | null;
  countryCode: string;
  countryName: string;
  categoryKey: string;
  categoryLabel: string;
  sources: DiscoverySource[];
  resultCount: number;
  perSource: Partial<Record<DiscoverySource, number>>;
  savedCount: number;
  status: SearchStatus;
  durationMs: number | null;
  createdAt: string;
  cached: boolean;
}
