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

// Branch U - what last week actually cost them, weighted like a router card
// (3) so a visitor who cannot name their problem lands on the same scale as
// one who can. Before branch U existed these people were asked nothing at all
// and reached Radu as a trade, a headcount and a mood: every rule scored zero.
const U_WEEK_POINTS: Record<string, Partial<Record<ServiceLine, number>>> = {
  replies: { AGENT: 3 },
  quotes: { AUTO: 3 },
  chasing: { CRM: 3, AUTO: 1 },
  retyping: { AUTO: 3, CRM: 1 },
  planning: { AGENT: 2, AUTO: 1 },
  searching: { CRM: 3 },
  // `none` scores nothing on purpose: "last week went fine" is a fact about
  // the lead, not a service line. It raises the no-symptom flag instead.
};

function arr(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

export function score(a: Answers): Scoring {
  const s: Record<ServiceLine, number> = { AGENT: 0, AUTO: 0, WEB: 0, CRM: 0, SEC: 0 };
  const flags: string[] = [];
  // `tools: paper` and `U_where: paper` are two ways of saying the same thing
  // and both raise "basics-first": the flag is a fact, not a counter.
  const flag = (f: string): void => {
    if (!flags.includes(f)) flags.push(f);
  };
  const pains = arr(a.pains).filter((p) => p in CARD_TO_LINE);

  for (const p of pains) s[CARD_TO_LINE[p]!] += 3;

  // The security deep dive counts as evidence only while card E is the card
  // they are on. The wizard merges the answers it has collected, so someone
  // who taps E, answers it, goes back and picks A instead still SENDS an
  // E_platform and an E_trigger; without this guard that stale pair would
  // unlock a line they did not ask about and add a point of urgency nobody
  // stated. What they last chose is what they are asking for.
  const securityCard = pains.includes("E");

  // Whether a shop EXISTS, read from the evidence rather than from one chip.
  // DM-88HKT tapped "not yet, but we would like to", then named his platform
  // ("custom / an agency built it") and said a bank had asked about its
  // security. Answering the security deep dive is the proof; the earlier chip
  // is a plan. Reading only the chip zeroed his SEC score and sent him a draft
  // telling him to come back when he was ready to sell online.
  const sellsOnline =
    a.sellsOnline === "own-site" ||
    a.sellsOnline === "marketplaces" ||
    (securityCard &&
      (!!String(a.E_platform ?? "").trim() || !!String(a.E_url ?? "").trim()));
  if (a.sellsOnline === "want-to") s.WEB += 2;
  if (a.sellsOnline === "own-site") s.SEC += 1;

  if (arr(a.A_where).includes("copying")) { s.AUTO += 1; s.CRM += 1; }
  if (a.A_hours === "15-30" || a.A_hours === "30+") s.AUTO += 2;

  if (arr(a.B_asks).includes("availability")) { s.AGENT += 1; s.AUTO += 1; }
  if (a.B_speed === "slip") { s.AGENT += 2; s.CRM += 1; }

  if (a.C_situation === "underperforms") { s.WEB += 2; s.SEC += 1; }
  if (arr(a.C_matters).includes("google")) { s.WEB += 1; flag("seo-addon"); }

  const tools = arr(a.tools);
  if (arr(a.D_where).includes("crm") || tools.includes("salesforce")) s.CRM += 2;
  if (arr(a.D_breaks).includes("followups")) { s.CRM += 2; s.AGENT += 1; s.AUTO += 1; }

  // Branch U: the people who answered "honestly, I do not know". Two taps.
  const week = arr(a.U_week);
  for (const w of week) {
    for (const [line, points] of Object.entries(U_WEEK_POINTS[w] ?? {})) {
      s[line as ServiceLine] += points as number;
    }
  }
  if (week.length && week.every((w) => w === "none")) flag("no-symptom");

  // Where the work lives on a Monday morning. Paper and memory earn the same
  // "start with the basics" flag as `tools: paper`, but NOT its -1 penalty:
  // that penalty exists to stop us automating on top of nothing, and applied
  // here it would cancel the very symptoms U_week just collected.
  if (a.U_where === "paper" || a.U_where === "head") { s.WEB += 1; flag("basics-first"); }
  if (a.U_where === "sheet" || a.U_where === "inbox") s.CRM += 1;

  const urgentIncident = securityCard && (a.E_trigger === "incident" || a.E_trigger === "suspicious");
  if (urgentIncident) { s.SEC += 3; flag("urgent"); }

  if (tools.includes("paper")) { s.AUTO -= 1; s.CRM -= 1; s.WEB += 1; flag("basics-first"); }
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
  // A partner or a bank asking is a deadline someone else set. "Protecting
  // customer data" and "just to sleep better" are not, and do not bump.
  if (securityCard && a.E_trigger === "asked") urgency += 1;
  if (urgentIncident) urgency += 2;
  urgency = Math.min(urgency, 5);

  // Budget fit vs the floor of the top proposed line. Blank / "unsure" = neutral.
  let budgetOk = true; // neutral passes
  if (a.budget && a.budget !== "unsure" && proposed.length) {
    budgetOk = (BUDGET_MAX[a.budget] ?? 0) >= FLOOR[proposed[0]!];
  }

  let grade: Grade;
  if (urgency >= 2 && budgetOk) grade = "A";
  else if (urgency >= 1) grade = "B";
  else grade = "C";
  if (!budgetOk && grade === "A") grade = "B";

  // The one machine-readable definition of "there is not enough here to
  // propose anything": not one of the five lines could be named from a fact
  // this person stated. The wizard reads it to show the self-serve tips
  // instead of a guess, and the route reads it to pick the triage schema that
  // has no priced field at all. Neither of them defines it again.
  //
  // It does not touch the grade: the grade is urgency and budget fit, and a
  // person can be in a hurry about something we have not understood yet.
  if (!proposed.length) flag("thin");

  return { scores: s, proposed, urgency, urgent: urgentIncident, grade, flags };
}

// ---------- Results-screen copy per service line ----------
export const RESULT_CARDS: Record<ServiceLine, { en: { title: string; body: string }; fr: { title: string; body: string } }> = {
  AUTO: {
    en: { title: "Process automation", body: "Your repetitive admin (quotes, follow-ups, re-typing between tools) is exactly what automation removes first, and it usually gives you hours back every week." },
    fr: { title: "Automatisation des tâches", body: "Vos tâches répétitives (devis, relances, ressaisies entre outils) sont exactement ce que l'automatisation supprime en premier, et c'est souvent plusieurs heures récupérées chaque semaine." },
  },
  AGENT: {
    en: { title: "AI assistant for customer messages", body: "An assistant that answers common questions and takes bookings 24/7, so nothing goes unanswered and you stop repeating yourself." },
    fr: { title: "Assistant IA pour vos messages clients", body: "Un assistant qui répond aux questions courantes et prend les rendez-vous 24 h sur 24 : plus rien ne reste sans réponse et vous arrêtez de vous répéter." },
  },
  WEB: {
    en: { title: "Website / online shop", body: "A site that looks right, gets found, and lets customers buy or book. It is the foundation the rest builds on." },
    fr: { title: "Site web / boutique en ligne", body: "Un site qui inspire confiance, se fait trouver, et permet d'acheter ou de réserver. C'est la base sur laquelle tout le reste s'appuie." },
  },
  CRM: {
    en: { title: "Customer follow-up (CRM)", body: "One place for customer info, quotes and follow-ups, so every quote gets chased and everyone sees the same picture." },
    fr: { title: "Suivi client (CRM)", body: "Un seul endroit pour les infos clients, les devis et les relances : chaque devis est suivi et tout le monde voit la même chose." },
  },
  SEC: {
    en: { title: "E-commerce security audit", body: "A practical check of your shop (payments, customer data, known holes), with a clear fix list, not jargon." },
    fr: { title: "Audit sécurité e-commerce", body: "Un contrôle concret de votre boutique (paiements, données clients, failles connues), avec une liste de correctifs claire, sans jargon." },
  },
};

// Self-serve tips for C-grade (exploring / below floor) instead of a pitch.
export const SELF_SERVE = {
  en: [
    "Write down the 3 tasks that eat the most time each week: that list is already 80% of a good diagnostic.",
    "If you're not on Google Maps yet, claim your free Business Profile: it is the biggest visibility win there is, and it costs nothing.",
    "Try our free 48h express audit when you're ready: tell us your site, we send you 2 or 3 concrete recommendations.",
  ],
  fr: [
    "Notez les 3 tâches qui vous prennent le plus de temps chaque semaine : cette liste, c'est déjà 80 % d'un bon diagnostic.",
    "Si vous n'êtes pas encore sur Google Maps, créez votre fiche gratuite : c'est le plus gros gain de visibilité, et il ne coûte rien.",
    "Quand vous serez prêt, essayez notre audit express gratuit sous 48 h : donnez-nous votre site, on vous renvoie 2 ou 3 recommandations concrètes.",
  ],
} as const;
