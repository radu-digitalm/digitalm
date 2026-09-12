import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FR_REGION_ISO_TO_INSEE,
  countryNameOf,
  FR_REGION_NAMES,
  areaLabel,
  candidateLabel,
  chooseHit,
  circleKmFor,
  classifyHit,
  collapseDuplicates,
  departementFromIso,
  displayThreshold,
  postcodeLabel,
  regionCodeOf,
  wantsFinePolygon,
  type NominatimHit,
} from "./geocodeRules.ts";

const here = new URL(".", import.meta.url).pathname;
const shapes = JSON.parse(readFileSync(`${here}fixtures/nominatim-shapes.json`, "utf8")).queries as Record<string, NominatimHit[]>;
const first = (q: string) => classifyHit(shapes[q]![0]!)!;

test("classifyHit: kinds and countries on the captured shapes", () => {
  const ariege = first("ariege");
  assert.equal(ariege.kind, "department");
  assert.equal(ariege.countryCode, "FR");
  assert.equal(ariege.countryName, "France");
  assert.equal(ariege.departement, "09");
  assert.equal(ariege.osmId, 7439);
  assert.equal(ariege.osmType, "relation");

  const occ = first("Occitanie");
  assert.equal(occ.kind, "region");
  assert.equal(occ.regionIso, "FR-OCC");
  assert.equal(occ.regionCode, "76");

  assert.equal(first("France").kind, "country");
  assert.equal(first("France").countryCode, "FR");
  const ad = first("Andorra");
  assert.equal(ad.kind, "country");
  assert.equal(ad.countryCode, "AD");
  assert.equal(ad.countryName, "Andorra");

  const foix = first("Foix");
  assert.equal(foix.kind, "town");
  assert.equal(foix.inseeCode, "09122");
  assert.equal(foix.departement, "09");

  const camUk = classifyHit(shapes.Cambridge![0]!)!;
  assert.equal(camUk.kind, "town");
  assert.equal(camUk.countryCode, "GB");
  const camNode = classifyHit(shapes.Cambridge![1]!)!;
  assert.equal(camNode.kind, "place"); // a node, even with addresstype city
  const camUs = classifyHit(shapes.Cambridge![2]!)!;
  assert.equal(camUs.kind, "town");
  assert.equal(camUs.countryCode, "US");

  const pyr = first("Pyrénées");
  assert.equal(pyr.kind, "place"); // a way: mountain range
  assert.equal(pyr.osmType, "way");
  const hamlet = first("hamlet (synthetic)");
  assert.equal(hamlet.kind, "place");
  assert.equal(circleKmFor(hamlet.addresstype), 1.5);
  assert.equal(circleKmFor(camNode.addresstype), 4);

  assert.equal(first("Wales").kind, "region");
  assert.equal(first("Bavaria").kind, "region");
  assert.equal(first("Toulouse").kind, "town");
  assert.equal(first("Toulouse").inseeCode, "31555");
  assert.equal(first("Paris").kind, "town");
  assert.equal(first("Paris").inseeCode, undefined); // ref:INSEE "75" is not a commune code
});

test("classifyHit: hits without an OSM identity (postcode pseudo-hits) or coordinates are ignored", () => {
  assert.equal(classifyHit({ lat: "1", lon: "2", addresstype: "postcode", name: "09000" }), null);
  assert.equal(classifyHit({ osm_type: "node", osm_id: 5, lat: "x", lon: "2", name: "a" }), null);
  assert.equal(classifyHit({ osm_type: "area", osm_id: 5, lat: "1", lon: "2", name: "a" } as NominatimHit), null);
});

test("FR-09 → 09, FR-2A → 2A, FR-971 → 971; region ISO table matches geo.gouv's 18 regions", () => {
  assert.equal(departementFromIso("FR-09"), "09");
  assert.equal(departementFromIso("FR-2A"), "2A");
  assert.equal(departementFromIso("FR-971"), "971");
  assert.equal(departementFromIso("FR-OCC"), null);
  assert.equal(departementFromIso(undefined), null);
  assert.equal(Object.keys(FR_REGION_ISO_TO_INSEE).length, 18);
  assert.deepEqual(new Set(Object.values(FR_REGION_ISO_TO_INSEE)), new Set(Object.keys(FR_REGION_NAMES)));
  assert.equal(regionCodeOf("FR-OCC", undefined), "76");
  assert.equal(regionCodeOf("FR-NAQ", "99"), "75");
  assert.equal(regionCodeOf(undefined, "84"), "84");
  assert.equal(regionCodeOf("FR-XX", "abc"), null);
  assert.equal(FR_REGION_NAMES["76"], "Occitanie");
});

