/**
 * The copy for the rebuilt About page's section headings, used where the tenant has written none (`site.aboutPage.*`), EN and FR, kept OUT of
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
    eyebrow: "About us",
    storyTitle: "Our story",
    principlesTitle: "How we work",
    messageTitle: "A message from our leadership",
    officesTitle: "Our offices",
    sectorsTitle: "Who we move for",
    standardsTitle: "Our standards",
    policiesTitle: "Our policies",
} as const;

export const fr = {
    eyebrow: "À propos",
    storyTitle: "Notre histoire",
    principlesTitle: "Notre façon de travailler",
    messageTitle: "Un mot de notre direction",
    officesTitle: "Nos bureaux",
    sectorsTitle: "Pour qui nous transportons",
    standardsTitle: "Nos exigences",
    policiesTitle: "Nos politiques",
} as const;
