import { SITE_URL } from "./seo";

// French local presence (Ariège / Occitanie). Drives the visible address block
// and the LocalBusiness JSON-LD on the /fr local pages. No phone by owner's choice.
export const FR_NAP = {
  name: "Digital M",
  streetAddress: "3 Résidence des Écoles",
  postalCode: "09000",
  addressLocality: "Ferrières-sur-Ariège",
  addressRegion: "Occitanie",
  addressCountry: "FR",
  telephone: "+33 4 12 12 09 09", // French Telnyx number (forwards to mobile)
  latitude: 42.9456,
  longitude: 1.6139,
  gbpUrl: "https://share.google/zUL1TWQH5pfG9EhOm", // Google Business Profile (share link) → sameAs
  email: "contact@digitalm.eu",
};

export const FR_NAP_READY = Boolean(FR_NAP.streetAddress);

// Internal links to the local landing pages (footer block + on-page "zones").
export const LOCAL_LINKS: { slug: string; fr: string; en: string }[] = [
  { slug: "agence-ia-ariege", fr: "Agence IA · Ariège", en: "AI agency · Ariège" },
  { slug: "agence-ia-foix", fr: "Agence IA · Foix", en: "AI agency · Foix" },
  { slug: "agence-ia-pamiers", fr: "Agence IA · Pamiers", en: "AI agency · Pamiers" },
  { slug: "agence-ia-saint-girons", fr: "Agence IA · Saint-Girons", en: "AI agency · Saint-Girons" },
  { slug: "agence-ia-lavelanet", fr: "Agence IA · Lavelanet", en: "AI agency · Lavelanet" },
  { slug: "agence-ia-toulouse", fr: "Agence IA · Toulouse", en: "AI agency · Toulouse" },
  { slug: "creation-site-internet-ariege", fr: "Création de site · Ariège", en: "Website creation · Ariège" },
  { slug: "audit-securite-site-ecommerce", fr: "Audit sécurité e-commerce", en: "E-commerce security audit" },
];

// Served areas shown on each local page (Ariège + Haute-Garonne + neighbours).
export const SERVED: { region: string; towns: string[] }[] = [
  {
    region: "Ariège (09)",
    towns: ["Foix", "Ferrières-sur-Ariège", "Pamiers", "Saint-Girons", "Lavelanet", "Tarascon-sur-Ariège", "Varilhes", "Saverdun", "Mazères", "Mirepoix", "Ax-les-Thermes", "Saint-Lizier", "La Tour-du-Crieu", "Verniolle"],
  },
  {
    region: "Haute-Garonne (31)",
    towns: ["Toulouse", "Colomiers", "Blagnac", "Tournefeuille", "Muret", "Cugnaux", "Plaisance-du-Touch", "Balma", "Ramonville-Saint-Agne", "Saint-Gaudens"],
  },
  {
    region: "Alentours / Occitanie",
    towns: ["Aude (Carcassonne, Limoux)", "Hautes-Pyrénées (Tarbes)", "Tarn (Castres)", "Pyrénées-Orientales", "Occitanie"],
  },
];

const AREA_SERVED = [
  { "@type": "AdministrativeArea", name: "Ariège" },
  { "@type": "AdministrativeArea", name: "Haute-Garonne" },
  { "@type": "AdministrativeArea", name: "Occitanie" },
  ...["Foix", "Ferrières-sur-Ariège", "Pamiers", "Saint-Girons", "Lavelanet", "Tarascon-sur-Ariège", "Mirepoix", "Toulouse", "Colomiers", "Blagnac", "Muret", "Carcassonne", "Tarbes"].map(
    (name) => ({ "@type": "Place", name }),
  ),
];

/** The French LocalBusiness node (#fr-local) for the local pages' JSON-LD @graph.
 *  The UK entity (#org, in layout.tsx) stays for legal/mentions-légales only. */
export function localBusinessNode() {
  const node: Record<string, unknown> = {
    "@type": "ProfessionalService",
    "@id": `${SITE_URL}/#fr-local`,
    name: FR_NAP.name,
    url: SITE_URL,
    image: `${SITE_URL}/brand/logo-white.png`,
    email: FR_NAP.email,
    address: {
      "@type": "PostalAddress",
      streetAddress: FR_NAP.streetAddress,
      postalCode: FR_NAP.postalCode,
      addressLocality: FR_NAP.addressLocality,
      addressRegion: FR_NAP.addressRegion,
      addressCountry: FR_NAP.addressCountry,
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: FR_NAP.latitude,
      longitude: FR_NAP.longitude,
    },
    areaServed: AREA_SERVED,
    parentOrganization: { "@id": `${SITE_URL}/#org` },
    priceRange: "€€",
  };
  if (FR_NAP.telephone) node.telephone = FR_NAP.telephone;
  if (FR_NAP.gbpUrl) node.sameAs = [FR_NAP.gbpUrl];
  return node;
}
