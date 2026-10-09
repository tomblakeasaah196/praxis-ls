/**
 * The verification portal's copy — EN and FR, kept OUT of `lib/i18n-dict.ts`.
 *
 * ── WHY THIS SUBTREE LIVES IN THE FEATURE AND NOT IN THE DICTIONARY ───────
 *
 * `i18n-dict.ts` is in the ENTRY graph: every string in it is downloaded by
 * everybody, including the visitor who reads the home page and leaves. That is
 * the right trade for `site.nav.*` and `site.footer.*`, which every page
 * renders. It is the wrong one for ~46 keys of legal-adjacent prose, in two
 * languages, that only the verification portal can ever show — and it became
 * the wrong one loudly: putting them in the dictionary pushed first paint
 * 1.1 kB past its budget and `check-bundle.mjs` failed, which is exactly the
 * split it says the next raise should be spent on instead. `site.careers.*`
 * was the first to take this route, for the same reason.
 *
 * The audience makes it starker than careers. A visitor who came to track a
 * container has no use for the words a customs officer reads at a border post,
 * and this app's audience is a phone on a metered connection in Douala.
 *
 * ── THE TWO RULES THIS FILE MUST KEEP ─────────────────────────────────────
 *
 *   1. NO IMPORTS, NO TYPE ANNOTATIONS, NO EXPRESSIONS. Two object literals and
 *      an `as const`, exactly like `i18n-dict.ts`. Both
 *      `scripts/gen/gen-site-copy-catalogue.js` and
 *      `public-web/scripts/check-i18n.mjs` read this file as data, and the
 *      generator EVALUATES it and refuses a file that has grown an import.
 *      That refusal is why the registration lives in `verify-i18n.ts` next door.
 *   2. EVERY SENTENCE WRITTEN OUT WHOLE, never assembled from fragments. A
 *      legal-adjacent page is read by people who will quote it: a customs
 *      officer, an auditor, a buyer's lawyer three years from now. A sentence
 *      stitched from interpolated clauses cannot be checked by whoever has to
 *      stand behind it.
 *
 * Guide §5.4, §5.7. French is sentence case and uses ’ and the narrow no-break
 * space before : ; ! ? — `check:i18n` enforces both.
 */

export const en = {
    title: "Document verification",
    lead:
      "This document carries an electronic signature. Here is what it attests to.",
    testEnvTitle: "Test-environment document",
    testEnvBody:
      "This code was minted in the issuer's test environment. The check below is genuine, but the document itself is not a real document.",
    enterTitle: "Verify a document",
    enterLead:
      "Enter the twelve-character code printed beneath the QR code on the document.",
    codeLabel: "Verification code",
    submit: "Verify",
    checking: "Checking…",
    notFoundTitle: "No verification matches that code",
    notFoundBody:
      "Check the twelve characters printed beneath the QR code. If the code is right and this page persists, contact the issuer of the document directly.",
    revokedTitle: "This signature has been revoked",
    revokedBody:
      "It was genuinely applied, and then withdrawn by the issuer. The document should no longer be treated as signed.",
    amendedTitle: "This document has changed since it was signed",
    amendedBody:
      "The signature below is genuine, but it no longer covers what the document says today. What changed is listed below.",
    revokedReasonLabel: "Reason for revocation",
    validTitle: "Signature verified",
    signatureH: "The signature",
    signedBy: "Signed by",
    onBehalf: "On behalf of",
    internal: "the issuing company",
    external: "the counterparty",
    method: "Method",
    signingWindow: "Signing window",
    reason: "Reason",
    signedAt: "Signed",
    network: "Network",
    device: "Device",
    asSigned: "The document as signed",
    asSignedNote:
      "These details were frozen at the moment of signing. They never change, even if the file moves on afterwards.",
    changed: "What has changed since",
    noSummary:
      "This kind of document does not publish a summary. The signature and the checks above still stand.",
    issuer: "Issued by",
    code: "Code",
    contentHash: "Content fingerprint",
    howTitle: "How this verification works",
    howLink: "How is this verified?",
    close: "Close",
    identityH: "Identity",
    identityB:
      "Who signed, and how they proved it. A name confirmed by an authenticated account and a name simply declared are two different claims, and this page tells you which one you are reading.",
    integrityH: "Integrity",
    integrityB:
      "Two fingerprints, two questions. The first covers the document’s contents, the amounts, the parties and the references, and answers whether it changed after signing. The second covers the file itself and confirms it is the exact file that was issued.",
    traceH: "Traceability",
    traceB:
      "Every signature and every verification is written to an append-only record kept by the issuer. Your visit today is part of it.",
    privacy:
      "Verifications of this document are logged, including the network address they came from.",
    langSwitch: "Français",
} as const;

