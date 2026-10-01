"use strict";
const repo = require("./financial_dictionary.repo");
const events = require("./financial_dictionary.events");
const rules = require("./financial_dictionary.rules");
const importer = require("./financial_dictionary.import");
const { resolveContext } = require("../../../services/spreadsheet");
const { emitEvent, audit } = require("../../../shared/events/emit");
const currencyRepo = require("../currency/currency.repo");
const expenseRateService = require("../expense_rate/expense_rate.service");
const { page } = require("../../../shared/db/query-helpers");
const crypto = require("crypto");
const { dictionarySibling, dictionaryPosting } = require("@praxis/shared");
const postingEngine = require("../../../services/ai/dictionary-posting/engine.service");
const { AppError } = require("../../../utils/errors");

// The only columns a caller may write on dictionary_item. `code`, ids and the
// timestamps are server-owned; picking an explicit set (never spreading the
// whole row) is what keeps update from rewriting created_at or the PK.
//
// `default_price` is NOT here. Since 14120 an item's price is its standard
// expense rate (expense_rate/standard-rate.sql.js); `create` turns a price in
// the payload into that rate, and nothing writes the retired column again.
const ITEM_COLS = [
  "label_fr", "label_en", "description", "category", "direction", "subcategory",
  "unit_of_measure", "applicability_mode", "is_disbursement", "is_billable",
  "currency", "shipping_line", "provider_kind", "proof_source",
  "requires_justification", "receipt_requirement", "disbursement_vat_transparent",
  "pricing_mode", "is_active", "service_type_key", "client_heading_ref_id",
];

const listItems = (c, q) => repo.listItems(c, q);

/** A sibling as a picker receives it: the hit shape plus its mode. */
const asSibling = (r) => ({ ...r, mode: dictionarySibling.modeOf(r.direction) });

/** Group rows by sibling_group, each group ordered as the question offers it. */
function byGroup(rows) {
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.sibling_group)) out.set(r.sibling_group, []);
    out.get(r.sibling_group).push(asSibling(r));
  }
  for (const [k, v] of out) out.set(k, dictionarySibling.orderSiblings(v));
  return out;
}

/**
 * The shared finder. The ranking is the query's job (repo); this adds the
 * siblings (meeting 6, F2).
 *
 * A service the catalogue holds in several fulfilment modes — "Gate-Pass Fee"
 * (our own cost) and "Gate-Pass Fee — Client Account" (débours) — comes back
 * ONCE, at the rank of its best-matching row, carrying every mode in
 * `siblings` and its name without the suffix in `group_label_*`. The picker
 * then asks one question and the answer chooses the row. `group: false` (the
 * service-type mapping screen, which maps each row) or a `direction` filter (a
 * cash request only ever advances débours) returns the rows one by one, still
 * carrying their siblings.
 */
async function searchItems(c, q = {}) {
  const rows = await repo.searchItems(c, q);
  const groups = [...new Set(rows.map((r) => r.sibling_group).filter(Boolean))];
  const members = byGroup(await repo.siblingsOfGroups(c, groups, { includeInactive: q.include_inactive === true }));
  const collapse = q.group !== false && !q.direction;
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const sibs = r.sibling_group ? members.get(r.sibling_group) || [] : [];
    const grouped = sibs.length > 1;
    if (collapse && grouped) {
      if (seen.has(r.sibling_group)) continue;
      seen.add(r.sibling_group);
    }
    out.push({
      ...asSibling(r),
      siblings: grouped ? sibs : [],
      group_label_en: grouped ? dictionarySibling.baseLabel(r.label_en) : null,
      group_label_fr: grouped ? dictionarySibling.baseLabel(r.label_fr) : null,
    });
  }
  return out;
}

/**
 * For each dictionary line, its mode and its siblings — what the line guard
 * reads to say "this is our own cost on a client-billed line" and to offer the
 * one-tap switch. `{ [id]: { mode, sibling_group, siblings } }`.
 */
async function siblingsFor(c, ids = []) {
  const uniq = [...new Set(ids.filter(Boolean))].slice(0, 200);
  const items = await repo.itemsWithGroup(c, uniq);
  const groups = [...new Set(items.map((i) => i.sibling_group).filter(Boolean))];
  const members = byGroup(await repo.siblingsOfGroups(c, groups));
  const out = {};
  for (const i of items) {
    const sibs = i.sibling_group ? members.get(i.sibling_group) || [] : [];
    out[i.dictionary_item_id] = {
      dictionary_item_id: i.dictionary_item_id,
      direction: i.direction,
      mode: dictionarySibling.modeOf(i.direction),
      sibling_group: i.sibling_group || null,
      siblings: sibs.length > 1 ? sibs : [],
    };
  }
  return out;
}

/* ── The AI-suggested OHADA posting (meeting 6, F3 / F7 / F8) ─────────────── */

/**
 * Suggest the SYSCOHADA posting of a line from its label, category and
 * (when chosen) direction. Cache first, then a grounded call, else the
 * labelled local suggestion — see services/ai/dictionary-posting. Saves
 * nothing: the wizard pre-fills from it and a person saves.
 */
const suggestPosting = (c, data, actor = {}) =>
  postingEngine.suggest(c, data, { userId: actor.user_id || null });

/**
 * Audit where an AI-suggested posting came from and what the person did with
 * it (F3): accepted as suggested, or changed — and who. Provenance that does
 * not match the shared contract is dropped with a warning rather than failing
 * the save: it is the audit trail of a suggestion, not part of the line.
 */
