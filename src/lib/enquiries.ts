// SQLite store for diagnostic enquiries. Lives OUTSIDE the deploy tree
// (ENQUIRIES_DB_PATH) so rebuilds/restarts never touch it.
import Database from "better-sqlite3";

const PATH = process.env.ENQUIRIES_DB_PATH || "/home/hermes/data/enquiries.db";

let db: Database.Database | null = null;

export function enquiriesDb(): Database.Database {
  if (db) return db;
  db = new Database(PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS enquiries (
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
  const info = db.prepare("PRAGMA table_info(enquiries)").all() as { name: string }[];
  const cols = new Set(info.map((c) => c.name));
  for (const [name, decl] of [
    ["reply_draft", "TEXT"],
    ["note_for_radu", "TEXT"],
    ["subject_summary", "TEXT"],
    ["mail_status", "TEXT"], // 'sent' | 'failed' | 'skipped'
    ["mail_error", "TEXT"],
  ] as const) {
    if (!cols.has(name)) db.exec(`ALTER TABLE enquiries ADD COLUMN ${name} ${decl}`);
  }
  return db;
}

// Crockford base32 minus 0/O/1/I/L — unambiguous over the phone.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newReference(): string {
  const d = enquiriesDb();
  const exists = d.prepare("SELECT 1 FROM enquiries WHERE reference = ?");
  for (let tries = 0; tries < 20; tries++) {
    let ref = "DM-";
    for (let i = 0; i < 5; i++) ref += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    if (!exists.get(ref)) return ref;
  }
  return `DM-${Date.now().toString(36).toUpperCase().slice(-5)}`;
}
