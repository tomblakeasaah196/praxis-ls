/**
 * A user who is no longer ACTIVE stops receiving pushes (calls audit C6).
 *
 * Their registered phones and laptops kept every push subscription, so a
 * suspended employee's device still showed "Incoming call from X" and every
 * chat notification. Dialing now requires an ACTIVE callee; this removes the
 * devices themselves, for calls and for everything else that pushes.
 *
 * Same shape as user-deactivated-offboard-mail.js: `app_user.updated` fires
 * on every change, so the status is re-read and an ACTIVE user is a no-op.
 * Re-running deletes nothing, which is the idempotent no-op the registry
 * requires. A user reactivated later subscribes again from their device.
 */
"use strict";

function userIdFrom(entityRef) {
  if (typeof entityRef !== "string") return null;
  return entityRef.startsWith("app_user:") ? entityRef.slice("app_user:".length) : null;
}

module.exports = {
  eventKey: "app_user.updated",
  handlerKey: "app_user.updated:drop-push-subscriptions",
  feature: null,
  async run(client, event) {
    const userId = userIdFrom(event.entity_ref);
    if (!userId) return { skipped: "no app_user ref" };
    const { rows } = await client.query("SELECT status FROM app_user WHERE user_id = $1", [userId]);
    if (!rows[0]) return { skipped: "user not found" };
    if (rows[0].status === "ACTIVE") return { skipped: "still active" };
    const out = await client.query("DELETE FROM push_subscription WHERE user_id = $1", [userId]);
    return { deleted: out.rowCount || 0 };
  },
};
