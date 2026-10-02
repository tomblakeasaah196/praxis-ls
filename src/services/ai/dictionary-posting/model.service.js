/**
 * The model the AI-suggested OHADA posting runs on — chosen automatically,
 * used by THIS feature only (meeting 6, F7).
 *
 * Owner's words: "Seed a stronger Gemini model JUST FOR THIS feature … This
 * model works just here … We don't need to manually configure anything."
 *
 * So the feature reads the platform's Gemini CREDENTIAL (resolveVendor(null,
 * "gemini") — Platform Console → Integrations → AI providers) but not that
 * credential's model, and picks for itself:
 *
 *   the strongest GENERALLY AVAILABLE Gemini Pro-tier model — not preview, not
 *   experimental — that supports generateContent and Google Search grounding,
 *   from Google's native models list on that key.
 *
 * "Strongest" is the highest version: Google numbers Pro generations in order
 * (2.5 → 3 → 3.1 …). Grounding with the `google_search` tool exists from the
 * 2.x generation on; the list carries no grounding flag, so the version is the
 * test, and the first grounded call is the proof (a refusal there marks the
 * choice failed and the next call falls back).
 *
 * The choice is then verified the way gemini-model-check.service verifies the
 * platform model — GET /models/{id}, bounded, cached, logged at boot — and shown
 * read-only on the console's AI providers screen beside that check. When no
 * model qualifies (or the list cannot be read), the feature falls back to the
 * platform Gemini model (the credential's, else GEMINI_MODEL) and logs it.
 *
 * Nothing else changes model: the chat chain, call summaries, vision and
 * transcription keep the credential's model, and the console's chat-primary
 * setting does not touch this choice.
 */
"use strict";

const axios = require("axios");
const { config } = require("../../../config/env");
const { resolveVendor } = require("../llm.service");
const { nativeBase } = require("../gemini-transcription.service");
const { logger } = require("../../../config/logger");

const TIMEOUT_MS = 10_000;
const CACHE_MS = 6 * 60 * 60 * 1000;
let cached = null;

/** Words that mark a model id as not generally available, or not for text. */
const NOT_GA = /(preview|exp|experimental|latest|tts|image|live|audio|native|computer-use|thinking|embedding|learnlm)/i;

