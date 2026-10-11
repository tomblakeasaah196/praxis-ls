"use strict";

/**
 * The clause library a Praxis employment document is built from.
 *
 * ── WHY A LIBRARY AND NOT A PROMPT ─────────────────────────────────────────
 *
 * Before this, the whole contract came back from a model. The model was given
 * the agreed terms and told to write "the clauses, the ordering, the register",
 * and what it produced was whatever it felt like producing that afternoon: the
 * contract in front of the tenant on 11 Oct 2026 had five articles, no
 * classification, no CNPS, no leave, no medical cover, no dispute route, and a
 * fixed term of twenty years. Nothing failed. A contract is the one document
 * where "it varies a bit between runs" is not a quality of the prose, it is a
 * difference in what two employees agreed to.
 *
 * So the binding text lives HERE: reviewed once, versioned with the code,
 * identical in every contract the product issues. The model's remaining job is
 * the one thing a library cannot know — what this particular person actually
 * does all day — and it is confined to a single clause (`engagement`, via
 * `t.duties_md`).
 *
 * ── WHAT THIS IS NOT ───────────────────────────────────────────────────────
 *
 * It is not legal advice and it is not a filing-ready contract for every
 * sector. It covers the subjects the Cameroonian Labour Code and the ordinary
 * collective agreements expect an employment contract to settle, written so
 * each one states the term THE PARTIES AGREED and refers to the governing
 * instrument for the limits. A tenant's counsel reviews it once; after that the
 * tenant layer below is where their own wording goes.
 *
 * Instruments are named, never cited by article number. A contract that cites
 * the wrong article is worse than one that cites none, the numbering moves
 * between consolidations, and no counterparty has ever been helped by it.
 *
 * ── THE THREE LAYERS, AND WHICH ONE WINS ───────────────────────────────────
 *
 *   1. STATUTORY (`statutory: true`). The subjects the law expects to be
 *      settled in writing. A tenant may not switch one off — that is the whole
 *      point of a floor — and `build()` ignores a request to.
 *   2. STANDARD. Protective clauses that are sound practice rather than
 *      required (confidentiality, conflict of interest, company property). A
 *      tenant may disable these by key.
 *   3. THE TENANT'S OWN. Added through settings, placed after the library, and
 *      never able to displace a statutory clause of the same key.
 *
 * ── OMISSION IS A FEATURE ──────────────────────────────────────────────────
 *
 * A clause whose fact was not supplied returns null and does not print. That is
 * the same rule the model was always held to and it matters more here: a
 * printed "Probation: null months" or an invented figure is a term nobody
 * agreed. What the drafting screen does about a missing fact is warn (see
 * `review`), not guess.
 */

const KINDS = ["OFFER_LETTER", "EMPLOYMENT", "CONFIRMATION", "TERMINATION"];
const ALL = KINDS;

/** Cameroon's statutory normal working week, in hours, for non-agricultural
 *  work. A tenant's own figure always wins; this is only the floor a contract
 *  falls back to when nobody has said otherwise. */
const DEFAULT_WEEKLY_HOURS = 40;
/** Paid leave accrues at a day and a half per month of actual service. */
const DEFAULT_LEAVE_DAYS_PER_MONTH = 1.5;
/** The statutory ceiling on a fixed term, in months, before it is treated as
 *  indefinite. Used by `review` to warn, never to rewrite what was agreed. */
const FIXED_TERM_MAX_MONTHS = 24;
/** The ceiling on a probationary period, renewal included. Also warn-only. */
const PROBATION_MAX_MONTHS = 6;

/* ── small formatters ───────────────────────────────────────────────────────
 *
 * Local rather than imported from the PDF kit: this module is pulled in by the
 * drafter, which runs nowhere near a renderer, and reaching into
 * `services/documents/templates/kit` for two helpers would drag the whole
 * letterhead toolkit into a text pipeline. `careers-alerts.js` keeps its own
 * `dmy` for the same reason.
 */

/** `2026-08-23` → `23/08/2026`. DAY FIRST — the corridor reads dates day-first
 *  and this text is printed for a person, so ISO here is the defect the date
 *  gate exists to catch everywhere else. */
function dmy(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || "");
}

/** `500000` → `500 000` in French, `500,000` in English. */
function amount(value, lang) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  const grouped = Math.trunc(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, lang === "fr" ? " " : ",");
  const cents = Math.abs(n) % 1 ? String(Math.round((Math.abs(n) % 1) * 100)).padStart(2, "0") : "";
  const body = cents ? `${grouped}${lang === "fr" ? "," : "."}${cents}` : grouped;
  return n < 0 ? `-${body}` : body;
}

/** `1.5` → `1,5` in French. A decimal point in a French contract is a typo. */
const decimal = (n, lang) => (lang === "fr" ? String(n).replace(".", ",") : String(n));

/** The pay figure with its currency, or null when no salary was agreed. */
function pay(t, lang) {
  if (t.gross_salary === null || t.gross_salary === undefined) return null;
  return `${amount(t.gross_salary, lang)} ${t.salary_currency || "XAF"}`;
}

