/**
 * CONTRAT DE TRAVAIL INTÉRIMAIRE — français.
 *
 * L'intérim a un objet que ni le CDI ni le CDD ordinaire ne portent : le
 * remplacement nommé d'un travailleur absent. Cet objet est une condition de
 * validité — il doit figurer dans le contrat — et le terme du contrat est lié au
 * retour de la personne remplacée, non à une date choisie librement. D'où un
 * fichier distinct.
 *
 * [VERIFY] L'article 25(4) du Code du Travail distingue les contrats temporaire,
 * occasionnel et saisonnier. La durée maximale applicable à l'intérim et les
 * conditions de son renouvellement sont à confirmer par le conseil du tenant.
 *
 * Modèle — ne constitue pas un avis juridique : voir _shape.js.
 */
"use strict";
const { LIBRARY_VERSION } = require("./_shape");

module.exports = {
  key: "INTERIM",
  language: "fr",
  jurisdiction: "CM",
  version: LIBRARY_VERSION,
  title: "CONTRAT DE TRAVAIL INTÉRIMAIRE",

  preamble: {
    heading: "ENTRE LES SOUSSIGNÉS :",
    body: [
      "1. La Société {{entity.legal_name}}, {{entity.legal_form}}, dont le siège social est situé au {{entity.address}}, Boîte Postale : {{entity.po_box}}, {{entity.country}}, Téléphone : {{entity.phone}}, Email : {{entity.email}}, représentée par {{rep.name}}, agissant en qualité de {{rep.title}},",
      "Ci-après désignée « L'Employeur »,",
      "D'UNE PART,",
      "",
      "ET :",
      "",
      "2. {{employee.civility}} {{employee.full_name}}{{employee.maiden_clause}}, né(e) le {{employee.birth_date}} à {{employee.birth_place}}, enfant de {{employee.father_name}} et de {{employee.mother_name}}, titulaire de la {{employee.id_type}} N° {{employee.id_number}} délivrée le {{employee.id_issued_on}} à {{employee.id_issued_at}}, demeurant à {{employee.residence}}, et de nationalité {{employee.nationality}},",
      "Ci-après désigné(e) « L'Employé(e) intérimaire »,",
      "D'AUTRE PART.",
      "",
      "IL A ÉTÉ CONVENU ET ARRÊTÉ CE QUI SUIT :",
    ].join("\n"),
  },

  /**
   * Optional tokens THIS document cannot do without — see clause-tokens.js.
   * Temporary work is lawful because it is bounded. An unbounded 'temporary'
   * engagement is an ordinary one, whatever the heading says.
   */
  requires: ["term.end_date", "term.duration_months"],

  articles: [
    {
      key: "object_and_term",
      heading: "OBJET, ENGAGEMENT ET TERME",
      basis: "Code du Travail, art. 25(4) — contrat conclu pour une tâche temporaire ; art. 26 — requalification en CDI si la relation se poursuit au-delà du terme. [VERIFY] Durée maximale de l'intérim à confirmer.",
      aiEditable: false,
      body: [
        "La Société {{entity.legal_name}} engage {{employee.civility}} {{employee.full_name}} à compter du {{term.start_date}}, à titre intérimaire, aux fins d'assurer le remplacement temporaire d'un travailleur absent ou de faire face à un surcroît temporaire d'activité.",
        "Le motif du recours à l'intérim, ainsi que le nom et la qualification de la personne remplacée le cas échéant, sont portés à la connaissance de l'Employé(e) intérimaire et figurent au dossier du personnel.",
        "Le présent contrat prend fin le {{term.end_date}}, ou par anticipation au retour effectif de la personne remplacée, soit une durée prévisionnelle de {{term.duration_months}} mois.",
        "Conformément à l'article 26 du Code du Travail, si la relation de travail se poursuit au-delà du terme sans opposition des Parties, le contrat devient un contrat à durée indéterminée.",
        "Le matricule {{employee.staff_no}} lui est attribué.",
      ].join("\n\n"),
    },
    {
      key: "duties",
      heading: "FONCTIONS",
      basis: "Code du Travail, art. 23 — la nature de l'emploi est un élément essentiel du contrat",
      aiEditable: true,
      body: "L'Employé(e) intérimaire est recruté(e) en qualité de {{term.job_title}} et exerce, pour la durée de la mission, les tâches attachées au poste remplacé, sous l'autorité de la Direction.",
    },
    {
      key: "remuneration",
      heading: "RÉMUNÉRATION",
      basis: "Code du Travail, art. 61 à 68 ; principe d'égalité de traitement avec le travailleur remplacé pour un travail de valeur égale",
      aiEditable: false,
      body: [
        "En contrepartie de ses services, l'Employé(e) intérimaire percevra une rémunération brute mensuelle décomposée comme suit :",
        "{{pay.allowance_lines}}",
        "Total brut mensuel : {{pay.gross}} {{pay.currency}}, payé par {{pay.method}}.",
        "Cette rémunération ne peut être inférieure à celle que percevrait, à qualification égale, un travailleur de l'entreprise occupant le même poste.",
      ].join("\n\n"),
    },
    {
      key: "place_and_hours",
      heading: "LIEU ET HORAIRES DE TRAVAIL",
      basis: "Code du Travail, art. 23 et art. 80 — durée légale hebdomadaire de quarante (40) heures",
      aiEditable: false,
      body: [
        "Le lieu de travail est fixé à {{term.place_of_work}}. Le travail s'effectue {{term.working_hours}}, dans la limite de {{term.weekly_hours}} heures par semaine.",
      ].join("\n\n"),
    },
    {
      key: "obligations",
      heading: "OBLIGATIONS PROFESSIONNELLES",
      basis: "Code du Travail, art. 23 et art. 39 ; règlement intérieur",
      aiEditable: false,
      body: [
        "1. L'Employé(e) intérimaire s'engage à respecter la discipline, le règlement intérieur et les notes de service de l'Employeur.",
        "2. Il/elle est responsable du matériel qui lui est confié et le restitue au terme de la mission.",
        "3. Il/elle est tenu(e) à une obligation de discrétion sur les informations dont il/elle a connaissance.",
      ].join("\n"),
    },
    {
      key: "social_protection",
      heading: "PROTECTION SOCIALE ET CONGÉS",
      basis: "Code du Travail, art. 89 — congé payé à raison d'un jour et demi ouvrable par mois de service effectif ; affiliation CNPS",
      aiEditable: false,
      body: [
        "L'Employé(e) intérimaire est affilié(e) à la Caisse Nationale de Prévoyance Sociale dès le premier jour de la mission.",
        "Il/elle a droit au congé payé à raison d'un jour et demi (1,5) ouvrable par mois de service effectif. À défaut de prise avant le terme, une indemnité compensatrice lui est versée.",
      ].join("\n\n"),
    },
    {
      key: "termination",
      heading: "FIN DE LA MISSION",
      basis: "Code du Travail, art. 25(4) et art. 37 — la mission prend fin à son terme ; rupture anticipée en dehors de la faute lourde ou de la force majeure",
      aiEditable: false,
      body: [
        "La mission prend fin de plein droit à son terme, sans préavis ni indemnité de licenciement.",
        "Toute rupture anticipée en dehors de la faute lourde, de la force majeure ou de l'accord écrit des Parties ouvre droit à des dommages-intérêts correspondant aux salaires restant dus jusqu'au terme prévu.",
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
      { party: "EMPLOYEE", label: "L'EMPLOYÉ(E) INTÉRIMAIRE", mention: "(Précédé de la mention « Lu et approuvé »)" },
      { party: "EMPLOYER", label: "L'EMPLOYEUR", mention: "Pour {{entity.legal_name}} — (Signature et cachet)" },
    ],
  },
};
