// Free Digital Check-up — question config (EN/FR).
// The wizard renders entirely from this file; scoring lives in lib/diagnosticScoring.ts.
// Spec: /home/hermes/workspace/digitalm-diagnostic-form-spec.md

export type Locale2 = "en" | "fr";

export type Option = {
  id: string;
  en: string;
  fr: string;
  /** Shows a free-text input when selected (e.g. "Other"). */
  other?: boolean;
  /** With `other`: the free-text box has to be filled in before moving on. */
  otherRequired?: true;
};

export type Question = {
  id: string;
  kind: "chips" | "chips-multi" | "cards" | "text" | "textarea" | "email" | "tel" | "url";
  required?: boolean;
  /**
   * Required only for some earlier answers (e.g. the website address once they
   * told us they sell on their own site). Honoured wherever `required` is.
   */
  requiredIf?: (answers: Record<string, unknown>) => boolean;
  /** Max selections for chips-multi / cards. */
  max?: number;
  en: string;
  fr: string;
  hintEn?: string;
  hintFr?: string;
  /** Replaces hintEn / hintFr while `requiredIf` makes the answer mandatory. */
  hintRequiredEn?: string;
  hintRequiredFr?: string;
  placeholderEn?: string;
  placeholderFr?: string;
  options?: Option[];
  /** Tap-to-prefill starters (magic wand). */
  starters?: { en: string; fr: string }[];
};

export type BranchKey = "A" | "B" | "C" | "D" | "E";

// ---------- Step 1 — Your business ----------
export const STEP1: Question[] = [
  {
    id: "activity",
    kind: "chips",
    required: true,
    en: "What does your business do?",
    fr: "Quelle est votre activité ?",
    options: [
      { id: "retail", en: "Retail shop", fr: "Commerce / boutique" },
      { id: "ecom", en: "Online store / e-commerce", fr: "Boutique en ligne / e-commerce" },
      { id: "services", en: "Services", fr: "Services" },
      { id: "artisan", en: "Artisan / craft / trades", fr: "Artisan / métiers manuels" },
      { id: "hospitality", en: "Restaurant / hospitality", fr: "Restauration / hôtellerie" },
      { id: "other", en: "Other (tell us)", fr: "Autre (précisez)", other: true, otherRequired: true },
    ],
  },
  {
    id: "team",
    kind: "chips",
    required: true,
    en: "How many people in the business?",
    fr: "Vous êtes combien dans l'entreprise ?",
    options: [
      { id: "solo", en: "Just me", fr: "Moi seul(e)" },
      { id: "2-5", en: "2–5", fr: "2–5" },
      { id: "6-20", en: "6–20", fr: "6–20" },
      { id: "20+", en: "20+", fr: "20+" },
    ],
  },
  {
    id: "sellsOnline",
    kind: "chips",
    required: true,
    en: "Do you sell online today?",
    fr: "Vendez-vous en ligne aujourd'hui ?",
    options: [
      { id: "own-site", en: "Yes, on our own site", fr: "Oui, sur notre propre site" },
      { id: "marketplaces", en: "Yes, on marketplaces", fr: "Oui, sur des places de marché" },
      { id: "want-to", en: "Not yet, but we'd like to", fr: "Pas encore, mais on aimerait" },
      { id: "no", en: "No, and that's fine", fr: "Non, et ça nous va" },
    ],
  },
];