async function auditSuggestion(c, { item, provenance, savedRules, actor }) {
  if (!provenance) return;
  const p = dictionaryPosting.provenance.safeParse(provenance);
  if (!p.success) return;
  const key = (r) => `${r.applies_context}|${r.debit_account || ""}|${r.credit_account || ""}`;
  const suggested = new Set(p.data.suggested_rules.map(key));
  const saved = new Set((savedRules || []).map(key));
  const accepted = suggested.size === saved.size && [...suggested].every((k) => saved.has(k)) && p.data.direction === item.direction;
  await audit(c, {
    actorUserId: actor.user_id || null,
    action: events.POSTING_SUGGESTED,
    moduleKey: events.MODULE,
    entityRef: `dict:${item.code}`,
    after: {
      source: p.data.source,
      model: p.data.model || null,
      cache_entry_id: p.data.cache_entry_id || null,
      confidence: p.data.confidence,
      checked: p.data.checked === true,
      outcome: accepted ? "accepted" : "changed",
      suggested: { direction: p.data.direction, rules: p.data.suggested_rules },
      saved: { direction: item.direction, rules: savedRules },
    },
  });
}

/* ── One review of the existing lines' postings (F8) ──────────────────────── */

/** Fresh grounded calls one review run may make; the rest use the cache or say so. */
const REVIEW_CALL_CAP = 250;

/** The last review run, with the lines whose posting differs from the suggestion. */
async function latestReview(c) {
  const { rows: [review] } = await c.query(
    "SELECT * FROM dictionary_posting_review ORDER BY started_at DESC LIMIT 1",
  );
  if (!review) return { review: null, lines: [] };
  const { rows: lines } = await c.query(
    `SELECT l.dictionary_item_id, l.outcome, l.reasons, l.suggestion, l.source, l.model, l.confidence, l.examined_at,
            di.code::text AS code, di.label_en, di.label_fr, di.direction, di.category
       FROM dictionary_posting_review_line l
       JOIN dictionary_item di ON di.dictionary_item_id = l.dictionary_item_id
      WHERE l.review_id = $1 AND l.outcome <> 'match'
      ORDER BY (l.outcome = 'mismatch') DESC, di.code`,
    [review.review_id],
  );
  return { review, lines };
}

/**
 * Start the review (or return the one already running). It runs in the worker
 * — `dictionary-posting-review` — and changes NOTHING: it lists the lines whose
 * posting differs from the suggestion, for a person to apply through the
 * ordinary edit.
 */
async function startReview(c, { actor = {}, enqueue }) {
  const { rows: [open] } = await c.query(
    `SELECT * FROM dictionary_posting_review
      WHERE status IN ('queued', 'running') AND started_at > now() - interval '6 hours'
      ORDER BY started_at DESC LIMIT 1`,
  );
  if (open) return { review: open, already_running: true };
  const { rows: [review] } = await c.query(
    `INSERT INTO dictionary_posting_review (started_by, total)
     VALUES ($1, (SELECT count(*) FROM dictionary_item WHERE is_active = true))
     RETURNING *`,
    [actor.user_id || null],
  );
  await audit(c, { actorUserId: actor.user_id || null, action: events.POSTING_REVIEW_STARTED, moduleKey: events.MODULE, entityRef: `dict_review:${review.review_id}`, after: review });
  await enqueue(review);
  return { review, already_running: false };
}

/** Why a line's posting differs from the suggestion, in one line each. Pure. */
function postingDifferences(item, current, suggestion) {
  const reasons = [];
  if (suggestion.direction !== item.direction) reasons.push(`direction: ${item.direction} here, ${suggestion.direction} suggested`);
  if (Boolean(suggestion.is_disbursement) !== Boolean(item.is_disbursement)) {
    reasons.push(suggestion.is_disbursement ? "suggested as a débours (re-billed at cost, no VAT)" : "suggested as not a débours");
  }
  const byCtx = new Map(current.map((r) => [r.applies_context, r]));
  for (const s of suggestion.rules) {
    const have = byCtx.get(s.applies_context);
    if (!have) {
      reasons.push(`${s.applies_context}: no rule here, suggested ${s.debit_account || s.mapping.debit.suggested} / ${s.credit_account || s.mapping.credit.suggested}`);
      continue;
    }
    if (s.debit_account && String(have.debit_account) !== String(s.debit_account)) reasons.push(`${s.applies_context}: debit ${have.debit_account} here, ${s.debit_account} suggested`);
    if (s.credit_account && String(have.credit_account) !== String(s.credit_account)) reasons.push(`${s.applies_context}: credit ${have.credit_account} here, ${s.credit_account} suggested`);
  }
  return reasons;
}

/**
 * The worker's half: examine every active line not yet examined in this run
 * (so a restarted job RESUMES rather than paying twice), cache first.
 */
