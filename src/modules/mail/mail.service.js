/** Mail service (read-only view over per-purpose senders + the outbound log). */
"use strict";
const repo = require("./mail.repo");
const listIdentities = (client) => repo.listIdentities(client);
const listSent = (client, q = {}) => repo.listSentLog(client, { limit: q.limit, offset: q.offset, identityId: q.identity_id });
const listInbox = (client, q = {}) => repo.listInbox(client, { limit: q.limit, offset: q.offset, identityId: q.identity_id });
const updateIdentity = (client, id, fields) => repo.updateIdentity(client, id, fields);
const upsertIdentity = (client, d) => repo.upsertIdentity(client, d);
module.exports = { listIdentities, listSent, listInbox, updateIdentity, upsertIdentity };
