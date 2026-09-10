// FR/EN copy for the ten audit checks, the flags and the package suggestions
// (contract §7.2). Prospect-facing wording lives here so the report and the
// drafts read the same words; the admin panel uses the EN strings. Package
// names and prices are verbatim from /pme (src/content/{fr,en}.ts).
import type { CheckKey, CheckStatus, FitSuggestion, Flag } from "@/lib/crm/types";

export type AuditLocale = "fr" | "en";
export type Bilingual = { fr: string; en: string };

export interface CheckCopy {
  label: Bilingual;
  /** One line on what the check looks at. */
  what: Bilingual;
  pass: Bilingual;
  partial: Bilingual;
  fail: Bilingual;
  not_measured: Bilingual;
}

const NOT_MEASURED: Bilingual = { fr: "Non mesuré.", en: "Not measured." };

export const CHECK_COPY: Record<CheckKey, CheckCopy> = {
  reachable: {
    label: { fr: "Site joignable", en: "Site reachable" },
    what: { fr: "Votre site répond-il quand on l'ouvre ?", en: "Does your site answer when it is opened?" },
    pass: { fr: "Le site répond normalement.", en: "The site answers normally." },
    partial: { fr: "Le site répond, mais lentement (plus de 5 secondes).", en: "The site answers, but slowly (over 5 seconds)." },
    fail: { fr: "Le site ne répond pas.", en: "The site does not answer." },
    not_measured: NOT_MEASURED,
  },
  https: {
    label: { fr: "Connexion sécurisée (HTTPS)", en: "Secure connection (HTTPS)" },
    what: { fr: "Le cadenas, le certificat et le passage automatique à la version sécurisée.", en: "The padlock, the certificate and the automatic switch to the secure version." },
    pass: { fr: "Certificat valide, redirection et HSTS en place.", en: "Valid certificate, redirect and HSTS in place." },
    partial: { fr: "HTTPS fonctionne, mais il manque la redirection ou HSTS, ou le certificat expire bientôt.", en: "HTTPS works, but the redirect or HSTS is missing, or the certificate expires soon." },
    fail: { fr: "Pas de connexion sécurisée : les navigateurs affichent un avertissement.", en: "No secure connection: browsers show a warning." },
    not_measured: NOT_MEASURED,
  },
  speed: {
    label: { fr: "Vitesse sur mobile", en: "Mobile speed" },
    what: { fr: "Le score de performance mobile mesuré par Google PageSpeed.", en: "The mobile performance score measured by Google PageSpeed." },
    pass: { fr: "Le site se charge vite sur mobile.", en: "The site loads fast on mobile." },
    partial: { fr: "Le site se charge lentement sur mobile, ou la mesure n'a pas abouti.", en: "The site loads slowly on mobile, or the measurement did not complete." },
    fail: { fr: "Le site se charge très lentement sur mobile.", en: "The site loads very slowly on mobile." },
    not_measured: NOT_MEASURED,
  },
  seo_basics: {
    label: { fr: "Bases du référencement", en: "SEO basics" },
    what: { fr: "Affichage mobile, titre et description de page — ce que Google lit en premier.", en: "Mobile display, page title and description — what Google reads first." },
    pass: { fr: "Affichage mobile, titre et description en place.", en: "Mobile display, title and description in place." },
    partial: { fr: "Un élément manque (titre ou description), ou le score SEO est moyen.", en: "One element is missing (title or description), or the SEO score is middling." },
    fail: { fr: "Le site ne s'adapte pas au mobile, ou le score SEO est faible.", en: "The site does not adapt to mobile, or the SEO score is low." },
    not_measured: NOT_MEASURED,
  },
  contact: {
    label: { fr: "Contact et réservation", en: "Contact and booking" },
    what: { fr: "Un moyen de vous joindre en un clic, et de réserver ou prendre rendez-vous en ligne.", en: "A one-click way to reach you, and to book or make an appointment online." },
    pass: { fr: "Contact en un clic et réservation en ligne.", en: "One-click contact and online booking." },
    partial: { fr: "Contact possible, mais pas de réservation en ligne (ou l'inverse).", en: "Contact is possible, but there is no online booking (or the reverse)." },
    fail: { fr: "Ni téléphone cliquable, ni e-mail, ni formulaire trouvés.", en: "No clickable phone, email or form found." },
    not_measured: NOT_MEASURED,
  },
  socials: {
    label: { fr: "Réseaux sociaux", en: "Social networks" },
    what: { fr: "Un lien vers au moins une page Facebook, Instagram, LinkedIn, TikTok ou YouTube.", en: "A link to at least one Facebook, Instagram, LinkedIn, TikTok or YouTube page." },
    pass: { fr: "Au moins un réseau social est relié au site.", en: "At least one social network is linked from the site." },
    partial: { fr: "Un réseau social est relié au site.", en: "A social network is linked from the site." },
    fail: { fr: "Aucun réseau social relié au site.", en: "No social network linked from the site." },
    not_measured: NOT_MEASURED,
  },
  schema: {
    label: { fr: "Données structurées", en: "Structured data" },
    what: { fr: "La fiche technique (schema.org) qui dit à Google et aux assistants IA qui vous êtes, votre téléphone et vos horaires.", en: "The schema.org sheet that tells Google and AI assistants who you are, your phone and your hours." },
    pass: { fr: "Fiche complète : type d'établissement, téléphone et horaires.", en: "Complete sheet: business type, phone and hours." },
    partial: { fr: "Une fiche existe, mais sans téléphone ou sans horaires.", en: "A sheet exists, but without phone or hours." },
    fail: { fr: "Aucune fiche structurée.", en: "No structured sheet." },
    not_measured: NOT_MEASURED,
  },
  ai_ready: {
    label: { fr: "Prêt pour les assistants IA", en: "Ready for AI assistants" },
    what: { fr: "Les assistants IA (ChatGPT, Claude, Perplexity, Gemini) peuvent-ils lire votre site, et un visiteur peut-il vous écrire en direct ?", en: "Can AI assistants (ChatGPT, Claude, Perplexity, Gemini) read your site, and can a visitor message you live?" },
    pass: { fr: "Les assistants IA peuvent lire le site, et une messagerie ou un fichier llms.txt est en place.", en: "AI assistants can read the site, and a chat or an llms.txt file is in place." },
    partial: { fr: "Les assistants IA peuvent lire le site, mais il n'y a ni messagerie ni llms.txt.", en: "AI assistants can read the site, but there is no chat and no llms.txt." },
    fail: { fr: "Les assistants IA ne peuvent pas lire votre site.", en: "AI assistants cannot read your site." },
    not_measured: NOT_MEASURED,
  },
  google_listing: {
    label: { fr: "Fiche Google", en: "Google listing" },
    what: { fr: "Votre fiche d'établissement Google (Maps et recherche locale).", en: "Your Google Business Profile (Maps and local search)." },
    pass: { fr: "Fiche Google trouvée.", en: "Google listing found." },
    partial: { fr: "Fiche Google trouvée.", en: "Google listing found." },
    fail: { fr: "Aucune fiche Google trouvée.", en: "No Google listing found." },
    not_measured: { fr: "Fiche Google non vérifiée.", en: "Google listing not checked." },
  },
  housekeeping: {
    label: { fr: "Entretien du site", en: "Site upkeep" },
    what: { fr: "Année de copyright à jour, mentions légales présentes, aucun contenu non sécurisé.", en: "Up-to-date copyright year, legal notice present, no insecure content." },
    pass: { fr: "Site entretenu : copyright à jour, mentions légales, aucun contenu non sécurisé.", en: "Well kept: current copyright, legal notice, no insecure content." },
    partial: { fr: "Un point à corriger : copyright ancien, mentions légales absentes ou contenu non sécurisé.", en: "One point to fix: old copyright, missing legal notice or insecure content." },
    fail: { fr: "Plusieurs points à corriger.", en: "Several points to fix." },
    not_measured: NOT_MEASURED,
  },
};