async function runReview(c, reviewId) {
  const { rows: [review] } = await c.query("SELECT * FROM dictionary_posting_review WHERE review_id = $1", [reviewId]);
  if (!review || review.status === "done") return review || null;
  await c.query("UPDATE dictionary_posting_review SET status = 'running', error = NULL WHERE review_id = $1", [reviewId]);
  const callBudget = { left: Math.max(0, REVIEW_CALL_CAP - Number(review.fresh_calls || 0)) };
  try {
    const { rows: items } = await c.query(
      `SELECT di.dictionary_item_id, di.code::text AS code, di.label_fr, di.label_en, di.category, di.direction, di.is_disbursement
         FROM dictionary_item di
        WHERE di.is_active = true
          AND NOT EXISTS (SELECT 1 FROM dictionary_posting_review_line l
                           WHERE l.review_id = $1 AND l.dictionary_item_id = di.dictionary_item_id)
        ORDER BY di.code`,
      [reviewId],
    );
    for (const item of items) {
      const before = callBudget.left;
      const sug = await postingEngine.suggest(
        c,
        { label_fr: item.label_fr, label_en: item.label_en, category: item.category, direction: item.direction },
        { userId: review.started_by, excludeId: item.dictionary_item_id, callBudget },
      );
      const current = await repo.listRules(c, item.dictionary_item_id);
      let outcome;
      let reasons;
      if (sug.source === "local") {
        // No web-grounded answer to compare with: said so, not called a mismatch.
        outcome = "no_suggestion";
        reasons = [sug.fallback_reason || "no web search answer"];
      } else {
        reasons = postingDifferences(item, current, sug);
        outcome = reasons.length ? "mismatch" : "match";
      }
      await c.query(
        `INSERT INTO dictionary_posting_review_line
           (review_id, dictionary_item_id, outcome, reasons, suggestion, source, model, cache_entry_id, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (review_id, dictionary_item_id) DO NOTHING`,
        [
          reviewId, item.dictionary_item_id, outcome, reasons,
          // Our structured posting only — never Google's text or links.
          JSON.stringify({ direction: sug.direction, is_disbursement: sug.is_disbursement, vat_treatment: sug.vat_treatment, rules: sug.rules.map(({ mapping: _m, ...r }) => r), generic: sug.generic }),
          sug.source, sug.model, sug.cache_entry_id, sug.confidence,
        ],
      );
      await c.query(
        `UPDATE dictionary_posting_review
            SET examined = examined + 1,
                mismatches = mismatches + $2,
                fresh_calls = fresh_calls + $3
          WHERE review_id = $1`,
        [reviewId, outcome === "mismatch" ? 1 : 0, before - callBudget.left],
      );
    }
    await c.query("UPDATE dictionary_posting_review SET status = 'done', finished_at = now() WHERE review_id = $1", [reviewId]);
  } catch (err) {
    await c.query("UPDATE dictionary_posting_review SET status = 'failed', error = $2 WHERE review_id = $1", [reviewId, String(err.message || err).slice(0, 500)]);
    throw err;
  }
  const { rows: [done] } = await c.query("SELECT * FROM dictionary_posting_review WHERE review_id = $1", [reviewId]);
  return done;
}

/** The lines 14342 could not pair, for a person to link or confirm. */
const unpairedLines = (c) => repo.unpairedLines(c);

/**
 * Link a line to another line's service, or confirm it stands alone — the
 * person's answer to "Lines to pair".
 *
 * A group holds ONE row per mode: linking a second débours row to a group that
 * already has one is refused, because the picker could not say which of the two
 * "Billed to the client at cost" means.
 */
async function linkSibling(c, { id, linkTo = null, standsAlone = false, actor = {} }) {
  const item = await repo.getItemRow(c, id);
  if (!item) return null;
  const userId = actor.user_id || null;
  await c.query("BEGIN");
  try {
    let after;
    if (standsAlone) {
      const old = item.sibling_group;
      await repo.setSiblingGroup(c, [id], null, userId);
      await repo.dissolveSingleton(c, old);
      after = { sibling_group: null, stands_alone: true };
    } else {
      if (!linkTo || linkTo === id) throw new AppError("VALIDATION_ERROR", "Pick the other line of the same service to link to.", 422);
      const target = await repo.getItemRow(c, linkTo);
      if (!target) throw new AppError("NOT_FOUND", "The line to link to was not found", 404);
      const group = target.sibling_group || item.sibling_group || crypto.randomUUID();
      const { rows: clash } = await c.query(
        "SELECT code FROM dictionary_item WHERE sibling_group = $1 AND direction = $2 AND dictionary_item_id <> $3 LIMIT 1",
        [group, item.direction, id],
      );
      if (clash[0] || (target.direction === item.direction)) {
        throw new AppError(
          "SIBLING_MODE_TAKEN",
          `That service already has a ${dictionarySibling.answerFor(dictionarySibling.modeOf(item.direction), "en").toLowerCase()} line${clash[0] ? ` (${clash[0].code})` : ""}. A service holds one line per way it is charged.`,
          409,
        );
      }
      const old = item.sibling_group;
      await repo.setSiblingGroup(c, [id, linkTo], group, userId);
      if (old && old !== group) await repo.dissolveSingleton(c, old);
      after = { sibling_group: group, linked_to: target.code };
    }
    await audit(c, {
      actorUserId: userId, action: events.SIBLING_LINKED, moduleKey: events.MODULE, entityRef: `dict:${item.code}`,
      before: { sibling_group: item.sibling_group || null }, after,
    });
    await c.query("COMMIT");
  } catch (err) { await c.query("ROLLBACK"); throw err; }
  return (await siblingsFor(c, [id]))[id];
}

async function get(c, id) {
  const item = await repo.getItem(c, id);
  if (!item) return null;
  item.posting_rules = await repo.listRules(c, id);
  item.service_tiers = await repo.listTiers(c, id);
  return item;
}

/** Item + rules + tiers + usage + a compliance summary — the 360 payload. */
async function dossier(c, id) {
  const item = await get(c, id);
  if (!item) return null;
  const usage = await repo.usageCounts(c, id);
  const compliance = {
    requires_justification: !!item.requires_justification,
    receipt_requirement: item.receipt_requirement,
    proof_source: item.proof_source || null,
    is_disbursement: !!item.is_disbursement,
    disbursement_vat_transparent: !!item.disbursement_vat_transparent,
    // A billable item that always needs a receipt but names no valid source is
    // the onboarding gap the 360 should surface (not a hard failure).
    needs_attention: rules.needsAttention(item),
  };
  return { item, posting_rules: item.posting_rules, service_tiers: item.service_tiers, usage, compliance };
}

/**
 * One page of the rows behind one of the 360's usage tiles — the drill-in the
 * tile opens. `{ rows, total }`, or null when the item does not exist.
 *
 * `invoiceTypes` narrows the invoices drill to the kinds the viewer may open
 * (the controller resolves it from their grants); the other kinds are gated
 * whole, before this is called.
 */
async function listUsage(c, id, kind, q = {}, { invoiceTypes = [] } = {}) {
  const item = await repo.getItemRow(c, id);
  if (!item) return null;
  const out = await repo.usageRows(c, id, kind, q, { invoiceTypes });
  if (kind !== "rates") return out;
  // In force / superseded by the SAME rule the Cost & evolution tab uses.
  return {
    ...out,
    rows: out.rows.map((r) => ({ ...r, rate: Number(r.rate), ...rules.rateState(r) })),
  };
}

