// Free Digital Check-up — scoring. Runs client-side (results screen) and
// server-side (triage email) from the same rules, so the two never disagree.

export type ServiceLine = "AGENT" | "AUTO" | "WEB" | "CRM" | "SEC";
export type Grade = "A" | "B" | "C";

export type Answers = {
  activity?: string;
  team?: string;
  sellsOnline?: string;
  pains?: string[];
  [branchQ: string]: unknown;
  tools?: string[];
  magic?: string;
  start?: string;
  budget?: string;
  decision?: string;
};

export type Scoring = {
  scores: Record<ServiceLine, number>;
  proposed: ServiceLine[];
  urgency: number; // 0–5
  urgent: boolean;
  grade: Grade;
  flags: string[]; // seo-addon, basics-first, urgent…
};

const CARD_TO_LINE: Record<string, ServiceLine> = { A: "AUTO", B: "AGENT", C: "WEB", D: "CRM", E: "SEC" };

// Rough project floors (EUR) per line, vs the budget chip chosen.
const FLOOR: Record<ServiceLine, number> = { AGENT: 1500, AUTO: 1500, SEC: 1500, WEB: 3500, CRM: 3500 };
const BUDGET_MAX: Record<string, number> = { "<1500": 1499, "1500-3500": 3500, "3500-7000": 7000, "7000+": 99999 };

