import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanHashes, missingOptoutHashes, optoutChannelOf, optoutRowsFor } from "./optoutRows.ts";

const E1 = "e".repeat(64);
const E2 = "f".repeat(64);
const P1 = "1".repeat(64);
const P2 = "2".repeat(64);

test("cleanHashes drops blanks and repeats, keeps order", () => {
  assert.deepEqual(cleanHashes([E1, null, "", E1, undefined, E2]), [E1, E2]);
});

test("link opt-out (email) then Mark STOP (email + phone): the phone hash is still listed", () => {
  const afterLink = [{ emailHash: E1, phoneHash: null }];
  const missing = missingOptoutHashes({ emailHashes: [E1], phoneHashes: [P1] }, afterLink);
  assert.deepEqual(missing, { emailHashes: [], phoneHashes: [P1] });
  const rows = optoutRowsFor(missing);
  assert.deepEqual(rows, [{ emailHash: null, phoneHash: P1 }]);
  assert.equal(optoutChannelOf(rows[0]!), "phone");
  // Both hashes are now on the list: a repeat writes nothing.
  assert.deepEqual(missingOptoutHashes({ emailHashes: [E1], phoneHashes: [P1] }, [...afterLink, ...rows]), { emailHashes: [], phoneHashes: [] });
});

test("every known hash of a prospect is listed: override and website email, override and website phone", () => {
  const missing = missingOptoutHashes({ emailHashes: [E1, E2], phoneHashes: [P1, P2] }, []);
  const rows = optoutRowsFor(missing);
  assert.deepEqual(rows, [
    { emailHash: E1, phoneHash: P1 },
    { emailHash: E2, phoneHash: P2 },
  ]);
  assert.equal(optoutChannelOf(rows[0]!), "both");
  // A phone listed on a row that also carries another email still counts as listed.
  assert.deepEqual(missingOptoutHashes({ emailHashes: [E2], phoneHashes: [P1] }, [{ emailHash: E1, phoneHash: P1 }]), { emailHashes: [E2], phoneHashes: [] });
  assert.equal(optoutChannelOf({ emailHash: E2, phoneHash: null }), "email");
  assert.deepEqual(optoutRowsFor({ emailHashes: [], phoneHashes: [] }), []);
});