// ---------- Step 2 — Router ----------
export const ROUTER: Question = {
  id: "pains",
  kind: "cards",
  required: true,
  max: 2,
  en: "Which of these feels most true right now?",
  fr: "Qu'est-ce qui vous parle le plus en ce moment ?",
  hintEn: "Pick up to two.",
  hintFr: "Choisissez-en jusqu'à deux.",
  options: [
    { id: "A", en: "Too much manual, repetitive admin work", fr: "Trop de tâches manuelles et répétitives" },
    { id: "B", en: "We miss messages or answer customers too slowly", fr: "On rate des messages ou on répond trop lentement aux clients" },
    { id: "C", en: "Our website is outdated, or we have none, and it brings in no business", fr: "Notre site est dépassé, ou on n'en a pas, et il ne ramène pas de clients" },
    { id: "D", en: "Customer info is scattered: quotes and follow-ups get forgotten", fr: "Les infos clients sont éparpillées : des devis et des relances sont oubliés" },
    { id: "E", en: "I worry about the security of our online shop", fr: "Je m'inquiète pour la sécurité de notre boutique en ligne" },
    { id: "unsure", en: "Honestly not sure, that's exactly why I'm here", fr: "Honnêtement, je ne sais pas trop, c'est justement pour ça que je suis là" },
  ],
};

