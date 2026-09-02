/**
 * NOTICE OF TERMINATION OF THE CONTRACT OF EMPLOYMENT — English. Counterpart of
 * termination.fr.js, and the most exposed letter in the library: the ground must
 * be stated, notice is due save for serious misconduct, and the final account is
 * an entitlement rather than a courtesy. See termination.fr.js for the [VERIFY]
 * on the prior procedure required for economic dismissals.
 * Template, not legal advice. See _shape.js.
 */
"use strict";
const { LIBRARY_VERSION } = require("./_shape");

module.exports = {
  key: "TERMINATION",
  language: "en",
  jurisdiction: "CM",
  version: LIBRARY_VERSION,
  sectionStyle: "letter",
  title: "NOTICE OF TERMINATION OF THE CONTRACT OF EMPLOYMENT",

  preamble: {
    heading: "",
    body: [
      "{{doc.place_signed}}, {{doc.date_signed}}",
      "",
      "{{employee.civility}} {{employee.full_name}}",
      "Staff number: {{employee.staff_no}}",
      "{{employee.residence}}",
      "",
      "Subject: Notice of termination of the contract of employment",
      "Delivered by hand against receipt, or sent by registered post",
      "",
      "Dear {{employee.civility}} {{employee.full_name}},",
    ].join("\n"),
  },

  /**
   * Optional tokens THIS document cannot do without — see clause-tokens.js.
   * Art. 34 makes the notice due the substance of the notification. A
   * termination letter silent on it is the letter that ends up in court.
   */
  requires: ["term.notice_days"],

  articles: [
    {
      key: "notification",
      heading: "NOTIFICATION",
      basis: "Labour Code, s. 34 — termination must be notified in writing to the other party",
      aiEditable: false,
      body: "We hereby notify you of the termination of the contract of employment binding us since {{term.start_date}}, under which you held the position of {{term.job_title}} within {{entity.legal_name}}.",
    },
    {
      key: "grounds",
      heading: "GROUND FOR TERMINATION",
      basis: "Labour Code, ss. 34 and 39 — statement of the ground conditions the legitimacy of the termination; absence of a ground renders it wrongful",
      aiEditable: true,
      body: [
        "The ground for this termination is as follows: [to be completed — state the precise, dated and verifiable facts].",
        "That ground was put to you at the prior interview held for that purpose.",
      ].join("\n\n"),
    },
    {
      key: "notice",
      heading: "NOTICE",
      basis: "Labour Code, s. 34 — length of notice fixed by occupational category and length of service; s. 39 — serious misconduct removes the right to notice",
      aiEditable: false,
      body: [
        "You are required to serve {{term.notice_days}} days' notice, running from the first presentation of this letter, unless expressly waived by us.",
        "Where termination is for serious misconduct within the meaning of section 39 of the Labour Code, it takes effect without notice or allowance, which would then be expressly notified to you.",
      ].join("\n\n"),
    },
    {
      key: "settlement",
      heading: "FINAL ACCOUNT AND DOCUMENTS",
      basis: "Labour Code, s. 36 (severance allowance), ss. 89 and 90 (payment in lieu of untaken leave) and s. 43 (certificate of employment)",
      aiEditable: false,
      body: [
        "On the effective date of termination you will be provided with:",
        "— your certificate of employment, in accordance with section 43 of the Labour Code;",
        "— the statement of your final account, comprising wages due to the effective date, payment in lieu of untaken leave, and, where applicable, the severance allowance provided for by section 36 of the Labour Code;",
        "— the certificate for the National Social Insurance Fund (CNPS).",
        "Please return, no later than the effective date, all equipment and documents belonging to the undertaking.",
      ].join("\n"),
    },
    {
      key: "recourse",
      heading: "RIGHT OF CHALLENGE",
      basis: "Labour Code, ss. 130 et seq. — attempted conciliation before the labour inspector precedes any action before the court",
      aiEditable: false,
      body: [
        "Should you wish to challenge this decision, you may refer the matter to the Labour Inspector for the area for conciliation, prior to any action before the competent court of {{doc.jurisdiction_city}}.",
        "Yours sincerely,",
      ].join("\n\n"),
    },
  ],

  closing: {
    body: "",
    signatures: [
      { party: "EMPLOYER", label: "FOR THE EMPLOYER", mention: "{{rep.name}}, {{rep.title}} — For {{entity.legal_name}}" },
      { party: "EMPLOYEE", label: "RECEIPT", mention: "(preceded by the words \"Received on\", date and signature)" },
    ],
  },
};
