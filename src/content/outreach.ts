// Prospect-facing strings of the outreach module (contract §12, Appendix D):
// the legal footers per SendRule footer and locale, the /o/[token] page, the
// identity-source wording of the two-part notice, the refusal reasons in plain
// words (shown to the admin in the prospect's two languages, per contract §9)
// and the call opener lines. Every string here is signed by Radu before the
// first production send (Appendix F).
//
// No imports beyond types: this file is loaded by node --test through
// lib/outreach/{legal,refusals}.ts (strip-only mode). Placeholders are
// resolved by lib/outreach/legal.ts — never edit them here.
import type { Prospect, RefusalCode, SendRule } from "../lib/crm/types.ts";

export type OutreachLocale = "fr" | "en";
export type Bilingual = { fr: string; en: string };

// ---- footers ---------------------------------------------------------------------------------

/**
 * Exact texts of Appendix D. Structure of every footer: the "—" rule, the
 * opt-out line ALONE, a blank line, then the notice paragraphs. The email
 * sentence ("…, et votre adresse e-mail professionnelle sur {email_source} le
 * {audit_date}" / "…, and your business email address on {email_source} on
 * {audit_date}") is removed by legal.ts when the address came from the
 * identity source itself — EMAIL_CLAUSES holds those exact fragments.
 */
export const FR_FOOTER = `—
Pour ne plus recevoir nos messages : répondez STOP à cet e-mail ou cliquez ici : {optout_url}

Digital M — nom commercial de Digital Management Ltd, société immatriculée en Angleterre et au pays de Galles (n° 09457882), établissement en France : 3 Résidence des Écoles, 09000 Ferrières-sur-Ariège. Contact : contact@digitalm.eu.
Pourquoi vous recevez ce message : nous avons relevé le nom et l'adresse de votre établissement sur {identity_source} ({identity_url}) le {saved_date}, et votre adresse e-mail professionnelle sur {email_source} le {audit_date}, dans le cadre de votre activité de {trade}. Nous vous écrivons sur la base de notre intérêt légitime — la prospection commerciale entre professionnels, en rapport avec votre activité (art. 6.1.f du RGPD ; art. L34-5 du CPCE).
Vos données (dénomination, adresse, e-mail et téléphone professionnels, éléments techniques publics de votre site) sont conservées au maximum 3 ans après notre dernier échange (12 mois sans réponse de votre part), puis supprimées. Vous pouvez à tout moment demander l'accès, la rectification ou la suppression de vos données, ou vous opposer à leur traitement, en écrivant à contact@digitalm.eu, et introduire une réclamation auprès de la CNIL. Détails : {privacy_url}
Si vous exercez en entreprise individuelle, ce message vaut information au titre de l'article 14 du RGPD.`;

export const EN_FOOTER_FR = `—
To stop receiving our emails: reply STOP or click here: {optout_url}

Digital M is a trading name of Digital Management Ltd, registered in England and Wales (company no. 09457882), French establishment: 3 Résidence des Écoles, 09000 Ferrières-sur-Ariège, France. Contact: contact@digitalm.eu.
Why you are receiving this: we found your business's name and address on {identity_source} ({identity_url}) on {saved_date}, and your business email address on {email_source} on {audit_date}, in connection with your {trade} business. We are writing under our legitimate interest — business-to-business prospecting related to your trade (Article 6(1)(f) GDPR; art. L34-5 of the French CPCE).
We keep the details we hold (business name, address, business email and phone, public technical facts about your website) for at most 3 years after our last exchange (12 months without a reply), then delete them. You can ask to access, correct or delete them, or object to their use, at any time by emailing contact@digitalm.eu, and you can complain to the CNIL (cnil.fr). Details: {privacy_url}
If you trade as a sole trader, this message is the information notice under Article 14 GDPR.`;

