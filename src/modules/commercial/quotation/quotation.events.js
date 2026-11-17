"use strict";
module.exports = {
  MODULE: "MOD-27", CREATED: "quotation.created", SENT: "quotation.sent", ACCEPTED: "quotation.accepted", REJECTED: "quotation.rejected", CONVERTED: "quotation.converted",
  // Meeting 6, PR 4: the one-click quotation, and a client declining in the
  // portal — told to the client's people with who declined and why (G4). An
  // acceptance stays `quotation.accepted`, its payload saying who and how.
  CREATED_FROM_COSTING: "quotation.created_from_costing",
  DECLINED_BY_CLIENT: "quotation.declined_by_client",
  // Lean revamp, PR 4 (14543): the link, the revision and the nightly expiry.
  VIEWED: "quotation.viewed",
  REVISED: "quotation.revised",
  EXPIRED: "quotation.expired",
  SHARE_REVOKED: "quotation.share_revoked",
  // Audit actions only (not events): the link minted, the mail sent.
  SHARED: "quotation.shared",
  MAILED: "quotation.mailed",
  MAIL_FAILED: "quotation.mail_failed",
  SECTIONS_DRAFTED: "quotation.sections_drafted",
  transition: (s) => "quotation." + String(s).toLowerCase(),
};
