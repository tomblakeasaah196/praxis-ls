"use strict";

/**
 * user_known_device (14230) — the devices the server remembers for the sign-in
 * greeting. See known-device.js for what this is and, more importantly, what it
 * is not (a credential).
 */

/** How many passkeys one (device, person) row lists — one per device is the
 *  norm; room for a replaced one and a synced one. */
const MAX_IDS = 10;

/**
 * Record a sign-in from this device: bump `last_seen_at`, and when a passkey
 * was proven here, add its id (once, keeping the newest MAX_IDS).
 */
async function upsert(client, { deviceHash, userId, label = null, credentialId = null }) {
  await client.query(
    `INSERT INTO user_known_device (device_hash, user_id, label, passkey_ids)
     VALUES ($1, $2, $3, CASE WHEN $4::text IS NULL THEN '{}'::text[] ELSE ARRAY[$4::text] END)
     ON CONFLICT (device_hash, user_id) DO UPDATE SET
       last_seen_at = now(),
       label = COALESCE(EXCLUDED.label, user_known_device.label),
       passkey_ids = CASE
         WHEN $4::text IS NULL OR $4::text = ANY(user_known_device.passkey_ids) THEN user_known_device.passkey_ids
         ELSE (user_known_device.passkey_ids || $4::text)[GREATEST(1, cardinality(user_known_device.passkey_ids) + 2 - $5::int):]
       END`,
    [deviceHash, userId, label, credentialId, MAX_IDS],
  );
}

/**
 * The person this device last signed in, with the passkeys proven HERE that
 * their account STILL holds (the join is what makes a removed passkey vanish
 * from every device at once), and whether they have a Quick PIN. Active
 * accounts only.
 */
async function latestAccount(client, deviceHash) {
  const { rows } = await client.query(
    `SELECT u.email, u.full_name, u.avatar_ref,
            ARRAY(SELECT c.credential_id FROM webauthn_credential c
                   WHERE c.user_id = d.user_id AND c.credential_id = ANY(d.passkey_ids)
                   ORDER BY c.last_used_at DESC NULLS LAST) AS passkeys,
            EXISTS (SELECT 1 FROM user_quick_pin p WHERE p.user_id = d.user_id) AS has_quick_pin
       FROM user_known_device d
       JOIN app_user u ON u.user_id = d.user_id
      WHERE d.device_hash = $1 AND u.status = 'ACTIVE'
      ORDER BY d.last_seen_at DESC
      LIMIT 1`,
    [deviceHash],
  );
  return rows[0] || null;
}

/** A passkey the person removed stops being listed anywhere (the join already
 *  hides it; this keeps the rows honest too). */
async function forgetPasskey(client, { userId, credentialId }) {
  await client.query(
    "UPDATE user_known_device SET passkey_ids = array_remove(passkey_ids, $2) WHERE user_id = $1 AND $2 = ANY(passkey_ids)",
    [userId, credentialId],
  );
}

/* ── The authenticator, between asks (14401) ───────────────────────────────
 *
 * `mfa_trusted_until` records that THIS (device, person) already proved a TOTP
 * code, so a 'daily' or 'monthly' account is not asked again until it lapses.
 * Read known-device.js's safety note first: the trust is consumed only after
 * the password or the Quick PIN has already passed, so the cookie alone still
 * unlocks nothing.
 */

/** Stamp the trust. No-op for a device this person has never signed in on —
 *  `remember()` creates that row, and it runs on the same request. */
async function trustForMfa(client, { deviceHash, userId, until }) {
  await client.query(
    `UPDATE user_known_device SET mfa_trusted_until = $3
      WHERE device_hash = $1 AND user_id = $2`,
    [deviceHash, userId, until],
  );
}

/**
 * True while this device may skip the code for the person signing in as
 * `email`. `now()` is the DATABASE's clock on purpose: a trust window must not
 * be extendable by a machine with a wrong clock.
 *
 * Keyed on the email because the caller is the LOGIN route, which has no user
 * id yet — and must not acquire one before the password is checked. The join
 * answers one question, "is this exact pairing trusted", and answers it `false`
 * for an address that does not exist, so it tells a caller nothing it could
 * not already infer. `email` is citext, so the comparison is case-insensitive
 * in the column's own collation rather than by lowercasing here.
 */
async function mfaTrustedForEmail(client, { deviceHash, email }) {
  const { rows } = await client.query(
    `SELECT 1
       FROM user_known_device d
       JOIN app_user u ON u.user_id = d.user_id
      WHERE d.device_hash = $1
        AND u.email = $2
        AND u.status = 'ACTIVE'
        AND d.mfa_trusted_until IS NOT NULL
        AND d.mfa_trusted_until > now()`,
    [deviceHash, email],
  );
  return rows.length > 0;
}

/** Forget every device's trust for this person — on disable, on an
 *  administrator's reset, and whenever the frequency changes (the person is
 *  tightening it, and a window opened under the old setting must not outlive
 *  the decision to change it). */
async function revokeMfaTrust(client, userId) {
  await client.query(
    `UPDATE user_known_device SET mfa_trusted_until = NULL
      WHERE user_id = $1 AND mfa_trusted_until IS NOT NULL`,
    [userId],
  );
}

module.exports = {
  upsert,
  latestAccount,
  forgetPasskey,
  trustForMfa,
  mfaTrustedForEmail,
  revokeMfaTrust,
  MAX_IDS,
};
