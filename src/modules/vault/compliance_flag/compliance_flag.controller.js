// search:none — compliance flags point at a record (client, file) that ⌘K finds; the flags are a queue on Vault.
"use strict";
const service = require("./compliance_flag.service");
const { asyncHandler } = require("../../../utils/errors");
const { sendPaged } = require("../../../shared/http/paged");
const actor = (req) => req.user || { user_id: null };
module.exports = {
  catalogue: asyncHandler(async (_req, res) => res.json({ data: service.catalogue() })),
  // UI callers opt into paging with limit/offset. Calls without those params
  // retain the legacy full-array contract used by service and AI consumers.
  list: asyncHandler(async (req, res) => {
    if (req.query.limit !== undefined || req.query.offset !== undefined) {
      const result = await req.tenantDb((c) => service.listPaged(c, req.query));
      return sendPaged(res, result);
    }
    return res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) });
  }),
  run: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.run(c, { rules: req.body.rules, actor: actor(req) })) })),
  resolve: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.resolve(c, { id: req.params.id, actor: actor(req) })) })),
};
