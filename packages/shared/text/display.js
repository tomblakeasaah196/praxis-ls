"use strict";
/**
 * How a company's legal name and a phone number READ on a page.
 *
 * Both fix what a visitor saw on the SmartLS staging site (25 Nov 2026): the
 * Impressum printed "SMART LOGISTICS AND SERVICES LTD SARL", and every page
 * printed "+237233420281". Storage does not change: the legal name and the
 * form stay two columns, and a phone stays E.164, because letterheads,
 * `tel:` links and the JSON-LD want exactly that.
 *
 * Imported by deep path from public-web (like title-case.js), so this module
 * requires nothing.
 */

/* ── the legal name ───────────────────────────────────────────────────────*/

// A form and the words that already say it in a name. "SMART ... LTD" is a
// SARL that wrote its form in English; appending "SARL" says it twice.
const FORM_WORDS = {
  SARL: ["SARL", "SARLU", "LTD", "LIMITED", "LLC"],
  SARLU: ["SARLU", "SARL", "LTD", "LIMITED", "LLC"],
  SA: ["SA", "PLC"],
  SAS: ["SAS", "SASU"],
  UG: ["UG", "HAFTUNGSBESCHRÄNKT"],
  GMBH: ["GMBH"],
  LTD: ["LTD", "LIMITED"],
  LIMITED: ["LTD", "LIMITED"],
  PLC: ["PLC"],
  LLC: ["LLC", "LTD", "LIMITED"],
};

// Upper case, dots dropped ("S.A.R.L." is "SARL"), every other run of
// non-letters a word break.
const words = (s) =>
  String(s || "")
    .toUpperCase()
    .replace(/\./g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** True when `name` already carries `form` or its equivalent. */
function nameCarriesForm(name, form) {
  const formWords = words(form);
  if (!formWords.length) return true;
  const inName = new Set(words(name));
  if (formWords.every((w) => inName.has(w))) return true;
  const said = FORM_WORDS[formWords[0]] || [];
  return said.some((w) => inName.has(w));
}

/** The legal name as a page prints it: the form is appended only when the
 *  name does not already say it. */
function legalNameWithForm(name, form) {
  if (!name) return name || "";
  return form && !nameCarriesForm(name, form) ? `${name} ${form}` : name;
}

/* ── the phone number ─────────────────────────────────────────────────────*/

// Country code, then the national number's groups, longest prefix first. Only
// the corridor and its usual counterparts; anything else keeps a space after
// its country code and is otherwise left as stored.
const PLANS = [
  ["237", [3, 2, 2, 2]], // Cameroon: +237 233 42 02 81
  ["235", [2, 2, 2, 2]], // Chad
  ["236", [2, 2, 2, 2]], // Central African Republic
  ["240", [3, 3, 3]], // Equatorial Guinea
  ["241", [2, 2, 2, 2]], // Gabon
  ["242", [2, 3, 2, 2]], // Congo
  ["243", [3, 3, 3]], // DR Congo
  ["234", [3, 3, 4]], // Nigeria
  ["33", [1, 2, 2, 2, 2]], // France
  ["32", [3, 2, 2, 2]], // Belgium
  ["31", [2, 3, 4]], // Netherlands
  ["44", [4, 6]], // United Kingdom
  ["1", [3, 3, 4]], // North America
];

const COUNTRY_CODES = ["971", "86", "91", "39", "34", "41", "43", "49", "7"];

function group(digits, sizes) {
  const out = [];
  let i = 0;
  for (const n of sizes) {
    if (i >= digits.length) break;
    out.push(digits.slice(i, i + n));
    i += n;
  }
  if (i < digits.length) out.push(digits.slice(i));
  return out.join(" ");
}

// Germany has area codes of two to five digits and no table here can know
// them all. The big cities' two-digit codes and the mobile prefixes are named;
// everything else reads as a three-digit code (Mannheim 621), which is right
// for most and still readable when it is not.
function germany(n) {
  if (/^1[5-7]/.test(n)) return group(n, [3, n.length - 3]);
  if (/^(30|40|69|89)/.test(n)) return group(n, [2, n.length - 2]);
  return group(n, [3, n.length - 3]);
}

/** A phone as a page prints it. Only a bare E.164 value ("+237233420281") is
 *  regrouped; anything typed with its own spacing is shown as typed. */
function phoneDisplay(phone) {
  if (!phone) return phone || "";
  const raw = String(phone).trim();
  if (!/^\+\d{6,15}$/.test(raw)) return raw;
  const digits = raw.slice(1);
  if (digits.startsWith("49")) return `+49 ${germany(digits.slice(2))}`;
  for (const [cc, sizes] of PLANS) {
    if (digits.startsWith(cc)) {
      const n = digits.slice(cc.length);
      const total = sizes.reduce((a, b) => a + b, 0);
      return `+${cc} ${n.length === total ? group(n, sizes) : group(n, [3, 3, 3, 3])}`;
    }
  }
  const cc = COUNTRY_CODES.find((c) => digits.startsWith(c));
  return cc ? `+${cc} ${digits.slice(cc.length)}` : raw;
}

/** The value for a `tel:` link: digits and the leading plus only. */
const phoneHref = (phone) => `tel:${String(phone || "").replace(/[^\d+]/g, "")}`;

// Named `exports.x =` assignments so a bundler's CommonJS lexer sees them.
exports.legalNameWithForm = legalNameWithForm;
exports.nameCarriesForm = nameCarriesForm;
exports.phoneDisplay = phoneDisplay;
exports.phoneHref = phoneHref;
