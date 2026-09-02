"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

/** A contract is a calendar fact — an accepted timestamp would put a timezone
 *  between the agreed start date and the probation date derived from it. */
const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in the form YYYY-MM-DD");

const create = z.object({
  employee_id: z.string().uuid().optional(),
  kind: z.enum(["OFFER_LETTER", "EMPLOYMENT", "CONFIRMATION", "TERMINATION"]),
  effective_on: d.optional(),
  end_on: d.optional(),
  status: z.enum(["DRAFT", "ISSUED", "SIGNED", "ENDED"]).optional(),
  pdf_vault_id: z.string().uuid().optional(),
  // Terms (0700). Editable directly as well as through a draft, because an HR
  // officer correcting a notice period should not have to re-run the model.
  title: z.string().max(200).optional(),
  body_md: z.string().max(60000).optional(),
  entity_id: z.string().uuid().optional(),
  job_title: z.string().max(160).optional(),
  gross_salary: z.number().nonnegative().optional(),
  salary_currency: z.string().length(3).optional(),
  probation_months: z.number().int().min(0).max(24).optional(),
  notice_days: z.number().int().min(0).max(365).optional(),
  working_hours: z.string().max(200).optional(),
  place_of_work: z.string().max(200).optional(),
  vacancy_id: z.string().uuid().optional(),
  renews_contract_id: z.string().uuid().optional(),
  signed_on: d.optional(),
  signed_by_name: z.string().max(160).optional(),
  countersigned_by_name: z.string().max(160).optional(),
});
const status = z.object({ status: z.enum(["DRAFT", "ISSUED", "SIGNED", "ENDED"]) });

/* What the wizard is holding but has not saved.
 *
 * Every one of these is a term the parties agreed; none of them is prose. The
 * composer fills an authored clause library from them, and a model — where one
 * is configured — only ever rephrases the single clause a library marks
 * `aiEditable`. Nothing here can reach the text except through a token, which
 * is why there is no `body_md` on this schema.
 *
 * All optional: an unset term either has a default the record already carries
 * or is a fact the composer will REFUSE on by name, which is a far better
 * error than a form that will not submit. */
const compose = z.object({
  language: z.enum(["fr", "en"]).optional(),
  /* Which of the eighteen. Only the six full-body keys are settable — the three
   * letter libraries are chosen by `hr_contract.kind`, not by the caller, so a
   * termination letter cannot be requested for an EMPLOYMENT contract. */
  employment_type: z.enum(["CDI", "CDD", "STAGE", "INTERIM", "CONSULTANT", "TEMPORARY"]).optional(),
  employer_person_id: z.string().uuid().optional(),
  job_title: z.string().max(160).optional(),
  effective_on: d.optional(),
  end_on: d.optional(),
  probation_ends_on: d.optional(),
  base_salary: z.number().nonnegative().optional(),
  salary_currency: z.string().length(3).optional(),
  /* Art. 25 caps a fixed term at two years, renewable once, so four years is
   * the outermost figure that can be lawful — and 24 alone would refuse the
   * renewal the article expressly allows. */
  duration_months: z.number().int().min(1).max(48).optional(),
  /* Art. 28: six months including any renewal. The DB does not constrain this
   * column (an imported record must still be storable); a contract this system
   * COMPOSES is a different matter — it is being written now, by us. */
  probation_months: z.number().int().min(0).max(6).optional(),
  notice_days: z.number().int().min(0).max(365).optional(),
  weekly_hours: z.number().int().min(1).max(60).optional(),
  working_hours: z.string().max(200).optional(),
  place_of_work: z.string().max(200).optional(),
  payment_method: z.enum(["BANK_TRANSFER", "MOBILE_MONEY", "CASH", "CHEQUE"]).optional(),
  place_signed: z.string().max(120).optional(),
  jurisdiction_city: z.string().max(120).optional(),
  /* Compose without calling the model — the same contract, minus the finish. */
  refine: z.boolean().optional(),
});

/** A renewal (10708). Only the two dates a caller may override — everything
 *  else is carried from the contract being renewed, by design: a renewal
 *  continues what was agreed, it does not re-negotiate it. */
const renew = z.object({
  effective_on: d.optional(),
  end_on: d.optional(),
});

const schemas = { create, update: create.partial(), status, compose, renew };

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = { create: mw("create"), update: mw("update"), status: mw("status"), compose: mw("compose"), renew: mw("renew"), schemas };
