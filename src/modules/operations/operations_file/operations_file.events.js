"use strict";

const statusChange = (to) => "dossier.status." + String(to).toLowerCase();
module.exports = { MODULE: "MOD-29", CREATED: "dossier.created", UPDATED: "dossier.updated", ARCHIVED: "dossier.archived", statusChange };
