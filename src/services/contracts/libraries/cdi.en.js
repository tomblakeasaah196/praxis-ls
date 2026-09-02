/**
 * CONTRACT OF EMPLOYMENT OF INDEFINITE DURATION — English.
 *
 * The English-language counterpart of cdi.fr.js, drafted against the same
 * authority: Law No. 92/007 of 14 August 1992 establishing the Labour Code of
 * the Republic of Cameroon. It is a SEPARATE document, not a translation
 * rendered beside the French — a contract is signed in one language, and a
 * side-by-side instrument raises which-version-governs (see _shape.js).
 *
 * Template, not legal advice. See _shape.js.
 */
"use strict";
const { LIBRARY_VERSION } = require("./_shape");

module.exports = {
  key: "CDI",
  language: "en",
  jurisdiction: "CM",
  version: LIBRARY_VERSION,
  title: "CONTRACT OF EMPLOYMENT OF INDEFINITE DURATION",

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

  articles: [
    {
      key: "engagement",
      heading: "ENGAGEMENT AND DURATION",
      basis: "Labour Code, s. 23 (formation of the contract) and s. 28 (engagement on probation)",
      aiEditable: false,
      body: [
        "{{entity.legal_name}} hereby engages {{employee.civility}} {{employee.full_name}} with effect from {{term.start_date}}. This contract is entered into for an indefinite duration.",
        "The staff number {{employee.staff_no}} is assigned to the Employee.",
      ].join("\n\n"),
    },
    {
      key: "probation",
      heading: "PROBATIONARY PERIOD",
      basis: "Labour Code, s. 28 — engagement on probation is stipulated in writing; its duration, including any renewal, may not exceed six (06) months",
      aiEditable: false,
      // See the French library: s. 28 makes probation a stipulation, not a
      // default, so the article is dropped when none was agreed rather than
      // printing "a probationary period of  months".
      omitWhenMissing: ["term.probation_months"],
      body: [
        "A probationary period of {{term.probation_months}} months may be observed, renewable once by written agreement of the Parties. In accordance with section 28 of the Labour Code, engagement on probation is stipulated in writing and its duration, including any renewal, may not exceed six (06) months.",
        "During that period either Party may bring the contract to an end on the conditions laid down by the applicable regulations, with no compensation other than any sums due for work already performed.",
      ].join("\n\n"),
    },
    {
      key: "duties",
      heading: "DUTIES AND RESPONSIBILITIES",
      basis: "Labour Code, s. 23 — the nature of the employment is an essential term of the contract",
      aiEditable: true,
      body: [
        "The Employee is engaged in the capacity of {{term.job_title}}. Under the authority of Management, the Employee's essential duties consist in carrying out the work and tasks set out in the job description.",
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
        "Wages shall be paid by {{pay.method}}, at the latest eight (08) days after the end of the month of work giving rise to the entitlement, in accordance with section 68 of the Labour Code. This remuneration may be reviewed by the Employer in the light of results achieved and any change in duties.",
      ].join("\n\n"),
    },
    {
      key: "place_of_work",
      heading: "PLACE OF WORK AND MOBILITY",
      basis: "Labour Code, s. 23 — the place of performance is a term of the contract",
      aiEditable: false,
      body: [
        "The place of work is fixed at {{term.place_of_work}}.",
        "It may nevertheless extend temporarily or permanently to another town or abroad where the requirements of the service so demand, subject to the statutory provisions governing the movement and transfer of workers.",
      ].join("\n\n"),
    },
    {
      key: "working_hours",
      heading: "HOURS OF WORK",
      basis: "Labour Code, s. 80 — statutory working week of forty (40) hours in non-agricultural establishments",
      aiEditable: false,
      body: [
        "Work is performed {{term.working_hours}}, within the statutory limit of {{term.weekly_hours}} hours per week fixed by section 80 of the Labour Code.",
        "Any hour worked beyond that statutory duration constitutes overtime and is paid at the enhanced rates fixed by the regulations in force.",
        "The Employer reserves the right to require the making up of hours lost through a collective interruption of work, on the conditions and within the limits laid down by the regulations.",
      ].join("\n\n"),
    },
    {
      key: "obligations",
      heading: "PROFESSIONAL OBLIGATIONS AND CONDUCT",
      basis: "Labour Code, ss. 23 and 39 (serious misconduct); internal rules, s. 29",
      aiEditable: false,
      body: [
        "1. Exclusivity: the exercise of any other paid professional activity is subject to the Employer's prior written consent for the duration of this contract.",
        "2. Discipline: the Employee undertakes to observe discipline, the internal rules and any service notes issued by the Employer. The Employee may not report for work under the influence of alcohol or narcotics.",
        "3. Equipment: the Employee is responsible for the safekeeping of equipment entrusted to them, undertakes not to use it otherwise than for its professional purpose, and to return it in full at the end of the contract.",
        "4. Reputation: the Employee undertakes to protect the reputation of the undertaking, both within it and outside it.",
      ].join("\n"),
    },
    {
      key: "confidentiality",
      heading: "CONFIDENTIALITY AND NON-COMPETITION",
      basis: "Labour Code, s. 23; duty of good faith. [VERIFY] A post-contractual non-competition covenant must be limited in time, territory and subject matter — to be settled by the tenant's counsel.",
      aiEditable: false,
      body: [
        "During the contract and after its termination, the Employer's professional information and trade secrets may not be disclosed to third parties without the Employer's written consent.",
        "After termination, the Employee shall not use information relating to the Employer's customers for the benefit of a third party or on their own account in a manner liable to cause harm to the Employer.",
      ].join("\n\n"),
    },
    {
      key: "it_usage",
      heading: "USE OF IT SYSTEMS AND THE INTERNET",
      basis: "Internal rules; protection of personal data — Law No. 2010/012 of 21 December 2010 on cybersecurity and cybercrime",
      aiEditable: false,
      body: [
        "Electronic mail exchanged by means of the Employer's tools is presumed to be professional in character. The Employer reserves the right to access it on the conditions laid down by law and by the internal rules. Personal use must remain occasional and reasonable.",
        "It is prohibited to store or circulate, by means of the undertaking's tools, content of a discriminatory, abusive, pornographic or otherwise unlawful nature. Use of the internet is reserved for tasks connected with the employment.",
      ].join("\n\n"),
    },
    {
      key: "social_protection",
      heading: "SOCIAL PROTECTION AND LEAVE",
      basis: "Labour Code, s. 89 — paid leave at the rate of one and a half working days per month of actual service; CNPS affiliation (Law No. 69/LF/18 of 10 November 1969)",
      aiEditable: false,
      body: [
        "The Employee is affiliated to the National Social Insurance Fund (CNPS) and is entitled to the benefits provided for by the legislation in force.",
        "The Employee is entitled to paid leave at the Employer's charge at the rate of one and a half (1.5) working days per month of actual service, in accordance with section 89 of the Labour Code, together with the increments for length of service and, where applicable, for family responsibilities provided for by the regulations.",
      ].join("\n\n"),
    },
    {
      key: "termination",
      heading: "TERMINATION OF THE CONTRACT",
      basis: "Labour Code, s. 34 (notice), s. 36 (severance allowance), s. 39 (serious misconduct) and s. 40 (economic grounds)",
      aiEditable: false,
      body: [
        "A contract of indefinite duration may be terminated at any time at the will of either Party, subject to the notice provided for by section 34 of the Labour Code and by the order fixing its length according to the Employee's occupational category and length of service.",
        "Any termination must be the subject of prior written notification stating the ground relied on.",
        "Termination may occur in particular on the following grounds:",
        "— serious misconduct on the part of the Employee, in which case termination takes effect without notice or allowance, in accordance with section 39 of the Labour Code;",
        "— economic grounds, subject to the procedure laid down by section 40 of the Labour Code;",
        "— force majeure;",
        "— resignation by the Employee, subject to notice.",
        "Where dismissal is not consequent upon serious misconduct, an Employee having the requisite length of service is entitled to the severance allowance provided for by section 36 of the Labour Code.",
      ].join("\n"),
    },
    {
      key: "disputes",
      heading: "SETTLEMENT OF DISPUTES",
      basis: "Labour Code, ss. 130 et seq. — settlement of individual labour disputes; attempted conciliation before the labour inspector precedes any action before the court",
      aiEditable: false,
      body: [
        "Disputes arising out of the performance or termination of this contract shall be settled amicably as a matter of priority.",
        "Failing that, they fall within the competence of the Labour Inspector for the area, prior to any action before the competent court of {{doc.jurisdiction_city}}, in accordance with sections 130 et seq. of the Labour Code.",
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
