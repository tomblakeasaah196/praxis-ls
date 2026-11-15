"use strict";
/**
 * Zod 3's default error wording, kept on Zod 4.
 *
 * WHY THIS EXISTS. Zod 4 rewrote every default message: a missing field went from "Required" to
 * "Invalid input: expected string, received undefined", a short string from "String must contain at
 * least 3 character(s)" to "Too small: expected string to have >=3 characters". Those strings are
 * not internal. The API returns them as `error.fields` on every 422, the client's forms show them
 * under the field (zodResolver), and the AI assistant reads them back to a person. A major version
 * bump that rewords every validation message is a product change nobody asked for, and "Required"
 * under an empty box reads better than the new sentence in any case.
 *
 * So this installs ONE global `customError` that reproduces the Zod 3 wording for every issue
 * Zod would otherwise word itself. It does not touch a message a schema sets (`.min(1, "Name is
 * required")`): Zod consults the schema's own message first and this map only when there is none.
 *
 * It is installed on the Zod instance the schemas use. The API, the client's bundle and every
 * shared schema resolve the same `zod` package (`npm run check:shared` pins "one Zod instance"), so
 * one call covers all of them; `index.js` makes it on load and `src/config/env.js` does too, so a
 * process that never imports a shared schema still gets it.
 *
 * Wording source: Zod 3.25's `locales/en.ts`, reproduced here rather than imported (v3 ships under
 * `zod/v3`, but only `zod/v4/core` carries the security fixes, so nothing here may route through it).
 */

/** Zod 3's name for what a value is ("nan", "integer" never: that is for `.int()` only). */
function parsedType(v) {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "number") return Number.isNaN(v) ? "nan" : "number";
  if (typeof v === "string" || typeof v === "boolean" || typeof v === "bigint" || typeof v === "symbol" || typeof v === "function") return typeof v;
  if (Array.isArray(v)) return "array";
  if (v instanceof Date) return "date";
  if (v instanceof Map) return "map";
  if (v instanceof Set) return "set";
  if (typeof v.then === "function" && typeof v.catch === "function") return "promise";
  return "object";
}

/** `'a', 'b'` for strings, `1, 2` for numbers: Zod 3's `joinValues`. */
const join = (values, separator) => values.map((v) => (typeof v === "string" ? `'${v}'` : String(v))).join(separator);

const NAMES = { datetime: "datetime", guid: "uuid", uuid: "uuid", email: "email", url: "url", cuid: "cuid", cuid2: "cuid2", ulid: "ulid", ip: "ip", ipv4: "ip", ipv6: "ip", emoji: "emoji", base64: "base64", date: "date", time: "time", duration: "duration", nanoid: "nanoid", jwt: "jwt", cidrv4: "cidr", cidrv6: "cidr" };

/** @returns {string|undefined} the Zod 3 sentence, or undefined to let Zod 4 word the issue itself */
function wording(iss) {
  switch (iss.code) {
    case "invalid_type": {
      // `.int()` is its own check in Zod 4: "Expected integer, received float" in Zod 3.
      if (iss.expected === "int") return "Expected integer, received float";
      if (!("input" in iss) || iss.input === undefined) return "Required";
      return `Expected ${iss.expected}, received ${parsedType(iss.input)}`;
    }
    case "invalid_value": {
      const values = iss.values || [];
      // A literal has one value; an enum has several (Zod 3 worded them differently).
      if (values.length === 1) return `Invalid literal value, expected ${JSON.stringify(values[0])}`;
      return `Invalid enum value. Expected ${join(values, " | ")}, received '${iss.input}'`;
    }
    case "unrecognized_keys":
      return `Unrecognized key(s) in object: ${join(iss.keys || [], ", ")}`;
    case "invalid_union":
      return "Invalid input";
    case "invalid_format": {
      const f = iss.format;
      if (f === "includes") return `Invalid input: must include "${iss.includes}"`;
      if (f === "starts_with") return `Invalid input: must start with "${iss.prefix}"`;
      if (f === "ends_with") return `Invalid input: must end with "${iss.suffix}"`;
      if (f === "regex") return "Invalid";
      return `Invalid ${NAMES[f] || f}`;
    }
    case "too_small": {
      const n = iss.minimum;
      const how = iss.exact ? "exactly" : iss.inclusive ? "at least" : "more than";
      if (iss.origin === "array" || iss.origin === "set") return `Array must contain ${how} ${n} element(s)`;
      if (iss.origin === "string") return `String must contain ${iss.exact ? "exactly" : iss.inclusive ? "at least" : "over"} ${n} character(s)`;
      if (iss.origin === "number" || iss.origin === "int" || iss.origin === "bigint")
        return `Number must be ${iss.exact ? "exactly equal to " : iss.inclusive ? "greater than or equal to " : "greater than "}${n}`;
      if (iss.origin === "date") return `Date must be ${iss.exact ? "exactly equal to " : iss.inclusive ? "greater than or equal to " : "greater than "}${new Date(Number(n))}`;
      return "Invalid input";
    }
    case "too_big": {
      const n = iss.maximum;
      if (iss.origin === "array" || iss.origin === "set") return `Array must contain ${iss.exact ? "exactly" : iss.inclusive ? "at most" : "less than"} ${n} element(s)`;
      if (iss.origin === "string") return `String must contain ${iss.exact ? "exactly" : iss.inclusive ? "at most" : "under"} ${n} character(s)`;
      if (iss.origin === "number" || iss.origin === "int" || iss.origin === "bigint")
        return `Number must be ${iss.exact ? "exactly" : iss.inclusive ? "less than or equal to" : "less than"} ${n}`;
      if (iss.origin === "date") return `Date must be ${iss.exact ? "exactly" : iss.inclusive ? "smaller than or equal to" : "smaller than"} ${new Date(Number(n))}`;
      return "Invalid input";
    }
    case "not_multiple_of":
      return `Number must be a multiple of ${iss.divisor}`;
    case "custom":
      return "Invalid input";
    default:
      return undefined;
  }
}

/** Install the Zod 3 wording on `z` (the `zod` module). Idempotent. */
function install(z) {
  if (!z || typeof z.config !== "function") return;
  z.config({ customError: wording });
}

install(require("zod"));

module.exports = { install, wording, parsedType };
