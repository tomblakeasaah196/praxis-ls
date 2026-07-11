/**
 * Treasury accounts (MOD-09, KB §7) — bank / cash / MoMo accounts, each mapped to
 * a class-5 GL account. Used by invoicing, receipts, costing and disbursal.
 * All SQL is in the repo; validation is in the rules.
 */
"use strict";

const repo = require("./treasury_account.repo");
const events = require("./treasury_account.events");
const { assertCashAccount, assertMomo } = require("./treasury_account.rules");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "treasury_account:" + id;

async function create(client, { entityId, kind, label, coaCode, momoNetwork = null, momoFeeAccount = null, currency = "XAF", actor = {} }) {
  assertCashAccount(coaCode);
  assertMomo({ kind, momoNetwork, momoFeeAccount });
  await client.query("BEGIN");
  try {
    const row = await repo.insert(client, { entity_id: entityId, kind, label, coa_code: coaCode, momo_network: momoNetwork, momo_fee_account: momoFeeAccount, currency });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.treasury_account_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.treasury_account_id), after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Treasury account not found", 404);
  const fields = {};
  for (const k of ["label", "currency", "momo_network", "momo_fee_account"]) if (patch[k] !== undefined) fields[k] = patch[k];
  if (patch.coa_code !== undefined) { assertCashAccount(patch.coa_code); fields.coa_code = patch.coa_code; }
  assertMomo({ kind: before.kind, momoNetwork: fields.momo_network ?? before.momo_network, momoFeeAccount: fields.momo_fee_account ?? before.momo_fee_account });
  const row = await repo.update(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

async function setActive(client, { id, active, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Treasury account not found", 404);
  const row = await repo.update(client, id, { is_active: active === true });
  await audit(client, { actorUserId: actor.user_id || null, action: active ? "treasury_account.activated" : "treasury_account.deactivated", moduleKey: events.MODULE, entityRef: ref(id), after: row });
  return row;
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);
module.exports = { create, update, setActive, get, list };
