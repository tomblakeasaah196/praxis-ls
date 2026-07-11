/**
 * Expense rate cards (MOD-10) — effective-dated tariff rows per dictionary item
 * (shipping line / container variant), feeding cost simulators and costing. The
 * resolver picks the most specific rate effective at a date. SQL is in the repo.
 */
"use strict";

const repo = require("./expense_rate.repo");
const events = require("./expense_rate.events");
const { pickRate } = require("./expense_rate.rules");
const { audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "expense_rate:" + id;

async function create(client, { dictionaryItemId, shippingLine = null, variant = null, rate, currency = "XAF", effectiveFrom = null, effectiveTo = null, actor = {} }) {
  if (!(Number(rate) >= 0)) throw new AppError("BAD_RATE", "rate must be >= 0", 422);
  const row = await repo.insert(client, { dictionary_item_id: dictionaryItemId, shipping_line: shippingLine, variant, rate, currency, effective_from: effectiveFrom || new Date().toISOString().slice(0, 10), effective_to: effectiveTo });
  await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.expense_rate_id), after: row });
  return row;
}

async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Expense rate not found", 404);
  const fields = {};
  for (const k of ["shipping_line", "variant", "rate", "currency", "effective_from", "effective_to"]) if (patch[k] !== undefined) fields[k] = patch[k];
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
async function resolve(client, { dictionaryItemId, date = null, shippingLine = null, variant = null }) {
  const rows = await repo.forItem(client, dictionaryItemId);
  return pickRate(rows, { date: date || new Date().toISOString().slice(0, 10), shippingLine, variant });
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);
module.exports = { create, update, remove, resolve, get, list };
