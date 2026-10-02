// ai:none — IAM roles. Editing who may do what is the control the AI is bound BY.
// search:none — roles are a short list on Security › Roles, which ⌘K finds as a page.
"use strict";
const { makeController } = require("../../../shared/crud/resource");
// Roles are identity data (env-independent) — pin to the live schema.
module.exports = makeController(require("./iam_role.service"), "Role", { identity: true });
