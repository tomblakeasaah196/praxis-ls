"use strict";

const transition = (status) => "purchase_order." + String(status).toLowerCase();
module.exports = { MODULE: "MOD-60", CREATED: "purchase_order.created", UPDATED: "purchase_order.updated", ARCHIVED: "purchase_order.archived", transition };
