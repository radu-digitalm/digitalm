import { test } from "node:test";
import assert from "node:assert/strict";
import { SIRET_RE, SOLE_TRADER_NATURE, mapEstablishment, slimCompany, slimEtab } from "./frRegisterMap.ts";
import type { Area } from "../crm/types.ts";

const area: Area = { label: "Foix", countryCode: "FR", center: { lat: 42.9655, lng: 1.6053 }, bbox: [42.9, 1.5, 43.0, 1.7], provider: "geo_gouv" };

const apiCompany = {
  nom_complet: "LE FOURNIL (MARTIN PAUL)",
  nom_raison_sociale: null,
  sigle: null,
  siren: "123456789",
  nature_juridique: "1000",
  activite_principale: "10.71C",
  etat_administratif: "A",
  statut_diffusion: "diffusible",
  dirigeants: [{ nom: "MARTIN", prenoms: "PAUL", date_de_naissance: "1980-01" }],
  finances: { 2024: { ca: 120000 } },
  complements: { est_ess: false },
  collectivite_territoriale: null,
  siege: { siret: "12345678900011", adresse: "1 RUE DU PONT 09000 FOIX", code_postal: "09000", libelle_commune: "FOIX", latitude: "42.96", longitude: "1.60", liste_enseignes: ["LE FOURNIL"], etat_administratif: "A", dirigeant: "x" },
  matching_etablissements: [
    { siret: "12345678900029", adresse: "2 RUE HAUTE 09000 FOIX", code_postal: "09000", libelle_commune: "FOIX", latitude: null, longitude: null, liste_enseignes: null, etat_administratif: "A" },
    { siret: "12345678900037", adresse: "x", code_postal: "09000", libelle_commune: "FOIX", latitude: "42.9", longitude: "1.6", liste_enseignes: ["FERME"], etat_administratif: "F" },
  ],
};

test("slimCompany keeps the contract's fields and drops dirigeants / finances / complements by construction", () => {
  const c = slimCompany(apiCompany)!;
  assert.deepEqual(Object.keys(c).sort(), ["activite_principale", "etat_administratif", "matching_etablissements", "nature_juridique", "nom_complet", "nom_raison_sociale", "siege", "sigle", "siren", "statut_diffusion"]);
  assert.equal(JSON.stringify(c).includes("MARTIN\",\"prenoms"), false);
  assert.equal(JSON.stringify(c).includes("dirigeant"), false);
  assert.equal(JSON.stringify(c).includes("finances"), false);
  assert.equal(JSON.stringify(c).includes("date_de_naissance"), false);
  assert.equal(c.siege?.siret, "12345678900011");
  assert.deepEqual(Object.keys(c.siege!).sort(), ["adresse", "code_postal", "etat_administratif", "latitude", "libelle_commune", "liste_enseignes", "longitude", "siret"]);
  assert.equal(c.matching_etablissements?.length, 2);
  assert.equal(slimCompany(null), null);
  assert.equal(slimCompany("x"), null);
  assert.equal(slimEtab(42), null);
});

test("mapEstablishment: enseigne as name, legal name kept apart, sole trader from nature 1000, geo fallback to the area centre", () => {
  const c = slimCompany(apiCompany)!;
  const head = mapEstablishment(c, c.siege!, area)!;
  assert.equal(head.source, "fr_register");
  assert.equal(head.sourceId, "12345678900011");
  assert.equal(head.sourceUrl, "https://annuaire-entreprises.data.gouv.fr/etablissement/12345678900011");
  assert.equal(head.name, "LE FOURNIL");
  assert.equal(head.enseigne, "LE FOURNIL");
  assert.equal(head.legalName, "LE FOURNIL (MARTIN PAUL)");
  assert.equal(head.soleTrader, true);
  assert.equal(SOLE_TRADER_NATURE, "1000");
  assert.equal(head.diffusion, "full");
  assert.equal(head.active, true);
  assert.equal(head.geoSource, "source");
  assert.equal(head.lat, 42.96);
  assert.equal(head.countryCode, "FR");
  assert.equal(head.registerId, "12345678900011");
  assert.equal(head.postcode, "09000");
  assert.equal(head.city, "FOIX");
  assert.equal("phone" in head, false);

  const noGeo = mapEstablishment(c, c.matching_etablissements![0]!, area)!;
  assert.equal(noGeo.geoSource, "centre");
  assert.equal(noGeo.lat, area.center.lat);
  assert.equal(noGeo.name, "LE FOURNIL (MARTIN PAUL)"); // no enseigne on this establishment → nom_complet

  assert.equal(mapEstablishment(c, c.matching_etablissements![1]!, area), null); // closed establishment
  assert.equal(mapEstablishment(c, { siret: "123" }, area), null);
});

test("mapEstablishment: companies (nature ≠ 1000), partial diffusion and ceased units", () => {
  const c = slimCompany({ ...apiCompany, nature_juridique: "5710", statut_diffusion: "partiellement_diffusible", etat_administratif: "C" })!;
  const b = mapEstablishment(c, c.siege!, area)!;
  assert.equal(b.soleTrader, false);
  assert.equal(b.diffusion, "partial");
  assert.equal(b.active, false);
  assert.equal(b.legalForm, "5710");
  assert.equal(SIRET_RE.test("12345678900011"), true);
  assert.equal(SIRET_RE.test("1234567890001"), false);
});

// ---- scopes (finder-ux §3.4) -------------------------------------------------------------

import { MAX_SCOPE_POSTCODES, placeRegisterRow, scopesFor } from "./frRegisterMap.ts";

const base = { countryCode: "FR", label: "Ariège", center: { lat: 42.9455, lng: 1.4066 }, radiusKm: 58 };

