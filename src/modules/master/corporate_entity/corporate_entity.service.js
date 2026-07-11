/**
 * Corporate entities (MOD-01) — the legal companies a tenant operates. Every
 * dossier, invoice and ledger entry hangs off an entity_id. Code is unique; NIU/
 * RCCM, doc_prefix and fiscal-year-start drive numbering and statutory outputs.
 * All SQL is in the repo.
 */
"use strict";

const repo = require("./corporate_entity.repo");
const events = require("./corporate_entity.events");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "corporate_entity:" + id;

async function create(client, { code, legalName, niu = null, rccm = null, countryCode = "CM", address = null, bankBlock = {}, docPrefix = "SLS", defaultLanguage = "fr", fiscalYearStartMonth = 1, actor = {} }) {
  const existing = await repo.getByCode(client, code);
  if (existing) throw new AppError("DUPLICATE_CODE", "An entity with code " + code + " already exists", 409);
  if (fiscalYearStartMonth < 1 || fiscalYearStartMonth > 12) throw new AppError("BAD_MONTH", "fiscal_year_start_month must be 1-12", 422);
  await client.query("BEGIN");
  try {
    const row = await repo.insert(client, {
      code, legal_name: legalName, niu, rccm, country_code: countryCode, address,
      bank_block: JSON.stringify(bankBlock || {}), doc_prefix: docPrefix, default_language: defaultLanguage, fiscal_year_start_month: fiscalYearStartMonth,
    });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.entity_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.entity_id), after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Entity not found", 404);
  const fields = {};
  for (const k of ["legal_name", "niu", "rccm", "country_code", "address", "doc_prefix", "default_language", "fiscal_year_start_month"]) if (patch[k] !== undefined) fields[k] = patch[k];
  if (patch.bank_block !== undefined) fields.bank_block = JSON.stringify(patch.bank_block || {});
  if (fields.fiscal_year_start_month !== undefined && (fields.fiscal_year_start_month < 1 || fields.fiscal_year_start_month > 12)) throw new AppError("BAD_MONTH", "fiscal_year_start_month must be 1-12", 422);
  const row = await repo.update(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

async function setActive(client, { id, active, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Entity not found", 404);
  const row = await repo.update(client, id, { is_active: active === true });
  await audit(client, { actorUserId: actor.user_id || null, action: active ? "entity.activated" : "entity.deactivated", moduleKey: events.MODULE, entityRef: ref(id), after: row });
  return row;
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);
module.exports = { create, update, setActive, get, list };
