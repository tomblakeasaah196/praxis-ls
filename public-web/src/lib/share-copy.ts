/**
 * Link previews (`site.share.*`), EN and FR, kept OUT of `lib/i18n-dict.ts`.
 *
 * The title and sentence each built-in page carries when somebody shares it
 * (WhatsApp, LinkedIn, Slack, a search result) and in the browser tab. The
 * server reads the same keys, from the catalogue and the tenant's Wording, for
 * the page's head and the share card (src/shared/http/public-head-share.js).
 * `siteName` ships as `{{name}}`, the brand name from Appearance; a tenant
 * whose registered name carries its legal form writes the name people say.
 *
 * ── WHY THIS LIVES OUTSIDE THE ENTRY DICTIONARY ───────────────────────────
 *
 * Every route reads these, but only once its own lazy chunk has loaded, and
 * `use-share-meta.ts` (itself a shared lazy chunk) registers them as it is
 * evaluated. In the entry dictionary they cost every visitor 0.8 kB of first
 * paint for a tab title nobody sees before the page arrives.
 *
 * ── THE TWO RULES (as `features/tracking/track-copy.ts` states them) ─────
 *
 *   1. NO IMPORTS, NO TYPE ANNOTATIONS, NO EXPRESSIONS: two object literals
 *      and an `as const`. The catalogue generator and `check-i18n.mjs` read
 *      this file as data.
 *   2. The keys are the dictionary's: a tenant's override still applies (the
 *      overlay is merged first, and registration never overwrites).
 */

export const en = {
    siteName: "{{name}}",
    homeTitle: "Freight That Moves Your Business Forward",
    homeDescription: "Sea, air and road freight with one team, one platform and every shipment in view.",
    aboutTitle: "About Us",
    aboutDescription: "Who we are, where we work and how we run every file.",
    servicesTitle: "Services",
    servicesDescription: "What we handle, end to end, by sea, air and land.",
    insightsTitle: "Insights",
    insightsDescription: "Notes from the desk on customs, freight and the routes we work.",
    trackTitle: "Track a Shipment",
    trackDescription: "Follow your shipment with the file reference on your documents.",
    quoteTitle: "Request a Quote",
    quoteDescription: "Tell us what you are shipping and where, and we come back with a price.",
    contactTitle: "Contact Us",
    contactDescription: "A question, a partnership or a shipment going wrong: this reaches the desk that handles it.",
    careersTitle: "Careers",
    careersDescription: "The roles we are hiring for right now.",
    partnersTitle: "For Partners",
    partnersDescription: "How agents and forwarders work with us, and what we hold ourselves to.",
    trustTitle: "Trust and Compliance",
    trustDescription: "Our policies, certificates and the standards we answer to.",
    portfolioTitle: "Our Work",
    portfolioDescription: "Operations we have run, and how they went.",
    verifyTitle: "Verify a Document",
    verifyDescription: "Check that a document we issued is genuine.",
} as const;

export const fr = {
    siteName: "{{name}}",
    homeTitle: "Le fret qui fait avancer votre entreprise",
    homeDescription: "Fret maritime, aérien et routier avec une seule équipe, une seule plateforme et chaque envoi en vue.",
    aboutTitle: "À propos",
    aboutDescription: "Qui nous sommes, où nous travaillons et comment nous menons chaque dossier.",
    servicesTitle: "Services",
    servicesDescription: "Ce que nous prenons en charge, de bout en bout, par mer, air et terre.",
    insightsTitle: "Analyses",
    insightsDescription: "Les notes du bureau sur la douane, le fret et les routes que nous travaillons.",
    trackTitle: "Suivre un envoi",
    trackDescription: "Suivez votre envoi avec la référence de dossier indiquée sur vos documents.",
    quoteTitle: "Demander un devis",
    quoteDescription: "Dites-nous ce que vous expédiez et où, et nous revenons vers vous avec un prix.",
    contactTitle: "Nous contacter",
    contactDescription: "Une question, un partenariat ou un envoi qui déraille : ce message arrive au bureau qui s’en occupe.",
    careersTitle: "Carrières",
    careersDescription: "Les postes ouverts en ce moment.",
    partnersTitle: "Partenaires",
    partnersDescription: "Comment les agents et transitaires travaillent avec nous, et ce à quoi nous nous engageons.",
    trustTitle: "Confiance et conformité",
    trustDescription: "Nos politiques, nos certificats et les normes auxquelles nous répondons.",
    portfolioTitle: "Nos réalisations",
    portfolioDescription: "Les opérations que nous avons menées, et comment elles se sont passées.",
    verifyTitle: "Vérifier un document",
    verifyDescription: "Vérifiez qu’un document que nous avons émis est authentique.",
} as const;
