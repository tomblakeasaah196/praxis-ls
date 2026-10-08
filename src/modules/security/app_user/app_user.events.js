"use strict";
module.exports = {
  MODULE: "MOD-67",
  // Generic CRUD events
  CREATED: "app_user.created",
  UPDATED: "app_user.updated",
  ARCHIVED: "app_user.archived",
  // Auth events (formerly security/auth/auth.events.js)
  LOGIN_SUCCEEDED: "auth.login_succeeded",
  LOGIN_FAILED: "auth.login_failed",
  LOGGED_OUT: "auth.logged_out",
  TOKEN_REFRESHED: "auth.token_refreshed",
  TWOFA_ENABLED: "auth.2fa_enabled",
  TWOFA_DISABLED: "auth.2fa_disabled",
  // One of the ten single-use codes stood in for the authenticator (14401).
  // Its own key, not a LOGIN_SUCCEEDED with a different method: "somebody got
  // in without the phone" is the question a human asks months later.
  TWOFA_RECOVERY_USED: "auth.2fa_recovery_code_used",
  // How often the authenticator asks, changed by its owner.
  TWOFA_FREQUENCY_CHANGED: "auth.2fa_frequency_changed",
  // An administrator cleared somebody else's authenticator (lost phone, no
  // recovery code left). Distinct from the owner turning it off themselves.
  TWOFA_RESET: "auth.2fa_reset",
  PASSWORD_RESET_REQUESTED: "auth.password_reset_requested",
  PASSWORD_RESET_COMPLETED: "auth.password_reset_completed",
  // Signed-in change (current password → new one). Distinct from a RESET so the
  // audit trail can tell "the account holder changed it, knowing the old one"
  // from "someone completed a mailed recovery link".
  PASSWORD_CHANGED: "auth.password_changed",
};
