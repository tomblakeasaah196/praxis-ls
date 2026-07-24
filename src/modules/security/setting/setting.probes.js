/**
 * Settings integration-secret probes (MOD-70). Live, READ-ONLY connectivity
 * checks used by setting.service.testSecret to verify a stored provider key
 * actually authenticates — the Settings-side analogue of AI Governance's
 * testVendor (governance.service). Each probe:
 *   - takes the DECRYPTED secret (never logged),
 *   - performs a single, side-effect-free upstream call,
 *   - returns a small metadata object on success,
 *   - THROWS on failure (testSecret formats the error + upstream status).
 *
 * Keyed by the secret row's stored `provider`. Add a provider here to make its
 * key testable from Settings; keys with no probe report "no test available".
 */
"use strict";

const axios = require("axios");

const PROBES = {
  // exchangerate-api.com — the FX feed fx-sync uses. The key is a path segment;
  // a good key yields result:"success", a bad one result:"error" + error-type.
  "exchangerate-api": async (secret) => {
    const { data } = await axios.get(
      "https://v6.exchangerate-api.com/v6/" + secret + "/latest/USD",
      { timeout: 15000 },
    );
    if (!data || data.result !== "success") {
      throw new Error((data && data["error-type"]) || "unexpected response from exchangerate-api");
    }
    return { checked: "latest/USD", terms: data.terms_of_use || null };
  },

  // Geoapify reverse geocode. A valid key returns 200; an invalid key returns
  // 401, which axios throws (caught + formatted by testSecret).
  geoapify: async (secret) => {
    const { data } = await axios.get("https://api.geoapify.com/v1/geocode/reverse", {
      params: { lat: 48.8566, lon: 2.3522, format: "json", limit: 1, apiKey: secret },
      timeout: 8000,
    });
    return { results: data && Array.isArray(data.results) ? data.results.length : 0 };
  },
};

const hasProbe = (provider) => Boolean(provider && PROBES[provider]);

module.exports = { PROBES, hasProbe };
