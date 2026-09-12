// Playwright acceptance of the map-first finder against staging
// (docs/finder-ux-spec.md §10, items A12–A21; docs/finder-google-spec.md §9,
// items G1, G8, G9 — skipped with "skipped — Google off" unless the finder
// renders the Google map). CommonJS on purpose: NODE_PATH is ignored by ESM imports.
//
//   ADMIN_PASSWORD=… NODE_PATH=/home/hermes/.npm/_npx/fd3bca3c548369c0/node_modules \
//     node scripts/e2e/finder.cjs
//
// Optional: BASE (default https://d3v.digitalm.eu), SHOTS (screenshot dir),
// ONLY=A12,A13 to run a subset. One step per acceptance item prints OK / FAIL
// and the process exits 1 on any failure. Never "networkidle".
const { chromium } = require("playwright-core");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = process.env.BASE || "https://d3v.digitalm.eu";
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!PASSWORD) {
  console.error("ADMIN_PASSWORD is required (the staging admin password; Turnstile test keys accept turnstile:\"e2e\").");
  process.exit(2);
}
const OUT = process.env.SHOTS || path.join(process.env.SCRATCHPAD || os.tmpdir(), "e2e-shots");
fs.mkdirSync(OUT, { recursive: true });
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",").map((s) => s.trim())) : null;

const cache = os.homedir() + "/.cache/ms-playwright/";
const dir = fs.readdirSync(cache).find((d) => d.startsWith("chromium-"));
const exe = [cache + dir + "/chrome-linux/chrome", cache + dir + "/chrome-linux64/chrome"].find((f) => fs.existsSync(f));

const FORBIDDEN = ["OSM", "FR reg.", "partial", "http_", "GOOGLE_PLACES", "no_email", "audit_missing", "call_window_closed", "SMTP off", "caveat"];

