/**
 * Worker job: the emails one website message causes (SmartLS website v2, PR 2).
 *
 * The inbox copy and the visitor's acknowledgement, after the message has
 * committed. `enquiry-mail.service.deliverEnquiry` stamps each email as it
 * leaves and sends only what has not, so a retry after a half-finished attempt
 * does not send the inbox copy twice. A throw leaves the job to BullMQ's
 * retries (five, exponential), and the message itself is never at risk: it is
 * already in the database and in the in-app notification.
 *
 * LIVE ONLY: public routes are pinned to live, and a rehearsal message mailed
 * to a real inbox would be a message nobody sent.
 *
 * Job data: { tenantMeta, enquiryId, tenantName, siteOrigin }.
 */
"use strict";
const registry = require("../../services/tenant/registry.service");
const mail = require("../../modules/sales/public_intake/enquiry-mail.service");

module.exports = async function siteEnquiryMail(job) {
  const { tenantMeta, enquiryId, tenantName = "", siteOrigin = "" } = job.data || {};
  if (!tenantMeta || !enquiryId) throw new Error("site-enquiry-mail needs tenantMeta and enquiryId");
  return registry.withTenantConnection(tenantMeta, "live", (c) =>
    mail.deliverEnquiry(c, { enquiryId, slug: tenantMeta.slug, tenantName, siteOrigin }));
};