export const EN_FOOTER_UK = `—
To stop receiving our emails: reply STOP or click here: {optout_url}

Digital M is a trading name of Digital Management Ltd, registered in England and Wales (company no. 09457882), 67 Meridian Centre, Havant, Hampshire, PO9 1UN, United Kingdom. Contact: contact@digitalm.eu.
Why you are receiving this: we found your business's name and address on {identity_source} ({identity_url}) on {saved_date}, and your business email address on {email_source} on {audit_date}, in connection with your {trade} business. We are writing to you as a corporate subscriber: regulation 22 of the Privacy and Electronic Communications Regulations 2003 does not require your prior consent for this message, and you can opt out at any time (regulation 23). Our lawful basis is our legitimate interest under Article 6(1)(f) of the UK GDPR.
We keep the details we hold (business name, address, business email and phone, public technical facts about your website) for at most 3 years after our last exchange (12 months without a reply). You can ask to access, correct or delete them, or object to their use, at any time by emailing contact@digitalm.eu, and you can complain to the Information Commissioner's Office (ico.org.uk). Details: {privacy_url}`;

export const EN_FOOTER_US = `—
To stop receiving our emails: reply STOP or click here: {optout_url} — we honour every request at once, and in any case within 10 business days.

This is a commercial message (advertisement) from Digital M, a trading name of Digital Management Ltd, 67 Meridian Centre, Havant, Hampshire, PO9 1UN, United Kingdom. Contact: contact@digitalm.eu.
Why you are receiving this: we found your business's name and address on {identity_source} ({identity_url}) on {saved_date}, and your business email address on {email_source} on {audit_date}, and are writing about services related to your {trade} business. We keep the details we hold for at most 3 years after our last exchange (12 months without a reply); you can ask us to delete them at any time by emailing contact@digitalm.eu. Lawful basis: our legitimate interest (Article 6(1)(f) GDPR / UK GDPR) in offering trade-related services to businesses. You can ask to access, correct or delete your details, or object to their use, at contact@digitalm.eu, and you can complain to the Information Commissioner's Office (ico.org.uk). Privacy notice: {privacy_url}`;

/** `FOOTERS[rule.footer][locale]`: the fr rule renders in FR or EN; the UK and US rules are English only. */
export const FOOTERS: Record<SendRule["footer"], Bilingual> = {
  fr: { fr: FR_FOOTER, en: EN_FOOTER_FR },
  en_uk: { fr: EN_FOOTER_UK, en: EN_FOOTER_UK },
  en_us: { fr: EN_FOOTER_US, en: EN_FOOTER_US },
};

/** The email sentence of each footer, removed when the address came from the identity source. */
export const EMAIL_CLAUSES: Bilingual = {
  fr: ", et votre adresse e-mail professionnelle sur {email_source} le {audit_date}",
  en: ", and your business email address on {email_source} on {audit_date}",
};

/** "{email_source}" wording: the website, with the page when known. */
export const EMAIL_SOURCE: Record<OutreachLocale, { withPage: string; withoutPage: string }> = {
  fr: { withPage: "votre site internet {domain} (page {page})", withoutPage: "votre site internet {domain}" },
  en: { withPage: "your website {domain} (page {page})", withoutPage: "your website {domain}" },
};

/** "{trade}" when trade_key is null. */
export const FALLBACK_TRADE: Bilingual = { fr: "votre activité professionnelle", en: "your business" };

/** Two-part source notice: where the identity came from, with the public URL of that source. */
export const IDENTITY_SOURCES: Record<Exclude<Prospect["source"], "manual">, { label: Bilingual; url: string }> = {
  fr_register: {
    label: {
      fr: "le registre national des entreprises (annuaire-entreprises.data.gouv.fr)",
      en: "the French national business register (annuaire-entreprises.data.gouv.fr)",
    },
    url: "https://annuaire-entreprises.data.gouv.fr",
  },
  osm: {
    label: {
      fr: "OpenStreetMap (données © les contributeurs d'OpenStreetMap, ODbL)",
      en: "OpenStreetMap (data © OpenStreetMap contributors, ODbL)",
    },
    url: "https://www.openstreetmap.org",
  },
  companies_house: {
    label: { fr: "Companies House", en: "Companies House" },
    url: "https://find-and-update.company-information.service.gov.uk",
  },
  // Google Places stays off in v1 (Appendix F); the wording exists so a
  // google-sourced row never falls back to a wrong source.
  google: {
    label: { fr: "votre fiche Google (Google Maps Platform)", en: "your Google listing (Google Maps Platform)" },
    url: "https://www.google.com/maps",
  },
};

/** Manual (Add by URL) rows: the identity came from the prospect's own website. */
export const WEBSITE_IDENTITY: Bilingual = { fr: "votre site internet {domain}", en: "your website {domain}" };

