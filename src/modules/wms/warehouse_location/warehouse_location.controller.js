// search:none — locations are picked by code in warehouse forms and browsed on Warehouse › Locations.
"use strict";
const { makeController } = require("../../../shared/crud/resource");
module.exports = makeController(require("./warehouse_location.service"), "Location");