// ---------- Step 3 — Branch deep-dives ----------
export const BRANCHES: Record<BranchKey, Question[]> = {
  A: [
    {
      id: "A_where",
      kind: "chips-multi",
      required: true,
      en: "Where does the time go?",
      fr: "Où part le temps ?",
      options: [
        { id: "invoices", en: "Invoices and quotes", fr: "Factures et devis" },
        { id: "copying", en: "Re-typing the same info from one tool to another", fr: "Recopier les mêmes infos d'un outil à l'autre" },
        { id: "scheduling", en: "Scheduling", fr: "Planning / rendez-vous" },
        { id: "stock", en: "Stock / inventory", fr: "Stock / inventaire" },
        { id: "orders", en: "Order processing", fr: "Traitement des commandes" },
        { id: "reports", en: "Reports / bookkeeping", fr: "Rapports / comptabilité" },
        { id: "email", en: "Sorting email", fr: "Trier les e-mails" },
        { id: "other", en: "Another task", fr: "Une autre tâche", other: true },
      ],
    },
    {
      id: "A_hours",
      kind: "chips",
      required: true,
      en: "Roughly how many hours a week does that take you?",
      fr: "Combien d'heures par semaine est-ce que ça vous prend, à peu près ?",
      options: [
        { id: "<5", en: "Under 5", fr: "Moins de 5" },
        { id: "5-15", en: "5–15", fr: "5–15" },
        { id: "15-30", en: "15–30", fr: "15–30" },
        { id: "30+", en: "30+", fr: "30+" },
        { id: "unknown", en: "No idea (that's normal!)", fr: "Aucune idée (c'est normal !)" },
      ],
    },
  ],
  B: [
    {
      id: "B_channels",
      kind: "chips-multi",
      en: "How do customers reach you?",
      fr: "Par où les clients vous contactent-ils ?",
      options: [
        { id: "email", en: "Email", fr: "E-mail" },
        { id: "phone", en: "Phone", fr: "Téléphone" },
        { id: "whatsapp", en: "WhatsApp", fr: "WhatsApp" },
        { id: "social", en: "Instagram / Facebook", fr: "Instagram / Facebook" },
        { id: "form", en: "Website form", fr: "Formulaire du site" },
        { id: "marketplace", en: "Marketplace messages", fr: "Messages des places de marché" },
      ],
    },
    {
      id: "B_asks",
      kind: "chips-multi",
      required: true,
      en: "What do they mostly ask?",
      fr: "Que demandent-ils le plus souvent ?",
      options: [
        { id: "prices", en: "Prices and quotes", fr: "Prix et devis" },
        { id: "availability", en: "Availability / bookings", fr: "Disponibilités / réservations" },
        { id: "order-status", en: "Order status", fr: "Suivi de commande" },
        { id: "product", en: "Product questions", fr: "Questions produits" },
        { id: "aftersales", en: "After-sales", fr: "Service après-vente" },
      ],
    },
    {
      id: "B_speed",
      kind: "chips",
      required: true,
      en: "How fast do you reply today?",
      fr: "En combien de temps répondez-vous aujourd'hui ?",
      options: [
        { id: "hour", en: "Within the hour", fr: "Dans l'heure" },
        { id: "same-day", en: "Same day", fr: "Dans la journée" },
        { id: "when-we-can", en: "When we can", fr: "Quand on peut" },
        { id: "slip", en: "Some never get an answer", fr: "Il y en a qui restent sans réponse" },
      ],
    },
  ],
  C: [
    {
      id: "C_situation",
      kind: "chips",
      required: true,
      en: "Which is closest to your situation?",
      fr: "Qu'est-ce qui décrit le mieux votre situation ?",
      options: [
        { id: "none", en: "No website yet", fr: "Pas encore de site" },
        { id: "outdated", en: "Outdated, I'd rather not show it", fr: "Dépassé, je n'ose pas trop le montrer" },
        { id: "no-sales", en: "Fine, but you can't buy or book on it", fr: "Correct, mais impossible d'y vendre ou d'y réserver" },
        { id: "underperforms", en: "The shop exists but doesn't sell enough", fr: "La boutique existe mais ne vend pas assez" },
      ],
    },
    {
      id: "C_matters",
      kind: "chips-multi",
      required: true,
      max: 2,
      en: "What matters most to you online?",
      fr: "Qu'est-ce qui compte le plus pour vous en ligne ?",
      hintEn: "Pick up to two.",
      hintFr: "Choisissez-en jusqu'à deux.",
      options: [
        { id: "professional", en: "Look professional", fr: "Avoir l'air professionnel" },
        { id: "google", en: "Get found on Google", fr: "Être trouvé sur Google" },
        { id: "sell", en: "Sell online", fr: "Vendre en ligne" },
        { id: "bookings", en: "Take bookings", fr: "Prendre des réservations" },
        { id: "language", en: "Offer another language", fr: "Proposer une autre langue" },
      ],
    },
    {
      id: "C_url",
      kind: "url",
      en: "Your website address (optional)",
      fr: "L'adresse de votre site (facultatif)",
      hintEn: "So we can take a look before we reply.",
      hintFr: "Pour qu'on y jette un œil avant de vous répondre.",
      placeholderEn: "yourbusiness.com",
      placeholderFr: "votreentreprise.fr",
    },
  ],
  D: [
    {
      id: "D_where",
      kind: "chips-multi",
      required: true,
      en: "Where is customer information kept today?",
      fr: "Où sont rangées les infos clients aujourd'hui ?",
      options: [
        { id: "spreadsheets", en: "Spreadsheets", fr: "Tableurs" },
        { id: "inbox", en: "Email inbox", fr: "Boîte mail" },
        { id: "paper", en: "On paper, or in someone's head", fr: "Sur papier, ou dans la tête de quelqu'un" },
        { id: "invoicing", en: "Invoicing tool", fr: "Logiciel de facturation" },
        { id: "crm", en: "A CRM already (which one?)", fr: "Déjà un CRM (lequel ?)", other: true },
      ],
    },
    {
      id: "D_breaks",
      kind: "chips-multi",
      required: true,
      en: "What does that cost you in practice?",
      fr: "Qu'est-ce que ça vous coûte concrètement ?",
      options: [
        { id: "followups", en: "Quotes never followed up", fr: "Des devis jamais relancés" },
        { id: "pipeline", en: "No visibility on work in progress", fr: "Aucune visibilité sur les affaires en cours" },
        { id: "duplicates", en: "Duplicate or lost information", fr: "Des infos en double, ou perdues" },
        { id: "team", en: "Everyone keeps their own info", fr: "Chacun garde ses infos dans son coin" },
      ],
    },
  ],
  E: [
    {
      id: "E_platform",
      kind: "chips",
      required: true,
      en: "What is the shop built on?",
      fr: "Sur quelle plateforme est votre boutique ?",
      options: [
        { id: "shopify", en: "Shopify", fr: "Shopify" },
        { id: "woo", en: "WooCommerce", fr: "WooCommerce" },
        { id: "presta", en: "PrestaShop", fr: "PrestaShop" },
        { id: "magento", en: "Magento", fr: "Magento" },
        { id: "custom", en: "Custom / an agency built it", fr: "Sur mesure / faite par une agence" },
        { id: "unsure", en: "Not sure", fr: "Je ne sais pas" },
      ],
    },
    {
      id: "E_trigger",
      kind: "chips",
      required: true,
      en: "What brings the question up?",
      fr: "Qu'est-ce qui vous amène à vous poser la question ?",
      options: [
        { id: "incident", en: "We had an incident", fr: "On a eu un incident" },
        { id: "suspicious", en: "We noticed something suspicious", fr: "On a remarqué quelque chose de suspect" },
        { id: "gdpr", en: "Protecting customer data", fr: "La protection des données clients" },
        { id: "asked", en: "A partner or bank asked", fr: "Un partenaire ou la banque l'a demandé" },
        { id: "peace", en: "Just to sleep better", fr: "Juste dormir tranquille" },
      ],
    },
    {
      id: "E_url",
      kind: "url",
      en: "Your shop address (optional)",
      fr: "L'adresse de votre boutique (facultatif)",
      placeholderEn: "yourshop.com",
      placeholderFr: "votreboutique.fr",
    },
  ],
};