function pickItem(src) {
  const out = {};
  for (const k of ITEM_COLS) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

// A débours line always carries the débours flag; the code letter follows the
// direction — one source of truth for both (financial_dictionary.rules).
function normalise(data) {
  const direction = data.direction || "EXPENSE";
  const itemData = pickItem(data);
  itemData.direction = direction;
  itemData.is_disbursement = rules.resolveDisbursement(direction, data.is_disbursement);
  // Title Case on every save, so the catalogue stays the way 90995 left it.
  if (itemData.label_fr !== undefined) itemData.label_fr = rules.titleCase(itemData.label_fr, "fr");
  if (itemData.label_en !== undefined) itemData.label_en = rules.titleCase(itemData.label_en, "en");
  return { itemData, posting_rules: data.posting_rules || [], service_tiers: data.service_tiers || [] };
}

function withCreateDefaults(item) {
  return {
    applicability_mode: "ANY_OPERATIONS",
    receipt_requirement: "NOT_REQUIRED",
    currency: "XAF",
    is_billable: true,
    is_active: true,
    requires_justification: false,
    disbursement_vat_transparent: true,
    pricing_mode: "FLAT",
    ...item,
  };
}

// Keep the legacy single-value service_type_key in step with the tiers so the
// Service-Type 360 (which still reads the column) stays correct until PR2 cuts
// it over to the join.
const primaryServiceKey = rules.primaryServiceKey;

function ruleRow(r, itemId, itemDisbursement) {
  return {
    dictionary_item_id: itemId,
    applies_context: r.applies_context,
    debit_account: r.debit_account || null,
    credit_account: r.credit_account || null,
    tax_code_id: r.tax_code_id || null,
    is_disbursement: r.is_disbursement ?? itemDisbursement,
  };
}

const isUniqueViolation = (err) => err && err.code === "23505";

/**
 * `client_heading_ref_id` is a plain uuid (14130 — no FK on an existing table,
 * the 13791 rule), so the rule the FK would have enforced lives here: it must
 * name an ACTIVE row of the CLIENT_HEADING registry, or be empty.
 */
async function assertClientHeading(c, refId) {
  if (refId === undefined || refId === null) return;
  const { rows } = await c.query(
    "SELECT 1 FROM dictionary_ref WHERE ref_id = $1 AND kind = 'CLIENT_HEADING' AND is_active = true",
    [refId],
  );
  if (!rows[0]) { const e = new Error("client_heading_ref_id must be an active client heading"); e.status = 422; throw e; }
}

/** The tenant's base currency — what a rate is in unless someone says otherwise. */
async function baseCurrency(c) {
  return (await currencyRepo.getBaseCode(c)) || "XAF";
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/** A date as a PERSON reads it here — day-first — for messages shown on screen.
 *  pg hands back a `date` column as a Date at UTC midnight. */
function dayFirst(v) {
  const iso = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/**
 * Open (or supersede) ONE rate series inside the caller's transaction.
 *
 * The core of `supersedeRate`, lifted out so the create wizard's price and
 * "apply to all carriers" write through exactly the same expire-then-insert
 * discipline — without each opening a transaction of its own inside another.
 * Returns { before, row }.
 */
async function openRateSeries(c, item, data) {
  const key = {
    rateProviderId: data.rate_provider_id || null,
    containerTypeRefId: data.container_type_ref_id || null,
  };
  // provider_kind is a denormalised cache of rate_provider.kind (repo.js has
  // no join for a single lookup, so this is the one place it is read fresh).
  let providerKind = null;
  if (key.rateProviderId) {
    const { rows } = await c.query("SELECT kind FROM rate_provider WHERE rate_provider_id = $1", [key.rateProviderId]);
    if (!rows[0]) { const e = new Error("rate provider not found"); e.status = 404; throw e; }
    providerKind = rows[0].kind;
  }
  const effectiveFrom = data.effective_from || todayIso();
  // "Price includes VAT" (meeting 6, F4): the HT is stored, the TTC kept beside
  // it. Resolved before anything is expired, so a refusal (a débours, a line
  // with no VAT rate) leaves the open rate untouched.
  const basis = await expenseRateService.applyVatBasis(c, {
    dictionaryItemId: item.dictionary_item_id,
    figure: data.rate,
    priceIncludesVat: data.price_includes_vat === true,
    date: effectiveFrom,
  });
  const current = await repo.openRate(c, item.dictionary_item_id, key);
  if (current) {
    if (Date.parse(current.effective_from) >= Date.parse(effectiveFrom)) {
      const e = new Error(`the current rate already starts on ${dayFirst(current.effective_from)}; a new rate must start after that day`);
      e.status = 422;
      throw e;
    }
    await repo.expireRate(c, current.expense_rate_id, rules.dayBefore(effectiveFrom));
  }
  const row = await repo.insertRate(c, {
    dictionary_item_id: item.dictionary_item_id,
    rate_provider_id: key.rateProviderId,
    container_type_ref_id: key.containerTypeRefId,
    provider_kind: providerKind,
    ...basis,
    // The BASE currency, not the item's: a rate is in the tenant's own money
    // unless someone deliberately picks another (meeting 5, 01:11:19).
    currency: data.currency || (await baseCurrency(c)),
    effective_from: effectiveFrom,
    effective_to: data.effective_to || null,
    note: data.note || null,
  });
  return { before: current || null, row };
}

async function create(c, { data, actor }) {
  const { itemData, posting_rules, service_tiers } = normalise(data);
  // The wizard's "Default price" step: kept on the payload for the form's sake,
  // stored as the item's STANDARD expense rate (no carrier, no container type),
  // opening today, in the same transaction as the item.
  const price = data.default_price === null || data.default_price === undefined ? null : Number(data.default_price);
  await assertClientHeading(c, itemData.client_heading_ref_id);
  if (posting_rules.length === 0) { const e = new Error("a dictionary item requires at least one posting rule (KB §4)"); e.status = 422; throw e; }
  const base = withCreateDefaults(itemData);

  // Retry the whole transaction on the (rare) code collision — two creates for
  // the same direction can mint the same serial before either commits.
  for (let attempt = 0; attempt < 6; attempt++) {
    await c.query("BEGIN");
    try {
      const row = { ...base, code: await repo.nextCode(c, base.direction), service_type_key: primaryServiceKey(service_tiers) };
      const item = await repo.createItem(c, row);
      for (const r of posting_rules) await repo.createRule(c, ruleRow(r, item.dictionary_item_id, item.is_disbursement));
      if (service_tiers.length) await repo.replaceTiers(c, item.dictionary_item_id, service_tiers);
      if (price !== null) {
        const { row: rate } = await openRateSeries(c, item, { rate: price, currency: data.currency || null });
        await audit(c, { actorUserId: actor.user_id, action: events.RATE_SUPERSEDED, moduleKey: events.MODULE, entityRef: `dict:${item.code}`, before: null, after: rate });
      }
      await c.query("COMMIT");
      await emitEvent(c, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: `dict:${item.code}`, actorUserId: actor.user_id });
      await audit(c, { actorUserId: actor.user_id, action: events.CREATED, moduleKey: events.MODULE, entityRef: `dict:${item.code}`, after: item });
      await auditSuggestion(c, { item, provenance: data.posting_suggestion, savedRules: posting_rules, actor });
      return get(c, item.dictionary_item_id);
    } catch (err) {
      await c.query("ROLLBACK");
      if (isUniqueViolation(err) && attempt < 5) continue; // remint and retry
      throw err;
    }
  }
  const e = new Error("could not allocate a unique code, please retry"); e.status = 409; throw e;
}

async function update(c, { id, patch, actor }) {
  const before = await repo.getItemRow(c, id);
  if (!before) return null;
  const merged = { ...before, ...patch };
  const { itemData, posting_rules, service_tiers } = normalise(merged);
  const rulesSent = Array.isArray(patch.posting_rules);
  const tiersSent = Array.isArray(patch.service_tiers);
  if (rulesSent && posting_rules.length === 0) { const e = new Error("a dictionary item requires at least one posting rule (KB §4)"); e.status = 422; throw e; }
  if (tiersSent) itemData.service_type_key = primaryServiceKey(service_tiers);

  // A direction change moves the item to the new letter's next free number and
  // frees the old one (meeting 5, 01:20:04). Before this, "Documentation fee"
  // moved from revenue to disbursement and kept its #R code — the letter and
  // the accounting said two different things.
  const recoded = itemData.direction && itemData.direction !== before.direction;
  if (patch.client_heading_ref_id !== undefined) await assertClientHeading(c, patch.client_heading_ref_id);

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const out = await updateOnce(c, { id, before, itemData, posting_rules, service_tiers, rulesSent, tiersSent, recoded, actor });
      if (patch.posting_suggestion && rulesSent) {
        await auditSuggestion(c, { item: { ...before, ...itemData, code: out.code }, provenance: patch.posting_suggestion, savedRules: posting_rules, actor });
      }
      return out;
    } catch (err) {
      // Two items re-lettered at once can mint the same serial; remint.
      if (recoded && isUniqueViolation(err) && attempt < 5) continue;
      throw err;
    }
  }
  const e = new Error("could not allocate a unique code, please retry"); e.status = 409; throw e;
}

