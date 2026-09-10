// Overpass QL for one tile (contract §6 "osm"), pure so the tag-injection
// guard is unit-tested: keys and values must match the allow-listed shapes or
// the tag is dropped, and the bbox is printed with a fixed precision.
import type { Area, Category } from "../crm/types.ts";

export type Bbox = Area["bbox"];

const TAG_KEY_RE = /^[a-z_:]{2,40}$/;
const TAG_VALUE_RE = /^[a-z_]{2,40}$/;

/** Overpass QL for one tile; tag keys/values are validated so nothing else can be injected. */
export function buildQuery(category: Category, tile: Bbox): string {
  const box = tile.map((n) => n.toFixed(5)).join(",");
  const parts = category.osm
    .filter((t) => TAG_KEY_RE.test(t.k) && TAG_VALUE_RE.test(t.v))
    .map((t) => `nwr["${t.k}"="${t.v}"](${box});`);
  return `[out:json][timeout:25][maxsize:33554432];(${parts.join("")});out center tags 250;`;
}
