"use strict";
const service = require("./document_signature.service");
const { asyncHandler } = require("../../../utils/errors");
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listByRef(c, req.query.entity_ref)) })),
  sign: asyncHandler(async (req, res) => {
    const b = req.body;
    const r = await req.tenantDb((c) => service.sign(c, {
      entityRef: b.entity_ref, signerName: b.signer_name, method: b.method, signatureRef: b.signature_ref,
      actor: req.user || { user_id: null }, ip: req.ip,
    }));
    res.status(201).json({ data: r });
  }),
};