async function updateOnce(c, { id, before, itemData, posting_rules, service_tiers, rulesSent, tiersSent, recoded, actor }) {
  await c.query("BEGIN");
  try {
    if (recoded) itemData.code = await repo.nextCode(c, itemData.direction);
    const row = await repo.updateItem(c, id, itemData);
    if (recoded) {
      await audit(c, {
        actorUserId: actor.user_id, action: events.RECODED, moduleKey: events.MODULE,
        entityRef: `dict:${row.code}`,
        before: { code: before.code, direction: before.direction },
        after: { code: row.code, direction: row.direction },
      });
    }
    if (rulesSent) {
      await repo.deleteRules(c, id);
      for (const r of posting_rules) await repo.createRule(c, ruleRow(r, id, row ? row.is_disbursement : before.is_disbursement));
    }
    if (tiersSent) await repo.replaceTiers(c, id, service_tiers);
    await emitEvent(c, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: `dict:${row.code}`, actorUserId: actor.user_id });
    await audit(c, { actorUserId: actor.user_id, action: events.UPDATED, moduleKey: events.MODULE, entityRef: `dict:${row.code}`, before, after: row });
    await c.query("COMMIT");
    return get(c, id);
  } catch (err) { await c.query("ROLLBACK"); throw err; }
}

/* ═══════════════════ SPEND OVER A PERIOD (PR2 workstream 1) ═══════════════ */

/**
 * What this line cost us between two dates, through three lenses.
 *
 * The lenses are not three approximations of one number — they are three
 * different questions, and a dossier that showed only one would answer the
 * wrong one for two of its readers:
 *
 *   estimated   what a costing sheet SAID it would cost (the planner's number)
 *   committed   what has been promised to a third party — an open PO, an
 *               approved cash request (the treasurer's number)
 *   actual      what the ledger records as posted (the accountant's number)
 *
 * The HEADLINE is actual, because that is the only one that has happened. The
 * gap between committed and actual is the useful signal: money promised and not
 * yet posted is either work in flight or a document someone forgot to close.
 */
