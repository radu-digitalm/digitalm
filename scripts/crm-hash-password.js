#!/usr/bin/env node
// Prints the ADMIN_PASSWORD_HASH line for the shared admin password.
//
//   node scripts/crm-hash-password.js            # then type the password + Enter
//   printf '%s' 'the password' | node scripts/crm-hash-password.js
//
// The password is read from stdin only — never from argv, so it never lands in
// the shell history or `ps` output. Format (verified by src/lib/crm/auth.ts):
//   scrypt$16384$8$1$<saltB64>$<hashB64>
"use strict";

const { randomBytes, scryptSync } = require("node:crypto");

if (process.argv.length > 2) {
  console.error("Usage: node scripts/crm-hash-password.js  (reads the password from stdin; no arguments)");
  process.exit(2);
}

const chunks = [];
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  // Strip one trailing newline (typed input); keep every other character.
  const password = chunks.join("").replace(/\r?\n$/, "");
  if (!password) {
    console.error("crm-hash-password: empty password");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("crm-hash-password: use at least 12 characters");
    process.exit(1);
  }
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  process.stdout.write(`ADMIN_PASSWORD_HASH=scrypt$16384$8$1$${salt.toString("base64")}$${hash.toString("base64")}\n`);
});
