"use strict";
/**
 * Event keys for the enquiry desk (F9).
 *
 * Every key here is registered in `event_type` by migration 0689 (enquiries) —
 * `event_log.event_type_key` carries no FK, so an unregistered key logs happily
 * and is then invisible to the workflow designer and the notification rules,
 * which is worse than failing because nothing reports it.
 *
 * There is deliberately NO `contact_enquiry.triaged`. Triage produces a lead,
 * and says so under `contact_enquiry.routed_to_lead`.
 */
module.exports = {
  MODULE: "MOD-25",

  ENQUIRY_CREATED: "contact_enquiry.created",
  ENQUIRY_UPDATED: "contact_enquiry.updated",
  ENQUIRY_READ: "contact_enquiry.read",
  ENQUIRY_RESPONDED: "contact_enquiry.responded",
  ENQUIRY_RESPONSE_FAILED: "contact_enquiry.response_failed",
  ENQUIRY_CLOSED: "contact_enquiry.closed",
  ENQUIRY_REOPENED: "contact_enquiry.reopened",
  ENQUIRY_ROUTED_TO_LEAD: "contact_enquiry.routed_to_lead",

  /** Reopening is READ-from-CLOSED, and says so rather than logging a second
   *  `read` that reads like somebody just opened the message again. */
  enquiryTransition: (from, to) =>
    (from === "CLOSED" && to === "READ" ? "contact_enquiry.reopened" : "contact_enquiry." + String(to).toLowerCase()),
};
