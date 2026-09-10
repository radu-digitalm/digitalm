// Digital M CRM — additive schema (docs/leadgen-build-spec.md, Appendix A).
// applyCrmSchema(db) is called at the end of enquiriesDb(); every statement is
// idempotent, so it runs on every boot. Extra columns on existing tables go
// through the same PRAGMA table_info + ALTER TABLE ADD COLUMN loop that
// src/lib/enquiries.ts uses. No top-level DB access in this file.
import type Database from "better-sqlite3";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,                       -- LD-XXXXX
  kind TEXT NOT NULL,                                   -- diagnostic|booking|contact|chat|messenger|outreach|manual
  stage TEXT NOT NULL DEFAULT 'new',                    -- new|contacted|replied|meeting|proposal|won|lost|no_response|stop
  name TEXT,
  company TEXT,
  email TEXT,
  email_hash TEXT,                                      -- sha256(lower(trim(email)))
  phone TEXT,
  phone_hash TEXT,                                      -- sha256(E.164 digits)
  locale TEXT NOT NULL DEFAULT 'fr',                    -- fr|en
  country TEXT NOT NULL DEFAULT 'FR',                   -- ISO 3166-1 alpha-2
  source_label TEXT,
  source_utm TEXT,
  attribution TEXT,                                     -- JSON utm_*/oppref
  enquiry_reference TEXT,                               -- DM-XXXXX
  prospect_id INTEGER,
  legal_basis TEXT NOT NULL DEFAULT 'request',          -- request|legitimate_interest
  data_source TEXT NOT NULL DEFAULT 'form',             -- form|chat|messenger|booking|register|osm|companies_house|website|manual
  notice_sent_at TEXT,
  next_action TEXT,
  next_action_at TEXT,                                  -- YYYY-MM-DD (Europe/Paris)
  note TEXT,
  last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
  replied_at TEXT,
  closed_at TEXT,
  close_reason TEXT,
  ip TEXT,                                              -- nulled by the purge at 12 months
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS leads_stage_next ON leads(stage, next_action_at);
CREATE INDEX IF NOT EXISTS leads_email_hash ON leads(email_hash);
CREATE INDEX IF NOT EXISTS leads_phone_hash ON leads(phone_hash);
CREATE INDEX IF NOT EXISTS leads_prospect ON leads(prospect_id);
CREATE INDEX IF NOT EXISTS leads_enquiry ON leads(enquiry_reference);
CREATE INDEX IF NOT EXISTS leads_created ON leads(created_at);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER,
  prospect_id INTEGER,
  kind TEXT NOT NULL,                                   -- note|email_out|email_in|call|report_view|optout|stage_change|lead_created|merged|send_refused|audit_done|notice_sent|manual_send|bounce|recollect
  channel TEXT,                                         -- email|phone|web|telegram|system
  summary TEXT NOT NULL,
  payload TEXT,                                         -- JSON, scalars only; ip stored as ipHash
  actor TEXT NOT NULL DEFAULT 'admin',                  -- admin|system|prospect
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS activities_lead ON activities(lead_id, created_at);
CREATE INDEX IF NOT EXISTS activities_prospect ON activities(prospect_id, created_at);
CREATE INDEX IF NOT EXISTS activities_kind ON activities(kind, created_at);

