import { test } from "node:test";
import assert from "node:assert/strict";
import { clearance } from "./consentClearance.ts";
import type { ConsentBox } from "./consentClearance.ts";

// A cheap Android and a desktop, as measured on the pages the ads point at.
const PHONE = { base: 0, view: 640, bar: 105, reach: 210 };
const DESKTOP = { base: 0, view: 900, bar: 74, reach: 148 };

const at = (top: number, height: number): ConsentBox => ({ top, height });

test("leaves the page alone when the bar is covering nothing", () => {
  assert.equal(clearance({ ...PHONE, boxes: [at(100, 48), at(300, 48)] }), 0);
});

test("frees the check-up page's Start button", () => {
  // 360x640 /fr/diagnostic: the button sits at 547-595, the bar's top at 535.
  const move = clearance({ ...PHONE, boxes: [at(547, 48)] });
  assert.equal(move, 60);
  // A thumb's worth of it is now above the bar, so its centre is well clear.
  assert.ok(547 - move + 24 < PHONE.view - PHONE.bar);
});

test("does not move a page whose controls are all below the fold", () => {
  // 1280x900 /fr/book once the form has finished drawing: the submit button
  // sits at 906-950, below the fold and reachable by scrolling. Moving the
  // page down is what used to drag it under the bar.
  assert.equal(clearance({ ...DESKTOP, boxes: [at(906, 44)] }), 0);
});

test("refuses a move that would drag the next field under the bar", () => {
  // 360x640 /fr/book: freeing the e-mail field at 545 by 58px would land the
  // phone field at 660 inside the bar, and there is no room to step past it.
  const boxes = [at(545, 50), at(660, 50)];
  assert.equal(clearance({ ...PHONE, reach: 105, boxes }), 0);
});

test("takes the longer step when there is room for one", () => {
  // The same two fields, with the page long enough to step over both.
  const boxes = [at(545, 50), at(660, 50)];
  const move = clearance({ ...PHONE, boxes });
  assert.equal(move, 173);
  for (const box of boxes) {
    const top = box.top - move;
    assert.ok(
      top + Math.min(box.height, 44) <= PHONE.view - PHONE.bar - 4 ||
        top >= PHONE.view,
      `box at ${box.top} is not clear after a move of ${move}`,
    );
  }
});

test("settles for fewer when the bar is taller than the gaps", () => {
  // 390x844 /fr: two stacked hero links and a third control just below the
  // fold. No position of a 115px bar frees all three, so the bar frees the one
  // the visitor meets first and leaves the second where it already was —
  // without pulling the third up into itself.
  const TALL = { base: 0, view: 844, bar: 115, reach: 230 };
  const boxes = [at(758, 44), at(814, 46), at(950, 44)];
  const move = clearance({ ...TALL, boxes });
  assert.equal(move, 77);
  const strip = (v: number) =>
    boxes.filter(
      (b) => b.top + Math.min(b.height, 44) > TALL.view - TALL.bar - 4 + v &&
        b.top < TALL.view + v,
    );
  assert.deepEqual(strip(move), [at(814, 46)]);
  assert.deepEqual(strip(0), [at(758, 44), at(814, 46)]);
});

test("frees a thumb's worth of a control taller than the bar", () => {
  // A card-sized link spanning the whole bar can never be cleared outright.
  // Refusing to move at all on its account is what would leave the page's one
  // button underneath the bar, so it is enough to free a thumb of it.
  assert.equal(clearance({ ...PHONE, boxes: [at(500, 300)] }), 13);
});

test("gives a short link daylight when it ends exactly on the bar's top", () => {
  // 1280x900 /fr/diagnostic: footer links flush with the bar's top edge pass a
  // hit test by a pixel. One reflow and they do not.
  assert.equal(clearance({ ...DESKTOP, boxes: [at(809, 17)] }), 4);
});

test("never moves further than it is allowed", () => {
  const boxes = [at(600, 48)];
  assert.equal(clearance({ ...PHONE, reach: 10, boxes }), 0);
  assert.ok(clearance({ ...PHONE, boxes }) <= PHONE.reach);
});

test("works from wherever the visitor already is", () => {
  // The move is always measured from where the page would sit without the bar,
  // never from where an earlier move left it.
  const boxes = [at(1547, 48)];
  assert.equal(clearance({ ...PHONE, base: 1000, boxes }), 60);
});
