"use strict";
/**
 * Which categories EMAIL by default — the opt-out exception to the opt-in rule.
 *
 * ── WHY THIS IS A RULE AND NOT A PREFERENCE DEFAULT SCATTERED IN TWO PLACES ──
 *
 * The server needs it to decide the default it hands to the EMAIL preference
 * read (a missing `notification_preference` row means "the default", so the
 * default has to come from somewhere). The client needs it to draw the right
 * checkbox in the Preferences matrix for a user who has never set one. Same
 * question, two callers, one answer — or the matrix shows Email unchecked for
 * a category whose notifications arrive by email anyway, which is a switch
 * nobody believes afterwards.
 *
 * This is the same shape as `notification-interrupt.js`, for the same reason.
 *
 * ── THE DEFAULT, AND WHY IT IS NOT "EVERYTHING" ─────────────────────────────
 *
 * Every other category's email is OPT-IN: an inbox nobody asked to be written
 * to is spam with a product logo on it, so absence of a preference row means
 * no email. `tasks` is the one exception, and it is an exception because the
 * audience is not "everybody" — it is the people already connected to a task
 * (its assignee, its author, its watchers), a set that only grows by explicit
 * acts, and the module's whole promise is that nobody on a task forgets it.
 * A ping, an assignment or a reminder that lands only in a bell somebody does
 * not keep open is a deadline missed, which is precisely the failure the ping
 * exists to prevent.
 *
 * Opt-out, not unconditional: a user who unticks Email for Tasks in
 * Preferences writes the row, the row beats the default, and nothing routes
 * around that — the same precedence every other preference follows.
 */
/*
 * `clients` is the second exception (tenant review of 29 Sep 2026, owner
 * decisions D3 and D7), for the same reason as tasks: its audience is not
 * "everybody" but the people named on a client — its account manager, the
 * CEO-role users and whoever was picked to "Also notify" — a set that only
 * grows by explicit acts. A client's message, document, payment claim or quote
 * request that lands only in a bell is a client waiting, which is precisely
 * what the meeting found: nobody had ticked Email, so nothing arrived.
 * Opt-out per person, exactly like tasks.
 */
const EMAIL_DEFAULT_CATEGORIES = new Set(["tasks", "clients"]);

/**
 * Does this category email by default, absent any preference from the user?
 *
 * `category` is its key from `shared/notifications/categories`.
 */
function emailDefaultFor(category) {
  return EMAIL_DEFAULT_CATEGORIES.has(String(category || "").toLowerCase());
}

exports.EMAIL_DEFAULT_CATEGORIES = EMAIL_DEFAULT_CATEGORIES;
exports.emailDefaultFor = emailDefaultFor;
