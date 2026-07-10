/**
 * Numbering-scheme settings (MOD-70, BUILD_CONVENTIONS §3/§6). Lets a tenant
 * read and edit the numbering scheme per document module. Stored in
 * setting(section='numbering', key=<module_key>); consumed by
 * services/documents/numbering.service at allocation time.
 */
"use strict";
const { getSetting, putSetting } = require("../../../shared/config/settings");
const { schemeFor, formatNumber } = require("../../../services/documents/numbering.service");
const { emitEvent, audit } = require("../../../shared/events/emit");

const SECTION = "numbering";

/** Effective scheme (defaults + override) plus a sample formatted number. */
async function get(client, moduleKey) {
  const scheme = await schemeFor(client, moduleKey);
  const override = await getSetting(client, SECTION, moduleKey, null);
  return {
    module_key: moduleKey,
    scheme,
    is_default: override === null,
    preview: formatNumber(scheme, { year: new Date().getUTCFullYear(), seq: 1 }),
  };
}

/** Upsert the tenant's scheme for a module. */
async function put(client, { moduleKey, scheme, actor = {}, ip = null }) {
  const row = await putSetting(client, { section: SECTION, key: moduleKey, value: scheme, actor });
  await emitEvent(client, { eventTypeKey: "numbering.scheme.updated", moduleKey: "MOD-70", entityRef: "numbering:" + moduleKey, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: "numbering.scheme.updated", moduleKey: "MOD-70", entityRef: "numbering:" + moduleKey, after: row, ip });
  return get(client, moduleKey);
}

module.exports = { get, put };
