// search:none — the talent pool holds candidates' personal data and is searched on its own screen under HR grants.
"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./talent_pool.service"), "Talent");
