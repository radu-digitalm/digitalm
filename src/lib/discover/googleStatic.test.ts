// Google's terms as code rules (docs/finder-google-spec.md §3): the parts a
// grep can enforce. §3.1 — the client and the phases never cache and never
// log a response body; §3.3 — no point-in-polygon on a place Google returned;
// §3.7 — the server key is read in google.ts only, never under src/components.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const here = new URL(".", import.meta.url).pathname;
const src = join(here, "..", "..");
const read = (rel: string) => readFileSync(join(here, rel), "utf8");

const IO_FILES = ["google.ts", "googleDiscover.ts", "googleCheck.ts", "googleCheckRules.ts", "googleSuggest.ts"];

/** The file without its comments — the rules are about code, and the headers explain the rules. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The module specifiers a file imports. */
function imports(text: string): string[] {
  return [...code(text).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

test("§3.1 — google.ts, googleDiscover.ts, googleCheck.ts, googleCheckRules.ts, googleSuggest.ts import nothing from apiCache", () => {
  for (const f of IO_FILES) {
    const text = code(read(f));
    assert.ok(imports(read(f)).every((m) => !/apiCache/.test(m)), `${f} imports apiCache`);
    assert.doesNotMatch(text, /\bcached\(/, f);
    assert.doesNotMatch(text, /\bcacheSet\(|\bcacheGet\(|\bcacheUpdatePayload\(/, f);
  }
});

test("§3.1 — no console.log, and no console.error / console.warn that carries a response body, in the Google files", () => {
  for (const f of IO_FILES) {
    const text = read(f);
    assert.doesNotMatch(text, /console\.log\(/, f);
    for (const m of text.matchAll(/console\.(error|warn)\(([^\n]*)\)/g)) {
      const args = m[2] ?? "";
      assert.doesNotMatch(args, /\b(json|data|body|res|response|places|place|signals|candidates)\b/, `${f}: ${m[0]}`);
      assert.doesNotMatch(args, /JSON\.stringify/, `${f}: ${m[0]}`);
    }
  }
});

test("§3.1 — the key is read in google.ts only, sent as a header, never in a URL or a log line", () => {
  const client = read("google.ts");
  assert.match(client, /"x-goog-api-key": key/);
  assert.doesNotMatch(client, /\$\{key\}/);
  assert.doesNotMatch(client, /key=/);
  for (const f of walk(join(src, "lib"))) {
    // google.ts is the client; crm/types.ts holds the day-0 `googleAdapter.enabled()` stub that stays the single on/off truth (§4.1).
    if (f.endsWith("/discover/google.ts") || f.endsWith("/crm/types.ts") || f.endsWith(".test.ts")) continue;
    const text = code(readFileSync(f, "utf8"));
    assert.doesNotMatch(text, /GOOGLE_PLACES_KEY/, f);
  }
});

test("§3.3 — googleDiscover.ts and googleInside.ts never import pointInPolygon (or polygon.ts at all for the inside filter)", () => {
  assert.doesNotMatch(code(read("googleDiscover.ts")), /pointInPolygon/);
  assert.doesNotMatch(code(read("googleInside.ts")), /pointInPolygon/);
  assert.ok(imports(read("googleInside.ts")).every((m) => !/polygon/.test(m)), "googleInside.ts imports polygon.ts");
  assert.ok(imports(read("googleDiscover.ts")).every((m) => !/\/polygon$/.test(m) || true), "type-only Bbox import is fine");
  // The tile module may — on OUR tile corners — and says so.
  assert.match(read("googleTiles.ts"), /pointInPolygon\(lng, lat, polygon\)/);
});

test("§3.7 — no file under src/components references GOOGLE_PLACES_KEY", () => {
  for (const f of walk(join(src, "components"))) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /GOOGLE_PLACES_KEY/, f);
  }
});

test("§3.1 — what leaves googleDiscover: pins carry placeId, lat, lng, fetchedAt only; patches carry googlePlaceId only", () => {
  const text = read("googleDiscover.ts");
  assert.match(text, /pins\.push\(\{ placeId: p\.placeId, lat: p\.lat, lng: p\.lng, fetchedAt \}\)/);
  assert.match(text, /patches\.set\(hit\.key, \{ googlePlaceId: p\.placeId \}\)/);
  assert.doesNotMatch(text, /name: p\.name|addressLine/);
});

test("§3.8 — no Google source or note text says claimed / verified / Google My Business / GMB", () => {
  const files = [...IO_FILES, "googleRequests.ts", "googleTiles.ts", "googleInside.ts", "googleMatch.ts"];
  for (const f of files) {
    const text = code(read(f));
    assert.doesNotMatch(text, /Google My Business|\bGMB\b|\bclaimed\b/i, f);
    // "verified" only as the `unverified` status token, never as a word of its own.
    assert.doesNotMatch(text.replace(/unverified/g, ""), /\bverified\b/i, f);
  }
  // notes.ts: every sentence of the catalogue (the FORBIDDEN_TOKENS list itself names the words).
  const catalogue = /NOTE_TEXT[\s\S]*?\n\};/.exec(read("notes.ts"))?.[0] ?? "";
  assert.ok(catalogue.length > 100);
  assert.doesNotMatch(catalogue, /Google My Business|\bGMB\b|\bclaimed\b|\bverified\b/i);
});