async function spend(c, id, q = {}) {
  const item = await repo.getItem(c, id);
  if (!item) return null;
  const period = rules.normalisePeriod({ from: q.from, to: q.to });
  const months = rules.monthKeys(period.from, period.to);
  // Sequential, NOT Promise.all. `req.tenantDb` hands every call in a request
  // the SAME pinned pooled client (middleware/tenant-context.js), and pg
  // serialises concurrent queries on one client through its internal queue —
  // so a Promise.all here would buy no parallelism at all while breaking the
  // invariant that file documents ("nothing runs req.tenantDb calls
  // concurrently"). Three awaits are three round trips either way.
  // Optionally one operations file only (meeting 5, 01:23:15 — "filter per
  // file, so you see everything spent on that file").
  const dossierId = q.dossier_id || null;
  const estimated = await repo.spendEstimated(c, id, period.from, period.to, dossierId);
  const committed = await repo.spendCommitted(c, id, period.from, period.to, dossierId);
  const actual = await repo.spendActual(c, id, period.from, period.to, dossierId);
  const series = rules.spendSeries(months, { estimated, committed, actual });
  const documents = q.include_documents === false ? [] : await repo.spendDocuments(c, id, period.from, period.to, 100, dossierId);
  return {
    item: { dictionary_item_id: item.dictionary_item_id, code: item.code, label_fr: item.label_fr, label_en: item.label_en, currency: item.currency || "XAF", direction: item.direction },
    period,
    dossier_id: dossierId,
    months: series.months,
    totals: series.totals,
    documents,
  };
}

/**
 * One page of the documents behind the Spend tab's tiles, and the true total.
 *
 * The window goes through the SAME `normalisePeriod` as `spend`, so a drill-in
 * opened from a tile lists the period that tile summed — a reversed or garbage
 * range is corrected the same way for both. `lens` NULL is every lens.
 */
async function spendDocumentsPage(c, id, q = {}) {
  const item = await repo.getItemRow(c, id);
  if (!item) return null;
  const period = rules.normalisePeriod({ from: q.from, to: q.to });
  const { limit, offset } = page(q);
  return repo.spendDocumentsPage(c, id, period.from, period.to, {
    lens: q.lens || null,
    dossierId: q.dossier_id || null,
    limit,
    offset,
  });
}

/* ═══════════════════ COST EVOLUTION (PR2 workstream 2) ════════════════════ */

/**
 * The effective-dated rate history behind an item, plus its trend.
 *
 * Grouped into SERIES — one per (provider, shipping line, variant) — because a
 * single item genuinely has several concurrent rates (a 20ft and a 40ft
 * container price are both current, and neither supersedes the other), and a
 * timeline that interleaved them would render a sawtooth that means nothing.
 */
async function rateEvolution(c, id, q = {}) {
  const item = await repo.getItem(c, id);
  if (!item) return null;
  const timeline = rules.rateTimeline(await repo.rateHistory(c, id), q.as_of || null);
  const groups = new Map();
  for (const r of timeline) {
    const key = [r.rate_provider_id || "", r.container_type_ref_id || ""].join("|");
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        rate_provider_id: r.rate_provider_id || null,
        provider_kind: r.provider_kind_resolved || r.provider_kind || null,
        provider_name: r.provider_name || null,
        container_type_ref_id: r.container_type_ref_id || null,
        container_type_code: r.container_type_code || null,
        container_type_name: r.container_type_name || null,
        currency: r.currency || item.currency || "XAF",
        points: [],
      });
    }
    groups.get(key).points.push(r);
  }
  const series = [...groups.values()].map((g) => ({
    ...g,
    current: g.points.find((p) => p.in_force) || null,
    trend: rules.rateTrend(g.points),
  }));
  return {
    item: { dictionary_item_id: item.dictionary_item_id, code: item.code, label_fr: item.label_fr, label_en: item.label_en, currency: item.currency || "XAF", provider_kind: item.provider_kind || null },
    series,
    // Overall movement across every point, for the headline pill.
    trend: rules.rateTrend(timeline),
  };
}

/**
 * Amend a rate the ONLY way an effective-dated series may be amended: expire the
 * open row the day before the new one opens, and insert the new one — never
 * edit history in place.
 *
 * This is the tax-jurisdiction discipline (tax_jurisdiction.service.supersedeCode)
 * applied to expense_rate, and it is copied deliberately rather than
 * generalised: the two tables have different keys, and the shared thing worth
 * keeping identical is the TRANSACTION BOUNDARY. Expiring the old row in one
 * transaction and inserting the new one in another leaves a window with no
 * effective rate — which for tax codes meant every invoice from that date
 * failed to post until someone noticed by hand. Expire and replace are one unit
 * here for exactly the same reason.
 */
async function supersedeRate(c, { id, data, actor }) {
  const item = await repo.getItem(c, id);
  if (!item) return null;
  await c.query("BEGIN");
  try {
    const { before, row } = await openRateSeries(c, item, data);
    await emitEvent(c, { eventTypeKey: events.RATE_SUPERSEDED, moduleKey: events.MODULE, entityRef: `dict:${item.code}`, actorUserId: actor.user_id || null });
    await audit(c, { actorUserId: actor.user_id || null, action: events.RATE_SUPERSEDED, moduleKey: events.MODULE, entityRef: `dict:${item.code}`, before, after: row });
    await c.query("COMMIT");
    return rateEvolution(c, id);
  } catch (err) { await c.query("ROLLBACK"); throw err; }
}

/**
 * One rate, written for many carriers at once (meeting 5, 01:07:48).
 *
 * Documentation fees and most shipping-line charges are near-identical across
 * lines, and setting MSC, Maersk, CMA CGM… one cell at a time is how a tariff
 * change gets half-applied. The screen offers every active carrier of the tab's
 * kind, all ticked, and the person unticks the exceptions; the ids that arrive
 * here are the ones left ticked.
 *
 * ALL OR NOTHING. Each carrier's series is superseded with the same expire-
 * then-insert as a single cell, inside ONE transaction: a rate that applied to
 * four lines of six because the fifth already had a later-dated rate is worse
 * than a clear refusal naming the carrier that blocked it.
 */
