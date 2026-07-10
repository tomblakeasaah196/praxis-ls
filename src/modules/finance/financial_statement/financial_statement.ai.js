"use strict";
const service = require("./financial_statement.service");
module.exports = {
  entity: "financial_statement",
  module_key: "MOD-59",
  screens: [],
  reads: [
    { key: "get_trial_balance", service: service.trialBalance, describe: "Trial balance from the validated GL (per-account Σdebit/Σcredit)." },
    { key: "get_income_statement", service: service.compteDeResultat, describe: "Compte de résultat: charges (6), produits (7), result. KB §12." },
    { key: "get_balance_sheet", service: service.bilan, describe: "Bilan: active vs passif (classes 1-5) incl. period result. KB §12." },
  ],
  writes: [],
};
