/**
 * The copy for the brand layer's shared furniture: the client logo band, memberships, the two calls to action, the PDF link (`site.brand.*`), EN and FR, kept OUT of
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
    clientsCaption: "Organisations whose cargo we have moved",
    memberOf: "Member of {{name}}",
    memberNumber: "Member no.",
    requestQuote: "Request a quote",
    talkToUs: "Talk to us",
    forPartners: "For partners",
    downloadPdf: "Download PDF",
    read: "Read",
    phone: "Phone",
    email: "Email",
} as const;

export const fr = {
    clientsCaption: "Les organisations dont nous avons transporté le fret",
    memberOf: "Membre de {{name}}",
    memberNumber: "N° de membre",
    requestQuote: "Demander un devis",
    talkToUs: "Nous parler",
    forPartners: "Partenaires",
    downloadPdf: "Télécharger le PDF",
    read: "Lire",
    phone: "Téléphone",
    email: "E-mail",
} as const;
