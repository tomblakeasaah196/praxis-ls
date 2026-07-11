/**
 * Régie d'avance decision logic (KB §6.8) — pure, no DB.
 * An advance sits validly in 581. It is NEVER auto-allocated to 4731. Past its
 * policy window, if still unjustified, the OPEN balance reclassifies 581 -> 4211
 * (a receivable from the holder). This module decides "is it aged?" and "how much
 * is open?"; the posting goes through the ledger engine.
 */
"use strict";

const num = (v) => Number(v || 0);

/** Open (unjustified, unreturned) balance still sitting in 581. */
function openBalance(advance) {
  return Math.round((num(advance.amount) - num(advance.justified_amount) - num(advance.returned_amount)) * 100) / 100;
}

function daysBetween(fromISO, toISO) {
  const a = new Date(fromISO + "T00:00:00Z").getTime();
  const b = new Date(toISO + "T00:00:00Z").getTime();
  return Math.floor((b - a) / 86400000);
}

/** Aged when past the policy window, still open, and not already closed/aged/queried. */
function isAged(advance, todayISO) {
  const stillOpen = openBalance(advance) > 0;
  const agingState = advance.state === "ISSUED" || advance.state === "PARTIALLY_JUSTIFIED";
  const pastWindow = daysBetween(advance.issued_on, todayISO) > num(advance.policy_window_days);
  return stillOpen && agingState && pastWindow;
}

module.exports = { openBalance, isAged, daysBetween };
