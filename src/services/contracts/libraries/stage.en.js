/**
 * INTERNSHIP AGREEMENT — English. Counterpart of stage.fr.js.
 *
 * AN INTERNSHIP IS NOT A CONTRACT OF EMPLOYMENT — that is why this is its own
 * library rather than the employment body with a flag on it. See stage.fr.js
 * for the [VERIFY] items on the Cameroonian internship regime.
 *
 * Template, not legal advice. See _shape.js.
 */
"use strict";
const { LIBRARY_VERSION } = require("./_shape");

module.exports = {
  key: "STAGE",
  language: "en",
  jurisdiction: "CM",
  version: LIBRARY_VERSION,
  title: "INTERNSHIP AGREEMENT",

  preamble: {
    heading: "BETWEEN THE UNDERSIGNED:",
    body: [
      "1. {{entity.legal_name}}, {{entity.legal_form}}, having its registered office at {{entity.address}}, P.O. Box {{entity.po_box}}, {{entity.country}}, Telephone: {{entity.phone}}, Email: {{entity.email}}, represented by {{rep.name}}, acting in the capacity of {{rep.title}},",
      "Hereinafter referred to as \"the Host Organisation\",",
      "OF THE FIRST PART,",
      "",
      "AND:",
      "",
      "2. {{employee.civility}} {{employee.full_name}}{{employee.maiden_clause}}, born on {{employee.birth_date}} at {{employee.birth_place}}, child of {{employee.father_name}} and {{employee.mother_name}}, holder of {{employee.id_type}} No. {{employee.id_number}} issued on {{employee.id_issued_on}} at {{employee.id_issued_at}}, residing at {{employee.residence}}, of {{employee.nationality}} nationality,",
      "Hereinafter referred to as \"the Intern\",",
      "OF THE SECOND PART.",
      "",
      "IT HAS BEEN AGREED AS FOLLOWS:",
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
      heading: "PURPOSE AND NATURE OF THIS AGREEMENT",
      basis: "Labour Code, s. 23 a contrario — this agreement is for practical training and does not constitute a contract of employment. [VERIFY] Reclassification threshold to be confirmed.",
      aiEditable: false,
      body: [
        "The purpose of this agreement is to set out the conditions under which the Intern undertakes a period of practical training within the Host Organisation.",
        "This agreement does not constitute a contract of employment. It creates no relationship of salaried subordination between the Parties and confers no entitlement under the provisions applicable to employees, save for the mandatory rules on health, safety and the protection of persons.",
      ].join("\n\n"),
    },
    {
      key: "duration",
      heading: "DURATION AND PLACE OF THE INTERNSHIP",
      basis: "[VERIFY] Maximum duration to be confirmed against the applicable regulation and any sectoral collective agreement.",
      aiEditable: false,
      body: [
        "The internship runs from {{term.start_date}} to {{term.end_date}}, that is a duration of {{term.duration_months}} months.",
        "It is carried out at {{term.place_of_work}}, according to the hours in force within the Host Organisation, namely {{term.working_hours}}, and the Intern's attendance may not exceed the statutory limit of {{term.weekly_hours}} hours per week.",
        "The reference number {{employee.staff_no}} is assigned to the Intern for internal identification.",
      ].join("\n\n"),
    },
    {
      key: "programme",
      heading: "TRAINING PROGRAMME",
      basis: "Purpose of the agreement — practical training is the consideration for the Intern's attendance",
      aiEditable: true,
      body: [
        "The Intern is received in the capacity of trainee {{term.job_title}}. The training programme covers the acquisition of the practical skills attaching to that function, under the responsibility of a supervisor designated by the Host Organisation.",
        "The tasks entrusted to the Intern serve a training purpose and may not substitute for a permanent post.",
      ].join("\n\n"),
    },
    {
      key: "gratification",
      heading: "TRAINING ALLOWANCE",
      basis: "[VERIFY] A training allowance is not a wage. Whether it is compulsory, any minimum amount and its social-security treatment in Cameroon are to be confirmed by the tenant's counsel.",
      aiEditable: false,
      body: [
        "The Intern receives a monthly training allowance of {{pay.gross}} {{pay.currency}}, paid by {{pay.method}}.",
        "That allowance does not constitute a wage and does not convert this agreement into a contract of employment.",
      ].join("\n\n"),
    },
    {
      key: "obligations",
      heading: "THE INTERN'S OBLIGATIONS",
      basis: "Internal rules; duty of discretion",
      aiEditable: false,
      body: [
        "1. The Intern shall comply with the Host Organisation's internal rules, in particular as to hours, health and safety.",
        "2. The Intern is bound by a duty of discretion in respect of any information coming to their knowledge during the internship.",
        "3. Equipment made available is returned at the end of the internship.",
      ].join("\n"),
    },
    {
      key: "confidentiality",
      heading: "CONFIDENTIALITY AND OWNERSHIP OF WORK",
      basis: "Duty of discretion; ownership of work produced during the internship",
      aiEditable: false,
      body: [
        "During the internship and after its end, the Host Organisation's professional information and trade secrets may not be disclosed to third parties without its written consent.",
        "Work produced by the Intern within the training programme remains the property of the Host Organisation.",
      ].join("\n\n"),
    },
    {
      key: "insurance",
      heading: "ACCIDENT COVER",
      basis: "[VERIFY] Cover for accidents occurring during the internship — CNPS affiliation or private insurance — to be confirmed according to the Intern's situation.",
      aiEditable: false,
      body: "The Host Organisation shall make the arrangements necessary to cover the Intern against accidents occurring in connection with the internship, on the conditions laid down by the applicable regulations.",
    },
    {
      key: "termination",
      heading: "END AND EARLY TERMINATION",
      basis: "Freedom of contract; the agreement ends by operation of law at its term",
      aiEditable: false,
      body: [
        "This agreement comes to an end by operation of law on {{term.end_date}}.",
        "It may be terminated before its term by written mutual agreement of the Parties, or by either of them in the event of a serious breach by the other, on seven (07) days' written notice.",
        "A certificate of internship is issued to the Intern at the end of the internship.",
      ].join("\n\n"),
    },
    {
      key: "disputes",
      heading: "SETTLEMENT OF DISPUTES",
      basis: "Amicable settlement; competence of the court for the area",
      aiEditable: false,
      body: "Disputes arising out of the performance of this agreement shall be settled amicably as a matter of priority and, failing that, brought before the competent court of {{doc.jurisdiction_city}}.",
    },
  ],

  closing: {
    body: "Done at {{doc.place_signed}}, on {{doc.date_signed}}, in two (02) original counterparts, one of which is delivered to each Party.",
    signatures: [
      { party: "EMPLOYEE", label: "THE INTERN", mention: "(preceded by the words \"Read and approved\")" },
      { party: "EMPLOYER", label: "THE HOST ORGANISATION", mention: "For {{entity.legal_name}} — (Signature and stamp)" },
    ],
  },
};
