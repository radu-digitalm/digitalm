import type { SiteContent } from "./types";

export const en = {
  meta: {
    home: {
      title: "Digital M — AI for commerce, grounded in real delivery",
      description:
        "Digital M helps retail and e-commerce teams put AI to work — backed by 15+ years delivering e-commerce and Salesforce CRM for major retail and optical brands.",
    },
    services: {
      title: "Services — AI adoption, e-commerce & CRM delivery | Digital M",
      description:
        "AI adoption and integration for retail, backed by e-commerce engineering and Salesforce Service & Marketing Cloud delivery.",
    },
    work: {
      title: "Work — 15+ years of retail commerce & CRM delivery | Digital M",
      description:
        "Selected delivery for Vision Direct, EssilorLuxottica, Liz Earle, Missguided, In The Style and APP Wholesale — e-commerce, Salesforce and secure commerce.",
    },
    contact: {
      title: "Contact | Digital M",
      description:
        "Talk to Digital M about putting AI to work in your retail or e-commerce business. Email contact@digitalm.eu.",
    },
    book: {
      title: "Book a call | Digital M",
      description:
        "Book a 30-minute call with Digital M — AI, e-commerce, CRM and security for retail and small businesses.",
    },
    pme: {
      title: "Pricing — AI & websites for TPE/PME | Digital M",
      description:
        "Fixed-scope websites, AI and security audits for French small businesses — from €500, priced up front.",
    },
    legalNotice: {
      title: "Legal notice | Digital M",
      description: "Legal information for Digital M.",
    },
    privacy: {
      title: "Privacy policy | Digital M",
      description: "How Digital M handles personal data, in line with the GDPR.",
    },
  },

  nav: {
    links: [
      { label: "Services", href: "/services" },
      { label: "Work", href: "/work" },
      { label: "Pricing", href: "/pme" },
      { label: "Check-up", href: "/diagnostic" },
      { label: "Contact", href: "/contact" },
    ],
    cta: "Book a call",
  },

  smb: {
    eyebrow: "For smaller businesses (France)",
    title: "Smaller business? Same engineering, sized to fit.",
    body: "The same delivery we bring to large retail, packaged for French micro and small businesses — a fast, well-built website and AI that handles the repetitive work, at a price that fits a smaller budget. Same standards, right-sized scope.",
    points: [
      "A modern website, built to perform and easy to run",
      "AI for the repetitive work — quotes, replies, content, scheduling",
      "Clear fixed scope and pricing, agreed up front",
    ],
    proof:
      "Built by the team behind delivery for Vision Direct, EssilorLuxottica and Liz Earle.",
    priceChip: "Sites from €500 · AI from €500/day · care from €150/month",
    cta: "See packages & pricing",
  },

  pricing: {
    hero: {
      eyebrow: "TPE & PME",
      title: "Affordable AI and websites, priced up front.",
      sub: "Real fixed-scope packages for French micro and small businesses — built by the team behind delivery for Vision Direct, EssilorLuxottica and Liz Earle.",
    },
    rateNote:
      "Day rate from €500 — down from a standard €750, a preferential rate for small businesses. Fixed scope, agreed up front.",
    discountTag: "Preferential rate",
    recommendedBadge: "Recommended",
    guarantee:
      "Fixed price, agreed up front — no surprise invoices. We refine the scope until you're happy to sign off. For the monthly care plan: fixed price, published grid, cancel with one email — no fees.",
    diagnostic: {
      eyebrow: "Free, no commitment",
      title: "Free 48-hour express audit",
      body: "Tell us about your site or store and we'll send back 2–3 concrete, prioritised recommendations within two business days — free, no obligation.",
      cta: "Get my free audit",
    },
    cardReassurance: "Fixed quote up front · no obligation",
    packages: [
      {
        name: "Online store + AI",
        price: "from €5,000",
        originalPrice: "from €7,500",
        timeline: "2–3 weeks",
        outcome: "A real online store, with AI built in from day one.",
        includes: [
          "Catalogue, payment and delivery set up",
          "AI built in: customer replies, product content",
          "Hands-on training included",
          "First month of Veille included — activated only if you want it",
        ],
        cta: "Launch my store",
      },
      {
        name: "Site + AI",
        price: "from €2,500",
        originalPrice: "from €3,750",
        timeline: "about 1 week",
        outcome: "A modern site with AI built in.",
        includes: [
          "Everything in Site essentiel",
          "AI integrated from day one",
          "Content and automation set up",
          "First month of Veille included — activated only if you want it",
        ],
        lead: true,
        cta: "Build site + AI",
      },
      {
        name: "Site essentiel",
        price: "from €500",
        originalPrice: "from €750",
        timeline: "1–2 days",
        outcome: "A fast, well-built website, live in days.",
        includes: [
          "Modern, responsive site",
          "Performance and SEO basics",
          "Simple to run and update",
          "First month of Veille included — activated only if you want it",
        ],
        cta: "Start my site",
      },
      {
        name: "AI on your site",
        price: "from €500",
        originalPrice: "from €750",
        timeline: "1–3 days",
        outcome: "AI that takes on the repetitive work.",
        includes: [
          "AI added to your existing site",
          "Quotes, replies, content, scheduling",
          "Integrated with the tools you use",
          "First month of Veille included — activated only if you want it",
        ],
        cta: "Add AI to my site",
      },
    ],
    audit: {
      name: "E-commerce security audit",
      price: "from €500/day",
      originalPrice: "from €750/day",
      timeline: "by scope",
      outcome: "Know where your site or store is exposed — prioritised findings, fixes, payment and customer-data focus, re-test after corrections.",
      includes: [],
      cta: "Request an audit",
    },
    care: {
      eyebrow: "Peace of mind — the monthly care plan",
      title: "We don't disappear once the site is live.",
      body: "Like a boiler or a work van: regular upkeep costs less than the breakdown. A half-day call-out costs €250; a month of Veille costs €150 — and you never have to think about it.",
      overageRule: "Beyond the plan, we warn you first and send a quote. Never a surprise invoice.",
      honesty: "We'll tell you which level makes sense for you — including \"none\".",
      mechanics: "Cancel by email, effective end of month, no proration, no fees.",
      tiers: [
        {
          name: "Veille",
          price: "€150/month",
          timeline: "monthly · no commitment",
          outcome: "Your site and your AI stay online, up to date and watched over.",
          includes: [
            "We keep watch: site, AI, backups, security, updates",
            "Faults in what we built: fixed at no extra cost",
            "One small change per month (text, photo, hours — 15 min max)",
            "Plain-language monthly recap: what we did, what we saw",
          ],
          cta: "Start the care plan",
        },
        {
          name: "Partenaire",
          price: "€500/month",
          timeline: "monthly · no commitment",
          outcome: "Everything in Veille, plus one team-day each month, yours to direct.",
          includes: [
            "All of Veille + one day of work of your choice each month",
            "Monthly review of your AI's answers, corrections included",
            "30-min monthly call + annual security check-up",
            "Bought separately this would cost ≈ €650 — as a plan, €500",
          ],
          lead: true,
          cta: "Become a partner",
        },
      ],
    },
    note: "The day rate applies once we have the access and information to start. Prices are starting points — we confirm scope and a fixed quote up front.",
    cta: "Tell us what you need",
  },

  process: {
    eyebrow: "How we work",
    title: "From idea to shipped, in four steps.",
    steps: [
      {
        title: "Map where AI fits",
        detail: "We find the workflows where AI pays off — and rule out the ones where it doesn't.",
      },
      {
        title: "Integrate, don't bolt on",
        detail: "We build into the systems you already run — commerce, CRM, support.",
      },
      {
        title: "Ship measurable improvement",
        detail: "We deliver against real outcomes: time saved, conversion, response times.",
      },
      {
        title: "Support and iterate",
        detail: "We stay on to measure, tune and keep it running.",
      },
    ],
  },

  faq: {
    eyebrow: "FAQ",
    title: "Questions we get asked.",
    items: [
      {
        q: "How long does a project take?",
        a: "Small sites and AI add-ons land in days; a site with AI built in is about a week; larger commerce and CRM work is scoped up front. We agree a fixed scope and timeline before we start.",
      },
      {
        q: "Do you work with our existing systems?",
        a: "Yes — we integrate into the commerce platform, CRM and tools you already run rather than replacing them, unless replacing is the right call.",
      },
      {
        q: "How do you handle data and security?",
        a: "Payment and customer data are handled with care, and we can run a security audit of your site or store. We only ever audit with your written authorisation.",
      },
      {
        q: "What does it cost?",
        a: "For small businesses we publish fixed-scope packages from €500 — see /pme. Larger commerce and CRM work is quoted up front against a clear scope.",
      },
      {
        q: "Is there a free way to start?",
        a: "Yes — we offer a free 48-hour express audit: tell us about your site or store and we'll send back two or three concrete, prioritised recommendations within two business days, no obligation. Paid work is always fixed-price and agreed up front.",
      },
      {
        q: "Do I own what you build?",
        a: "Yes. The website, code and content are yours. And that doesn't change whether you take — or stop — the monthly care plan.",
      },
      {
        q: "What happens after launch?",
        a: "Every package includes 30 days of follow-up. After that: run it yourself — everything is yours — or we keep watching it with the fixed-price monthly care plan, €150 or €500/month, cancel with one email. Without a plan your site keeps running; what moves are the AI models and your business. We'll tell you which level makes sense — including \"none\".",
      },
    ],
  },

  testimonialsHeading: {
    eyebrow: "On the record",
    title: "What clients and colleagues say.",
  },
  testimonials: [
    {
      quote:
        "I had the pleasure of working with Radu on a very significant project to completely re-platform the business into the Salesforce ecosystem. He provided a clear and strong voice across the project, making sure the right approaches were taken to critical development decisions.",
      name: "Damian H.",
      role: "Senior Director, Global Consumer Experience, SharkNinja",
    },
    {
      quote:
        "We worked together on a Customer 360 implementation leveraging Service, Marketing and Commerce Cloud for a multi-cloud Salesforce programme. Radu managed both the Service and Marketing Cloud streams, always in contact with the business and mitigating technical risks. He can drive any project.",
      name: "George P.",
      role: "Technical Architect & Salesforce Developer",
    },
    {
      quote:
        "Not only a highly skilled developer, but someone with real architectural insight and great judgement as to the best way to do things. Highly recommended.",
      name: "Michael K.",
      role: "CEO",
    },
    {
      quote:
        "Radu is engaged and dedicated to get things done. He has been key in strengthening our Salesforce environment for our customer service.",
      name: "Sébastien G.",
      role: "CIO",
    },
    {
      quote:
        "He took on the management of different teams in the Salesforce environment, organised them and increased the team's output drastically. Awesome people and stakeholder management skills.",
      name: "Federico C.",
      role: "Solution Manager IT, Vision Direct",
    },
    {
      quote:
        "An excellent development manager and a great organising force, ensuring all aspects of quality delivery — a strong balance of technical expertise and management ability.",
      name: "Paul J.",
      role: "Director of Technology",
    },
  ],
  caseStudy: {
    challengeLabel: "The challenge",
    approachLabel: "What we did",
    resultsLabel: "Outcome",
    back: "All work",
  },

  footer: {
    tagline:
      "AI brought into commerce — grounded in 15 years building the systems retail runs on.",
    contactHeading: "Contact",
    email: "contact@digitalm.eu",
    whatsappText: "Message us on WhatsApp",
    whatsappUrl: "https://wa.me/447939856838",
    legalHeading: "Legal",
    legalLinks: [
      { label: "Legal notice", href: "/legal/mentions-legales" },
      { label: "Privacy policy", href: "/legal/confidentialite" },
    ],
    rights: "Digital M. All rights reserved.",
    note: "Digital M is a trading name of Digital Management Ltd, registered in England and Wales (company no. 09457882).",
  },

  home: {
    hero: {
      eyebrow: "AI for retail & e-commerce",
      titleLines: ["AI in commerce,"],
      titleAccent: "grounded in real delivery.",
      sub: "Digital M helps retail and e-commerce teams put AI to work — backed by 15+ years building the e-commerce and Salesforce CRM systems that brands like Vision Direct, EssilorLuxottica and Liz Earle run on.",
      ctaPrimary: "Book a call",
      ctaSecondary: "See the work",
      ctaDiagnostic: "Free check-up (4 min)",
    },
    proofLabel: "Selected work",
    proofBreadth:
      "Experience across optical, fashion, beauty and B2B wholesale — from high-street brands to a global eyewear group.",
    clients: [
      "Vision Direct",
      "EssilorLuxottica",
      "Liz Earle",
      "Missguided",
      "In The Style",
      "APP Wholesale",
    ],
    pillarsHeading: {
      eyebrow: "What we do",
      title: "AI first — proven by what's underneath.",
      intro:
        "AI is the lead. The reason it works is the delivery underneath it.",
    },
    pillars: [
      {
        id: "ai",
        kicker: "01 / AI",
        title: "AI adoption & integration",
        lead: true,
        summary:
          "Putting AI to work where it earns its place in retail — customer experience, operations, and the repetitive work that slows teams down.",
        points: [
          "Find the workflows where AI pays off — and the ones where it doesn't",
          "Integrate models and automation into existing commerce and CRM systems",
          "Ship measurable improvements, not demos",
        ],
        proof: "Grounded in systems we've already built for retail.",
      },
      {
        id: "ecommerce",
        kicker: "02 / Commerce",
        title: "E-commerce engineering",
        lead: false,
        summary:
          "Commerce-platform work — built, integrated and maintained for stores that handle real volume.",
        points: [
          "Platform build, integration and performance",
          "Storefront, checkout and payment flows",
          "Integrations with ERP, PIM and fulfilment",
        ],
        proof: "Delivered for Vision Direct, Liz Earle, Missguided and more.",
      },
      {
        id: "crm",
        kicker: "03 / CRM",
        title: "CRM delivery",
        lead: false,
        summary:
          "Salesforce Service and Marketing Cloud — set up and run so customer data and journeys actually work.",
        points: [
          "Salesforce Service & Marketing Cloud delivery",
          "Customer journeys, segmentation and automation",
          "Data flows between commerce, CRM and support",
        ],
        proof: "Delivered inside a global optical group.",
      },
    ],
    grounding: {
      eyebrow: "Why it holds up",
      title: "The AI claim is backed by 15 years of shipping.",
      body: "Digital M is an AI-forward company, but the difference is what sits underneath. We've spent 15+ years delivering e-commerce and CRM for major retail and optical brands — the systems that take orders, move data and serve customers every day. That's what makes our AI work practical: we put it into systems we already know how to build, integrate and keep running. Security comes with the territory, with payment and customer data handled carefully.",
      stats: [
        { value: "15+ yrs", label: "delivering e-commerce & CRM" },
        { value: "100+", label: "projects delivered" },
        { value: "5×", label: "checkout throughput at Vision Direct" },
        { value: "£55k+/yr", label: "saved re-platforming Mr Central Heating" },
      ],
    },
    cta: {
      title: "Bring AI into your commerce stack.",
      body: "Tell us where retail is slowing you down. We'll tell you, honestly, where AI helps and where it doesn't.",
      button: "Tell us what you need",
    },
  },

  services: {
    hero: {
      eyebrow: "Services",
      title: "AI adoption, backed by delivery that ships.",
      sub: "Three pillars. AI leads; commerce and CRM engineering prove we can build, not just advise.",
    },
    pillars: [
      {
        id: "ai",
        kicker: "01 / AI",
        title: "AI adoption & integration",
        lead: true,
        summary:
          "Our lead offer. We help retail and e-commerce teams adopt AI where it earns its place — and integrate it into the systems they already run, rather than bolting on something separate.",
        points: [
          "Map the workflows where AI pays off — customer service, content, search, merchandising, operations — and rule out the ones where it doesn't",
          "Integrate models and automation into existing commerce platforms, CRM and support tools",
          "Build with the data and security realities of retail in mind",
          "Measure against real outcomes — time saved, conversion, response times — not demos",
        ],
        proof:
          "We put AI into systems we already know how to build and run. That's what keeps it practical.",
      },
      {
        id: "ecommerce",
        kicker: "02 / Commerce",
        title: "E-commerce engineering & delivery",
        lead: false,
        summary:
          "Commerce-platform work, built and maintained for stores that handle real volume. This is the engineering that proves we can ship.",
        points: [
          "Platform build, integration, performance and long-term maintenance",
          "Storefront, checkout and payment flows",
          "Integrations with ERP, PIM, fulfilment and marketing tools",
          "Payment and customer-data security handled with care",
        ],
        proof:
          "Delivered for Vision Direct, Liz Earle, Missguided, In The Style and APP Wholesale.",
      },
      {
        id: "crm",
        kicker: "03 / CRM",
        title: "CRM delivery",
        lead: false,
        summary:
          "Salesforce Service and Marketing Cloud, set up and run so customer data and journeys actually do their job.",
        points: [
          "Salesforce Service & Marketing Cloud delivery and consulting",
          "Customer journeys, segmentation and lifecycle automation",
          "Data flows between commerce, CRM and support",
          "Delivery management across teams and vendors",
        ],
        proof: "Delivered and managed inside a global optical group.",
      },
    ],
    cta: {
      title: "Not sure where AI fits?",
      body: "That's the right question. We'll help you find the workflows where it earns its place — and skip the ones where it doesn't.",
      button: "Tell us what you need",
    },
  },

  work: {
    hero: {
      eyebrow: "Work",
      title: "15 years of commerce people actually use.",
      sub: "Selected delivery across retail and optical, presented as Digital M's track record — the proof behind the AI offer.",
    },
    itemsLabel: "Selected delivery",
    items: [
      {
        client: "Vision Direct",
        scope: "E-commerce, development & AI",
        slug: "vision-direct",
        headline: "Checkout throughput from 50 to 250+ orders a minute",
        detail:
          "E-commerce delivery, ongoing development and AI work for one of Europe's largest online contact-lens retailers.",
        challenge:
          "Vision Direct — one of Europe's largest online contact-lens retailers — needed a checkout that held up under heavy, spiky demand without dropping orders.",
        approach:
          "We optimised the checkout and the database behind it, built custom REST APIs and features like SMS reorder, hardened the platform against spiky demand, and supported the move into the Salesforce ecosystem — engineering for throughput and reliability under load.",
        results: [
          { value: "50 → 250+", label: "orders per minute through checkout" },
          { value: "5×", label: "checkout throughput" },
        ],
        testimonial: {
          quote:
            "He took on the management of different teams in the Salesforce environment, organised them and increased the team's output drastically. Awesome people and stakeholder management skills.",
          name: "Federico C.",
          role: "Solution Manager IT, Vision Direct",
        },
        tags: ["E-commerce", "Development", "AI", "Optical"],
      },
      {
        client: "EssilorLuxottica",
        scope: "CRM & senior consulting",
        slug: "essilorluxottica",
        headline: "A multi-cloud Salesforce re-platform for a global eyewear group",
        detail:
          "Salesforce Service & Marketing Cloud delivery and senior consulting inside a global eyewear group.",
        challenge:
          "EssilorLuxottica set out to re-platform the business into the Salesforce ecosystem — across commerce, service and marketing — for a single view of the customer.",
        approach:
          "We delivered and managed the Service & Marketing Cloud streams of a multi-cloud Customer 360 programme, coordinating on- and offshore teams and keeping business and technical risk in check.",
        results: [
          { value: "Customer 360", label: "multi-cloud Salesforce programme" },
          { value: "Service + Marketing Cloud", label: "delivered & managed" },
        ],
        testimonial: {
          quote:
            "We worked together on a Customer 360 implementation leveraging Service, Marketing and Commerce Cloud for a multi-cloud Salesforce programme. Radu managed both the Service and Marketing Cloud streams, always in contact with the business and mitigating technical risks. He can drive any project.",
          name: "George P.",
          role: "Technical Architect & Salesforce Developer",
        },
        tags: ["Salesforce", "Service Cloud", "Marketing Cloud"],
      },
      {
        client: "Mr Central Heating",
        scope: "E-commerce re-platforming",
        slug: "mr-central-heating",
        headline: "£55k+ saved a year by re-platforming off enterprise licensing",
        detail:
          "Re-platformed the store and moved it off an enterprise commerce licence it no longer needed.",
        challenge:
          "Mr Central Heating was carrying the cost and overhead of an enterprise commerce licence its business no longer needed.",
        approach:
          "We moved the store from Magento's enterprise edition down to the community edition — re-engineering what the licence had provided so nothing was lost — as part of a Magento 1→2 migration, and put version control and a branching strategy in place for safe ongoing delivery.",
        results: [
          { value: "£55k+/yr", label: "licensing cost saved" },
          { value: "Enterprise → Community", label: "edition downgrade, nothing lost" },
        ],
        tags: ["E-commerce", "Re-platforming"],
      },
      {
        client: "Missguided",
        scope: "E-commerce delivery",
        slug: "missguided",
        headline: "Checkout integrations built for 4.5M monthly shoppers",
        detail:
          "Checkout, integrations and high-traffic campaign engineering for the high-volume fashion retailer.",
        challenge:
          "Missguided — one of the UK's biggest fast-fashion retailers, with 4.5M+ monthly visitors across 11 markets — needed new checkout integrations and the ability to run aggressive French flash-sale campaigns at scale.",
        approach:
          "We built a new checkout API integrating student-discount platforms (NUS, Student Beans) and Canada's SPC, added the Criteo retargeting API and Click & Collect, and helped structure the new French flash-sale storefront — engineered to hold up under peak campaign traffic.",
        results: [
          { value: "4.5M+/mo", label: "shoppers served at scale" },
          { value: "NUS · Criteo · Click & Collect", label: "checkout & marketing integrations" },
        ],
        tags: ["E-commerce", "Fashion", "Integrations"],
      },
      {
        client: "In The Style",
        scope: "E-commerce delivery",
        slug: "in-the-style",
        headline: "US, Australian and European storefronts, launched",
        detail: "International expansion for the fast-fashion brand.",
        challenge:
          "In The Style — a fast-growing UK fashion brand backed by a ~£40M investment to expand abroad — needed new international storefronts built and launched quickly.",
        approach:
          "We automated the rollout of their US, Australian and European storefronts — structure, catalogues and settings — launched them, and integrated marketing and personalisation platforms (Exponea, Criteo).",
        results: [
          { value: "US · AU · EU", label: "storefronts built & launched" },
          { value: "Automated rollout", label: "store structure, catalogue & settings" },
        ],
        tags: ["E-commerce", "Fashion"],
      },
      {
        client: "Liz Earle",
        scope: "E-commerce engineering",
        detail:
          "Upgraded a heavily customised Magento core for the skincare brand and built a two-way API linking it to their in-house CRM.",
        tags: ["E-commerce", "Beauty"],
      },
      {
        client: "APP Wholesale",
        scope: "Senior e-commerce engineering",
        detail:
          "Years of senior Magento development across a ~£280M plumbing & heating group's 10+ online stores — new business features and the Magento 1→2 migration.",
        tags: ["E-commerce", "Wholesale"],
      },
    ],
    capabilitiesHeading: "What we bring",
    capabilities: [
      {
        title: "Salesforce",
        detail: "Service & Marketing Cloud — delivery and senior consulting.",
      },
      {
        title: "E-commerce",
        detail: "Build, integration, performance and long-term maintenance of commerce platforms.",
      },
      {
        title: "AI integration",
        detail: "Putting models and automation into live commerce and CRM systems.",
      },
      {
        title: "Security-aware",
        detail: "Payment and customer-data competence relevant to commerce.",
      },
    ],
    cta: {
      title: "Want the detail?",
      body: "Happy to walk through any of this — the systems, the constraints, and what we'd do differently now.",
      button: "Get in touch",
    },
  },

  contact: {
    hero: {
      eyebrow: "Contact",
      title: "Tell us what you need.",
      sub: "Tell us about your retail or e-commerce business and where you think AI might help. We'll reply with a straight answer.",
    },
    directHeading: "Reach us directly",
    emailLabel: "Email",
    whatsappLabel: "WhatsApp",
    whatsappText: "Send us a message",
    email: "contact@digitalm.eu",
    whatsappUrl: "https://wa.me/447939856838",
    form: {
      heading: "Send a message",
      name: "Name",
      emailField: "Email",
      phone: "Phone",
      company: "Company (optional)",
      message: "How can we help?",
      submit: "Send message",
      sending: "Sending…",
      success: "Thanks — your message is on its way. We'll be in touch.",
      error: "Something went wrong. Please email us directly at",
      required: "Please fill in the required fields.",
      responsePromise: "We reply within one business day with an honest read.",
    },
  },

  booking: {
    eyebrow: "Book a call",
    title: "30 minutes to see what AI could automate in your business",
    sub: "Tell us about your day-to-day and we'll spot what's eating your time.",
    benefits: [
      "You leave with 2–3 concrete ideas — even if we never work together",
      "We'll tell you honestly if AI isn't worth it in your case",
    ],
    trust: ["Free", "No commitment", "Video or phone"],
    step1: "1. Pick your time",
    step2: "2. Your details",
    pickFirst: "Pick a time above first",
    pickHint: "Times shown in your local timezone.",
    noSlots:
      "No free slots in the next two weeks — email contact@digitalm.eu and we'll find a time.",
    name: "Name",
    email: "Email",
    phone: "Phone",
    company: "Company (optional)",
    needs: "What's it about? (optional)",
    preferred: "Preferred times",
    submit: "Confirm booking",
    request: "Request a call",
    submitting: "Sending…",
    change: "Change time",
    successBooked: "You're booked — a calendar invite is on its way to your inbox.",
    successRequested: "Thanks — we'll confirm a time with you by email shortly.",
    error: "Something went wrong. Please email contact@digitalm.eu.",
  },

  legal: {
    notice: {
      title: "Legal notice",
      updated: "Last updated: June 2026",
      placeholderNote: "",
      sections: [
        {
          heading: "Publisher",
          body: "This website is published by Digital M, a trading name of Digital Management Ltd, a company registered in England and Wales under company number 09457882, with its registered office at 67 Meridian Centre, Havant, Hampshire, PO9 1UN, United Kingdom.",
        },
        {
          heading: "Contact",
          body: "Email: contact@digitalm.eu",
        },
        {
          heading: "Hosting",
          body: "This website is hosted by OVH SAS, 2 rue Kellermann, 59100 Roubaix, France (ovhcloud.com).",
        },
        {
          heading: "Intellectual property",
          body: "Unless otherwise stated, the content, design, brand and logos on this site are the property of Digital Management Ltd and may not be reproduced or reused without prior written permission.",
        },
        {
          heading: "Liability",
          body: "We take care to keep the information on this site accurate and up to date, but cannot guarantee it is free of errors or omissions. The site may link to third-party sites over which we have no control and for which we accept no responsibility.",
        },
      ],
    },
    privacy: {
      title: "Privacy policy",
      updated: "Last updated: June 2026",
      placeholderNote: "",
      sections: [
        {
          heading: "Who we are",
          body: "Digital M (a trading name of Digital Management Ltd), 67 Meridian Centre, Havant, Hampshire, PO9 1UN, United Kingdom, is the data controller for personal data collected through this site. For any data request, contact contact@digitalm.eu.",
        },
        {
          heading: "What we collect and why",
          body: "If you contact us through the form or by email, we process the details you provide — typically your name, email, company and message — only to respond to you. We do not use them for marketing without your consent.",
        },
        {
          heading: "Cookies and consent",
          body: "This site uses a single functional cookie to remember your chosen language, which is strictly necessary for the site to work. We do not use advertising or tracking cookies. For audience measurement we use Umami, a self-hosted, cookieless tool that collects only anonymous, aggregated statistics (page views, country, device type) and cannot identify visitors — which is why it does not require consent. Any other non-essential cookies would only be set with your consent, via the cookie banner.",
        },
        {
          heading: "AI assistant",
          body: "If you use the on-site assistant, the messages you send are processed by a third-party AI provider to generate a response. Please do not share sensitive personal information in the chat.",
        },
        {
          heading: "Sharing",
          body: "We share personal data only with the service providers that help us operate — our email provider, our hosting provider (OVH), and our AI provider for the assistant — and only as needed. We do not sell personal data.",
        },
        {
          heading: "Retention",
          body: "We keep contact messages only as long as needed to handle your enquiry and any follow-up, then delete them. Digital check-up (diagnostic form) answers are kept for at most 3 years after our last exchange, under a unique reference (e.g. DM-X4K7Q) you can quote to request deletion at any time. The associated IP address, collected under our legitimate interest (abuse prevention), is deleted within 12 months.",
        },
        {
          heading: "Your rights",
          body: "Under the UK GDPR and the EU GDPR you can ask to access, correct, delete or restrict the processing of your personal data, and object to it. Email contact@digitalm.eu. You can also complain to the UK Information Commissioner's Office (ico.org.uk) or, in the EU, your local data protection authority (in France, the CNIL).",
        },
      ],
    },
  },
} satisfies SiteContent;
