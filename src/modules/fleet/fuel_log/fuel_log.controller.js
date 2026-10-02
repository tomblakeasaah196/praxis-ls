// search:none — fuel entries are rows of a vehicle's log, read on the vehicle.
"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./fuel_log.service"), "Fuel log");
