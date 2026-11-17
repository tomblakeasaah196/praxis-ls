-- ============================================================================
-- TENANT DB — 14500 Sales lean revamp, PR 1: Campaigns and Partnerships &
-- Vendors are removed (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md, owner decision D10,
-- 17/11/2026).
--
-- The owner's words: campaigns are "quite cumbersome for a module", and
-- partnership and vendor applications are not needed because suppliers already
-- have their 360 and a partnership offer arrives as a general enquiry (the
-- website contact form has offered a Partnership type all along). The code went
-- in the same PR; this removes what it read and wrote.
--
-- WHAT GOES
--
--   marketing_campaign      MOD-22's register (0350, 0685)
--   newsletter_subscriber   the website footer's list, removed from the site
--   campaign_template,      MOD-22's email templates and sending identities
--   campaign_sender         (0452)
--   partnership_request     the F10 register (0350, 0688, 0699, 10701)
--   contact_enquiry.partnership_request_id
--                           the enquiry desk's only link onto that register;
--                           an enquiry keeps its message, type and lead link
--   mail send point `campaign.send` and its bindings (10726)
--   the event types those modules emitted, so neither the workflow designer
--   nor the notification settings offers an event nothing can raise
--
-- MOD-22 itself leaves the platform catalogue in seed 9160, and its role grants
-- leave in tenant seed 9026: both have to run AFTER the seeds that create them
-- (9100/9110 and 9021), which on a fresh database run after every migration.
--
-- WHAT STAYS
--
--   party_document_type PARTNERSHIP_PROFILE (0699) is a SUPPLIER document type
--   and suppliers keep it. Vault files of type PARTNERSHIP_PROFILE stay readable
--   under MOD-25 (document_vault.types.js).
--   lead.source and quote_request.intake_channel keep the value CAMPAIGN: rows
--   may carry it, and the Sales lean revamp's PR 2 redraws those vocabularies.
--
-- The rows are dropped, not archived, by decision; the pre-deploy dump is the
-- record of what was there.
-- ============================================================================

-- The enquiry desk's link goes first: it is the only foreign key onto
-- partnership_request.
-- DESTRUCTIVE: the partnership register is removed (D10); the enquiry itself, its type and its lead link are kept
ALTER TABLE contact_enquiry DROP COLUMN IF EXISTS partnership_request_id;

-- DESTRUCTIVE: the partnership and vendor application register is removed (D10); suppliers are onboarded from Suppliers 360
DROP TABLE IF EXISTS partnership_request;

-- DESTRUCTIVE: campaign email templates are removed with Campaigns (D10)
DROP TABLE IF EXISTS campaign_template;

-- DESTRUCTIVE: campaign sending identities are removed with Campaigns (D10); mailboxes are configured in Mail
DROP TABLE IF EXISTS campaign_sender;

-- DESTRUCTIVE: the website newsletter list is removed with its footer form (D10)
DROP TABLE IF EXISTS newsletter_subscriber;

-- DESTRUCTIVE: the campaign register is removed (D10)
DROP TABLE IF EXISTS marketing_campaign;

-- The bulk campaign send point. Its bindings cascade (10726).
-- DESTRUCTIVE: the send point serves only the removed campaign module
DELETE FROM mail_send_point WHERE send_point_key = 'campaign.send';

-- The shared General Enquiries mailbox no longer feeds a partnership register.
UPDATE mail_shared_catalogue
   SET feeds = array_remove(feeds, 'partnership_request')
 WHERE 'partnership_request' = ANY (feeds);

-- Event types nothing can raise any more. A workflow bound to one cascades
-- (0120); event_log rows carry the key without a foreign key and stay as
-- history.
-- DESTRUCTIVE: these events belonged to the removed campaign and partnership modules
DELETE FROM event_type
 WHERE key IN (
   'campaign.created', 'campaign.updated', 'campaign.submitted',
   'campaign.approved', 'campaign.rejected', 'campaign.active',
   'campaign.paused', 'campaign.ended', 'campaign.actuals_recorded',
   'newsletter.subscribed', 'newsletter.unsubscribed',
   'partnership_request.created', 'partnership_request.updated',
   'partnership_request.in_review', 'partnership_request.approved',
   'partnership_request.rejected', 'partnership_request.document_attached',
   'partnership_request.supplier_drafted',
   'contact_enquiry.routed_to_partnership'
 );

-- DOWN
-- IRREVERSIBLE: the rows are gone by decision (D10). Restoring them means
-- restoring the pre-deploy dump. To restore only the SHAPES, so the code of an
-- earlier release could boot against this database, re-run the CREATE and
-- ALTER statements of 0350 (marketing_campaign, newsletter_subscriber,
-- partnership_request), 0452, 0685, 0688, 0699, 10701 and 0689's
-- partnership_request_id column, in that order, then re-run 0685, 0688 and
-- 0689's event_type inserts and 10726's campaign.send row.