/** Core two questions per branch when TWO router cards are picked (hard cap 4). */
export const BRANCH_CORE: Record<BranchKey, string[]> = {
  A: ["A_where", "A_hours"],
  B: ["B_asks", "B_speed"], // drops B_channels — recovered on the call
  C: ["C_situation", "C_matters"],
  D: ["D_where", "D_breaks"],
  E: ["E_platform", "E_trigger"],
};

// ---------- Step 4 — Tools & magic wand ----------
export const TOOLS: Question = {
  id: "tools",
  kind: "chips-multi",
  en: "Which tools do you use day-to-day?",
  fr: "Quels outils utilisez-vous au quotidien ?",
  hintEn: "Tap everything you use, or skip this one.",
  hintFr: "Cochez ce que vous utilisez, ou passez la question.",
  options: [
    { id: "google", en: "Google Workspace", fr: "Google Workspace" },
    { id: "microsoft", en: "Microsoft 365", fr: "Microsoft 365" },
    { id: "sheets", en: "Excel / Sheets", fr: "Excel / Sheets" },
    { id: "invoicing", en: "Invoicing software", fr: "Logiciel de facturation" },
    { id: "shop", en: "Shopify / Woo / Presta", fr: "Shopify / Woo / Presta" },
    { id: "salesforce", en: "Salesforce", fr: "Salesforce" },
    { id: "crm", en: "HubSpot / other CRM", fr: "HubSpot / autre CRM" },
    { id: "whatsapp", en: "WhatsApp Business", fr: "WhatsApp Business" },
    { id: "booking", en: "A booking tool", fr: "Un outil de réservation" },
    { id: "paper", en: "Mostly paper, honestly", fr: "Surtout du papier, honnêtement" },
    { id: "other", en: "Another tool", fr: "Un autre outil", other: true },
  ],
};

export const MAGIC: Question = {
  id: "magic",
  kind: "textarea",
  required: true,
  en: "With one wave of a magic wand, which chore would you make disappear by tomorrow morning?",
  fr: "D'un coup de baguette magique, quelle corvée feriez-vous disparaître demain matin ?",
  hintEn: "One sentence is enough. It is the answer that helps us most.",
  hintFr: "Une seule phrase suffit. C'est la réponse qui nous aide le plus.",
  starters: [
    { en: "Chasing unpaid invoices…", fr: "Courir après les factures impayées…" },
    { en: "Answering the same WhatsApp questions…", fr: "Répondre aux mêmes questions WhatsApp…" },
    { en: "Re-typing things into different tools…", fr: "Ressaisir les mêmes infos dans plusieurs outils…" },
  ],
};

