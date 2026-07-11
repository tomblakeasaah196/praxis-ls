/** Treasury account (MOD-09) — pure rules. A treasury account maps to a class-5
 *  GL cash account (bank 52x, cash 57x, MoMo 538x). */
"use strict";
const { AppError } = require("../../../utils/errors");

/** The mapped GL account must be a class-5 (treasury) account. */
function assertCashAccount(coaCode) {
  const c = String(coaCode || "").trim();
  if (!c) throw new AppError("NO_COA", "coa_code is required", 422);
  if (c[0] !== "5") throw new AppError("NOT_CASH_ACCOUNT", "coa_code " + c + " must be a class-5 treasury account", 422);
  return true;
}

/** MoMo accounts must name a network; a fee account (if set) must be class-6. */
function assertMomo({ kind, momoNetwork, momoFeeAccount }) {
  if (kind !== "MOMO") return true;
  if (!momoNetwork) throw new AppError("NO_NETWORK", "a MoMo treasury account needs momo_network (MTN/ORANGE)", 422);
  if (momoFeeAccount && String(momoFeeAccount)[0] !== "6") throw new AppError("BAD_FEE_ACCOUNT", "momo_fee_account should be a class-6 charge account", 422);
  return true;
}

module.exports = { assertCashAccount, assertMomo };
