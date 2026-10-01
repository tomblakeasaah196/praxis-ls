"use strict";
module.exports = {
  MODULE: "MOD-05",
  CREATED: "dictionary_item.created",
  UPDATED: "dictionary_item.updated",
  // A rate is never edited in place — it is superseded (expire the open row,
  // open a new one). One event for the pair, because it is one decision.
  RATE_SUPERSEDED: "dictionary_item.rate_superseded",
  IMPORTED: "dictionary_item.imported",
  // The direction changed, so the code moved to the new letter's next free
  // number. Audit-only: the before/after pair is the record of the old code.
  RECODED: "dictionary_item.recoded",
  // A person linked a line to its service's other modes, or confirmed it stands
  // alone (14342 "Lines to pair", meeting 6 F2). Audit-only.
  SIBLING_LINKED: "dictionary_item.sibling_linked",
  // A line was saved with an AI-suggested posting (meeting 6, F3): where the
  // suggestion came from (cache / fresh search / local fallback), the model
  // and cache entry, and whether the person accepted or changed it.
  POSTING_SUGGESTED: "dictionary_item.posting_suggested",
  // The one-off review of the existing lines' postings (F8). Audit-only.
  POSTING_REVIEW_STARTED: "dictionary_item.posting_review_started",
};