// ---------- Step 5 — Practical bits ----------
/**
 * Nearly all the paid traffic is in Quebec. The budget bands stay in euros
 * (the ids, the stored answer and the price grid are all euro), but a Quebec
 * shopkeeper should not have to convert in their head to answer. Appended to
 * the chip label only when the browser puts the visitor in Canada; rounded on
 * purpose, and prefixed "environ" / "about", because it is a hint and not a quote.
 */
export const BUDGET_CAD: Record<string, { en: string; fr: string }> = {
  "<1500": { en: "(about CA$2,300)", fr: "(environ 2 300 $ CA)" },
  "1500-3500": { en: "(about CA$2,300-5,300)", fr: "(environ 2 300 à 5 300 $ CA)" },
  "3500-7000": { en: "(about CA$5,300-10,600)", fr: "(environ 5 300 à 10 600 $ CA)" },
  "7000+": { en: "(about CA$10,600+)", fr: "(environ 10 600 $ CA et plus)" },
};

export const STEP5: Question[] = [
  {
    id: "start",
    kind: "chips",
    required: true,
    en: "When would you like to start?",
    fr: "Quand aimeriez-vous démarrer ?",
    options: [
      { id: "asap", en: "As soon as possible", fr: "Dès que possible" },
      { id: "1-3mo", en: "In 1–3 months", fr: "Dans 1 à 3 mois" },
      { id: "later", en: "Later this year", fr: "Plus tard cette année" },
      { id: "exploring", en: "Just exploring", fr: "Je me renseigne" },
    ],
  },
  {
    id: "budget",
    kind: "chips",
    en: "What budget do you have in mind?",
    fr: "Quel budget avez-vous en tête ?",
    hintEn: "Optional. It helps us suggest what fits, instead of selling you more.",
    hintFr: "Facultatif. C'est pour vous proposer ce qui convient, pas pour vous vendre plus.",
    options: [
      { id: "<1500", en: "Under €1,500", fr: "Moins de 1 500 €" },
      { id: "1500-3500", en: "€1,500–3,500", fr: "1 500–3 500 €" },
      { id: "3500-7000", en: "€3,500–7,000", fr: "3 500–7 000 €" },
      { id: "7000+", en: "€7,000+", fr: "7 000 € et plus" },
      { id: "unsure", en: "Not sure yet", fr: "Pas encore décidé" },
    ],
  },
  {
    id: "decision",
    kind: "chips",
    en: "Who decides on something like this?",
    fr: "Qui décide, chez vous, pour ce genre de projet ?",
    options: [
      { id: "me", en: "Just me", fr: "Moi seul(e)" },
      { id: "partners", en: "Me + partner(s)", fr: "Moi + associé(s)" },
      { id: "signoff", en: "Someone else signs off", fr: "Quelqu'un d'autre valide" },
      { id: "researching", en: "I'm researching for someone else", fr: "Je me renseigne pour quelqu'un d'autre" },
    ],
  },
];

