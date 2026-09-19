// The geometry behind the one page move the consent bar is allowed to make,
// kept out of the component so it can be reasoned about — and tested — as
// plain numbers.
//
// The bar is fixed to the bottom of the screen and kills the last `bar` pixels
// of it for the thumb. Everything here is in page coordinates: `base` is where
// the page would sit if the bar were not there, and the answer is how much
// further down the page has to sit for the bar to be covering nothing.

// A hair of daylight above the bar, so a control whose bottom edge lands
// exactly on its top still counts as covered.
export const MARGIN = 4;

// A thumb's worth of a control. Anything taller stays usable once that much of
// it is out from under the bar, which keeps one very tall link from making a
// page impossible to free.
export const TAP = 44;

export type ConsentBox = { top: number; height: number };

export type ConsentGeometry = {
  /** Where the page would sit if the bar were not there. */
  base: number;
  /** The height of the screen. */
  view: number;
  /** The height of the bar. */
  bar: number;
  /** How far down the page may be moved, at most. */
  reach: number;
  /** Every control that scrolling can move, in page coordinates. */
  boxes: ConsentBox[];
};

/**
 * The move, between 0 and `reach`, that leaves the bar covering as little as
 * possible. A control counts as free when a thumb's worth of it sits above the
 * bar, or when it is still below the fold and a scroll away.
 *
 * The safety property is the one the page turns on: **a move is only ever
 * committed when every control it leaves covered was already covered where the
 * visitor would have found the page anyway.** Nothing is dragged in from below
 * the fold, nothing that was reachable becomes unreachable, and a page that is
 * fine as it stands is never moved at all. On a page where some position frees
 * everything, that is the position picked; on a dense form where the bar is
 * taller than the gap between two fields, no position does, and the answer is
 * the one that frees the most — starting with whatever the visitor meets first
 * on the way down the screen, since the candidates are tried in order.
 */
export function clearance({
  base,
  view,
  bar,
  reach,
  boxes,
}: ConsentGeometry): number {
  // After a move of `value` the bar covers the strip from top(value) down to
  // fold(value), the bottom of the screen.
  const top = (value: number) => base + value + view - bar - MARGIN;
  const fold = (value: number) => base + value + view;
  const free = (item: ConsentBox) => Math.min(item.height, TAP);
  // Anything already above the strip stays above it whatever we do, and
  // anything below the furthest the page can go never reaches it.
  const near = boxes.filter(
    (item) => item.top + item.height > top(0) && item.top < fold(reach),
  );
  const coveredAt = (value: number) =>
    near.filter(
      (item) => item.top + free(item) > top(value) && item.top < fold(value),
    );
  const here = coveredAt(0);
  if (here.length === 0) return 0;
  const already = new Set(here);
  // The only moves worth trying are the ones that put some control's edge
  // exactly clear of the strip: either its thumb's worth above the bar, or its
  // top back below the fold.
  const gaps: number[] = [];
  for (const item of near) {
    for (const value of [item.top + free(item) - top(0), item.top - fold(0)]) {
      if (value > 0.5 && value <= reach) gaps.push(value);
    }
  }
  gaps.sort((a, b) => a - b);
  let best = 0;
  let fewest = here.length;
  for (const value of gaps) {
    const covered = coveredAt(value);
    // Anything covered here that was not covered before is a control this move
    // would have taken away from the visitor. Not worth having.
    if (covered.some((item) => !already.has(item))) continue;
    if (covered.length < fewest) {
      fewest = covered.length;
      best = value;
      if (fewest === 0) break;
    }
  }
  return best;
}