// ---- /o/[token] page ------------------------------------------------------------------------

export interface OptoutPageText {
  title: string;
  text: string;
  button: string;
  done: string;
  already: string;
  invalid: string;
  footer: string;
  privacy: string;
}

export const OPTOUT_PAGE: Record<OutreachLocale, OptoutPageText> = {
  fr: {
    title: "Ne plus recevoir nos e-mails",
    text: "Vous vous apprêtez à demander à Digital M (Digital Management Ltd) de ne plus vous envoyer d'e-mails de prospection. Aucune identification, aucune raison à donner. Votre adresse sera ajoutée à notre liste d'opposition, consultée avant chaque envoi et conservée sans limite de durée, tant que nous faisons de la prospection — c'est ce qui garantit que vous ne serez plus contacté.",
    button: "Confirmer : ne plus me contacter",
    done: "C'est noté. Vous ne recevrez plus d'e-mails de prospection de notre part. Si vous souhaitez aussi la suppression de vos données, écrivez à contact@digitalm.eu.",
    already: "Cette demande a déjà été enregistrée. Vous ne recevez plus nos e-mails de prospection.",
    invalid: "Ce lien n'est pas valide. Pour ne plus recevoir nos e-mails, écrivez STOP à contact@digitalm.eu.",
    footer: "Digital M — Digital Management Ltd · 3 Résidence des Écoles, 09000 Ferrières-sur-Ariège",
    privacy: "Politique de confidentialité",
  },
  en: {
    title: "Stop receiving our emails",
    text: "You are about to ask Digital M (Digital Management Ltd) to stop sending you prospecting emails. No sign-in, no reason needed. Your address will be added to our suppression list, which is checked before every send and kept indefinitely, for as long as we prospect — that is what guarantees you will not be contacted again.",
    button: "Confirm: do not contact me",
    done: "Done. You will not receive any more prospecting emails from us. If you also want your data deleted, email contact@digitalm.eu.",
    already: "This request was already recorded. You no longer receive our prospecting emails.",
    invalid: "This link is not valid. To stop receiving our emails, write STOP to contact@digitalm.eu.",
    footer: "Digital M — Digital Management Ltd · 67 Meridian Centre, Havant, Hampshire, PO9 1UN, United Kingdom",
    privacy: "Privacy policy",
  },
};

// ---- refusal reasons ---------------------------------------------------------------------------

