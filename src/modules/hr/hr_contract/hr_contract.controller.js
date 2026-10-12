// search:none — a contract is a row of an employee, read on their 360 (Contracts tab).
"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler, AppError } = require("../../../utils/errors");
const service = require("./hr_contract.service");
const repo = require("./hr_contract.repo");
const drafter = require("./hr_contract.draft");
const clauses = require("./hr_contract.clauses");
const { getSection } = require("../../../shared/config/settings");
const signatureRepo = require("../../vault/document_signature/document_signature.repo");
const { logger } = require("../../../config/logger");

const base = makeController(service, "Contract");

/** The probation end date, computed the SAME way the service computes it.
 *  Shared through `service.addMonths` rather than re-derived, so the date the
 *  probation clause prints and the date the watcher scans cannot differ. */
function probationEndsFor(terms) {
  return terms.effective_on && terms.probation_months
    ? service.addMonths(terms.effective_on, terms.probation_months)
    : null;
}

module.exports = {
  ...base,
  mine: asyncHandler(async (req, res) => {
    const eid = req.user.employee_id;
    if (!eid) return res.json({ data: [] });
    return res.json({ data: await req.tenantDb((c) => service.list(c, { employee_id: eid })) });
  }),
  /**
   * Draft the contract text with the model.
   *
   * ── WHY THIS IS THREE db CALLS AND NOT ONE ──────────────────────────────
   *
   * The model call takes seconds, and this deployment runs a
   * 12-connection-per-tenant ceiling — holding a pooled connection across it is
   * how one slow provider takes the whole tenant's pool. So: read the context
   * and release, call the model with no connection held, then write.
   *
   * `llm.chat` is given the client only to resolve the tenant's configured
   * vendor, which is why that read is its own short-lived call rather than
   * being folded into the write below.
   */
  draftFor: asyncHandler(async (req, res) => {
    const id = req.params.id;
    /* The tenant's own contract configuration rides along with the context read
     * (14402). It is what makes the statutory library tenant-specific — their
     * collective agreement, their CNPS employer number, their working week,
     * their own extra clauses — and reading it here rather than inside the
     * drafter keeps the model call holding no connection, which is the whole
     * reason this handler is three db calls and not one. */
    const context = await req.tenantDb(async (c) => ({
      row: await repo.context(c, id),
      sopTitles: await repo.sopTitles(c),
      config: await getSection(c, clauses.SETTINGS_SECTION),
    }));
    if (!context.row) throw new AppError("NOT_FOUND", "Contract not found", 404);
    const row = context.row;
    const body = req.body || {};

    // What the model is told. The employee's current job title and salary are
    // OFFERED as defaults where the caller stated nothing — an HR officer
    // drafting a confirmation letter for somebody already employed should not
    // have to retype what the system knows. Anything the caller did state wins.
    const terms = {
      title: body.title,
      entity_id: body.entity_id ?? row.entity_id ?? null,
      /* The language the contract is WRITTEN in. The caller's pick, then
       * whatever this contract was last drafted in, then the hiring entity's
       * own default. Never the operator's UI language: a Cameroonian employer
       * whose staff read French does not issue English contracts because the
       * HR officer happens to have the app in English. */
      language: body.language ?? row.language ?? (row.entity_language === "fr" ? "fr" : "en"),
      professional_category: body.professional_category ?? row.professional_category ?? null,
      job_title: body.job_title ?? row.employee_job_title ?? row.vacancy_title ?? null,
      effective_on: body.effective_on ?? row.effective_on ?? null,
      end_on: body.end_on ?? row.end_on ?? null,
      gross_salary: body.gross_salary ?? (row.base_salary === null ? null : Number(row.base_salary)),
      salary_currency: body.salary_currency || "XAF",
      probation_months: body.probation_months ?? null,
      notice_days: body.notice_days ?? drafter.DEFAULT_NOTICE_DAYS,
      working_hours: body.working_hours ?? null,
      place_of_work: body.place_of_work ?? null,
      vacancy_id: body.vacancy_id ?? row.vacancy_id ?? null,
    };

    const draft = await req.tenantDb((c) =>
      drafter.draft(c, {
        ...terms,
        kind: row.kind,
        employee_name: row.employee_name,
        employee_cnps: row.employee_cnps,
        department: row.department,
        reports_to: body.reports_to ?? null,
        entity_name: row.entity_name,
        entity_country: row.entity_country,
        entity_address: row.entity_address,
        entity_rccm: row.entity_rccm,
        entity_niu: row.entity_niu,
        // The probation end date the service is about to compute, so the
        // clause can state it rather than leaving the reader to count months.
        probation_ends_on: probationEndsFor(terms),
        sop_titles: context.sopTitles,
      }, { config: context.config }));

    const saved = await req.tenantDb((c) =>
      service.applyDraft(c, { id, draft, terms, actor: req.user || { user_id: null } }));
    if (!saved) throw new AppError("NOT_FOUND", "Contract not found", 404);
    /* `review` rides ON the row rather than beside it, because `api-client`
     * hands the caller `json.data` and nothing else — a sibling key would be
     * dropped before the screen ever saw it.
     *
     * It is NOT a column and is deliberately not stored. It is a reading of the
     * terms as they are right now: change the salary and it changes, fill in
     * the category and it goes away. Persisting it would mean showing an HR
     * officer a warning about a figure somebody has since corrected. */
    res.json({ data: { ...saved, review: draft.review } });
  }),

  /**
   * The compliance review of terms as they stand, without drafting anything.
   *
   * ── WHY THIS IS AN ENDPOINT AND NOT A CLIENT-SIDE CHECK ─────────────────
   *
   * The rules are in `hr_contract.clauses.review`, beside the clauses they are
   * about, and two of them need facts the browser does not hold: the tenant's
   * configured working week, and whether a CNPS employer number is on file. A
   * second copy in TypeScript would be a second set of statutory limits to
   * keep in step with the first, which is how one of them ends up a year out
   * of date.
   *
   * `view`, not `edit`: it writes nothing, spends no model call, and an HR
   * officer who may read a contract should be told what is wrong with it. The
   * drafting screen calls it as the terms change, so a twenty-year fixed term
   * is flagged while somebody is setting it rather than after they generate.
   */
  reviewTerms: asyncHandler(async (req, res) => {
    const id = req.params.id;
    const body = req.body || {};
    const { row, config } = await req.tenantDb(async (c) => ({
      row: await repo.context(c, id),
      config: await getSection(c, clauses.SETTINGS_SECTION),
    }));
    if (!row) throw new AppError("NOT_FOUND", "Contract not found", 404);

    // The same merge `draftFor` performs, so the warning a draft returns and
    // the warning the screen shows beforehand cannot disagree.
    const tenant = clauses.tenantConfig(config);
    const terms = {
      kind: row.kind,
      job_title: body.job_title ?? row.employee_job_title ?? null,
      professional_category: body.professional_category ?? row.professional_category ?? null,
      effective_on: body.effective_on ?? row.effective_on ?? null,
      end_on: body.end_on ?? row.end_on ?? null,
      gross_salary: body.gross_salary ?? (row.gross_salary === null ? null : Number(row.gross_salary)),
      probation_months: body.probation_months ?? row.probation_months ?? null,
      place_of_work: body.place_of_work ?? row.place_of_work ?? null,
      employer_cnps: tenant.employer_cnps,
      weekly_hours: tenant.weekly_hours,
    };
    res.json({ data: { review: clauses.review(terms, { kind: row.kind }) } });
  }),

  /**
   * Everything the contract page shows besides the contract itself: where it
   * sits in its renewal chain, the employee's other contracts, and who has
   * signed it.
   *
   * One endpoint rather than four, because the page opens on all of it at
   * once and four round trips on a 12-connection-per-tenant ceiling is four
   * chances for the screen to render half-built.
   *
   * Signatures are best-effort. A contract that cannot be read is a 404; a
   * SIGNATURE LIST that cannot be read is a panel that says nothing, and
   * failing the whole page over it would take the editor down with it.
   */
  dossier: asyncHandler(async (req, res) => {
    const id = req.params.id;
    const data = await req.tenantDb(async (c) => {
      const row = await repo.context(c, id);
      if (!row) return null;
      let signatures = [];
      try {
        /* PROJECTED DOWN, not passed through. `listByRef` returns every column,
         * and two of them have no business on this page: `content_payload` is
         * the whole canonical document (the salary included) and
         * `mark_image_b64` is a base64 signature image. Shipping both to the
         * browser for a status panel is weight nobody asked for and a wider
         * disclosure than the panel needs — the page shows who signed, in what
         * capacity, when, and whether it still stands. */
        const rows = await signatureRepo.listByRef(c, `hr_contract:${id}`);
        signatures = rows.map((r) => ({
          signature_id: r.signature_id,
          signer_name: r.signer_name,
          signer_role: r.signer_role,
          party: r.party,
          assurance_level: r.assurance_level,
          sign_reason: r.sign_reason,
          signed_at: r.signed_at,
          revoked_at: r.revoked_at,
        }));
      } catch (err) {
        /* @silent:expected — the signature module is optional furniture on this
           page. Logged rather than swallowed so a real failure is visible,
           but the editor must still open. */
        logger.warn({ err, id }, "[hr_contract] signature list failed — panel left empty");
      }
      return { chain: await repo.chain(c, id), signatures };
    });
    if (!data) throw new AppError("NOT_FOUND", "Contract not found", 404);
    res.json({ data });
  }),

  /**
   * Renew a contract (10708) — the new DRAFT lands on top of the list, terms
   * carried over, ready to be drafted with the new dates and sent.
   */
  renewFor: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) =>
      service.renew(c, {
        id: req.params.id,
        effective_on: req.body.effective_on ?? null,
        end_on: req.body.end_on ?? null,
        actor: req.user || { user_id: null },
      }));
    if (!row) throw new AppError("NOT_FOUND", "Contract not found", 404);
    res.status(201).json({ data: row });
  }),

  /** What lapses soon — the query nothing could answer before 0700. */
  lapsing: asyncHandler(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 60, 1), 365);
    const data = await req.tenantDb(async (c) => ({
      expiring: await repo.lapsingWithin(c, { days, kind: "expiry" }),
      probation: await repo.lapsingWithin(c, { days, kind: "probation" }),
    }));
    res.json({ data });
  }),

  setStatus: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.setStatus(c, { id: req.params.id, status: req.body.status, actor: req.user || { user_id: null } }));
    if (!row) throw new AppError("NOT_FOUND", "Contract not found", 404);
    res.json({ data: row });
  }),
};
