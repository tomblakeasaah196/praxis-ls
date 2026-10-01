"use strict";
/**
 * Incoterms® 2020 — the ONE list of delivery terms the product knows.
 *
 * ── WHY HERE ────────────────────────────────────────────────────────────────
 *
 * It was written out four times and the four copies disagreed (tenant review,
 * meeting 6, item 2.3): the portal offered 6, the staff form 10 without FAS,
 * the AI fill and the mail glossary 11. A client who picked "Not sure" on the
 * portal was stored as `TBD`, which the staff select could not show — it
 * displayed EXW and defaulted to FOB. One list here, read by the API (the AI
 * fill, the mail glossary, the service types, the request validators), by the
 * staff app, and — through the service-type payloads the API sends — by the
 * public website and the client portal, which deliberately do not import this
 * package (their first-paint budget; see public-web/src/lib/site-theme.ts).
 *
 * ── THE ICC 2020 SPLIT THIS FILE ENCODES ────────────────────────────────────
 *
 * Seven rules are for ANY mode of transport, including sea: EXW, FCA, CPT,
 * CIP, DAP, DPU, DDP. Four are for SEA AND INLAND WATERWAY transport only:
 * FAS, FOB, CFR, CIF. That split is the whole basis of `defaultsForMode`
 * (owner decision Q3): a sea service offers all eleven, an air, road or rail
 * service the seven any-mode terms — FOB on an air waybill is a contract the
 * ICC rules do not support, and offering it is how a desk ends up pricing one.
 *
 * Each service type CARRIES its own list (`service_type.incoterms`, 14300),
 * pre-filled from these defaults and editable by the tenant, because the
 * tenant may choose not to quote some terms at all.
 *
 * ── "NOT SURE" ──────────────────────────────────────────────────────────────
 *
 * `quote_request.incoterm` is NOT NULL (0683). A client or a prospect who does
 * not know the term is giving a real answer for the desk to follow up, so it
 * is stored as `TBD` and read back everywhere as "To be determined". `N/A` is
 * the other stored non-term: what the website files for a storage or a
 * no-movement enquiry, where there is no delivery term to have.
 */

/** In the order the ICC publishes them: E, F, C, D groups; any-mode rules first in each. */
const INCOTERMS = [
  { code: "EXW", name_en: "Ex Works", name_fr: "À l'usine", sea_only: false },
  { code: "FCA", name_en: "Free Carrier", name_fr: "Franco transporteur", sea_only: false },
  { code: "FAS", name_en: "Free Alongside Ship", name_fr: "Franco le long du navire", sea_only: true },
  { code: "FOB", name_en: "Free On Board", name_fr: "Franco à bord", sea_only: true },
  { code: "CPT", name_en: "Carriage Paid To", name_fr: "Port payé jusqu'à", sea_only: false },
  { code: "CIP", name_en: "Carriage and Insurance Paid To", name_fr: "Port payé, assurance comprise, jusqu'à", sea_only: false },
  { code: "CFR", name_en: "Cost and Freight", name_fr: "Coût et fret", sea_only: true },
  { code: "CIF", name_en: "Cost, Insurance and Freight", name_fr: "Coût, assurance et fret", sea_only: true },
  { code: "DAP", name_en: "Delivered at Place", name_fr: "Rendu au lieu de destination", sea_only: false },
  { code: "DPU", name_en: "Delivered at Place Unloaded", name_fr: "Rendu au lieu de destination déchargé", sea_only: false },
  { code: "DDP", name_en: "Delivered Duty Paid", name_fr: "Rendu droits acquittés", sea_only: false },
];

const CODES = INCOTERMS.map((i) => i.code);
const ANY_MODE = INCOTERMS.filter((i) => !i.sea_only).map((i) => i.code);
const SEA_ONLY = INCOTERMS.filter((i) => i.sea_only).map((i) => i.code);

/** What a request stores when the requester does not know the term ("Not sure"). */
const NOT_SURE = "TBD";
/** What a request stores when the service has no delivery term at all (storage, representation). */
const NOT_APPLICABLE = "N/A";

const BY_CODE = new Map(INCOTERMS.map((i) => [i.code, i]));

const isCode = (code) => BY_CODE.has(String(code || "").toUpperCase());

/**
 * The defaults a service type is pre-filled with, from its transport mode
 * (`service_type.transport_mode`, the quote form's card).
 *
 *   SEA                      all eleven — the four sea-only rules exist for it.
 *   AIR, ROAD, RAIL          the seven any-mode rules (owner decision Q3).
 *   CUSTOMS, OTHER           all eleven. A clearance file's goods arrived by sea
 *                            or by air, and "other" is a service the rules can
 *                            say nothing about, so nothing is ruled out — the
 *                            tenant narrows it in Service types.
 *   STORAGE                  none. Warehousing moves nothing anywhere, so a
 *                            delivery term is not a question it can be asked.
 */
function defaultsForMode(mode) {
  switch (String(mode || "").toUpperCase()) {
    case "AIR":
    case "ROAD":
    case "RAIL":
      return [...ANY_MODE];
    case "STORAGE":
      return [];
    default:
      return [...CODES];
  }
}

/**
 * A list as stored: known codes only, upper-cased, de-duplicated and in ICC
 * order — so two lists with the same terms are the same list, whatever order
 * a person ticked them in.
 */
function normalise(list) {
  if (!Array.isArray(list)) return [];
  const want = new Set(list.map((c) => String(c || "").trim().toUpperCase()));
  return CODES.filter((c) => want.has(c));
}

/** The words a person reads for a stored value, in their language. */
function label(code, lang = "en") {
  const c = String(code || "").toUpperCase();
  if (c === NOT_SURE) return lang === "fr" ? "À déterminer" : "To be determined";
  if (c === NOT_APPLICABLE) return lang === "fr" ? "Sans objet" : "Not applicable";
  const row = BY_CODE.get(c);
  if (!row) return code || "";
  return `${row.code} — ${lang === "fr" ? row.name_fr : row.name_en}`;
}

/** The terms of a list, as `{ code, name_en, name_fr, sea_only }` rows — what an API sends a form. */
const describe = (codes) => normalise(codes).map((c) => ({ ...BY_CODE.get(c) }));

module.exports = {
  INCOTERMS,
  CODES,
  ANY_MODE,
  SEA_ONLY,
  NOT_SURE,
  NOT_APPLICABLE,
  isCode,
  defaultsForMode,
  normalise,
  label,
  describe,
};
