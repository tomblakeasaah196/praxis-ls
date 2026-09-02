/**
 * CONTRAT DE PRESTATION DE SERVICES — français.
 *
 * CE N'EST PAS UN CONTRAT DE TRAVAIL, et c'est le seul document de la
 * bibliothèque dont le risque principal est d'en devenir un. Le critère du
 * contrat de travail est le LIEN DE SUBORDINATION (art. 23 du Code du Travail) :
 * si le Consultant reçoit des ordres, est soumis à un horaire imposé et est
 * intégré à un service organisé, un juge requalifie la convention en contrat de
 * travail, avec rappel de cotisations CNPS et d'indemnités.
 *
 * Le corps du texte est donc écrit POUR ÉVITER CELA : indépendance dans
 * l'exécution, absence d'horaire imposé, honoraires sur facture, et charges
 * sociales à la charge du Consultant. Un modèle qui recopierait le CDI en
 * changeant les mots produirait exactement la preuve d'une subordination.
 *
 * Modèle — ne constitue pas un avis juridique : voir _shape.js.
 */
"use strict";
const { LIBRARY_VERSION } = require("./_shape");

module.exports = {
  key: "CONSULTANT",
  language: "fr",
  jurisdiction: "CM",
  version: LIBRARY_VERSION,
  title: "CONTRAT DE PRESTATION DE SERVICES",

  preamble: {
    heading: "ENTRE LES SOUSSIGNÉS :",
    body: [
      "1. La Société {{entity.legal_name}}, {{entity.legal_form}}, dont le siège social est situé au {{entity.address}}, Boîte Postale : {{entity.po_box}}, {{entity.country}}, Téléphone : {{entity.phone}}, Email : {{entity.email}}, représentée par {{rep.name}}, agissant en qualité de {{rep.title}},",
      "Ci-après désignée « Le Client »,",
      "D'UNE PART,",
      "",
      "ET :",
      "",
      "2. {{employee.civility}} {{employee.full_name}}{{employee.maiden_clause}}, né(e) le {{employee.birth_date}} à {{employee.birth_place}}, titulaire de la {{employee.id_type}} N° {{employee.id_number}} délivrée le {{employee.id_issued_on}} à {{employee.id_issued_at}}, demeurant à {{employee.residence}}, et de nationalité {{employee.nationality}}, agissant en qualité de prestataire indépendant,",
      "Ci-après désigné(e) « Le Consultant »,",
      "D'AUTRE PART.",
      "",
      "IL A ÉTÉ CONVENU ET ARRÊTÉ CE QUI SUIT :",
    ].join("\n"),
  },

  /**
   * Optional tokens THIS document cannot do without — see clause-tokens.js.
   * A consultancy with no term and no notice period reads as an open-ended
   * relationship of subordination, which is the requalification this document
   * is drafted to avoid.
   */
  requires: ["term.end_date", "term.duration_months", "term.notice_days"],

  articles: [
    {
      key: "object",
      heading: "OBJET ET QUALIFICATION DU CONTRAT",
      basis: "Code du Travail, art. 23 a contrario — l'absence de lien de subordination exclut la qualification de contrat de travail. Acte uniforme OHADA relatif au droit commercial général pour la qualité de commerçant/prestataire indépendant.",
      aiEditable: false,
      body: [
        "Le Client confie au Consultant, qui l'accepte, une mission de prestation de services en qualité de {{term.job_title}}.",
        "Le présent contrat est un contrat de prestation de services. Il ne constitue pas un contrat de travail et ne crée aucun lien de subordination entre les Parties. Le Consultant exerce son activité en toute indépendance, n'est soumis à aucun horaire imposé et n'est pas intégré au personnel du Client.",
        "Le Consultant déclare être régulièrement enregistré au titre de son activité et être à jour de ses obligations fiscales et sociales.",
      ].join("\n\n"),
    },
    {
      key: "mission",
      heading: "ÉTENDUE DE LA MISSION",
      basis: "Liberté contractuelle ; l'objet défini de la mission est ce qui distingue la prestation de l'emploi",
      aiEditable: true,
      body: [
        "La mission confiée au Consultant porte sur les prestations attachées à la fonction de {{term.job_title}}, telles que définies d'un commun accord entre les Parties.",
        "Le Consultant détermine librement les moyens et méthodes d'exécution de sa mission, sous réserve d'en rendre compte périodiquement au Client et de respecter les délais convenus.",
      ].join("\n\n"),
    },
    {
      key: "duration",
      heading: "DURÉE",
      basis: "Liberté contractuelle ; durée déterminée par l'objet de la mission",
      aiEditable: false,
      body: [
        "Le présent contrat prend effet le {{term.start_date}} et prend fin le {{term.end_date}}, soit une durée de {{term.duration_months}} mois.",
        "Il peut être renouvelé par accord écrit des Parties. Aucun renouvellement ne saurait emporter requalification en contrat de travail.",
      ].join("\n\n"),
    },
    {
      key: "fees",
      heading: "HONORAIRES ET MODALITÉS DE PAIEMENT",
      basis: "Prestation de services : rémunération sur facture, non soumise au régime du salaire. [VERIFY] Retenue à la source applicable aux prestataires (précompte / acompte) à confirmer selon le CGI en vigueur — voir doc/OHADA_KB.md §17.",
      aiEditable: false,
      body: [
        "En contrepartie de sa mission, le Consultant perçoit des honoraires d'un montant de {{pay.gross}} {{pay.currency}} par mois, payables par {{pay.method}} sur présentation d'une facture régulière.",
        "Les honoraires sont versés hors toute qualification de salaire. Le Consultant fait son affaire personnelle de ses obligations fiscales et sociales, et notamment de son affiliation au régime dont il relève.",
        "Les retenues à la source légalement obligatoires sont opérées par le Client et reversées à l'administration compétente.",
      ].join("\n\n"),
    },
    {
      key: "independence",
      heading: "INDÉPENDANCE ET ABSENCE D'EXCLUSIVITÉ",
      basis: "Critère de la subordination ; l'absence d'exclusivité et la liberté d'organisation écartent la qualification de contrat de travail",
      aiEditable: false,
      body: [
        "Le Consultant conserve la faculté d'exercer son activité au profit de tiers, sous réserve de l'article 6 ci-après.",
        "Le Consultant n'est soumis ni au règlement intérieur du Client ni à son pouvoir disciplinaire. Il ne bénéficie ni des congés payés, ni de la couverture sociale, ni des autres avantages réservés aux salariés du Client.",
        "Le Consultant utilise ses propres moyens d'exécution, sauf mise à disposition ponctuelle expressément convenue et strictement nécessaire à la mission.",
      ].join("\n\n"),
    },
    {
      key: "confidentiality",
      heading: "CONFIDENTIALITÉ ET PROPRIÉTÉ INTELLECTUELLE",
      basis: "Obligation de confidentialité contractuelle ; dévolution des droits sur les livrables. [VERIFY] La cession des droits d'auteur doit être expresse et détaillée — à valider par le conseil du tenant.",
      aiEditable: false,
      body: [
        "Le Consultant s'engage à ne divulguer à quiconque les informations professionnelles et secrets d'affaires du Client dont il a connaissance, pendant la durée du contrat et après son terme.",
        "Les livrables produits dans le cadre de la mission, ainsi que les droits patrimoniaux y afférents, sont cédés au Client au fur et à mesure de leur réalisation, pour la durée légale de protection et pour tous pays.",
      ].join("\n\n"),
    },
    {
      key: "liability",
      heading: "RESPONSABILITÉ ET ASSURANCE",
      basis: "Responsabilité contractuelle de droit commun du prestataire",
      aiEditable: false,
      body: [
        "Le Consultant répond de la bonne exécution de sa mission et des dommages qu'il pourrait causer au Client ou à des tiers à cette occasion.",
        "Le Consultant déclare être titulaire d'une assurance couvrant sa responsabilité professionnelle et s'engage à en justifier à première demande.",
      ].join("\n\n"),
    },
    {
      key: "termination",
      heading: "RÉSILIATION",
      basis: "Liberté contractuelle ; résiliation moyennant préavis, sans indemnité de licenciement — laquelle n'existe pas hors contrat de travail",
      aiEditable: false,
      body: [
        "Chacune des Parties peut résilier le présent contrat moyennant un préavis écrit de {{term.notice_days}} jours.",
        "Le contrat peut être résilié sans préavis en cas de manquement grave de l'une des Parties, après mise en demeure restée sans effet pendant quinze (15) jours.",
        "La résiliation n'ouvre droit à aucune indemnité de licenciement ni à aucune indemnité de préavis au sens du Code du Travail, le présent contrat n'étant pas un contrat de travail.",
      ].join("\n\n"),
    },
    {
      key: "disputes",
      heading: "RÈGLEMENT DES DIFFÉRENDS",
      basis: "Compétence de droit commun — le contentieux d'une prestation de services ne relève pas de l'Inspection du Travail",
      aiEditable: false,
      body: [
        "Les différends nés du présent contrat sont réglés prioritairement à l'amiable.",
        "À défaut d'accord dans un délai de trente (30) jours, ils sont portés devant le tribunal compétent de {{doc.jurisdiction_city}}.",
      ].join("\n\n"),
    },
  ],

  closing: {
    body: "Fait à {{doc.place_signed}}, le {{doc.date_signed}}, en deux (02) exemplaires originaux dont un remis à chacune des Parties.",
    signatures: [
      { party: "EMPLOYEE", label: "LE CONSULTANT", mention: "(Précédé de la mention « Lu et approuvé »)" },
      { party: "EMPLOYER", label: "LE CLIENT", mention: "Pour {{entity.legal_name}} — (Signature et cachet)" },
    ],
  },
};