function arr(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

export function score(a: Answers): Scoring {
  const s: Record<ServiceLine, number> = { AGENT: 0, AUTO: 0, WEB: 0, CRM: 0, SEC: 0 };
  const flags: string[] = [];
  const pains = arr(a.pains).filter((p) => p in CARD_TO_LINE);

  for (const p of pains) s[CARD_TO_LINE[p]!] += 3;

  const sellsOnline = a.sellsOnline === "own-site" || a.sellsOnline === "marketplaces";
  if (a.sellsOnline === "want-to") s.WEB += 2;
  if (a.sellsOnline === "own-site") s.SEC += 1;

  if (arr(a.A_where).includes("copying")) { s.AUTO += 1; s.CRM += 1; }
  if (a.A_hours === "15-30" || a.A_hours === "30+") s.AUTO += 2;

  if (arr(a.B_asks).includes("availability")) { s.AGENT += 1; s.AUTO += 1; }
  if (a.B_speed === "slip") { s.AGENT += 2; s.CRM += 1; }

  if (a.C_situation === "underperforms") { s.WEB += 2; s.SEC += 1; }
  if (arr(a.C_matters).includes("google")) { s.WEB += 1; flags.push("seo-addon"); }

  const tools = arr(a.tools);
  if (arr(a.D_where).includes("crm") || tools.includes("salesforce")) s.CRM += 2;
  if (arr(a.D_breaks).includes("followups")) { s.CRM += 2; s.AGENT += 1; s.AUTO += 1; }

  const urgentIncident = a.E_trigger === "incident" || a.E_trigger === "suspicious";
  if (urgentIncident) { s.SEC += 3; flags.push("urgent"); }

  if (tools.includes("paper")) { s.AUTO -= 1; s.CRM -= 1; s.WEB += 1; flags.push("basics-first"); }
  if (a.team === "6-20" || a.team === "20+") { s.AUTO += 1; s.CRM += 1; }

  // Security is only proposable for businesses that actually sell online.
  if (!sellsOnline) s.SEC = Math.min(s.SEC, 0);

  const ranked = (Object.keys(s) as ServiceLine[]).filter((k) => s[k] > 0).sort((x, y) => s[y] - s[x]);
  const proposed: ServiceLine[] = [];
  if (ranked.length) {
    const top = ranked[0]!;
    proposed.push(top);
    for (const k of ranked.slice(1)) {
      if (proposed.length >= 3) break;
      if (s[top] - s[k] <= 2) proposed.push(k);
    }
  }

  let urgency = { asap: 3, "1-3mo": 2, later: 1, exploring: 0 }[a.start ?? ""] ?? 0;
  if (a.B_speed === "slip") urgency += 1;
  if (urgentIncident) urgency += 2;
  urgency = Math.min(urgency, 5);

  // Budget fit vs the floor of the top proposed line. Blank / "unsure" = neutral.
  let budgetOk = true; // neutral passes
  if (a.budget && a.budget !== "unsure" && proposed.length) {
    budgetOk = (BUDGET_MAX[a.budget] ?? 0) >= FLOOR[proposed[0]!];
  }

  const researching = a.decision === "researching";
  let grade: Grade;
  if (urgency >= 2 && budgetOk && !researching) grade = "A";
  else if (urgency >= 1) grade = "B";
  else grade = "C";
  if (!budgetOk && grade === "A") grade = "B";

  return { scores: s, proposed, urgency, urgent: urgentIncident, grade, flags };
}

// ---------- Results-screen copy per service line ----------
export const RESULT_CARDS: Record<ServiceLine, { en: { title: string; body: string }; fr: { title: string; body: string } }> = {
  AUTO: {
    en: { title: "Process automation", body: "Your repetitive admin (quotes, follow-ups, re-typing between tools) is exactly what automation removes first — usually hours back every week." },
    fr: { title: "Automatisation des tâches", body: "Vos tâches répétitives (devis, relances, ressaisies entre outils) sont exactement ce que l'automatisation supprime en premier — souvent plusieurs heures récupérées chaque semaine." },
  },
  AGENT: {
    en: { title: "AI assistant for customer messages", body: "An assistant that answers common questions and takes bookings 24/7 — so nothing slips through and you stop repeating yourself." },
    fr: { title: "Assistant IA pour vos messages clients", body: "Un assistant qui répond aux questions courantes et prend les rendez-vous 24h/24 — plus rien ne passe à la trappe et vous arrêtez de vous répéter." },
  },
  WEB: {
    en: { title: "Website / online shop", body: "A site that looks right, gets found, and lets customers buy or book — the foundation the rest builds on." },
    fr: { title: "Site web / boutique en ligne", body: "Un site qui inspire confiance, se fait trouver, et permet d'acheter ou de réserver — la base sur laquelle tout le reste s'appuie." },
  },
  CRM: {
    en: { title: "Customer follow-up (CRM)", body: "One place for customer info, quotes and follow-ups — so every quote gets chased and the team sees the same picture." },
    fr: { title: "Suivi client (CRM)", body: "Un seul endroit pour les infos clients, devis et relances — chaque devis est suivi et toute l'équipe voit la même chose." },
  },
  SEC: {
    en: { title: "E-commerce security audit", body: "A practical check of your shop: payments, customer data, known holes — with a clear fix list, not jargon." },
    fr: { title: "Audit sécurité e-commerce", body: "Un contrôle concret de votre boutique : paiements, données clients, failles connues — avec une liste de correctifs claire, sans jargon." },
  },
};

// Self-serve tips for C-grade (exploring / below floor) instead of a pitch.
export const SELF_SERVE = {
  en: [
    "Write down the 3 tasks that eat the most time each week — that list is 80% of a good diagnostic.",
    "If you're not on Google Maps yet, claim your free Business Profile — biggest visibility win for zero cost.",
    "Try our free 48h express audit when you're ready: tell us your site, we send 2–3 concrete recommendations.",
  ],
  fr: [
    "Notez les 3 tâches qui mangent le plus de temps chaque semaine — cette liste, c'est 80 % d'un bon diagnostic.",
    "Si vous n'êtes pas encore sur Google Maps, créez votre fiche gratuite — le plus gros gain de visibilité à coût nul.",
    "Quand vous serez prêt, essayez notre audit express gratuit sous 48 h : donnez-nous votre site, on renvoie 2–3 recommandations concrètes.",
  ],
} as const;
