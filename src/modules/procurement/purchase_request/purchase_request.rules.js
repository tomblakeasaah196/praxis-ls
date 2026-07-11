/** Purchase request (MOD-62) — pure lifecycle rules. DRAFT→SUBMITTED→APPROVED/REJECTED→ORDERED. */
"use strict";
const { AppError } = require("../../../utils/errors");

const NEXT = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["APPROVED", "REJECTED"],
  APPROVED: ["ORDERED"],
  REJECTED: [],
  ORDERED: [],
};

function assertTransition(from, to) {
  if (!NEXT[from] || !NEXT[from].includes(to)) {
    throw new AppError("BAD_STATE", `Cannot move purchase request ${from} -> ${to}`, 422);
  }
  return true;
}

module.exports = { NEXT, assertTransition };
