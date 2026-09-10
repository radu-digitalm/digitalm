// Human-friendly references for every CRM table: DM- (enquiries), LD- (leads),
// PR- (prospects), AU- (audits), SN- (sends). Same 30-char alphabet as the
// diagnostic references — Crockford base32 minus 0/O/1/I/L, unambiguous over
// the phone — five characters, uniqueness checked in the prefix's own table.
//
// enquiries.ts imports this file and this file imports enquiries.ts: the cycle
// is harmless because enquiriesDb() is only called inside newReference(), never
// at module load.
import { randomInt } from "node:crypto";
import type Database from "better-sqlite3";
import { enquiriesDb } from "@/lib/enquiries";

export type RefPrefix = "DM" | "LD" | "PR" | "AU" | "SN";

export const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

const TABLE: Record<RefPrefix, string> = {
  DM: "enquiries",
  LD: "leads",
  PR: "prospects",
  AU: "audits",
  SN: "sends",
};

/** Matches a reference of any prefix, e.g. "AU-7KQ2M". */
export const REF_RE = /^(DM|LD|PR|AU|SN)-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{5}$/;

export function newReference(prefix: RefPrefix = "DM", db: Database.Database = enquiriesDb()): string {
  const exists = db.prepare(`SELECT 1 FROM ${TABLE[prefix]} WHERE reference = ?`);
  for (let tries = 0; tries < 20; tries++) {
    let ref = `${prefix}-`;
    for (let i = 0; i < 5; i++) ref += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
    if (!exists.get(ref)) return ref;
  }
  // 20 collisions in a row means the table is nearly full — fall back to a
  // time-derived suffix rather than loop forever.
  return `${prefix}-${Date.now().toString(36).toUpperCase().slice(-5)}`;
}
