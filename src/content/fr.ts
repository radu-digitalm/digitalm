import type { SiteContent } from "./types";

export const fr = {
  meta: {
    home: {
      title: "Digital M — l'IA au service du commerce, ancrée dans le concret",
      description:
        "Digital M aide les équipes retail et e-commerce à mettre l'IA au travail — fort de plus de 15 ans à livrer des plateformes e-commerce et des CRM Salesforce pour de grandes marques du retail et de l'optique.",
    },
    services: {
      title: "Services — adoption de l'IA, e-commerce & CRM | Digital M",
      description:
        "Adoption et intégration de l'IA pour le retail, appuyées sur l'ingénierie e-commerce et la livraison Salesforce Service & Marketing Cloud.",
    },
    work: {
      title: "Réalisations — 15+ ans de e-commerce & CRM retail | Digital M",
      description:
        "Réalisations pour Vision Direct, EssilorLuxottica, Liz Earle, Missguided, In The Style et APP Wholesale — e-commerce, Salesforce et commerce sécurisé.",
    },
    contact: {
      title: "Contact | Digital M",
      description:
        "Parlez à Digital M de la mise au travail de l'IA dans votre activité retail ou e-commerce. Écrivez à contact@digitalm.eu.",
    },
    book: {
      title: "Réserver un appel | Digital M",
      description:
        "Réservez un appel de 30 minutes avec Digital M — IA, e-commerce, CRM et sécurité pour le retail et les petites entreprises.",
    },
    pme: {
      title: "Tarifs — IA & sites pour TPE/PME | Digital M",
      description:
        "Sites, IA et audits de sécurité à périmètre fixe pour les petites entreprises françaises — à partir de 500 €, au prix annoncé.",
    },
    legalNotice: {
      title: "Mentions légales | Digital M",
      description: "Informations légales de Digital M.",
    },
    privacy: {
      title: "Politique de confidentialité | Digital M",
      description:
        "Comment Digital M traite les données personnelles, conformément au RGPD.",
    },
  },

  nav: {
    links: [
      { label: "Services", href: "/services" },
      { label: "Réalisations", href: "/work" },
      { label: "Tarifs", href: "/pme" },
      { label: "Contact", href: "/contact" },
    ],
    cta: "Réserver un appel",
  },

  smb: {
    eyebrow: "Pour les TPE & PME",
    title: "TPE, PME ? La même ingénierie, à votre échelle.",
    body: "La même livraison que pour les grandes enseignes du retail, pensée pour les TPE et PME françaises — un site rapide et bien construit, et une IA qui prend en charge les tâches répétitives, à un prix adapté à un budget plus serré. Mêmes exigences, périmètre ajusté.",
    points: [
      "Un site moderne, performant et simple à gérer",
      "L'IA pour le répétitif — devis, réponses, contenu, planning",
      "Un périmètre et un prix clairs, fixés à l'avance",
    ],
    proof:
      "Réalisé par l'équipe derrière les livraisons pour Vision Direct, EssilorLuxottica et Liz Earle.",
    priceChip: "Sites à partir de 500 € · IA à partir de 500 €/jour · périmètre fixe",
    cta: "Voir les forfaits et tarifs",
  },

  pricing: {
    hero: {
      eyebrow: "TPE & PME",
      title: "Une IA et des sites abordables, au prix annoncé.",
      sub: "De vrais forfaits à périmètre fixe pour les TPE et PME françaises — par l'équipe derrière les livraisons pour Vision Direct, EssilorLuxottica et Liz Earle.",
    },
    rateNote:
      "Tarif journalier à partir de 500 € — contre 750 € en tarif standard, un tarif préférentiel pour les petites entreprises. Périmètre fixe, défini à l'avance.",
    discountTag: "Tarif préférentiel",
    recommendedBadge: "Recommandé",
    guarantee:
      "Prix fixe, défini à l'avance — aucune facture surprise. Nous ajustons le périmètre jusqu'à votre validation.",
    diagnostic: {
      eyebrow: "Gratuit, sans engagement",
      title: "Audit express gratuit sous 48 h",
      body: "Parlez-nous de votre site ou boutique et nous vous renvoyons 2 à 3 recommandations concrètes et priorisées sous deux jours ouvrés — gratuit, sans engagement.",
      cta: "Obtenir mon audit gratuit",
    },
    cardReassurance: "Devis fixe à l'avance · sans engagement",
    packages: [
      {
        name: "Site essentiel",
        price: "à partir de 500 €",
        originalPrice: "à partir de 750 €",
        timeline: "1–2 jours",
        outcome: "Un site rapide et bien construit, en ligne en quelques jours.",
        includes: [
          "Site moderne et responsive",
          "Performance et bases SEO",
          "Simple à gérer et à mettre à jour",
          "Périmètre fixe, défini à l'avance",
        ],
        cta: "Démarrer mon site",
      },
      {
        name: "L'IA sur votre site",
        price: "à partir de 500 €",
        originalPrice: "à partir de 750 €",
        timeline: "1–3 jours",
        outcome: "Une IA qui prend en charge le répétitif.",
        includes: [
          "IA ajoutée à votre site existant",
          "Devis, réponses, contenu, planning",
          "Intégrée aux outils que vous utilisez",
          "Mesurée sur des résultats réels",
        ],
        cta: "Ajouter l'IA",
      },
      {
        name: "Site + IA",
        price: "à partir de 2 500 €",
        originalPrice: "à partir de 3 750 €",
        timeline: "environ 1 semaine",
        outcome: "Un site moderne avec l'IA intégrée.",
        includes: [
          "Tout le Site essentiel",
          "IA intégrée dès le départ",
          "Contenu et automatisation en place",
          "Périmètre et délai fixes",
        ],
        lead: true,
        cta: "Lancer site + IA",
      },
      {
        name: "Audit de sécurité",
        price: "à partir de 500 €/jour",
        originalPrice: "à partir de 750 €/jour",
        timeline: "selon le périmètre",
        outcome: "Sachez où votre site ou boutique est exposé.",
        includes: [
          "Évaluation des vulnérabilités de votre site ou boutique",
          "Constats priorisés et correctifs",
          "Focus paiement et données clients",
          "Nouveau test après les corrections",
        ],
        cta: "Demander un audit",
      },
    ],
    note: "Le tarif journalier s'applique une fois que nous avons les accès et les informations pour démarrer. Les prix sont des points de départ — nous confirmons le périmètre et un devis fixe à l'avance.",
    cta: "Parlez-nous de votre besoin",
  },

  process: {
    eyebrow: "Comment nous travaillons",
    title: "De l'idée au livré, en quatre étapes.",
    steps: [
      {
        title: "Repérer où l'IA a sa place",
        detail: "Nous trouvons les flux où l'IA apporte — et écartons ceux où elle n'apporte pas.",
      },
      {
        title: "Intégrer, pas ajouter",
        detail: "Nous construisons dans les systèmes que vous exploitez déjà — commerce, CRM, support.",
      },
      {
        title: "Livrer un gain mesurable",
        detail: "Nous livrons sur des résultats réels : temps gagné, conversion, délais de réponse.",
      },
      {
        title: "Accompagner et itérer",
        detail: "Nous restons pour mesurer, ajuster et faire tourner.",
      },
    ],
  },

  faq: {
    eyebrow: "FAQ",
    title: "Les questions qu'on nous pose.",
    items: [
      {
        q: "Combien de temps prend un projet ?",
        a: "Les petits sites et ajouts d'IA sont livrés en quelques jours ; un site avec IA intégrée, environ une semaine ; les projets commerce et CRM plus larges sont cadrés à l'avance. Nous fixons un périmètre et un délai avant de commencer.",
      },
      {
        q: "Travaillez-vous avec nos systèmes existants ?",
        a: "Oui — nous intégrons la plateforme commerce, le CRM et les outils que vous utilisez déjà plutôt que de les remplacer, sauf si remplacer est le bon choix.",
      },
      {
        q: "Comment gérez-vous les données et la sécurité ?",
        a: "Les données de paiement et clients sont traitées avec soin, et nous pouvons réaliser un audit de sécurité de votre site ou boutique. Nous n'auditons qu'avec votre autorisation écrite.",
      },
      {
        q: "Combien ça coûte ?",
        a: "Pour les petites entreprises, nous publions des forfaits à périmètre fixe à partir de 500 € — voir /pme. Les projets commerce et CRM plus larges sont devisés à l'avance sur un périmètre clair.",
      },
      {
        q: "Comment commencer gratuitement ?",
        a: "Nous proposons un audit express gratuit sous 48 h : parlez-nous de votre site ou boutique et nous renvoyons deux à trois recommandations concrètes et priorisées sous deux jours ouvrés, sans engagement. Les prestations payantes sont toujours à prix fixe, défini à l'avance.",
      },
      {
        q: "Suis-je propriétaire de ce que vous construisez ?",
        a: "Oui. Le site, le code et le contenu vous appartiennent.",
      },
    ],
  },

  testimonialsHeading: {
    eyebrow: "Ils en parlent",
    title: "Ce que disent clients et collègues.",
  },
  testimonials: [
    {
      quote:
        "J'ai eu le plaisir de travailler avec Radu sur un projet d'envergure visant à replateformer entièrement l'entreprise dans l'écosystème Salesforce. Il a apporté une voix claire et affirmée tout au long du projet, en veillant à ce que les bonnes approches soient retenues sur les décisions techniques critiques.",
      name: "Damian H.",
      role: "Directeur senior, Expérience client mondiale, SharkNinja",
    },
    {
      quote:
        "Nous avons collaboré sur une implémentation Customer 360 s'appuyant sur Service, Marketing et Commerce Cloud, dans le cadre d'un programme Salesforce multi-cloud. Radu pilotait les volets Service et Marketing Cloud, toujours en lien avec le métier et en maîtrisant les risques techniques. Il sait mener n'importe quel projet.",
      name: "George P.",
      role: "Architecte technique & développeur Salesforce",
    },
    {
      quote:
        "Non seulement un développeur très compétent, mais aussi quelqu'un doté d'une vraie vision architecturale et d'un excellent jugement sur la meilleure façon de procéder. Vivement recommandé.",
      name: "Michael K.",
      role: "PDG",
    },
    {
      quote:
        "Radu est impliqué et déterminé à faire aboutir les choses. Il a joué un rôle clé dans le renforcement de notre environnement Salesforce pour notre service client.",
      name: "Sébastien G.",
      role: "DSI",
    },
    {
      quote:
        "Il a pris en charge la gestion de plusieurs équipes dans l'environnement Salesforce, les a organisées et a fait progresser leur productivité de façon spectaculaire. D'excellentes compétences en management d'équipe et de parties prenantes.",
      name: "Federico C.",
      role: "Responsable solutions IT, Vision Direct",
    },
    {
      quote:
        "Un excellent responsable de développement et une vraie force d'organisation, garant de tous les aspects d'une livraison de qualité — un bel équilibre entre expertise technique et capacité de management.",
      name: "Paul J.",
      role: "Directeur de la technologie",
    },
  ],
  caseStudy: {
    challengeLabel: "Le défi",
    approachLabel: "Ce que nous avons fait",
    resultsLabel: "Résultat",
    back: "Toutes les réalisations",
  },

  footer: {
    tagline:
      "L'IA appliquée au commerce — ancrée dans 15 ans à bâtir les systèmes qui font tourner le retail.",
    contactHeading: "Contact",
    email: "contact@digitalm.eu",
    whatsappText: "Écrivez-nous sur WhatsApp",
    whatsappUrl: "https://wa.me/447939856838",
    legalHeading: "Légal",
    legalLinks: [
      { label: "Mentions légales", href: "/legal/mentions-legales" },
      { label: "Politique de confidentialité", href: "/legal/confidentialite" },
    ],
    rights: "Digital M. Tous droits réservés.",
    note: "Digital M est un nom commercial de Digital Management Ltd, société immatriculée en Angleterre et au pays de Galles (n° 09457882).",
  },

  home: {
    hero: {
      eyebrow: "L'IA pour le retail & le e-commerce",
      titleLines: ["L'IA dans le commerce,"],
      titleAccent: "ancrée dans le concret.",
      sub: "Digital M aide les équipes retail et e-commerce à mettre l'IA au travail — fort de plus de 15 ans à bâtir les systèmes e-commerce et CRM Salesforce sur lesquels s'appuient des marques comme Vision Direct, EssilorLuxottica et Liz Earle.",
      ctaPrimary: "Réserver un appel",
      ctaSecondary: "Voir les réalisations",
    },
    proofLabel: "Réalisations choisies",
    proofBreadth:
      "Une expérience à travers l'optique, la mode, la beauté et le B2B de gros — des enseignes grand public à un groupe optique mondial.",
    clients: [
      "Vision Direct",
      "EssilorLuxottica",
      "Liz Earle",
      "Missguided",
      "In The Style",
      "APP Wholesale",
    ],
    pillarsHeading: {
      eyebrow: "Ce que nous faisons",
      title: "L'IA d'abord — prouvée par ce qu'il y a dessous.",
      intro:
        "L'IA est en tête. Ce qui la rend efficace, c'est la livraison qui la soutient.",
    },
    pillars: [
      {
        id: "ai",
        kicker: "01 / IA",
        title: "Adoption & intégration de l'IA",
        lead: true,
        summary:
          "Mettre l'IA au travail là où elle a sa place dans le retail — l'expérience client, les opérations et les tâches répétitives qui ralentissent les équipes.",
        points: [
          "Repérer les flux où l'IA apporte vraiment — et ceux où elle n'apporte rien",
          "Intégrer les modèles et l'automatisation aux systèmes e-commerce et CRM existants",
          "Livrer des gains mesurables, pas des démos",
        ],
        proof: "Ancrée dans des systèmes que nous avons déjà bâtis pour le retail.",
      },
      {
        id: "ecommerce",
        kicker: "02 / Commerce",
        title: "Ingénierie e-commerce",
        lead: false,
        summary:
          "Plateformes de commerce — conçues, intégrées et maintenues pour des boutiques qui encaissent du volume réel.",
        points: [
          "Développement, intégration et performance de la plateforme",
          "Vitrine, tunnel d'achat et flux de paiement",
          "Intégrations ERP, PIM et logistique",
        ],
        proof: "Livré pour Vision Direct, Liz Earle, Missguided et d'autres.",
      },
      {
        id: "crm",
        kicker: "03 / CRM",
        title: "Livraison CRM",
        lead: false,
        summary:
          "Salesforce Service et Marketing Cloud — installés et exploités pour que les données et les parcours clients fonctionnent vraiment.",
        points: [
          "Livraison Salesforce Service & Marketing Cloud",
          "Parcours clients, segmentation et automatisation",
          "Flux de données entre commerce, CRM et support",
        ],
        proof: "Livré au sein d'un groupe optique mondial.",
      },
    ],
    grounding: {
      eyebrow: "Pourquoi ça tient",
      title: "La promesse IA repose sur 15 ans de livraison.",
      body: "Digital M est une entreprise tournée vers l'IA, mais la différence tient à ce qu'il y a en dessous. Nous avons passé plus de 15 ans à livrer des plateformes e-commerce et des CRM pour de grandes marques du retail et de l'optique — les systèmes qui prennent les commandes, font circuler les données et servent les clients au quotidien. C'est ce qui rend notre travail en IA concret : nous l'intégrons à des systèmes que nous savons déjà concevoir, intégrer et faire tourner. La sécurité fait partie du métier, avec un soin particulier porté aux données de paiement et aux données clients.",
      stats: [
        { value: "15+ ans", label: "de livraison e-commerce & CRM" },
        { value: "100+", label: "projets livrés" },
        { value: "5×", label: "débit du paiement chez Vision Direct" },
        { value: "55k£+/an", label: "économisés en re-platformant Mr Central Heating" },
      ],
    },
    cta: {
      title: "Intégrez l'IA à votre stack commerce.",
      body: "Dites-nous où le retail vous ralentit. Nous vous dirons, honnêtement, où l'IA aide et où elle n'aide pas.",
      button: "Parlez-nous de votre besoin",
    },
  },

  services: {
    hero: {
      eyebrow: "Services",
      title: "L'adoption de l'IA, soutenue par une livraison qui tient.",
      sub: "Trois piliers. L'IA en tête ; l'ingénierie commerce et CRM prouve que nous savons bâtir, pas seulement conseiller.",
    },
    pillars: [
      {
        id: "ai",
        kicker: "01 / IA",
        title: "Adoption & intégration de l'IA",
        lead: true,
        summary:
          "Notre offre principale. Nous aidons les équipes retail et e-commerce à adopter l'IA là où elle a sa place — et à l'intégrer aux systèmes qu'elles exploitent déjà, plutôt que d'ajouter un outil à part.",
        points: [
          "Cartographier les flux où l'IA apporte — service client, contenu, recherche, merchandising, opérations — et écarter ceux où elle n'apporte pas",
          "Intégrer les modèles et l'automatisation aux plateformes commerce, CRM et outils de support existants",
          "Construire en tenant compte des réalités de données et de sécurité du retail",
          "Mesurer sur des résultats réels — temps gagné, conversion, délais de réponse — pas sur des démos",
        ],
        proof:
          "Nous intégrons l'IA à des systèmes que nous savons déjà bâtir et faire tourner. C'est ce qui la garde concrète.",
      },
      {
        id: "ecommerce",
        kicker: "02 / Commerce",
        title: "Ingénierie & livraison e-commerce",
        lead: false,
        summary:
          "Plateformes de commerce, conçues et maintenues pour des boutiques qui encaissent du volume réel. C'est l'ingénierie qui prouve que nous livrons.",
        points: [
          "Développement, intégration, performance et maintenance dans la durée",
          "Vitrine, tunnel d'achat et flux de paiement",
          "Intégrations ERP, PIM, logistique et outils marketing",
          "Sécurité des paiements et des données clients traitée avec soin",
        ],
        proof:
          "Livré pour Vision Direct, Liz Earle, Missguided, In The Style et APP Wholesale.",
      },
      {
        id: "crm",
        kicker: "03 / CRM",
        title: "Livraison CRM",
        lead: false,
        summary:
          "Salesforce Service et Marketing Cloud, installés et exploités pour que les données et les parcours clients fassent vraiment leur travail.",
        points: [
          "Livraison et conseil Salesforce Service & Marketing Cloud",
          "Parcours clients, segmentation et automatisation du cycle de vie",
          "Flux de données entre commerce, CRM et support",
          "Pilotage de la livraison entre équipes et prestataires",
        ],
        proof: "Livré et piloté au sein d'un groupe optique mondial.",
      },
    ],
    cta: {
      title: "Pas sûr de l'endroit où l'IA a sa place ?",
      body: "C'est la bonne question. Nous vous aidons à trouver les flux où elle apporte — et à laisser de côté ceux où elle n'apporte pas.",
      button: "Parlez-nous de votre besoin",
    },
  },

  work: {
    hero: {
      eyebrow: "Réalisations",
      title: "15 ans de commerce que les gens utilisent vraiment.",
      sub: "Réalisations choisies dans le retail et l'optique, présentées comme le parcours de Digital M — la preuve derrière l'offre IA.",
    },
    itemsLabel: "Réalisations choisies",
    items: [
      {
        client: "Vision Direct",
        scope: "E-commerce, développement & IA",
        slug: "vision-direct",
        headline: "Le débit du paiement passe de 50 à plus de 250 commandes/minute",
        detail:
          "Livraison e-commerce, développement continu et travaux d'IA pour l'un des plus grands distributeurs de lentilles de contact en ligne d'Europe.",
        challenge:
          "Vision Direct — l'un des plus grands distributeurs de lentilles de contact en ligne d'Europe — avait besoin d'un tunnel d'achat capable de tenir une demande forte et irrégulière sans perdre de commandes.",
        approach:
          "Nous avons optimisé le tunnel d'achat et la base de données qui le sous-tend, développé des API REST sur mesure et des fonctionnalités comme la recommande par SMS, fiabilisé la plateforme face aux pics de demande et accompagné la bascule vers l'écosystème Salesforce — en concevant pour le débit et la fiabilité sous charge.",
        results: [
          { value: "50 → 250+", label: "commandes par minute au paiement" },
          { value: "5×", label: "débit du tunnel d'achat" },
        ],
        testimonial: {
          quote:
            "Il a pris en charge la gestion de plusieurs équipes dans l'environnement Salesforce, les a organisées et a fait progresser leur productivité de façon spectaculaire. D'excellentes compétences en management d'équipe et de parties prenantes.",
          name: "Federico C.",
          role: "Responsable solutions IT, Vision Direct",
        },
        tags: ["E-commerce", "Développement", "IA", "Optique"],
      },
      {
        client: "EssilorLuxottica",
        scope: "CRM & conseil senior",
        slug: "essilorluxottica",
        headline:
          "Un re-platforming Salesforce multi-cloud pour un groupe optique mondial",
        detail:
          "Livraison Salesforce Service & Marketing Cloud et conseil senior au sein d'un groupe optique mondial.",
        challenge:
          "EssilorLuxottica a entrepris de re-platformer l'activité dans l'écosystème Salesforce — commerce, service et marketing — pour une vue client unifiée.",
        approach:
          "Nous avons livré et piloté les flux Service & Marketing Cloud d'un programme Customer 360 multi-cloud, en coordonnant des équipes on- et offshore et en maîtrisant les risques métier et techniques.",
        results: [
          { value: "Customer 360", label: "programme Salesforce multi-cloud" },
          { value: "Service + Marketing Cloud", label: "livrés & pilotés" },
        ],
        testimonial: {
          quote:
            "Nous avons collaboré sur une implémentation Customer 360 s'appuyant sur Service, Marketing et Commerce Cloud, dans le cadre d'un programme Salesforce multi-cloud. Radu pilotait les volets Service et Marketing Cloud, toujours en lien avec le métier et en maîtrisant les risques techniques. Il sait mener n'importe quel projet.",
          name: "George P.",
          role: "Architecte technique & développeur Salesforce",
        },
        tags: ["Salesforce", "Service Cloud", "Marketing Cloud"],
      },
      {
        client: "Mr Central Heating",
        scope: "Re-platforming e-commerce",
        slug: "mr-central-heating",
        headline: "Plus de 55k£/an économisés en sortant d'une licence entreprise",
        detail:
          "Re-platforming de la boutique et sortie d'une licence commerce entreprise devenue inutile.",
        challenge:
          "Mr Central Heating supportait le coût et la lourdeur d'une licence commerce entreprise dont l'activité n'avait plus besoin.",
        approach:
          "Nous avons fait passer la boutique de l'édition entreprise à l'édition communautaire de Magento — en ré-implémentant ce que la licence apportait, sans rien perdre — dans le cadre d'une migration de Magento 1 vers 2, et mis en place la gestion de versions et une stratégie de branches pour une livraison continue sûre.",
        results: [
          { value: "55k£+/an", label: "de licence économisés" },
          { value: "Entreprise → Community", label: "passage d'édition, sans rien perdre" },
        ],
        tags: ["E-commerce", "Re-platforming"],
      },
      {
        client: "Missguided",
        scope: "Livraison e-commerce",
        slug: "missguided",
        headline: "Des intégrations de tunnel d'achat pour 4,5 M de visiteurs/mois",
        detail:
          "Tunnel d'achat, intégrations et ingénierie de campagnes à fort trafic pour l'enseigne de mode à fort volume.",
        challenge:
          "Missguided — l'une des plus grandes enseignes de fast-fashion britanniques, avec plus de 4,5 M de visiteurs/mois sur 11 marchés — avait besoin de nouvelles intégrations dans le tunnel d'achat et de pouvoir mener des campagnes de ventes flash françaises agressives à grande échelle.",
        approach:
          "Nous avons développé une nouvelle API de tunnel d'achat intégrant des plateformes de réductions étudiantes (NUS, Student Beans) et le SPC canadien, ajouté l'API de reciblage Criteo et le Click & Collect, et aidé à structurer la nouvelle boutique de ventes flash françaises — conçue pour tenir sous les pics de trafic des campagnes.",
        results: [
          { value: "4,5 M+/mois", label: "visiteurs servis à grande échelle" },
          { value: "NUS · Criteo · Click & Collect", label: "intégrations tunnel d'achat & marketing" },
        ],
        tags: ["E-commerce", "Mode", "Intégrations"],
      },
      {
        client: "In The Style",
        scope: "Livraison e-commerce",
        slug: "in-the-style",
        headline: "Boutiques US, australienne et européennes, lancées",
        detail: "Expansion internationale pour la marque de fast-fashion.",
        challenge:
          "In The Style — marque de mode britannique en forte croissance, soutenue par un investissement d'environ 40 M£ pour se développer à l'international — avait besoin de nouvelles boutiques lancées rapidement.",
        approach:
          "Nous avons automatisé le déploiement de leurs boutiques américaine, australienne et européennes — structure, catalogues et réglages — les avons lancées, et intégré des plateformes marketing et de personnalisation (Exponea, Criteo).",
        results: [
          { value: "US · AU · UE", label: "boutiques construites & lancées" },
          { value: "Déploiement automatisé", label: "structure, catalogue & réglages" },
        ],
        tags: ["E-commerce", "Mode"],
      },
      {
        client: "Liz Earle",
        scope: "Ingénierie e-commerce",
        detail:
          "Mise à niveau d'un cœur Magento fortement personnalisé pour la marque de soins, et développement d'une API bidirectionnelle le reliant à leur CRM interne.",
        tags: ["E-commerce", "Beauté"],
      },
      {
        client: "APP Wholesale",
        scope: "Ingénierie e-commerce senior",
        detail:
          "Des années de développement Magento senior sur les 10+ boutiques en ligne d'un groupe de plomberie et chauffage (~280 M£ de CA) — nouvelles fonctionnalités métier et migration de Magento 1 vers 2.",
        tags: ["E-commerce", "Gros"],
      },
    ],
    capabilitiesHeading: "Ce que nous apportons",
    capabilities: [
      {
        title: "Salesforce",
        detail: "Service & Marketing Cloud — livraison et conseil senior.",
      },
      {
        title: "E-commerce",
        detail: "Développement, intégration, performance et maintenance des plateformes de commerce dans la durée.",
      },
      {
        title: "Intégration IA",
        detail:
          "Intégrer modèles et automatisation aux systèmes commerce et CRM en production.",
      },
      {
        title: "Sécurité",
        detail: "Compétence sur les données de paiement et clients propres au commerce.",
      },
    ],
    cta: {
      title: "Envie du détail ?",
      body: "Avec plaisir — les systèmes, les contraintes, et ce que nous ferions autrement aujourd'hui.",
      button: "Nous contacter",
    },
  },

  contact: {
    hero: {
      eyebrow: "Contact",
      title: "Parlez-nous de votre besoin.",
      sub: "Parlez-nous de votre activité retail ou e-commerce et de l'endroit où l'IA pourrait aider. Nous répondrons franchement.",
    },
    directHeading: "Nous joindre directement",
    emailLabel: "E-mail",
    whatsappLabel: "WhatsApp",
    whatsappText: "Envoyez-nous un message",
    email: "contact@digitalm.eu",
    whatsappUrl: "https://wa.me/447939856838",
    form: {
      heading: "Envoyer un message",
      name: "Nom",
      emailField: "E-mail",
      phone: "Téléphone",
      company: "Société (facultatif)",
      message: "Comment pouvons-nous aider ?",
      submit: "Envoyer le message",
      sending: "Envoi…",
      success: "Merci — votre message est parti. Nous revenons vers vous.",
      error: "Une erreur est survenue. Écrivez-nous directement à",
      required: "Merci de remplir les champs obligatoires.",
      responsePromise: "Nous répondons sous un jour ouvré, avec un avis honnête.",
    },
  },

  booking: {
    eyebrow: "Réserver un appel",
    title: "30 minutes pour voir ce que l'IA peut automatiser chez vous",
    sub: "Vous racontez votre quotidien, on repère ce qui vous fait perdre du temps.",
    benefits: [
      "Vous repartez avec 2–3 idées concrètes — même si on ne travaille jamais ensemble",
      "On vous dit honnêtement si l'IA n'apporte rien dans votre cas",
    ],
    trust: ["Gratuit", "Sans engagement", "Visio ou téléphone"],
    step1: "1. Choisissez votre créneau",
    step2: "2. Vos coordonnées",
    pickFirst: "Choisissez d'abord un créneau ci-dessus",
    pickHint: "Horaires affichés dans votre fuseau.",
    noSlots:
      "Aucun créneau libre sous deux semaines — écrivez à contact@digitalm.eu et nous trouverons un moment.",
    name: "Nom",
    email: "E-mail",
    phone: "Téléphone",
    company: "Société (facultatif)",
    needs: "À quel sujet ? (facultatif)",
    preferred: "Créneaux souhaités",
    submit: "Confirmer la réservation",
    request: "Demander un appel",
    submitting: "Envoi…",
    change: "Changer d'horaire",
    successBooked: "C'est réservé — une invitation arrive dans votre boîte mail.",
    successRequested: "Merci — nous vous confirmerons un horaire par e-mail très vite.",
    error: "Une erreur est survenue. Écrivez à contact@digitalm.eu.",
  },

  legal: {
    notice: {
      title: "Mentions légales",
      updated: "Dernière mise à jour : juin 2026",
      placeholderNote: "",
      sections: [
        {
          heading: "Éditeur",
          body: "Ce site est édité par Digital M, nom commercial de Digital Management Ltd, société immatriculée en Angleterre et au pays de Galles sous le numéro 09457882, dont le siège social est situé au 67 Meridian Centre, Havant, Hampshire, PO9 1UN, Royaume-Uni.",
        },
        {
          heading: "Contact",
          body: "E-mail : contact@digitalm.eu",
        },
        {
          heading: "Hébergement",
          body: "Ce site est hébergé par OVH SAS, 2 rue Kellermann, 59100 Roubaix, France (ovhcloud.com).",
        },
        {
          heading: "Propriété intellectuelle",
          body: "Sauf mention contraire, le contenu, le design, la marque et les logos de ce site sont la propriété de Digital Management Ltd et ne peuvent être reproduits ou réutilisés sans autorisation écrite préalable.",
        },
        {
          heading: "Responsabilité",
          body: "Nous veillons à maintenir les informations de ce site exactes et à jour, sans pouvoir garantir l'absence d'erreurs ou d'omissions. Le site peut renvoyer vers des sites tiers sur lesquels nous n'avons aucun contrôle et dont nous déclinons la responsabilité.",
        },
      ],
    },
    privacy: {
      title: "Politique de confidentialité",
      updated: "Dernière mise à jour : juin 2026",
      placeholderNote: "",
      sections: [
        {
          heading: "Qui nous sommes",
          body: "Digital M (nom commercial de Digital Management Ltd), 67 Meridian Centre, Havant, Hampshire, PO9 1UN, Royaume-Uni, est responsable du traitement des données personnelles collectées via ce site. Pour toute demande, écrivez à contact@digitalm.eu.",
        },
        {
          heading: "Ce que nous collectons et pourquoi",
          body: "Si vous nous contactez via le formulaire ou par e-mail, nous traitons les informations que vous fournissez — en général votre nom, votre e-mail, votre société et votre message — uniquement pour vous répondre. Nous ne les utilisons pas à des fins marketing sans votre consentement.",
        },
        {
          heading: "Cookies et consentement",
          body: "Ce site utilise un seul cookie fonctionnel pour mémoriser la langue choisie, strictement nécessaire au fonctionnement du site. Nous n'utilisons aucun cookie publicitaire ou de suivi. Pour la mesure d'audience, nous utilisons Umami, un outil auto-hébergé sans cookie qui ne collecte que des statistiques anonymes et agrégées (pages vues, pays, type d'appareil), sans identifier les visiteurs — il est de ce fait exempté de consentement (CNIL). Tout autre cookie non essentiel ne serait déposé qu'avec votre consentement, via le bandeau cookies.",
        },
        {
          heading: "Assistant IA",
          body: "Si vous utilisez l'assistant du site, les messages que vous envoyez sont traités par un prestataire d'IA tiers pour générer une réponse. Merci de ne pas partager d'informations personnelles sensibles dans le chat.",
        },
        {
          heading: "Partage",
          body: "Nous ne partageons les données personnelles qu'avec les prestataires qui nous aident à fonctionner — notre fournisseur de messagerie, notre hébergeur (OVH) et notre prestataire d'IA pour l'assistant — et uniquement dans la mesure nécessaire. Nous ne vendons pas de données personnelles.",
        },
        {
          heading: "Conservation",
          body: "Nous conservons les messages de contact uniquement le temps nécessaire au traitement de votre demande et à son suivi, puis nous les supprimons. Les réponses au check-up numérique (formulaire de diagnostic) sont conservées au maximum 3 ans après notre dernier échange, avec une référence unique (ex. DM-X4K7Q) que vous pouvez mentionner pour demander leur suppression à tout moment. L'adresse IP associée, collectée au titre de notre intérêt légitime (prévention des abus), est supprimée sous 12 mois.",
        },
        {
          heading: "Vos droits",
          body: "Conformément au RGPD (UE) et au UK GDPR, vous pouvez demander l'accès, la rectification, la suppression ou la limitation du traitement de vos données personnelles, et vous y opposer. Écrivez à contact@digitalm.eu. Vous pouvez également introduire une réclamation auprès de la CNIL (cnil.fr) ou, au Royaume-Uni, de l'Information Commissioner's Office (ico.org.uk).",
        },
      ],
    },
  },
} satisfies SiteContent;
