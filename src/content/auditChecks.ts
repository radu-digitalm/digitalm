// The single source of prospect-facing audit copy (contract §7.2, §8): the
// ten checks (label, what it looks at, one sentence per status), the status
// labels, the flags in plain words and the package labels verbatim from /pme.
// The /r report, the outreach drafts and the admin AuditBlock all read from
// here so the same result is always described in the same words. FR and EN
// throughout; never "error" for the AI-readability check.
//
// Only `import type`, so lib/report/findings.ts and lib/drafts/templates.ts
// can import it by relative path under node --test (strip-only mode).
import type { CheckKey, CheckStatus, FitSuggestion, Flag } from "@/lib/crm/types";

export type AuditLocale = "fr" | "en";
export type Bilingual = { fr: string; en: string };

export interface CheckCopy {
  label: Bilingual;
  /** One line on what the check looks at (admin panel and report tooltips). */
  what: Bilingual;
  pass: Bilingual;
  partial: Bilingual;
  fail: Bilingual;
  not_measured: Bilingual;
}

export const CHECK_COPY: Record<CheckKey, CheckCopy> = {
  reachable: {
    label: { fr: "Site accessible", en: "Site reachable" },
    what: { fr: "Votre site répond-il quand on l'ouvre ?", en: "Does your site answer when it is opened?" },
    pass: { fr: "Votre site répond correctement.", en: "Your site responds correctly." },
    partial: { fr: "Votre site répond, mais lentement (plus de 5 secondes).", en: "Your site responds, but slowly (over 5 seconds)." },
    fail: { fr: "Votre site ne répond pas ou renvoie une page d'erreur.", en: "Your site does not respond or returns an error page." },
    not_measured: { fr: "Non mesuré.", en: "Not measured." },
  },
  https: {
    label: { fr: "Connexion sécurisée (HTTPS)", en: "Secure connection (HTTPS)" },
    what: { fr: "Le cadenas, le certificat et le passage automatique à la version sécurisée.", en: "The padlock, the certificate and the automatic switch to the secure version." },
    pass: { fr: "Votre site est servi en HTTPS avec un certificat valide.", en: "Your site is served over HTTPS with a valid certificate." },
    partial: {
      fr: "Le HTTPS fonctionne, mais un détail reste à régler : redirection, en-tête HSTS ou certificat proche de l'expiration.",
      en: "HTTPS works, but one detail needs attention: the redirect, the HSTS header or a certificate close to expiry.",
    },
    fail: {
      fr: "Votre site n'est pas servi en HTTPS : les navigateurs l'affichent comme « non sécurisé ».",
      en: "Your site is not served over HTTPS: browsers mark it as \"not secure\".",
    },
    not_measured: { fr: "Non mesuré.", en: "Not measured." },
  },
  speed: {
    label: { fr: "Vitesse sur mobile", en: "Mobile speed" },
    what: { fr: "Le score de performance mobile mesuré par Google PageSpeed.", en: "The mobile performance score measured by Google PageSpeed." },
    pass: { fr: "Votre site se charge vite sur mobile.", en: "Your site loads quickly on mobile." },
    partial: { fr: "Votre site se charge moyennement vite sur mobile.", en: "Your site loads at an average speed on mobile." },
    fail: {
      fr: "Votre site se charge lentement sur mobile : une partie des visiteurs part avant de l'avoir vu.",
      en: "Your site loads slowly on mobile: some visitors leave before they see it.",
    },
    not_measured: { fr: "Non mesuré.", en: "Not measured." },
  },
  seo_basics: {
    label: { fr: "Bases du référencement", en: "Search basics" },
    what: { fr: "Affichage mobile, titre et description de page — ce que Google lit en premier.", en: "Mobile display, page title and description — what Google reads first." },
    pass: { fr: "Titre, description et affichage mobile sont en place.", en: "Title, description and mobile layout are in place." },
    partial: { fr: "Un élément de base manque : titre, description ou affichage mobile.", en: "One basic element is missing: title, description or mobile layout." },
    fail: { fr: "Votre site n'est pas adapté au mobile ou manque des bases du référencement.", en: "Your site is not mobile-friendly or lacks the search basics." },
    not_measured: { fr: "Non mesuré.", en: "Not measured." },
  },
  contact: {
    label: { fr: "Contact et prise de rendez-vous", en: "Contact and booking" },
    what: { fr: "Un moyen de vous joindre en un clic, et de réserver ou prendre rendez-vous en ligne.", en: "A one-click way to reach you, and to book or make an appointment online." },
    pass: { fr: "Un moyen de contact et une prise de rendez-vous en ligne sont visibles.", en: "A way to get in touch and an online booking option are visible." },
    partial: { fr: "On peut vous contacter, mais pas réserver ni prendre rendez-vous en ligne.", en: "Visitors can contact you, but cannot book or make an appointment online." },
    fail: { fr: "Aucun moyen de contact clair (téléphone, e-mail ou formulaire) n'a été trouvé.", en: "No clear way to get in touch (phone, email or form) was found." },
    not_measured: { fr: "Non mesuré.", en: "Not measured." },
  },
  socials: {
    label: { fr: "Réseaux sociaux", en: "Social media" },
    what: { fr: "Un lien vers au moins une page Facebook, Instagram, LinkedIn, TikTok ou YouTube.", en: "A link to at least one Facebook, Instagram, LinkedIn, TikTok or YouTube page." },
    pass: { fr: "Au moins un réseau social est relié à votre site.", en: "At least one social network is linked from your site." },
    partial: { fr: "Un seul réseau social est relié à votre site.", en: "Only one social network is linked from your site." },
    fail: { fr: "Aucun lien vers vos réseaux sociaux.", en: "No links to your social networks." },
    not_measured: { fr: "Non mesuré.", en: "Not measured." },
  },
  schema: {
    label: { fr: "Données structurées", en: "Structured data" },
    what: { fr: "La fiche technique (schema.org) qui dit à Google et aux assistants IA qui vous êtes, votre téléphone et vos horaires.", en: "The schema.org sheet that tells Google and AI assistants who you are, your phone and your hours." },
    pass: {
      fr: "Google et les assistants IA lisent vos horaires et votre téléphone directement.",
      en: "Google and AI assistants read your hours and phone number directly.",
    },
    partial: { fr: "Des données structurées existent, mais sans téléphone ni horaires.", en: "Structured data exists, but without a phone number or opening hours." },
    fail: {
      fr: "Aucune donnée structurée : Google et les assistants IA doivent deviner vos horaires et votre téléphone.",
      en: "No structured data: Google and AI assistants have to guess your hours and phone number.",
    },
    not_measured: { fr: "Non mesuré.", en: "Not measured." },
  },
  ai_ready: {
    label: { fr: "Lisible par les assistants IA", en: "Readable by AI assistants" },
    what: { fr: "Les assistants IA (ChatGPT, Claude, Perplexity, Gemini) peuvent-ils lire votre site, et un visiteur peut-il vous écrire en direct ?", en: "Can AI assistants (ChatGPT, Claude, Perplexity, Gemini) read your site, and can a visitor message you live?" },
    pass: { fr: "Les assistants IA peuvent lire votre site, et un canal de discussion existe.", en: "AI assistants can read your site, and a chat channel exists." },
    partial: {
      fr: "Les assistants IA peuvent lire votre site, mais il n'y a ni fichier llms.txt ni discussion en ligne.",
      en: "AI assistants can read your site, but there is no llms.txt file and no online chat.",
    },
    fail: { fr: "Les assistants IA ne peuvent pas lire votre site.", en: "AI assistants cannot read your site." },
    not_measured: { fr: "Non mesuré.", en: "Not measured." },
  },
  google_listing: {
    label: { fr: "Fiche Google", en: "Google listing" },
    what: { fr: "Votre fiche d'établissement Google (Maps et recherche locale).", en: "Your Google Business Profile (Maps and local search)." },
    pass: { fr: "Votre fiche Google est en place et complète.", en: "Your Google listing is in place and complete." },
    partial: { fr: "Votre fiche Google existe, mais elle est incomplète.", en: "Your Google listing exists, but it is incomplete." },
    fail: { fr: "Nous n'avons pas trouvé de fiche Google pour votre établissement.", en: "We could not find a Google listing for your business." },
    not_measured: { fr: "Nous n'avons pas vérifié votre fiche Google.", en: "We have not checked your Google listing." },
  },
  housekeeping: {
    label: { fr: "Entretien du site", en: "Site upkeep" },
    what: { fr: "Année de copyright à jour, mentions légales présentes, aucun contenu non sécurisé.", en: "Up-to-date copyright year, legal notice present, no insecure content." },
    pass: { fr: "Mentions légales, date à jour et ressources sécurisées : tout est en ordre.", en: "Legal page, current date and secure resources: all in order." },
    partial: {
      fr: "Un point d'entretien à revoir : année de copyright, page de mentions légales ou ressource non sécurisée.",
      en: "One upkeep point to review: copyright year, legal page or an insecure resource.",
    },
    fail: {
      fr: "Plusieurs points d'entretien à revoir : année de copyright, mentions légales, ressources non sécurisées.",
      en: "Several upkeep points to review: copyright year, legal page, insecure resources.",
    },
    not_measured: { fr: "Non mesuré.", en: "Not measured." },
  },
};