/** The employer, as it is named in the body of a clause. */
const employer = (t, lang) => t.entity_name || (lang === "fr" ? "l'Employeur" : "the Employer");

/** A list as prose: "a, b and c" / "a, b et c". */
function list(items, lang) {
  const xs = (items || []).filter(Boolean);
  if (!xs.length) return null;
  if (xs.length === 1) return xs[0];
  return `${xs.slice(0, -1).join(", ")} ${lang === "fr" ? "et" : "and"} ${xs[xs.length - 1]}`;
}

/**
 * The applicable collective agreement, as a clause refers to it.
 *
 * A tenant who has named theirs gets it by name; one who has not gets the
 * generic reference rather than a blank, because "the applicable collective
 * agreement" is a correct and complete reference on its own — the agreement
 * that covers the employer's sector is a matter of law, not of what this
 * contract says about it.
 */
function agreement(t, lang) {
  if (t.collective_agreement) return t.collective_agreement;
  return lang === "fr" ? "la convention collective applicable" : "the applicable collective agreement";
}

/* ── the library ────────────────────────────────────────────────────────────
 *
 * Order IS the article order on the printed contract, so it reads the way a
 * contract reads: who, what, for how long, for how much, under what conditions,
 * and how it ends.
 */

const LIBRARY = [
  {
    key: "parties",
    kinds: ALL,
    statutory: true,
    title: { en: "Parties", fr: "Parties" },
    body: (t, lang) => {
      const emp = [
        t.entity_name,
        t.entity_address,
        t.entity_rccm && (lang === "fr" ? `RCCM ${t.entity_rccm}` : `Trade register ${t.entity_rccm}`),
        t.entity_niu && (lang === "fr" ? `NIU ${t.entity_niu}` : `Taxpayer number ${t.entity_niu}`),
        t.employer_cnps && (lang === "fr" ? `CNPS employeur ${t.employer_cnps}` : `CNPS employer number ${t.employer_cnps}`),
      ].filter(Boolean).join(", ");
      const sal = [
        t.employee_name,
        t.employee_cnps && (lang === "fr" ? `CNPS ${t.employee_cnps}` : `CNPS number ${t.employee_cnps}`),
      ].filter(Boolean).join(", ");
      return lang === "fr"
        ? `Le présent contrat est conclu entre ${emp || "l'Employeur"}, ci-après « l'Employeur », d'une part, et ${sal}, ci-après « le Salarié », d'autre part.\n\nLes parties conviennent de ce qui suit.`
        : `This contract is made between ${emp || "the Employer"} (the "Employer") of the one part and ${sal} (the "Employee") of the other part.\n\nThe parties agree as follows.`;
    },
  },

  {
    key: "engagement",
    kinds: ALL,
    statutory: true,
    title: { en: "Engagement and Duties", fr: "Engagement et fonctions" },
    /**
     * THE ONE CLAUSE THE MODEL WRITES.
     *
     * `t.duties_md` is what Gemini produced for this role and nothing else is.
     * The sentence around it — who engages whom, as what, reporting to whom —
     * is here, because those are terms rather than description, and because an
     * engagement clause that varies between two contracts for the same job is
     * the defect this library exists to remove.
     */
    body: (t, lang) => {
      if (!t.job_title) return null;
      const where = t.department
        ? lang === "fr" ? ` au sein du département ${t.department}` : ` in the ${t.department} department`
        : "";
      const reports = t.reports_to
        ? lang === "fr" ? ` Le Salarié rend compte à ${t.reports_to}.` : ` The Employee reports to ${t.reports_to}.`
        : "";
      const head = lang === "fr"
        ? `${employer(t, lang)} engage le Salarié en qualité de ${t.job_title}${where}, poste que le Salarié accepte.${reports}`
        : `${employer(t, lang)} engages the Employee as ${t.job_title}${where}, which the Employee accepts.${reports}`;
      const duties = t.duties_md ? `\n\n${t.duties_md.trim()}` : "";
      const tail = lang === "fr"
        ? "\n\nCette énumération n'est pas limitative. Le Salarié exécute toute tâche raisonnablement liée à ses fonctions et relevant de sa qualification."
        : "\n\nThis list is not exhaustive. The Employee shall carry out any task reasonably connected with the position and consistent with their classification.";
      return head + duties + tail;
    },
  },

  {
    key: "category",
    kinds: ["EMPLOYMENT", "OFFER_LETTER", "CONFIRMATION"],
    statutory: true,
    title: { en: "Professional Classification", fr: "Classification professionnelle" },
    /**
     * The grid position, which is the anchor for three other clauses.
     *
     * The notice period, the leave entitlement and the minimum wage are all
     * read off the category under the sector's collective agreement. A contract
     * that omits it leaves the three terms that matter most to an employee
     * unanchored, and it is the omission a labour inspector notices first.
     */
    body: (t, lang) => {
      if (!t.professional_category) return null;
      return lang === "fr"
        ? `Le Salarié est classé ${t.professional_category} selon ${agreement(t, lang)}, laquelle régit le présent contrat pour tout ce qui n'y est pas expressément prévu.`
        : `The Employee is classified as ${t.professional_category} under ${agreement(t, lang)}, which governs this contract in respect of anything it does not expressly provide for.`;
    },
  },

  {
    key: "term",
    kinds: ["EMPLOYMENT", "OFFER_LETTER"],
    statutory: true,
    title: { en: "Term", fr: "Durée du contrat" },
    body: (t, lang) => {
      if (!t.effective_on) return null;
      if (!t.end_on) {
        return lang === "fr"
          ? `Le présent contrat est conclu pour une durée indéterminée et prend effet le ${dmy(t.effective_on)}.`
          : `This contract is for an indefinite term and takes effect on ${dmy(t.effective_on)}.`;
      }
      return lang === "fr"
        ? `Le présent contrat est conclu pour une durée déterminée. Il prend effet le ${dmy(t.effective_on)} et prend fin de plein droit le ${dmy(t.end_on)}, sans qu'il soit besoin d'un préavis.\n\nSa durée et son renouvellement s'exercent dans les limites fixées par le Code du travail. À défaut de renouvellement écrit avant le terme, la relation de travail cesse à cette date. Si elle se poursuit au-delà du terme, le contrat devient un contrat à durée indéterminée.`
        : `This contract is for a fixed term. It takes effect on ${dmy(t.effective_on)} and ends of its own force on ${dmy(t.end_on)}, without notice being required.\n\nIts duration and any renewal are subject to the limits set by the Labour Code. Failing a written renewal before the end date, the employment relationship ends on that date. If it continues beyond that date, this contract becomes a contract of indefinite duration.`;
    },
  },

  {
    key: "probation",
    kinds: ["EMPLOYMENT", "OFFER_LETTER"],
    statutory: true,
    title: { en: "Probationary Period", fr: "Période d'essai" },
    body: (t, lang) => {
      if (!t.probation_months) return null;
      const ends = t.probation_ends_on
        ? lang === "fr" ? ` Elle s'achève le ${dmy(t.probation_ends_on)}.` : ` It ends on ${dmy(t.probation_ends_on)}.`
        : "";
      return lang === "fr"
        ? `Le présent engagement comporte une période d'essai de ${t.probation_months} mois à compter de la date d'effet.${ends} Elle ne peut être renouvelée qu'une fois et par écrit, dans les limites fixées par le Code du travail et ${agreement(t, lang)}.\n\nPendant l'essai, chaque partie peut rompre le contrat sans indemnité, sous réserve du préavis réduit applicable à l'essai. L'engagement devient définitif à l'expiration de l'essai sans rupture notifiée.`
        : `This engagement is subject to a probationary period of ${t.probation_months} month(s) from the effective date.${ends} It may be renewed once only and in writing, within the limits set by the Labour Code and ${agreement(t, lang)}.\n\nDuring probation either party may end this contract without compensation, subject to the shorter notice that applies during probation. The engagement becomes final on expiry of the probationary period if no termination has been notified.`;
    },
  },

  {
    key: "place",
    kinds: ["EMPLOYMENT", "OFFER_LETTER"],
    statutory: true,
    title: { en: "Place of Work", fr: "Lieu de travail" },
    body: (t, lang) => {
      if (!t.place_of_work) return null;
      return lang === "fr"
        ? `Le Salarié exerce ses fonctions à ${t.place_of_work}.\n\nCompte tenu de l'activité de l'Employeur, le Salarié peut être appelé à se déplacer ou à être affecté à un autre site, dans les conditions prévues par le Code du travail et ${agreement(t, lang)}. Toute affectation durable fait l'objet d'un avenant écrit.`
        : `The Employee shall work at ${t.place_of_work}.\n\nGiven the Employer's activity, the Employee may be required to travel or be assigned to another site, on the conditions set by the Labour Code and ${agreement(t, lang)}. Any lasting reassignment shall be the subject of a written amendment.`;
    },
  },

  {
    key: "hours",
    kinds: ["EMPLOYMENT", "OFFER_LETTER"],
    statutory: true,
    title: { en: "Working Hours", fr: "Durée du travail" },
    body: (t, lang) => {
      const weekly = t.weekly_hours || DEFAULT_WEEKLY_HOURS;
      const stated = t.working_hours
        ? lang === "fr" ? ` L'horaire de travail est ${t.working_hours}.` : ` The working schedule is ${t.working_hours}.`
        : "";
      return lang === "fr"
        ? `La durée normale du travail est de ${decimal(weekly, lang)} heures par semaine.${stated}\n\nLes heures effectuées au-delà de cette durée sont des heures supplémentaires et sont rémunérées aux taux majorés fixés par la réglementation et ${agreement(t, lang)}. Le travail de nuit, du dimanche et des jours fériés obéit aux mêmes règles.`
        : `Normal working time is ${decimal(weekly, lang)} hours per week.${stated}\n\nHours worked beyond that are overtime and are paid at the enhanced rates set by the regulations and ${agreement(t, lang)}. Night work and work on Sundays and public holidays are governed by the same rules.`;
    },
  },

  {
    key: "remuneration",
    kinds: ["EMPLOYMENT", "OFFER_LETTER"],
    statutory: true,
    title: { en: "Remuneration", fr: "Rémunération" },
    body: (t, lang) => {
      const figure = pay(t, lang);
      if (!figure) return null;
      const extras = list(t.allowances || [], lang);
      const extraLine = extras
        ? lang === "fr" ? `\n\nS'y ajoutent : ${extras}.` : `\n\nIn addition: ${extras}.`
        : "";
      return lang === "fr"
        ? `Le Salarié perçoit une rémunération brute mensuelle de ${figure}, payable à terme échu au plus tard le dernier jour ouvrable du mois.${extraLine}\n\nL'Employeur opère sur cette rémunération les retenues légales et conventionnelles, notamment la cotisation de pension vieillesse CNPS et l'impôt sur le revenu des personnes physiques et ses additionnels. Un bulletin de paie est remis au Salarié à chaque paiement.`
        : `The Employee shall receive a gross monthly remuneration of ${figure}, payable in arrears no later than the last working day of the month.${extraLine}\n\nThe Employer shall make the statutory and contractual deductions from that remuneration, including the CNPS old-age pension contribution and personal income tax with its surcharges. A payslip is given to the Employee on each payment.`;
    },
  },

  {
    key: "social",
    kinds: ["EMPLOYMENT", "OFFER_LETTER"],
    statutory: true,
    title: { en: "Social Security and Medical Cover", fr: "Sécurité sociale et couverture médicale" },
    body: (t, lang) =>
      lang === "fr"
        ? `L'Employeur affilie le Salarié à la Caisse Nationale de Prévoyance Sociale et verse les cotisations mises à sa charge, y compris au titre des prestations familiales et des accidents du travail et maladies professionnelles.\n\nLe Salarié se soumet à la visite médicale d'embauche et aux visites périodiques organisées par l'Employeur. Tout accident survenu par le fait ou à l'occasion du travail est déclaré dans les délais réglementaires.`
        : `The Employer shall register the Employee with the Caisse Nationale de Prévoyance Sociale and pay the contributions due from it, including those for family benefits and for industrial accidents and occupational disease.\n\nThe Employee shall attend the pre-employment medical examination and the periodic examinations arranged by the Employer. Any accident arising out of or in the course of the work shall be reported within the time limits set by the regulations.`,
  },

  {
    key: "leave",
    kinds: ["EMPLOYMENT", "OFFER_LETTER"],
    statutory: true,
    title: { en: "Paid Leave", fr: "Congés payés" },
    body: (t, lang) => {
      const rate = t.leave_days_per_month || DEFAULT_LEAVE_DAYS_PER_MONTH;
      return lang === "fr"
        ? `Le Salarié acquiert un congé payé de ${decimal(rate, lang)} jour ouvrable par mois de service effectif, majoré le cas échéant au titre de l'ancienneté et des charges de famille dans les conditions prévues par la réglementation et ${agreement(t, lang)}.\n\nLa date du congé est arrêtée d'un commun accord compte tenu des nécessités du service. Le Salarié bénéficie en outre des jours fériés légaux et des permissions exceptionnelles prévues par ${agreement(t, lang)}.`
        : `The Employee accrues paid leave of ${decimal(rate, lang)} working day(s) for each month of actual service, increased where applicable for length of service and dependants on the conditions set by the regulations and ${agreement(t, lang)}.\n\nLeave dates are fixed by agreement having regard to the needs of the service. The Employee is also entitled to the statutory public holidays and to the special leave provided for by ${agreement(t, lang)}.`;
    },
  },

  {
    key: "absence",
    kinds: ["EMPLOYMENT"],
    statutory: true,
    title: { en: "Absence and Suspension", fr: "Absences et suspension" },
    body: (t, lang) =>
      lang === "fr"
        ? `Toute absence est préalablement autorisée. L'absence pour maladie ou accident est signalée à l'Employeur dans les quarante-huit heures et justifiée par un certificat médical.\n\nLe contrat est suspendu dans les cas prévus par le Code du travail, notamment la maladie, la maternité, le service national et la détention préventive. La suspension ne rompt pas le contrat et l'ancienneté continue de courir dans les conditions fixées par la loi.`
        : `All absence must be authorised in advance. Absence through illness or accident shall be notified to the Employer within forty-eight hours and supported by a medical certificate.\n\nThe contract is suspended in the cases provided for by the Labour Code, including illness, maternity, national service and remand in custody. Suspension does not terminate the contract and length of service continues to accrue on the conditions set by law.`,
  },

  {
    key: "obligations",
    kinds: ["EMPLOYMENT"],
    statutory: false,
    title: { en: "Obligations of the Employee", fr: "Obligations du Salarié" },
    body: (t, lang) =>
      lang === "fr"
        ? `Le Salarié exécute son travail avec diligence et probité, se conforme aux instructions qui lui sont données et respecte les règles d'hygiène et de sécurité en vigueur.\n\nIl prend soin du matériel, des véhicules, des documents et des marchandises qui lui sont confiés et en rend compte. Il ne peut les utiliser à des fins personnelles.`
        : `The Employee shall carry out the work with diligence and good faith, comply with the instructions given and observe the health and safety rules in force.\n\nThe Employee shall take care of the equipment, vehicles, documents and goods entrusted to them and shall account for them. They may not be used for personal purposes.`,
  },

  {
    key: "confidentiality",
    kinds: ["EMPLOYMENT", "TERMINATION"],
    statutory: false,
    title: { en: "Confidentiality", fr: "Confidentialité" },
    body: (t, lang) =>
      lang === "fr"
        ? `Le Salarié garde confidentielles les informations dont il a connaissance du fait de ses fonctions, notamment les tarifs, les marges, les dossiers clients, les déclarations en douane et les données personnelles des tiers.\n\nCette obligation s'applique pendant l'exécution du contrat et demeure après sa cessation, pour quelque cause que ce soit.`
        : `The Employee shall keep confidential the information they learn by reason of the position, including rates, margins, client files, customs declarations and the personal data of third parties.\n\nThis obligation applies during the contract and continues after it ends, for whatever reason.`,
  },

  {
    key: "conflict",
    kinds: ["EMPLOYMENT"],
    statutory: false,
    title: { en: "Conflict of Interest", fr: "Conflit d'intérêts" },
    body: (t, lang) =>
      lang === "fr"
        ? `Le Salarié consacre son activité professionnelle à l'Employeur. Il ne peut, sans autorisation écrite préalable, exercer une activité concurrente ni détenir un intérêt chez un client, un fournisseur, un transitaire ou un transporteur en relation d'affaires avec l'Employeur.\n\nIl déclare sans délai toute situation susceptible de le placer en conflit d'intérêts.`
        : `The Employee shall devote their professional activity to the Employer. Without prior written authorisation they may not carry on a competing activity or hold an interest in a client, supplier, forwarding agent or carrier doing business with the Employer.\n\nThey shall disclose without delay any situation liable to place them in a conflict of interest.`,
  },

  {
    key: "data",
    kinds: ["EMPLOYMENT"],
    statutory: false,
    title: { en: "Personal Data", fr: "Données personnelles" },
    body: (t, lang) =>
      lang === "fr"
        ? `L'Employeur traite les données personnelles du Salarié aux seules fins de la gestion du contrat, de la paie et des obligations déclaratives qui lui incombent. Elles sont conservées pendant la durée légale et communiquées aux seuls organismes habilités.\n\nLe Salarié peut en demander l'accès et la rectification auprès de la direction des ressources humaines.`
        : `The Employer processes the Employee's personal data solely for the administration of this contract, payroll and the reporting obligations imposed on it. The data is kept for the period required by law and disclosed only to the bodies entitled to receive it.\n\nThe Employee may ask the human resources department for access to it and for its correction.`,
  },

  {
    key: "policies",
    kinds: ["EMPLOYMENT", "OFFER_LETTER"],
    statutory: false,
    title: { en: "Company Rules and Policies", fr: "Règlement intérieur et procédures" },
    body: (t, lang) => {
      const titles = list(t.sop_titles || [], lang);
      const named = titles
        ? lang === "fr" ? ` notamment : ${titles}` : ` including: ${titles}`
        : "";
      return lang === "fr"
        ? `Le Salarié est soumis au règlement intérieur de l'Employeur et à ses procédures internes,${named || " en vigueur"}. Ces documents lui sont remis et peuvent être modifiés dans les formes prévues par la réglementation.`
        : `The Employee is bound by the Employer's internal rules and procedures,${named || " as in force"}. These are given to the Employee and may be amended in the manner provided by the regulations.`;
    },
  },

  {
    key: "discipline",
    kinds: ["EMPLOYMENT"],
    statutory: false,
    title: { en: "Discipline", fr: "Discipline" },
    body: (t, lang) =>
      lang === "fr"
        ? `Les manquements du Salarié exposent celui-ci aux sanctions prévues par le règlement intérieur, dans l'ordre et selon la procédure qu'il fixe. Le Salarié est entendu préalablement à toute sanction autre que l'avertissement écrit.`
        : `Breaches by the Employee render them liable to the sanctions set out in the internal rules, in the order and by the procedure those rules lay down. The Employee shall be heard before any sanction other than a written warning.`,
  },

  {
    key: "notice",
    kinds: ["EMPLOYMENT"],
    statutory: true,
    title: { en: "Notice and Termination", fr: "Préavis et rupture" },
    body: (t, lang) => {
      const days = t.notice_days;
      const agreed = days === null || days === undefined
        ? null
        : lang === "fr"
          ? `Les parties conviennent d'un préavis de ${days} jours.`
          : `The parties agree on a notice period of ${days} days.`;
      const head = lang === "fr"
        ? `Hors période d'essai, chaque partie peut rompre le contrat à durée indéterminée en notifiant par écrit un préavis. ${agreed || ""} En tout état de cause, le préavis ne peut être inférieur à celui fixé, pour la catégorie et l'ancienneté du Salarié, par la réglementation et ${agreement(t, lang)}.`
        : `Outside the probationary period, either party may end a contract of indefinite duration by giving written notice. ${agreed || ""} In any event the notice shall not be shorter than the period set, for the Employee's category and length of service, by the regulations and ${agreement(t, lang)}.`;
      const tail = lang === "fr"
        ? `\n\nLa partie qui n'observe pas le préavis verse à l'autre une indemnité compensatrice égale à la rémunération correspondante. Le licenciement est motivé et notifié par écrit.`
        : `\n\nA party that does not observe the notice shall pay the other compensation in lieu equal to the remuneration for that period. A dismissal shall state its reason and be notified in writing.`;
      return head.replace(/\s{2,}/g, " ") + tail;
    },
  },

  {
    key: "misconduct",
    kinds: ["EMPLOYMENT"],
    statutory: true,
    title: { en: "Serious Misconduct", fr: "Faute lourde" },
    body: (t, lang) =>
      lang === "fr"
        ? `La rupture pour faute lourde intervient sans préavis ni indemnité, dans les conditions et selon la procédure prévues par le Code du travail. L'appréciation de la faute relève en dernier ressort de la juridiction compétente.`
        : `Termination for serious misconduct takes effect without notice or compensation, on the conditions and by the procedure provided for by the Labour Code. Whether the conduct amounts to serious misconduct is ultimately for the competent court to decide.`,
  },

  {
    key: "final",
    kinds: ["EMPLOYMENT", "TERMINATION"],
    statutory: true,
    title: { en: "Final Settlement", fr: "Solde de tout compte" },
    body: (t, lang) =>
      lang === "fr"
        ? `À la cessation du contrat, l'Employeur établit le solde de tout compte comprenant le salaire dû, l'indemnité compensatrice de congés payés et, le cas échéant, l'indemnité de licenciement.\n\nIl délivre au Salarié un certificat de travail mentionnant les dates d'entrée et de sortie et la nature des emplois occupés. Le Salarié restitue l'ensemble des biens, documents et moyens d'accès appartenant à l'Employeur.`
        : `On termination the Employer shall draw up the final settlement comprising the salary due, compensation in lieu of accrued paid leave and, where applicable, severance pay.\n\nIt shall issue the Employee with a certificate of employment stating the dates of entry and departure and the nature of the posts held. The Employee shall return all property, documents and means of access belonging to the Employer.`,
  },

  {
    key: "disputes",
    kinds: ALL,
    statutory: true,
    title: { en: "Governing Law and Disputes", fr: "Droit applicable et différends" },
    body: (t, lang) =>
      lang === "fr"
        ? `Le présent contrat est régi par le droit camerounais, notamment le Code du travail, ses textes d'application et ${agreement(t, lang)}.\n\nTout différend né de son exécution ou de sa rupture est soumis à l'inspecteur du travail du ressort aux fins de tentative de conciliation. À défaut de conciliation, le litige est porté devant la juridiction compétente.`
        : `This contract is governed by Cameroonian law, in particular the Labour Code, its implementing instruments and ${agreement(t, lang)}.\n\nAny dispute arising from its performance or its termination shall be referred to the labour inspector for the district for attempted conciliation. Failing conciliation, the dispute shall be brought before the competent court.`,
  },

  {
    key: "entire",
    kinds: ["EMPLOYMENT"],
    statutory: false,
    title: { en: "Entire Agreement", fr: "Intégralité de l'accord" },
    body: (t, lang) =>
      lang === "fr"
        ? `Le présent contrat exprime l'intégralité de l'accord des parties et remplace tout engagement antérieur ayant le même objet. Toute modification fait l'objet d'un avenant écrit et signé des deux parties.\n\nLa nullité éventuelle d'une clause n'affecte pas la validité des autres.`
        : `This contract sets out the entire agreement between the parties and replaces any earlier undertaking on the same subject. Any change shall be the subject of a written amendment signed by both parties.\n\nIf any clause is held void, the remaining clauses continue in force.`,
  },

  /* ── the three other kinds ────────────────────────────────────────────── */

  {
    key: "offer_acceptance",
    kinds: ["OFFER_LETTER"],
    statutory: false,
    title: { en: "Acceptance of This Offer", fr: "Acceptation de l'offre" },
    body: (t, lang) => {
      const by = t.offer_valid_until
        ? lang === "fr" ? ` au plus tard le ${dmy(t.offer_valid_until)}` : ` no later than ${dmy(t.offer_valid_until)}`
        : "";
      return lang === "fr"
        ? `La présente offre est faite sous réserve des vérifications d'usage et de la production des pièces requises. Elle devient caduque à défaut d'acceptation écrite${by}.\n\nL'acceptation donne lieu à l'établissement d'un contrat de travail reprenant les conditions ci-dessus.`
        : `This offer is made subject to the usual checks and to production of the required documents. It lapses unless accepted in writing${by}.\n\nOn acceptance an employment contract setting out the above terms will be drawn up.`;
    },
  },

  {
    key: "confirmation",
    kinds: ["CONFIRMATION"],
    statutory: true,
    title: { en: "Confirmation of Employment", fr: "Confirmation d'emploi" },
    body: (t, lang) => {
      if (!t.job_title) return null;
      const since = t.effective_on
        ? lang === "fr" ? ` depuis le ${dmy(t.effective_on)}` : ` since ${dmy(t.effective_on)}`
        : "";
      const figure = pay(t, lang);
      const salary = figure
        ? lang === "fr" ? ` Sa rémunération brute mensuelle est de ${figure}.` : ` Their gross monthly remuneration is ${figure}.`
        : "";
      return lang === "fr"
        ? `${employer(t, lang)} atteste que ${t.employee_name} est employé en qualité de ${t.job_title}${since}.${salary}\n\nLa présente attestation est délivrée pour servir et valoir ce que de droit.`
        : `${employer(t, lang)} certifies that ${t.employee_name} is employed as ${t.job_title}${since}.${salary}\n\nThis certificate is issued for whatever purpose it may serve.`;
    },
  },

  {
    key: "termination_notice",
    kinds: ["TERMINATION"],
    statutory: true,
    title: { en: "Termination", fr: "Rupture du contrat" },
    body: (t, lang) => {
      if (!t.end_on) return null;
      const notice = t.notice_days === null || t.notice_days === undefined
        ? ""
        : lang === "fr"
          ? ` Le préavis de ${t.notice_days} jours court à compter de la notification de la présente.`
          : ` The notice period of ${t.notice_days} days runs from notification of this letter.`;
      const reason = t.termination_reason
        ? lang === "fr" ? `\n\nMotif : ${t.termination_reason}.` : `\n\nReason: ${t.termination_reason}.`
        : "";
      return lang === "fr"
        ? `${employer(t, lang)} notifie à ${t.employee_name} la rupture de son contrat de travail avec effet au ${dmy(t.end_on)}.${notice}${reason}`
        : `${employer(t, lang)} notifies ${t.employee_name} of the termination of their employment contract with effect from ${dmy(t.end_on)}.${notice}${reason}`;
    },
  },
];

