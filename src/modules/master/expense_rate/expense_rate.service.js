/**
 * Expense rate cards (MOD-10) — effective-dated tariff rows per dictionary
 * item, scoped by a rate provider (shipping line / airline / authority — NULL
 * means "the item's default") and a container type (NULL means "no equipment
 * dimension" — an authority fee per BL, an air rate priced by weight). The
 * resolver picks the most specific rate effective at a date, cascading down
 * to the carrier's general rate and then the plain default. SQL is in the repo.
 */
"use strict";

const repo = require("./expense_rate.repo");
const providerRepo = require("../rate_provider/rate_provider.repo");
const events = require("./expense_rate.events");
const rules = require("./expense_rate.rules");
const importer = require("./expense_rate.import");
const { resolveContext } = require("../../../services/spreadsheet");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { expenseRate } = require("@praxis/shared");

const ref = (id) => "expense_rate:" + id;
const today = () => new Date().toISOString().slice(0, 10);

/** provider_kind is a denormalised cache of rate_provider.kind, kept only so
 *  a rate row still reads as "an authority fee" without a join in the hot
 *  costing/simulation path — the FK is the source of truth. */
async function resolveProviderKind(client, rateProviderId) {
  if (!rateProviderId) return null;
  const p = await providerRepo.get(client, rateProviderId);
  if (!p) throw new AppError("NOT_FOUND", "Rate provider not found", 404);
  return p.kind;
}

/**
 * The VAT rate a line's VAT-inclusive price would be divided by, and whether
 * the question is offered at all (meeting 6, F4). The rate dialog shows it
 * before saving; applyVatBasis uses the same answer to store the HT.
 */
async function vatBasisFor(client, { dictionaryItemId, date = null }) {
  const line = await repo.lineVat(client, dictionaryItemId, date || today());
  if (!line) throw new AppError("NOT_FOUND", "Dictionary item not found", 404);
  const isDisbursement = line.is_disbursement === true;
  const rate = line.source && line.rate_percent !== null && line.rate_percent !== undefined ? Number(line.rate_percent) : null;
  return {
    dictionary_item_id: line.dictionary_item_id,
    is_disbursement: isDisbursement,
    // A débours is always HT; a line with no VAT rate anywhere cannot be divided.
    offered: !isDisbursement && rate !== null,
    vat_rate_percent: rate,
    tax_code_id: rate === null ? null : line.tax_code_id || null,
    tax_code: rate === null ? null : line.code || null,
    // "line" = the line's own tax code; "standard" = the tenant's standard rate.
    source: rate === null ? null : line.source,
  };
}

/**
 * The columns a rate writes for its VAT basis (meeting 6, F4).
 *
 * Off (the default): the figure IS the HT and is stored as given. On: the
 * figure is TTC — `rate` becomes TTC ÷ (1 + the line's VAT rate), unrounded
 * here (the numeric(18,2) column is the only rounding), and the typed figure
 * and the rate it was divided by are kept beside it so both can be shown.
 * Every reader of `expense_rate.rate` keeps reading HT, so a costing adds VAT
 * once. The four columns are only ever written together, from here — the
 * consistency rule 14344 leaves to the service rather than a CHECK.
 */
async function applyVatBasis(client, { dictionaryItemId, figure, priceIncludesVat = false, date = null }) {
  if (priceIncludesVat !== true) {
    return { rate: figure, price_includes_vat: false, rate_ttc: null, vat_rate_percent: null, vat_tax_code_id: null };
  }
  const basis = await vatBasisFor(client, { dictionaryItemId, date });
  if (basis.is_disbursement) {
    throw new AppError("DEBOURS_ALWAYS_HT", "A débours is always entered HT — it carries no VAT of ours, so “Price includes VAT” does not apply to it.", 422);
  }
  if (basis.vat_rate_percent === null) {
    throw new AppError("NO_VAT_RATE", "No VAT rate is set up for this line, so a VAT-inclusive price cannot be converted. Enter the HT figure instead.", 422);
  }
  return {
    rate: expenseRate.htFromTtc(figure, basis.vat_rate_percent),
    price_includes_vat: true,
    rate_ttc: Number(figure),
    vat_rate_percent: basis.vat_rate_percent,
    vat_tax_code_id: basis.tax_code_id,
  };
}

async function create(client, { dictionaryItemId, rateProviderId = null, containerTypeRefId = null, rate, currency = "XAF", effectiveFrom = null, effectiveTo = null, note = null, priceIncludesVat = false, actor = {} }) {
  if (!(Number(rate) >= 0)) throw new AppError("BAD_RATE", "rate must be >= 0", 422);
  const providerKind = await resolveProviderKind(client, rateProviderId);
  const from = effectiveFrom || today();
  const basis = await applyVatBasis(client, { dictionaryItemId, figure: rate, priceIncludesVat, date: from });
  const row = await repo.insert(client, {
    dictionary_item_id: dictionaryItemId,
    rate_provider_id: rateProviderId,
    container_type_ref_id: containerTypeRefId,
    provider_kind: providerKind,
    currency,
    effective_from: from,
    effective_to: effectiveTo,
    note,
    ...basis,
  });
  await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.expense_rate_id), after: row });
  return row;
}

