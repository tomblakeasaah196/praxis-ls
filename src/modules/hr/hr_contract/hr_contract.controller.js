"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler, AppError } = require("../../../utils/errors");
const service = require("./hr_contract.service");
const repo = require("./hr_contract.repo");
const refiner = require("./hr_contract.draft");
const composer = require("./hr_contract.compose");
const libraries = require("../../../services/contracts/libraries");

const base = makeController(service, "Contract");

module.exports = {
  ...base,
  mine: asyncHandler(async (req, res) => {
    const eid = req.user.employee_id;
    if (!eid) return res.json({ data: [] });
    return res.json({ data: await req.tenantDb((c) => service.list(c, { employee_id: eid })) });
  }),
  /**
   * Compose the contract from its clause library, then let a model finish the
   * one clause it is allowed to touch.
   *
   * ── WHY THIS IS THREE db CALLS AND NOT ONE ──────────────────────────────
   *
   * The refinement is a model call of several seconds, and this deployment runs
   * a 12-connection-per-tenant ceiling — holding a pooled connection across it
   * is how one slow provider takes the whole tenant's pool. So: read the
   * composition and release, refine with no connection held, then compose and
   * write.
   *
   * Composed BEFORE and AFTER the model, deliberately. The first pass is what
   * decides whether this contract can exist at all — it refuses, naming every
   * missing fact, before a token of AI budget is spent on a document that
   * cannot be produced.
   */
  composeFor: asyncHandler(async (req, res) => {
    const id = req.params.id;
    const body = req.body || {};
    const { row, sopTitles } = await req.tenantDb(async (c) => ({
      // The signatory the operator picked but has not saved — otherwise
      // choosing a different director and pressing Compose names the old one.
      row: await repo.composition(c, id, { employerPersonId: body.employer_person_id }),
      sopTitles: await repo.sopTitles(c),
    }));
    if (!row) throw new AppError("NOT_FOUND", "Contract not found", 404);

    // What the wizard is holding but has not saved. `build` reads only the keys
    // it knows, so an unexpected one in the body cannot become a term.
    const overrides = body;
    // Throws CONTRACT_FACT_MISSING (422, every missing fact named) rather than
    // producing a document with a hole in it.
    const first = composer.build(row, { overrides });

    const refinement = body.refine === false
      ? { overrides: {}, ai_generated: false, ai_model: null, rejected: [] }
      : await req.tenantDb((c) => refiner.refine(c, {
        libraryKey: first.columns.clause_library_key,
        language: first.columns.language,
        jobTitle: first.facts.terms.job_title,
        department: first.facts.terms.department,
        sopTitles,
      }));

    const built = Object.keys(refinement.overrides).length
      ? composer.build(row, { overrides, clauseOverrides: refinement.overrides })
      : first;

    const saved = await req.tenantDb((c) =>
      service.applyComposition(c, { id, built, refinement, actor: req.user || { user_id: null } }));
    if (!saved) throw new AppError("NOT_FOUND", "Contract not found", 404);
    res.json({
      data: {
        ...saved,
        /* What the composer actually did, travelling with the row it describes
         * rather than in a `meta` the client's fetch helper unwraps away.
         *
         * `omitted` is the point of it: an article dropped because its subject
         * does not exist is a deliberate act, and the operator has to be able
         * to see that their contract has no probation clause BECAUSE nobody
         * agreed a probation — as against because something went wrong. Same
         * for `ai_rejected`: a rewrite thrown away for changing a figure is
         * worth telling somebody about. */
        composition: {
          library: built.composed.library_key,
          version: built.composed.library_version,
          language: built.composed.language,
          articles: built.composed.articles.length,
          omitted: built.composed.omitted,
          ai_rejected: refinement.rejected,
        },
      },
    });
  }),

  /**
   * What this contract still needs, and what it would be composed from.
   *
   * Never throws on a missing fact — this is what the wizard asks as the
   * operator types, and an endpoint that 422s on an incomplete form cannot be
   * used to tell somebody what is incomplete about it.
   */
  readinessFor: asyncHandler(async (req, res) => {
    const overrides = req.query || {};
    const row = await req.tenantDb((c) =>
      repo.composition(c, req.params.id, { employerPersonId: overrides.employer_person_id }));
    if (!row) throw new AppError("NOT_FOUND", "Contract not found", 404);
    const state = composer.readiness(row, { overrides });
    const signatories = row.entity && row.entity.entity_id
      ? await req.tenantDb((c) => repo.signatories(c, row.entity.entity_id))
      : [];
    res.json({
      data: {
        ...state,
        // Who the employer would be bound by, and who it could be bound by —
        // so the wizard can show the choice rather than a resolved name the
        // operator cannot question.
        representative: row.representative && row.representative.person_id
          ? { person_id: row.representative.person_id, full_name: row.representative.full_name, title: row.representative.title, role: row.representative.role }
          : null,
        signatories,
      },
    });
  }),

  /** The clause libraries this deployment carries, for the wizard's picker. */
  libraries: asyncHandler(async (_req, res) => {
    res.json({
      data: libraries.all().map((l) => ({
        key: l.key, language: l.language, jurisdiction: l.jurisdiction,
        version: l.version, title: l.title, articles: l.articles.length,
      })),
    });
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