/* ── the tenant layer ───────────────────────────────────────────────────────*/

/** The settings section a tenant's own contract configuration lives in. */
const SETTINGS_SECTION = "hr_contract";

/**
 * A tenant's own clause, as it arrives from settings.
 *
 * Validated rather than trusted: this is editable in the ERP and ends up in a
 * signed document, so a missing title or body drops the clause instead of
 * printing "undefined" on a contract.
 */
function normaliseCustom(raw, index) {
  if (!raw || typeof raw !== "object") return null;
  const key = String(raw.key || `custom_${index + 1}`).trim().slice(0, 40);
  const title = { en: String(raw.title_en || raw.title || "").trim(), fr: String(raw.title_fr || raw.title || "").trim() };
  const body = { en: String(raw.body_en || raw.body || "").trim(), fr: String(raw.body_fr || raw.body || "").trim() };
  if (!title.en && !title.fr) return null;
  if (!body.en && !body.fr) return null;
  const kinds = Array.isArray(raw.kinds) && raw.kinds.length
    ? raw.kinds.filter((k) => KINDS.includes(k))
    : ["EMPLOYMENT"];
  return {
    key,
    kinds: kinds.length ? kinds : ["EMPLOYMENT"],
    statutory: false,
    tenant: true,
    title: { en: title.en || title.fr, fr: title.fr || title.en },
    body: (_t, lang) => (lang === "fr" ? body.fr || body.en : body.en || body.fr) || null,
  };
}

