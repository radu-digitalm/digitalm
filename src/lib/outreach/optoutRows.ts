// Pure part of the opposition list (contract §9 "Opt-out"): given the hashes a
// caller wants listed and the rows already on the list, which hashes are
// missing and how they become rows. Every hash handed in ends up on the list
// — the list is the record that outlives the purge, so a STOP must never be
// dropped because the *other* hash of the same contact was listed earlier
// (link opt-out by email first, Mark STOP with email + phone later). No DB,
// no next/*: node --test loads it.
import type { OptoutChannel } from "./optout.ts";

export interface HashPair {
  emailHash: string | null;
  phoneHash: string | null;
}

export interface WantedHashes {
  emailHashes: readonly (string | null | undefined)[];
  phoneHashes: readonly (string | null | undefined)[];
}

/** De-duplicated, non-empty hashes in the order given. */
export function cleanHashes(list: readonly (string | null | undefined)[]): string[] {
  return [...new Set(list.filter((h): h is string => typeof h === "string" && h.length > 0))];
}

/** The wanted hashes not carried by any listed row, per column. */
export function missingOptoutHashes(wanted: WantedHashes, listed: readonly HashPair[]): { emailHashes: string[]; phoneHashes: string[] } {
  const emails = new Set(listed.map((r) => r.emailHash).filter((h): h is string => !!h));
  const phones = new Set(listed.map((r) => r.phoneHash).filter((h): h is string => !!h));
  return {
    emailHashes: cleanHashes(wanted.emailHashes).filter((h) => !emails.has(h)),
    phoneHashes: cleanHashes(wanted.phoneHashes).filter((h) => !phones.has(h)),
  };
}

/** One row per missing hash, an email and a phone paired on the same row when both are missing. */
export function optoutRowsFor(missing: { emailHashes: readonly string[]; phoneHashes: readonly string[] }): HashPair[] {
  const rows: HashPair[] = [];
  for (let i = 0; i < Math.max(missing.emailHashes.length, missing.phoneHashes.length); i++) {
    rows.push({ emailHash: missing.emailHashes[i] ?? null, phoneHash: missing.phoneHashes[i] ?? null });
  }
  return rows;
}

export function optoutChannelOf(row: HashPair): OptoutChannel {
  return row.emailHash && row.phoneHash ? "both" : row.phoneHash ? "phone" : "email";
}