test("scopesFor: postcode / town → code_postal per postcode (≤ 12), department → departement=", () => {
  assert.deepEqual(scopesFor({ ...base, kind: "postcode", label: "Foix (09000)", admin: { postcodes: ["09000"], inseeCode: "09122", departement: "09" } }, []), [
    { id: "cp:09000", label: "09000", mode: "postcode", params: { code_postal: "09000" } },
  ]);
  const twelve = scopesFor({ ...base, kind: "town", admin: { postcodes: Array.from({ length: 12 }, (_, i) => `310${String(i).padStart(2, "0")}`) } }, []);
  assert.equal(twelve.length, MAX_SCOPE_POSTCODES);
  assert.equal(twelve[11]!.params.code_postal, "31011");
  // a big city with more than 12 postcodes is searched around its centre instead
  const many = scopesFor({ ...base, kind: "town", label: "Marseille", admin: { postcodes: Array.from({ length: 16 }, (_, i) => `130${String(i + 1).padStart(2, "0")}`) } }, []);
  assert.equal(many.length, 1);
  assert.equal(many[0]!.mode, "near_point");
  // a town without geo.gouv data → near_point with the bbox radius
  assert.deepEqual(scopesFor({ ...base, kind: "town", label: "Paris", radiusKm: 11.4, center: { lat: 48.8589, lng: 2.32 }, admin: {} }, []), [
    { id: "near:48.86,2.32", label: "within 12 km of Paris", mode: "near_point", params: { lat: "48.85890", long: "2.32000", radius: "12" } },
  ]);
  assert.deepEqual(scopesFor({ ...base, kind: "department", admin: { departement: "09" } }, [{ code: "09", label: "Ariège" }]), [
    { id: "dep:09", label: "Ariège (09)", mode: "departement", params: { departement: "09" } },
  ]);
  assert.equal(scopesFor({ ...base, kind: "department", admin: { departement: "2A" }, label: "Corse-du-Sud" }, [])[0]!.label, "Corse-du-Sud (2A)");
});

test("scopesFor: region / France → the departments whose unit ran, in unit order; all of them for a single unit", () => {
  const occ = { ...base, kind: "region" as const, label: "Occitanie", admin: { regionCode: "76", departements: ["09", "11", "12", "30", "31", "32", "34", "46", "48", "65", "66", "81", "82"] } };
  const ran = [
    { code: "81", label: "Tarn" },
    { code: "31", label: "Haute-Garonne" },
    { code: "09", label: "Ariège" },
    { code: "64", label: "Pyrénées-Atlantiques" }, // not in Occitanie → ignored
    { label: "no code" },
  ];
  const s = scopesFor(occ, ran, {}, false);
  assert.deepEqual(
    s.map((x) => x.id),
    ["dep:81", "dep:31", "dep:09"],
  );
  assert.equal(s[0]!.label, "Tarn (81)");
  assert.equal(s[0]!.mode, "departement");
  // a single-unit region (a rare trade) covers every department, names from geo.gouv when given
  const all = scopesFor(occ, [{ label: "Occitanie" }], { "09": "Ariège" });
  assert.equal(all.length, 13);
  assert.equal(all[0]!.label, "Ariège (09)");
  assert.equal(all[1]!.label, "Department 11");
  // France with children carrying ref:INSEE → the same rule; nothing known → the codes that ran
  const fr = scopesFor({ ...base, kind: "country", label: "France", admin: {} }, [{ code: "18", label: "Cher" }, { code: "36", label: "Indre" }], {}, false);
  assert.deepEqual(
    fr.map((x) => x.label),
    ["Cher (18)", "Indre (36)"],
  );
  assert.deepEqual(scopesFor({ ...base, kind: "country", label: "France", admin: {} }, [{ label: "France" }]), []);
});

test("scopesFor: places use near_point capped at 50 km; non-FR areas get nothing", () => {
  const p = scopesFor({ ...base, kind: "place", label: "Pyrénées", radiusKm: 180 }, []);
  assert.equal(p.length, 1);
  assert.equal(p[0]!.mode, "near_point");
  assert.equal(p[0]!.params.radius, "50");
  assert.equal(p[0]!.label, "within 50 km of Pyrénées");
  assert.deepEqual(scopesFor({ ...base, kind: "country", countryCode: "AD", label: "Andorra" }, []), []);
  assert.deepEqual(scopesFor({ ...base, kind: "town", countryCode: "GB", label: "Cambridge, England" }, []), []);
});

test("placeRegisterRow: coordinates decide inside/outside; rows without coordinates are approx under a department, dropped under near_point", () => {
  const inside = (lng: number, lat: number) => lng > 1 && lng < 2 && lat > 42.5 && lat < 43.3;
  assert.deepEqual(placeRegisterRow({ lat: 42.96, lng: 1.6, geoSource: "source" }, "departement", inside), { keep: true, inside: "yes" });
  assert.deepEqual(placeRegisterRow({ lat: 42.4, lng: 1.51, geoSource: "source" }, "departement", inside), { keep: false, inside: "no" });
  assert.deepEqual(placeRegisterRow({ lat: 42.9455, lng: 1.4066, geoSource: "centre" }, "departement", inside), { keep: true, inside: "approx" });
  assert.deepEqual(placeRegisterRow({ lat: 42.9455, lng: 1.4066, geoSource: "centre" }, "postcode", inside), { keep: true, inside: "approx" });
  assert.deepEqual(placeRegisterRow({ lat: 42.9455, lng: 1.4066, geoSource: "centre" }, "near_point", inside), { keep: false, inside: "no" });
});
