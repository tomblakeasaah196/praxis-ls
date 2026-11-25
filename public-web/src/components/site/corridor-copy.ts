/**
 * The corridor scene's copy (`site.corridor.*`), EN and FR, kept OUT of
 * `lib/i18n-dict.ts`.
 *
 * ── WHY THIS SUBTREE LIVES IN THE FEATURE ─────────────────────────────────
 *
 * `i18n-dict.ts` is in the ENTRY graph: every string in it is downloaded by
 * every visitor to every page. These keys, in two languages, are read only by
 * the corridor scene, its own lazy chunk and off unless the tenant turns the
 * corridors switch on. Website v2 (PR 1, the per-tenant switches and the
 * light theme) took first paint 0.9 kB past its budget once it landed beside
 * the message button, and `check-bundle.mjs` names this split as the lever to
 * pull before raising it. `site.careers.*` and `site.verify.*` took the same
 * route for the same reason.
 *
 * ── THE TWO RULES THIS FILE MUST KEEP (as verify-copy.ts states them) ─────
 *
 *   1. NO IMPORTS, NO TYPE ANNOTATIONS, NO EXPRESSIONS: two object literals
 *      and an `as const`. `scripts/gen/gen-site-copy-catalogue.js` and
 *      `public-web/scripts/check-i18n.mjs` read this file as data. The
 *      registration lives in `corridor-i18n.ts` next door for that reason.
 *   2. The keys are the dictionary's, unchanged: a tenant's override of
 *      `site.corridor.title` still applies (the overlay is merged first, and
 *      registration here never overwrites).
 */

export const en = {
    eyebrow: "The network",
    title: "The corridors we run",
    /* Two subtitles, because the scene has two honest states. The second one
       is shown when the ledger has nothing to publish, and it says so rather
       than letting an ornament be read as a route map. */
    sub: "Every lane here is one we have completed files on. Move through it.",
    subAbstract: "A picture of how a network fits together. Ours fills in as files complete.",
    figureLabel: "Corridor network — use the arrow keys to move between places",
    figureLabelAbstract: "An illustration of a network",
    /* Shown only where a public entity of the tenant's covers that country —
       "we are here", which is a stronger claim than "we deliver here". */
    present: "We are here",
    files: "files",
    tilt: "Move the scene by tilting your phone",
  } as const;

export const fr = {
    eyebrow: "Le réseau",
    title: "Les corridors que nous opérons",
    sub: "Chaque ligne ici est une ligne sur laquelle nous avons des dossiers clos. Parcourez-la.",
    subAbstract: "Une image de la façon dont un réseau s’assemble. Le nôtre se remplit à mesure que les dossiers se clôturent.",
    figureLabel: "Réseau de corridors — utilisez les flèches pour passer d’un lieu à l’autre",
    figureLabelAbstract: "Une illustration de réseau",
    present: "Nous y sommes implantés",
    files: "dossiers",
    tilt: "Inclinez votre téléphone pour parcourir la scène",
  } as const;