async function applyRateToProviders(c, { id, data, actor }) {
  const item = await repo.getItem(c, id);
  if (!item) return null;
  const ids = [...new Set(data.rate_provider_ids || [])];
  if (!ids.length) { const e = new Error("tick at least one carrier"); e.status = 422; throw e; }
  const { rows: providers } = await c.query(
    "SELECT rate_provider_id, name FROM rate_provider WHERE rate_provider_id = ANY($1::uuid[])",
    [ids],
  );
  if (providers.length !== ids.length) { const e = new Error("one or more carriers were not found"); e.status = 404; throw e; }
  const nameOf = new Map(providers.map((p) => [p.rate_provider_id, p.name]));
  await c.query("BEGIN");
  try {
    const written = [];
    for (const providerId of ids) {
      try {
        const { before, row } = await openRateSeries(c, item, { ...data, rate_provider_id: providerId });
        await audit(c, { actorUserId: actor.user_id || null, action: events.RATE_SUPERSEDED, moduleKey: events.MODULE, entityRef: `dict:${item.code}`, before, after: row });
        written.push(row);
      } catch (err) {
        if (err.status === 422) err.message = `${nameOf.get(providerId)}: ${err.message}`;
        throw err;
      }
    }
    await emitEvent(c, { eventTypeKey: events.RATE_SUPERSEDED, moduleKey: events.MODULE, entityRef: `dict:${item.code}`, actorUserId: actor.user_id || null });
    await c.query("COMMIT");
    return { applied: written.length, evolution: await rateEvolution(c, id) };
  } catch (err) { await c.query("ROLLBACK"); throw err; }
}

/* ═══════════════════ BULK EXCEL IMPORT (PR2 workstream 3) ═════════════════ */

/** Everything a row is validated against, read once per upload, not per row. */
async function importContext(c) {
  // Sequential for the same reason as spend() above: one pinned client, pg
  // serialises regardless. Six round trips ONCE per upload, not per row —
  // which is the optimisation that actually matters here (a 500-row sheet
  // validated row-by-row would be 1500 lookups against three small tables).
  const accounts = await repo.postableAccounts(c);
  const taxCodes = await repo.taxCodeIndex(c);
  const serviceTypes = await repo.serviceTypeIndex(c);
  const subcategories = await repo.listRefs(c, "SUBCATEGORY");
  const units = await repo.listRefs(c, "UNIT");
  const proofSources = await repo.listRefs(c, "PROOF_SOURCE");
  return {
    accounts, taxCodes, serviceTypes,
    refs: { SUBCATEGORY: subcategories, UNIT: units, PROOF_SOURCE: proofSources },
    // The lookup shapes rules.validateImportRow wants.
    lookups: {
      accounts: new Set(accounts.map((a) => String(a.code))),
      taxCodes: new Map(taxCodes.map((t) => [String(t.code), t.tax_code_id])),
      serviceTypes: new Map(serviceTypes.map((s) => [String(s.key), s.service_type_id])),
    },
  };
}

/** The .xlsx a user downloads: enum dropdowns + this tenant's real references.
 *  Branded via resolveContext on the caller's connection. */
async function importTemplate(c) {
  const [ctx, context] = await Promise.all([
    importContext(c),
    resolveContext(c, { title: "Financial dictionary — import template" }),
  ]);
  return importer.buildTemplate({ accounts: ctx.accounts, taxCodes: ctx.taxCodes, serviceTypes: ctx.serviceTypes, refs: ctx.refs, context });
}

/**
 * Parse + validate an upload. Writes NOTHING.
 *
 * A separate step from commit on purpose: the user sees exactly what will be
 * created, and what will not and why, BEFORE anything is minted. An importer
 * that validates and commits in one call has to choose between all-or-nothing
 * (400 good rows lost to one typo) and silent partial success (rows created
 * that the user never saw); showing the staging table first makes that a
 * decision rather than a policy.
 */
/** Fresh grounded calls one import may make (F8); further rows use the cache or the local suggestion. */
const IMPORT_CALL_CAP = 10;

async function importValidate(c, { buffer, actor = {} }) {
  const parsed = await importer.parseUpload(buffer);
  const ctx = await importContext(c);
  // A row without a posting is no longer rejected for that alone (meeting 6,
  // F8): it gets a suggestion here, and commit takes it only once the person
  // has accepted it in the preview.
  const { valid, rejected } = rules.partitionImport(parsed.rows, { ...ctx.lookups, allowMissingPosting: true });
  const callBudget = { left: IMPORT_CALL_CAP };
  for (const row of valid) {
    if (!row.data.needs_posting) continue;
    const sug = await postingEngine.suggest(
      c,
      { label_fr: row.data.label_fr, label_en: row.data.label_en, category: row.data.category, direction: row.data.direction },
      { userId: actor.user_id || null, callBudget },
    );
    row.ai_posting = {
      source: sug.source,
      model: sug.model,
      cache_entry_id: sug.cache_entry_id,
      confidence: sug.confidence,
      check_needed: sug.check_needed,
      direction: sug.direction,
      rationale: sug.rationale,
      sources: sug.sources,
      search_suggestion_html: sug.search_suggestion_html,
      fallback_reason: sug.fallback_reason,
      rules: sug.rules.map(({ mapping, ...r }) => ({ ...r, mint: mapping.debit.how === "mint" || mapping.credit.how === "mint" ? { debit: mapping.debit.mint || null, credit: mapping.credit.mint || null } : null })),
      // A rule that needs an account created first cannot be accepted from
      // the preview: the person creates it in the wizard.
      acceptable: sug.rules.every((r) => r.debit_account && r.credit_account),
    };
  }
  const needing = valid.filter((r) => r.data.needs_posting).length;
  return {
    sheet: parsed.sheet,
    parsed: parsed.rows.length,
    valid,
    rejected,
    summary: { total: parsed.rows.length, valid: valid.length, rejected: rejected.length, ai_suggested: needing },
  };
}

