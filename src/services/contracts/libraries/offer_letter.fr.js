/**
 * LETTRE D'OFFRE D'EMPLOI — français.
 *
 * Une offre n'est pas un contrat. Elle est une proposition qui devient un
 * engagement par l'acceptation, et le contrat de travail proprement dit est
 * signé ensuite. Le document est donc rédigé comme une LETTRE et non comme un
 * instrument à articles numérotés : `sectionStyle: "letter"` le dit au moteur
 * de rendu, qui cesse alors de préfixer chaque section par « Article N ».
 *
 * Modèle — ne constitue pas un avis juridique : voir _shape.js.
 */
"use strict";
const { LIBRARY_VERSION } = require("./_shape");

module.exports = {
  key: "OFFER_LETTER",
  language: "fr",
  jurisdiction: "CM",
  version: LIBRARY_VERSION,
  sectionStyle: "letter",
  title: "OFFRE D'EMPLOI",

  preamble: {
    heading: "",
    body: [
      "{{doc.place_signed}}, le {{doc.date_signed}}",
      "",
      "{{employee.civility}} {{employee.full_name}}",
      "{{employee.residence}}",
      "",
      "Objet : Offre d'emploi — {{term.job_title}}",
      "",
      "{{employee.civility}},",
    ].join("\n"),
  },

  /**
   * Optional tokens THIS document cannot do without — see clause-tokens.js.
   * An offer that does not say when it lapses, or what probation it carries,
   * is not an offer a candidate can act on.
   */
  requires: ["term.offer_valid_until", "term.probation_months"],

  articles: [
    {
      key: "offer",
      heading: "L'OFFRE",
      basis: "Code du Travail, art. 23 — la formation du contrat suppose l'accord des parties sur l'emploi et la rémunération",
      aiEditable: false,
      body: [
        "À l'issue de notre processus de recrutement, nous avons le plaisir de vous proposer le poste de {{term.job_title}} au sein de {{entity.legal_name}}.",
        "Cette offre porte sur un engagement prenant effet le {{term.start_date}}, à {{term.place_of_work}}.",
      ].join("\n\n"),
    },
    {
      key: "terms",
      heading: "LES CONDITIONS PROPOSÉES",
      basis: "Code du Travail, art. 61 à 68 (salaire) et art. 80 (durée du travail) — les éléments essentiels doivent être portés à la connaissance du candidat avant l'engagement",
      aiEditable: false,
      body: [
        "Rémunération brute mensuelle :",
        "{{pay.allowance_lines}}",
        "Total brut mensuel : {{pay.gross}} {{pay.currency}}, payé par {{pay.method}}.",
        "Horaires : {{term.working_hours}}, dans la limite de {{term.weekly_hours}} heures par semaine.",
        "Une période d'essai de {{term.probation_months}} mois sera stipulée au contrat, conformément à l'article 28 du Code du Travail.",
      ].join("\n\n"),
    },
    {
      key: "conditions",
      heading: "CE QUI RESTE À FAIRE",
      basis: "Liberté contractuelle — l'offre peut être assortie de conditions ; le contrat définitif est l'instrument qui engage",
      aiEditable: false,
      body: [
        "La présente offre est valable jusqu'au {{term.offer_valid_until}} et est subordonnée à la production des pièces justificatives usuelles (pièce d'identité, diplômes, attestations) ainsi qu'à la signature du contrat de travail.",
        "Elle ne constitue pas un contrat de travail. Le contrat vous sera remis pour signature à votre acceptation de la présente.",
      ].join("\n\n"),
    },
    {
      key: "acceptance",
      heading: "VOTRE RÉPONSE",
      basis: "Formation du contrat par l'acceptation",
      aiEditable: false,
      body: [
        "Pour accepter cette offre, nous vous prions de bien vouloir retourner un exemplaire de la présente lettre, revêtu de votre signature et précédé de la mention « Lu et approuvé, bon pour accord ».",
        "Nous nous réjouissons à la perspective de vous accueillir au sein de nos équipes.",
        "Veuillez agréer, {{employee.civility}}, l'expression de nos salutations distinguées.",
      ].join("\n\n"),
    },
  ],

  closing: {
    body: "",
    signatures: [
      { party: "EMPLOYER", label: "POUR L'EMPLOYEUR", mention: "{{rep.name}}, {{rep.title}} — Pour {{entity.legal_name}}" },
      { party: "EMPLOYEE", label: "BON POUR ACCORD", mention: "(Précédé de la mention « Lu et approuvé, bon pour accord »)" },
    ],
  },
};
