/**
 * Quotation templates: the leanest builder (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md
 * §3.5; owner decision D8). The screen is PR 6's; this is its API.
 *
 * A template is a name, the service types it is for, a star for the default,
 * and for each section of the fixed library: on or off by default in a Full
 * Proposal, and for Our Solution, Scope of Services and Terms one text per
 * language. Nothing else: no ordering, no custom sections, no merge fields, no
 * images, no fonts, no colours. The look is the tenant's branding.
 *
 * One default at a time (ux_quotation_template_default). A template is never
 * deleted, only retired, so a quotation keeps naming the one it came from.
 */
"use strict";

const repo = require("./quotation.repo");
const rules = require("./quotation.rules");
const events = require("./quotation.events");
const { audit } = require("../../../shared/events/emit");
const { atomically } = require("../../../shared/db/tx");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "quotation_template:" + id;
const has = (v) => v !== undefined && v !== null && String(v).trim() !== "";

/**
 * Keep only what a template may say: every library key, on or off, and words
 * only on the three sections that carry them. Pricing is always on.
 */
function normaliseSections(input = {}, current = {}) {
  const out = {};
  for (const key of rules.SECTION_KEYS) {
    const was = current[key] || {};
    const now = input[key] || {};
    const row = { enabled: rules.ALWAYS_ON.includes(key) ? true : (now.enabled !== undefined ? now.enabled !== false : was.enabled !== false) };
    if (rules.TEMPLATE_TEXT_SECTIONS.includes(key)) {
      const en = now.body_en !== undefined ? now.body_en : was.body_en;
      const fr = now.body_fr !== undefined ? now.body_fr : was.body_fr;
      if (has(en)) row.body_en = String(en);
      if (has(fr)) row.body_fr = String(fr);
    } else if (has(now.body_en) || has(now.body_fr)) {
      throw new AppError("SECTION_AUTOMATIC", "Only Our Solution, Scope of Services and Terms carry template text", 422, { sections: [`'${key}' takes no text`] });
    }
    out[key] = row;
  }
  return out;
}

async function assertServiceTypes(client, ids = []) {
  if (!ids.length) return;
  const { rows } = await client.query("SELECT service_type_id FROM service_type WHERE service_type_id = ANY($1::uuid[])", [ids]);
  if (rows.length !== new Set(ids).size) {
    throw new AppError("SERVICE_TYPE_NOT_FOUND", "A service type on this template does not exist", 422, { service_type_ids: ["unknown service type"] });
  }
}

function view(t) {
  if (!t) return null;
  return {
    template_id: t.template_id, name: t.name, service_type_ids: t.service_type_ids || [], is_default: t.is_default === true,
    active: t.active !== false, sections: normaliseSections({}, t.sections || {}), created_at: t.created_at, updated_at: t.updated_at,
  };
}

const list = async (client, { includeInactive = false } = {}) => (await repo.listTemplates(client, { includeInactive })).map(view);

async function get(client, id) {
  const t = await repo.getTemplate(client, id);
  if (!t) throw new AppError("NOT_FOUND", "Quotation template not found", 404);
  return view(t);
}

async function create(client, { data, actor = {} }) {
  await assertServiceTypes(client, data.service_type_ids || []);
  return atomically(client, async () => {
    if (data.is_default) await repo.clearDefaultTemplate(client, null);
    const row = await repo.insertTemplate(client, {
      name: String(data.name).trim(),
      service_type_ids: [...new Set(data.service_type_ids || [])],
      is_default: data.is_default === true,
      sections: JSON.stringify(normaliseSections(data.sections || {})),
      active: true,
    });
    await audit(client, { actorUserId: actor.user_id || null, action: "quotation_template.created", moduleKey: events.MODULE, entityRef: ref(row.template_id), after: { name: row.name, is_default: row.is_default } });
    return view(row);
  });
}

async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.getTemplate(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Quotation template not found", 404);
  if (patch.service_type_ids) await assertServiceTypes(client, patch.service_type_ids);
  if (patch.active === false && (patch.is_default === true || (before.is_default && patch.is_default !== false))) {
    throw new AppError("TEMPLATE_IS_DEFAULT", "Star another template as the default before retiring this one", 409);
  }
  if (patch.is_default === false && before.is_default) {
    throw new AppError("TEMPLATE_IS_DEFAULT", "Star another template as the default instead", 409);
  }
  return atomically(client, async () => {
    const fields = {};
    if (patch.name !== undefined) fields.name = String(patch.name).trim();
    if (patch.service_type_ids !== undefined) fields.service_type_ids = [...new Set(patch.service_type_ids)];
    if (patch.sections !== undefined) fields.sections = JSON.stringify(normaliseSections(patch.sections, before.sections || {}));
    if (patch.active !== undefined) fields.active = patch.active;
    if (patch.is_default === true && !before.is_default) {
      await repo.clearDefaultTemplate(client, id);
      fields.is_default = true;
      fields.active = true;
    }
    const row = await repo.updateTemplate(client, id, fields);
    await audit(client, { actorUserId: actor.user_id || null, action: "quotation_template.updated", moduleKey: events.MODULE, entityRef: ref(id), before: { name: before.name, is_default: before.is_default, active: before.active }, after: { fields: Object.keys(fields) } });
    return view(row);
  });
}

/**
 * Preview with sample data (§3.5 "Preview renders it with sample data"): the
 * registry's sample quotation with this template's sections over it, printed
 * as a Full Proposal by the one quotation template.
 */
async function preview(client, { id, language = "EN" }) {
  const t = await get(client, id);
  const templateSvc = require("../../documents/template/template.service");
  const registry = require("../../../services/documents/templates/registry");
  const quotationSections = require("./quotation.sections");
  const lang = String(language).toUpperCase() === "FR" ? "fr" : "en";
  const { cfg, entity } = await templateSvc.resolveCfg(client, "QUOTATION", null, null, { language: lang });
  const tpl = registry.get("QUOTATION");
  const sample = tpl.sampleData;
  const sections = quotationSections.fromTemplate({ sections: t.sections }, {})
    .map((s) => (s.section_key === "needs" ? (sample.sections || []).find((x) => x.section_key === "needs") || s : s));
  return { html: tpl.build({ ...sample, output: "FULL", sections }, cfg, entity, null), language: lang.toUpperCase() };
}

module.exports = { list, get, create, update, preview, normaliseSections, view };
