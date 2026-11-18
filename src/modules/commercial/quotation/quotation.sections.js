/**
 * A quotation's sections (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.4, §3.5; owner
 * decisions D6 and D8).
 *
 * ── THE FIXED LIBRARY ──────────────────────────────────────────────────────
 *
 *   cover         automatic: branding, client, title, reference, date
 *   about_us      the PUBLISHED Company Profile, pinned at send, read-only here
 *   needs         prefilled from the request and the latest discovery; editable
 *   solution      template text (and the discovery's strategy); Draft With AI
 *   scope         template text; editable
 *   pricing       the lines. Always on.
 *   terms         validity, payment terms, plus template text
 *   case_stories  up to three published Success Stories
 *   next_steps    automatic: how to accept, the contact
 *
 * Fixed order, on or off, words per language. Nothing else (D8).
 *
 * ── A TEMPLATE IS COPIED, NEVER LINKED ─────────────────────────────────────
 *
 * When a quotation is created its sections are written from the template (the
 * one whose service types include the request's, else the default), and from
 * then on they are the quotation's own: editing the template never changes a
 * quotation already made (§3.5).
 */
"use strict";

const repo = require("./quotation.repo");
const rules = require("./quotation.rules");
const { AppError } = require("../../../utils/errors");

const has = (v) => v !== undefined && v !== null && String(v).trim() !== "";

/** The discovery capture's three sections, by key (meeting.repo latestDiscovery). */
function discoveryText(discovery, key) {
  const s = discovery && Array.isArray(discovery.sections)
    ? discovery.sections.find((x) => String(x.section_key || "").toUpperCase() === key)
    : null;
  return s && has(s.body) ? String(s.body).trim() : "";
}

const LABELS = {
  EN: { service: "Service", route: "Route", to: "to", incoterm: "Incoterm", cargo: "Cargo", weight: "Weight" },
  FR: { service: "Service", route: "Itinéraire", to: "vers", incoterm: "Incoterm", cargo: "Marchandise", weight: "Poids" },
};
// French typography puts a space before the colon.
const colon = (lang) => (lang === "FR" ? " : " : ": ");

/**
 * Your Needs, prefilled (§3.4): what the request says, in the reader's words,
 * then what the client told us in discovery. A field the request does not hold
 * is left out, never printed empty.
 */
function needsText({ request = null, discovery = null, serviceName = null }, lang) {
  const L = LABELS[lang] || LABELS.EN;
  const facts = [];
  if (has(serviceName)) facts.push(`${L.service}${colon(lang)}${serviceName}`);
  if (request) {
    const route = [request.origin_location, request.destination_location].filter(has);
    if (route.length === 2) facts.push(`${L.route}${colon(lang)}${route[0]} ${L.to} ${route[1]}`);
    else if (route.length === 1) facts.push(`${L.route}${colon(lang)}${route[0]}`);
    const term = request.incoterm && !["TBD", "N/A", "NOT_SURE", "NONE"].includes(String(request.incoterm).toUpperCase()) ? request.incoterm : null;
    if (term) facts.push(`${L.incoterm}${colon(lang)}${term}`);
    if (has(request.cargo_description)) facts.push(`${L.cargo}${colon(lang)}${String(request.cargo_description).trim()}`);
    if (request.estimated_weight !== null && request.estimated_weight !== undefined && Number(request.estimated_weight) > 0) {
      facts.push(`${L.weight}${colon(lang)}${Number(request.estimated_weight)} kg`);
    }
  }
  const heard = [discoveryText(discovery, "OPERATIONS"), discoveryText(discovery, "PAIN_POINTS")].filter(has);
  return [facts.join("\n"), ...heard].filter(has).join("\n\n") || null;
}

/** Our Solution: what discovery agreed, then the template's words. */
function solutionText(templateBody, discovery) {
  return [discoveryText(discovery, "STRATEGY"), templateBody].filter(has).join("\n\n") || null;
}

/**
 * The nine sections a new quotation starts with. `template.sections` is
 * key → { enabled, body_en, body_fr }; a key it does not name is on and empty.
 */
