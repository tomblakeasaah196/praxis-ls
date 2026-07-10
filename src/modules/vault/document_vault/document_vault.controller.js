"use strict";
const service = require("./document_vault.service");
const { asyncHandler, AppError } = require("../../../utils/errors");
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.query)) })),
  get: asyncHandler(async (req, res) => {
    const r = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!r) throw new AppError("NOT_FOUND", "Document not found", 404);
    res.json({ data: r });
  }),
  download: asyncHandler(async (req, res) => {
    const { doc, buffer } = await req.tenantDb((c) => service.fetchBytes(c, req.params.id));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=\"" + (doc.doc_type || "document") + "-" + doc.doc_id + ".pdf\"");
    res.send(buffer);
  }),
};
