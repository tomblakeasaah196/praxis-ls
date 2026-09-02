/**
 * TEMPORARY REPLACEMENT CONTRACT OF EMPLOYMENT — English. Counterpart of
 * interim.fr.js. The named replacement of an absent worker is a condition of
 * validity and must appear in the contract — see interim.fr.js.
 * Template, not legal advice. See _shape.js.
 */
"use strict";
const { LIBRARY_VERSION } = require("./_shape");

module.exports = {
  key: "INTERIM",
  language: "en",
  jurisdiction: "CM",
  version: LIBRARY_VERSION,
  title: "TEMPORARY REPLACEMENT CONTRACT OF EMPLOYMENT",

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
      "Hereinafter referred to as \"the Temporary Employee\",",
      "OF THE SECOND PART.",
      "",
      "IT HAS BEEN AGREED AND SETTLED AS FOLLOWS:",
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
      heading: "PURPOSE, ENGAGEMENT AND TERM",
      basis: "Labour Code, s. 25(4) — contract concluded for temporary work; s. 26 — conversion to indefinite duration if the relationship continues beyond the term. [VERIFY] Maximum duration for replacement work to be confirmed.",
      aiEditable: false,
      body: [
        "{{entity.legal_name}} hereby engages {{employee.civility}} {{employee.full_name}} with effect from {{term.start_date}}, on a temporary basis, in order to replace an absent worker or to meet a temporary increase in activity.",
        "The ground for recourse to temporary work, together with the name and grade of the worker replaced where applicable, is notified to the Temporary Employee and recorded in the personnel file.",
        "This contract ends on {{term.end_date}}, or earlier upon the effective return of the worker replaced, that is an expected duration of {{term.duration_months}} months.",
        "In accordance with section 26 of the Labour Code, if the employment relationship continues beyond the term without objection from the Parties, the contract becomes one of indefinite duration.",
        "The staff number {{employee.staff_no}} is assigned to the Temporary Employee.",
      ].join("\n\n"),
    },
    {
      key: "duties",
      heading: "DUTIES",
      basis: "Labour Code, s. 23 — the nature of the employment is an essential term of the contract",
      aiEditable: true,
      body: "The Temporary Employee is engaged in the capacity of {{term.job_title}} and shall carry out, for the duration of the assignment, the tasks attaching to the post replaced, under the authority of Management.",
    },
    {
      key: "remuneration",
      heading: "REMUNERATION",
      basis: "Labour Code, ss. 61 to 68; equal treatment with the worker replaced for work of equal value",
      aiEditable: false,
      body: [
        "In consideration of their services, the Temporary Employee shall receive gross monthly remuneration made up as follows:",
        "{{pay.allowance_lines}}",
        "Total gross monthly: {{pay.gross}} {{pay.currency}}, paid by {{pay.method}}.",
        "That remuneration may not be lower than that which a worker of the undertaking of equal grade occupying the same post would receive.",
      ].join("\n\n"),
    },
    {
      key: "place_and_hours",
      heading: "PLACE AND HOURS OF WORK",
      basis: "Labour Code, ss. 23 and 80 — statutory working week of forty (40) hours",
      aiEditable: false,
      body: "The place of work is fixed at {{term.place_of_work}}. Work is performed {{term.working_hours}}, within the limit of {{term.weekly_hours}} hours per week.",
    },
    {
      key: "obligations",
      heading: "PROFESSIONAL OBLIGATIONS",
      basis: "Labour Code, ss. 23 and 39; internal rules",
      aiEditable: false,
      body: [
        "1. The Temporary Employee undertakes to observe discipline, the internal rules and any service notes issued by the Employer.",
        "2. They are responsible for equipment entrusted to them and shall return it at the end of the assignment.",
        "3. They are bound by a duty of discretion in respect of information coming to their knowledge.",
      ].join("\n"),
    },
    {
      key: "social_protection",
      heading: "SOCIAL PROTECTION AND LEAVE",
      basis: "Labour Code, s. 89 — paid leave at the rate of one and a half working days per month of actual service; CNPS affiliation",
      aiEditable: false,
      body: [
        "The Temporary Employee is affiliated to the National Social Insurance Fund (CNPS) from the first day of the assignment.",
        "They are entitled to paid leave at the rate of one and a half (1.5) working days per month of actual service. Where leave has not been taken before the term, compensatory payment in lieu is made.",
      ].join("\n\n"),
    },
    {
      key: "termination",
      heading: "END OF THE ASSIGNMENT",
      basis: "Labour Code, ss. 25(4) and 37 — the assignment ends at its term; early termination otherwise than for serious misconduct or force majeure",
      aiEditable: false,
      body: [
        "The assignment ends by operation of law at its term, without notice and without severance allowance.",
        "Any early termination otherwise than for serious misconduct, force majeure or written agreement of the Parties gives rise to damages equal to the wages remaining due until the expected term.",
      ].join("\n\n"),
    },
    {
      key: "disputes",
      heading: "SETTLEMENT OF DISPUTES",
      basis: "Labour Code, ss. 130 et seq.",
      aiEditable: false,
      body: "Disputes shall be settled amicably as a matter of priority, then before the Labour Inspector for the area, and failing that before the competent court of {{doc.jurisdiction_city}}.",
    },
  ],

  closing: {
    body: "Done at {{doc.place_signed}}, on {{doc.date_signed}}, in two (02) original counterparts, one of which is delivered to each Party.",
    signatures: [
      { party: "EMPLOYEE", label: "THE TEMPORARY EMPLOYEE", mention: "(preceded by the words \"Read and approved\")" },
      { party: "EMPLOYER", label: "THE EMPLOYER", mention: "For {{entity.legal_name}} — (Signature and stamp)" },
    ],
  },
};