export const STATUS_COPY: Record<CheckStatus, Bilingual> = {
  pass: { fr: "OK", en: "OK" },
  partial: { fr: "À améliorer", en: "To improve" },
  fail: { fr: "À corriger", en: "To fix" },
  not_measured: { fr: "Non mesuré", en: "Not measured" },
};

export const FLAG_COPY: Record<Flag, Bilingual> = {
  "no-site": { fr: "Pas de site internet", en: "No website" },
  "no-ssl": { fr: "Pas de HTTPS", en: "No HTTPS" },
  "cert-expiring": { fr: "Certificat bientôt expiré", en: "Certificate expiring soon" },
  "slow-mobile": { fr: "Lent sur mobile", en: "Slow on mobile" },
  "not-mobile": { fr: "Pas adapté au mobile", en: "Not mobile-friendly" },
  "no-contact": { fr: "Pas de contact en un clic", en: "No one-click contact" },
  "no-booking": { fr: "Pas de réservation en ligne", en: "No online booking" },
  "no-socials": { fr: "Pas de réseaux sociaux", en: "No social networks" },
  "no-schema": { fr: "Pas de données structurées", en: "No structured data" },
  "blocks-ai": { fr: "Les assistants IA ne peuvent pas lire votre site", en: "AI assistants cannot read your site" },
  "no-chat": { fr: "Pas de messagerie en direct", en: "No live chat" },
  "no-gbp": { fr: "Pas de fiche Google", en: "No Google listing" },
  "stale-site": { fr: "Site pas à jour", en: "Site not kept up to date" },
  "mixed-content": { fr: "Contenu non sécurisé", en: "Insecure content" },
  "forbids-extraction": { fr: "Le site interdit l'extraction", en: "The site forbids extraction" },
};

