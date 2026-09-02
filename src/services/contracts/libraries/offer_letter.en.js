/**
 * LETTER OF OFFER OF EMPLOYMENT — English. Counterpart of offer_letter.fr.js.
 * An offer is not a contract: it is a proposal that becomes binding on
 * acceptance, and the contract of employment is signed afterwards. Written as a
 * LETTER — `sectionStyle: "letter"` stops the renderer numbering the sections
 * as articles. Template, not legal advice. See _shape.js.
 */
"use strict";
const { LIBRARY_VERSION } = require("./_shape");

module.exports = {
  key: "OFFER_LETTER",
  language: "en",
  jurisdiction: "CM",
  version: LIBRARY_VERSION,
  sectionStyle: "letter",
  title: "OFFER OF EMPLOYMENT",

  preamble: {
    heading: "",
    body: [
      "{{doc.place_signed}}, {{doc.date_signed}}",
      "",
      "{{employee.civility}} {{employee.full_name}}",
      "{{employee.residence}}",
      "",
      "Subject: Offer of employment — {{term.job_title}}",
      "",
      "Dear {{employee.civility}} {{employee.full_name}},",
    ].join("\n"),
  },

  /**
   * Optional tokens THIS document cannot do without — see clause-tokens.js.
   * An offer that does not say when it lapses, or what probation it carries,
   * is not an offer a candidate can act on.
   */
  requires: ["term.offer_valid_until", "term.probation_months"],

  articles: [
    {
      key: "offer",
      heading: "THE OFFER",
      basis: "Labour Code, s. 23 — formation of the contract requires agreement of the parties on the employment and the remuneration",
      aiEditable: false,
      body: [
        "Following our recruitment process, we are pleased to offer you the post of {{term.job_title}} within {{entity.legal_name}}.",
        "This offer is for an engagement taking effect on {{term.start_date}}, at {{term.place_of_work}}.",
      ].join("\n\n"),
    },
    {
      key: "terms",
      heading: "THE TERMS OFFERED",
      basis: "Labour Code, ss. 61 to 68 (wages) and s. 80 (hours of work) — the essential terms must be made known to the candidate before engagement",
      aiEditable: false,
      body: [
        "Gross monthly remuneration:",
        "{{pay.allowance_lines}}",
        "Total gross monthly: {{pay.gross}} {{pay.currency}}, paid by {{pay.method}}.",
        "Hours: {{term.working_hours}}, within the limit of {{term.weekly_hours}} hours per week.",
        "A probationary period of {{term.probation_months}} months will be stipulated in the contract, in accordance with section 28 of the Labour Code.",
      ].join("\n\n"),
    },
    {
      key: "conditions",
      heading: "WHAT REMAINS TO BE DONE",
      basis: "Freedom of contract — an offer may be made subject to conditions; the definitive contract is the binding instrument",
      aiEditable: false,
      body: [
        "This offer is open until {{term.offer_valid_until}} and is subject to production of the usual supporting documents (identity document, diplomas, references) and to signature of the contract of employment.",
        "It does not constitute a contract of employment. The contract will be provided to you for signature upon your acceptance of this letter.",
      ].join("\n\n"),
    },
    {
      key: "acceptance",
      heading: "YOUR REPLY",
      basis: "Formation of the contract by acceptance",
      aiEditable: false,
      body: [
        "To accept this offer, please return a counterpart of this letter bearing your signature, preceded by the words \"Read and approved, agreed\".",
        "We look forward to welcoming you to our teams.",
        "Yours sincerely,",
      ].join("\n\n"),
    },
  ],

  closing: {
    body: "",
    signatures: [
      { party: "EMPLOYER", label: "FOR THE EMPLOYER", mention: "{{rep.name}}, {{rep.title}} — For {{entity.legal_name}}" },
      { party: "EMPLOYEE", label: "AGREED", mention: "(preceded by the words \"Read and approved, agreed\")" },
    ],
  },
};