/** "models/gemini-3.1-pro" → { id, version: [3, 1], base: true } or null. */
function parseProModel(name) {
  const id = String(name || "").replace(/^models\//, "");
  const m = /^gemini-(\d+)(?:\.(\d+))?-pro(?:-(\d{3}))?$/i.exec(id);
  if (!m) return null;
  return { id, version: [Number(m[1]), Number(m[2] || 0)], stable_suffix: m[3] || null };
}

/**
 * Pick from a native models list — PURE, so the rule is tested without Google.
 * Candidates: Pro tier, GA (no preview/exp word), generateContent supported,
 * generation ≥ 2 (Google Search grounding). Highest version wins; within one
 * version the plain alias ("gemini-3.1-pro") beats a dated build ("-002").
 */
function chooseFromList(models) {
  const candidates = [];
  for (const m of models || []) {
    const name = m && m.name;
    if (!name || NOT_GA.test(name)) continue;
    const parsed = parseProModel(name);
    if (!parsed) continue;
    const methods = m.supportedGenerationMethods || [];
    if (methods.length && !methods.includes("generateContent")) continue;
    if (parsed.version[0] < 2) continue;
    candidates.push(parsed);
  }
  candidates.sort((a, b) =>
    b.version[0] - a.version[0] ||
    b.version[1] - a.version[1] ||
    (a.stable_suffix ? 1 : 0) - (b.stable_suffix ? 1 : 0) ||
    String(b.stable_suffix || "").localeCompare(String(a.stable_suffix || "")),
  );
  return candidates[0] ? candidates[0].id : null;
}

/** The platform's own Gemini model — the fallback. */
function platformModel(vendor) {
  return String((vendor && vendor.model) || config.GEMINI_MODEL || "").replace(/^models\//, "") || null;
}

async function listModels(vendor) {
  const base = nativeBase(vendor.endpoint_url);
  const out = [];
  let pageToken;
  for (let i = 0; i < 5; i++) {
    const { data } = await axios.get(`${base}/models`, {
      headers: { "x-goog-api-key": vendor.api_key },
      params: { pageSize: 1000, ...(pageToken ? { pageToken } : {}) },
      timeout: TIMEOUT_MS,
    });
    out.push(...((data && data.models) || []));
    pageToken = data && data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/**
 * The model this feature uses now, and how sure we are of it:
 *   { status, model, chosen_from, fallback_model, checked_at, detail? }
 *     ok           a GA Pro model was chosen and verified
 *     fallback     none qualified (or Google could not be asked): the platform
 *                  Gemini model is used instead — logged
 *     unconfigured no gemini credential and no GEMINI_API_KEY
 */
async function postingModel({ force = false } = {}) {
  if (!force && cached && Date.now() - Date.parse(cached.checked_at) < CACHE_MS) return cached;
  const checkedAt = new Date().toISOString();
  let vendor = null;
  try {
    vendor = await resolveVendor(null, "gemini");
  } catch (err) {
    logger.warn({ err }, "dictionary posting model: the gemini credential could not be read");
  }
  const fallback = platformModel(vendor);
  if (!vendor || !vendor.api_key) {
    cached = { status: "unconfigured", model: null, fallback_model: fallback, checked_at: checkedAt };
    return cached;
  }
  let chosen = null;
  let detail = null;
  try {
    chosen = chooseFromList(await listModels(vendor));
    if (chosen) {
      const { data } = await axios.get(`${nativeBase(vendor.endpoint_url)}/models/${encodeURIComponent(chosen)}`, {
        headers: { "x-goog-api-key": vendor.api_key },
        timeout: TIMEOUT_MS,
      });
      const methods = (data && data.supportedGenerationMethods) || [];
      if (methods.length && !methods.includes("generateContent")) {
        detail = `${chosen} cannot generate content`;
        chosen = null;
      } else {
        detail = (data && data.displayName) || null;
      }
    } else {
      detail = "no generally available Gemini Pro model with Google Search grounding on this key";
    }
  } catch (err) {
    const message = (err.response && err.response.data && err.response.data.error && err.response.data.error.message) || err.message;
    detail = `Google's model list could not be read: ${String(message).slice(0, 200)}`;
    chosen = null;
  }
  cached = chosen
    ? { status: "ok", model: chosen, chosen_from: "models.list", fallback_model: fallback, checked_at: checkedAt, detail }
    : { status: "fallback", model: fallback, chosen_from: "platform", fallback_model: fallback, checked_at: checkedAt, detail };
  if (!chosen) logger.warn({ postingModel: cached }, "dictionary posting: falling back to the platform Gemini model");
  return cached;
}

/** A grounded call refused the chosen model: stop using it until the next check. */
function markFailed(model, reason) {
  if (cached && cached.model === model && cached.status === "ok") {
    cached = {
      ...cached,
      status: "fallback",
      model: cached.fallback_model,
      chosen_from: "platform",
      detail: `${model} refused a grounded call (${String(reason).slice(0, 160)}) — using the platform model`,
      checked_at: new Date().toISOString(),
    };
    logger.warn({ postingModel: cached }, "dictionary posting: chosen model failed, falling back");
  }
}

async function logPostingModelAtBoot() {
  const out = await postingModel({ force: true });
  if (out.status === "ok") logger.info({ model: out.model }, "Dictionary posting model chosen");
  else if (out.status === "fallback") logger.warn({ postingModel: out }, "Dictionary posting model: using the platform fallback");
  return out;
}

function resetCache() {
  cached = null;
}

module.exports = { postingModel, chooseFromList, parseProModel, markFailed, logPostingModelAtBoot, resetCache };
