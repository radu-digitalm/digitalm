import { test } from "node:test";
import assert from "node:assert/strict";
import { CLUSTER_CELL_PX, CLUSTER_THRESHOLD, clusterPoints, clusterSize, type ProjectedPoint } from "./mapCluster.ts";

function grid(n: number, step: number): ProjectedPoint[] {
  const out: ProjectedPoint[] = [];
  for (let i = 0; i < n; i++) out.push({ key: `k${i}`, x: (i % 40) * step, y: Math.floor(i / 40) * step });
  return out;
}

test("under the threshold nothing is clustered", () => {
  const pts = grid(200, 10);
  const r = clusterPoints(pts);
  assert.equal(r.clustered, false);
  assert.equal(r.buckets.length, 0);
  assert.equal(r.singles.length, 200);
  assert.equal(CLUSTER_THRESHOLD, 200);
  assert.equal(CLUSTER_CELL_PX, 56);
});

test("over the threshold pins are bucketed into the 56 px grid", () => {
  const pts = grid(201, 10); // 40 per row, 10 px apart → 56 px cells hold up to 6×6 pins
  const r = clusterPoints(pts);
  assert.equal(r.clustered, true);
  const inBuckets = r.buckets.reduce((s, b) => s + b.keys.length, 0);
  assert.equal(inBuckets + r.singles.length, 201, "every pin lands in exactly one bucket or stays single");
  for (const b of r.buckets) {
    assert.ok(b.keys.length >= 2);
    // Every member sits in the same cell.
    const cells = new Set(pts.filter((p) => b.keys.includes(p.key)).map((p) => `${Math.floor(p.x / 56)}:${Math.floor(p.y / 56)}`));
    assert.equal(cells.size, 1);
    assert.ok(b.minX <= b.x && b.x <= b.maxX && b.minY <= b.y && b.y <= b.maxY);
  }
});

test("counts, centre and bounds of one bucket; a lone pin stays single", () => {
  const pts: ProjectedPoint[] = [];
  for (let i = 0; i < 250; i++) pts.push({ key: `a${i}`, x: 10 + (i % 5), y: 10 + (i % 3) }); // all in cell 0:0
  pts.push({ key: "lone", x: 500, y: 500 });
  const r = clusterPoints(pts);
  assert.equal(r.clustered, true);
  assert.equal(r.buckets.length, 1);
  assert.equal(r.buckets[0]!.keys.length, 250);
  assert.deepEqual(r.singles, ["lone"]);
  const b = r.buckets[0]!;
  assert.equal(b.minX, 10);
  assert.equal(b.maxX, 14);
  assert.equal(b.minY, 10);
  assert.equal(b.maxY, 12);
  assert.ok(b.x > 10 && b.x < 14);
});

test("a custom threshold and cell size are honoured", () => {
  const pts = grid(30, 5);
  const r = clusterPoints(pts, 200, 10);
  assert.equal(r.clustered, true);
  assert.equal(r.buckets.length, 1);
  assert.equal(r.buckets[0]!.keys.length, 30);
});

test("disc size grows with the count from 32 px", () => {
  assert.equal(clusterSize(2), 32);
  assert.equal(clusterSize(9), 32);
  assert.equal(clusterSize(10), 38);
  assert.equal(clusterSize(150), 44);
  assert.equal(clusterSize(2000), 50);
});
