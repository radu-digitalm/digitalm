// SQLite store for diagnostic enquiries. Lives OUTSIDE the deploy tree
// (ENQUIRIES_DB_PATH) so rebuilds/restarts never touch it.
import Database from "better-sqlite3";
import { applyCrmSchema } from "@/lib/crm/schema";
import { newReference as crmReference } from "@/lib/crm/refs";

const PATH = process.env.ENQUIRIES_DB_PATH || "/home/hermes/data/enquiries.db";

let db: Database.Database | null = null;

export function enquiriesDb(): Database.Database {
  if (db) return db;
  const d = new Database(PATH);
  d.pragma("journal_mode = WAL");
  d.exec(`CREATE TABLE IF NOT EXISTS enquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    locale TEXT NOT NULL,
    answers TEXT NOT NULL,
    scores TEXT NOT NULL,
    proposed TEXT NOT NULL,
    grade TEXT NOT NULL,
    urgent INTEGER NOT NULL DEFAULT 0,
    flagged INTEGER NOT NULL DEFAULT 0,
    first_name TEXT,
    email TEXT,
    company TEXT,
    phone TEXT,
    source TEXT,
    ip TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_contact_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // Added after a mail outage silently lost a lead's triage: the LLM analysis
  // must survive even when every notification channel fails. Additive columns
  // only, so existing rows keep working.
  const info = d.prepare("PRAGMA table_info(enquiries)").all() as { name: string }[];
  const cols = new Set(info.map((c) => c.name));
  for (const [name, decl] of [
    ["reply_draft", "TEXT"],
    ["note_for_radu", "TEXT"],
    ["subject_summary", "TEXT"],
    ["mail_status", "TEXT"], // 'sent' | 'failed' | 'skipped'
    ["mail_error", "TEXT"],
    ["source_utm", "TEXT"], // e.g. 'chatgpt' — utm_source (or oppref-derived) at submit time
    ["attribution", "TEXT"], // JSON of utm_* / oppref as posted by the form
  ] as const) {
    if (!cols.has(name)) d.exec(`ALTER TABLE enquiries ADD COLUMN ${name} ${decl}`);
  }

  // The CRM tables (leads, prospects, audits, jobs…) live in the same file;
  // their migrations are additive and idempotent too. The handle is published
  // only once every migration succeeded, so a failure here surfaces on the
  // next call instead of leaving a half-migrated singleton behind.
  applyCrmSchema(d);
  db = d;
  return db;
}

/** DM- reference for a diagnostic enquiry; the alphabet and check live in crm/refs.ts. */
export function newReference(): string {
  return crmReference("DM");
}
