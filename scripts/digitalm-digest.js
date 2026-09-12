#!/usr/bin/env node
// Digital M CRM — read-only daily digest (contract §5, docs/leadgen-build-spec.md).
//
//   node /home/hermes/workspace/scripts/digitalm-digest.js            # print to stdout
//   node /home/hermes/workspace/scripts/digitalm-digest.js --telegram # also push via `hermes send`
//   node /home/hermes/workspace/scripts/digitalm-digest.js --db /home/hermes/data/enquiries-staging.db
//
// Opens ENQUIRIES_DB_PATH (or --db) read-only and prints the Today sections
// (src/lib/inbox/today.ts is the reference — keep the queries in step) plus
// yesterday's sends, opt-outs in the last 24 h, the API counters, the
// STOP-replies reminder and the purge age. Writes nothing, prints references
// only (never an email address), exits 0 even when a section fails.
//
// Config: process.env first, then the allowlisted keys below from --env FILE
// (default: the prod .env.local when it exists) — values are never printed.
// Scheduling is an approval item (§13): hermes cron no-agent job `0 8 * * *`
// through ~/.hermes/scripts/run-digitalm-digest.sh, or a user crontab line.
"use strict";

const fs = require("node:fs");
const { spawn } = require("node:child_process");

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
  console.log("usage: digitalm-digest.js [--db PATH] [--env FILE] [--telegram]");
  process.exit(0);
}

