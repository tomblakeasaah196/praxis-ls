/**
 * The shared Company Profile page's own words — EN and FR, kept OUT of
 * `lib/i18n-dict.ts` for the reason `verify-copy.ts` gives: the entry
 * dictionary is downloaded by every visitor, and these few keys are read only
 * by someone holding a profile link.
 *
 * Everything the profile SAYS (section titles, figures, sentences) arrives
 * from the server already in the reader's language, the same object the PDF is
 * printed from. This file holds only the page furniture around it.
 *
 * NO IMPORTS, NO TYPE ANNOTATIONS, NO EXPRESSIONS: two object literals and an
 * `as const`, read as data by `scripts/gen/gen-site-copy-catalogue.js` and
 * `public-web/scripts/check-i18n.mjs`. The registration is `profile-i18n.ts`.
 */

export const en = {
  title: "Company profile",
  download: "Download PDF",
  print: "Print",
  langSwitch: "Language",
  version: "Version {{n}}",
  unavailable: "This link is no longer valid.",
  unavailableHint: "Shared profiles expire. Ask your contact to send a fresh link.",
} as const;

export const fr = {
  title: "Profil d’entreprise",
  download: "Télécharger le PDF",
  print: "Imprimer",
  langSwitch: "Langue",
  version: "Version {{n}}",
  unavailable: "Ce lien n’est plus valide.",
  unavailableHint: "Les profils partagés expirent. Demandez à votre contact un nouveau lien.",
} as const;
