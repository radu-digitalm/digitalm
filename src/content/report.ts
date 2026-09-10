// Prospect-facing copy for the one-page report (/r/[token]) and the outreach
// drafts (contract §8). FR and EN for everything a prospect can read; the
// admin side of the draft panel is English and lives in the component.
//
// Rules baked into these strings: plain words, no hype, never "error" for the
// AI-readability check ("AI assistants cannot read your site"), and the
// package labels verbatim from /pme (contract §7.2). The report is rendered
// only from stored audit results, so every sentence here describes a status,
// never a crawled value.
//
// No imports beyond types: this file is loaded by node --test through
// lib/report/findings.ts and lib/drafts/templates.ts (strip-only mode).
import type { CheckKey, CheckStatus, Flag } from "@/lib/crm/types";

export type ReportLocale = "fr" | "en";
export type Bilingual = { fr: string; en: string };

// ---- writing rules -----------------------------------------------------------

/** The nine words the /api/chat prompt forbids; a draft containing one falls back to the template. */
export const BANNED_WORDS = [
  "revolutionize",
  "disrupt",
  "synergy",
  "transform your business",
  "unleash",
  "supercharge",
  "cutting-edge",
  "game-changer",
  "next-level",
] as const;

/** Generic name used when a sole trader's enseigne would reveal a personal name. */
export const GENERIC_BUSINESS: Bilingual = { fr: "votre établissement", en: "your business" };

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

// ---- trades ------------------------------------------------------------------------

// Display labels for the 19 fixed category keys (finder's categories.ts is the
// source of truth for discovery; this mirror only turns a stored trade_key into
// words for a prospect). A custom trade stores its label as the key and is
// shown as is.
export const TRADE_LABELS: Record<string, Bilingual> = {
  restaurant: { fr: "restaurant", en: "restaurant" },
  bar: { fr: "bar", en: "bar" },
  hotel: { fr: "hôtel", en: "hotel" },
  gite: { fr: "gîte", en: "guest house" },
  campsite: { fr: "camping", en: "campsite" },
  bakery: { fr: "boulangerie", en: "bakery" },
  butcher: { fr: "boucherie", en: "butcher's" },
  hairdresser: { fr: "salon de coiffure", en: "hairdresser's" },
  beauty: { fr: "institut de beauté", en: "beauty salon" },
  garage: { fr: "garage automobile", en: "car repair garage" },
  plumber: { fr: "plomberie", en: "plumbing business" },
  electrician: { fr: "électricité", en: "electrical business" },
  joiner: { fr: "menuiserie", en: "joinery" },
  painter: { fr: "peinture en bâtiment", en: "painting and decorating" },
  roofer: { fr: "couverture", en: "roofing" },
  estate_agent: { fr: "agence immobilière", en: "estate agency" },
  optician: { fr: "opticien", en: "optician's" },
  dentist: { fr: "cabinet dentaire", en: "dental practice" },
  gym: { fr: "salle de sport", en: "gym" },
};

// ---- checks ---------------------------------------------------------------------------

export type CheckCopy = { name: Bilingual } & Record<CheckStatus, Bilingual>;

