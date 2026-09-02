/**
 * LETTRE DE RUPTURE DU CONTRAT DE TRAVAIL — français.
 *
 * C'est la lettre la plus exposée de la bibliothèque. Trois exigences en font
 * la structure :
 *
 *   1. LE MOTIF DOIT ÊTRE ÉNONCÉ. Une rupture notifiée sans motif est une
 *      rupture abusive. Le motif figure donc dans une section propre, et
 *      `{{term.notice_days}}` n'y supplée pas.
 *   2. LE PRÉAVIS EST DÛ, sauf faute lourde (art. 39). Sa durée dépend de la
 *      catégorie professionnelle et de l'ancienneté — elle est reprise du
 *      contrat, jamais devinée.
 *   3. LE SOLDE DE TOUT COMPTE EST UN DROIT. Certificat de travail, reçu pour
 *      solde de tout compte et indemnité de congé payé sont énumérés parce
 *      qu'ils sont dus, pas parce qu'ils sont d'usage.
 *
 * [VERIFY] La rupture pour motif économique (art. 40) suppose une procédure
 * préalable — information des délégués du personnel et de l'inspecteur du
 * travail — que cette lettre ne remplace pas. À faire valider par le conseil du
 * tenant avant tout licenciement collectif.
 *
 * Modèle — ne constitue pas un avis juridique : voir _shape.js.
 */
"use strict";
const { LIBRARY_VERSION } = require("./_shape");

module.exports = {
  key: "TERMINATION",
  language: "fr",
  jurisdiction: "CM",
  version: LIBRARY_VERSION,
  sectionStyle: "letter",
  title: "NOTIFICATION DE RUPTURE DU CONTRAT DE TRAVAIL",

  preamble: {
    heading: "",
    body: [
      "{{doc.place_signed}}, le {{doc.date_signed}}",
      "",
      "{{employee.civility}} {{employee.full_name}}",
      "Matricule : {{employee.staff_no}}",
      "{{employee.residence}}",
      "",
      "Objet : Notification de rupture du contrat de travail",
      "Lettre remise en main propre contre décharge ou adressée par voie recommandée",
      "",
      "{{employee.civility}},",
    ].join("\n"),
  },

  /**
   * Optional tokens THIS document cannot do without — see clause-tokens.js.
   * Art. 34 makes the notice due the substance of the notification. A
   * termination letter silent on it is the letter that ends up in court.
   */
  requires: ["term.notice_days"],

  articles: [
    {
      key: "notification",
      heading: "NOTIFICATION",
      basis: "Code du Travail, art. 34 — la rupture doit être notifiée par écrit à l'autre partie",
      aiEditable: false,
      body: [
        "Nous vous notifions par la présente la rupture du contrat de travail qui nous lie depuis le {{term.start_date}}, dans lequel vous occupiez les fonctions de {{term.job_title}} au sein de {{entity.legal_name}}.",
      ].join("\n\n"),
    },
    {
      key: "grounds",
      heading: "MOTIF DE LA RUPTURE",
      basis: "Code du Travail, art. 34 et art. 39 — l'énonciation du motif conditionne le caractère légitime de la rupture ; l'absence de motif la rend abusive",
      // The one section a model may help phrase — the facts of a particular case
      // are prose. It may never decide the ground, only express the one given.
      aiEditable: true,
      body: [
        "Le motif de cette rupture est le suivant : [à compléter — énoncer les faits précis, datés et vérifiables].",
        "Ce motif vous a été exposé lors de l'entretien préalable qui s'est tenu à cet effet.",
      ].join("\n\n"),
    },
    {
      key: "notice",
      heading: "PRÉAVIS",
      basis: "Code du Travail, art. 34 — durée du préavis fixée selon la catégorie professionnelle et l'ancienneté ; art. 39 — la faute lourde prive du préavis",
      aiEditable: false,
      body: [
        "Vous êtes tenu(e) d'effectuer un préavis de {{term.notice_days}} jours, courant à compter de la première présentation de la présente lettre, sauf dispense expresse de notre part.",
        "En cas de rupture pour faute lourde au sens de l'article 39 du Code du Travail, la rupture intervient sans préavis ni indemnité, ce qui vous serait alors notifié expressément.",
      ].join("\n\n"),
    },
    {
      key: "settlement",
      heading: "SOLDE DE TOUT COMPTE ET DOCUMENTS",
      basis: "Code du Travail, art. 36 (indemnité de licenciement), art. 89 et 90 (indemnité compensatrice de congé payé) et art. 43 (certificat de travail)",
      aiEditable: false,
      body: [
        "À la date d'effet de la rupture, vous seront remis :",
        "— votre certificat de travail, conformément à l'article 43 du Code du Travail ;",
        "— le décompte de votre solde de tout compte, comprenant le salaire dû jusqu'à la date d'effet, l'indemnité compensatrice de congé payé au titre des congés non pris, et, le cas échéant, l'indemnité de licenciement prévue par l'article 36 du Code du Travail ;",
        "— l'attestation destinée à la Caisse Nationale de Prévoyance Sociale.",
        "Nous vous prions de bien vouloir restituer, au plus tard à la date d'effet, l'ensemble du matériel et des documents appartenant à l'entreprise.",
      ].join("\n"),
    },
    {
      key: "recourse",
      heading: "VOIES DE RECOURS",
      basis: "Code du Travail, art. 130 et suivants — tentative de conciliation devant l'inspecteur du travail préalable à la saisine du tribunal",
      aiEditable: false,
      body: [
        "Si vous contestez cette décision, vous disposez de la faculté de saisir l'Inspecteur du Travail du ressort aux fins de conciliation, préalablement à toute saisine du tribunal compétent de {{doc.jurisdiction_city}}.",
        "Veuillez agréer, {{employee.civility}}, l'expression de nos salutations distinguées.",
      ].join("\n\n"),
    },
  ],

  closing: {
    body: "",
    signatures: [
      { party: "EMPLOYER", label: "POUR L'EMPLOYEUR", mention: "{{rep.name}}, {{rep.title}} — Pour {{entity.legal_name}}" },
      { party: "EMPLOYEE", label: "DÉCHARGE", mention: "(Précédé de la mention « Reçu le », date et signature)" },
    ],
  },
};
