"use strict";
const service = require("./numbering_setting.service");
const { asyncHandler } = require("../../../utils/errors");
module.exports = {
  get: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.get(c, req.params.moduleKey)) })),
  put: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.put(c, {
      moduleKey: req.params.moduleKey, scheme: req.body.scheme,
      actor: req.user || { user_id: null }, ip: req.ip,
    }));
    res.json({ data });
  }),
};
