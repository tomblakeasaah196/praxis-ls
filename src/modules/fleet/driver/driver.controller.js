// search:none — drivers are employees with a licence and are found as Employees; Fleet › Drivers lists the licence side.
"use strict";
const { makeController } = require("../../../shared/crud/resource");
const service = require("./driver.service");
const { asyncHandler } = require("../../../utils/errors");

const base = makeController(service, "Driver licence");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  ...base,
  expiring: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.expiring(c, { days: Number(req.query.days) || 30 })) })),
  scan: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.scanExpiring(c, { days: Number(req.body?.days) || 30, actor: actor(req) })) })),
};
