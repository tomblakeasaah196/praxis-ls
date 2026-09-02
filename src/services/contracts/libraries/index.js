/**
 * The clause libraries, indexed by key and language.
 *
 * Eighteen documents: six full contract bodies and three letters, each in
 * French and in English. `get(key, language)` is the only way in — a caller that
 * asked for a combination nobody authored gets a named refusal rather than
 * `undefined`, because the alternative is a contract rendered from nothing.
 */
"use strict";

const { LIBRARY_KEYS, LANGUAGES, LIBRARY_VERSION } = require("./_shape");
const { AppError } = require("../../../utils/errors");

const FILES = {
  "CDI:fr": require("./cdi.fr"),                   "CDI:en": require("./cdi.en"),
  "CDD:fr": require("./cdd.fr"),                   "CDD:en": require("./cdd.en"),
  "STAGE:fr": require("./stage.fr"),               "STAGE:en": require("./stage.en"),
  "INTERIM:fr": require("./interim.fr"),           "INTERIM:en": require("./interim.en"),
  "CONSULTANT:fr": require("./consultant.fr"),     "CONSULTANT:en": require("./consultant.en"),
  "TEMPORARY:fr": require("./temporary.fr"),       "TEMPORARY:en": require("./temporary.en"),
  "OFFER_LETTER:fr": require("./offer_letter.fr"), "OFFER_LETTER:en": require("./offer_letter.en"),
  "CONFIRMATION:fr": require("./confirmation.fr"), "CONFIRMATION:en": require("./confirmation.en"),
  "TERMINATION:fr": require("./termination.fr"),   "TERMINATION:en": require("./termination.en"),
};

/**
 * Which library a contract uses.
 *
 * `hr_contract.kind` and `employee.employment_type` are two different axes: an
 * EMPLOYMENT contract for a CDD hire is the CDD library, while an OFFER_LETTER
 * is the offer library whatever the employment type. So the kind decides first,
 * and only EMPLOYMENT falls through to the employment type.
 */
function libraryKeyFor({ kind, employmentType }) {
  if (kind && kind !== "EMPLOYMENT") return kind;
  const t = String(employmentType || "").toUpperCase();
  return LIBRARY_KEYS.includes(t) ? t : "CDI";
}

function get(key, language) {
  const lib = FILES[`${key}:${language}`];
  if (!lib) {
    throw new AppError(
      "NO_CLAUSE_LIBRARY",
      `No clause library for ${key} in ${language}.`,
      422,
      { key, language, available: Object.keys(FILES) },
    );
  }
  return lib;
}

/** Every library, for the integrity gate and the settings screen. */
const all = () => Object.entries(FILES).map(([id, lib]) => ({ id, ...lib }));

module.exports = { get, all, libraryKeyFor, FILES, LIBRARY_KEYS, LANGUAGES, LIBRARY_VERSION };
