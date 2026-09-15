-- ============================================================================
-- TENANT DB — 13800 the Control Tower band, configured per role
--
-- Companion to doc/KPI_BAND_ENGINEERING_GUIDE.md (PR-1). Three arrays per role:
--
--   scope_ids    which catalog ids this role's PEOPLE may pick from at all.
--                NULL (the default, and the seed) means "everything the role
--                can read", recomputed at every read — so a tile that ships
--                in a later PR becomes pickable for the role the day it goes
--                live, with nobody editing rows. A non-null array narrows it,
--                which is how "warehouse operators never see margin" is said.
--   default_ids  the band a member sees before they touch a picker. ≤ 4 — the
--                fixed-four promise (D2), enforced in the DB, not just the app,
--                so a hand-edited row cannot put a tenant's home screen into a
--                fifth column.
--   locked_ids   slots every member must carry (an exec band that reads the
--                same everywhere). ⊆ default_ids: you may require what you
--                also offer, not more.
--
-- WHY A TABLE HERE AND THE USER'S OWN PICK IN user_preference (0507): the
-- role row is OTHER people's display, so it lives beside the role in the
-- identity tables (this schema, pinned live by iam_role's controller) and is
-- written behind MOD-67 edit; the personal row is one key in `shell`.
--
-- WHY ids ARE BARE TEXT AND NOT AN FK. The catalog is code (guide §4: a
-- tenant-editable catalog is a fake number waiting to be configured). The
-- CHECK constraints below can enforce arity and containment — shape, which
-- SQL is good at — and `role_kpi.service.js` validates membership against
-- the code catalog on every write. Ids that stop existing fail CLOSED: the
-- resolver filters before it paints, so an orphan id never renders and never
-- grants anything.
--
-- THE SEED IS DATA-DRIVEN ON PURPOSE. The curated band per role is intersected
-- with what that role can actually READ at apply time, so the seed cannot
-- create a default that the eligibility resolver would immediately hide —
-- a seeded lie on day one is worse than no seed. Roles with no curated row
-- (ACCOUNTANT, PROCUREMENT, SUPER_ADMIN, …) fall through to the system
-- default of today's four; HR and the sales tiles arrive with their domains
-- (PR-3/PR-4) and get curated rows there.
-- ============================================================================

CREATE TABLE IF NOT EXISTS role_kpi_config (
  role_id     uuid PRIMARY KEY REFERENCES role(role_id) ON DELETE CASCADE,
  scope_ids   text[],                       -- NULL = everything the role can read
  default_ids text[] NOT NULL DEFAULT '{}',
  locked_ids  text[] NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (scope_ids IS NULL OR default_ids <@ scope_ids),
  CHECK (locked_ids <@ default_ids),
  CHECK (array_length(default_ids, 1) IS NULL OR array_length(default_ids, 1) <= 4)
);

-- ── seed: curated defaults for the six job families with an obvious band ────

WITH tile(tile_id, module_key) AS (
  VALUES
    ('revenue',             'MOD-51'),
    ('receivables_overdue', 'MOD-52'),
    ('proformas_open',      'MOD-50'),
    ('journals_unposted',   'MOD-55'),
    ('files_active',        'MOD-29'),
    ('sla_on_time',         'MOD-29'),
    ('approvals_awaiting',  'MOD-00A'),
    ('compliance_open',     'MOD-65'),
    ('needs_location',      'MOD-00A'),
    ('fleet_utilisation',   'MOD-39')
),
curated(role_code, tile_ids) AS (
  VALUES
    ('FINANCE',    ARRAY['revenue','receivables_overdue','proformas_open','journals_unposted']),
    ('OPERATIONS', ARRAY['files_active','sla_on_time','needs_location','approvals_awaiting']),
    ('FLEET',      ARRAY['fleet_utilisation','files_active','needs_location','approvals_awaiting']),
    ('WAREHOUSE',  ARRAY['files_active','compliance_open','needs_location','approvals_awaiting']),
    ('SALES',      ARRAY['revenue','receivables_overdue','proformas_open','files_active']),
    ('CEO',        ARRAY['revenue','receivables_overdue','sla_on_time','files_active']),
    ('MANAGEMENT', ARRAY['revenue','receivables_overdue','sla_on_time','files_active'])
),
eligible AS (
  -- The read-time rule, evaluated at seed time: a tile is eligible for a role
  -- when the role can read the tile's module — or is the CEO, for whom
  -- requirePermission bypasses the matrix (rbac.js); an eligible-set that
  -- ignored that would hand the CEO a picker narrower than their own band.
  SELECT r.role_id, t.tile_id
  FROM role r
  JOIN tile t ON true
  WHERE r.is_system = true
    AND (
      r.code = 'CEO'
      OR EXISTS (
        SELECT 1 FROM permission p
        WHERE p.role_id = r.role_id AND p.module_key = t.module_key AND p.can_read = true
      )
    )
)
INSERT INTO role_kpi_config (role_id, scope_ids, default_ids, locked_ids)
SELECT
  r.role_id,
  NULL,                                   -- scope = dynamic (everything readable)
  (SELECT array_agg(x.tile_id ORDER BY ord)
     FROM unnest(c.tile_ids) WITH ORDINALITY AS q(tile_id, ord)
     JOIN eligible e ON e.tile_id = q.tile_id AND e.role_id = r.role_id),
  '{}'
FROM role r
JOIN curated c ON c.role_code = r.code
WHERE (SELECT count(*) FROM unnest(c.tile_ids) x
         WHERE x IN (SELECT tile_id FROM eligible e WHERE e.role_id = r.role_id)) > 0
ON CONFLICT (role_id) DO NOTHING;

-- DOWN
-- DROP TABLE IF EXISTS role_kpi_config;
