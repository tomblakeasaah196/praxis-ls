/**
 * The tracking page's copy (`site.trackPage.*`), EN and FR, kept OUT of
 * `lib/i18n-dict.ts`.
 *
 * ── WHY THIS SUBTREE LIVES IN THE FEATURE ─────────────────────────────────
 *
 * `i18n-dict.ts` is in the ENTRY graph: every string in it is downloaded by
 * every visitor to every page. These ~40 keys, in two languages, are read only
 * on `/track`, a lazy route. Website v2 (PR 1, the per-tenant switches and the
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
 *      registration lives in `track-i18n.ts` next door for that reason.
 *   2. The keys are the dictionary's, unchanged: a tenant's override of
 *      `site.trackPage.title` still applies (the overlay is merged first, and
 *      registration here never overwrites).
 */

export const en = {
    title: "Track a shipment",
    titleMain: "Track a",
    titleAccent: "shipment",
    sub: "Enter the exact file reference shown on your shipment documents.",
    progress: "Progress",
    ofStages: "client-visible stages",
    current: "Current stage",
    timeline: "Shipment timeline",
    origin: "Origin",
    destination: "Destination",
    needAccount:
      "Only the stages your account manager makes visible appear here. For anything else, your portal shows the documents.",
    openPortal: "Open the client portal",
    service: "Service",
    lastUpdate: "Last update",
    lastUpdateNone: "No stage completed yet",
    closed: "All visible stages are complete",
    noStages: "This file has no client-visible stages yet",
    noStagesHint:
      "The desk publishes each stage as it is confirmed. Come back once the first one is marked, or open the portal for the documents already on file.",
    loading: "Looking up that reference…",
    searchAgain: "Try another reference",
    /* ── §8.1's verdict line ────────────────────────────────────────────
       Three statuses, written as an ANSWER rather than as a record's state.
       "IN_PROGRESS" is what the column says; "On the move" is what somebody
       who asked where their cargo is wants to read. */
    theAnswer: "Where this shipment is",
    verdictOpened: "Opened, not yet moving",
    verdictMoving: "On the move",
    verdictDone: "Delivered",
    /* Deliberately NOT "estimated arrival". There is no ETA in this API and no
       feed behind this page — this is the date the desk scheduled for the last
       outstanding stage, and it is labelled as exactly that. */
    scheduled: "Scheduled",
    noSchedule: "No stage has been scheduled on this file yet.",
    whereRef:
      "The reference is on the documents your account manager sent you — the booking confirmation, the transport order or the invoice.",
    noMatch: "No match",
    notFoundNotLost:
      "This says nothing about your cargo. It means no file on this site carries that exact reference — most often a digit read across from a photograph, or a reference from a different provider.",
    askDesk: "Ask the desk",
    tooMany: "Too many lookups",
    /* SHORT, because it sits at display size. `errors.loadFailed` is a full
       sentence and belongs under a title, not as one. */
    failedTitle: "The lookup did not go through",
  } as const;

export const fr = {
    title: "Suivre un envoi",
    titleMain: "Suivre un",
    titleAccent: "envoi",
    sub: "Saisissez la référence exacte indiquée sur vos documents d’expédition.",
    progress: "Avancement",
    ofStages: "étapes visibles par le client",
    current: "Étape en cours",
    timeline: "Chronologie de l’envoi",
    origin: "Origine",
    destination: "Destination",
    needAccount:
      "Seules les étapes rendues visibles par votre gestionnaire de compte apparaissent ici. Pour le reste, votre portail contient les documents.",
    openPortal: "Ouvrir le portail client",
    service: "Service",
    lastUpdate: "Dernière mise à jour",
    lastUpdateNone: "Aucune étape encore terminée",
    closed: "Toutes les étapes visibles sont terminées",
    noStages: "Ce dossier n’a pas encore d’étape visible par le client",
    noStagesHint:
      "Le bureau publie chaque étape à mesure qu’elle est confirmée. Revenez une fois la première validée, ou ouvrez le portail pour les documents déjà au dossier.",
    loading: "Recherche de cette référence…",
    searchAgain: "Essayer une autre référence",
    theAnswer: "Où se trouve cet envoi",
    verdictOpened: "Ouvert, pas encore en mouvement",
    verdictMoving: "En mouvement",
    verdictDone: "Livré",
    scheduled: "Prévu",
    noSchedule: "Aucune étape n’est encore planifiée sur ce dossier.",
    whereRef:
      "La référence figure sur les documents transmis par votre gestionnaire de compte : la confirmation de réservation, l’ordre de transport ou la facture.",
    noMatch: "Aucune correspondance",
    notFoundNotLost:
      "Cela ne dit rien de votre marchandise. Aucun dossier de ce site ne porte cette référence exacte — le plus souvent un chiffre relevé sur une photo, ou une référence provenant d’un autre prestataire.",
    askDesk: "Contacter le bureau",
    tooMany: "Trop de recherches",
    failedTitle: "La recherche n’a pas abouti",
  } as const;
