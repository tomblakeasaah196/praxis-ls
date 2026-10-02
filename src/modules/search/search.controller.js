// ai:none — search is how a PERSON navigates; the assistant already reads every module through that module's own manifest, so a second door to the same rows would only duplicate them.
// search:none — this is the search itself; it owns no records of its own.
"use strict";
const service = require("../../services/search/search.service");
const registry = require("../../services/search/registry");
const { asyncHandler } = require("../../utils/errors");

module.exports = {
  search: asyncHandler(async (req, res) => {
    const { q, types, limit } = req.searchQuery;
    const modules = registry.providers().map((p) => p.module);
    // Grants are identity data — env-independent — so they resolve on the
    // identity schema; the rows come from the request's LIVE or TEST schema.
    const allowed = await req.identityDb((client) => service.allowedModules(client, req.user, modules));
    const data = await req.tenantDb((c) =>
      service.search(c, { q, types: types ? types.split(",") : null, limit, allowed }),
    );
    res.json({ data });
  }),
};
