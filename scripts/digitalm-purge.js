#!/usr/bin/env node
// Digital M CRM — retention purge (contract §9 "Purge", docs/leadgen-build-spec.md).
//
//   node /home/hermes/workspace/scripts/digitalm-purge.js              # dry run (default): counts only, DB opened read-only
//   node /home/hermes/workspace/scripts/digitalm-purge.js --apply      # VACUUM INTO backup, then apply every step
//   node /home/hermes/workspace/scripts/digitalm-purge.js --db /home/hermes/data/enquiries-staging.db --apply
//   options: --db PATH, --env FILE, --backup-dir DIR (default /home/hermes/data/backups), --json
//
// Steps (same order as the contract):
//   1. backup: mkdir -p backups, VACUUM INTO a dated file, keep the 8 newest (apply only)
//   2. enquiries: IP nulled at 12 months, rows deleted 3 years after last_contact_at
//      (replaces purge-enquiries.js — which stays untouched until the hermes job is repointed);
//      leads.ip nulled at 12 months
//   3. leads 'contacted' with no reply and no email_out/manual_send in 21 days → no_response
//   4. prospects past the 30-day notice deadline with no notice sent and nothing wiped:
//      sole_trader = 1 → row + audits + drafts + activities deleted (sends keep hashes only);
//      sole_trader = 0 → wipePersonal keeping a generic email; NULL → wipePersonal, nothing kept
//   5. no_response / not_fit prospects without a reply → wipePersonal at 12 months
//   6. activities.payload.ipHash removed at 12 months
//   7. prospects deleted 3 years after the later of saved_at and their last inbound activity
//   8. newest 3 audits per prospect kept
//   9. jobs done/failed/cancelled older than 30 days and expired api_cache rows removed
//  10. optouts never touched
//  11. settings.purge_last_run_at = now (Today and the digest go red when it is > 2 days old)
//
// Writes nothing without --apply. Prints counts and references only, never an
// address. Exits 0 on success, 1 on a failure (message only, no secrets).
// Scheduling is an approval item (§13): replace hermes job 518a81934ab4 by a
// daily no-agent job `0 4 * * *` through ~/.hermes/scripts/run-digitalm-purge.sh
// (`exec /home/hermes/.local/bin/node /home/hermes/workspace/scripts/digitalm-purge.js --apply`).
"use strict";

const fs = require("node:fs");
const path = require("node:path");

let Database;
try {
  Database = require("/home/hermes/workspace/digitalm-prod/node_modules/better-sqlite3");
} catch {
  Database = require("/home/hermes/workspace/digitalm/node_modules/better-sqlite3");
}

// ---- args and config ------------------------------------------------------------

const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
}
if (args.includes("--help") || args.includes("-h")) {
  console.log("usage: digitalm-purge.js [--apply] [--db PATH] [--env FILE] [--backup-dir DIR] [--json]");
  process.exit(0);
}
const APPLY = args.includes("--apply");
const JSON_OUT = args.includes("--json");

const ENV_KEYS = ["ENQUIRIES_DB_PATH"];
function loadEnv(file) {
  const out = {};
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || !ENV_KEYS.includes(m[1])) continue;
    out[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/\s+#.*$/, "");
  }
  return out;
}
const fileEnv = loadEnv(argValue("--env") || "/home/hermes/workspace/digitalm-prod/.env.local");
const cfg = (key, fallback) => process.env[key] ?? fileEnv[key] ?? fallback;

const DB_PATH = argValue("--db") || cfg("ENQUIRIES_DB_PATH", "/home/hermes/data/enquiries.db");
const BACKUP_DIR = argValue("--backup-dir") || "/home/hermes/data/backups";
const KEEP_BACKUPS = 8;

// ---- helpers ------------------------------------------------------------------------

function toSql(d) {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

const summary = { mode: APPLY ? "apply" : "dry-run", db: DB_PATH, startedAt: new Date().toISOString(), steps: {}, backup: null, skipped: [] };
const lines = [];
function out(s) {
  lines.push(s);
}

let db;
try {
  db = new Database(DB_PATH, { readonly: !APPLY, fileMustExist: true });
} catch (e) {
  console.error(`purge: cannot open ${DB_PATH}: ${e.message}`);
  process.exit(1);
}
const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
const has = (...names) => names.every((t) => tables.has(t));
const count = (sql, ...params) => db.prepare(sql).get(...params).n;
const columns = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));

