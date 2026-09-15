/**
 * Voice-to-text (AI_ARCHITECTURE §3/§6). Provider: Groq/Whisper (OpenAI-compatible
 * transcription endpoint). Platform-first, env-fallback — the SAME resolution as
 * llm.service (BUILD_CONVENTIONS §7: DB-first, env-fallback): creds/endpoint/model
 * come from the ONE shared, encrypted platform.ai_vendor_credential ('groq') via
 * platformVendors.getConfig, and .env's GROQ_API_KEY/WHISPER_BASE_URL only apply
 * when the console row has no key. An explicit `vendor` argument (what the
 * ai-transcribe worker passes) still wins, so a caller holding a resolved config
 * keeps overriding. Swappable behind this one function; throws a clear error when
 * no provider is configured (parity with PDF needing Chromium).
 */
"use strict";

const { config } = require("../../config/env");

const { logger } = require("../../config/logger");

const platformVendors = require("../platform/ai-vendor.service");

/** Platform-first, env-fallback vendor config for the transcription vendor, or
 *  null when neither source holds a key. Mirrors llm.service's resolveVendor so
 *  every AI path reads the ONE console-managed key set — the direct callers of
 *  this service (mail dictation, smartcomm voice notes, HR intake) previously
 *  fell straight to the .env key, which has been empty since keys moved to the
 *  platform console, so they all failed "not configured" with a live key set. */
async function resolveVendor(explicit) {
  if (explicit && explicit.api_key) return explicit;
  const db = await platformVendors.getConfig("groq");
  if (db && db.is_active !== false && db.api_key) return db;
  if (config.GROQ_API_KEY) {
    return { vendor: "groq", api_key: config.GROQ_API_KEY, endpoint_url: config.WHISPER_BASE_URL, model: null };
  }
  return null;
}

/**
 * transcribe({ audio, mimeType, language, vendor }) → { text, audio_seconds, provider }.
 * `audio` is a Buffer; `vendor` is an optional decrypted governance config
 * ({ api_key, endpoint_url, model }) resolved from governance (DB).
 *
 * `language` is an ISO-639-1 hint ("en" / "fr"), and it is a hint the caller
 * should give whenever it has one. Whisper detects the language on its own and
 * is good at it on a clean thirty-second clip — it is markedly less good on a
 * five-second one with a forklift behind it, and its failure mode is not an
 * error but a fluent TRANSLATION into the language it guessed. A transcript
 * that reads as confident English of a French instruction is worse than no
 * transcript, because nothing about it looks wrong.
 */
async function transcribe({ audio, mimeType = "audio/mpeg", language = null, vendor = null }) {
  const resolved = await resolveVendor(vendor);
  const apiKey = resolved && resolved.api_key;
  const baseURL = (resolved && resolved.endpoint_url) || config.WHISPER_BASE_URL;
  if (!apiKey) throw new Error("voice transcription provider not configured (Groq/Whisper key missing)");
  if (!Buffer.isBuffer(audio) || audio.length === 0) throw new Error("transcribe needs a non-empty audio Buffer");

  const OpenAI = require("openai");
  const groq = new OpenAI({ apiKey, baseURL });
  const model = (resolved && resolved.model) || "whisper-large-v3";
  try {
    const res = await groq.audio.transcriptions.create({
      file: await toFile(audio, `audio.${extFor(mimeType)}`, mimeType),
      model,
      // Omitted rather than sent empty: the endpoint treats an empty string as
      // a language it cannot parse on some deployments, where absent means
      // "detect it yourself", which is the behaviour we want when nobody said.
      ...(LANGUAGES.has(String(language || "").toLowerCase())
        ? { language: String(language).toLowerCase() }
        : {}),
    });
    return { text: (res && res.text) || "", audio_seconds: res.duration || 0, provider: "groq" };
  } catch (err) {
    logger.warn({ err }, "transcription failed");
    throw err;
  }
}

/** The language hints this deployment accepts. Two, because two is what the
 *  corridor speaks and an unchecked passthrough is a free-text field going to
 *  a vendor. */
const LANGUAGES = new Set(["en", "fr"]);

/**
 * The extension Whisper is given.
 *
 * The endpoint decides what a file IS partly from its name, and a buffer sent as
 * a bare "audio" is a coin flip — so the container the browser recorded in is
 * named explicitly. Falls back to mp3, which is what the default mimeType says.
 */
function extFor(mimeType) {
  const type = String(mimeType || "").split(";")[0].trim().toLowerCase();
  return (
    {
      "audio/webm": "webm",
      "audio/ogg": "ogg",
      "audio/mp4": "mp4",
      "audio/m4a": "m4a",
      "audio/x-m4a": "m4a",
      "audio/wav": "wav",
      "audio/x-wav": "wav",
      "audio/mpeg": "mp3",
    }[type] || "mp3"
  );
}

// openai SDK's toFile helper (lazy so tests without the dep still load this file).
async function toFile(buffer, name, type) {
  const { toFile: tf } = require("openai");
  return tf(buffer, name, { type });
}

module.exports = { transcribe };
