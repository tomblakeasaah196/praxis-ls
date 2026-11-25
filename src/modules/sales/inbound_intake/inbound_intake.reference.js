"use strict";

/**
 * A website message's reference: `MSG-` and eight random Crockford characters.
 *
 * It is what the visitor sees on screen when their message is sent, what their
 * acknowledgement email quotes, and what the inbox email carries in its
 * subject, so the desk and the visitor can name the same message on the phone.
 *
 * Random, from `crypto.randomBytes` through the operation-reference alphabet
 * (no I, L, O or U, so it survives being read aloud), never a count: a
 * sequential `MSG-0042` would tell anyone how many messages the company
 * receives. It opens nothing on its own; it is a name, not a key. 40 bits makes
 * a collision a once-in-a-trillion event, and the unique index is the final
 * authority anyway: the insert retries with a fresh value on a conflict.
 */

const { randomCore, withSavepoint } = require("../../../services/documents/operation-reference");

const isUniqueViolation = (err) => Boolean(err) && err.code === "23505";

const PREFIX = "MSG-";
const LENGTH = 8;
const MAX_ATTEMPTS = 4;

const newReference = () => PREFIX + randomCore(LENGTH);

/** Run `write(ref)` until it lands on a free reference. */
async function withReference(client, write) {
  let last = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const ref = newReference();
    try {
      return await withSavepoint(client, "praxis_msg_ref", () => write(ref));
    } catch (err) {
      const onRef = isUniqueViolation(err) && /public_ref/.test(`${err.constraint || ""} ${err.detail || ""}`);
      if (!onRef) throw err;
      last = err;
    }
  }
  throw last;
}

module.exports = { newReference, withReference, PREFIX, LENGTH };