/**
 * Which library clauses this tenant has switched off.
 *
 * A STATUTORY key in the list is ignored rather than refused. The list is a
 * stored preference that outlives the clause set: a key that is standard today
 * may become statutory tomorrow, and the tenant who disabled it then should get
 * a compliant contract now, not an error on a screen they are not looking at.
 */
function disabledSet(config) {
  const raw = (config && config.clauses && config.clauses.disabled) || [];
  const keys = new Set(Array.isArray(raw) ? raw.map(String) : []);
  for (const c of LIBRARY) if (c.statutory) keys.delete(c.key);
  return keys;
}

/** The tenant's configuration, with every default filled in. Never throws. */
function tenantConfig(section = {}) {
  const terms = (section && section.terms) || {};
  const employerBlock = (section && section.employer) || {};
  return {
    collective_agreement: (section && section.collective_agreement) || null,
    employer_cnps: employerBlock.cnps_number || null,
    weekly_hours: Number(terms.weekly_hours) > 0 ? Number(terms.weekly_hours) : DEFAULT_WEEKLY_HOURS,
    leave_days_per_month:
      Number(terms.leave_days_per_month) > 0 ? Number(terms.leave_days_per_month) : DEFAULT_LEAVE_DAYS_PER_MONTH,
    clauses: (section && section.clauses) || {},
  };
}

