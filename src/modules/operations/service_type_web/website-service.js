"use strict";
/**
 * A website service as the quote engine reads it (SmartLS website v2, PR 3).
 *
 * A website service is a published `service_type_web_profile` (its own service
 * type is always a member) plus the other service types it quotes for
 * (`service_type_web_member`, 14640). The engine
 * (`@praxis/shared` rules/quote-engine.js) needs each member's flow (from its
 * territory) and the Incoterms it quotes; the card is the website service's
 * own.
 *
 * ONE builder, used by the public services list (so the wizard runs the engine
 * on exactly what the API will) and by the quote intake (which runs it again
 * and stores what it says). Two builders would be two answers.
 */

const { serviceScope, incoterms, quoteEngine } = require("@praxis/shared");
const repo = require("./service_type_web.repo");

/** One member as the engine and the website read it. */
function memberOf(row) {
  return {
    id: row.service_type_id,
    name: row.name_en || row.name_fr || "",
    name_en: row.name_en || null,
    name_fr: row.name_fr || null,
    flow: serviceScope.flowOf(row.territory),
    incoterms: incoterms.normalise(row.incoterms || []),
  };
}

/**
 * The engine's descriptor for one website service.
 *
 * @param anchor   the profile's service type row (`transport_mode`, `key`)
 * @param members  repo.membersOf rows for this website service, anchor first
 */
function descriptorOf(anchor, members) {
  return {
    id: anchor.service_type_id,
    card: serviceScope.modeOf({ transport_mode: anchor.transport_mode, key: anchor.key || anchor.service_key }),
    members: members.map(memberOf),
  };
}

/** The rules that apply to one website service: the generic set and its own. */
const rulesFor = (rules, websiteServiceId) =>
  rules.filter((r) => !r.website_service_id || String(r.website_service_id) === String(websiteServiceId));

/** The wire shape of a rule (what the engine and the website read). */
const ruleOut = (r) => ({
  website_service_id: r.website_service_id || null,
  direction: r.direction,
  span: r.span,
  outcome: r.outcome,
  service_type_id: r.service_type_id || null,
});

/**
 * Descriptors for many website services in two queries, keyed by id.
 * `rows` are publicList-shaped (service_type_id, transport_mode, service_key).
 */
async function descriptorsFor(client, rows) {
  const ids = rows.map((r) => r.service_type_id);
  const [members, rules] = await Promise.all([repo.membersOf(client, ids), repo.routeRules(client, ids)]);
  const byService = new Map();
  for (const m of members) {
    const k = String(m.website_service_id);
    byService.set(k, [...(byService.get(k) || []), m]);
  }
  const out = new Map();
  for (const row of rows) {
    out.set(String(row.service_type_id), descriptorOf(row, byService.get(String(row.service_type_id)) || []));
  }
  return { descriptors: out, rules: rules.map(ruleOut) };
}

/**
 * Run the engine for a website request. Returns `{ service, result }`, or null
 * when the id is not a published, active website service.
 */
async function evaluateFor(client, websiteServiceId, answers) {
  const { rows } = await client.query(
    `SELECT p.service_type_id, p.web_name_en, p.web_name_fr,
            st.name_en, st.name_fr, st.key AS service_key, st.transport_mode
       FROM service_type_web_profile p
       JOIN service_type st ON st.service_type_id = p.service_type_id
      WHERE p.service_type_id = $1 AND p.is_published = true AND st.is_active = true`,
    [websiteServiceId],
  );
  const row = rows[0];
  if (!row) return null;
  const { descriptors, rules } = await descriptorsFor(client, [row]);
  const service = descriptors.get(String(row.service_type_id));
  const result = quoteEngine.evaluate(service, answers, rulesFor(rules, row.service_type_id));
  return {
    service,
    name: row.web_name_en || row.name_en || row.web_name_fr || row.name_fr || "",
    result,
  };
}

module.exports = { memberOf, descriptorOf, descriptorsFor, rulesFor, ruleOut, evaluateFor };
