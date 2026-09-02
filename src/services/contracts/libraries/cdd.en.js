/**
 * FIXED-TERM CONTRACT OF EMPLOYMENT — English. Counterpart of cdd.fr.js.
 * Template, not legal advice. See _shape.js.
 */
"use strict";
const { LIBRARY_VERSION } = require("./_shape");

module.exports = {
  key: "CDD",
  language: "en",
  jurisdiction: "CM",
  version: LIBRARY_VERSION,
  title: "FIXED-TERM CONTRACT OF EMPLOYMENT",

  preamble: {
    heading: "BETWEEN THE UNDERSIGNED:",
    body: [
      "1. {{entity.legal_name}}, {{entity.legal_form}}, having its registered office at {{entity.address}}, P.O. Box {{entity.po_box}}, {{entity.country}}, Telephone: {{entity.phone}}, Email: {{entity.email}}, represented by {{rep.name}}, acting in the capacity of {{rep.title}},",
      "Hereinafter referred to as \"the Employer\",",
      "OF THE FIRST PART,",
      "",
      "AND:",
      "",
      "2. {{employee.civility}} {{employee.full_name}}{{employee.maiden_clause}}, born on {{employee.birth_date}} at {{employee.birth_place}}, child of {{employee.father_name}} and {{employee.mother_name}}, holder of {{employee.id_type}} No. {{employee.id_number}} issued on {{employee.id_issued_on}} at {{employee.id_issued_at}}, residing at {{employee.residence}}, of {{employee.nationality}} nationality,",
      "Hereinafter referred to as \"the Employee\",",
      "OF THE SECOND PART.",
      "",
      "(the Employer and the Employee being hereinafter referred to individually as a \"Party\" and collectively as the \"Parties\").",
      "",
      "IT HAS BEEN AGREED AND SETTLED AS FOLLOWS:",
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
      heading: "ENGAGEMENT, TERM AND RENEWAL",
      basis: "Labour Code, s. 25 — a fixed-term contract may not be concluded for longer than two (02) years and may be renewed once only; s. 26 — continuation of the relationship beyond the term converts it into a contract of indefinite duration; s. 28 — engagement on probation",
      aiEditable: false,
      body: [
        "{{entity.legal_name}} hereby engages {{employee.civility}} {{employee.full_name}} with effect from {{term.start_date}}. This contract is concluded for a fixed term expiring on {{term.end_date}}, that is a duration of {{term.duration_months}} months.",
        "In accordance with section 25 of the Labour Code, this contract may not be concluded for a duration exceeding two (02) years and may be renewed once only. Any renewal shall be the subject of a written amendment signed before the term falls due.",
        "In accordance with section 26 of the Labour Code, if the employment relationship continues after expiry of the term without objection from the Parties, the contract becomes one of indefinite duration.",
        "The staff number {{employee.staff_no}} is assigned to the Employee.",
      ].join("\n\n"),
    },
    {
      key: "probation",
      heading: "PROBATIONARY PERIOD",
      basis: "Labour Code, s. 28 — engagement on probation is stipulated in writing; its duration, including any renewal, may not exceed six (06) months",
      aiEditable: false,
      // Dropped when no probation was agreed — see cdi.en.js.
      omitWhenMissing: ["term.probation_months"],
      body: [
        "A probationary period of {{term.probation_months}} months may be observed, stipulated in writing in accordance with section 28 of the Labour Code. Its duration, including any renewal, may not exceed six (06) months and shall remain proportionate to the duration of this contract.",
      ].join("\n\n"),
    },
    {
      key: "duties",
      heading: "DUTIES AND RESPONSIBILITIES",
      basis: "Labour Code, s. 23 — the nature of the employment is an essential term of the contract",
      aiEditable: true,
      body: [
        "The Employee is engaged in the capacity of {{term.job_title}}. Under the authority of Management, the Employee's essential duties consist in carrying out the work and tasks set out in the job description, for the duration of this contract.",
        "The Employee undertakes to devote to the Employer all the care and diligence required for the proper performance of those duties.",
      ].join("\n\n"),
    },
    {
      key: "remuneration",
      heading: "REMUNERATION",
      basis: "Labour Code, ss. 61 to 68 (wages); s. 62 — wages may not fall below the guaranteed minimum wage (SMIG)",
      aiEditable: false,
      body: [
        "In consideration of the Employee's services, the Employee shall receive gross monthly remuneration made up as follows:",
        "{{pay.allowance_lines}}",
        "Total gross monthly: {{pay.gross}} {{pay.currency}}.",
        "Wages shall be paid by {{pay.method}}, at the latest eight (08) days after the end of the month of work giving rise to the entitlement, in accordance with section 68 of the Labour Code.",
      ].join("\n\n"),
    },
    {
      key: "place_of_work",
      heading: "PLACE OF WORK",
      basis: "Labour Code, s. 23 — the place of performance is a term of the contract",
      aiEditable: false,
      body: [
        "The place of work is fixed at {{term.place_of_work}}.",
        "It may extend temporarily to another locality where the requirements of the service so demand, in compliance with the applicable statutory provisions.",
      ].join("\n\n"),
    },
    {
      key: "working_hours",
      heading: "HOURS OF WORK",
      basis: "Labour Code, s. 80 — statutory working week of forty (40) hours in non-agricultural establishments",
      aiEditable: false,
      body: [
        "Work is performed {{term.working_hours}}, within the statutory limit of {{term.weekly_hours}} hours per week fixed by section 80 of the Labour Code.",
        "Any hour worked beyond that duration constitutes overtime and is paid at the enhanced rates fixed by the regulations in force.",
      ].join("\n\n"),
    },
    {
      key: "obligations",
      heading: "PROFESSIONAL OBLIGATIONS",
      basis: "Labour Code, ss. 23 and 39 (serious misconduct); internal rules, s. 29",
      aiEditable: false,
      body: [
        "1. Exclusivity: the exercise of any other paid professional activity is subject to the Employer's prior written consent for the duration of this contract.",
        "2. Discipline: the Employee undertakes to observe discipline, the internal rules and any service notes issued by the Employer.",
        "3. Equipment: the Employee is responsible for equipment entrusted to them and undertakes to return it in full at the end of the contract.",
        "4. Reputation: the Employee undertakes to protect the reputation of the undertaking.",
      ].join("\n"),
    },
    {
      key: "confidentiality",
      heading: "CONFIDENTIALITY",
      basis: "Labour Code, s. 23; duty of good faith",
      aiEditable: false,
      body: "During the contract and after its term, the Employer's professional information and trade secrets may not be disclosed to third parties without the Employer's written consent.",
    },
    {
      key: "social_protection",
      heading: "SOCIAL PROTECTION AND LEAVE",
      basis: "Labour Code, s. 89 — paid leave at the rate of one and a half working days per month of actual service; CNPS affiliation (Law No. 69/LF/18 of 10 November 1969)",
      aiEditable: false,
      body: [
        "The Employee is affiliated to the National Social Insurance Fund (CNPS) and is entitled to the benefits provided for by the legislation in force.",
        "The Employee is entitled to paid leave at the rate of one and a half (1.5) working days per month of actual service, in accordance with section 89 of the Labour Code. Where leave has not been taken before the term, compensatory payment in lieu is made.",
      ].join("\n\n"),
    },
    {
      key: "early_termination",
      heading: "EARLY TERMINATION",
      basis: "Labour Code, s. 37 — early termination of a fixed-term contract otherwise than for serious misconduct or force majeure gives rise to damages equal to the wages remaining due until the term. [VERIFY] The exact measure and any cap are to be confirmed by the tenant's counsel.",
      aiEditable: false,
      body: [
        "This contract may not be terminated before its term save by written mutual agreement of the Parties, for serious misconduct, or in a case of force majeure.",
        "Any early termination occurring otherwise gives rise, in favour of the Party suffering it, to damages equal to the wages and benefits that would have been received up to the term of the contract.",
      ].join("\n\n"),
    },
    {
      key: "expiry",
      heading: "EXPIRY OF THE CONTRACT",
      basis: "Labour Code, ss. 25 and 26 — expiry by operation of law at the term; conversion to indefinite duration if the relationship continues",
      aiEditable: false,
      body: [
        "This contract comes to an end by operation of law on {{term.end_date}}, without the need for notice or notification, subject to the provisions on renewal set out in the article headed “ENGAGEMENT, TERM AND RENEWAL”.",
        "If the employment relationship continues beyond that date without objection from the Parties, the contract is converted into one of indefinite duration, in accordance with section 26 of the Labour Code.",
      ].join("\n\n"),
    },
    {
      key: "disputes",
      heading: "SETTLEMENT OF DISPUTES",
      basis: "Labour Code, ss. 130 et seq. — attempted conciliation before the labour inspector precedes any action before the court",
      aiEditable: false,
      body: [
        "Disputes arising out of the performance or termination of this contract shall be settled amicably as a matter of priority.",
        "Failing that, they fall within the competence of the Labour Inspector for the area, prior to any action before the competent court of {{doc.jurisdiction_city}}.",
      ].join("\n\n"),
    },
  ],

  closing: {
    body: "Done at {{doc.place_signed}}, on {{doc.date_signed}}, in two (02) original counterparts, one of which is delivered to each Party.",
    signatures: [
      { party: "EMPLOYEE", label: "THE EMPLOYEE", mention: "(preceded by the words \"Read and approved\")" },
      { party: "EMPLOYER", label: "THE EMPLOYER", mention: "For {{entity.legal_name}} — (Signature and stamp)" },
    ],
  },
};