/**
 * Every clause that applies to this document, in order, already resolved to
 * one language.
 *
 * Returns `[{ key, title, body, statutory, tenant }]` with `body` a string —
 * clauses whose facts were not supplied are already gone.
 */
function clausesFor(terms, { kind = "EMPLOYMENT", lang = "en", config = {} } = {}) {
  const off = disabledSet(config);
  const custom = (((config.clauses || {}).custom) || [])
    .map(normaliseCustom)
    .filter(Boolean)
    .filter((c) => c.kinds.includes(kind) && !off.has(c.key));
  const out = [];
  for (const clause of [...LIBRARY, ...custom]) {
    if (!clause.kinds.includes(kind)) continue;
    if (!clause.statutory && off.has(clause.key)) continue;
    let body = null;
    try {
      body = clause.body(terms, lang);
    } catch {
      /* @silent:expected — a clause reads optional facts off `terms` and a
         shape it did not expect must drop that clause, never fail the whole
         draft. The result is a contract missing one article, which the review
         below reports, rather than no contract at all. */
      body = null;
    }
    if (!body) continue;
    out.push({
      key: clause.key,
      statutory: !!clause.statutory,
      tenant: !!clause.tenant,
      title: clause.title[lang] || clause.title.en,
      body: String(body).trim(),
    });
  }
  return out;
}

