// search:none — cycle counts are worked by location and date on Warehouse › Cycle counts.
"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./cycle_count.service"), "Cycle count");