test("ambiguity rule: Cambridge asks, Ariège and Foix do not, Le Bosc picks the first and offers the other", () => {
  const cam = chooseHit(shapes.Cambridge!)!;
  assert.equal(cam.ambiguous, true);
  if (cam.ambiguous) {
    assert.ok(cam.candidates.length >= 2 && cam.candidates.length <= 5);
    assert.ok(new Set(cam.candidates.map((c) => c.countryCode)).size >= 2);
    assert.deepEqual(cam.candidates.slice(0, 2).map((c) => c.label), ["Cambridge — city, United Kingdom", "Cambridge — city, United States"]);
    // the GB place node collapsed into the GB relation
    assert.equal(cam.candidates.filter((c) => c.countryCode === "GB").length, 1);
    assert.equal(cam.candidates[0]!.osmType, "relation");
  }
  const ar = chooseHit(shapes.ariege!)!;
  assert.equal(ar.ambiguous, false);
  if (!ar.ambiguous) {
    assert.equal(ar.chosen.osmId, 7439);
    assert.equal(ar.alternatives.length, 0);
  }
  const foix = chooseHit(shapes.Foix!)!;
  assert.equal(foix.ambiguous, false); // town 0.598 vs arrondissement 0.528 — same kind, same country
  if (!foix.ambiguous) {
    assert.equal(foix.chosen.osmId, 74088);
    assert.deepEqual(
      foix.alternatives.map((a) => a.label),
      ["Foix — municipality, France"],
    );
  }
  const bosc = chooseHit(shapes["Le Bosc"]!)!;
  assert.equal(bosc.ambiguous, false);
  if (!bosc.ambiguous) {
    assert.equal(bosc.chosen.osmId, 164706);
    assert.equal(bosc.alternatives[0]!.label, "Le Bosc — village, Ariège, France"); // same name in France → county added
    assert.ok(bosc.alternatives.length <= 3);
    assert.equal(new Set(bosc.alternatives.map((a) => a.label)).size, bosc.alternatives.length);
  }
  const pyr = chooseHit(shapes["Pyrénées"]!)!;
  assert.equal(pyr.ambiguous, true); // a mountain range in Spain vs a French region
  assert.equal(chooseHit([]), null);
  assert.equal(chooseHit([{ lat: "1", lon: "2", addresstype: "postcode" }]), null);
});

test("collapseDuplicates keeps the relation over its place node and drops repeated ids", () => {
  const rel = classifyHit(shapes.Cambridge![0]!)!;
  const node = classifyHit(shapes.Cambridge![1]!)!;
  assert.deepEqual(collapseDuplicates([node, rel, rel]).map((c) => c.osmType), ["relation"]);
  assert.deepEqual(collapseDuplicates([rel, node]).map((c) => c.osmId), [rel.osmId]);
});

test("labels: area label adds the state for towns outside France; candidate labels read kind + country", () => {
  assert.equal(areaLabel(first("ariege")), "Ariège");
  assert.equal(areaLabel(first("Foix")), "Foix");
  assert.equal(areaLabel(classifyHit(shapes.Cambridge![0]!)!), "Cambridge, England");
  assert.equal(areaLabel(first("Andorra")), "Andorra");
  assert.equal(candidateLabel(first("ariege")), "Ariège — department, France");
  assert.equal(candidateLabel(first("Occitanie")), "Occitanie — region, France");
  assert.equal(candidateLabel(first("Pyrénées")), "Pyrénées / Pirineos / Pirineus / Pirineu / Pirinioak / Pirenèus — mountain range, Spain");
  assert.equal(postcodeLabel("09000", [{ nom: "Foix", population: 9934 }]), "Foix (09000)");
  assert.equal(postcodeLabel("09120", [{ nom: "Artix", population: 113 }, { nom: "Varilhes", population: 3487 }, { nom: "Vira", population: 161 }]), "09120 — Varilhes and 2 more communes");
  assert.equal(postcodeLabel("09120", [{ nom: "A", population: 1 }, { nom: "B", population: 2 }]), "09120 — B and 1 more commune");
  assert.equal(postcodeLabel("09999", []), "09999");
});

test("countryNameOf: English names from the ISO code, the source's name as a fallback", () => {
  assert.equal(countryNameOf("ES", "España"), "Spain");
  assert.equal(countryNameOf("GB"), "United Kingdom");
  assert.equal(countryNameOf("FR", "France"), "France");
  assert.equal(countryNameOf("XX", "Nowhere"), "Nowhere");
  assert.equal(countryNameOf("XX"), "XX");
  assert.equal(first("Pyrénées").countryName, "Spain");
  assert.equal(first("Bavaria").countryName, "Germany");
});

test("polygon thresholds: 0.01 for countries, 0.005 for departments and regions, finer for towns and places; fine polygon only for town / department / place", () => {
  assert.equal(displayThreshold("country"), 0.01);
  assert.equal(displayThreshold("department"), 0.005);
  assert.equal(displayThreshold("region"), 0.005);
  assert.equal(displayThreshold("town"), 0.0005);
  assert.equal(displayThreshold("place"), 0.001);
  assert.equal(displayThreshold("postcode"), 0.005);
  assert.equal(wantsFinePolygon("department"), true);
  assert.equal(wantsFinePolygon("town"), true);
  assert.equal(wantsFinePolygon("place"), true);
  assert.equal(wantsFinePolygon("region"), false);
  assert.equal(wantsFinePolygon("country"), false);
  assert.equal(wantsFinePolygon("postcode"), false);
});
