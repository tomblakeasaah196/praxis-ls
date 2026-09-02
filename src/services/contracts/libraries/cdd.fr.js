/**
 * CONTRAT DE TRAVAIL À DURÉE DÉTERMINÉE — français.
 *
 * Ce n'est PAS un CDI avec une date de fin. Le Code du Travail plafonne sa
 * durée et son renouvellement (art. 25), le requalifie en CDI si la relation se
 * poursuit au-delà du terme (art. 26), et encadre spécifiquement sa rupture
 * anticipée. Ces règles sont écrites dans le corps du contrat, articles 1 et 10.
 *
 * Modèle — ne constitue pas un avis juridique : voir _shape.js.
 */
"use strict";
const { LIBRARY_VERSION } = require("./_shape");

module.exports = {
  key: "CDD",
  language: "fr",
  jurisdiction: "CM",
  version: LIBRARY_VERSION,
  title: "CONTRAT DE TRAVAIL À DURÉE DÉTERMINÉE",

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
      "Ci-après désigné(e) « L'Employé(e) »,",
      "D'AUTRE PART.",
      "",
      "(L'Employeur et l'Employé(e) étant ci-après désignés individuellement la « Partie » ou collectivement les « Parties »).",
      "",
      "IL A ÉTÉ CONVENU ET ARRÊTÉ CE QUI SUIT :",
    ].join("\n"),
  },

  /**
   * Optional tokens THIS document cannot do without — see clause-tokens.js.
   * A fixed term with no term is not a fixed-term contract: art. 25 caps a
   * duration that must therefore be stated, and art. 26 converts the contract
   * to a CDI the moment the relationship outlives a term nobody wrote down.
   */
  requires: ["term.end_date", "term.duration_months"],

  articles: [
    {
      key: "engagement_term",
      heading: "ENGAGEMENT, TERME ET RENOUVELLEMENT",
      basis: "Code du Travail, art. 25 — le CDD ne peut être conclu pour une durée supérieure à deux (02) ans, renouvelable une seule fois ; art. 26 — la poursuite de la relation au-delà du terme emporte requalification en contrat à durée indéterminée ; art. 28 — engagement à l'essai",
      aiEditable: false,
      body: [
        "La Société {{entity.legal_name}} engage {{employee.civility}} {{employee.full_name}} à compter du {{term.start_date}}. Le présent contrat est conclu pour une durée déterminée expirant le {{term.end_date}}, soit une durée de {{term.duration_months}} mois.",
        "Conformément à l'article 25 du Code du Travail, le présent contrat ne peut être conclu pour une durée supérieure à deux (02) ans et ne peut être renouvelé qu'une seule fois. Tout renouvellement fait l'objet d'un avenant écrit signé avant l'échéance du terme.",
        "Conformément à l'article 26 du Code du Travail, si la relation de travail se poursuit après l'expiration du terme sans opposition des Parties, le contrat devient un contrat à durée indéterminée.",
        "Le matricule {{employee.staff_no}} lui est attribué.",
      ].join("\n\n"),
    },
    {
      key: "probation",
      heading: "PÉRIODE D'ESSAI",
      basis: "Code du Travail, art. 28 — l'engagement à l'essai est stipulé par écrit ; sa durée, renouvellement compris, ne peut excéder six (06) mois",
      aiEditable: false,
      // Dropped when no probation was agreed — see cdi.fr.js for why this is
      // an article of its own rather than a paragraph of Article 1.
      omitWhenMissing: ["term.probation_months"],
      body: [
        "Une période d'essai de {{term.probation_months}} mois pourra être observée, stipulée par écrit conformément à l'article 28 du Code du Travail. Sa durée, renouvellement compris, ne peut excéder six (06) mois et doit rester proportionnée à la durée du présent contrat.",
      ].join("\n\n"),
    },
    {
      key: "duties",
      heading: "FONCTIONS ET ATTRIBUTIONS",
      basis: "Code du Travail, art. 23 — la nature de l'emploi est un élément essentiel du contrat",
      aiEditable: true,
      body: [
        "L'Employé(e) est recruté(e) en qualité de {{term.job_title}}. Sous l'autorité de la Direction, ses missions essentielles consistent à exécuter les travaux et tâches inscrits dans sa description de poste, pour la durée du présent contrat.",
        "L'Employé(e) s'engage à consacrer à l'Employeur tout le soin et la diligence nécessaires à la bonne exécution de ses fonctions.",
      ].join("\n\n"),
    },
    {
      key: "remuneration",
      heading: "RÉMUNÉRATION",
      basis: "Code du Travail, art. 61 à 68 (salaire) ; art. 62 — le salaire ne peut être inférieur au SMIG",
      aiEditable: false,
      body: [
        "En contrepartie de ses services, l'Employé(e) percevra une rémunération brute mensuelle décomposée comme suit :",
        "{{pay.allowance_lines}}",
        "Total brut mensuel : {{pay.gross}} {{pay.currency}}.",
        "Le salaire sera payé par {{pay.method}}, au plus tard huit (08) jours après la fin du mois de travail qui donne droit au salaire, conformément à l'article 68 du Code du Travail.",
      ].join("\n\n"),
    },
    {
      key: "place_of_work",
      heading: "LIEU DE TRAVAIL",
      basis: "Code du Travail, art. 23 — le lieu d'exécution est un élément du contrat",
      aiEditable: false,
      body: [
        "Le lieu de travail est fixé à {{term.place_of_work}}.",
        "Il peut s'étendre de façon temporaire à une autre localité si les besoins du service l'exigent, dans le respect des dispositions légales applicables.",
      ].join("\n\n"),
    },
    {
      key: "working_hours",
      heading: "HORAIRES DE TRAVAIL",
      basis: "Code du Travail, art. 80 — durée légale hebdomadaire de quarante (40) heures dans les établissements non agricoles",
      aiEditable: false,
      body: [
        "Le travail s'effectue {{term.working_hours}}, dans la limite de la durée légale de {{term.weekly_hours}} heures par semaine fixée par l'article 80 du Code du Travail.",
        "Toute heure effectuée au-delà de cette durée constitue une heure supplémentaire et est rémunérée aux taux majorés fixés par la réglementation en vigueur.",
      ].join("\n\n"),
    },
    {
      key: "obligations",
      heading: "OBLIGATIONS PROFESSIONNELLES",
      basis: "Code du Travail, art. 23 et art. 39 (faute lourde) ; règlement intérieur, art. 29",
      aiEditable: false,
      body: [
        "1. Exclusivité : l'exercice de toute autre activité professionnelle rémunérée est subordonné à l'accord écrit préalable de l'Employeur pendant la durée du présent contrat.",
        "2. Discipline : l'Employé(e) s'engage à respecter la discipline, le règlement intérieur et les notes de service émis par l'Employeur.",
        "3. Matériel : l'Employé(e) est responsable du matériel qui lui est confié et s'engage à le restituer intégralement au terme du contrat.",
        "4. Réputation : l'Employé(e) s'engage à protéger la réputation de l'entreprise.",
      ].join("\n"),
    },
    {
      key: "confidentiality",
      heading: "CONFIDENTIALITÉ",
      basis: "Code du Travail, art. 23 ; obligation de loyauté",
      aiEditable: false,
      body: [
        "Pendant la durée du contrat et après son terme, les informations professionnelles et les secrets d'affaires de l'Employeur ne peuvent être divulgués à des tiers sans son consentement écrit.",
      ].join("\n\n"),
    },
    {
      key: "social_protection",
      heading: "PROTECTION SOCIALE ET CONGÉS",
      basis: "Code du Travail, art. 89 — congé payé à raison d'un jour et demi ouvrable par mois de service effectif ; affiliation CNPS (Loi n° 69/LF/18 du 10 novembre 1969)",
      aiEditable: false,
      body: [
        "L'Employé(e) est affilié(e) à la Caisse Nationale de Prévoyance Sociale et bénéficie des prestations prévues par la législation en vigueur.",
        "L'Employé(e) a droit à un congé payé à raison d'un jour et demi (1,5) ouvrable par mois de service effectif, conformément à l'article 89 du Code du Travail. À défaut de prise du congé avant le terme, une indemnité compensatrice de congé payé lui est versée.",
      ].join("\n\n"),
    },
    {
      key: "early_termination",
      heading: "RUPTURE ANTICIPÉE",
      basis: "Code du Travail, art. 37 — la rupture anticipée d'un CDD en dehors de la faute lourde ou de la force majeure ouvre droit à des dommages-intérêts correspondant aux salaires restant dus jusqu'au terme. [VERIFY] Le montant exact et son plafonnement sont à confirmer par le conseil du tenant.",
      aiEditable: false,
      body: [
        "Le présent contrat ne peut être rompu avant son terme que d'un commun accord écrit des Parties, en cas de faute lourde, ou en cas de force majeure.",
        "Toute rupture anticipée intervenant en dehors de ces cas ouvre droit, au profit de la Partie qui la subit, à des dommages-intérêts correspondant aux salaires et avantages qui auraient été perçus jusqu'au terme du contrat.",
      ].join("\n\n"),
    },
    {
      key: "expiry",
      heading: "EXPIRATION DU CONTRAT",
      basis: "Code du Travail, art. 25 et 26 — expiration de plein droit au terme ; requalification en CDI en cas de poursuite de la relation",
      aiEditable: false,
      body: [
        "Le présent contrat prend fin de plein droit le {{term.end_date}}, sans qu'il soit besoin d'un préavis ni d'une notification, sous réserve des dispositions relatives au renouvellement stipulées à l'article intitulé « ENGAGEMENT, TERME ET RENOUVELLEMENT ».",
        "Si la relation de travail se poursuit au-delà de cette date sans opposition des Parties, le contrat se transforme en contrat à durée indéterminée, conformément à l'article 26 du Code du Travail.",
      ].join("\n\n"),
    },
    {
      key: "disputes",
      heading: "RÈGLEMENT DES DIFFÉRENDS",
      basis: "Code du Travail, art. 130 et suivants — tentative de conciliation devant l'inspecteur du travail préalable à la saisine du tribunal",
      aiEditable: false,
      body: [
        "Les différends nés de l'exécution ou de la rupture du présent contrat sont réglés prioritairement à l'amiable.",
        "À défaut, ils relèvent de la compétence de l'Inspecteur du Travail du ressort, préalablement à toute saisine du tribunal compétent de {{doc.jurisdiction_city}}.",
      ].join("\n\n"),
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
