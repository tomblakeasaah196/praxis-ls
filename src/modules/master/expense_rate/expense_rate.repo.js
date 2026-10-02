/** Expense-rate repository (MOD-10). All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

const WRITABLE = [
  "dictionary_item_id", "rate_provider_id", "container_type_ref_id", "rate", "currency", "effective_from", "effective_to", "provider_kind", "provider_supplier_id", "note",
  // 14344 — the VAT basis (meeting 6, F4). Written only through
  // expense_rate.service applyVatBasis, which keeps the four consistent.
  "price_includes_vat", "rate_ttc", "vat_rate_percent", "vat_tax_code_id",
];

const insert = (client, data) => insertOne(client, "expense_rate", data, "*", WRITABLE);
const get = (client, id) => getById(client, "expense_rate", "expense_rate_id", id);

// Joined with rate_provider + the container-type dictionary_ref row so every
// caller gets display-ready names without a second round trip.
const SELECT = `
  SELECT er.*, rp.kind AS provider_kind_resolved, rp.name AS provider_name,
         ct.code AS container_type_code, COALESCE(ct.name_en, ct.name_fr) AS container_type_name
    FROM expense_rate er
    LEFT JOIN rate_provider rp ON rp.rate_provider_id = er.rate_provider_id
    LEFT JOIN dictionary_ref ct ON ct.ref_id = er.container_type_ref_id`;

async function forItem(client, dictionaryItemId) {
  const { rows } = await client.query(`${SELECT} WHERE er.dictionary_item_id = $1 ORDER BY er.effective_from DESC`, [dictionaryItemId]);
  return rows;
}
async function update(client, id, fields) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, "expense_rate", "expense_rate_id", id, fields, "*", WRITABLE);
}
async function remove(client, id) { await client.query("DELETE FROM expense_rate WHERE expense_rate_id = $1", [id]); }
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const params = [limit, offset];
  const wh = [];
  if (q.dictionary_item_id) { params.push(q.dictionary_item_id); wh.push("er.dictionary_item_id = $" + params.length); }
  if (q.rate_provider_id) { params.push(q.rate_provider_id); wh.push("er.rate_provider_id = $" + params.length); }
  const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
  const { rows } = await client.query(`${SELECT} ${where} ORDER BY er.effective_from DESC LIMIT $1 OFFSET $2`, params);
  return rows;
}
// ── G7 import lookups — the tenant's real values for the template reference
// sheet and the validate/commit resolution. All rows are small registers; a
// per-row lookup would be 400 queries, these are one each. ────────────────

async function listDictionaryItems(c) {
  const { rows } = await c.query(
    "SELECT dictionary_item_id, code, name_en, name_fr FROM dictionary_item WHERE is_active ORDER BY name_en, name_fr",
  );
  return rows;
}

async function listProviders(c) {
  const { rows } = await c.query(
    "SELECT rate_provider_id, code, name FROM rate_provider WHERE is_active ORDER BY name",
  );
  return rows;
}

async function listContainerTypes(c) {
  const { rows } = await c.query(
    "SELECT ref_id, code, name_en, name_fr FROM dictionary_ref WHERE kind = 'CONTAINER_TYPE' AND is_active ORDER BY code",
  );
  return rows;
}

/**
 * The VAT rate a line's VAT-inclusive price is divided by (meeting 6, F4).
 *
 * The line's OWN tax code first — a VAT code on one of its posting rules, the
 * rule for the line's direction preferred (a sale for a revenue line, a
 * purchase otherwise) — because that is the rate the line is taxed at. Most
 * lines carry none (their VAT is decided where they are used), so the
 * fallback is the tenant's standard VAT rate in force on the day: TVA_STD when
 * there is one, else the newest sales VAT code. A 0 % code is a real answer
 * (zero-rated: TTC = HT), so only a NULL rate is skipped.
 */
async function lineVat(c, dictionaryItemId, onDate) {
  const { rows } = await c.query(
    `SELECT di.dictionary_item_id, di.is_disbursement, di.direction,
            own.tax_code_id, own.code, own.rate_percent
       FROM dictionary_item di
       LEFT JOIN LATERAL (
         SELECT tc.tax_code_id, tc.code::text AS code, tc.rate_percent
           FROM posting_rule pr
           JOIN tax_code tc ON tc.tax_code_id = pr.tax_code_id
          WHERE pr.dictionary_item_id = di.dictionary_item_id
            AND tc.kind = 'VAT' AND tc.rate_percent IS NOT NULL
          ORDER BY (pr.applies_context = CASE WHEN di.direction = 'REVENUE' THEN 'sale' ELSE 'purchase' END) DESC,
                   pr.created_at
          LIMIT 1
       ) own ON true
      WHERE di.dictionary_item_id = $1`,
    [dictionaryItemId],
  );
  const line = rows[0];
  if (!line) return null;
  if (line.rate_percent !== null && line.rate_percent !== undefined) return { ...line, source: "line" };
  const std = await c.query(
    `SELECT tax_code_id, code::text AS code, rate_percent
       FROM tax_code
      WHERE kind = 'VAT' AND rate_percent IS NOT NULL AND rate_percent > 0
        AND effective_from <= $1::date
        AND (effective_to IS NULL OR effective_to >= $1::date)
        AND (applies_to IS NULL OR applies_to = 'sales')
      ORDER BY (code = 'TVA_STD') DESC, effective_from DESC
      LIMIT 1`,
    [onDate],
  );
  const s = std.rows[0];
  return s ? { ...line, ...s, source: "standard" } : { ...line, source: null };
}

/**
 * Rates still in force, entered HT, whose note mentions a tax at all — the
 * coarse cut. The service keeps the ones whose note SAYS the price includes VAT
 * (`@praxis/shared` expenseRate.noteSaysTtc), so the wording rule has one home.
 */
async function vatNoteCandidates(c) {
  const { rows } = await c.query(
    `SELECT er.expense_rate_id, er.dictionary_item_id, er.rate, er.currency, er.effective_from, er.effective_to, er.note,
            er.rate_provider_id, er.container_type_ref_id,
            di.code AS item_code, di.label_fr AS item_label_fr, di.label_en AS item_label_en, di.is_disbursement,
            rp.name AS provider_name, ct.code AS container_type_code
       FROM expense_rate er
       JOIN dictionary_item di ON di.dictionary_item_id = er.dictionary_item_id
       LEFT JOIN rate_provider rp ON rp.rate_provider_id = er.rate_provider_id
       LEFT JOIN dictionary_ref ct ON ct.ref_id = er.container_type_ref_id
      WHERE er.price_includes_vat = false
        AND (er.effective_to IS NULL OR er.effective_to >= CURRENT_DATE)
        AND er.note ~* '(t\\.?\\s?t\\.?\\s?c|vat|tva|taxes)'
      ORDER BY di.code, er.effective_from DESC`,
  );
  return rows;
}

module.exports = { insert, get, forItem, update, remove, list, listDictionaryItems, listProviders, listContainerTypes, lineVat, vatNoteCandidates };
