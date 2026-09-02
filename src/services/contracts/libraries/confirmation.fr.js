/**
 * LETTRE DE CONFIRMATION À L'ISSUE DE LA PÉRIODE D'ESSAI — français.
 *
 * L'article 28 du Code du Travail fait de l'essai une période à l'issue de
 * laquelle l'engagement devient définitif. Cette lettre est l'acte qui le
 * constate. Elle n'est pas un nouveau contrat : elle confirme celui qui existe,
 * et c'est pourquoi elle ne réénonce ni les fonctions ni la rémunération sauf
 * changement, qui doit alors faire l'objet d'un avenant.
 *
 * Modèle — ne constitue pas un avis juridique : voir _shape.js.
 */
"use strict";
const { LIBRARY_VERSION } = require("./_shape");

module.exports = {
  key: "CONFIRMATION",
  language: "fr",
  jurisdiction: "CM",
  version: LIBRARY_VERSION,
  sectionStyle: "letter",
  title: "CONFIRMATION D'EMPLOI",

  preamble: {
    heading: "",
    body: [
      "{{doc.place_signed}}, le {{doc.date_signed}}",
      "",
      "{{employee.civility}} {{employee.full_name}}",
      "Matricule : {{employee.staff_no}}",
      "",
      "Objet : Confirmation à l'issue de la période d'essai",
      "",
      "{{employee.civility}},",
    ].join("\n"),
  },

  /**
   * Optional tokens THIS document cannot do without — see clause-tokens.js.
   * This letter exists to say a probation ended. Both dates are its subject.
   */
  requires: ["term.probation_months", "term.probation_end_date"],

  articles: [
    {
      key: "confirmation",
      heading: "CONFIRMATION",
      basis: "Code du Travail, art. 28 — à l'expiration de la période d'essai, l'engagement devient définitif",
      aiEditable: false,
      body: [
        "Vous avez été engagé(e) au sein de {{entity.legal_name}} en qualité de {{term.job_title}} à compter du {{term.start_date}}, sous réserve d'une période d'essai de {{term.probation_months}} mois.",
        "Nous avons le plaisir de vous informer que, au vu de vos états de service durant cette période, votre engagement est confirmé à compter du {{term.probation_end_date}}.",
      ].join("\n\n"),
    },
    {
      key: "effects",
      heading: "CE QUE CELA CHANGE",
      basis: "Code du Travail, art. 28 et art. 34 — l'essai prend fin, le régime du préavis de droit commun s'applique",
      aiEditable: false,
      body: [
        "Votre contrat se poursuit aux conditions convenues, sans interruption d'ancienneté, celle-ci étant décomptée depuis le {{term.start_date}}.",
        "La période d'essai étant achevée, toute rupture ultérieure du contrat par l'une ou l'autre des Parties est soumise au préavis prévu par l'article 34 du Code du Travail et par la réglementation applicable à votre catégorie professionnelle.",
      ].join("\n\n"),
    },
    {
      key: "closing_words",
      heading: "",
      basis: "Formule de politesse — sans portée juridique propre",
      aiEditable: false,
      body: [
        "Nous vous félicitons pour votre intégration et vous souhaitons plein succès dans la poursuite de vos fonctions.",
        "Veuillez agréer, {{employee.civility}}, l'expression de nos salutations distinguées.",
      ].join("\n\n"),
    },
  ],

  closing: {
    body: "",
    signatures: [
      { party: "EMPLOYER", label: "POUR L'EMPLOYEUR", mention: "{{rep.name}}, {{rep.title}} — Pour {{entity.legal_name}}" },
      { party: "EMPLOYEE", label: "RÉCEPTION", mention: "(Précédé de la mention « Reçu le »)" },
    ],
  },
};
