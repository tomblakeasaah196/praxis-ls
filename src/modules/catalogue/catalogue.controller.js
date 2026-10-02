// search:none — the module catalogue is configuration, browsed on Settings › Module catalogue, which ⌘K finds as a page.
"use strict";
const { asyncHandler } = require("../../utils/errors");
const service = require("./catalogue.service");

module.exports = {
  listModules: asyncHandler(async (_req, res) => res.json({ data: await service.listModules() })),
};