// ---------- Step 6 — Contact ----------
export const CONTACT: Question[] = [
  { id: "firstName", kind: "text", required: true, en: "First name", fr: "Prénom" },
  { id: "email", kind: "email", required: true, en: "Email", fr: "E-mail" },
  { id: "company", kind: "text", en: "Business name (optional)", fr: "Nom de votre entreprise (facultatif)" },
  {
    id: "phone",
    kind: "tel",
    en: "Phone (optional)",
    fr: "Téléphone (facultatif)",
    hintEn: "Only if you'd rather we call you.",
    hintFr: "Seulement si vous préférez qu'on vous appelle.",
  },
  {
    id: "site",
    kind: "url",
    // Required once they have told us they sell on their own site.
    requiredIf: (a) => a.sellsOnline === "own-site",
    en: "Your website (if you have one)",
    fr: "Votre site web (si vous en avez un)",
    hintEn: "It lets us take a look before the call.",
    hintFr: "Cela nous permet d'y jeter un œil avant l'appel.",
    hintRequiredEn: "You sell on your own site, so the address lets us take a look before the call.",
    hintRequiredFr: "Vous vendez sur votre propre site : l'adresse nous permet d'y jeter un œil avant l'appel.",
    placeholderEn: "yourbusiness.com",
    placeholderFr: "votreentreprise.fr",
  },
  {
    id: "source",
    kind: "chips",
    en: "How did you hear about us?",
    fr: "Comment nous avez-vous connus ?",
    options: [
      { id: "google", en: "Google search", fr: "Recherche Google" },
      { id: "maps", en: "Google Maps", fr: "Google Maps" },
      { id: "social", en: "Instagram / Facebook", fr: "Instagram / Facebook" },
      { id: "linkedin", en: "LinkedIn", fr: "LinkedIn" },
      { id: "word", en: "Word of mouth", fr: "Bouche-à-oreille" },
      { id: "elsewhere", en: "I saw your work somewhere else", fr: "J'ai vu votre travail ailleurs" },
      { id: "other", en: "Something else", fr: "Autre chose", other: true },
    ],
  },
];

