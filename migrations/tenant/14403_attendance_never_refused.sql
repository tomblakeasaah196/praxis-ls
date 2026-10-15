-- ===========================================================================
-- TENANT DB — 14403 a punch is never refused
--
-- THE RULE THIS ENCODES. Nothing stops somebody clocking in. Until now two
-- tenant settings could: `hr.geofence = block` refused an off-site punch and
-- `hr.device_policy = block` refused an unapproved device, both with a 422. A
-- refused punch is not a stricter record, it is NO record: the person is at
-- work, the manager has nothing to look at, and payroll treats them as absent.
--
-- So `block` now means "accept, and hold for a manager". The punch is written
-- with `review_status = 'PENDING'` and the reasons it was held, and the nightly
-- reconciler does not count it as presence until somebody approves it. That is
-- what the strict tenant actually wanted (an off-site punch does not get paid
-- on its own say-so) without losing the punch it used to throw away.
--
-- THE LOCATION COLUMNS. A punch with no location used to say only that. It
-- now says WHY (`location_error`, what the phone reported), and a reading that
-- arrives after the tap is attached rather than lost (`fix_at`). A late
-- reading is labelled `location_source = 'late'` and is shown, never used to
-- judge on-site: a fix taken two minutes after the tap can be two minutes'
-- drive from where the tap happened.
--
-- THE OFFLINE COLUMNS. A punch made with no network is held on the phone and
-- sent on reconnect. `clock_in_at` keeps the moment of the TAP, which is what
-- the person is paid on; `received_at` is when the server heard about it, and
-- `punched_offline` says the two differ on purpose. `client_ref` is the phone's
-- own id for the punch, which is how a late reading finds a punch whose
-- server id it never learned.
-- ===========================================================================

-- ── WHY THERE IS NOT ONE CHECK OR FOREIGN KEY IN THIS FILE ───────────────
--
-- Both tables already exist, and above 13791 an existing table may only gain
-- PLAIN columns: a CHECK or FK added here would abort provisioning a fresh
-- tenant in the sandbox pass (tests/unit/migration-constraint-ordering.test.js
-- has the whole story). So every rule a CHECK would have stated lives in code,
-- named next to each column below, and `attendance.review.js` holds the lists
-- the validator and the service both read.

-- Values: any uuid. Unique per employee (index below). Set by the phone.
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS client_ref       uuid;
-- Values: denied | os_off | unavailable | timeout | unsupported
-- (review.LOCATION_ERRORS, enforced by attendance.validator clockIn and again
-- in attendance.service clockIn, which drops anything else to NULL).
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS location_error   text;
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS fix_at           timestamptz;
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS received_at      timestamptz;
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS punched_offline  boolean NOT NULL DEFAULT false;
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS out_punched_offline boolean NOT NULL DEFAULT false;
-- Values: NULL | PENDING | APPROVED | REJECTED. Written only by the service
-- (reviewFor / mergeReview / reviewPunch); no request body reaches it.
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS review_status    text;
-- Elements: off_site | device | offline_time (review.REVIEW_REASONS). Written
-- only by the service.
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS review_reasons   text[] NOT NULL DEFAULT '{}';
-- An app_user id, resolved through `resolveActorId` exactly as the `_by`
-- columns with a foreign key are, so a sandbox decision never stores a live id.
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS reviewed_by      uuid;
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS reviewed_at      timestamptz;
ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS review_note      text;

-- `location_source` gains 'late'. The 10740 CHECK only allowed gps | none, so it
-- is DROPPED and not replaced: the column is written only by the service
-- (`locationSourceFromFix`, and `attachFix` for 'late'), never from a body.
-- Dropping is safe across both passes: live no longer has the constraint for
-- 13791 to mirror, and sandbox drops its own copy when it reaches this file.
ALTER TABLE attendance_log DROP CONSTRAINT IF EXISTS attendance_log_location_source_check;

