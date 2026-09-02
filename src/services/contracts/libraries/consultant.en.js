/**
 * CONTRACT FOR THE PROVISION OF SERVICES — English. Counterpart of
 * consultant.fr.js.
 *
 * THIS IS NOT A CONTRACT OF EMPLOYMENT, and it is the only library whose
 * principal risk is becoming one. The test is SUBORDINATION (Labour Code s. 23):
 * a consultant who takes orders, keeps imposed hours and is absorbed into an
 * organised service will be reclassified by a court as an employee, with CNPS
 * contributions and allowances recovered. The text below is written to avoid
 * that — see consultant.fr.js.
 *
 * Template, not legal advice. See _shape.js.
 */
"use strict";
const { LIBRARY_VERSION } = require("./_shape");

module.exports = {
  key: "CONSULTANT",
  language: "en",
  jurisdiction: "CM",
  version: LIBRARY_VERSION,
  title: "CONTRACT FOR THE PROVISION OF SERVICES",

  preamble: {
    heading: "BETWEEN THE UNDERSIGNED:",
    body: [
      "1. {{entity.legal_name}}, {{entity.legal_form}}, having its registered office at {{entity.address}}, P.O. Box {{entity.po_box}}, {{entity.country}}, Telephone: {{entity.phone}}, Email: {{entity.email}}, represented by {{rep.name}}, acting in the capacity of {{rep.title}},",
      "Hereinafter referred to as \"the Client\",",
      "OF THE FIRST PART,",
      "",
      "AND:",
      "",
      "2. {{employee.civility}} {{employee.full_name}}{{employee.maiden_clause}}, born on {{employee.birth_date}} at {{employee.birth_place}}, holder of {{employee.id_type}} No. {{employee.id_number}} issued on {{employee.id_issued_on}} at {{employee.id_issued_at}}, residing at {{employee.residence}}, of {{employee.nationality}} nationality, acting as an independent contractor,",
      "Hereinafter referred to as \"the Consultant\",",
      "OF THE SECOND PART.",
      "",
      "IT HAS BEEN AGREED AND SETTLED AS FOLLOWS:",
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
      heading: "PURPOSE AND CHARACTERISATION",
      basis: "Labour Code, s. 23 a contrario — the absence of subordination excludes characterisation as a contract of employment. OHADA Uniform Act on General Commercial Law as to independent-contractor status.",
      aiEditable: false,
      body: [
        "The Client entrusts to the Consultant, who accepts, an assignment for the provision of services in the capacity of {{term.job_title}}.",
        "This contract is a contract for the provision of services. It does not constitute a contract of employment and creates no relationship of subordination between the Parties. The Consultant carries on their activity wholly independently, is subject to no imposed hours and is not absorbed into the Client's staff.",
        "The Consultant declares that they are duly registered in respect of their activity and up to date with their tax and social-security obligations.",
      ].join("\n\n"),
    },
    {
      key: "mission",
      heading: "SCOPE OF THE ASSIGNMENT",
      basis: "Freedom of contract; a defined assignment is what distinguishes services from employment",
      aiEditable: true,
      body: [
        "The assignment entrusted to the Consultant covers the services attaching to the function of {{term.job_title}}, as defined by mutual agreement of the Parties.",
        "The Consultant freely determines the means and methods of performing the assignment, subject to reporting periodically to the Client and observing the agreed deadlines.",
      ].join("\n\n"),
    },
    {
      key: "duration",
      heading: "DURATION",
      basis: "Freedom of contract; duration determined by the subject matter of the assignment",
      aiEditable: false,
      body: [
        "This contract takes effect on {{term.start_date}} and ends on {{term.end_date}}, that is a duration of {{term.duration_months}} months.",
        "It may be renewed by written agreement of the Parties. No renewal shall operate to convert it into a contract of employment.",
      ].join("\n\n"),
    },
    {
      key: "fees",
      heading: "FEES AND PAYMENT",
      basis: "Provision of services: paid on invoice, not subject to the wages regime. [VERIFY] Withholding applicable to service providers (précompte / acompte) to be confirmed against the General Tax Code in force — see doc/OHADA_KB.md §17.",
      aiEditable: false,
      body: [
        "In consideration of the assignment, the Consultant receives fees of {{pay.gross}} {{pay.currency}} per month, payable by {{pay.method}} against a duly issued invoice.",
        "The fees are paid outside any characterisation as wages. The Consultant is personally responsible for their tax and social-security obligations, including affiliation to the scheme applicable to them.",
        "Withholdings required by law are made by the Client and remitted to the competent authority.",
      ].join("\n\n"),
    },
    {
      key: "independence",
      heading: "INDEPENDENCE AND ABSENCE OF EXCLUSIVITY",
      basis: "The subordination test; absence of exclusivity and freedom of organisation exclude characterisation as employment",
      aiEditable: false,
      body: [
        "The Consultant retains the right to carry on their activity for third parties, subject to Article 6 below.",
        "The Consultant is subject neither to the Client's internal rules nor to its disciplinary power. They are entitled neither to paid leave, nor to social cover, nor to the other benefits reserved to the Client's employees.",
        "The Consultant uses their own means of performance, save for occasional provision expressly agreed and strictly necessary to the assignment.",
      ].join("\n\n"),
    },
    {
      key: "confidentiality",
      heading: "CONFIDENTIALITY AND INTELLECTUAL PROPERTY",
      basis: "Contractual duty of confidentiality; vesting of rights in deliverables. [VERIFY] An assignment of copyright must be express and specific — to be settled by the tenant's counsel.",
      aiEditable: false,
      body: [
        "The Consultant undertakes not to disclose to anyone the Client's professional information and trade secrets coming to their knowledge, during the contract and after its term.",
        "Deliverables produced under the assignment, and the economic rights attaching to them, are assigned to the Client as and when they are produced, for the full term of protection and for all countries.",
      ].join("\n\n"),
    },
    {
      key: "liability",
      heading: "LIABILITY AND INSURANCE",
      basis: "Ordinary contractual liability of a service provider",
      aiEditable: false,
      body: [
        "The Consultant is answerable for the proper performance of the assignment and for any loss caused to the Client or to third parties in connection with it.",
        "The Consultant declares that they hold professional indemnity insurance and undertakes to produce evidence of it on first request.",
      ].join("\n\n"),
    },
    {
      key: "termination",
      heading: "TERMINATION",
      basis: "Freedom of contract; termination on notice, without severance allowance — which does not exist outside a contract of employment",
      aiEditable: false,
      body: [
        "Either Party may terminate this contract on {{term.notice_days}} days' written notice.",
        "The contract may be terminated without notice in the event of a serious breach by either Party, after a formal demand has remained without effect for fifteen (15) days.",
        "Termination gives rise to no severance allowance and no payment in lieu of notice within the meaning of the Labour Code, this contract not being a contract of employment.",
      ].join("\n\n"),
    },
    {
      key: "disputes",
      heading: "SETTLEMENT OF DISPUTES",
      basis: "Ordinary jurisdiction — a services dispute does not fall to the Labour Inspectorate",
      aiEditable: false,
      body: [
        "Disputes arising out of this contract shall be settled amicably as a matter of priority.",
        "Failing agreement within thirty (30) days, they shall be brought before the competent court of {{doc.jurisdiction_city}}.",
      ].join("\n\n"),
    },
  ],

  closing: {
    body: "Done at {{doc.place_signed}}, on {{doc.date_signed}}, in two (02) original counterparts, one of which is delivered to each Party.",
    signatures: [
      { party: "EMPLOYEE", label: "THE CONSULTANT", mention: "(preceded by the words \"Read and approved\")" },
      { party: "EMPLOYER", label: "THE CLIENT", mention: "For {{entity.legal_name}} — (Signature and stamp)" },
    ],
  },
};
