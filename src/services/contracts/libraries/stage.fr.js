/**
 * CONVENTION DE STAGE — français.
 *
 * UN STAGE N'EST PAS UN CONTRAT DE TRAVAIL. C'est la raison d'être de ce
 * fichier séparé : la convention a pour objet une formation pratique, elle ne
 * crée pas de lien de subordination salariale au sens de l'article 23 du Code
 * du Travail, et le stagiaire perçoit une gratification, non un salaire. Rendre
 * cela par des drapeaux sur le corps du CDI produirait un document qui se lit
 * comme un contrat de travail tout en prétendant ne pas en être un.
 *
 * [VERIFY] Le régime du stage au Cameroun relève pour l'essentiel de textes
 * réglementaires et conventionnels distincts du Code du Travail. Le seuil de
 * requalification en contrat de travail, la durée maximale et le montant
 * minimal de la gratification sont à confirmer par le conseil du tenant.
 *
 * Modèle — ne constitue pas un avis juridique : voir _shape.js.
 */
"use strict";
const { LIBRARY_VERSION } = require("./_shape");

module.exports = {
  key: "STAGE",
  language: "fr",
  jurisdiction: "CM",
  version: LIBRARY_VERSION,
  title: "CONVENTION DE STAGE",

  preamble: {
    heading: "ENTRE LES SOUSSIGNÉS :",
    body: [
      "1. La Société {{entity.legal_name}}, {{entity.legal_form}}, dont le siège social est situé au {{entity.address}}, Boîte Postale : {{entity.po_box}}, {{entity.country}}, Téléphone : {{entity.phone}}, Email : {{entity.email}}, représentée par {{rep.name}}, agissant en qualité de {{rep.title}},",
      "Ci-après désignée « La Structure d'accueil »,",
      "D'UNE PART,",
      "",
      "ET :",
      "",
      "2. {{employee.civility}} {{employee.full_name}}{{employee.maiden_clause}}, né(e) le {{employee.birth_date}} à {{employee.birth_place}}, enfant de {{employee.father_name}} et de {{employee.mother_name}}, titulaire de la {{employee.id_type}} N° {{employee.id_number}} délivrée le {{employee.id_issued_on}} à {{employee.id_issued_at}}, demeurant à {{employee.residence}}, et de nationalité {{employee.nationality}},",
      "Ci-après désigné(e) « Le/La Stagiaire »,",
      "D'AUTRE PART.",
      "",
      "IL A ÉTÉ CONVENU CE QUI SUIT :",
    ].join("\n"),
  },

  /**
   * Optional tokens THIS document cannot do without — see clause-tokens.js.
   * An internship is defined by its period — it is what separates a stage from
   * an unwritten employment relationship a labour inspector would requalify.
   */
  requires: ["term.end_date", "term.duration_months"],

  articles: [
    {
      key: "object",
      heading: "OBJET ET NATURE DE LA CONVENTION",
      basis: "Code du Travail, art. 23 a contrario — la présente convention a pour objet une formation pratique et ne constitue pas un contrat de travail. [VERIFY] Seuil de requalification à confirmer.",
      aiEditable: false,
      body: [
        "La présente convention a pour objet de définir les conditions dans lesquelles le/la Stagiaire effectue un stage de formation pratique au sein de la Structure d'accueil.",
        "La présente convention ne constitue pas un contrat de travail. Elle ne crée aucun lien de subordination salariale entre les Parties et n'ouvre pas droit aux dispositions applicables aux travailleurs salariés, sous réserve des règles d'ordre public relatives à l'hygiène, à la sécurité et à la protection des personnes.",
      ].join("\n\n"),
    },
    {
      key: "duration",
      heading: "DURÉE ET LIEU DU STAGE",
      basis: "[VERIFY] Durée maximale du stage à confirmer selon le texte réglementaire applicable et, le cas échéant, la convention collective de branche.",
      aiEditable: false,
      body: [
        "Le stage se déroule du {{term.start_date}} au {{term.end_date}}, soit une durée de {{term.duration_months}} mois.",
        "Il s'effectue à {{term.place_of_work}}, selon les horaires en vigueur dans la Structure d'accueil, soit {{term.working_hours}}, sans que la présence du/de la Stagiaire puisse excéder la durée légale de {{term.weekly_hours}} heures par semaine.",
        "Le matricule {{employee.staff_no}} lui est attribué à des fins d'identification interne.",
      ].join("\n\n"),
    },
    {
      key: "programme",
      heading: "PROGRAMME DE FORMATION",
      basis: "Objet de la convention — la formation pratique est la contrepartie de la présence du/de la stagiaire",
      aiEditable: true,
      body: [
        "Le/La Stagiaire est accueilli(e) en qualité de {{term.job_title}} stagiaire. Le programme de formation porte sur l'acquisition des compétences pratiques attachées à cette fonction, sous la responsabilité d'un encadrant désigné par la Structure d'accueil.",
        "Les tâches confiées au/à la Stagiaire ont une finalité pédagogique et ne peuvent se substituer à un emploi permanent.",
      ].join("\n\n"),
    },
    {
      key: "gratification",
      heading: "GRATIFICATION",
      basis: "[VERIFY] La gratification de stage n'est pas un salaire. Son caractère obligatoire, son montant minimal et son régime social au Cameroun sont à confirmer par le conseil du tenant.",
      aiEditable: false,
      body: [
        "Le/La Stagiaire perçoit une gratification mensuelle de {{pay.gross}} {{pay.currency}}, versée par {{pay.method}}.",
        "Cette gratification ne constitue pas un salaire et n'emporte pas requalification de la présente convention en contrat de travail.",
      ].join("\n\n"),
    },
    {
      key: "obligations",
      heading: "OBLIGATIONS DU/DE LA STAGIAIRE",
      basis: "Règlement intérieur ; obligation de discrétion",
      aiEditable: false,
      body: [
        "1. Le/La Stagiaire se conforme au règlement intérieur de la Structure d'accueil, notamment en matière d'horaires, d'hygiène et de sécurité.",
        "2. Le/La Stagiaire est tenu(e) à une obligation de discrétion à l'égard de toute information dont il/elle a connaissance à l'occasion du stage.",
        "3. Le matériel mis à disposition est restitué au terme du stage.",
      ].join("\n"),
    },
    {
      key: "confidentiality",
      heading: "CONFIDENTIALITÉ ET PROPRIÉTÉ DES TRAVAUX",
      basis: "Obligation de discrétion ; dévolution des travaux réalisés dans le cadre du stage",
      aiEditable: false,
      body: [
        "Pendant le stage et après son terme, les informations professionnelles et secrets d'affaires de la Structure d'accueil ne peuvent être divulgués à des tiers sans son consentement écrit.",
        "Les travaux réalisés par le/la Stagiaire dans le cadre du programme de formation demeurent la propriété de la Structure d'accueil.",
      ].join("\n\n"),
    },
    {
      key: "insurance",
      heading: "COUVERTURE DES ACCIDENTS",
      basis: "[VERIFY] La couverture du stagiaire au titre des accidents survenus pendant le stage — affiliation CNPS ou assurance privée — est à confirmer selon la situation du/de la stagiaire.",
      aiEditable: false,
      body: [
        "La Structure d'accueil prend les dispositions nécessaires à la couverture du/de la Stagiaire contre les accidents survenus à l'occasion du stage, dans les conditions prévues par la réglementation applicable.",
      ].join("\n\n"),
    },
    {
      key: "termination",
      heading: "FIN ET RUPTURE DU STAGE",
      basis: "Liberté contractuelle ; la convention prend fin de plein droit à son terme",
      aiEditable: false,
      body: [
        "La présente convention prend fin de plein droit le {{term.end_date}}.",
        "Elle peut être rompue avant son terme d'un commun accord écrit des Parties, ou par l'une d'elles en cas de manquement grave de l'autre, moyennant un préavis écrit de sept (07) jours.",
        "Une attestation de stage est délivrée au/à la Stagiaire à l'issue du stage.",
      ].join("\n\n"),
    },
    {
      key: "disputes",
      heading: "RÈGLEMENT DES DIFFÉRENDS",
      basis: "Règlement amiable ; compétence du tribunal du ressort",
      aiEditable: false,
      body: [
        "Les différends nés de l'exécution de la présente convention sont réglés prioritairement à l'amiable, et à défaut portés devant le tribunal compétent de {{doc.jurisdiction_city}}.",
      ].join("\n\n"),
    },
  ],

  closing: {
    body: "Fait à {{doc.place_signed}}, le {{doc.date_signed}}, en deux (02) exemplaires originaux dont un remis à chacune des Parties.",
    signatures: [
      { party: "EMPLOYEE", label: "LE/LA STAGIAIRE", mention: "(Précédé de la mention « Lu et approuvé »)" },
      { party: "EMPLOYER", label: "LA STRUCTURE D'ACCUEIL", mention: "Pour {{entity.legal_name}} — (Signature et cachet)" },
    ],
  },
};