export const STATUS_LABELS: Record<CheckStatus, Bilingual> = {
  pass: { fr: "OK", en: "OK" },
  partial: { fr: "À améliorer", en: "To improve" },
  fail: { fr: "À corriger", en: "To fix" },
  not_measured: { fr: "Non mesuré", en: "Not measured" },
};

/** Plain words for each flag — used in "why" lines, badges and the draft prompt. */
export const FLAG_COPY: Record<Flag, Bilingual> = {
  "no-site": { fr: "pas de site internet", en: "no website" },
  "no-ssl": { fr: "pas de connexion sécurisée (HTTPS)", en: "no secure connection (HTTPS)" },
  "cert-expiring": { fr: "certificat de sécurité proche de l'expiration", en: "security certificate close to expiry" },
  "slow-mobile": { fr: "site lent sur mobile", en: "slow site on mobile" },
  "not-mobile": { fr: "site non adapté au mobile", en: "site not mobile-friendly" },
  "no-contact": { fr: "aucun moyen de contact visible", en: "no visible way to get in touch" },
  "no-booking": { fr: "pas de prise de rendez-vous en ligne", en: "no online booking" },
  "no-socials": { fr: "pas de lien vers les réseaux sociaux", en: "no social-media links" },
  "no-schema": { fr: "pas de données structurées pour Google et les assistants IA", en: "no structured data for Google and AI assistants" },
  "blocks-ai": { fr: "les assistants IA ne peuvent pas lire votre site", en: "AI assistants cannot read your site" },
  "no-chat": { fr: "pas de discussion en ligne", en: "no online chat" },
  "no-gbp": { fr: "pas de fiche Google trouvée", en: "no Google listing found" },
  "stale-site": { fr: "site qui semble ne plus être mis à jour", en: "site that looks no longer updated" },
  "mixed-content": { fr: "ressources non sécurisées sur une page sécurisée", en: "insecure resources on a secure page" },
  "forbids-extraction": { fr: "le site interdit l'extraction", en: "the site forbids extraction" }, // admin only — INTERNAL_FLAGS keeps it out of prospect copy
};