/** Run one step: `dry` returns the count that would change; `apply` performs it and returns the count. */
function step(key, label, needTables, dry, apply) {
  if (!has(...needTables)) {
    summary.skipped.push(key);
    out(`${label}: skipped (table missing)`);
    return;
  }
  try {
    const n = APPLY ? apply() : dry();
    summary.steps[key] = n;
    out(`${label}: ${n}${APPLY ? "" : " (would change)"}`);
  } catch (e) {
    summary.steps[key] = null;
    out(`${label}: FAILED — ${String(e.message || e).slice(0, 200)}`);
    process.exitCode = 1;
  }
}

// wipePersonal (src/lib/prospects/store.ts): null every personal contact field,
// keep a generic website_email only when asked, stamp personal_wiped_at.
function wipeSql(keepGenericEmail) {
  const emailClause = keepGenericEmail
    ? "website_email = CASE WHEN website_email_kind = 'generic' THEN website_email ELSE NULL END, website_email_kind = CASE WHEN website_email_kind = 'generic' THEN website_email_kind ELSE NULL END"
    : "website_email = NULL, website_email_kind = NULL";
  return `UPDATE prospects SET ${emailClause}, website_email_page = NULL, website_phone = NULL, source_email = NULL, source_phone = NULL,
      contact_email_override = NULL, contact_phone_override = NULL, personal_wiped_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`;
}

/** Hard delete of a prospect and what hangs off it; sends keep their hashes, optouts are never touched. */
function deleteProspect(id) {
  if (has("audits")) db.prepare("DELETE FROM audits WHERE prospect_id = ?").run(id);
  if (has("drafts")) db.prepare("DELETE FROM drafts WHERE prospect_id = ?").run(id);
  if (has("activities")) db.prepare("DELETE FROM activities WHERE prospect_id = ?").run(id);
  if (has("jobs")) {
    db.prepare("UPDATE jobs SET status = 'cancelled', finished_at = datetime('now') WHERE kind = 'audit' AND dedupe_key = ? AND status = 'queued'").run(`audit:${id}`);
  }
  if (has("sends")) db.prepare("UPDATE sends SET to_email = NULL, subject = NULL, body_text = NULL, legal_block = NULL WHERE prospect_id = ?").run(id);
  if (has("leads")) db.prepare("UPDATE leads SET prospect_id = NULL WHERE prospect_id = ?").run(id);
  db.prepare("DELETE FROM prospects WHERE id = ?").run(id);
}

// ---- 1. backup (apply only) ---------------------------------------------------------

