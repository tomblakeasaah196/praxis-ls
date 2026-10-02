"use strict";
module.exports = {
  MODULE: "MOD-27", CREATED: "quotation.created", SENT: "quotation.sent", ACCEPTED: "quotation.accepted", REJECTED: "quotation.rejected", CONVERTED: "quotation.converted",
  // Meeting 6, PR 4: the one-click quotation, and a client declining in the
  // portal — told to the client's people with who declined and why (G4). An
  // acceptance stays `quotation.accepted`, its payload saying who and how.
  CREATED_FROM_COSTING: "quotation.created_from_costing",
  DECLINED_BY_CLIENT: "quotation.declined_by_client",
  transition: (s) => "quotation." + String(s).toLowerCase(),
};
