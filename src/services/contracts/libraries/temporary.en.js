/**
 * OCCASIONAL OR SEASONAL CONTRACT OF EMPLOYMENT — English. Counterpart of
 * temporary.fr.js. Distinct from replacement work: an interim contract replaces
 * a person, occasional work answers a non-durable task, seasonal work returns
 * with the season. Labour Code s. 25(4) treats them as their own categories.
 * Template, not legal advice. See _shape.js.
 */
"use strict";
const { LIBRARY_VERSION } = require("./_shape");

module.exports = {
  key: "TEMPORARY",
  language: "en",
  jurisdiction: "CM",
  version: LIBRARY_VERSION,
  title: "OCCASIONAL OR SEASONAL CONTRACT OF EMPLOYMENT",

  preamble: {
    heading: "BETWEEN THE UNDERSIGNED:",
    body: [
      "1. {{entity.legal_name}}, {{entity.legal_form}}, having its registered office at {{entity.address}}, P.O. Box {{entity.po_box}}, {{entity.country}}, Telephone: {{entity.phone}}, Email: {{entity.email}}, represented by {{rep.name}}, acting in the capacity of {{rep.title}},",
      "Hereinafter referred to as \"the Employer\",",
      "OF THE FIRST PART,",
      "",
      "AND:",
      "",
      "2. {{employee.civility}} {{employee.full_name}}{{employee.maiden_clause}}, born on {{employee.birth_date}} at {{employee.birth_place}}, holder of {{employee.id_type}} No. {{employee.id_number}} issued on {{employee.id_issued_on}} at {{employee.id_issued_at}}, residing at {{employee.residence}}, of {{employee.nationality}} nationality,",
      "Hereinafter referred to as \"the Employee\",",
      "OF THE SECOND PART.",
      "",
      "IT HAS BEEN AGREED AND SETTLED AS FOLLOWS:",
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
      heading: "PURPOSE, ENGAGEMENT AND TERM",
      basis: "Labour Code, s. 25(4) — occasional and seasonal contracts; s. 26 — conversion to indefinite duration if the relationship continues beyond the term. [VERIFY] Maximum durations to be confirmed.",
      aiEditable: false,
      body: [
        "{{entity.legal_name}} hereby engages {{employee.civility}} {{employee.full_name}} with effect from {{term.start_date}} for the performance of a task of an occasional or seasonal character, unconnected with the normal and permanent activity of the undertaking.",
        "This contract ends on {{term.end_date}}, that is a duration of {{term.duration_months}} months, on completion of the task for which it was concluded.",
        "In accordance with section 26 of the Labour Code, if the employment relationship continues beyond the term without objection from the Parties, the contract becomes one of indefinite duration.",
        "The staff number {{employee.staff_no}} is assigned to the Employee.",
      ].join("\n\n"),
    },
    {
      key: "duties",
      heading: "NATURE OF THE TASK",
      basis: "Labour Code, ss. 23 and 25(4) — the task must be identified, its occasional character being the condition for recourse",
      aiEditable: true,
      body: "The Employee is engaged in the capacity of {{term.job_title}} for the performance of the task defined above, under the authority of Management.",
    },
    {
      key: "remuneration",
      heading: "REMUNERATION",
      basis: "Labour Code, ss. 61 to 68; s. 62 — wages may not fall below the guaranteed minimum wage (SMIG)",
      aiEditable: false,
      body: [
        "In consideration of their services, the Employee shall receive gross remuneration made up as follows:",
        "{{pay.allowance_lines}}",
        "Total gross monthly: {{pay.gross}} {{pay.currency}}, paid by {{pay.method}}.",
      ].join("\n\n"),
    },
    {
      key: "place_and_hours",
      heading: "PLACE AND HOURS OF WORK",
      basis: "Labour Code, ss. 23 and 80 — statutory working week of forty (40) hours",
      aiEditable: false,
      body: "The place of work is fixed at {{term.place_of_work}}. Work is performed {{term.working_hours}}, within the limit of {{term.weekly_hours}} hours per week. Any hour beyond that constitutes overtime paid at the enhanced rates in force.",
    },
    {
      key: "obligations",
      heading: "PROFESSIONAL OBLIGATIONS",
      basis: "Labour Code, ss. 23 and 39; internal rules",
      aiEditable: false,
      body: [
        "1. The Employee undertakes to observe discipline, the internal rules and the health and safety instructions.",
        "2. They are responsible for equipment entrusted to them and shall return it at the end of the contract.",
      ].join("\n"),
    },
    {
      key: "social_protection",
      heading: "SOCIAL PROTECTION AND LEAVE",
      basis: "Labour Code, s. 89 — paid leave at the rate of one and a half working days per month of actual service; CNPS affiliation from the first day",
      aiEditable: false,
      body: [
        "The Employee is affiliated to the National Social Insurance Fund (CNPS) from the first day of work.",
        "Where leave has not been taken before the term, compensatory payment in lieu is made.",
      ].join("\n\n"),
    },
    {
      key: "termination",
      heading: "END OF THE CONTRACT",
      basis: "Labour Code, ss. 25(4) and 37 — the contract ends on completion of the task; early termination otherwise than for serious misconduct or force majeure",
      aiEditable: false,
      body: [
        "The contract ends by operation of law at its term or on completion of the task, without notice and without severance allowance.",
        "Any early termination otherwise than for serious misconduct, force majeure or written agreement of the Parties gives rise to damages equal to the wages remaining due until the term.",
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
      { party: "EMPLOYEE", label: "THE EMPLOYEE", mention: "(preceded by the words \"Read and approved\")" },
      { party: "EMPLOYER", label: "THE EMPLOYER", mention: "For {{entity.legal_name}} — (Signature and stamp)" },
    ],
  },
};
