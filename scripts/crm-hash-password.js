#!/usr/bin/env node
// Prints the ADMIN_PASSWORD_HASH line for the shared admin password.
//
//   node scripts/crm-hash-password.js            # prompts, input hidden, Enter to finish
//   printf '%s' 'the password' | node scripts/crm-hash-password.js   # non-interactive
//
// The password is read from stdin only — never from argv, so it never lands in
// the shell history or `ps` output. Format (verified by src/lib/crm/auth.ts):
//   scrypt$16384$8$1$<saltB64>$<hashB64>
// Reminder for .env.local: write every `$` as `\$` — Next's env loader expands
// `$16384` etc. to nothing otherwise and login stays disabled.
"use strict";

const { randomBytes, scryptSync } = require("node:crypto");
const readline = require("node:readline");

if (process.argv.length > 2) {
  console.error("Usage: node scripts/crm-hash-password.js  (reads the password from stdin; no arguments)");
  process.exit(2);
}

function finish(raw) {
  // Strip one trailing newline (typed input); keep every other character.
  const password = raw.replace(/\r?\n$/, "");
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
  const value = `scrypt$16384$8$1$${salt.toString("base64")}$${hash.toString("base64")}`;
  process.stdout.write(`ADMIN_PASSWORD_HASH=${value}\n`);
  process.stdout.write(`# same value, ready to paste into .env.local ($ escaped):\nADMIN_PASSWORD_HASH=${value.replace(/\$/g, "\\$")}\n`);
}

if (process.stdin.isTTY) {
  // Interactive: hidden prompt, Enter finishes (no Ctrl-D needed).
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let muted = false;
  const write = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (s) => { if (!muted) write(s); };
  rl.question("New admin password (hidden, 12+ characters): ", (answer) => {
    muted = false;
    process.stdout.write("\n");
    rl.close();
    finish(answer);
  });
  muted = true;
} else {
  const chunks = [];
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("end", () => finish(chunks.join("")));
}