/** Plain words for every RefusalCode (contract §9), FR and EN. */
export const REFUSAL_MESSAGES: Record<RefusalCode, Bilingual> = {
  country_blocked: {
    fr: "Pas d'e-mail depuis l'outil pour ce pays : appelez ou écrivez à la main.",
    en: "No in-app email for this country: call or write by hand.",
  },
  no_email: {
    fr: "Aucune adresse e-mail professionnelle valide : appelez ou ajoutez une adresse vérifiée.",
    en: "No valid business email address: call, or add a verified address.",
  },
  email_webmail: {
    fr: "Cette adresse est une messagerie personnelle (Gmail, Orange…) : jamais d'e-mail de prospection.",
    en: "This address is a personal mailbox (Gmail, Outlook…): never a prospecting email.",
  },
  email_sole_trader_consent: {
    fr: "Entrepreneur individuel au Royaume-Uni : e-mail interdit sans consentement préalable (PECR reg. 22).",
    en: "UK sole trader: no email without prior consent (PECR reg 22).",
  },
  email_unknown_legal_form: {
    fr: "Forme juridique inconnue au Royaume-Uni : appel uniquement, tant que le registre ne dit pas « société ».",
    en: "Unknown legal form in the UK: call only, until the register says it is a company.",
  },
  optout_listed: {
    fr: "Ce contact figure sur la liste d'opposition : aucun contact.",
    en: "This contact is on the opposition list: no contact.",
  },
  emailed_recently: {
    fr: "Un e-mail est parti il y a moins de 90 jours : attendez.",
    en: "An email went out less than 90 days ago: wait.",
  },
  max_emails_reached: {
    fr: "Deux e-mails en 90 jours : pas de troisième, quel que soit le canal.",
    en: "Two emails in 90 days: no third, whatever the channel.",
  },
  audit_missing: {
    fr: "Aucun audit terminé : lancez l'audit d'abord.",
    en: "No finished audit: run the audit first.",
  },
  audit_stale: {
    fr: "L'audit a plus de 90 jours : relancez-le avant d'écrire.",
    en: "The audit is older than 90 days: run it again before writing.",
  },
  daily_cap: {
    fr: "Plafond quotidien atteint : reprenez demain.",
    en: "Daily cap reached: continue tomorrow.",
  },
  forbids_extraction: {
    fr: "Le site interdit l'extraction ou la prospection : pas de contact sans motif de dérogation enregistré.",
    en: "The site forbids extraction or prospecting: no contact without a recorded override reason.",
  },
  register_inactive: {
    fr: "Entreprise cessée selon le registre : aucun contact.",
    en: "Business ceased according to the register: no contact.",
  },
  register_partial: {
    fr: "Diffusion partielle au registre : les coordonnées ne peuvent pas être utilisées.",
    en: "Partial diffusion in the register: the contact details cannot be used.",
  },
  notice_deadline_passed: {
    fr: "Plus de 30 jours sans information du contact : la purge doit effacer ces données avant tout nouveau contact.",
    en: "Over 30 days without informing the contact: the purge must clear this data before any new contact.",
  },
  not_a_fit: {
    fr: "Marqué « pas une cible » : aucun contact.",
    en: "Marked not a fit: no contact.",
  },
  draft_unreviewed: {
    fr: "Le brouillon n'a pas été relu : enregistrez-le d'abord.",
    en: "The draft has not been reviewed: save it first.",
  },
  stage_closed: {
    fr: "Ce contact est clos (gagné, perdu, sans réponse ou STOP) : aucun e-mail.",
    en: "This contact is closed (won, lost, no response or STOP): no email.",
  },
  lead_in_conversation: {
    fr: "Ce contact est en discussion : pas d'e-mail de prospection.",
    en: "This contact is in conversation: no prospecting email.",
  },
  call_window_closed: {
    fr: "En dehors des heures d'appel autorisées dans le pays du contact.",
    en: "Outside the calling hours allowed in the contact's country.",
  },
  call_attempts_exceeded: {
    fr: "Quatre tentatives d'appel en 30 jours : pas de cinquième.",
    en: "Four call attempts in 30 days: no fifth.",
  },
  call_screening_missing: {
    fr: "Vérifiez le numéro sur TPS et CTPS avant d'appeler (PECR reg. 21).",
    en: "Screen the number against TPS and CTPS before calling (PECR reg 21).",
  },
};

// ---- calls ---------------------------------------------------------------------------------------

/** Opening lines the CNIL expects on a prospecting call: who, where the number came from, why, the right to refuse. */
export const CALL_OPENERS: Record<OutreachLocale, string[]> = {
  fr: [
    "Bonjour, Radu de Digital M, une petite agence web en Ariège.",
    "J'ai trouvé votre numéro sur {phone_source}.",
    "J'ai fait un rapide état des lieux de votre site : je vous appelle pour vous en dire deux mots.",
    "Vous pouvez refuser tout de suite : je le note et je ne vous rappelle pas.",
  ],
  en: [
    "Hello, this is Radu from Digital M, a small web agency in the south of France.",
    "I found your number on {phone_source}.",
    "I ran a quick check of your website: I am calling to tell you what I saw, in two minutes.",
    "You can say no right now: I will note it and will not call again.",
  ],
};

/** "{phone_source}" wording per origin of the number. */
export const PHONE_SOURCES: Record<"website" | "osm" | "fr_register" | "companies_house" | "google" | "manual", Bilingual> = {
  website: { fr: "votre site internet", en: "your website" },
  osm: { fr: "OpenStreetMap", en: "OpenStreetMap" },
  fr_register: { fr: "le registre des entreprises", en: "the business register" },
  companies_house: { fr: "Companies House", en: "Companies House" },
  google: { fr: "votre fiche Google", en: "your Google listing" },
  manual: { fr: "vos coordonnées publiques", en: "your public listing" },
};

/** Subject of the 7-day follow-up when no earlier subject can be reused. */
export const FOLLOW_UP_SUBJECT: Bilingual = { fr: "Relance : le rapport sur votre site", en: "Follow-up: the report on your website" };