/** Flags that never reach a prospect (they steer the CRM, not the report). */
export const INTERNAL_FLAGS: ReadonlySet<Flag> = new Set<Flag>(["forbids-extraction"]);

// ---- packages (labels verbatim from /pme, contract §7.2) --------------------------

export type PackageKey = "WEB" | "WEB_NO_SITE" | "AGENT" | "AUTO" | "SEC";

export const PACKAGE_LABELS: Record<PackageKey, Bilingual> = {
  WEB: { fr: "Site essentiel — à partir de 500 €", en: "Site essentiel — from €500" },
  WEB_NO_SITE: { fr: "Site + IA — à partir de 2 500 €", en: "Site + AI — from €2,500" },
  AGENT: { fr: "L'IA sur votre site — à partir de 500 €", en: "AI on your site — from €500" },
  AUTO: { fr: "L'IA sur votre site — à partir de 500 €", en: "AI on your site — from €500" },
  SEC: { fr: "Audit de sécurité e-commerce — à partir de 500 €/jour", en: "E-commerce security audit — from €500/day" },
};

/** One-line "what we would do" per package, shown under the label in "What we would do first". */
export const PACKAGE_ACTIONS: Record<PackageKey, Bilingual> = {
  WEB: {
    fr: "Remettre le site à niveau : connexion sécurisée, vitesse sur mobile, données lisibles par Google et les assistants IA.",
    en: "Bring the site up to standard: secure connection, mobile speed, data that Google and AI assistants can read.",
  },
  WEB_NO_SITE: {
    fr: "Créer un site clair avec vos horaires, votre téléphone, vos prestations et un assistant IA qui répond aux questions.",
    en: "Build a clear site with your hours, phone number, services and an AI assistant that answers questions.",
  },
  AGENT: {
    fr: "Ajouter un assistant qui répond aux questions courantes et prend les demandes, jour et nuit.",
    en: "Add an assistant that answers common questions and takes requests, day and night.",
  },
  AUTO: {
    fr: "Mettre en place la prise de rendez-vous ou de réservation en ligne, reliée à votre agenda.",
    en: "Set up online booking or reservations, connected to your diary.",
  },
  SEC: {
    fr: "Vérifier la sécurité de votre boutique en ligne avant qu'un problème ne coûte des ventes.",
    en: "Check the security of your online shop before a problem costs you sales.",
  },
};

/** WEB reads "Site + IA" when the audit found no site at all. */
export function packageKeyFor(pkg: FitSuggestion["pkg"], flags: readonly Flag[]): PackageKey {
  return pkg === "WEB" && flags.includes("no-site") ? "WEB_NO_SITE" : pkg;
}

/** "Site essentiel — à partir de 500 €" / "Site + AI — from €2,500" (when the WEB fit carries no-site). */
export function packageLabel(fit: Pick<FitSuggestion, "pkg" | "flags">, locale: AuditLocale): string {
  return PACKAGE_LABELS[packageKeyFor(fit.pkg, fit.flags)][locale];
}
