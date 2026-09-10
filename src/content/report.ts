// Prospect-facing copy for the one-page report (/r/[token]) and the outreach
// drafts (contract §8). FR and EN for everything a prospect can read; the
// admin side of the draft panel is English and lives in the component.
//
// Check, flag and package wording lives in auditChecks.ts (single source);
// this file keeps what only the report and the drafts need: the writing rules,
// the generic business name, the trade labels and the page chrome. Every
// sentence describes a status, never a crawled value.
//
// No imports beyond types: this file is loaded by node --test through
// lib/report/findings.ts and lib/drafts/templates.ts (strip-only mode).
import type { AuditLocale, Bilingual } from "./auditChecks";

export type ReportLocale = AuditLocale;
export type { Bilingual };

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
