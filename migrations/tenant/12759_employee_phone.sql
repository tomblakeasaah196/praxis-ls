-- ============================================================================
-- TENANT DB — staff phone numbers on the employee record.
--
-- THE GAP THIS CLOSES. `employee` has carried a name, a title, a department, a
-- salary and a bank block since 0300, and no phone number. HR could not record
-- one anywhere in the product. The signature engine worked around it by asking
-- each person to type their own into `user_signature_profile`, and
-- signature.resolve.js has carried this note since it shipped:
--
--     Desk and mobile phone are typed by the user because `employee` has no
--     phone columns today (Q14). That is a real master-data gap: HR cannot
--     record a staff phone number anywhere. If it is ever fixed, prefer
--     `employee.phone_*` and fall back to the profile — one change, nothing
--     else.
--
-- This is that fix. The number now belongs to the employee record, where HR
-- owns it and where payroll, contracts, the staff directory and the signature
-- can all read the same one.
--
-- THE PROFILE COLUMNS STAY, as the OVERRIDE. They are not redundant: a person
-- whose signature should show a direct line rather than the switchboard needs
-- somewhere to say so, and deleting the columns would silently rewrite the
-- signature of everyone who has already typed a number. Precedence is
-- profile → employee → blank, and it is implemented in exactly one place.
--
-- NO BACKFILL FROM THE PROFILE, deliberately. Copying a personal signature
-- preference into the HR master record would assert that HR had recorded and
-- verified a number nobody at HR has ever seen. The columns start empty and
-- fill up as HR fills them; every existing signature keeps rendering the
-- number it renders today, through the override.
-- ============================================================================

ALTER TABLE employee
  ADD COLUMN IF NOT EXISTS phone_desk   text,
  ADD COLUMN IF NOT EXISTS phone_mobile text;

COMMENT ON COLUMN employee.phone_desk IS
  'Desk/switchboard extension. HR-owned; user_signature_profile.phone_desk overrides it on signatures.';
COMMENT ON COLUMN employee.phone_mobile IS
  'Work mobile. HR-owned; user_signature_profile.phone_mobile overrides it on signatures.';

-- A stored number that changes what a signature renders is a signature input,
-- so an edit has to invalidate the cache the same way a job-title change does.
-- The orchestration handler already listens for employee.updated and deletes
-- the renders for the linked user; nothing new is needed there. Existing rows
-- are dropped once here because the phone precedence itself is new.
DELETE FROM signature_render;

-- DOWN
--   ALTER TABLE employee DROP COLUMN IF EXISTS phone_mobile;
--   ALTER TABLE employee DROP COLUMN IF EXISTS phone_desk;
--   DELETE FROM signature_render;
