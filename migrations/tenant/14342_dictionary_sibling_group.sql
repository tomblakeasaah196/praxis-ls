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
-- Idempotent: only rows with sibling_group IS NULL are considered, so a second
-- run changes nothing, and a person's later link is never overwritten.
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

DO $$
DECLARE
  -- The suffixes 9082 wrote, either dash, either language, any case (90995
  -- title-cased every label, so "— Pour Compte Client" is the stored form).
  sfx constant text := '\s*[—–-]\s*(client account|own cost|deposit|pour compte client|charge propre|d[ée]p[ôo]t)\s*$';
  g   record;
  v_grp uuid;
  n_grouped int := 0;
BEGIN
  CREATE TEMP TABLE _sib ON COMMIT DROP AS
  SELECT dictionary_item_id,
         direction,
         lower(trim(regexp_replace(coalesce(label_en, ''), sfx, '', 'i'))) AS base_en,
         lower(trim(regexp_replace(coalesce(label_fr, ''), sfx, '', 'i'))) AS base_fr,
         (coalesce(label_en, '') ~* sfx OR coalesce(label_fr, '') ~* sfx)    AS has_suffix,
         NULL::uuid AS grp
    FROM dictionary_item
   WHERE sibling_group IS NULL;

  -- Pass 1 — English base, then pass 2 — French base. A row joins the first
  -- group it is found in; pass 2 can only ADD rows to a group or form new ones.
  FOR g IN
    SELECT base_en AS base, 'en' AS lang FROM _sib WHERE base_en <> ''
     GROUP BY base_en HAVING count(*) > 1 AND bool_or(has_suffix)
    UNION ALL
    SELECT base_fr, 'fr' FROM _sib WHERE base_fr <> ''
     GROUP BY base_fr HAVING count(*) > 1 AND bool_or(has_suffix)
  LOOP
    SELECT s.grp INTO v_grp
      FROM _sib s
     WHERE (CASE g.lang WHEN 'en' THEN s.base_en ELSE s.base_fr END) = g.base
       AND s.grp IS NOT NULL
     LIMIT 1;
    IF v_grp IS NULL THEN v_grp := gen_random_uuid(); END IF;

    -- One row per direction: the first of each mode joins, a duplicate does not.
    UPDATE _sib s
       SET grp = v_grp
     WHERE s.grp IS NULL
       AND (CASE g.lang WHEN 'en' THEN s.base_en ELSE s.base_fr END) = g.base
       AND NOT EXISTS (SELECT 1 FROM _sib o WHERE o.grp = v_grp AND o.direction = s.direction)
       AND s.dictionary_item_id = (
             SELECT min(x.dictionary_item_id::text)::uuid FROM _sib x
              WHERE (CASE g.lang WHEN 'en' THEN x.base_en ELSE x.base_fr END) = g.base
                AND x.direction = s.direction AND x.grp IS NULL);
  END LOOP;

  -- A "group" of one is no group.
  UPDATE _sib SET grp = NULL
   WHERE grp IN (SELECT grp FROM _sib WHERE grp IS NOT NULL GROUP BY grp HAVING count(*) < 2);

  UPDATE dictionary_item di
     SET sibling_group = s.grp
    FROM _sib s
   WHERE s.dictionary_item_id = di.dictionary_item_id
     AND s.grp IS NOT NULL
     AND di.sibling_group IS NULL;
  GET DIAGNOSTICS n_grouped = ROW_COUNT;

  RAISE NOTICE '14342 dictionary siblings (%): % rows linked into groups; % rows carry a sibling suffix but could not be paired',
    current_schema(), n_grouped,
    (SELECT count(*) FROM _sib WHERE has_suffix AND grp IS NULL);
END $$;

-- ============================================================================
-- VERIFY
--   SELECT sibling_group, array_agg(code || ' ' || direction || ' ' || label_en ORDER BY direction)
--     FROM dictionary_item WHERE sibling_group IS NOT NULL GROUP BY 1;
--
-- DOWN
--   -- DROP INDEX IF EXISTS ix_dictionary_item_sibling_group;
--   -- ALTER TABLE dictionary_item DROP COLUMN IF EXISTS sibling_confirmed_by;
--   -- ALTER TABLE dictionary_item DROP COLUMN IF EXISTS sibling_confirmed_at;
--   -- ALTER TABLE dictionary_item DROP COLUMN IF EXISTS sibling_group;
-- ============================================================================