const ENV_KEYS = ["ENQUIRIES_DB_PATH", "READY_SCORE_MAX", "OUTREACH_COUNTRY_ALLOW", "OUTREACH_DAILY_CAP", "GOOGLE_PLACES", "GOOGLE_PLACES_KEY", "GOOGLE_PLACES_MONTHLY_CAP", "GOOGLE_SEARCH_MONTHLY_CAP", "GOOGLE_DETAILS_MONTHLY_CAP", "NEXT_PUBLIC_SITE_URL"];
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
const intCfg = (key, fallback) => {
  const n = Number.parseInt(cfg(key, ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const DB_PATH = argValue("--db") || cfg("ENQUIRIES_DB_PATH", "/home/hermes/data/enquiries.db");
const SITE = String(cfg("NEXT_PUBLIC_SITE_URL", "https://digitalm.eu")).replace(/\/$/, "");
const READY_SCORE_MAX = intCfg("READY_SCORE_MAX", 60);
const OUTREACH_DAILY_CAP = intCfg("OUTREACH_DAILY_CAP", 10);
// finder-google §4.7: the three monthly pools, counted on the Pacific calendar day (Google's free tier resets at midnight Pacific).
const GOOGLE_ON = cfg("GOOGLE_PLACES", "off") === "on" && !!cfg("GOOGLE_PLACES_KEY", ""); // presence only — the key is never printed
const GOOGLE_KEY_MISSING = cfg("GOOGLE_PLACES", "off") === "on" && !cfg("GOOGLE_PLACES_KEY", "");
const GOOGLE_CAP = intCfg("GOOGLE_PLACES_MONTHLY_CAP", 900);
const GOOGLE_SEARCH_CAP = intCfg("GOOGLE_SEARCH_MONTHLY_CAP", 4500);
const GOOGLE_OTHER_CAP = intCfg("GOOGLE_DETAILS_MONTHLY_CAP", 4500);
const GOOGLE_MONTH = (() => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}`;
})();
const EMAIL_RULE_COUNTRIES = ["FR", "GB", "US"];
const ALLOW = new Set(
  String(cfg("OUTREACH_COUNTRY_ALLOW", "FR,GB,US"))
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s)),
);
const COUNTRY_LIST = EMAIL_RULE_COUNTRIES.filter((c) => ALLOW.has(c)).map((c) => `'${c}'`).join(",") || "''";

// ---- dates (Europe/Paris) ---------------------------------------------------------

function parisParts(at) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
}
function toSql(d) {
  return d.toISOString().slice(0, 19).replace("T", " ");
}
/** UTC instant of Paris midnight on the civil date `daysAgo` days before today. */
function parisMidnight(daysAgo) {
  const now = new Date();
  const p = parisParts(now);
  const guess = Date.UTC(p.y, p.m - 1, p.d - daysAgo);
  const q = parisParts(new Date(guess));
  const offsetMin = Math.round((Date.UTC(q.y, q.m - 1, q.d, q.h, q.mi, q.s) - guess) / 60000);
  return new Date(guess - offsetMin * 60000);
}
const p0 = parisParts(new Date());
const TODAY = `${p0.y}-${String(p0.m).padStart(2, "0")}-${String(p0.d).padStart(2, "0")}`;
const MONTH = TODAY.slice(0, 7);
const DAY_START = toSql(parisMidnight(0));
const YDAY_START = toSql(parisMidnight(1));
const TODAY_UTC = new Date().toISOString().slice(0, 10);
const YDAY_UTC = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

// ---- predicates mirrored from src/lib/crm/db.ts (keep in step) -------------------------

const USABLE_EMAIL = `(prospects.contact_email_override IS NOT NULL OR (prospects.website_email IS NOT NULL AND COALESCE(prospects.website_email_kind, 'unknown') NOT IN ('webmail', 'unknown')))`;
const HAS_PHONE = `(prospects.contact_phone_override IS NOT NULL OR prospects.website_phone IS NOT NULL OR prospects.source_phone IS NOT NULL)`;
const LEAD_OPEN = `NOT EXISTS (SELECT 1 FROM leads l WHERE l.id = prospects.lead_id AND l.stage IN ('replied', 'meeting', 'proposal', 'won', 'lost', 'stop'))`;
const READY_WHERE = [
  `prospects.deleted_at IS NULL`,
  `prospects.fit <> 'not_fit'`,
  `prospects.opted_out_at IS NULL`,
  `prospects.diffusion <> 'partial'`,
  `prospects.latest_audit_id IS NOT NULL`,
  `prospects.latest_score < ${READY_SCORE_MAX}`,
  `EXISTS (SELECT 1 FROM audits a WHERE a.id = prospects.latest_audit_id AND a.finished_at > datetime('now', '-90 days'))`,
  `(prospects.last_emailed_at IS NULL OR prospects.last_emailed_at < datetime('now', '-90 days'))`,
  `(prospects.notice_sent_at IS NOT NULL OR prospects.notice_deadline_at > datetime('now') OR prospects.personal_wiped_at IS NOT NULL)`,
  USABLE_EMAIL,
  `prospects.forbids_extraction = 0`,
  `prospects.country IN (${COUNTRY_LIST})`,
  `prospects.register_status <> 'ceased'`,
  `(prospects.country <> 'GB' OR (prospects.sole_trader = 0 AND prospects.register_id IS NOT NULL))`,
  LEAD_OPEN,
].join(" AND ");
const CALL_WHERE = [
  `prospects.deleted_at IS NULL`,
  `prospects.fit <> 'not_fit'`,
  `prospects.opted_out_at IS NULL`,
  `prospects.diffusion <> 'partial'`,
  `prospects.register_status <> 'ceased'`,
  `(prospects.notice_sent_at IS NOT NULL OR prospects.notice_deadline_at > datetime('now') OR prospects.personal_wiped_at IS NOT NULL)`,
  `(prospects.forbids_extraction = 0 OR prospects.forbids_override_reason IS NOT NULL)`,
  `NOT ${USABLE_EMAIL}`,
  HAS_PHONE,
  `(SELECT COUNT(*) FROM activities ac WHERE ac.prospect_id = prospects.id AND ac.kind = 'call' AND ac.created_at > datetime('now', '-30 days')) < 4`,
  LEAD_OPEN,
].join(" AND ");

// ---- report ---------------------------------------------------------------------

const lines = [];
const out = (s = "") => lines.push(s);
const safe = (s) => String(s ?? "").replace(/@/g, "(at)").replace(/\s+/g, " ").trim();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

let db;
try {
  db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
} catch (e) {
  console.error(`digest: cannot open ${DB_PATH}: ${e.message}`);
  process.exit(0);
}
const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
const has = (...names) => names.every((n) => tables.has(n));
const one = (sql, ...params) => db.prepare(sql).get(...params);
const count = (sql, ...params) => Number(one(sql, ...params)?.n ?? 0);
function section(title, needs, fn) {
  if (!has(...needs)) {
    out(`${title}: (CRM tables not present yet)`);
    return;
  }
  try {
    fn();
  } catch (e) {
    out(`${title}: unavailable (${e.code || e.message})`);
  }
}

out(`📬 Digital M — daily digest · ${TODAY}`);
out(`${SITE}/admin`);
out();

section("Follow-ups", ["leads"], () => {
  const rows = db
    .prepare(
      `SELECT id, reference, next_action, next_action_at FROM leads
       WHERE next_action_at IS NOT NULL AND next_action_at <= ? AND stage NOT IN ('won', 'lost', 'no_response', 'stop')
       ORDER BY next_action_at, id LIMIT 50`,
    )
    .all(TODAY);
  const overdue = rows.filter((r) => r.next_action_at < TODAY).length;
  out(`Follow-ups: ${rows.length - overdue} due · ${overdue} overdue`);
  for (const r of rows.slice(0, 8)) {
    const days = Math.round((Date.parse(`${TODAY}T00:00:00Z`) - Date.parse(`${r.next_action_at}T00:00:00Z`)) / 86400000);
    const when = days === 0 ? "today" : `${plural(days, "day")} overdue`;
    out(`  · ${r.reference} — ${safe(r.next_action) || "follow up"} (${when}) ${SITE}/admin/leads/${r.id}`);
  }
});

section("New leads, 7 days", ["leads"], () => {
  const rows = db
    .prepare(`SELECT COALESCE(source_label, 'Direct') AS label, COUNT(*) AS n FROM leads WHERE created_at > datetime('now', '-7 days') GROUP BY label ORDER BY n DESC, label`)
    .all();
  out(`New leads, 7 days: ${rows.reduce((s, r) => s + r.n, 0)}`);
  for (const r of rows) out(`  · ${safe(r.label)}: ${r.n}`);
});

section("Reports opened, no reply", ["audits", "prospects", "leads"], () => {
  const rows = db
    .prepare(
      `SELECT p.reference AS pr, a.reference AS au, a.report_views AS views
       FROM audits a JOIN prospects p ON p.id = a.prospect_id LEFT JOIN leads l ON l.id = p.lead_id
       WHERE a.report_first_viewed_at IS NOT NULL AND p.deleted_at IS NULL
         AND (l.id IS NULL OR (l.replied_at IS NULL AND l.stage IN ('new', 'contacted')))
       ORDER BY a.report_first_viewed_at DESC LIMIT 50`,
    )
    .all();
  out(`Reports opened, no reply: ${rows.length}`);
  for (const r of rows.slice(0, 8)) out(`  · ${r.pr} — ${r.au}, ${plural(r.views, "view")}`);
});

section("Emails", ["sends", "settings"], () => {
  const today = count(`SELECT COUNT(*) AS n FROM sends WHERE status = 'sent' AND channel = 'email' AND sent_at >= ?`, DAY_START);
  const yesterday = count(`SELECT COUNT(*) AS n FROM sends WHERE status = 'sent' AND channel IN ('email', 'manual_email') AND sent_at >= ? AND sent_at < ?`, YDAY_START, DAY_START);
  const yFailed = count(`SELECT COUNT(*) AS n FROM sends WHERE status = 'failed' AND created_at >= ? AND created_at < ?`, YDAY_START, DAY_START);
  const yRefused = count(`SELECT COUNT(*) AS n FROM sends WHERE status = 'refused' AND created_at >= ? AND created_at < ?`, YDAY_START, DAY_START);
  const override = Number.parseInt(one(`SELECT value FROM settings WHERE key = 'outreach_daily_cap_override'`)?.value ?? "", 10);
  const cap = Number.isFinite(override) && override >= 0 && override < OUTREACH_DAILY_CAP ? override : OUTREACH_DAILY_CAP;
  out(`Emails: yesterday ${yesterday} sent · ${yFailed} failed · ${yRefused} refused — today ${today} / ${cap}${today >= cap ? " (cap reached)" : ""}`);
});

section("Opt-outs, 24 h", ["optouts"], () => {
  const n = count(`SELECT COUNT(*) AS n FROM optouts WHERE created_at > datetime('now', '-1 day')`);
  out(`Opt-outs, 24 h: ${n}`);
});

section("Audits", ["jobs", "audits"], () => {
  const q = { queued: 0, running: 0 };
  for (const r of db.prepare(`SELECT status, COUNT(*) AS n FROM jobs WHERE kind = 'audit' AND status IN ('queued', 'running') GROUP BY status`).all()) q[r.status] = r.n;
  const failed = count(`SELECT COUNT(*) AS n FROM audits WHERE status = 'failed' AND created_at > datetime('now', '-7 days')`);
  const doneY = count(`SELECT COUNT(*) AS n FROM audits WHERE status = 'done' AND finished_at >= ? AND finished_at < ?`, YDAY_START, DAY_START);
  out(`Audits: ${q.queued} queued · ${q.running} running · ${doneY} done yesterday · ${failed} failed in 7 days`);
});

section("Ready to send", ["prospects", "audits", "leads", "activities"], () => {
  const ready = count(`SELECT COUNT(*) AS n FROM prospects WHERE ${READY_WHERE}`);
  const call = count(`SELECT COUNT(*) AS n FROM prospects WHERE ${CALL_WHERE}`);
  out(`Ready to send: ${ready} · Call list: ${call}`);
});

// Mirrors the `google` / `google-key` cards of src/lib/inbox/today.ts (finder-google §4.7): nothing while Google is off.
if (GOOGLE_ON) {
  section("Google usage this month", ["api_usage"], () => {
    const pool = (provider) => count(`SELECT COALESCE(SUM(count), 0) AS n FROM api_usage WHERE provider = ? AND day LIKE ? ESCAPE '\\'`, provider, `${GOOGLE_MONTH}-%`);
    const checks = pool("google_details_enterprise");
    const searches = pool("google_search");
    const other = pool("google_details_other");
    const capped = (checks >= GOOGLE_CAP && GOOGLE_CAP > 0) || (searches >= GOOGLE_SEARCH_CAP && GOOGLE_SEARCH_CAP > 0) || (other >= GOOGLE_OTHER_CAP && GOOGLE_OTHER_CAP > 0);
    out(`Google usage this month: ${checks} / ${GOOGLE_CAP} — ${searches.toLocaleString("en-GB")} / ${GOOGLE_SEARCH_CAP.toLocaleString("en-GB")} searches${capped ? " (a cap is reached)" : ""}`);
  });
} else if (GOOGLE_KEY_MISSING) {
  section("Google key", [], () => out("Google key: missing"));
}

section("Notice deadlines within 5 days", ["prospects"], () => {
  const n = count(
    `SELECT COUNT(*) AS n FROM prospects WHERE deleted_at IS NULL AND notice_sent_at IS NULL AND personal_wiped_at IS NULL
       AND notice_deadline_at >= datetime('now') AND notice_deadline_at <= datetime('now', '+5 days')`,
  );
  out(`Notice deadlines within 5 days: ${n}${n > 0 ? " — send the notice or the purge wipes them" : ""}`);
});

section("Bounces this week", ["activities"], () => {
  out(`Bounces this week: ${count(`SELECT COUNT(*) AS n FROM activities WHERE kind = 'bounce' AND created_at > datetime('now', '-7 days')`)}`);
});

section("STOP replies", ["sends"], () => {
  const n = count(`SELECT COUNT(*) AS n FROM sends WHERE status = 'sent' AND channel IN ('email', 'manual_email') AND sent_at > datetime('now', '-30 days')`);
  out(`STOP replies: check the mailbox — ${plural(n, "email")} in 30 days → ${SITE}/admin/optouts`);
});

section("Purge last ran", ["settings"], () => {
  const v = one(`SELECT value FROM settings WHERE key = 'purge_last_run_at'`)?.value ?? null;
  const ms = v ? Date.parse(`${v.replace(" ", "T")}Z`) : NaN;
  if (Number.isNaN(ms)) {
    out(`⚠️ Purge last ran: never — retention depends on the daily purge, check the scheduler`);
    return;
  }
  const age = Math.floor((Date.now() - ms) / 86400000);
  const stale = Date.now() - ms > 2 * 86400000;
  out(`${stale ? "⚠️ " : ""}Purge last ran: ${age === 0 ? "today" : `${plural(age, "day")} ago`}${stale ? " — check the scheduler" : ""}`);
});

section("Enquiries not yet in Leads", ["enquiries"], () => {
  const cols = new Set(db.prepare("PRAGMA table_info(enquiries)").all().map((c) => c.name));
  if (!cols.has("lead_id")) {
    out(`Enquiries not yet in Leads: (column not migrated yet)`);
    return;
  }
  const n = count(`SELECT COUNT(*) AS n FROM enquiries WHERE lead_id IS NULL`);
  if (n > 0) out(`Enquiries not yet in Leads: ${n} — run the backfill from ${SITE}/admin`);
});

section("API counters", ["api_usage"], () => {
  for (const [label, day] of [["yesterday", YDAY_UTC], ["today", TODAY_UTC]]) {
    const rows = db.prepare(`SELECT provider, count FROM api_usage WHERE day = ? ORDER BY provider`).all(day);
    out(`API counters (${label}): ${rows.length ? rows.map((r) => `${r.provider} ${r.count}`).join(" · ") : "none"}`);
  }
});

db.close();
const report = lines.join("\n");
process.stdout.write(`${report}\n`);

// ---- optional Telegram push (same CLI as src/lib/notify.ts) -----------------------------

if (args.includes("--telegram")) {
  const child = spawn("/home/hermes/.local/bin/hermes", ["send", "-t", "telegram", "-q"], {
    env: { ...process.env, HOME: process.env.HOME || "/home/hermes" },
    stdio: ["pipe", "ignore", "inherit"],
  });
  const kill = setTimeout(() => child.kill("SIGKILL"), 20000);
  child.on("error", (e) => console.error(`digest: telegram send failed: ${e.message}`));
  child.on("exit", (code) => {
    clearTimeout(kill);
    if (code !== 0) console.error(`digest: hermes send exited ${code}`);
  });
  child.stdin.write(report);
  child.stdin.end();
}