/** Package names and prices, verbatim from /pme. WEB switches to "Site + IA" when there is no site at all. */
export const PACKAGE_COPY: Record<FitSuggestion["pkg"] | "WEB_NOSITE", { name: Bilingual; price: Bilingual }> = {
  WEB: { name: { fr: "Site essentiel", en: "Site essentiel" }, price: { fr: "à partir de 500 €", en: "from €500" } },
  WEB_NOSITE: { name: { fr: "Site + IA", en: "Site + AI" }, price: { fr: "à partir de 2 500 €", en: "from €2,500" } },
  AGENT: { name: { fr: "L'IA sur votre site", en: "AI on your site" }, price: { fr: "à partir de 500 €", en: "from €500" } },
  AUTO: { name: { fr: "L'IA sur votre site", en: "AI on your site" }, price: { fr: "à partir de 500 €", en: "from €500" } },
  SEC: { name: { fr: "Audit de sécurité e-commerce", en: "E-commerce security audit" }, price: { fr: "à partir de 500 €/jour", en: "from €500/day" } },
};

/** "Site essentiel — à partir de 500 €" / "Site + AI — from €2,500" (when the WEB fit carries no-site). */
export function packageLabel(fit: Pick<FitSuggestion, "pkg" | "flags">, locale: AuditLocale): string {
  const key = fit.pkg === "WEB" && fit.flags.includes("no-site") ? "WEB_NOSITE" : fit.pkg;
  const c = PACKAGE_COPY[key];
  return `${c.name[locale]} — ${c.price[locale]}`;
}

export function checkLabel(key: CheckKey, locale: AuditLocale): string {
  return CHECK_COPY[key].label[locale];
}

export function checkVerdict(key: CheckKey, status: CheckStatus, locale: AuditLocale): string {
  return CHECK_COPY[key][status][locale];
}

export function flagLabel(flag: Flag, locale: AuditLocale): string {
  return FLAG_COPY[flag][locale];
}
