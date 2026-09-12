// Grid clustering for the finder map (docs/finder-ux-spec.md §5.3). Pure:
// takes points already projected to container pixels at the current zoom and
// buckets them into a square grid when there are more than `threshold` of them.
// A bucket with two or more pins becomes a numbered disc; single pins stay pins.

export type ProjectedPoint = { key: string; x: number; y: number };

export type Bucket = {
  keys: string[];
  /** Mean position of the bucket's pins (where the disc is drawn). */
  x: number;
  y: number;
  /** Pixel extent of the bucket's pins (the bounds to zoom to on click). */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type ClusterResult = {
  /** false when the threshold was not reached — every point is a single pin. */
  clustered: boolean;
  buckets: Bucket[];
  singles: string[];
};

export const CLUSTER_CELL_PX = 56;
export const CLUSTER_THRESHOLD = 200;

export function clusterPoints(points: ProjectedPoint[], cell = CLUSTER_CELL_PX, threshold = CLUSTER_THRESHOLD): ClusterResult {
  if (points.length <= threshold) return { clustered: false, buckets: [], singles: points.map((p) => p.key) };
  const size = Math.max(1, cell);
  const grid = new Map<string, ProjectedPoint[]>();
  for (const p of points) {
    const id = `${Math.floor(p.x / size)}:${Math.floor(p.y / size)}`;
    const list = grid.get(id);
    if (list) list.push(p);
    else grid.set(id, [p]);
  }
  const buckets: Bucket[] = [];
  const singles: string[] = [];
  for (const list of grid.values()) {
    if (list.length < 2) {
      singles.push(list[0]!.key);
      continue;
    }
    let sx = 0;
    let sy = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of list) {
      sx += p.x;
      sy += p.y;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    buckets.push({ keys: list.map((p) => p.key), x: sx / list.length, y: sy / list.length, minX, minY, maxX, maxY });
  }
  return { clustered: true, buckets, singles };
}

/** Disc diameter for a count: 32 px minimum, growing gently with the count. */
export function clusterSize(count: number): number {
  if (count < 10) return 32;
  if (count < 100) return 38;
  if (count < 1000) return 44;
  return 50;
}
