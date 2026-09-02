/**
 * CONTRAT DE TRAVAIL À DURÉE INDÉTERMINÉE — français.
 *
 * Rédigé d'après la Loi n° 92/007 du 14 août 1992 portant Code du Travail de la
 * République du Cameroun, et d'après la pratique attestée par les contrats
 * signés du client. Modèle — ne constitue pas un avis juridique : voir _shape.js.
 */
"use strict";
const { LIBRARY_VERSION } = require("./_shape");

module.exports = {
  key: "CDI",
  language: "fr",
  jurisdiction: "CM",
  version: LIBRARY_VERSION,
  title: "CONTRAT DE TRAVAIL À DURÉE INDÉTERMINÉE",

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

  articles: [
    {
      key: "engagement",
      heading: "ENGAGEMENT ET DURÉE",
      basis: "Code du Travail, art. 23 (formation du contrat) et art. 28 (engagement à l'essai)",
      aiEditable: false,
      body: [
        "La Société {{entity.legal_name}} engage {{employee.civility}} {{employee.full_name}} à compter du {{term.start_date}}. Le présent contrat est conclu pour une durée indéterminée.",
        "Le matricule {{employee.staff_no}} lui est attribué.",
      ].join("\n\n"),
    },
    {
      key: "probation",
      heading: "PÉRIODE D'ESSAI",
      basis: "Code du Travail, art. 28 — l'engagement à l'essai est stipulé par écrit ; sa durée, renouvellement compris, ne peut excéder six (06) mois",
      aiEditable: false,
      // Art. 28 makes probation a stipulation, not a default: an engagement
      // with no probation agreed is a lawful engagement. So this is its own
      // article and it is DROPPED when no probation was agreed — printing
      // "une période d'essai de  mois" would be a defect, and burying the
      // paragraph inside Article 1 left no way to drop it.
      omitWhenMissing: ["term.probation_months"],
      body: [
        "Une période d'essai de {{term.probation_months}} mois pourra être observée, renouvelable une fois par accord écrit des Parties. Conformément à l'article 28 du Code du Travail, l'engagement à l'essai est stipulé par écrit et sa durée, renouvellement compris, ne peut excéder six (06) mois.",
        "Durant cette période, chacune des Parties peut mettre fin au contrat dans les conditions prévues par la réglementation applicable, sans indemnité autre que celles éventuellement dues au titre du travail accompli.",
      ].join("\n\n"),
    },
    {
      key: "duties",
      heading: "FONCTIONS ET ATTRIBUTIONS",
      basis: "Code du Travail, art. 23 — la nature de l'emploi est un élément essentiel du contrat",
      // The one clause a model may rewrite: what this particular person will
      // actually do is prose about a job, not a statutory term.
      aiEditable: true,
      body: [
        "L'Employé(e) est recruté(e) en qualité de {{term.job_title}}. Sous l'autorité de la Direction, ses missions essentielles consistent notamment à exécuter les travaux et tâches inscrits dans sa description de poste.",
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
        "Le salaire sera payé par {{pay.method}}, au plus tard huit (08) jours après la fin du mois de travail qui donne droit au salaire, conformément à l'article 68 du Code du Travail. Cette rémunération pourra être revue par l'Employeur selon les résultats atteints et l'évolution des fonctions.",
      ].join("\n\n"),
    },
    {
      key: "place_of_work",
      heading: "LIEU DE TRAVAIL ET MOBILITÉ",
      basis: "Code du Travail, art. 23 — le lieu d'exécution est un élément du contrat",
      aiEditable: false,
      body: [
        "Le lieu de travail est fixé à {{term.place_of_work}}.",
        "Toutefois, il peut s'étendre de façon temporaire ou permanente à une autre ville ou à l'étranger si les besoins du service l'exigent, sous réserve du respect des dispositions légales applicables au déplacement et à la mutation du travailleur.",
      ].join("\n\n"),
    },
    {
      key: "working_hours",
      heading: "HORAIRES DE TRAVAIL",
      basis: "Code du Travail, art. 80 — durée légale hebdomadaire de quarante (40) heures dans les établissements non agricoles",
      aiEditable: false,
      body: [
        "Le travail s'effectue {{term.working_hours}}, dans la limite de la durée légale de {{term.weekly_hours}} heures par semaine fixée par l'article 80 du Code du Travail.",
        "Toute heure effectuée au-delà de cette durée légale constitue une heure supplémentaire et est rémunérée aux taux majorés fixés par la réglementation en vigueur.",
        "L'Employeur se réserve le droit de demander le rattrapage d'heures perdues résultant d'une interruption collective du travail, dans les conditions et limites prévues par la réglementation.",
      ].join("\n\n"),
    },
    {
      key: "obligations",
      heading: "OBLIGATIONS PROFESSIONNELLES ET ÉTHIQUE",
      basis: "Code du Travail, art. 23 et art. 39 (faute lourde) ; règlement intérieur, art. 29",
      aiEditable: false,
      body: [
        "1. Exclusivité : l'exercice de toute autre activité professionnelle rémunérée est subordonné à l'accord écrit préalable de l'Employeur pendant la durée du présent contrat.",
        "2. Discipline : l'Employé(e) s'engage à respecter la discipline, le règlement intérieur et les notes de service émis par l'Employeur. Il lui est interdit de se présenter au travail sous l'emprise de l'alcool ou de stupéfiants.",
        "3. Matériel : l'Employé(e) est responsable de la conservation du matériel qui lui est confié. Il s'engage à ne pas l'utiliser en dehors de sa destination professionnelle et à le restituer intégralement à la fin du contrat.",
        "4. Réputation : l'Employé(e) s'engage à protéger la réputation de l'entreprise, tant à l'intérieur qu'à l'extérieur de celle-ci.",
      ].join("\n"),
    },
    {
      key: "confidentiality",
      heading: "CONFIDENTIALITÉ ET NON-CONCURRENCE",
      basis: "Code du Travail, art. 23 ; obligation de loyauté. [VERIFY] La portée d'une clause de non-concurrence post-contractuelle doit être limitée dans le temps, l'espace et l'objet — à faire valider par le conseil du tenant.",
      aiEditable: false,
      body: [
        "Pendant la durée du contrat et après sa rupture, les informations professionnelles et les secrets d'affaires de l'Employeur ne peuvent être divulgués à des tiers sans son consentement écrit.",
        "Après la rupture du contrat, l'Employé(e) s'interdit d'utiliser les informations relatives à la clientèle de l'Employeur au profit d'un tiers ou pour son propre compte, dans des conditions de nature à porter préjudice à l'Employeur.",
      ].join("\n\n"),
    },
    {
      key: "it_usage",
      heading: "USAGE DES OUTILS INFORMATIQUES ET D'INTERNET",
      basis: "Règlement intérieur ; protection des données à caractère personnel — Loi n° 2010/012 du 21 décembre 2010 relative à la cybersécurité et à la cybercriminalité",
      aiEditable: false,
      body: [
        "Les courriers électroniques échangés au moyen des outils professionnels sont présumés avoir un caractère professionnel. L'Employeur se réserve le droit d'y accéder dans les conditions prévues par la loi et le règlement intérieur. L'usage personnel doit demeurer occasionnel et raisonnable.",
        "Il est interdit de conserver ou de diffuser au moyen des outils de l'entreprise des contenus à caractère discriminatoire, injurieux, pornographique ou contraire à l'ordre public. L'usage d'internet est réservé aux tâches liées à l'emploi.",
      ].join("\n\n"),
    },
    {
      key: "social_protection",
      heading: "PROTECTION SOCIALE ET CONGÉS",
      basis: "Code du Travail, art. 89 — congé payé à raison d'un jour et demi ouvrable par mois de service effectif ; affiliation CNPS (Loi n° 69/LF/18 du 10 novembre 1969)",
      aiEditable: false,
      body: [
        "L'Employé(e) est affilié(e) à la Caisse Nationale de Prévoyance Sociale et bénéficie des prestations prévues par la législation en vigueur.",
        "L'Employé(e) a droit à un congé payé à la charge de l'Employeur, à raison d'un jour et demi (1,5) ouvrable par mois de service effectif, conformément à l'article 89 du Code du Travail, ainsi qu'aux majorations pour ancienneté et, le cas échéant, pour charges de famille prévues par la réglementation.",
      ].join("\n\n"),
    },
    {
      key: "termination",
      heading: "RUPTURE DU CONTRAT",
      basis: "Code du Travail, art. 34 (préavis), art. 36 (indemnité de licenciement), art. 39 (faute lourde) et art. 40 (motif économique)",
      aiEditable: false,
      body: [
        "Le contrat à durée indéterminée peut être rompu à tout moment par la volonté de l'une des Parties, sous réserve du respect du préavis prévu par l'article 34 du Code du Travail et par l'arrêté fixant sa durée selon la catégorie professionnelle et l'ancienneté de l'Employé(e).",
        "Toute rupture doit faire l'objet d'une notification écrite préalable indiquant le motif.",
        "La rupture peut notamment intervenir pour les motifs suivants :",
        "— faute lourde de l'Employé(e), auquel cas la rupture intervient sans préavis ni indemnité, conformément à l'article 39 du Code du Travail ;",
        "— motif économique, sous réserve de la procédure prévue par l'article 40 du Code du Travail ;",
        "— force majeure ;",
        "— démission de l'Employé(e), sous réserve du préavis.",
        "En cas de licenciement non consécutif à une faute lourde, l'Employé(e) comptant l'ancienneté requise bénéficie de l'indemnité de licenciement prévue par l'article 36 du Code du Travail.",
      ].join("\n"),
    },
    {
      key: "disputes",
      heading: "RÈGLEMENT DES DIFFÉRENDS",
      basis: "Code du Travail, art. 130 et suivants — règlement des différends individuels du travail ; tentative de conciliation devant l'inspecteur du travail préalable à la saisine du tribunal",
      aiEditable: false,
      body: [
        "Les différends nés de l'exécution ou de la rupture du présent contrat sont réglés prioritairement à l'amiable.",
        "À défaut, ils relèvent de la compétence de l'Inspecteur du Travail du ressort, préalablement à toute saisine du tribunal compétent de {{doc.jurisdiction_city}}, conformément aux articles 130 et suivants du Code du Travail.",
      ].join("\n\n"),
    },
  ],

  closing: {
    body: [
      "Fait à {{doc.place_signed}}, le {{doc.date_signed}}, en deux (02) exemplaires originaux dont un remis à chacune des Parties.",
    ].join("\n"),
    // The two signature blocks, in the order the signed contract carries them.
    signatures: [
      { party: "EMPLOYEE", label: "L'EMPLOYÉ(E)", mention: "(Précédé de la mention « Lu et approuvé »)" },
      { party: "EMPLOYER", label: "L'EMPLOYEUR", mention: "Pour {{entity.legal_name}} — (Signature et cachet)" },
    ],
  },
};