-- One phone, one punch per reference. Partial: every row written before this
-- migration, and every row an admin types in, has no reference. An index, not
-- a constraint, so 13791 has nothing to mirror.
CREATE UNIQUE INDEX IF NOT EXISTS ux_attendance_log_client_ref
  ON attendance_log(employee_id, client_ref) WHERE client_ref IS NOT NULL;

-- The manager's queue. A handful of rows against a table read by date.
CREATE INDEX IF NOT EXISTS ix_attendance_log_review_pending
  ON attendance_log(clock_in_at) WHERE review_status = 'PENDING';

COMMENT ON COLUMN attendance_log.location_source IS
  'What the client presented at punch time: gps = coordinates at the tap or within the judging window; late = a reading attached after the window (shown, never used to judge on-site); none = no location. NULL on rows taken before 10740. Values enforced by the service since 14403.';
COMMENT ON COLUMN attendance_log.location_error IS
  'Why the punch had no location at the tap, as the phone reported it: denied (site permission blocked), os_off (the device or the browser app has location switched off), unavailable (no position could be worked out), timeout (no reading in time), unsupported (no geolocation at all). NULL when a location arrived, and on rows before 14403.';
COMMENT ON COLUMN attendance_log.fix_at IS
  'When a reading that arrived AFTER the punch was attached. NULL when the location came with the punch.';
COMMENT ON COLUMN attendance_log.review_status IS
  'NULL = nothing to review. PENDING = held under a block policy (or an offline time that does not add up) and not counted as presence by the reconciler until a manager decides. APPROVED counts; REJECTED does not.';
COMMENT ON COLUMN attendance_log.review_reasons IS
  'Why the punch was held or flagged: off_site, device (unapproved or revoked), offline_time (an offline punch whose claimed time does not add up).';
COMMENT ON COLUMN attendance_log.received_at IS
  'When the server received the punch. Equal to clock_in_at for a live punch; later for one held on the phone while offline.';

-- What each device last said about location permission, so HR can see which
-- phones will punch without one. Values: granted | denied | prompt |
-- unsupported (attendance.validator deviceInfo).
ALTER TABLE hr_device ADD COLUMN IF NOT EXISTS location_permission text;
ALTER TABLE hr_device ADD COLUMN IF NOT EXISTS location_checked_at timestamptz;

-- DOWN
-- DROP INDEX IF EXISTS ix_attendance_log_review_pending;
-- DROP INDEX IF EXISTS ux_attendance_log_client_ref;
-- ALTER TABLE hr_device DROP COLUMN IF EXISTS location_checked_at;
-- ALTER TABLE hr_device DROP COLUMN IF EXISTS location_permission;
-- UPDATE attendance_log SET location_source = 'none' WHERE location_source = 'late';
-- (10740's CHECK is not restored: re-adding a constraint to an existing table
--  above 13791 is the hazard this file avoids. The service enforces the values.)
-- ALTER TABLE attendance_log DROP COLUMN IF EXISTS review_note;
-- ALTER TABLE attendance_log DROP COLUMN IF EXISTS reviewed_at;
-- ALTER TABLE attendance_log DROP COLUMN IF EXISTS reviewed_by;
-- ALTER TABLE attendance_log DROP COLUMN IF EXISTS review_reasons;
-- ALTER TABLE attendance_log DROP COLUMN IF EXISTS review_status;
-- ALTER TABLE attendance_log DROP COLUMN IF EXISTS out_punched_offline;
-- ALTER TABLE attendance_log DROP COLUMN IF EXISTS punched_offline;
-- ALTER TABLE attendance_log DROP COLUMN IF EXISTS received_at;
-- ALTER TABLE attendance_log DROP COLUMN IF EXISTS fix_at;
-- ALTER TABLE attendance_log DROP COLUMN IF EXISTS location_error;
-- ALTER TABLE attendance_log DROP COLUMN IF EXISTS client_ref;
