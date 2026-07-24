/**
 * Meta WhatsApp Cloud API client (V2.2 §6.17). Webhook-based: inbound arrives at
 * /api/webhooks/meta/whatsapp; outbound goes through here.
 *
 * Credentials resolve PER-TENANT, DB-first (BUILD_CONVENTIONS §7):
 *   token     ← integration_secret 'whatsapp_token' (AES-256-GCM) → env META_WA_TOKEN
 *   phone_id  ← comms.whatsapp.phone_id (plain setting)           → env META_WA_PHONE_ID
 *   version   ← comms.whatsapp.api_version                        → env META_WA_API_VERSION
 * Set + tested in Smart Comms (smartcomm.config.service). Every entry point
 * takes the tenant client so it resolves the caller's own credentials.
 */

"use strict";

const axios = require("axios");
const { config } = require("../config/env");
const settings = require("../modules/security/setting/setting.service");
const { getSetting } = require("../shared/config/settings");

const GRAPH = "https://graph.facebook.com";

/** Resolve the tenant's WhatsApp creds (token/phoneId/apiVersion), env-fallback. */
async function resolveConfig(client) {
  let token = null;
  let phoneId = null;
  let apiVersion = config.META_WA_API_VERSION || "v18.0";
  if (client) {
    token = await settings.readSecret(client, "whatsapp_token");
    const wa = (await getSetting(client, "comms", "whatsapp", null)) || {};
    phoneId = wa.phone_id || null;
    if (wa.api_version) apiVersion = wa.api_version;
  }
  token = token || config.META_WA_TOKEN || null;
  phoneId = phoneId || config.META_WA_PHONE_ID || null;
  return { token, phoneId, apiVersion };
}

function assertConfigured({ token, phoneId }) {
  if (!token || !phoneId) {
    throw new Error("whatsapp: not configured — set token + phone_id in Smart Comms");
  }
}

async function sendText(client, { to, body }) {
  const cfg = await resolveConfig(client);
  assertConfigured(cfg);
  const url = `${GRAPH}/${cfg.apiVersion}/${cfg.phoneId}/messages`;
  return axios.post(
    url,
    { messaging_product: "whatsapp", to, type: "text", text: { body } },
    { headers: { Authorization: `Bearer ${cfg.token}` } },
  );
}

async function sendTemplate(client, { to, template_name, language_code, components }) {
  const cfg = await resolveConfig(client);
  assertConfigured(cfg);
  const url = `${GRAPH}/${cfg.apiVersion}/${cfg.phoneId}/messages`;
  return axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name: template_name, language: { code: language_code || "en" }, components },
    },
    { headers: { Authorization: `Bearer ${cfg.token}` } },
  );
}

/**
 * Live, read-only credential check: GET the phone-number node. Confirms the
 * token authenticates AND owns the phone_id. Returns { ok, ... }; never throws.
 */
async function verifyConfig(client) {
  const cfg = await resolveConfig(client);
  if (!cfg.token) return { ok: false, error: "no WhatsApp token configured" };
  if (!cfg.phoneId) return { ok: false, error: "no WhatsApp phone_id configured" };
  try {
    const { data } = await axios.get(`${GRAPH}/${cfg.apiVersion}/${cfg.phoneId}`, {
      params: { fields: "verified_name,display_phone_number,quality_rating" },
      headers: { Authorization: `Bearer ${cfg.token}` },
      timeout: 10000,
    });
    return {
      ok: true,
      verified_name: data.verified_name || null,
      display_phone_number: data.display_phone_number || null,
      quality_rating: data.quality_rating || null,
    };
  } catch (err) {
    const r = err.response;
    return {
      ok: false,
      status: r && r.status,
      error: (r && r.data && r.data.error && r.data.error.message) || err.message,
    };
  }
}

module.exports = { sendText, sendTemplate, verifyConfig, resolveConfig };