if (APPLY) {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");
    const file = path.join(BACKUP_DIR, `enquiries-purge-${stamp}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    summary.backup = file;
    out(`Backup: ${file}`);
    const old = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => /^enquiries-purge-\d{8}-\d{6}\.db$/.test(f))
      .sort()
      .reverse()
      .slice(KEEP_BACKUPS);
    for (const f of old) fs.unlinkSync(path.join(BACKUP_DIR, f));
    if (old.length) out(`Backups pruned: ${old.length} (keeping ${KEEP_BACKUPS})`);
  } catch (e) {
    console.error(`purge: backup failed, nothing applied: ${e.message}`);
    process.exit(1);
  }
}

// ---- 2–11 in one transaction when applying ------------------------------------------------

const run = () => {
  // 2. enquiries + leads.ip
  step(
    "enquiries_ip",
    "Enquiries: IPs nulled (12 months)",
    ["enquiries"],
    () => count("SELECT COUNT(*) AS n FROM enquiries WHERE ip IS NOT NULL AND created_at < datetime('now', '-12 months')"),
    () => db.prepare("UPDATE enquiries SET ip = NULL WHERE ip IS NOT NULL AND created_at < datetime('now', '-12 months')").run().changes,
  );
  step(
    "enquiries_deleted",
    "Enquiries: rows deleted (3 years after last contact)",
    ["enquiries"],
    () => count("SELECT COUNT(*) AS n FROM enquiries WHERE last_contact_at < datetime('now', '-3 years')"),
    () => db.prepare("DELETE FROM enquiries WHERE last_contact_at < datetime('now', '-3 years')").run().changes,
  );
  step(
    "leads_ip",
    "Leads: IPs nulled (12 months)",
    ["leads"],
    () => count("SELECT COUNT(*) AS n FROM leads WHERE ip IS NOT NULL AND created_at < datetime('now', '-12 months')"),
    () => db.prepare("UPDATE leads SET ip = NULL WHERE ip IS NOT NULL AND created_at < datetime('now', '-12 months')").run().changes,
  );

  // 3. contacted → no_response after 21 days without a reply
  const NO_RESPONSE_WHERE = `stage = 'contacted' AND replied_at IS NULL
      AND EXISTS (SELECT 1 FROM activities a WHERE a.lead_id = leads.id AND a.kind IN ('email_out', 'manual_send'))
      AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.lead_id = leads.id AND a.kind IN ('email_out', 'manual_send') AND a.created_at > datetime('now', '-21 days'))`;
  step(
    "leads_no_response",
    "Leads: contacted → no_response (21 days without a reply)",
    ["leads", "activities"],
    () => count(`SELECT COUNT(*) AS n FROM leads WHERE ${NO_RESPONSE_WHERE}`),
    () => {
      const rows = db.prepare(`SELECT id, prospect_id FROM leads WHERE ${NO_RESPONSE_WHERE}`).all();
      const close = db.prepare(
        "UPDATE leads SET stage = 'no_response', closed_at = datetime('now'), close_reason = 'no_response', last_activity_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      );
      const note = db.prepare(
        "INSERT INTO activities (lead_id, prospect_id, kind, channel, summary, payload, actor) VALUES (?, ?, 'stage_change', 'system', ?, ?, 'system')",
      );
      for (const r of rows) {
        close.run(r.id);
        note.run(r.id, r.prospect_id, "Stage: Contacted → No response (21 days without a reply, purge)", JSON.stringify({ from: "contacted", to: "no_response", by: "purge" }));
      }
      return rows.length;
    },
  );

  // 4. notice deadline passed, no notice, nothing wiped
  const DEADLINE_WHERE = "notice_sent_at IS NULL AND notice_deadline_at < datetime('now') AND personal_wiped_at IS NULL AND deleted_at IS NULL";
  step(
    "notice_deadline",
    "Prospects past the 30-day notice deadline (sole trader deleted / company wiped keeping generic email / unknown wiped)",
    ["prospects"],
    () => count(`SELECT COUNT(*) AS n FROM prospects WHERE ${DEADLINE_WHERE}`),
    () => {
      const rows = db.prepare(`SELECT id, sole_trader FROM prospects WHERE ${DEADLINE_WHERE}`).all();
      const wipeKeep = db.prepare(wipeSql(true));
      const wipeAll = db.prepare(wipeSql(false));
      let deleted = 0;
      for (const r of rows) {
        if (r.sole_trader === 1) {
          deleteProspect(r.id);
          deleted++;
        } else if (r.sole_trader === 0) wipeKeep.run(r.id);
        else wipeAll.run(r.id);
      }
      summary.steps.notice_deadline_deleted = deleted;
      return rows.length;
    },
  );

  // 5. no_response / not_fit without a reply → wipe at 12 months
  const IDLE_WHERE = `p.deleted_at IS NULL AND p.personal_wiped_at IS NULL
      AND (p.fit = 'not_fit' OR l.stage = 'no_response')
      AND (l.id IS NULL OR l.replied_at IS NULL)
      AND MAX(p.saved_at, COALESCE((SELECT MAX(a.created_at) FROM activities a WHERE a.prospect_id = p.id), p.saved_at)) < datetime('now', '-12 months')`;
  step(
    "idle_wiped",
    "Prospects no_response / not_fit without a reply: personal fields wiped (12 months)",
    ["prospects", "leads", "activities"],
    () => count(`SELECT COUNT(*) AS n FROM prospects p LEFT JOIN leads l ON l.id = p.lead_id WHERE ${IDLE_WHERE}`),
    () => {
      const rows = db.prepare(`SELECT p.id, p.sole_trader FROM prospects p LEFT JOIN leads l ON l.id = p.lead_id WHERE ${IDLE_WHERE}`).all();
      const wipeKeep = db.prepare(wipeSql(true));
      const wipeAll = db.prepare(wipeSql(false));
      for (const r of rows) (r.sole_trader === 0 ? wipeKeep : wipeAll).run(r.id);
      return rows.length;
    },
  );

  // 6. ipHash out of activity payloads at 12 months
  const IPHASH_WHERE = "created_at < datetime('now', '-12 months') AND payload IS NOT NULL AND json_valid(payload) AND json_extract(payload, '$.ipHash') IS NOT NULL";
  step(
    "iphash",
    "Activities: ipHash removed (12 months)",
    ["activities"],
    () => count(`SELECT COUNT(*) AS n FROM activities WHERE ${IPHASH_WHERE}`),
    () => db.prepare(`UPDATE activities SET payload = json_remove(payload, '$.ipHash') WHERE ${IPHASH_WHERE}`).run().changes,
  );

  // 7. prospects deleted 3 years after the later of saved_at and the last inbound activity
  const OLD_WHERE = `MAX(p.saved_at, COALESCE((SELECT MAX(a.created_at) FROM activities a WHERE a.prospect_id = p.id AND a.kind IN ('email_in', 'report_view', 'call', 'optout')), p.saved_at)) < datetime('now', '-3 years')`;
  step(
    "old_deleted",
    "Prospects deleted (3 years after collection or last inbound activity)",
    ["prospects", "activities"],
    () => count(`SELECT COUNT(*) AS n FROM prospects p WHERE ${OLD_WHERE}`),
    () => {
      const rows = db.prepare(`SELECT p.id FROM prospects p WHERE ${OLD_WHERE}`).all();
      for (const r of rows) deleteProspect(r.id);
      return rows.length;
    },
  );

  // 8. newest 3 audits per prospect
  const EXTRA_AUDITS = `SELECT a.id FROM audits a WHERE a.id NOT IN (SELECT a2.id FROM audits a2 WHERE a2.prospect_id = a.prospect_id ORDER BY a2.created_at DESC, a2.id DESC LIMIT 3)`;
  step(
    "audits_trimmed",
    "Audits removed beyond the newest 3 per prospect",
    ["audits"],
    () => count(`SELECT COUNT(*) AS n FROM (${EXTRA_AUDITS})`),
    () => db.prepare(`DELETE FROM audits WHERE id IN (${EXTRA_AUDITS})`).run().changes,
  );

  // 9. finished jobs and expired cache
  step(
    "jobs",
    "Jobs done/failed/cancelled removed (30 days)",
    ["jobs"],
    () => count("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('done', 'failed', 'cancelled') AND COALESCE(finished_at, created_at) < datetime('now', '-30 days')"),
    () => db.prepare("DELETE FROM jobs WHERE status IN ('done', 'failed', 'cancelled') AND COALESCE(finished_at, created_at) < datetime('now', '-30 days')").run().changes,
  );
  step(
    "api_cache",
    "Expired api_cache rows removed",
    ["api_cache"],
    () => count("SELECT COUNT(*) AS n FROM api_cache WHERE expires_at < datetime('now')"),
    () => db.prepare("DELETE FROM api_cache WHERE expires_at < datetime('now')").run().changes,
  );

  // 10. optouts: never touched. 11. last run.
  if (has("optouts")) out(`Opt-outs kept: ${count("SELECT COUNT(*) AS n FROM optouts")}`);
  if (APPLY && has("settings")) {
    const now = toSql(new Date());
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('purge_last_run_at', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").run(now);
    out(`settings.purge_last_run_at = ${now}`);
  }
};

try {
  if (APPLY) db.transaction(run)();
  else run();
} catch (e) {
  console.error(`purge: ${APPLY ? "rolled back" : "failed"}: ${String(e.message || e).slice(0, 200)}`);
  process.exitCode = 1;
}
db.close();

if (JSON_OUT) process.stdout.write(`${JSON.stringify(summary)}\n`);
else process.stdout.write(`purge (${summary.mode}) ${DB_PATH}\n${lines.map((l) => `  ${l}`).join("\n")}\n`);
