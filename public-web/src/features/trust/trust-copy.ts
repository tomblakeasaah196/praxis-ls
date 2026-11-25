/**
 * The copy for Trust and Compliance and the published documents (`site.trust.*`), EN and FR, kept OUT of
 * `lib/i18n-dict.ts` (PR 4, 14660).
 *
 * `i18n-dict.ts` is in the ENTRY graph, so every string in it is downloaded
 * by every visitor to every page; these are read only on lazy routes, and
 * putting them there took the first paint past its budget. The same move
 * `features/tracking/track-copy.ts` made, with the same two rules:
 *
 *   1. NO IMPORTS, NO TYPE ANNOTATIONS, NO EXPRESSIONS: two object literals
 *      and an `as const`. The catalogue generator and `check-i18n` read this
 *      file as data; the registration is in the `-i18n.ts` file next door.
 *   2. The keys are the dictionary's: a tenant's copy override still
 *      applies, because registration never overwrites.
 */

export const en = {
    title: "Trust and compliance",
    eyebrow: "How we are run",
    sub: "The policies we work to, published in full and available as PDF.",
    policiesTitle: "Policies",
    legalTitle: "Legal",
    credentialsTitle: "Certifications and licences",
    membershipsTitle: "Memberships",
    version: "Version",
    effective: "Effective",
    approvedBy: "Approved by",
    published: "Published",
    allDocuments: "All documents",
    notFound: "This document is not published.",
    language: "Language",
} as const;

export const fr = {
    title: "Confiance et conformité",
    eyebrow: "Notre gouvernance",
    sub: "Les politiques que nous appliquons, publiées en entier et disponibles en PDF.",
    policiesTitle: "Politiques",
    legalTitle: "Mentions légales",
    credentialsTitle: "Certifications et licences",
    membershipsTitle: "Réseaux",
    version: "Version",
    effective: "En vigueur le",
    approvedBy: "Approuvée par",
    published: "Publiée",
    allDocuments: "Tous les documents",
    notFound: "Ce document n’est pas publié.",
    language: "Langue",
} as const;
