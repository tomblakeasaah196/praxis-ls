"use strict";

const statusChange = (status) => "costing." + String(status).toLowerCase();
module.exports = { MODULE: "MOD-46", CREATED: "costing.created", APPROVED: "costing.approved", statusChange };
