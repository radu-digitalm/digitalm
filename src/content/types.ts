export type NavLink = { label: string; href: string };
export type Meta = { title: string; description: string };

export type Pillar = {
  id: string;
  kicker: string;
  title: string;
  lead: boolean;
  summary: string;
  points: string[];
  proof: string;
};

export type CaseResult = { value: string; label: string };

export type WorkItem = {
  client: string;
  scope: string;
  detail: string;
  tags: string[];
  /** Present → the item links to a /work/[slug] case study. */
  slug?: string;
  headline?: string;
  challenge?: string;
  approach?: string;
  results?: CaseResult[];
  testimonial?: { quote: string; name: string; role: string };
};

export type Testimonial = {
  quote: string;
  name: string;
  role: string;
};

export type Capability = { title: string; detail: string };
export type Stat = { value: string; label: string };
export type Section = { heading: string; body: string };
export type Smb = {
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  proof: string;
  priceChip: string;
  cta: string;
};

export type Package = {
  name: string;
  price: string;
  /** Struck-through standard-rate reference shown before the discounted price. */
  originalPrice?: string;
  timeline: string;
  outcome: string;
  includes: string[];
  lead?: boolean;
  cta?: string;
};

export type SiteContent = {
  meta: {
    home: Meta;
    services: Meta;
    work: Meta;
    contact: Meta;
    book: Meta;
    pme: Meta;
    legalNotice: Meta;
    privacy: Meta;
  };
  pricing: {
    hero: { eyebrow: string; title: string; sub: string };
    rateNote: string;
    discountTag: string;
    recommendedBadge: string;
    guarantee: string;
    diagnostic: { eyebrow: string; title: string; body: string; cta: string };
    cardReassurance: string;
    packages: Package[];
    /** Security audit — slim horizontal card under the build grid. */
    audit: Package;
    /** Monthly care plans ("Tranquillité"). */
    care: {
      eyebrow: string;
      title: string;
      body: string;
      overageRule: string;
      honesty: string;
      mechanics: string;
      tiers: Package[];
    };
    note: string;
    cta: string;
  };
  process: {
    eyebrow: string;
    title: string;
    steps: { title: string; detail: string }[];
  };
  faq: {
    eyebrow: string;
    title: string;
    items: { q: string; a: string }[];
  };
  nav: { links: NavLink[]; cta: string };
  smb: Smb;
  testimonialsHeading: { eyebrow: string; title: string };
  testimonials: Testimonial[];
  caseStudy: { challengeLabel: string; approachLabel: string; resultsLabel: string; back: string };
  footer: {
    tagline: string;
    contactHeading: string;
    email: string;
    whatsappText: string;
    whatsappUrl: string;
    legalHeading: string;
    legalLinks: NavLink[];
    rights: string;
    note: string;
  };
  home: {
    hero: {
      eyebrow: string;
      titleLines: string[];
      titleAccent: string;
      sub: string;
      ctaPrimary: string;
      ctaSecondary: string;
      ctaDiagnostic: string;
    };
    proofLabel: string;
    proofBreadth: string;
    clients: string[];
    pillarsHeading: { eyebrow: string; title: string; intro: string };
    pillars: Pillar[];
    grounding: {
      eyebrow: string;
      title: string;
      body: string;
      stats: Stat[];
    };
    cta: { title: string; body: string; button: string };
  };
  services: {
    hero: { eyebrow: string; title: string; sub: string };
    pillars: Pillar[];
    cta: { title: string; body: string; button: string };
  };
  work: {
    hero: { eyebrow: string; title: string; sub: string };
    itemsLabel: string;
    items: WorkItem[];
    capabilitiesHeading: string;
    capabilities: Capability[];
    cta: { title: string; body: string; button: string };
  };
  contact: {
    hero: { eyebrow: string; title: string; sub: string };
    directHeading: string;
    emailLabel: string;
    whatsappLabel: string;
    whatsappText: string;
    email: string;
    whatsappUrl: string;
    form: {
      heading: string;
      name: string;
      emailField: string;
      phone: string;
      company: string;
      message: string;
      submit: string;
      sending: string;
      success: string;
      error: string;
      required: string;
      responsePromise: string;
    };
  };
  booking: {
    eyebrow: string;
    title: string;
    sub: string;
    benefits: string[];
    trust: string[];
    step1: string;
    step2: string;
    pickFirst: string;
    pickHint: string;
    noSlots: string;
    name: string;
    email: string;
    phone: string;
    company: string;
    needs: string;
    preferred: string;
    submit: string;
    request: string;
    submitting: string;
    change: string;
    successBooked: string;
    successRequested: string;
    error: string;
  };
  legal: {
    notice: {
      title: string;
      updated: string;
      placeholderNote: string;
      sections: Section[];
    };
    privacy: {
      title: string;
      updated: string;
      placeholderNote: string;
      sections: Section[];
    };
  };
};