function fromTemplate(template, { request = null, discovery = null, serviceName = null } = {}) {
  const t = (template && template.sections) || {};
  return rules.SECTION_KEYS.map((key) => {
    const d = t[key] || {};
    const row = {
      section_key: key,
      enabled: rules.ALWAYS_ON.includes(key) ? true : d.enabled !== false,
      body_en: rules.TEMPLATE_TEXT_SECTIONS.includes(key) && has(d.body_en) ? String(d.body_en) : null,
      body_fr: rules.TEMPLATE_TEXT_SECTIONS.includes(key) && has(d.body_fr) ? String(d.body_fr) : null,
      story_ids: [],
    };
    if (key === "needs") {
      row.body_en = needsText({ request, discovery, serviceName }, "EN");
      row.body_fr = needsText({ request, discovery, serviceName }, "FR");
    }
    if (key === "solution") {
      row.body_en = solutionText(row.body_en, discovery);
      row.body_fr = solutionText(row.body_fr, discovery);
    }
    return row;
  });
}

/**
 * Apply an editor's save over what the quotation holds: only the keys sent
 * change, and only the fields sent on each. Words go only where a person
 * writes them (needs, solution, scope, terms); stories only on Case Stories.
 */
function merge(current = [], patch = []) {
  const byKey = new Map(current.map((r) => [r.section_key, { ...r }]));
  for (const p of patch) {
    const key = p.section_key;
    if (!rules.SECTION_KEYS.includes(key)) {
      throw new AppError("VALIDATION_ERROR", "Unknown section", 422, { sections: [`no section '${key}'`] });
    }
    if (rules.ALWAYS_ON.includes(key) && p.enabled === false) {
      throw new AppError("PRICING_ALWAYS_ON", "Pricing is always printed", 422, { sections: ["pricing cannot be switched off"] });
    }
    const row = byKey.get(key) || { section_key: key, enabled: true, body_en: null, body_fr: null, story_ids: [] };
    if (p.enabled !== undefined) row.enabled = rules.ALWAYS_ON.includes(key) ? true : p.enabled;
    if (rules.TEXT_SECTIONS.includes(key)) {
      if (p.body_en !== undefined) row.body_en = has(p.body_en) ? String(p.body_en) : null;
      if (p.body_fr !== undefined) row.body_fr = has(p.body_fr) ? String(p.body_fr) : null;
    } else if ((has(p.body_en) || has(p.body_fr)) && key !== "case_stories") {
      throw new AppError("SECTION_AUTOMATIC", "This section is written automatically", 422, { sections: [`'${key}' takes no text`] });
    }
    if (key === "case_stories") {
      if (p.body_en !== undefined) row.body_en = has(p.body_en) ? String(p.body_en) : null;
      if (p.body_fr !== undefined) row.body_fr = has(p.body_fr) ? String(p.body_fr) : null;
      if (p.story_ids !== undefined) row.story_ids = [...new Set(p.story_ids)].slice(0, 3);
    }
    byKey.set(key, row);
  }
  return rules.SECTION_KEYS.filter((k) => byKey.has(k)).map((k) => byKey.get(k));
}

/** The stories a Case Stories section may name: published ones only (consent is read when printed). */
async function assertStories(client, rows) {
  const ids = [...new Set(rows.flatMap((r) => (r.section_key === "case_stories" ? r.story_ids || [] : [])))];
  if (!ids.length) return;
  const { rows: found } = await client.query(
    "SELECT success_story_id FROM success_story WHERE success_story_id = ANY($1::uuid[]) AND is_published = true",
    [ids],
  );
  if (found.length !== ids.length) {
    throw new AppError("STORY_NOT_PUBLISHED", "A case story must be a published Success Story", 422, { sections: ["case_stories names a story that is not published"] });
  }
}

async function write(client, quotationId, rows) {
  for (const r of rows) await repo.upsertSection(client, quotationId, r);
}

/** The sections as stored, in the library's order. */
async function read(client, quotationId) {
  const rows = await repo.listSections(client, quotationId);
  const byKey = new Map(rows.map((r) => [r.section_key, r]));
  return rules.SECTION_KEYS.filter((k) => byKey.has(k)).map((k) => {
    const r = byKey.get(k);
    return { section_key: k, enabled: r.enabled !== false, body_en: r.body_en, body_fr: r.body_fr, story_ids: r.story_ids || [] };
  });
}

module.exports = { fromTemplate, merge, read, write, assertStories, needsText, solutionText, discoveryText };