/** The clause set as the markdown `body_md` the renderer splits on `##`. */
function toMarkdown(clauses) {
  return clauses.map((c) => `## ${c.title}\n\n${c.body}`).join("\n\n");
}

/**
 * What is wrong with this contract, said plainly, before anybody signs it.
 *
 * Warnings, never corrections. Every item here is a term the PARTIES set, and a
 * product that silently shortened a fixed term to the statutory maximum would
 * be changing an agreement rather than reporting on it. The drafting screen
 * shows these; nothing is blocked.
 */
function review(terms, { kind = "EMPLOYMENT" } = {}) {
  const out = [];
  const add = (code, message) => out.push({ code, message });

  if (kind === "EMPLOYMENT" || kind === "OFFER_LETTER") {
    if (!terms.job_title) add("no_job_title", "No job title, so the engagement clause cannot be printed.");
    if (!terms.effective_on) add("no_start_date", "No start date, so the contract prints without a term clause.");
    if (terms.gross_salary === null || terms.gross_salary === undefined) {
      add("no_salary", "No salary agreed, so the remuneration clause is omitted.");
    }
    if (!terms.professional_category) {
      add("no_category", "No professional category. A Cameroonian contract is expected to state the classification under the applicable collective agreement, and the notice period and leave both read off it.");
    }
    if (!terms.place_of_work) add("no_place_of_work", "No place of work, so that clause is omitted.");

    if (terms.effective_on && terms.end_on) {
      const months = monthsBetween(terms.effective_on, terms.end_on);
      if (months !== null && months > FIXED_TERM_MAX_MONTHS) {
        add("fixed_term_too_long", `This fixed term runs about ${Math.round(months)} months. A fixed-term contract is limited to ${FIXED_TERM_MAX_MONTHS} months, renewable once; beyond that it is treated as a contract of indefinite duration.`);
      }
    }
    if (terms.probation_months && terms.probation_months > PROBATION_MAX_MONTHS) {
      add("probation_too_long", `A probationary period of ${terms.probation_months} months exceeds the ${PROBATION_MAX_MONTHS}-month ceiling, renewal included.`);
    }
    const weekly = terms.weekly_hours || DEFAULT_WEEKLY_HOURS;
    if (weekly > DEFAULT_WEEKLY_HOURS) {
      add("hours_above_statutory", `Normal working time is set at ${weekly} hours a week against a statutory ${DEFAULT_WEEKLY_HOURS}. The excess is overtime and is paid at the enhanced rate.`);
    }
    if (!terms.employer_cnps) {
      add("no_employer_cnps", "No CNPS employer number on file, so the parties clause cannot state it. Settings, People and HR.");
    }
  }

  if (kind === "TERMINATION" && !terms.end_on) {
    add("no_end_date", "No end date, so the termination clause cannot be printed.");
  }

  return out;
}

/** Whole months between two ISO dates, or null when either is unusable. */
function monthsBetween(fromIso, toIso) {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fromIso || ""));
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(toIso || ""));
  if (!a || !b) return null;
  const from = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const to = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  if (to < from) return null;
  return (to - from) / (1000 * 60 * 60 * 24 * 30.4375);
}

module.exports = {
  KINDS,
  SETTINGS_SECTION,
  DEFAULT_WEEKLY_HOURS,
  DEFAULT_LEAVE_DAYS_PER_MONTH,
  FIXED_TERM_MAX_MONTHS,
  PROBATION_MAX_MONTHS,
  LIBRARY,
  tenantConfig,
  clausesFor,
  toMarkdown,
  review,
  dmy,
  amount,
  monthsBetween,
};