export const CHECK_COPY: Record<CheckKey, CheckCopy> = {
  reachable: {
    name: { fr: "Site accessible", en: "Site reachable" },
    pass: { fr: "Votre site répond correctement.", en: "Your site responds correctly." },
    partial: { fr: "Votre site répond, mais lentement (plus de 5 secondes).", en: "Your site responds, but slowly (over 5 seconds)." },
    fail: { fr: "Votre site ne répond pas ou renvoie une page d'erreur.", en: "Your site does not respond or returns an error page." },
    not_measured: { fr: "Non mesuré.", en: "Not measured." },
  },
  https: {
    name: { fr: "Connexion sécurisée (HTTPS)", en: "Secure connection (HTTPS)" },
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
    name: { fr: "Vitesse sur mobile", en: "Mobile speed" },
    pass: { fr: "Votre site se charge vite sur mobile.", en: "Your site loads quickly on mobile." },
    partial: { fr: "Votre site se charge moyennement vite sur mobile.", en: "Your site loads at an average speed on mobile." },
    fail: {
      fr: "Votre site se charge lentement sur mobile : une partie des visiteurs part avant de l'avoir vu.",
      en: "Your site loads slowly on mobile: some visitors leave before they see it.",
    },
    not_measured: { fr: "Non mesuré.", en: "Not measured." },
  },
  seo_basics: {
    name: { fr: "Bases du référencement", en: "Search basics" },
    pass: { fr: "Titre, description et affichage mobile sont en place.", en: "Title, description and mobile layout are in place." },
    partial: { fr: "Un élément de base manque : titre, description ou affichage mobile.", en: "One basic element is missing: title, description or mobile layout." },
    fail: { fr: "Votre site n'est pas adapté au mobile ou manque des bases du référencement.", en: "Your site is not mobile-friendly or lacks the search basics." },
    not_measured: { fr: "Non mesuré.", en: "Not measured." },
  },
  contact: {
    name: { fr: "Contact et prise de rendez-vous", en: "Contact and booking" },
    pass: { fr: "Un moyen de contact et une prise de rendez-vous en ligne sont visibles.", en: "A way to get in touch and an online booking option are visible." },
    partial: { fr: "On peut vous contacter, mais pas réserver ni prendre rendez-vous en ligne.", en: "Visitors can contact you, but cannot book or make an appointment online." },
    fail: { fr: "Aucun moyen de contact clair (téléphone, e-mail ou formulaire) n'a été trouvé.", en: "No clear way to get in touch (phone, email or form) was found." },
    not_measured: { fr: "Non mesuré.", en: "Not measured." },
  },
  socials: {
    name: { fr: "Réseaux sociaux", en: "Social media" },
    pass: { fr: "Au moins un réseau social est relié à votre site.", en: "At least one social network is linked from your site." },
    partial: { fr: "Un seul réseau social est relié à votre site.", en: "Only one social network is linked from your site." },
    fail: { fr: "Aucun lien vers vos réseaux sociaux.", en: "No links to your social networks." },
    not_measured: { fr: "Non mesuré.", en: "Not measured." },
  },
  schema: {
    name: { fr: "Données structurées", en: "Structured data" },
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
    name: { fr: "Lisible par les assistants IA", en: "Readable by AI assistants" },
    pass: { fr: "Les assistants IA peuvent lire votre site, et un canal de discussion existe.", en: "AI assistants can read your site, and a chat channel exists." },
    partial: {
      fr: "Les assistants IA peuvent lire votre site, mais il n'y a ni fichier llms.txt ni discussion en ligne.",
      en: "AI assistants can read your site, but there is no llms.txt file and no online chat.",
    },
    fail: { fr: "Les assistants IA ne peuvent pas lire votre site.", en: "AI assistants cannot read your site." },
    not_measured: { fr: "Non mesuré.", en: "Not measured." },
  },
  google_listing: {
    name: { fr: "Fiche Google", en: "Google listing" },
    pass: { fr: "Votre fiche Google est en place.", en: "Your Google listing is in place." },
    partial: { fr: "Votre fiche Google existe, mais elle est incomplète.", en: "Your Google listing exists, but it is incomplete." },
    fail: { fr: "Nous n'avons pas trouvé de fiche Google pour votre établissement.", en: "We could not find a Google listing for your business." },
    not_measured: { fr: "Nous n'avons pas vérifié votre fiche Google.", en: "We have not checked your Google listing." },
  },
  housekeeping: {
    name: { fr: "Entretien du site", en: "Site upkeep" },
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

/** Plain words for each flag — used in "why" lines and in the draft prompt. */
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
  "forbids-extraction": { fr: "", en: "" }, // internal flag, never shown to a prospect
};

// ---- report page --------------------------------------------------------------------------

export const STATUS_LABELS: Record<CheckStatus, Bilingual> = {
  pass: { fr: "OK", en: "OK" },
  partial: { fr: "À améliorer", en: "To improve" },
  fail: { fr: "À corriger", en: "To fix" },
  not_measured: { fr: "Non mesuré", en: "Not measured" },
};

export type ReportUi = {
  eyebrow: string;
  /** "{business}" placeholder */
  title: string;
  siteChecked: string;
  checkedOn: string;
  noWebsite: string;
  scoreLabel: string;
  gradeLabel: string;
  /** "{n}" placeholder — number of measured checks */
  scoreExplainer: string;
  findingsHeading: string;
  findingsIntro: string;
  checksHeading: string;
  googleHeading: string;
  firstStepsHeading: string;
  firstStepsIntro: string;
  allGood: string;
  ctaHeading: string;
  ctaIntro: string;
  ctaDiagnostic: string;
  ctaBook: string;
  methodNote: string;
  expiredHeading: string;
  expiredBody: string;
  expiredCta: string;
  footerCompany: string;
  footerAddress: string;
  privacy: string;
  contact: string;
  points: string;
};

export const REPORT_UI: Record<ReportLocale, ReportUi> = {
  fr: {
    eyebrow: "Rapport Digital M",
    title: "Votre présence en ligne : {business}",
    siteChecked: "Site analysé",
    checkedOn: "Analysé le",
    noWebsite: "Aucun site internet trouvé pour votre établissement.",
    scoreLabel: "Score global",
    gradeLabel: "Note",
    scoreExplainer: "Sur 100, à partir de {n} vérifications mesurées.",
    findingsHeading: "Les trois points qui comptent le plus",
    findingsIntro: "Ce que nous regarderions en premier, dans l'ordre.",
    checksHeading: "Les dix vérifications",
    googleHeading: "Fiche Google",
    firstStepsHeading: "Ce que nous ferions en premier",
    firstStepsIntro: "Périmètre fixe, prix annoncé à l'avance.",
    allGood: "Votre présence en ligne est en bon état. Nous n'avons rien d'urgent à vous proposer — gardez ce rapport comme point de repère.",
    ctaHeading: "Envie d'en parler ?",
    ctaIntro: "Deux options, sans engagement.",
    ctaDiagnostic: "Faire le diagnostic gratuit (3 min)",
    ctaBook: "Prendre rendez-vous",
    methodNote:
      "Ce rapport est établi automatiquement à partir de la lecture publique de votre site (trois pages au plus, dans le respect de votre fichier robots.txt) et de Google PageSpeed Insights. Il porte uniquement sur des constats techniques publics de votre site.",
    expiredHeading: "Ce rapport a expiré",
    expiredBody:
      "Les rapports restent consultables pendant 90 jours après leur envoi. Vous pouvez refaire un diagnostic gratuit en trois minutes.",
    expiredCta: "Faire le diagnostic gratuit",
    footerCompany: "Digital M — nom commercial de Digital Management Ltd",
    footerAddress: "3 Résidence des Écoles, 09000 Ferrières-sur-Ariège, France",
    privacy: "Politique de confidentialité",
    contact: "contact@digitalm.eu",
    points: "pts",
  },
  en: {
    eyebrow: "Digital M report",
    title: "Your online presence: {business}",
    siteChecked: "Site checked",
    checkedOn: "Checked on",
    noWebsite: "No website was found for your business.",
    scoreLabel: "Overall score",
    gradeLabel: "Grade",
    scoreExplainer: "Out of 100, from {n} measured checks.",
    findingsHeading: "The three points that matter most",
    findingsIntro: "What we would look at first, in order.",
    checksHeading: "The ten checks",
    googleHeading: "Google listing",
    firstStepsHeading: "What we would do first",
    firstStepsIntro: "Fixed scope, price agreed up front.",
    allGood: "Your online presence is in good shape. We have nothing urgent to suggest — keep this report as a reference point.",
    ctaHeading: "Want to talk it through?",
    ctaIntro: "Two options, no strings attached.",
    ctaDiagnostic: "Take the free diagnostic (3 min)",
    ctaBook: "Book a call",
    methodNote:
      "This report is produced automatically from the public pages of your site (three at most, honouring your robots.txt) and Google PageSpeed Insights. It covers only public technical facts about your website.",
    expiredHeading: "This report has expired",
    expiredBody: "Reports stay readable for 90 days after they are sent. You can run a free diagnostic again in three minutes.",
    expiredCta: "Take the free diagnostic",
    footerCompany: "Digital M — a trading name of Digital Management Ltd",
    footerAddress: "3 Résidence des Écoles, 09000 Ferrières-sur-Ariège, France",
    privacy: "Privacy policy",
    contact: "contact@digitalm.eu",
    points: "pts",
  },
};
