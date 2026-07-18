"use strict";
const service = require("./mail.service");
const { asyncHandler } = require("../../utils/errors");
module.exports = {
  senders: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listIdentities(c)) })),
  sent: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listSent(c, req.query)) })),
  inbox: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listInbox(c, req.query)) })),
  updateSender: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.updateIdentity(c, req.params.id, req.body || {})) })),
  upsertSender: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.upsertIdentity(c, req.body || {})) })),
};