CREATE TABLE IF NOT EXISTS prospects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,                       -- PR-XXXXX
  lead_id INTEGER,
  name TEXT NOT NULL,
  legal_name TEXT,
  enseigne TEXT,
  name_key TEXT NOT NULL,                               -- normaliseName(name)
  trade_key TEXT,                                       -- categories.ts key, or the custom label
  country TEXT NOT NULL,                                -- ISO 3166-1 alpha-2, never null
  address_line TEXT,
  postcode TEXT,
  city TEXT,
  region TEXT,
  lat REAL,
  lng REAL,
  geo_source TEXT,                                      -- source|centre|manual
  source TEXT NOT NULL,                                 -- osm|fr_register|companies_house|google|manual
  source_id TEXT,                                       -- osm "node/123", FR SIRET, CH company number
  source_url TEXT,
  register_id TEXT,                                     -- SIRET / company number
  register_status TEXT NOT NULL DEFAULT 'unknown',      -- active|ceased|unknown
  register_checked_at TEXT,
  diffusion TEXT NOT NULL DEFAULT 'na',                 -- full|partial|na
  legal_form TEXT,
  sole_trader INTEGER,                                  -- 1|0|NULL unknown
  website TEXT,
  website_source TEXT,                                  -- register|osm|companies_house|manual|google|crawl
  domain_key TEXT,                                      -- registrable domain of website
  website_email TEXT,                                   -- first mailto matching EMAIL_RE
  website_email_kind TEXT,                              -- generic|named|sole_trader|webmail|unknown
  website_email_page TEXT,
  website_phone TEXT,
  website_socials TEXT,                                 -- JSON {facebook:url,...} (safeHttpUrl-validated)
  website_cms TEXT,
  source_phone TEXT,                                    -- from discovery tags (OSM contact:*)
  source_email TEXT,
  forbids_extraction INTEGER NOT NULL DEFAULT 0,
  forbids_override_reason TEXT,
  google_place_id TEXT,
  google_listing TEXT NOT NULL DEFAULT 'unverified',    -- unverified|found|not_found
  google_confirmed_at TEXT,
  locale TEXT NOT NULL,                                 -- fr|en (default from country)
  locale_overridden INTEGER NOT NULL DEFAULT 0,
  latest_audit_id INTEGER,
  latest_score INTEGER,
  latest_grade TEXT,
  fit TEXT NOT NULL DEFAULT 'unknown',                  -- unknown|fit|not_fit
  not_fit_reason TEXT,
  contact_email_override TEXT,
  contact_phone_override TEXT,
  notice_sent_at TEXT,
  notice_deadline_at TEXT,                              -- saved_at + 30 d for EVERY prospect (reset by recollect)
  personal_wiped_at TEXT,
  last_emailed_at TEXT,
  last_called_at TEXT,
  opted_out_at TEXT,
  search_id INTEGER,
  saved_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS prospects_source_uq ON prospects(source, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS prospects_domain ON prospects(domain_key);
CREATE INDEX IF NOT EXISTS prospects_name_country ON prospects(name_key, country);
CREATE INDEX IF NOT EXISTS prospects_ready ON prospects(deleted_at, fit, opted_out_at, latest_score);
CREATE INDEX IF NOT EXISTS prospects_country ON prospects(country);
CREATE INDEX IF NOT EXISTS prospects_notice ON prospects(notice_deadline_at, notice_sent_at);
CREATE INDEX IF NOT EXISTS prospects_lead ON prospects(lead_id);

CREATE TABLE IF NOT EXISTS audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,                       -- AU-XXXXX
  prospect_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',                -- queued|running|done|failed
  locale TEXT NOT NULL,                                 -- fr|en (copied from prospect at run time)
  website TEXT,
  checks TEXT,                                          -- JSON AuditChecks (scalars only)
  score INTEGER,
  grade TEXT,
  flags TEXT NOT NULL DEFAULT '[]',                     -- JSON Flag[]
  fits TEXT NOT NULL DEFAULT '[]',                      -- JSON FitSuggestion[]
  top TEXT NOT NULL DEFAULT '[]',                       -- JSON CheckKey[]
  pagespeed TEXT,                                       -- JSON PsiSummary
  crawl TEXT NOT NULL DEFAULT '[]',                     -- JSON [{url,status,bytes}] — never HTML
  report_token TEXT NOT NULL UNIQUE,                    -- 43-char base64url, generated at creation
  report_expires_at TEXT,                               -- set at first send (+REPORT_TTL_DAYS); null = not yet sent, views not logged
  report_first_viewed_at TEXT,
  report_views INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS audits_prospect ON audits(prospect_id, created_at);
CREATE INDEX IF NOT EXISTS audits_status ON audits(status);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                                   -- audit|noop|send
  payload TEXT NOT NULL DEFAULT '{}',                   -- JSON
  dedupe_key TEXT,                                      -- e.g. "audit:42"
  status TEXT NOT NULL DEFAULT 'queued',                -- queued|running|done|failed|cancelled
  priority INTEGER NOT NULL DEFAULT 5,                  -- lower runs first
  run_after TEXT NOT NULL DEFAULT (datetime('now')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  claimed_at TEXT,
  claim_token TEXT,
  last_error TEXT,
  result TEXT,                                          -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS jobs_pick ON jobs(status, run_after, priority, id);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedupe_uq ON jobs(kind, dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued','running');

CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prospect_id INTEGER NOT NULL,
  audit_id INTEGER NOT NULL,
  locale TEXT NOT NULL,                                 -- fr|en
  subject TEXT NOT NULL,
  body TEXT NOT NULL,                                   -- email body WITHOUT legal block
  call_script TEXT NOT NULL,
  note_for_owner TEXT NOT NULL,
  model TEXT,                                           -- null when template
  fallback INTEGER NOT NULL DEFAULT 0,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  edited_at TEXT,
  reviewed_at TEXT                                      -- send refused while null
);
CREATE INDEX IF NOT EXISTS drafts_prospect ON drafts(prospect_id, generated_at);

CREATE TABLE IF NOT EXISTS sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,                       -- SN-XXXXX
  prospect_id INTEGER NOT NULL,
  lead_id INTEGER,
  audit_id INTEGER,
  draft_id INTEGER,
  channel TEXT NOT NULL,                                -- email|manual_email|call
  to_email TEXT,
  to_hash TEXT,
  from_email TEXT,
  subject TEXT,
  body_text TEXT,                                       -- full text as sent (body + legal block); manual_email rows too
  legal_block TEXT,
  optout_token TEXT UNIQUE,                             -- 43-char base64url; never expires; manual_email rows too
  status TEXT NOT NULL DEFAULT 'pending',               -- pending|sent|failed|refused|bounced
  refusal_codes TEXT NOT NULL DEFAULT '[]',             -- JSON RefusalCode[]
  smtp_message_id TEXT,
  error TEXT,                                           -- error code only, never credentials
  country TEXT NOT NULL,
  rule_key TEXT NOT NULL,                               -- FR|GB|US|*
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS sends_prospect ON sends(prospect_id, created_at);
CREATE INDEX IF NOT EXISTS sends_status_sent ON sends(status, sent_at);
CREATE INDEX IF NOT EXISTS sends_to_hash ON sends(to_hash);

CREATE TABLE IF NOT EXISTS optouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_hash TEXT,
  phone_hash TEXT,
  channel TEXT NOT NULL,                                -- email|phone|both
  source TEXT NOT NULL,                                 -- link|one_click|reply_stop|call|manual
  lead_id INTEGER,
  prospect_id INTEGER,
  send_id INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS optouts_email ON optouts(email_hash);
CREATE INDEX IF NOT EXISTS optouts_phone ON optouts(phone_hash);

CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_area TEXT NOT NULL,
  area TEXT NOT NULL,                                   -- JSON Area (geocoded)
  category_key TEXT NOT NULL,                           -- categories.ts key or "custom:<slug>"
  sources TEXT NOT NULL,                                -- JSON DiscoverySource[]
  result_count INTEGER NOT NULL DEFAULT 0,
  per_source TEXT NOT NULL DEFAULT '{}',                -- JSON {osm: n, fr_register: n, ...}
  saved_count INTEGER NOT NULL DEFAULT 0,
  partial INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS searches_created ON searches(created_at);

CREATE TABLE IF NOT EXISTS api_usage (
  provider TEXT NOT NULL,                               -- overpass|nominatim|geo_gouv|fr_register|companies_house|pagespeed|openai_drafts|google_places|audit|outreach_email
  day TEXT NOT NULL,                                    -- YYYY-MM-DD (UTC)
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, day)
);

CREATE TABLE IF NOT EXISTS api_cache (
  cache_key TEXT PRIMARY KEY,                           -- "<provider>:<sha256(request)>" or "search:<id>"
  provider TEXT NOT NULL,
  payload TEXT NOT NULL,                                -- JSON
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS api_cache_expires ON api_cache(expires_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,                                 -- outreach_daily_cap_override | purge_last_run_at
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// Extra columns on existing tables: [table, column, declaration]. Each module
// appends under its own marker only (contract §1.2); never reorder.
export const EXTRA_COLUMNS: [table: string, column: string, decl: string][] = [
  // @@crm:foundation

  // @@crm:inbox

  // @@crm:finder

  // @@crm:audit

  // @@crm:report

  // @@crm:outreach
];

/** Idempotent: creates the CRM tables/indexes and adds any missing extra column. */
export function applyCrmSchema(db: Database.Database): void {
  db.exec(SCHEMA_SQL);
  const byTable = new Map<string, Set<string>>();
  for (const [table, column, decl] of EXTRA_COLUMNS) {
    let cols = byTable.get(table);
    if (!cols) {
      const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      cols = new Set(info.map((c) => c.name));
      byTable.set(table, cols);
    }
    if (!cols.has(column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
      cols.add(column);
    }
  }
}
