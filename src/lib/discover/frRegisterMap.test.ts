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
