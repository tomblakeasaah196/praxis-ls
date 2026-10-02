-- ============================================================================
-- TENANT DB — 14342 Dictionary siblings are linked, not just named alike.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- Meeting 6 (29 Sep 2026), register 3.2 / owner decision F2. Seed 9082 gave
-- each service one row per FULFILMENT MODE — "Gate-Pass Fee" (our own cost,
-- EXPENSE) and "Gate-Pass Fee — Client Account" (débours, re-billed at cost) —
-- because the mode decides the account, and one row cannot carry two accounts.
-- But nothing linked the rows: every picker listed both, nothing said which to
-- choose, and picking the own-cost row on a client-billed costing posts to the
-- wrong account (Tom's own words in the meeting).
--
-- From this PR a picker shows the service ONCE and asks one plain question —
-- "Billed to the client at cost" or "Our own cost" — and the answer chooses the
-- row. That needs the rows of one service to know each other: `sibling_group`.
--
-- ── SHAPE ──────────────────────────────────────────────────────────────────
--
-- Plain columns on an existing table (the 13791 rule — no FK, no CHECK added to
-- a pre-existing table above 13791):
--   sibling_group        an opaque uuid shared by the rows of one service. Not
--                        a code: codes move when a direction changes (meeting
--                        5), and a key that moves breaks the link it is for.
--   sibling_confirmed_at a person confirmed this row's grouping (or that it
--   sibling_confirmed_by  stands alone) from the Financial Dictionary settings.
--
-- Codes, posting rules and the history of existing lines do not change.
--
-- ── THE BACKFILL ───────────────────────────────────────────────────────────
--
-- 9082 named its siblings "<base> — Client Account" / "— Pour Compte Client",
-- "— Own Cost" / "— Charge Propre", "— Deposit" / "— Dépôt", and left an
-- unqualified base row for the mode a line already had. Its `parent_code` lived
-- in a temp table and was never stored, so the link is re-derived here from the
-- names, in BOTH languages (a tenant who renamed the English label still pairs
-- through the French, and the reverse):
--
--   1. rows whose base label (suffix removed, case-folded) is equal, in either
--      language, and where at least one row carries a sibling suffix, form a
--      group — so two unrelated lines that merely share a name never do;
--   2. a group never holds two rows of the same direction; a row that would
--      duplicate a mode is left out and listed instead.
--
-- Whatever this cannot pair — a row carrying a sibling suffix with no partner,
-- or a duplicate mode — is listed in Financial Dictionary settings ("Lines to
-- pair") for a person to link or confirm. Nothing is guessed.
--
-- Idempotent: only rows with sibling_group IS NULL are written, so a second
-- run changes nothing, and a person's later link is never overwritten. A row a
-- person CONFIRMED stands alone (sibling_confirmed_at set, no group) is never
-- grouped by this, on any run.
--
-- ── WHY A FUNCTION AND AN INSERT TRIGGER, NOT A ONE-OFF BLOCK ─────────────
--
-- A tenant provisioned from scratch runs EVERY migration before any seed
-- (src/services/platform/migrator.js: tenantSchema, then tenantSeeds). On such
-- a tenant this file runs while dictionary_item is still empty, and seed 9082
-- inserts the Gate-Pass Fee rows afterwards — so a one-off backfill here would
-- leave every new tenant's siblings unpaired. CI's migrations job is exactly
-- that fresh tenant, and caught it.
--
-- So the pairing is `dictionary_sibling_pair()`, run once below for the rows an
-- existing tenant already has, and again by a statement-level AFTER INSERT
-- trigger whenever rows are added — the seed's inserts on a new tenant, an
-- import, a line created by hand. It is incremental: a new row joins the
-- group its base label already has; it never re-forms or splits a group.
-- (Seeds in this PR's range, 9150-9154, are PLATFORM seeds — `^91` — so a
-- tenant seed could not run it after 9082 either.)
-- ============================================================================

ALTER TABLE dictionary_item ADD COLUMN IF NOT EXISTS sibling_group uuid;
ALTER TABLE dictionary_item ADD COLUMN IF NOT EXISTS sibling_confirmed_at timestamptz;
ALTER TABLE dictionary_item ADD COLUMN IF NOT EXISTS sibling_confirmed_by uuid;

COMMENT ON COLUMN dictionary_item.sibling_group IS
  'Rows of one service in different fulfilment modes (débours / own cost / deposit / own service) share this opaque id. Pickers show the group once and ask which mode. 14342.';
COMMENT ON COLUMN dictionary_item.sibling_confirmed_at IS
  'A person confirmed this row''s sibling link (or that it stands alone) — it leaves the "Lines to pair" list. 14342.';
COMMENT ON COLUMN dictionary_item.sibling_confirmed_by IS
  'Who confirmed it. Intent: REFERENCES app_user(user_id) — plain column per the 13791 rule.';

CREATE INDEX IF NOT EXISTS ix_dictionary_item_sibling_group
  ON dictionary_item (sibling_group) WHERE sibling_group IS NOT NULL;

CREATE OR REPLACE FUNCTION dictionary_sibling_pair() RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE
  -- The suffixes 9082 wrote, either dash, either language, any case (90995
  -- title-cased every label, so "— Pour Compte Client" is the stored form).
  -- No leading \s*: the space before the dash is removed by trim() below.
  sfx constant text := '[—–-]\s*(client account|own cost|deposit|pour compte client|charge propre|d[ée]p[ôo]t)\s*$';
  g   record;
  v_grp uuid;
  n_grouped int := 0;
BEGIN
  -- Called more than once in one transaction (one trigger firing per INSERT
  -- statement of a seed), so the work table is rebuilt each time.
  -- DESTRUCTIVE: drops only this function's own session-temporary work table (pg_temp._sib) — no tenant data.
  DROP TABLE IF EXISTS pg_temp._sib;
  CREATE TEMP TABLE _sib ON COMMIT DROP AS
  SELECT dictionary_item_id,
         direction,
         lower(trim(regexp_replace(coalesce(label_en, ''), sfx, '', 'i'))) AS base_en,
         lower(trim(regexp_replace(coalesce(label_fr, ''), sfx, '', 'i'))) AS base_fr,
         (coalesce(label_en, '') ~* sfx OR coalesce(label_fr, '') ~* sfx)    AS has_suffix,
         sibling_group AS grp,
         (sibling_group IS NULL) AS free
    FROM dictionary_item
   -- A person confirmed this row stands alone: it is never grouped by name.
   WHERE NOT (sibling_group IS NULL AND sibling_confirmed_at IS NOT NULL);

  -- Pass 1 — English base, then pass 2 — French base. Only bases that still
  -- have an ungrouped row are visited; a row joins the group its base already
  -- has (an existing, stored group first), else a new one.
  FOR g IN
    SELECT base_en AS base, 'en' AS lang FROM _sib WHERE base_en <> ''
     GROUP BY base_en HAVING count(*) > 1 AND bool_or(has_suffix) AND bool_or(free)
    UNION ALL
    SELECT base_fr, 'fr' FROM _sib WHERE base_fr <> ''
     GROUP BY base_fr HAVING count(*) > 1 AND bool_or(has_suffix) AND bool_or(free)
  LOOP
    SELECT s.grp INTO v_grp
      FROM _sib s
     WHERE (CASE g.lang WHEN 'en' THEN s.base_en ELSE s.base_fr END) = g.base
       AND s.grp IS NOT NULL
     ORDER BY s.free  -- false (a stored group) before true (one formed this run)
     LIMIT 1;
    IF v_grp IS NULL THEN v_grp := gen_random_uuid(); END IF;

    -- One row per direction: the first free row of each mode joins, a
    -- duplicate of a mode the group already has does not.
    UPDATE _sib s
       SET grp = v_grp
     WHERE s.free AND s.grp IS NULL
       AND (CASE g.lang WHEN 'en' THEN s.base_en ELSE s.base_fr END) = g.base
       AND NOT EXISTS (SELECT 1 FROM _sib o WHERE o.grp = v_grp AND o.direction = s.direction)
       AND s.dictionary_item_id = (
             SELECT min(x.dictionary_item_id::text)::uuid FROM _sib x
              WHERE (CASE g.lang WHEN 'en' THEN x.base_en ELSE x.base_fr END) = g.base
                AND x.direction = s.direction AND x.free AND x.grp IS NULL);
  END LOOP;

  -- A "group" of one is no group (only rows this run grouped are undone).
  UPDATE _sib SET grp = NULL
   WHERE free
     AND grp IN (SELECT grp FROM _sib WHERE grp IS NOT NULL GROUP BY grp HAVING count(*) < 2);

  UPDATE dictionary_item di
     SET sibling_group = s.grp
    FROM _sib s
   WHERE s.dictionary_item_id = di.dictionary_item_id
     AND s.free AND s.grp IS NOT NULL
     AND di.sibling_group IS NULL;
  GET DIAGNOSTICS n_grouped = ROW_COUNT;
  RETURN n_grouped;
END
$fn$;

COMMENT ON FUNCTION dictionary_sibling_pair() IS
  'Links ungrouped dictionary lines to the other fulfilment modes of the same service by the 9082 label convention ("<base> — Client Account" / "— Own Cost" / "— Deposit", FR too). Incremental, idempotent; never groups a row a person confirmed stands alone. 14342.';

-- Existing rows, now.
DO $$
DECLARE n int;
BEGIN
  n := dictionary_sibling_pair();
  RAISE NOTICE '14342 dictionary siblings (%): % rows linked into groups; % rows carry a sibling suffix but could not be paired',
    current_schema(), n,
    (SELECT count(*) FROM dictionary_item
      WHERE sibling_group IS NULL AND sibling_confirmed_at IS NULL
        AND (coalesce(label_en, '') ~* '[—–-]\s*(client account|own cost|deposit|pour compte client|charge propre|d[ée]p[ôo]t)\s*$'
          OR coalesce(label_fr, '') ~* '[—–-]\s*(client account|own cost|deposit|pour compte client|charge propre|d[ée]p[ôo]t)\s*$'));
END $$;

-- Rows added later — above all seed 9082's, on a tenant provisioned after
-- this file (see the header). Statement-level: once per INSERT statement.
CREATE OR REPLACE FUNCTION trg_dictionary_sibling_pair() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM dictionary_sibling_pair();
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE TRIGGER trg_dictionary_sibling_pair
  AFTER INSERT ON dictionary_item
  FOR EACH STATEMENT EXECUTE FUNCTION trg_dictionary_sibling_pair();

-- ============================================================================
-- VERIFY
--   SELECT sibling_group, array_agg(code || ' ' || direction || ' ' || label_en ORDER BY direction)
--     FROM dictionary_item WHERE sibling_group IS NOT NULL GROUP BY 1;
--
-- DOWN
--   -- DROP TRIGGER IF EXISTS trg_dictionary_sibling_pair ON dictionary_item;
--   -- DROP FUNCTION IF EXISTS trg_dictionary_sibling_pair();
--   -- DROP FUNCTION IF EXISTS dictionary_sibling_pair();
--   -- DROP INDEX IF EXISTS ix_dictionary_item_sibling_group;
--   -- ALTER TABLE dictionary_item DROP COLUMN IF EXISTS sibling_confirmed_by;
--   -- ALTER TABLE dictionary_item DROP COLUMN IF EXISTS sibling_confirmed_at;
--   -- ALTER TABLE dictionary_item DROP COLUMN IF EXISTS sibling_group;
-- ============================================================================
