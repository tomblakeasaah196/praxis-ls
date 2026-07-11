"use strict";
const service = require("./tax_declaration.service");
const { asyncHandler } = require("../../../utils/errors");
const filters = (req) => { const q = req.validatedQuery || {}; return { entityId: q.entity_id, from: q.from, to: q.to }; };
module.exports = {
  vatReturn: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.vatReturn(c, filters(req))) })),
  corporateTax: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.corporateTax(c, filters(req))) })),
};
