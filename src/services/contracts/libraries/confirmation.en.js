/**
 * LETTER OF CONFIRMATION AFTER PROBATION — English. Counterpart of
 * confirmation.fr.js. Section 28 of the Labour Code makes probation a period at
 * the end of which the engagement becomes definitive; this letter records that.
 * It is not a new contract. Template, not legal advice. See _shape.js.
 */
"use strict";
const { LIBRARY_VERSION } = require("./_shape");

module.exports = {
  key: "CONFIRMATION",
  language: "en",
  jurisdiction: "CM",
  version: LIBRARY_VERSION,
  sectionStyle: "letter",
  title: "CONFIRMATION OF EMPLOYMENT",

  preamble: {
    heading: "",
    body: [
      "{{doc.place_signed}}, {{doc.date_signed}}",
      "",
      "{{employee.civility}} {{employee.full_name}}",
      "Staff number: {{employee.staff_no}}",
      "",
      "Subject: Confirmation at the end of the probationary period",
      "",
      "Dear {{employee.civility}} {{employee.full_name}},",
    ].join("\n"),
  },

  /**
   * Optional tokens THIS document cannot do without — see clause-tokens.js.
   * This letter exists to say a probation ended. Both dates are its subject.
   */
  requires: ["term.probation_months", "term.probation_end_date"],

  articles: [
    {
      key: "confirmation",
      heading: "CONFIRMATION",
      basis: "Labour Code, s. 28 — on expiry of the probationary period the engagement becomes definitive",
      aiEditable: false,
      body: [
        "You were engaged by {{entity.legal_name}} in the capacity of {{term.job_title}} with effect from {{term.start_date}}, subject to a probationary period of {{term.probation_months}} months.",
        "We are pleased to inform you that, in the light of your service during that period, your engagement is confirmed with effect from {{term.probation_end_date}}.",
      ].join("\n\n"),
    },
    {
      key: "effects",
      heading: "WHAT THIS CHANGES",
      basis: "Labour Code, ss. 28 and 34 — probation ends and the ordinary notice regime applies",
      aiEditable: false,
      body: [
        "Your contract continues on the agreed terms, without any break in length of service, which is counted from {{term.start_date}}.",
        "The probationary period having ended, any subsequent termination of the contract by either Party is subject to the notice provided for by section 34 of the Labour Code and by the regulations applicable to your occupational category.",
      ].join("\n\n"),
    },
    {
      key: "closing_words",
      heading: "",
      basis: "Courtesy close — of no independent legal effect",
      aiEditable: false,
      body: [
        "We congratulate you on settling in and wish you every success in the continued performance of your duties.",
        "Yours sincerely,",
      ].join("\n\n"),
    },
  ],

  closing: {
    body: "",
    signatures: [
      { party: "EMPLOYER", label: "FOR THE EMPLOYER", mention: "{{rep.name}}, {{rep.title}} — For {{entity.legal_name}}" },
      { party: "EMPLOYEE", label: "RECEIPT", mention: "(preceded by the words \"Received on\")" },
    ],
  },
};
