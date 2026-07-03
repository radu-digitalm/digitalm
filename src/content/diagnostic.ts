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
};

export type Question = {
  id: string;
  kind: "chips" | "chips-multi" | "cards" | "text" | "textarea" | "email" | "tel" | "url";
  required?: boolean;
  /** Max selections for chips-multi / cards. */
  max?: number;
  en: string;
  fr: string;
  hintEn?: string;
  hintFr?: string;
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
      { id: "artisan", en: "Artisan / craft / trades", fr: "Artisan / métiers" },
      { id: "hospitality", en: "Restaurant / hospitality", fr: "Restauration / hôtellerie" },
      { id: "other", en: "Other", fr: "Autre", other: true },
    ],
  },
  {
    id: "team",
    kind: "chips",
    required: true,
    en: "How big is the team?",
    fr: "Quelle est la taille de l'équipe ?",
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
      { id: "marketplaces", en: "Yes, on marketplaces", fr: "Oui, sur des marketplaces" },
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
    { id: "C", en: "Our website is outdated, missing, or not bringing in business", fr: "Notre site est dépassé, absent, ou ne ramène pas de clients" },
    { id: "D", en: "Customer info is scattered — quotes and follow-ups slip through", fr: "Les infos clients sont éparpillées — devis et relances passent à la trappe" },
    { id: "E", en: "I worry about the security of our online shop", fr: "Je m'inquiète pour la sécurité de notre boutique en ligne" },
    { id: "unsure", en: "Honestly not sure — that's why I'm here", fr: "Honnêtement, je ne sais pas trop — c'est pour ça que je suis là" },
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
        { id: "invoices", en: "Invoices & quotes", fr: "Factures & devis" },
        { id: "copying", en: "Copying data between tools", fr: "Recopier des infos entre outils" },
        { id: "scheduling", en: "Scheduling", fr: "Planning / rendez-vous" },
        { id: "stock", en: "Stock / inventory", fr: "Stock / inventaire" },
        { id: "orders", en: "Order processing", fr: "Traitement des commandes" },
        { id: "reports", en: "Reports / bookkeeping", fr: "Rapports / compta" },
        { id: "email", en: "Sorting email", fr: "Trier les e-mails" },
        { id: "other", en: "Other", fr: "Autre", other: true },
      ],
    },
    {
      id: "A_hours",
      kind: "chips",
      required: true,
      en: "Roughly how many hours a week does that eat?",
      fr: "Environ combien d'heures par semaine ça mange ?",
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
      en: "Where do customers reach you?",
      fr: "Où les clients vous contactent-ils ?",
      options: [
        { id: "email", en: "Email", fr: "E-mail" },
        { id: "phone", en: "Phone", fr: "Téléphone" },
        { id: "whatsapp", en: "WhatsApp", fr: "WhatsApp" },
        { id: "social", en: "Instagram / Facebook", fr: "Instagram / Facebook" },
        { id: "form", en: "Website form", fr: "Formulaire du site" },
        { id: "marketplace", en: "Marketplace messages", fr: "Messages marketplace" },
      ],
    },
    {
      id: "B_asks",
      kind: "chips-multi",
      required: true,
      en: "What do they mostly ask?",
      fr: "Que demandent-ils le plus souvent ?",
      options: [
        { id: "prices", en: "Prices & quotes", fr: "Prix & devis" },
        { id: "availability", en: "Availability / bookings", fr: "Disponibilités / réservations" },
        { id: "order-status", en: "Order status", fr: "Suivi de commande" },
        { id: "product", en: "Product questions", fr: "Questions produits" },
        { id: "aftersales", en: "After-sales", fr: "SAV" },
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
        { id: "slip", en: "Some slip through entirely", fr: "Certains passent à la trappe" },
      ],
    },
  ],
  C: [
    {
      id: "C_situation",
      kind: "chips",
      required: true,
      en: "Closest to your situation?",
      fr: "Le plus proche de votre situation ?",
      options: [
        { id: "none", en: "No website yet", fr: "Pas encore de site" },
        { id: "outdated", en: "Outdated / embarrassing", fr: "Dépassé / pas présentable" },
        { id: "no-sales", en: "Fine, but can't sell or book on it", fr: "Correct, mais on ne peut ni vendre ni réserver dessus" },
        { id: "underperforms", en: "Shop exists but underperforms", fr: "La boutique existe mais sous-performe" },
      ],
    },
    {
      id: "C_matters",
      kind: "chips-multi",
      required: true,
      max: 2,
      en: "What matters most online?",
      fr: "Qu'est-ce qui compte le plus en ligne ?",
      hintEn: "Pick up to two.",
      hintFr: "Choisissez-en jusqu'à deux.",
      options: [
        { id: "professional", en: "Look professional", fr: "Avoir l'air professionnel" },
        { id: "google", en: "Get found on Google", fr: "Être trouvé sur Google" },
        { id: "sell", en: "Sell online", fr: "Vendre en ligne" },
        { id: "bookings", en: "Take bookings", fr: "Prendre des réservations" },
        { id: "language", en: "Another language", fr: "Une autre langue" },
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
      en: "Where does customer info live today?",
      fr: "Où vivent les infos clients aujourd'hui ?",
      options: [
        { id: "spreadsheets", en: "Spreadsheets", fr: "Tableurs" },
        { id: "inbox", en: "Email inbox", fr: "Boîte mail" },
        { id: "paper", en: "Paper / someone's head", fr: "Papier / dans une tête" },
        { id: "invoicing", en: "Invoicing tool", fr: "Logiciel de facturation" },
        { id: "crm", en: "A CRM already", fr: "Déjà un CRM", other: true },
      ],
    },
    {
      id: "D_breaks",
      kind: "chips-multi",
      required: true,
      en: "What breaks because of it?",
      fr: "Qu'est-ce que ça casse concrètement ?",
      options: [
        { id: "followups", en: "Quotes never followed up", fr: "Des devis jamais relancés" },
        { id: "pipeline", en: "No visibility on the pipeline", fr: "Aucune visibilité sur les affaires en cours" },
        { id: "duplicates", en: "Duplicate or lost data", fr: "Données en double ou perdues" },
        { id: "team", en: "Team can't see each other's info", fr: "L'équipe ne voit pas les infos des autres" },
      ],
    },
  ],
  E: [
    {
      id: "E_platform",
      kind: "chips",
      required: true,
      en: "What's the shop built on?",
      fr: "Sur quoi la boutique est-elle construite ?",
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
      en: "What triggered the concern?",
      fr: "Qu'est-ce qui a déclenché l'inquiétude ?",
      options: [
        { id: "incident", en: "We had an incident", fr: "On a eu un incident" },
        { id: "suspicious", en: "Something suspicious happened", fr: "Quelque chose de suspect s'est produit" },
        { id: "gdpr", en: "Customer data / GDPR worry", fr: "Données clients / RGPD" },
        { id: "asked", en: "A partner or bank asked", fr: "Un partenaire ou la banque l'a demandé" },
        { id: "peace", en: "Peace of mind", fr: "Être tranquille" },
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
  hintEn: "Tap all that apply — or skip.",
  hintFr: "Cochez ce qui s'applique — ou passez.",
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
    { id: "other", en: "Other", fr: "Autre", other: true },
  ],
};

export const MAGIC: Question = {
  id: "magic",
  kind: "textarea",
  en: "If you could wave a magic wand and make one part of your work disappear tomorrow — what would it be?",
  fr: "Si vous pouviez agiter une baguette magique et faire disparaître une corvée dès demain — ce serait quoi ?",
  hintEn: "Optional — but it's the question that helps us most.",
  hintFr: "Facultatif — mais c'est la question qui nous aide le plus.",
  starters: [
    { en: "Chasing unpaid invoices…", fr: "Courir après les factures impayées…" },
    { en: "Answering the same WhatsApp questions…", fr: "Répondre aux mêmes questions WhatsApp…" },
    { en: "Re-typing things into different tools…", fr: "Ressaisir les mêmes infos dans plusieurs outils…" },
  ],
};

// ---------- Step 5 — Practical bits ----------
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
    en: "Budget comfort zone?",
    fr: "Zone de budget confortable ?",
    hintEn: "Optional — helps us suggest what fits, not oversell.",
    hintFr: "Facultatif — pour proposer ce qui convient, pas survendre.",
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
    en: "Who's involved in a decision like this?",
    fr: "Qui participe à ce genre de décision ?",
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
  { id: "company", kind: "text", en: "Company (optional)", fr: "Société (facultatif)" },
  {
    id: "phone",
    kind: "tel",
    en: "Phone (optional)",
    fr: "Téléphone (facultatif)",
    hintEn: "Only if you'd prefer a quick call.",
    hintFr: "Seulement si vous préférez un rapide coup de fil.",
  },
  {
    id: "source",
    kind: "chips",
    en: "Where did you hear about us?",
    fr: "Comment nous avez-vous connus ?",
    options: [
      { id: "google", en: "Google search", fr: "Recherche Google" },
      { id: "maps", en: "Google Maps", fr: "Google Maps" },
      { id: "social", en: "Instagram / Facebook", fr: "Instagram / Facebook" },
      { id: "linkedin", en: "LinkedIn", fr: "LinkedIn" },
      { id: "word", en: "Word of mouth", fr: "Bouche-à-oreille" },
      { id: "elsewhere", en: "Saw our work elsewhere", fr: "Vu notre travail ailleurs" },
      { id: "other", en: "Other", fr: "Autre", other: true },
    ],
  },
];

// ---------- UI strings ----------
export const UI = {
  en: {
    metaTitle: "Free digital check-up | Digital M",
    metaDesc: "Answer ~12 quick questions (4 min) and see instantly where AI and automation could save your business time. Free, no commitment.",
    introEyebrow: "Free digital check-up",
    introTitle: "See what technology could take off your plate",
    introSub: "~4 minutes, no technical knowledge needed. You'll see your results on screen right away — we also email you a copy.",
    introTrust: "One email, one human reply — no newsletter, ever.",
    start: "Start",
    stepOf: (a: number, b: number) => `Step ${a} of ${b}`,
    stepNames: ["Your business", "Where it hurts", "Let's look closer", "Your tools & your magic wand", "The practical bits", "Your copy"],
    contactHeader: "Your results appear on the next screen — this is where we send your copy.",
    continue: "Continue",
    back: "Back",
    see: "See my results",
    sending: "Analysing your answers…",
    resume: "Resume where you left off?",
    resumeYes: "Resume",
    resumeNo: "Start over",
    resultsTitle: "Your check-up results",
    resultsReply: "Our team replies personally within 1 business day.",
    resultsBook: "Book a free 30-min call",
    resultsRef: (ref: string) => `Your reference: ${ref} — quote it if you ever want your data deleted.`,
    privacy: "By sending this you ask us to prepare your diagnostic — see our",
    privacyLink: "privacy notice",
    error: "Something went wrong. Please email contact@digitalm.eu.",
    otherPlaceholder: "Tell us…",
    selfServeTitle: "Where to start on your own",
  },
  fr: {
    metaTitle: "Check-up numérique gratuit | Digital M",
    metaDesc: "Répondez à ~12 questions rapides (4 min) et voyez immédiatement où l'IA et l'automatisation peuvent faire gagner du temps à votre entreprise. Gratuit, sans engagement.",
    introEyebrow: "Check-up numérique gratuit",
    introTitle: "Voyez ce que la technologie pourrait vous enlever des épaules",
    introSub: "~4 minutes, aucune connaissance technique requise. Vos résultats s'affichent immédiatement à l'écran — on vous en envoie aussi une copie par e-mail.",
    introTrust: "Un e-mail, une réponse humaine — jamais de newsletter.",
    start: "Commencer",
    stepOf: (a: number, b: number) => `Étape ${a} sur ${b}`,
    stepNames: ["Votre activité", "Où ça coince", "Regardons de plus près", "Vos outils & votre baguette magique", "Les aspects pratiques", "Votre copie"],
    contactHeader: "Vos résultats s'affichent à l'écran suivant — ici, c'est juste pour vous envoyer votre copie.",
    continue: "Continuer",
    back: "Retour",
    see: "Voir mes résultats",
    sending: "Analyse de vos réponses…",
    resume: "Reprendre là où vous en étiez ?",
    resumeYes: "Reprendre",
    resumeNo: "Recommencer",
    resultsTitle: "Vos résultats",
    resultsReply: "Notre équipe vous répond personnellement sous 1 jour ouvré.",
    resultsBook: "Réserver un appel gratuit de 30 min",
    resultsRef: (ref: string) => `Votre référence : ${ref} — mentionnez-la si vous souhaitez un jour que vos données soient supprimées.`,
    privacy: "En envoyant, vous nous demandez de préparer votre diagnostic — voir notre",
    privacyLink: "politique de confidentialité",
    error: "Une erreur est survenue. Écrivez à contact@digitalm.eu.",
    otherPlaceholder: "Précisez…",
    selfServeTitle: "Par où commencer par vous-même",
  },
} as const;
