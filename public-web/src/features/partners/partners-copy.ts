/**
 * The copy for the For Partners page (`site.partnersPage.*`), EN and FR, kept OUT of
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
    title: "For partners",
    eyebrow: "Agents and forwarders",
    sub: "What we handle, where we handle it, and how to put a shipment in our hands.",
    officesTitle: "Our offices",
    contactsTitle: "Named contacts",
    membershipsTitle: "Memberships",
    formTitle: "Propose a partnership",
    formLead: "Tell us which lanes you cover and what you would like to move with us.",
} as const;

export const fr = {
    title: "Partenaires",
    eyebrow: "Agents et transitaires",
    sub: "Ce que nous traitons, où nous le traitons, et comment nous confier une expédition.",
    officesTitle: "Nos bureaux",
    contactsTitle: "Vos interlocuteurs",
    membershipsTitle: "Réseaux",
    formTitle: "Proposer un partenariat",
    formLead: "Dites-nous quelles lignes vous couvrez et ce que vous souhaitez acheminer avec nous.",
} as const;
