"use strict";

const transition = (status) => "purchase_request." + String(status).toLowerCase();
module.exports = { MODULE: "MOD-62", CREATED: "purchase_request.created", UPDATED: "purchase_request.updated", ARCHIVED: "purchase_request.archived", transition };