async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Expense rate not found", 404);
  const fields = {};
  for (const k of ["rate_provider_id", "container_type_ref_id", "currency", "effective_from", "effective_to", "note"]) if (patch[k] !== undefined) fields[k] = patch[k];
  if (patch.rate_provider_id !== undefined) fields.provider_kind = await resolveProviderKind(client, patch.rate_provider_id);
  // The figure and its VAT basis move together (F4). A new figure keeps the
  // basis it had unless the patch says otherwise; turning the basis on or off
  // without a new figure re-reads the one the person last typed.
  if (patch.rate !== undefined || patch.price_includes_vat !== undefined) {
    const includes = patch.price_includes_vat !== undefined ? patch.price_includes_vat === true : before.price_includes_vat === true;
    const typed = before.price_includes_vat === true && before.rate_ttc !== null ? before.rate_ttc : before.rate;
    Object.assign(fields, await applyVatBasis(client, {
      dictionaryItemId: before.dictionary_item_id,
      figure: patch.rate !== undefined ? patch.rate : Number(typed),
      priceIncludesVat: includes,
      date: fields.effective_from || before.effective_from,
    }));
  }
  const row = await repo.update(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

async function remove(client, { id, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Expense rate not found", 404);
  await repo.remove(client, id);
  await audit(client, { actorUserId: actor.user_id || null, action: events.DELETED, moduleKey: events.MODULE, entityRef: ref(id), before });
  return { deleted: true };
}

/** Resolve the effective rate for an item at a date (used by simulators/costing). */
async function resolve(client, { dictionaryItemId, date = null, rateProviderId = null, containerTypeRefId = null }) {
  const rows = await repo.forItem(client, dictionaryItemId);
  return rules.pickRate(rows, { date: date || new Date().toISOString().slice(0, 10), rateProviderId, containerTypeRefId });
}

/**
 * Rates in force, entered HT, whose note says the price includes VAT ("TTC",
 * "VAT inclusive", "TVA incluse") — listed for a person to review, never
 * changed (F4: existing rates are not re-divided on a guess about a note).
 */
async function vatReview(client) {
  const rows = (await repo.vatNoteCandidates(client)).filter((r) => expenseRate.noteSaysTtc(r.note));
  return { count: rows.length, rates: rows };
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);

// ── G7: bulk Excel import (meeting §11.3) ───────────────────────────────────

/** The registers the template's Reference sheet and the row resolution read. */
async function importContext(client) {
  const [dictionaryItems, rateProviders, containerTypes] = await Promise.all([
    repo.listDictionaryItems(client),
    repo.listProviders(client),
    repo.listContainerTypes(client),
  ]);
  return { dictionaryItems, rateProviders, containerTypes };
}

/** The .xlsx a user downloads: the column contract + this tenant's real values.
 *  Branded via resolveContext on the caller's connection — the template is the
 *  artefact a customer sees first, so it wears the tenant's colours. */
async function importTemplate(client) {
  const [ctx, context] = await Promise.all([
    importContext(client),
    resolveContext(client, { title: "Expense rates — import template" }),
  ]);
  return importer.buildTemplate({ ...ctx, context });
}

/** Parse + validate an upload. Writes NOTHING — staging first, like the dict
 *  importer, so the user sees exactly what will be created before commit. */
async function importValidate(client, { buffer }) {
  const parsed = await importer.parseUploaded(buffer);
  const ctx = await importContext(client);
  const { valid, rejected } = rules.partitionImport(parsed.rows, ctx);
  return {
    sheet: parsed.sheet,
    parsed: parsed.rows.length,
    valid,
    rejected,
    summary: { total: parsed.rows.length, valid: valid.length, rejected: rejected.length },
  };
}

/**
 * Commit the valid rows. PARTIAL by design — each row is its own create, so a
 * 400-row import never rolls back wholesale because one row fails. Rows are
 * RE-validated server-side from the raw cell values (the client round-trip is
 * a convenience, not a security boundary), and each insert goes through
 * repo.insert's WRITABLE allow-list.
 */
async function importCommit(client, { rows = [], actor }) {
  const ctx = await importContext(client);
  const created = [];
  const rejected = [];
  for (const entry of rows) {
    const rowNumber = entry.row || null;
    const check = rules.validateImportRow(entry.raw || {}, rules.buildLookups(ctx));
    if (!check.valid) {
      rejected.push({ row: rowNumber, reasons: check.reasons, raw: entry.raw || {} });
      continue;
    }
    try {
      const row = await create(client, { ...check.data, actor });
      created.push({ row: rowNumber, expense_rate_id: row.expense_rate_id, rate: row.rate, dictionary_item_id: row.dictionary_item_id });
    } catch (err) {
      rejected.push({ row: rowNumber, reasons: [err.message || "could not be created"], raw: entry.raw || {} });
    }
  }
  const summary = { attempted: rows.length, created: created.length, rejected: rejected.length };
  if (created.length) {
    await emitEvent(client, { eventTypeKey: events.IMPORTED, moduleKey: events.MODULE, entityRef: "expense_rate:import", actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.IMPORTED, moduleKey: events.MODULE, entityRef: "expense_rate:import", after: summary });
  }
  return { created, rejected, summary };
}

module.exports = { create, update, remove, resolve, get, list, importTemplate, importValidate, importCommit, vatBasisFor, applyVatBasis, vatReview };
