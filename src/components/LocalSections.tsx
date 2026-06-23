import type { Locale } from "@/lib/i18n";

// Shared bits for the local landing pages: a key-figures band and the standard
// services grid (so rich pages + dynamic commune pages stay consistent).

const FIGURES: Record<Locale, { v: string; l: string }[]> = {
  fr: [
    { v: "15+ ans", l: "d'expérience e-commerce & IA" },
    { v: "100+", l: "projets livrés" },
    { v: "dès 500 €", l: "tarifs clairs, devis fixe" },
    { v: "48 h", l: "audit express gratuit" },
  ],
  en: [
    { v: "15+ yrs", l: "e-commerce & AI delivery" },
    { v: "100+", l: "projects delivered" },
    { v: "from €500", l: "clear, fixed pricing" },
    { v: "48 h", l: "free express audit" },
  ],
};

export function KeyFigures({ locale }: { locale: Locale }) {
  return (
    <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line md:grid-cols-4">
      {FIGURES[locale].map((f, i) => (
        <div key={i} className="bg-surface p-5">
          <p className={`font-display text-2xl font-medium tabular-nums md:text-3xl ${i === 0 ? "gradient-text" : "text-fg-heading"}`}>
            {f.v}
          </p>
          <p className="mt-2 text-sm text-fg-muted">{f.l}</p>
        </div>
      ))}
    </div>
  );
}

const SERVICES: Record<Locale, { title: string; detail: string }[]> = {
  fr: [
    { title: "Agents IA & chatbots", detail: "Un assistant qui répond aux questions fréquentes, qualifie les demandes et prend les rendez-vous, jour et nuit, sur votre site ou votre page." },
    { title: "Automatisation des tâches", detail: "Devis, SAV, planning, relances : on connecte vos outils avec n8n ou Make pour supprimer la double saisie et les oublis." },
    { title: "Création de site internet", detail: "Une agence web qui crée un site internet rapide, clair et bien référencé localement, pensé pour transformer un visiteur en client." },
    { title: "E-commerce", detail: "Vendre en ligne vos produits ou prestations, avec paiement, stock et expédition reliés sans friction." },
    { title: "Audit de sécurité", detail: "On vérifie site, données et accès pour éviter la fuite ou le piratage qui coûte cher à une petite structure." },
    { title: "Audit express sous 48 h", detail: "Gratuit : un diagnostic concret de vos automatisations possibles et de leur retour sur temps, sans engagement." },
  ],
  en: [
    { title: "AI agents & chatbots", detail: "An assistant that answers FAQs, qualifies enquiries and books appointments, day and night, on your site or page." },
    { title: "Task automation", detail: "Quotes, support, scheduling, reminders: we connect your tools with n8n or Make to kill double-entry and missed follow-ups." },
    { title: "Website creation", detail: "A fast, clear, locally-optimised site, built to turn a visitor into a customer." },
    { title: "E-commerce", detail: "Sell your products or services online, with payment, stock and shipping wired together without friction." },
    { title: "Security audit", detail: "We check your site, data and access to prevent the leak or hack that costs a small business dearly." },
    { title: "Free 48-hour express audit", detail: "Free: a concrete diagnostic of your possible automations and their time-payback, no commitment." },
  ],
};

export function ServiceGrid({ locale }: { locale: Locale }) {
  return (
    <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
      {SERVICES[locale].map((s, i) => (
        <article key={i} className="card card-hover reveal p-6">
          <h3 className="text-lg text-fg-heading">{s.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">{s.detail}</p>
        </article>
      ))}
    </div>
  );
}