/**
 * Commit the valid rows. PARTIAL by design.
 *
 * Re-validates server-side rather than trusting the staging payload: the client
 * round-trip is a convenience, not a security boundary, and the tenant's
 * accounts could have changed between validate and commit.
 *
 * Each row is its own transaction — NOT one transaction for the batch. A
 * 400-row import that rolls back entirely because row 397 hit a code collision
 * is the failure mode partial commit exists to avoid, and the rows are
 * independent (an item is complete on its own). A row that fails at insert
 * joins `rejected` with the database's own reason and the user re-uploads the
 * error file.
 */
async function importCommit(c, { rows = [], actor }) {
  const ctx = await importContext(c);
  const created = [];
  const rejected = [];
  for (const entry of rows) {
    const rowNumber = entry.row || null;
    const check = rules.validateImportRow(entry.raw || entry.data || {}, { ...ctx.lookups, allowMissingPosting: true });
    if (!check.valid) { rejected.push({ row: rowNumber, reasons: check.reasons, raw: entry.raw || entry.data || {} }); continue; }
    const data = { ...check.data };
    if (data.needs_posting) {
      // Only a posting the person ACCEPTED in the preview is taken, and it is
      // re-checked against the tenant's accounts like any typed one.
      const accepted = entry.accept_posting && Array.isArray(entry.accept_posting.rules) ? entry.accept_posting.rules : null;
      if (!accepted) {
        rejected.push({ row: rowNumber, reasons: ["No OHADA mapping — accept the AI-suggested posting in the preview, or fill the accounts in the sheet"], raw: entry.raw || {} });
        continue;
      }
      const bad = accepted.filter((r) => !ctx.lookups.accounts.has(String(r.debit_account)) || !ctx.lookups.accounts.has(String(r.credit_account)));
      if (bad.length) {
        rejected.push({ row: rowNumber, reasons: bad.map((r) => `${r.applies_context}: accepted posting names an account that is not postable (${r.debit_account} / ${r.credit_account})`), raw: entry.raw || {} });
        continue;
      }
      data.posting_rules = accepted.map((r) => ({
        applies_context: r.applies_context,
        debit_account: String(r.debit_account),
        credit_account: String(r.credit_account),
        tax_code_id: r.tax_code_id || null,
        is_disbursement: r.is_disbursement,
      }));
      data.posting_suggestion = entry.accept_posting.provenance || null;
    }
    delete data.needs_posting;
    try {
      const item = await create(c, { data, actor });
      created.push({ row: rowNumber, dictionary_item_id: item.dictionary_item_id, code: item.code, label_fr: item.label_fr });
    } catch (err) {
      rejected.push({ row: rowNumber, reasons: [err.message || "could not be created"], raw: entry.raw || entry.data || {} });
    }
  }
  const summary = { attempted: rows.length, created: created.length, rejected: rejected.length };
  if (created.length) {
    // One event and one audit row for the BATCH, not per item — `create()` has
    // already emitted dictionary_item.created for each. A 400-row import that
    // also emitted 400 batch events would drown the feed it is meant to inform.
    await emitEvent(c, { eventTypeKey: events.IMPORTED, moduleKey: events.MODULE, entityRef: "dict:import", actorUserId: actor.user_id || null });
    await audit(c, { actorUserId: actor.user_id || null, action: events.IMPORTED, moduleKey: events.MODULE, entityRef: "dict:import", after: { ...summary, codes: created.map((r) => r.code) } });
  }
  return { created, rejected, summary };
}

/** The rejected rows as an .xlsx the user fixes and re-uploads. Branded like
 *  the template it answers, so the fix-and-reupload loop stays one product. */
async function importErrorFile(c, rejected) {
  const context = await resolveContext(c, { title: "Financial dictionary — rejected rows" });
  return importer.buildErrorFile(rejected, context);
}

/* ── dictionary_ref registry (dropdown values, gear-modal editable) ─────────── */
const listRefs = (c, kind, includeInactive) => repo.listRefs(c, kind, includeInactive);

async function createRef(c, { data, actor }) {
  const row = await repo.createRef(c, { ...data, code: String(data.code).toUpperCase() });
  await audit(c, { actorUserId: actor.user_id, action: "dictionary_ref.created", moduleKey: events.MODULE, entityRef: `ref:${row.kind}:${row.code}`, after: row });
  return row;
}
async function updateRef(c, { id, patch, actor }) {
  const before = await repo.getRef(c, id);
  if (!before) return null;
  if (before.is_system && (patch.code || patch.kind)) { const e = new Error("a system reference's code/kind cannot be changed"); e.status = 422; throw e; }
  // The create path refuses a container type with no TEU or no size (they are
  // read as numbers by the TEU totals and as the rate-card key respectively, and
  // both fail silently when absent). A patch must not be the way back in.
  if (before.kind === "CONTAINER_TYPE" && patch.extra !== undefined) {
    const teu = patch.extra?.teu;
    if (typeof teu !== "number" || !(teu > 0)) { const e = new Error("TEU is required for a container type and must be greater than 0"); e.status = 422; throw e; }
    if (!patch.extra?.size) { const e = new Error("size is required for a container type (the rate-lookup key)"); e.status = 422; throw e; }
  }
  const row = await repo.updateRef(c, id, patch);
  await audit(c, { actorUserId: actor.user_id, action: "dictionary_ref.updated", moduleKey: events.MODULE, entityRef: `ref:${before.kind}:${before.code}`, before, after: row });
  return row;
}

module.exports = {
  listItems, searchItems, siblingsFor, unpairedLines, linkSibling, suggestPosting,
  latestReview, startReview, runReview, postingDifferences,
  get, dossier, listUsage, create, update,
  spend, spendDocumentsPage, rateEvolution, supersedeRate, applyRateToProviders,
  importTemplate, importValidate, importCommit, importErrorFile,
  listRefs, createRef, updateRef,
};
