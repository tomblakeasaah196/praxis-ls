/**
 * The shared quote steps' copy — EN and FR (tenant review, meeting 6, PR 2):
 * the cards' "Transport" label and "Other services" link, the flows, the
 * hinterland direction, "Not sure" for the Incoterm, and the documents step.
 * Mounted at `site.quoteSteps`.
 *
 * ── WHY THIS IS NOT IN `lib/i18n-dict.ts` ─────────────────────────────────
 *
 * Every string in `i18n-dict.ts` is downloaded by every visitor to every page,
 * and these are read only by `components/quote/*`, the website's quote wizard
 * and the client portal's quote screens — all lazy chunks. In the dictionary
 * they pushed the first paint past its budget; here they travel with the
 * screens that show them, the split `site.careers.*` took first (13792).
 *
 * ── THE RULES THIS FILE KEEPS (the same as `careers-copy.ts`) ─────────────
 *
 *   1. No imports, no type annotations, no expressions: two object literals
 *      and an `as const`. `scripts/gen/gen-site-copy-catalogue.js` and
 *      `public-web/scripts/check-i18n.mjs` read it as data, which is why the
 *      registration lives in `quote-steps-i18n.ts` next door.
 *   2. Still tenant-overridable: the generator reads this file, and every key
 *      below is in `site-copy.generated.js` as `site.quoteSteps.*`.
 *
 * Title Case: each key is classified LABEL or PROSE under "site.quoteSteps"
 * in `scripts/gen/site-copy-case.js`, like every other site key.
 */

export const en = {
  transport: "Transport",
  otherServices: "Other Services",
  otherServicesHint: "Services the cards above do not describe.",
  flow: "Which way?",
  flowIMPORT: "Import",
  flowEXPORT: "Export",
  flowEND_TO_END: "End-to-End",
  flowINLAND: "Inland",
  flowHINTERLAND: "Hinterland",
  hinterland: "Into or out of the hinterland?",
  hinterlandINTO: "Into the Hinterland",
  hinterlandINTOHint: "Import transit, e.g. Douala → N’Djamena",
  hinterlandOUT_OF: "Out of the Hinterland",
  hinterlandOUT_OFHint: "Export transit, e.g. Bangui → Douala",
  errFlow: "Choose which way it goes.",
  errHinterland: "Say whether it goes into or out of the hinterland.",
  incotermNotSure: "Not sure",
  docsWhy: "With your commercial invoice the team prices faster and more accurately.",
  docsRequired: "Add at least one document to send the request.",
  docsOptional: "Optional — you can send the request without one.",
  docsKind: "What are you adding?",
  docCOMMERCIAL_INVOICE: "Commercial Invoice",
  docPROFORMA: "Proforma",
  docPACKING_LIST: "Packing List",
  docBL_AWB: "BL / AWB",
  docCARGO_PHOTOS: "Photos of the Goods",
  docOTHER: "Other",
  docRecommended: "Recommended",
  docsAdd: "Add a document",
  docsAddAs: "Add a {{kind}}",
  docsWas: "{{size}} before compression",
  docsPreparing: "Preparing…",
  docsSending: "Sending…",
  docsComplete: "Upload complete",
  docsRemove: "Remove {{name}}",
  docsTooBig: "That file is too large, even after compression.",
  docsTooMany: "That is as many documents as one request can take — send more once it is filed.",
  docsTotalTooBig: "Together the documents are too large. Send the most important ones first.",
  docsUnreadable: "That file could not be read. Try another copy of it.",
  errDocs: "Add at least one document — a commercial invoice is best.",
} as const;

export const fr = {
  transport: "Transport",
  otherServices: "Autres services",
  otherServicesHint: "Les services que les cartes ci-dessus ne décrivent pas.",
  flow: "Dans quel sens ?",
  flowIMPORT: "Import",
  flowEXPORT: "Export",
  flowEND_TO_END: "Porte-à-porte",
  flowINLAND: "Intérieur",
  flowHINTERLAND: "Hinterland",
  hinterland: "Vers l’hinterland ou depuis l’hinterland ?",
  hinterlandINTO: "Vers l’hinterland",
  hinterlandINTOHint: "Transit import, p. ex. Douala → N’Djamena",
  hinterlandOUT_OF: "Depuis l’hinterland",
  hinterlandOUT_OFHint: "Transit export, p. ex. Bangui → Douala",
  errFlow: "Choisissez le sens.",
  errHinterland: "Indiquez si la marchandise va vers l’hinterland ou en vient.",
  incotermNotSure: "Je ne sais pas",
  docsWhy: "Avec votre facture commerciale, l’équipe chiffre plus vite et plus juste.",
  docsRequired: "Ajoutez au moins un document pour envoyer la demande.",
  docsOptional: "Facultatif — vous pouvez envoyer la demande sans document.",
  docsKind: "Que joignez-vous ?",
  docCOMMERCIAL_INVOICE: "Facture commerciale",
  docPROFORMA: "Proforma",
  docPACKING_LIST: "Liste de colisage",
  docBL_AWB: "BL / LTA",
  docCARGO_PHOTOS: "Photos de la marchandise",
  docOTHER: "Autre",
  docRecommended: "Recommandé",
  docsAdd: "Ajouter un document",
  docsAddAs: "Ajouter : {{kind}}",
  docsWas: "{{size}} avant compression",
  docsPreparing: "Préparation…",
  docsSending: "Envoi…",
  docsComplete: "Envoi terminé",
  docsRemove: "Retirer {{name}}",
  docsTooBig: "Ce fichier est trop volumineux, même compressé.",
  docsTooMany: "C’est le maximum pour une demande — envoyez les autres une fois la demande enregistrée.",
  docsTotalTooBig: "Ensemble, les documents sont trop volumineux. Envoyez d’abord les plus importants.",
  docsUnreadable: "Ce fichier n’a pas pu être lu. Essayez une autre copie.",
  errDocs: "Ajoutez au moins un document — de préférence la facture commerciale.",
} as const;