const results = [];
async function step(id, name, fn) {
  if (ONLY && !ONLY.has(id)) return;
  const t = Date.now();
  try {
    const info = await fn();
    results.push({ id, name, ok: true, ms: Date.now() - t, info });
    console.log("OK  ", id, name, info ? JSON.stringify(info).slice(0, 240) : "");
  } catch (e) {
    results.push({ id, name, ok: false, ms: Date.now() - t, error: String((e && e.message) || e).slice(0, 400) });
    console.log("FAIL", id, name, String((e && e.message) || e).slice(0, 400));
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-GB" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + ".png"), fullPage: false }).catch(() => null);
  let csrf = "";

  // ---- helpers ----------------------------------------------------------------------------
  async function api(method, url, body) {
    const headers = { "content-type": "application/json", accept: "application/json", origin: BASE };
    if (method === "POST") headers["x-dm-csrf"] = csrf;
    const r = await ctx.request.fetch(BASE + url, { method, headers, data: body ? JSON.stringify(body) : undefined });
    let json = null;
    try {
      json = await r.json();
    } catch {
      /* not JSON */
    }
    return { status: r.status(), json };
  }
  async function goto(url) {
    await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
    await sleep(1200);
  }
  /** A finished Ariège · Restaurant search id: reuse a recent one, else run one (≤ 150 s). */
  let ariegeId = null;
  async function ensureAriege() {
    if (ariegeId) return ariegeId;
    const recent = await api("GET", "/api/admin/find/recent?limit=20");
    const found = ((recent.json && recent.json.searches) || []).find((s) => /ari[eè]ge/i.test(s.areaLabel || s.queryArea) && s.categoryKey === "restaurant" && s.cached && (s.status === "done" || s.status === "partial"));
    if (found) return (ariegeId = found.id);
    let start = await api("POST", "/api/admin/find", { area: "ariege", category: "restaurant" });
    if (start.status === 409 && start.json && start.json.error === "search_running") {
      await api("POST", "/api/admin/find/cancel", { searchId: start.json.searchId });
      await sleep(3000);
      start = await api("POST", "/api/admin/find", { area: "ariege", category: "restaurant" });
    }
    assert(start.status === 202, `start ariege: ${start.status} ${JSON.stringify(start.json).slice(0, 200)}`);
    const id = start.json.searchId;
    const until = Date.now() + 150000;
    while (Date.now() < until) {
      await sleep(3000);
      const r = await api("GET", `/api/admin/find?id=${id}`);
      const st = r.json && r.json.progress && r.json.progress.status;
      if (st && st !== "running") break;
    }
    return (ariegeId = id);
  }
  async function fontPx(locator) {
    return locator.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  }
  async function readability(label) {
    const problems = await page.evaluate((forbidden) => {
      const out = [];
      const main = document.querySelector("main");
      if (!main) return ["no main"];
      const px = (el) => parseFloat(getComputedStyle(el).fontSize);
      const sel = "td, [data-testid=find-row] > div > div:first-child > div:first-child, [data-testid=row-status], .text-fg-muted, p, label, dt, dd, span.rounded-full";
      for (const el of main.querySelectorAll(sel)) {
        if (el.closest(".eyebrow") || el.classList.contains("eyebrow") || el.closest(".leaflet-container") || el.closest("details:not([open])")) continue;
        const text = (el.textContent || "").trim();
        if (!text) continue;
        const size = px(el);
        const isBadge = el.classList.contains("rounded-full") || el.tagName === "TH";
        const isMono = /font-mono|text-\[13px\]/.test(el.className || "");
        const min = isBadge || isMono ? 13 : 14;
        if (size < min) out.push(`${el.tagName}.${(el.className || "").toString().slice(0, 40)} "${text.slice(0, 30)}" ${size}px`);
      }
      for (const el of main.querySelectorAll("input[type=checkbox]")) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.width < 18 || r.height < 18)) out.push(`checkbox ${r.width}x${r.height}`);
      }
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const t = n.textContent.trim();
        if (!t) continue;
        const el = n.parentElement;
        if (!el || el.closest(".leaflet-container") || el.closest("script,style")) continue;
        const cs = getComputedStyle(el);
        if (cs.color === "rgb(134, 143, 159)" && parseFloat(cs.fontSize) < 14) out.push(`faint text under 14px: "${t.slice(0, 30)}"`);
        if (t === "—") out.push(`standalone dash in ${el.tagName}`);
        for (const f of forbidden) {
          const re = f === "partial" ? /\bpartial\b/i : f === "OSM" ? /\bOSM\b/ : new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
          if (re.test(t)) out.push(`forbidden "${f}" in "${t.slice(0, 40)}"`);
        }
      }
      return out;
    }, FORBIDDEN);
    if (problems.length) throw new Error(`${label}: ${problems.slice(0, 8).join(" | ")}`);
    return { label, ok: true };
  }
  async function noSidewaysScroll() {
    const r = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, iw: window.innerWidth, sh: document.scrollingElement.scrollHeight, ih: window.innerHeight }));
    assert(r.sw === r.iw, `sideways scroll: scrollWidth ${r.sw} vs innerWidth ${r.iw}`);
    return r;
  }

  // ---- login ------------------------------------------------------------------------------
  await step("A0", "login + /admin renders", async () => {
    const r = await ctx.request.post(BASE + "/api/admin/login", { headers: { "content-type": "application/json", origin: BASE }, data: { password: PASSWORD, turnstile: "e2e", website: "" } });
    assert(r.status() === 200, `login ${r.status()} ${(await r.text()).slice(0, 120)}`);
    // The first screen after login must be a real page, not a Next error screen (QA round 1: toTodaySummary on the server).
    const res = await page.goto(BASE + "/admin", { waitUntil: "domcontentloaded" });
    await sleep(1200);
    assert(res && res.status() === 200, `/admin answered ${res && res.status()}`);
    assert(!page.url().includes("/admin/login"), "still on the login page");
    const body = (await page.textContent("body")) || "";
    assert(!/couldn.t load|Application error|ERROR \d{5,}/i.test(body), "/admin shows an error screen");
    assert((await page.locator("[data-testid=today-card]").count()) === 5, "Today cards missing");
    csrf = await page.getAttribute('meta[name="dm-csrf"]', "content");
    assert(csrf, "no csrf meta");
    return { url: page.url(), status: res.status() };
  });

  // ---- A12 map present --------------------------------------------------------------------
  await step("A12", "map present", async () => {
    const id = await ensureAriege();
    await goto(`/admin/find?search=${id}`);
    await page.waitForFunction(() => window.__dmFindPins && window.__dmFindPins.total > 0, null, { timeout: 60000 });
    await sleep(1500);
    await shot("A12-ariege-map");
    const containers = await page.locator(".leaflet-container").count();
    assert(containers === 1, `leaflet containers: ${containers}`);
    const outline = await page.locator(".leaflet-overlay-pane path, .leaflet-overlay-pane canvas").count();
    assert(outline >= 1, "no outline path/canvas");
    // Register entries that are not listed publicly stay out of the way by default (no row, no pin); their chip brings them back.
    const pins = await page.evaluate(() => window.__dmFindPins);
    assert(pins.total >= 200, `pins.total ${pins.total}`);
    const notListedChip = page.getByRole("button", { name: /^Not listed publicly/ });
    if (await notListedChip.count()) {
      await notListedChip.click();
      await sleep(600);
      const more = await page.evaluate(() => window.__dmFindPins);
      assert(more.total > pins.total, `Not listed publicly chip: pins ${pins.total} → ${more.total}`);
      await notListedChip.click();
      await sleep(400);
    }
    const attr = await page.locator(".leaflet-control-attribution").textContent();
    assert(/OpenStreetMap contributors/.test(attr || ""), "attribution missing");
    return { id, pins };
  });

  // ---- A13 interaction ----------------------------------------------------------------------
  await step("A13", "row → card, Esc, pin click", async () => {
    const id = await ensureAriege();
    await goto(`/admin/find?search=${id}`);
    await page.waitForSelector("[data-testid=find-row]", { timeout: 60000 });
    // The first row that is not already a prospect (A14 of an earlier run may have saved the first one).
    const row = page.locator("[data-testid=find-row]").filter({ hasNot: page.locator("[data-testid=row-status]", { hasText: /^Saved/ }) }).first();
    const name = (await row.locator("[data-testid=row-name]").first().textContent()).trim();
    await row.click();
    const dialog = page.locator("[role=dialog][data-testid=business-card]");
    await dialog.waitFor({ timeout: 5000 });
    await shot("A13-card");
    const labelledBy = await dialog.getAttribute("aria-labelledby");
    const accName = (await page.locator(`#${labelledBy}`).textContent()).trim();
    assert(accName === name, `dialog name "${accName}" vs row "${name}"`);
    const saveBtn = dialog.getByRole("button", { name: /^Save( & audit)?$/ });
    assert((await saveBtn.count()) === 1, "no Save button");
    assert((await dialog.getByRole("button", { name: "Not this one", exact: true }).count()) === 1, "no Not this one");
    const text = await dialog.textContent();
    assert(/km from the centre of Ari/.test(text), "no distance sentence");
    assert((await dialog.locator('a[href*="openstreetmap.org"]').count()) >= 1, "no openstreetmap link");
    await page.keyboard.press("Escape");
    await sleep(300);
    assert((await dialog.count()) === 0, "dialog still open after Escape");
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-testid"));
    assert(focused === "find-row", `focus is on ${focused}`);
    // Pin click: a visible pin (not clustered) → dialog for that business. With the register rows savable the
    // map carries ~560 pins and nearly all sit in clusters, so the list is filtered to one name first.
    await page.fill('input[type="search"]', name);
    await sleep(600);
    const key = await page.evaluate(() => {
      for (const el of document.querySelectorAll("[data-testid=find-row]")) {
        const k = el.getAttribute("data-key");
        const p = window.__dmFindProject(k);
        if (p && p.x > 20 && p.y > 20) return k;
      }
      return null;
    });
    assert(key, "no projectable pin");
    const box = await page.locator("[data-testid=find-map] .leaflet-container").boundingBox();
    const pt = await page.evaluate((k) => window.__dmFindProject(k), key);
    await page.mouse.click(box.x + pt.x, box.y + pt.y);
    await dialog.waitFor({ timeout: 5000 });
    const rowName = (await page.locator(`[data-testid=find-row][data-key="${key}"] [data-testid=row-name]`).first().textContent()).trim();
    const labelledBy2 = await dialog.getAttribute("aria-labelledby");
    const accName2 = (await page.locator(`#${labelledBy2}`).textContent()).trim();
    assert(accName2 === rowName, `pin dialog "${accName2}" vs row "${rowName}"`);
    const rowBox = await page.locator(`[data-testid=find-row][data-key="${key}"]`).boundingBox();
    const listBox = await page.locator("[data-testid=find-list]").boundingBox();
    assert(rowBox && listBox && rowBox.y >= listBox.y - 1 && rowBox.y + rowBox.height <= listBox.y + listBox.height + 1, "row not inside the list pane");
    await shot("A13-pin-card");
    await page.keyboard.press("Escape");
    await page.fill('input[type="search"]', "");
    return { name, key };
  });

  // ---- A13b the whole row opens the card ----------------------------------------------------
  await step("A13b", "a click on the centre of a row with a website opens the card", async () => {
    const id = await ensureAriege();
    await goto(`/admin/find?search=${id}`);
    await page.waitForSelector("[data-testid=find-row]", { timeout: 60000 });
    // QA round 2: the centre of a three-line row landed on the domain link instead of opening the card.
    const row = page.locator("[data-testid=find-row]").filter({ has: page.locator("[data-testid=row-site]") }).first();
    assert((await row.count()) === 1, "no row with a website");
    assert((await row.locator("a[href^='http']").count()) === 0, "the row still carries an external link");
    const name = (await row.locator("[data-testid=row-name]").first().textContent()).trim();
    const box = await row.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const dialog = page.locator("[role=dialog][data-testid=business-card]");
    await dialog.waitFor({ timeout: 5000 });
    const labelledBy = await dialog.getAttribute("aria-labelledby");
    const accName = (await page.locator(`#${labelledBy}`).textContent()).trim();
    assert(accName === name, `dialog name "${accName}" vs row "${name}"`);
    assert((await dialog.locator("a[href^='http']").count()) >= 1, "the card has no website link");
    await page.keyboard.press("Escape");
    return { name };
  });

  // ---- A14 save from the card ---------------------------------------------------------------
  let savedProspectId = null;
  await step("A14", "save from the card", async () => {
    const id = await ensureAriege();
    await goto(`/admin/find?search=${id}`);
    await page.waitForSelector("[data-testid=find-row]", { timeout: 60000 });
    // First row whose card offers an enabled Save & audit.
    const rows = page.locator("[data-testid=find-row]");
    const n = Math.min(await rows.count(), 40);
    let picked = null;
    for (let i = 0; i < n; i++) {
      await rows.nth(i).click();
      const dialog = page.locator("[role=dialog][data-testid=business-card]");
      await dialog.waitFor({ timeout: 5000 });
      const btn = dialog.getByRole("button", { name: "Save & audit" });
      if ((await btn.count()) === 1 && (await btn.isEnabled())) {
        picked = i;
        break;
      }
      await page.keyboard.press("Escape");
      await sleep(150);
    }
    assert(picked !== null, "no savable row with a website in the first 40");
    const key = await rows.nth(picked).getAttribute("data-key");
    await page.getByRole("button", { name: "Save & audit" }).click();
    const toast = page.locator("[role=status]").filter({ hasText: /^Saved/ });
    await toast.first().waitFor({ timeout: 15000 });
    const link = page.locator("[role=dialog] a", { hasText: "Open prospect" });
    await link.waitFor({ timeout: 10000 });
    const href = await link.getAttribute("href");
    assert(/^\/admin\/prospects\/\d+$/.test(href), `open prospect href ${href}`);
    savedProspectId = Number(href.split("/").pop());
    const status = (await page.locator(`[data-testid=find-row][data-key="${key}"] [data-testid=row-status]`).textContent()).trim();
    assert(/^Saved · PR-/.test(status), `row status "${status}"`);
    await shot("A14-saved");
    await page.keyboard.press("Escape");
    return { key, href };
  });

  // ---- A15 progress ---------------------------------------------------------------------------
  await step("A15", "progress while searching", async () => {
    await goto("/admin/find");
    await page.fill('input[name="area"]', "Foix");
    await page.click("[data-testid=find-submit]");
    let sawBar = false;
    let sawStop = false;
    let text = "";
    const watch = async () => {
      const until = Date.now() + 90000;
      while (Date.now() < until) {
        const bar = page.locator("[role=progressbar][aria-valuemax]");
        if ((await bar.count()) > 0) {
          const max = Number(await bar.first().getAttribute("aria-valuemax"));
          const label = (await bar.first().getAttribute("aria-label")) || "";
          const status = (await page.locator("main").textContent()) || "";
          if (max >= 1 && /Searching OpenStreetMap|Checking the French company register/.test(label + status)) {
            sawBar = true;
            text = label;
          }
        }
        if (((await page.locator("[data-testid=find-submit]").textContent()) || "").trim() === "Stop") sawStop = true;
        if ((await page.locator("[data-testid=find-status]").count()) > 0) break;
        await sleep(250);
      }
    };
    await watch();
    // A cached Foix answers within one poll: "Run again" (every source read anew) gives a real run to watch.
    if (!sawBar && (await page.locator("[data-testid=run-again]").count()) > 0) {
      await page.locator("[data-testid=run-again]").click();
      await page.waitForFunction(() => document.querySelector("[data-testid=find-status]") === null, null, { timeout: 30000 }).catch(() => null);
      await watch();
    }
    await shot("A15-progress");
    const final = ((await page.locator("[data-testid=find-status]").textContent()) || "").trim();
    assert(/^Foix — town, France · \d[\d,]* restaurants?/.test(final), `final status "${final}"`);
    // The onboarding lines leave once a search exists; the map starts high on the page.
    assert((await page.getByText("Public sources only", { exact: false }).count()) === 0, "helper line still shown with results");
    const mapTop = (await page.locator("[data-testid=find-map]").boundingBox()).y;
    assert(mapTop < 270, `map starts at y=${Math.round(mapTop)}`); // 211 without, 241 with the "Not this place?" line (was 296–356)
    assert(sawBar, "never saw the progress bar with its text");
    assert(sawStop, "Search button never read Stop");
    return { text, final };
  });

  // ---- A16 readability --------------------------------------------------------------------------
  await step("A16", "readability on find, prospects, prospect", async () => {
    const id = await ensureAriege();
    await goto(`/admin/find?search=${id}`);
    await page.waitForSelector("[data-testid=find-row]", { timeout: 60000 });
    await readability("find");
    await goto("/admin/prospects?view=all");
    await readability("prospects");
    const pid = savedProspectId || (await page.evaluate(() => {
      const a = document.querySelector('main a[href^="/admin/prospects/"]');
      return a ? Number(a.getAttribute("href").split("/").pop()) : null;
    }));
    assert(pid, "no prospect to open");
    await goto(`/admin/prospects/${pid}`);
    await sleep(2500);
    await readability("prospect");
    return { pid };
  });

  // ---- A17 chips and filters ----------------------------------------------------------------------
  await step("A17", "chips, hidden + undo, town sort", async () => {
    const id = await ensureAriege();
    await goto(`/admin/find?search=${id}`);
    await page.waitForSelector("[data-testid=find-row]", { timeout: 60000 });
    await page.waitForFunction(() => window.__dmFindPins && window.__dmFindPins.total > 0);
    const before = await page.evaluate(() => ({ rows: document.querySelectorAll("[data-testid=find-row]").length, pins: window.__dmFindPins.total }));
    await page.getByRole("button", { name: /^Has website/ }).click();
    await sleep(500);
    const after = await page.evaluate(() => ({ rows: document.querySelectorAll("[data-testid=find-row]").length, pins: window.__dmFindPins.total, withLink: [...document.querySelectorAll("[data-testid=find-row]")].filter((r) => r.querySelector("[data-testid=row-site]")).length }));
    assert(after.rows < before.rows || after.rows === after.withLink, `rows ${before.rows} → ${after.rows}`);
    assert(after.rows === after.withLink, `${after.rows - after.withLink} rows without a website`);
    assert(after.pins <= before.pins, `pins ${before.pins} → ${after.pins}`);
    await page.getByRole("button", { name: /^Has website/ }).click();
    // The chips wrap: no sideways scroll, three primary chips, the other six behind "More filters" (QA round 2).
    const chipsBox = async () => page.locator('[role=group][aria-label="Filters"]').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, chips: el.querySelectorAll("button[aria-pressed]").length }));
    const folded = await chipsBox();
    assert(folded.sw <= folded.cw + 1, `filters scroll sideways (${folded.sw} > ${folded.cw})`);
    assert(folded.chips === 3, `${folded.chips} chips before More filters`);
    await page.locator("[data-testid=more-filters]").click();
    const unfolded = await chipsBox();
    assert(unfolded.sw <= unfolded.cw + 1, `unfolded filters scroll sideways (${unfolded.sw} > ${unfolded.cw})`);
    assert(unfolded.chips === 9, `${unfolded.chips} chips after More filters`);
    for (const label of ["Has phone", "Has email", "In the register", "Saved", "Not listed publicly", "Hidden"]) assert((await page.getByRole("button", { name: new RegExp(`^${label} \\(`) }).count()) === 1, `chip ${label} missing`);
    // The register chip counts the merged rows too: nothing reads "In the register (0)" for a French department.
    const reg = (await page.getByRole("button", { name: /^In the register \(/ }).textContent()).trim();
    assert(!/\(0\)/.test(reg), `register chip reads "${reg}"`);
    await page.locator("[data-testid=more-filters]").click();
    // Dismiss one row, then show Hidden → Undo control.
    const row = page.locator("[data-testid=find-row]").nth(1);
    const key = await row.getAttribute("data-key");
    const rowName = (await row.locator("[data-testid=row-name]").first().textContent()).trim();
    await row.click();
    await page.getByRole("button", { name: "Not this one", exact: true }).click();
    await sleep(800);
    await page.keyboard.press("Escape");
    // "Hidden" sits behind "More filters" until it is on.
    if ((await page.getByRole("button", { name: /^Hidden \(/ }).count()) === 0) await page.locator("[data-testid=more-filters]").click();
    await page.getByRole("button", { name: /^Hidden/ }).click();
    await sleep(400);
    // Hidden rows sink to the bottom of every sort (QA round 1): find the row through the name filter.
    await page.fill('input[type="search"]', rowName);
    await sleep(500);
    const hiddenRow = page.locator(`[data-testid=find-row][data-key="${key}"]`);
    assert((await hiddenRow.count()) === 1, "dismissed row not shown with the Hidden chip");
    assert((await hiddenRow.getByRole("button", { name: "Undo", exact: true }).count()) === 1, "no Undo control");
    await hiddenRow.getByRole("button", { name: "Undo", exact: true }).click();
    await sleep(600);
    await page.fill('input[type="search"]', "");
    await sleep(300);
    await page.getByRole("button", { name: /^Hidden/ }).click();
    await page.selectOption('select[name="sort"]', "town");
    await sleep(400);
    const headers = await page.locator("[data-testid=find-list] .sticky").allTextContents();
    assert(headers.length >= 2 && headers.every((h) => /\(\d+\)$/.test(h.trim())), `town headers ${JSON.stringify(headers.slice(0, 3))}`);
    await shot("A17-town-sort");
    return { before, after, headers: headers.slice(0, 3) };
  });

  // ---- A18 over-cap gate --------------------------------------------------------------------------
  await step("A18", "over-cap gate for Occitanie", async () => {
    await goto("/admin/find");
    await page.fill('input[name="area"]', "Occitanie");
    await page.click("[data-testid=find-submit]");
    const gate = page.locator("[data-testid=cap-gate]");
    await gate.waitFor({ timeout: 30000 });
    await shot("A18-gate");
    const text = await gate.textContent();
    assert(/One search holds 2,000/.test(text), "gate sentence missing");
    const children = await page.locator("[data-testid=cap-child]").count();
    assert(children === 13, `cap-child count ${children}`);
    const cont = (await page.locator("[data-testid=cap-continue]").textContent()).trim();
    assert(cont === "Continue with the 2,000 nearest the centre", `continue reads "${cont}"`);
    assert((await page.locator("[role=progressbar]").count()) === 0, "a progressbar showed before a choice");
    await page.locator("[data-testid=cap-child]", { hasText: /^Ari[eè]ge$/ }).click();
    await page.waitForFunction(() => /Ari[eè]ge — department/.test(document.querySelector("main").textContent), null, { timeout: 30000 });
    return { children };
  });

  // ---- A19 mobile ---------------------------------------------------------------------------------
  await step("A19", "mobile 390×844", async () => {
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-GB" });
    const mp = mctx.request;
    const r = await mp.post(BASE + "/api/admin/login", { headers: { "content-type": "application/json", origin: BASE }, data: { password: PASSWORD, turnstile: "e2e", website: "" } });
    assert(r.status() === 200, "mobile login");
    const m = await mctx.newPage();
    m.setDefaultTimeout(30000);
    const MOBILE_W = 390;
    // A page wider than the phone makes Chrome zoom the whole layout out (innerWidth grows with it),
    // so both numbers are checked against the device width, not against each other.
    const check = async (url) => {
      const res = await m.goto(BASE + url, { waitUntil: "domcontentloaded" });
      await sleep(1500);
      const s = await m.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, iw: window.innerWidth }));
      assert(s.iw === MOBILE_W && s.sw === MOBILE_W, `${url}: wider than the phone — scrollWidth ${s.sw}, innerWidth ${s.iw} (device ${MOBILE_W})`);
      return res ? res.status() : 0;
    };
    const id = await ensureAriege();
    await check("/admin");
    await check("/admin/prospects?view=all");
    const pid = savedProspectId || (await m.evaluate(() => {
      const a = document.querySelector('main a[href^="/admin/prospects/"]');
      return a ? Number(a.getAttribute("href").split("/").pop()) : null;
    }));
    if (pid) await check(`/admin/prospects/${pid}`);
    // Every prospect page, not just the newest: the first few by id (a phone "(from the source)" line once overflowed at 418 px).
    for (const extra of [6, 1, 2]) {
      if (extra === pid) continue;
      const probe = await mp.get(BASE + `/admin/prospects/${extra}`);
      if (probe.status() === 200) await check(`/admin/prospects/${extra}`);
    }
    await check("/admin/find");
    await m.getByRole("button", { name: "Menu" }).click();
    await sleep(200);
    for (const label of ["Today", "Leads", "Find", "Prospects", "Opt-outs"]) assert((await m.locator("nav a", { hasText: new RegExp(`^${label}$`) }).count()) >= 1, `menu lacks ${label}`);
    await m.keyboard.press("Escape");
    await m.goto(BASE + `/admin/find?search=${id}`, { waitUntil: "domcontentloaded" });
    // Peeking, the sheet shows only the title and the List / Map control — no rows until List is tapped (QA round 1).
    await m.waitForSelector("[data-testid=find-sheet]", { timeout: 60000 });
    await m.waitForFunction(() => /\d+ \S+ in /.test(document.querySelector("[data-testid=find-sheet]")?.textContent || ""), null, { timeout: 60000 });
    await sleep(1000);
    await m.screenshot({ path: path.join(OUT, "A19-mobile-find.png") });
    assert((await m.locator(".leaflet-container").count()) === 1, "no map on the phone");
    const sheet = m.locator("[data-testid=find-sheet]");
    assert((await sheet.count()) === 1, "no find-sheet");
    assert((await sheet.getByRole("button", { name: "List", exact: true }).count()) >= 1, "no List control");
    const peek = await sheet.evaluate((el) => ({ h: Math.round(el.getBoundingClientRect().height), rows: el.querySelectorAll("[data-testid=find-row]").length }));
    assert(peek.h <= 80 && peek.rows === 0, `peeking sheet is ${peek.h} px with ${peek.rows} rows`);
    const s1 = await m.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, iw: window.innerWidth, sh: document.scrollingElement.scrollHeight, ih: window.innerHeight }));
    assert(s1.sw === MOBILE_W && s1.iw === MOBILE_W, `find results: wider than the phone (${s1.sw} / ${s1.iw})`);
    assert(s1.sh < 3 * s1.ih, `document height ${s1.sh} vs 3×${s1.ih}`);
    await sheet.getByRole("button", { name: "List", exact: true }).first().click();
    await m.waitForSelector("[data-testid=find-row]", { timeout: 60000 });
    await sleep(400);
    await m.locator("[data-testid=find-row]").first().click();
    const dialog = m.locator("[role=dialog][data-testid=business-card]");
    await dialog.waitFor({ timeout: 5000 });
    const box = await dialog.boundingBox();
    assert(box && box.height >= 0.9 * 844, `card height ${box && box.height}`);
    assert((await dialog.getByRole("button", { name: "Close", exact: true }).count()) === 1, "no Close button");
    await m.screenshot({ path: path.join(OUT, "A19-mobile-card.png") });
    await mctx.close();
    return { pid };
  });

  // ---- A20 Today ----------------------------------------------------------------------------------
  await step("A20", "Today cards", async () => {
    await goto("/admin");
    await shot("A20-today");
    const titles = ["Calls to make", "Emails ready to send", "Follow-ups", "Reports opened, no reply", "Notices due within 5 days"];
    const cards = page.locator("[data-testid=today-card]");
    assert((await cards.count()) === 5, `cards ${await cards.count()}`);
    for (let i = 0; i < 5; i++) {
      const c = cards.nth(i);
      assert((await c.evaluate((el) => el.tagName)) === "A", `card ${i} is not a link`);
      const title = c.locator("span").first();
      const t = (await title.textContent()).trim();
      assert(t === titles[i], `card ${i} title "${t}"`);
      const cs = await title.evaluate((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), tt: getComputedStyle(el).textTransform }));
      assert(cs.size >= 16 && cs.tt !== "uppercase", `card ${i} title ${cs.size}px ${cs.tt}`);
    }
    assert((await page.locator("main a", { hasText: /^Find businesses$/ }).count()) === 1, "no Find businesses button");
    const callCount = (await cards.nth(0).locator("span").nth(1).textContent()).trim();
    if (callCount !== "0") assert((await page.locator("main a", { hasText: /^Next call/ }).count()) === 1, "Next call missing while the call list is non-empty");
    const hk = page.locator("details[data-testid=housekeeping]");
    assert((await hk.count()) === 1 && !(await hk.evaluate((el) => el.open)), "Housekeeping missing or open");
    return { callCount };
  });

  // ---- A21 prospect page ----------------------------------------------------------------------------
  await step("A21", "prospect page", async () => {
    await goto("/admin/prospects?view=all&q=Foix");
    let pid = await page.evaluate(() => {
      const a = document.querySelector('main a[href^="/admin/prospects/"]');
      return a ? Number(a.getAttribute("href").split("/").pop()) : null;
    });
    if (!pid) pid = savedProspectId;
    assert(pid, "no Foix prospect");
    await goto(`/admin/prospects/${pid}`);
    await sleep(2500);
    await shot("A21-prospect");
    const header = (await page.locator("main header p").nth(1).textContent()).trim();
    const town = /Foix \(09000\), France/.test(header);
    const strip = page.locator("[data-testid=contact-strip]");
    assert((await strip.count()) === 1, "no contact strip");
    const links = await strip.locator("a").count();
    assert(links >= 1, "contact strip has no links");
    assert((await page.locator(".leaflet-container").count()) === 1, "no mini map");
    const pins = await page.locator("[data-testid=mini-map]").getAttribute("data-pins");
    assert(pins === "1", `mini map pins ${pins}`);
    const open = await page.locator('main a[href^="/admin/find?search="]', { hasText: /^open$/ }).count();
    assert(open === 1, "no 'open' link to the search");
    const reg = (await page.locator("[data-testid=register-sentences]").textContent()).trim();
    assert(/^(Listed in the French company register|Not matched to a register entry yet)/.test(reg), `register sentence "${reg.slice(0, 60)}"`);
    const dashes = await page.locator("main dd", { hasText: /^—$/ }).count();
    assert(dashes === 0, `${dashes} dash values`);
    const mainText = await page.locator("main").textContent();
    assert(/\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}/.test(mainText), "no local date like 12 Sep 2026, 09:04");
    const why = page.locator("main", { hasText: "Why this cannot go out yet" });
    if ((await page.getByText("Why this cannot go out yet").count()) > 0) {
      const items = await page.locator("p:has-text('Why this cannot go out yet') + ul li").allTextContents();
      for (const it of items) assert(!/\b[a-z]+_[a-z_]+\b/.test(it), `refusal shows a code: ${it}`);
    }
    void why;
    return { pid, town, header: header.slice(0, 60) };
  });

  // ---- finder-google (docs/finder-google-spec.md §9): G1 off means unchanged · G8 Google map and cards ·
  // G9 prospect page. G8/G9 run only when the finder renders the Google map (`data-map=google`); otherwise
  // they print "skipped — Google off" (Google off, or the Google map fell back to Leaflet).
  const GOOGLE_WORDS = ["claimed", "verified", "GMB", "Google My Business"];
  let googleOn = false;
  await step("G0", "Google map on?", async () => {
    await goto("/admin/find");
    googleOn = (await page.locator("[data-testid=find-map][data-map=google]").count()) === 1;
    return { googleOn };
  });
  async function gstep(id, name, fn) {
    if (ONLY && !ONLY.has(id)) return;
    if (!googleOn) {
      results.push({ id, name, ok: true, ms: 0, info: "skipped — Google off" });
      console.log("SKIP", id, name, "skipped — Google off");
      return;
    }
    await step(id, name, fn);
  }
  async function clickPin(key) {
    const box = await page.locator("[data-testid=find-map]").boundingBox();
    const pt = await page.evaluate((k) => window.__dmFindProject(k), key);
    assert(pt, `pin ${key} is clustered or off the map`);
    await page.mouse.click(box.x + pt.x, box.y + pt.y);
    await sleep(600);
  }

  // ---- G1 off means unchanged ----------------------------------------------------------------------
  await step("G1", "off means unchanged", async () => {
    if (googleOn) return { skipped: "Google on" };
    await goto("/admin/find");
    assert((await page.locator(".leaflet-container").count()) === 1, "no Leaflet map with Google off");
    assert((await page.locator("input[name=area]").count()) === 1, "the Area box is not a plain input");
    assert((await page.locator("gmp-basic-place-autocomplete").count()) === 0, "a Google element is on the page with Google off");
    const id = await ensureAriege();
    const r = await api("GET", `/api/admin/find?id=${id}`);
    assert(r.status === 200, `GET ?id ${r.status}`);
    assert(!("googlePins" in r.json), "googlePins present with Google off");
    assert(!(r.json.progress && "google" in r.json.progress), "progress.google present with Google off");
    if (savedProspectId) {
      await goto(`/admin/prospects/${savedProspectId}`);
      assert((await page.locator("[data-testid=google-block]").count()) === 0, "google-block present with Google off");
    }
    return { id, prospect: savedProspectId };
  });

  // ---- G8 Google map and cards ---------------------------------------------------------------------
  await gstep("G8", "Google map, pins, Google-only card", async () => {
    const id = await ensureAriege();
    await goto(`/admin/find?search=${id}`);
    await sleep(4000);
    await shot("G8-google-map");
    assert((await page.locator(".leaflet-container").count()) === 0, "a Leaflet map rendered with Google on");
    const region = page.locator('div[aria-label="Map of the businesses found"]');
    assert((await region.count()) === 1, "no map region");
    assert((await region.locator("gmp-advanced-marker, .dm-gcluster").count()) > 0, "no markers and no discs");
    const pins = await page.evaluate(() => window.__dmFindPins);
    assert(pins && pins.total >= 250, `pins ${JSON.stringify(pins)}`);
    // A second search from the same page: the past-searches list opens one → still one Map instance.
    const past = page.locator("[data-testid=past-searches]");
    await past.locator("summary").click();
    const rows = past.locator("li button");
    if ((await rows.count()) > 0) {
      await rows.first().click();
      await sleep(3000);
    }
    const loads = await page.evaluate(() => window.__dmGmapLoads);
    assert(loads === 1, `map loads ${loads}`);
    await goto(`/admin/find?search=${id}`);
    await sleep(4000);
    const r = await api("GET", `/api/admin/find?id=${id}`);
    const osm = (r.json.rows || []).find((x) => x.geoSource === "source" && !x.hidden && (x.key || "").startsWith("osm:"));
    assert(osm, "no OpenStreetMap row with a pin");
    await page.evaluate(() => window.scrollTo(0, 0));
    let opened = false;
    for (let i = 0; i < 3 && !opened; i++) {
      const pt = await page.evaluate((k) => window.__dmFindProject(k), osm.key);
      if (!pt) {
        // Clustered: select it from the list first (the selected pin leaves its cluster), then click the pin itself.
        const row = page.locator(`[data-testid=find-row][data-key="${osm.key}"]`);
        if ((await row.count()) === 0) break;
        await row.scrollIntoViewIfNeeded();
        await row.click();
        await page.keyboard.press("Escape");
        await sleep(600);
        continue;
      }
      await clickPin(osm.key);
      opened = (await page.locator("[data-testid=business-card]").count()) === 1;
    }
    assert(opened, "clicking an OpenStreetMap pin did not open the business card");
    await page.keyboard.press("Escape");
    await sleep(300);
    const gp = (r.json.googlePins || []).find((p) => !p.hidden && !p.saved);
    if (!gp) return { pins: pins.total, loads, note: "no Google-only pins in this search (discovery off)" };
    const gkey = `google:${gp.placeId}`;
    let pt = await page.evaluate((k) => window.__dmFindProject(k), gkey);
    if (!pt) {
      // Zoom in on the pin so it leaves its cluster.
      await page.evaluate((p) => {
        const el = document.querySelector("[data-testid=find-map] > div");
        const m = el && el.__dmMap;
        if (m) {
          m.setCenter({ lat: p.lat, lng: p.lng });
          m.setZoom(17);
        }
      }, gp);
      await sleep(1500);
      pt = await page.evaluate((k) => window.__dmFindProject(k), gkey);
    }
    assert(pt, "the Google-only pin could not be projected");
    await clickPin(gkey);
    const card = page.locator("[data-testid=google-only-card]");
    assert((await card.count()) === 1, "no Google-only card");
    await shot("G8-google-only-card");
    const title = (await card.locator("h2").textContent()).trim();
    assert(title === "On Google only", `card title "${title}"`);
    assert((await card.locator("gmp-place-details").count()) === 1, "no full gmp-place-details element");
    assert((await card.locator("gmp-place-details gmp-place-content-config").count()) === 1, "no gmp-place-content-config child");
    assert((await card.locator('a[href*="google.com/maps/place/?q=place_id:"]').count()) >= 1, "no View on Google Maps link");
    // No text node of the card outside Google's element equals the listing's heading (the panel shows the name, we never do).
    const ours = await card.evaluate((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const out = [];
      let n;
      while ((n = walker.nextNode())) if (!n.parentElement.closest("gmp-place-details") && n.textContent.trim()) out.push(n.textContent.trim());
      return out;
    });
    const heading = await card.locator("gmp-place-details").evaluate((el) => (el.shadowRoot && el.shadowRoot.querySelector("h1, h2, h3, [role=heading]") ? el.shadowRoot.querySelector("h1, h2, h3, [role=heading]").textContent.trim() : null));
    if (heading) assert(!ours.includes(heading), `our text repeats the listing's name: ${heading}`);
    await card.locator("[data-testid=google-add-by-url]").click();
    await sleep(300);
    assert((await card.locator("[data-testid=add-by-url] input[name=name]").count()) === 0, "the Add form has a name field");
    assert((await card.locator("[data-testid=add-by-url] input[name=url]").count()) === 1, "the Add form has no website field");
    await page.keyboard.press("Escape");
    await sleep(300);
    const before = (await page.evaluate(() => window.__dmFindPins)).total;
    await page.locator("button", { hasText: /^Only on Google/ }).first().click();
    await sleep(800);
    const after = (await page.evaluate(() => window.__dmFindPins)).total;
    assert(after < before, `the chip did not hide the blue pins (${before} → ${after})`);
    return { pins: pins.total, loads, googlePins: (r.json.googlePins || []).length, ours: ours.length };
  });

  // ---- G9 prospect page ------------------------------------------------------------------------------
  await gstep("G9", "prospect page Google section", async () => {
    const id = await ensureAriege();
    const r = await api("GET", `/api/admin/find?id=${id}`);
    const row = (r.json.rows || []).find((x) => x.googlePlaceId && x.alreadySaved);
    if (!row) return { note: "no saved row with a place id in this search" };
    const pid = row.alreadySaved.prospectId;
    await goto(`/admin/prospects/${pid}`);
    await sleep(2500);
    await shot("G9-prospect-google");
    const block = page.locator("[data-testid=google-block]");
    assert((await block.count()) === 1, "no google-block");
    assert(await block.evaluate((el) => el.tagName === "DETAILS" && !el.open), "google-block is not a collapsed details");
    const order = await page.evaluate(() => {
      const els = [...document.querySelectorAll("main section, main details[data-testid=google-block]")];
      const a = els.findIndex((e) => e.tagName === "SECTION" && /^Audit/.test((e.querySelector("h2") || {}).textContent || ""));
      const g = els.findIndex((e) => e.dataset && e.dataset.testid === "google-block");
      return { a, g };
    });
    assert(order.a >= 0 && order.g > order.a, `block order ${JSON.stringify(order)}`);
    const before = await page.locator("main").textContent();
    for (const w of ["website on the listing", "opening hours filled in", "no opening hours", "reviews", "photos"]) assert(!before.includes(w), `signal word before opening: ${w}`);
    assert((await page.locator('main img[src*="google-maps-logo"]').count()) === 0, "a Google Maps logo before opening");
    const mini = page.locator("[data-testid=mini-map]").first();
    const hadMini = (await mini.count()) === 1;
    await block.locator("summary").click();
    await sleep(600);
    if (hadMini) assert(!(await mini.isVisible()), "the mini map is still visible while the Google section is open");
    const status = (await page.locator("[data-testid=google-status]").textContent()).trim();
    assert(/^(Listing found|No listing found|No match found automatically|Not checked)/.test(status), `status "${status}"`);
    assert((await page.locator("[data-testid=google-status] [data-testid=google-attribution]").count()) === 0, "an attribution mark next to the status word");
    if ((await page.locator("[data-testid=google-signals]").count()) === 1) assert((await page.locator('[data-testid=google-signals] img[src*="google-maps-logo"]').count()) === 1, "signal words without the Google Maps logo");
    assert((await page.locator("main a", { hasText: /^View on Google Maps$/ }).count()) >= 1, "no View on Google Maps link");
    const text = await page.locator("main").textContent();
    for (const w of GOOGLE_WORDS) assert(!new RegExp(`\\b${w}\\b`, w === "GMB" ? "" : "i").test(text), `forbidden word on the page: ${w}`);
    await block.locator("summary").click();
    await sleep(400);
    if (hadMini) assert(await mini.isVisible(), "the mini map did not come back");
    return { pid, status };
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(OUT, "finder-e2e.json"), JSON.stringify(results, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} OK · screenshots in ${OUT}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
