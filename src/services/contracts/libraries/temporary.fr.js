/**
 * CONTRAT DE TRAVAIL OCCASIONNEL OU SAISONNIER — français.
 *
 * Distinct de l'intérim : l'intérim remplace une personne, l'occasionnel répond
 * à une tâche non durable et le saisonnier revient avec la saison. L'article
 * 25(4) du Code du Travail les traite comme des catégories propres, avec leurs
 * propres durées.
 *
 * [VERIFY] Les durées maximales du contrat occasionnel et du contrat saisonnier,
 * et les conditions de leur renouvellement, sont à confirmer par le conseil du
 * tenant contre le texte en vigueur.
 *
 * Modèle — ne constitue pas un avis juridique : voir _shape.js.
 */
"use strict";
const { LIBRARY_VERSION } = require("./_shape");

module.exports = {
  key: "TEMPORARY",
  language: "fr",
  jurisdiction: "CM",
  version: LIBRARY_VERSION,
  title: "CONTRAT DE TRAVAIL OCCASIONNEL OU SAISONNIER",

  preamble: {
    heading: "ENTRE LES SOUSSIGNÉS :",
    body: [
      "1. La Société {{entity.legal_name}}, {{entity.legal_form}}, dont le siège social est situé au {{entity.address}}, Boîte Postale : {{entity.po_box}}, {{entity.country}}, Téléphone : {{entity.phone}}, Email : {{entity.email}}, représentée par {{rep.name}}, agissant en qualité de {{rep.title}},",
      "Ci-après désignée « L'Employeur »,",
      "D'UNE PART,",
      "",
      "ET :",
      "",
      "2. {{employee.civility}} {{employee.full_name}}{{employee.maiden_clause}}, né(e) le {{employee.birth_date}} à {{employee.birth_place}}, titulaire de la {{employee.id_type}} N° {{employee.id_number}} délivrée le {{employee.id_issued_on}} à {{employee.id_issued_at}}, demeurant à {{employee.residence}}, et de nationalité {{employee.nationality}},",
      "Ci-après désigné(e) « L'Employé(e) »,",
      "D'AUTRE PART.",
      "",
      "IL A ÉTÉ CONVENU ET ARRÊTÉ CE QUI SUIT :",
    ].join("\n"),
  },

  /**
   * Optional tokens THIS document cannot do without — see clause-tokens.js.
   * Art. 25(4) allows the occasional/seasonal engagement precisely because it
   * ends. The end date is the qualification, not a detail.
   */
  requires: ["term.end_date", "term.duration_months"],

  articles: [
    {
      key: "object_and_term",
      heading: "OBJET, ENGAGEMENT ET TERME",
      basis: "Code du Travail, art. 25(4) — contrats occasionnel et saisonnier ; art. 26 — requalification en CDI si la relation se poursuit au-delà du terme. [VERIFY] Durées maximales à confirmer.",
      aiEditable: false,
      body: [
        "La Société {{entity.legal_name}} engage {{employee.civility}} {{employee.full_name}} à compter du {{term.start_date}} pour l'exécution d'une tâche présentant un caractère occasionnel ou saisonnier, non liée à l'activité normale et permanente de l'entreprise.",
        "Le présent contrat prend fin le {{term.end_date}}, soit une durée de {{term.duration_months}} mois, à l'achèvement de la tâche pour laquelle il a été conclu.",
        "Conformément à l'article 26 du Code du Travail, si la relation de travail se poursuit au-delà du terme sans opposition des Parties, le contrat devient un contrat à durée indéterminée.",
        "Le matricule {{employee.staff_no}} lui est attribué.",
      ].join("\n\n"),
    },
    {
      key: "duties",
      heading: "NATURE DE LA TÂCHE",
      basis: "Code du Travail, art. 23 et art. 25(4) — la tâche doit être identifiée, sa nature occasionnelle étant la condition du recours",
      aiEditable: true,
      body: "L'Employé(e) est recruté(e) en qualité de {{term.job_title}} pour l'exécution de la tâche définie ci-dessus, sous l'autorité de la Direction.",
    },
    {
      key: "remuneration",
      heading: "RÉMUNÉRATION",
      basis: "Code du Travail, art. 61 à 68 ; art. 62 — le salaire ne peut être inférieur au SMIG",
      aiEditable: false,
      body: [
        "En contrepartie de ses services, l'Employé(e) percevra une rémunération brute décomposée comme suit :",
        "{{pay.allowance_lines}}",
        "Total brut mensuel : {{pay.gross}} {{pay.currency}}, payé par {{pay.method}}.",
      ].join("\n\n"),
    },
    {
      key: "place_and_hours",
      heading: "LIEU ET HORAIRES DE TRAVAIL",
      basis: "Code du Travail, art. 23 et art. 80 — durée légale hebdomadaire de quarante (40) heures",
      aiEditable: false,
      body: "Le lieu de travail est fixé à {{term.place_of_work}}. Le travail s'effectue {{term.working_hours}}, dans la limite de {{term.weekly_hours}} heures par semaine. Toute heure au-delà constitue une heure supplémentaire rémunérée aux taux majorés en vigueur.",
    },
    {
      key: "obligations",
      heading: "OBLIGATIONS PROFESSIONNELLES",
      basis: "Code du Travail, art. 23 et art. 39 ; règlement intérieur",
      aiEditable: false,
      body: [
        "1. L'Employé(e) s'engage à respecter la discipline, le règlement intérieur et les consignes d'hygiène et de sécurité.",
        "2. Il/elle est responsable du matériel qui lui est confié et le restitue au terme du contrat.",
      ].join("\n"),
    },
    {
      key: "social_protection",
      heading: "PROTECTION SOCIALE ET CONGÉS",
      basis: "Code du Travail, art. 89 — congé payé à raison d'un jour et demi ouvrable par mois de service effectif ; affiliation CNPS dès le premier jour",
      aiEditable: false,
      body: [
        "L'Employé(e) est affilié(e) à la Caisse Nationale de Prévoyance Sociale dès le premier jour de travail.",
        "À défaut de prise du congé avant le terme, une indemnité compensatrice de congé payé lui est versée.",
      ].join("\n\n"),
    },
    {
      key: "termination",
      heading: "FIN DU CONTRAT",
      basis: "Code du Travail, art. 25(4) et art. 37 — le contrat prend fin à l'achèvement de la tâche ; rupture anticipée en dehors de la faute lourde ou de la force majeure",
      aiEditable: false,
      body: [
        "Le contrat prend fin de plein droit à son terme ou à l'achèvement de la tâche, sans préavis ni indemnité de licenciement.",
        "Toute rupture anticipée en dehors de la faute lourde, de la force majeure ou de l'accord écrit des Parties ouvre droit à des dommages-intérêts correspondant aux salaires restant dus jusqu'au terme.",
      ].join("\n\n"),
    },
    {
      key: "disputes",
      heading: "RÈGLEMENT DES DIFFÉRENDS",
      basis: "Code du Travail, art. 130 et suivants",
      aiEditable: false,
      body: "Les différends sont réglés prioritairement à l'amiable, puis devant l'Inspecteur du Travail du ressort, et à défaut devant le tribunal compétent de {{doc.jurisdiction_city}}.",
    },
  ],

  closing: {
    body: "Fait à {{doc.place_signed}}, le {{doc.date_signed}}, en deux (02) exemplaires originaux dont un remis à chacune des Parties.",
    signatures: [
      { party: "EMPLOYEE", label: "L'EMPLOYÉ(E)", mention: "(Précédé de la mention « Lu et approuvé »)" },
      { party: "EMPLOYER", label: "L'EMPLOYEUR", mention: "Pour {{entity.legal_name}} — (Signature et cachet)" },
    ],
  },
};