export const fr = {
    title: "Vérification de document",
    lead:
      "Ce document porte une signature électronique. Voici ce qu’elle atteste.",
    testEnvTitle: "Document d’environnement de test",
    testEnvBody:
      "Ce code a été émis dans l’environnement de test de l’émetteur. Le contrôle ci-dessous est authentique, mais le document lui-même n’est pas un document réel.",
    enterTitle: "Vérifier un document",
    enterLead:
      "Saisissez le code à douze caractères imprimé sous le QR code du document.",
    codeLabel: "Code de vérification",
    submit: "Vérifier",
    checking: "Vérification…",
    notFoundTitle: "Aucune vérification ne correspond à ce code",
    notFoundBody:
      "Vérifiez les douze caractères imprimés sous le QR code. Si le code est correct et que cette page persiste, contactez directement l’émetteur du document.",
    revokedTitle: "Cette signature a été révoquée",
    revokedBody:
      "Elle a bien été apposée, puis retirée par l’émetteur. Le document ne doit plus être considéré comme signé.",
    amendedTitle: "Ce document a changé depuis sa signature",
    amendedBody:
      "La signature ci-dessous est authentique, mais elle ne couvre plus ce que le document dit aujourd’hui. Ce qui a changé est indiqué ci-dessous.",
    revokedReasonLabel: "Motif de la révocation",
    validTitle: "Signature vérifiée",
    signatureH: "La signature",
    signedBy: "Signé par",
    onBehalf: "Pour le compte de",
    internal: "l’entreprise émettrice",
    external: "la contrepartie",
    method: "Méthode",
    signingWindow: "Fenêtre de signature",
    reason: "Motif",
    signedAt: "Date de signature",
    network: "Réseau",
    device: "Appareil",
    asSigned: "Le document tel que signé",
    asSignedNote:
      "Ces informations sont figées au moment de la signature. Elles ne changent jamais, même si le dossier évolue ensuite.",
    changed: "Ce qui a changé depuis",
    noSummary:
      "Ce type de document ne publie pas de résumé. La signature et les contrôles ci-dessus restent valables.",
    issuer: "Émetteur",
    code: "Code",
    contentHash: "Empreinte du contenu",
    howTitle: "Comment cette vérification fonctionne",
    howLink: "Comment cela est-il vérifié ?",
    close: "Fermer",
    identityH: "Identité",
    identityB:
      "Qui a signé, et comment cette personne l’a prouvé. Un nom confirmé par un compte authentifié et un nom simplement déclaré sont deux affirmations différentes, et cette page indique laquelle vous lisez.",
    integrityH: "Intégrité",
    integrityB:
      "Deux empreintes, deux questions. La première porte sur le contenu du document, les montants, les parties et les références, et permet de savoir s’il a été modifié après signature. La seconde porte sur le fichier lui-même et confirme qu’il s’agit exactement du fichier émis.",
    traceH: "Traçabilité",
    traceB:
      "Chaque signature et chaque vérification sont inscrites dans un registre en ajout seul, conservé par l’émetteur. Votre consultation d’aujourd’hui en fait partie.",
    privacy:
      "Les vérifications de ce document sont enregistrées, y compris l’adresse réseau d’où elles proviennent.",
    langSwitch: "English",
} as const;
