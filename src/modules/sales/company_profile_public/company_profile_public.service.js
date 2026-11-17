"use strict";
/**
 * The public Company Profile link, `/profile/<token>` on public-web (guide
 * §3.6, §3.8).
 *
 * THE TOKEN IS THE ONLY CREDENTIAL. Only its hash is stored, so the table
 * cannot hand one back. A revoked or expired link, and a link to a profile
 * that has nothing published, all answer the same 404: a stranger learns
 * nothing about why.
 *
 * WHAT IS RECORDED ABOUT AN OPEN. The time, a coarse browser label ("Mobile
 * browser") and a hash of the visitor that cannot be turned back into an
 * address. The first open by a person (not an automated client) notifies
 * whoever shared the link, once, decided by the statement that stamps it.
 */
const crypto = require("crypto");
const { config } = require("../../../config/env");
const profile = require("../company_profile/company_profile.service");
const repo = require("../company_profile/company_profile.repo");
const events = require("../company_profile/company_profile.events");
const { coarseUserAgent } = require("../../../services/signatures/mask");
const { emitEvent } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

const notFound = () => new AppError("NOT_FOUND", "This link is not valid", 404);

async function resolve(c, token) {
  if (!token || String(token).length > 200) throw notFound();
  const share = await repo.shareByHash(c, profile.tokenHash(token));
  if (!share || share.revoked_at || new Date(share.expires_at).getTime() <= Date.now()) throw notFound();
  const version = share.version_id
    ? await repo.getVersion(c, share.version_id)
    : await repo.byStatus(c, "PUBLISHED");
  if (!version || version.status === "DRAFT") throw notFound();
  return { share, version };
}

/** A hash of who opened it: enough to tell visitors apart, never an address. */
function visitorHash(ip, ua) {
  return crypto
    .createHmac("sha256", String(config.JWT_ACCESS_SECRET))
    .update(`${ip || ""}|${ua || ""}`)
    .digest("hex")
    .slice(0, 32);
}

async function record(c, share, kind, { ip, ua }) {
  const agentLabel = coarseUserAgent(ua, "en");
  const first = await repo.recordOpen(c, share.share_id, { kind, agentLabel, visitorHash: visitorHash(ip, ua) });
  if (!first || kind !== "VIEW" || /automated/i.test(agentLabel)) return;
  try {
    await emitEvent(c, {
      eventTypeKey: events.SHARE_OPENED, moduleKey: events.MODULE,
      entityRef: `company_profile_share:${share.share_id}`, actorUserId: null,
      payload: { lead_id: share.lead_id || null },
    });
    const notifications = require("../../notification/notification.service");
    const who = share.recipient_name || share.recipient_email || "A recipient";
    const lead = share.lead_id ? await repo.leadExists(c, share.lead_id) : null;
    const people = [...new Set([share.created_by, lead && lead.owner_user_id].filter(Boolean))];
    for (const userId of people) {
      await notifications.notify(c, {
        userId,
        eventTypeKey: events.SHARE_OPENED,
        title: "Company profile opened",
        body: `${who} opened the company profile you shared.`,
        entityRef: `company_profile_share:${share.share_id}`,
        url: "/sales/company-profile",
        dedupeKey: `company_profile_share_opened:${share.share_id}:${userId}`,
      });
    }
  } catch (err) {
    // The reader is already looking at the profile; a notice that fails to send
    // must not turn their open into an error.
    logger.warn({ err: err && err.message, share_id: share.share_id }, "company profile open notice failed");
  }
}

async function open(c, { token, language = null, ip = null, ua = null }) {
  const { share, version } = await resolve(c, token);
  const lang = language === "FR" || language === "EN" ? language : share.language;
  const data = await profile.present(c, version, lang);
  await record(c, share, "VIEW", { ip, ua });
  return { presentation: data };
}

async function download(c, { token, language = null, ip = null, ua = null }) {
  const { share, version } = await resolve(c, token);
  const lang = language === "FR" || language === "EN" ? language : share.language;
  const data = await profile.present(c, version, lang);
  const out = await profile.render(c, data, version);
  await record(c, share, "DOWNLOAD", { ip, ua });
  return out;
}

module.exports = { open, download, resolve, visitorHash };