// ---------- UI strings ----------
export const UI = {
  en: {
    metaTitle: "Free digital check-up | Digital M",
    metaDesc: "In 4 minutes, see what you could stop doing by hand. About 12 quick questions, results on screen straight away. Free, no commitment.",
    introEyebrow: "Free digital check-up",
    introTitle: "In 4 minutes, see what you could stop doing by hand",
    introSub: "About 12 quick questions, no technical knowledge needed. Your results appear on screen straight away, and we email you a copy.",
    introTrust: "Radu, the founder, reads every answer and replies himself. No sales calls, no mailing list.",
    start: "Start",
    stepOf: (a: number, b: number) => `Step ${a} of ${b}`,
    stepNames: ["Your business", "Where it hurts", "Let's look closer", "Your tools & your magic wand", "The practical bits", "Your details"],
    contactHeader: "Your results appear on the next screen. Your details are only used to send you a copy and to reply to you.",
    continue: "Continue",
    back: "Back",
    see: "See my results",
    sending: "Analysing your answers…",
    resume: "Resume where you left off?",
    resumeYes: "Resume",
    resumeNo: "Start over",
    resultsTitle: "Your check-up results",
    youToldUs: "You told us:",
    resultsReply: "Radu, the founder, reads every answer and replies himself, within 1 working day.",
    resultsBook: "Book a free 30-min call",
    resultsRef: (ref: string) => `Your reference: ${ref}. Quote it if you ever want your data deleted.`,
    privacy: "By sending this you are asking us to prepare your check-up. See our",
    privacyLink: "privacy notice",
    error: "Something went wrong. Please email contact@digitalm.eu.",
    otherPlaceholder: "In a few words…",
    urlInvalid: "Enter a full address, for example yourbusiness.com",
    selfServeTitle: "What you can do right now, on your own",
    /** Why "Continue" does nothing yet. One finished sentence, never a fragment. */
    blocked: {
      generic: "Answer the question above to continue.",
      answer: (list: string) => `Still to answer: ${list}`,
      detailGeneric: "Fill in the box above to continue.",
      detail: (list: string) => `Add a few words for ${list}`,
      both: (answers: string, details: string) =>
        `Still to answer: ${answers}, plus a few words for ${details}`,
      quote: (s: string) => `“${s}”`,
      and: "and",
      more: (n: number) => (n === 1 ? "1 more question" : `${n} more questions`),
    },
    /** Stands in for the AI paragraph on the results screen when the model gives us nothing usable. */
    resultFallback: {
      lead: (list: string) => `From your answers, the best place to start is here: ${list}. What that changes for you is spelled out just below.`,
      none: "From your answers, nothing needs fixing right away. The starting points below give you something concrete to begin with.",
      and: "and",
    },
  },
  fr: {
    metaTitle: "Check-up numérique gratuit | Digital M",
    metaDesc: "En 4 minutes, voyez ce que vous pouvez arrêter de faire à la main. Environ 12 questions rapides, résultats immédiats à l'écran. Gratuit, sans engagement.",
    introEyebrow: "Check-up numérique gratuit",
    introTitle: "En 4 minutes, voyez ce que vous pouvez arrêter de faire à la main",
    introSub: "Environ 12 questions rapides, aucune connaissance technique. Vos résultats s'affichent tout de suite à l'écran, et vous en recevez une copie par e-mail.",
    introTrust: "C'est Radu, le fondateur, qui lit chaque réponse et vous répond lui-même. Aucun démarchage, aucune liste de diffusion.",
    start: "Commencer",
    stepOf: (a: number, b: number) => `Étape ${a} sur ${b}`,
    stepNames: ["Votre activité", "Où ça coince", "Regardons de plus près", "Vos outils et votre baguette magique", "Côté pratique", "Vos coordonnées"],
    contactHeader: "Vos résultats s'affichent à l'écran suivant. Vos coordonnées servent uniquement à vous en envoyer une copie et à vous répondre.",
    continue: "Continuer",
    back: "Retour",
    see: "Voir mes résultats",
    sending: "Analyse de vos réponses…",
    resume: "Reprendre là où vous en étiez ?",
    resumeYes: "Reprendre",
    resumeNo: "Recommencer",
    resultsTitle: "Vos résultats",
    youToldUs: "Vous nous avez dit :",
    resultsReply: "C'est Radu, le fondateur, qui lit chaque réponse et vous répond lui-même, sous 1 jour ouvrable.",
    resultsBook: "Réserver un appel gratuit de 30 min",
    resultsRef: (ref: string) => `Votre référence : ${ref}. Mentionnez-la si vous souhaitez un jour faire supprimer vos données.`,
    privacy: "En envoyant ce formulaire, vous nous demandez de préparer votre check-up. Voir notre",
    privacyLink: "politique de confidentialité",
    error: "Une erreur est survenue. Écrivez-nous à contact@digitalm.eu.",
    otherPlaceholder: "En deux mots…",
    urlInvalid: "Indiquez une adresse complète, par exemple votreentreprise.fr",
    selfServeTitle: "Ce que vous pouvez faire dès maintenant, sans nous",
    /** Pourquoi « Continuer » ne fait rien encore. Une phrase finie, jamais un fragment. */
    blocked: {
      generic: "Répondez à la question ci-dessus pour continuer.",
      answer: (list: string) => `Il reste à répondre : ${list}`,
      detailGeneric: "Précisez votre réponse dans le champ ci-dessus pour continuer.",
      detail: (list: string) => `Précisez votre réponse à ${list}`,
      /** Les deux à la fois, en une seule phrase, pour que les deux moitiés ne se télescopent pas. */
      both: (answers: string, details: string) =>
        `Il reste à répondre : ${answers}, et à préciser votre réponse à ${details}`,
      quote: (s: string) => `« ${s} »`,
      and: "et",
      more: (n: number) => (n === 1 ? "1 autre question" : `${n} autres questions`),
    },
    /** Remplace le paragraphe de l'IA sur l'écran de résultats quand le modèle ne renvoie rien d'utilisable. */
    resultFallback: {
      lead: (list: string) => `D'après vos réponses, c'est par là qu'il vaut mieux commencer : ${list}. Vous trouverez juste en dessous ce que cela change concrètement pour vous.`,
      none: "D'après vos réponses, aucun projet ne s'impose dans l'immédiat. Les pistes ci-dessous vous donnent un point de départ concret.",
      and: "et",
    },
  },
} as const;
