-- ============================================================================
-- TENANT DB — 14621 Public tracking: the folded reference index, and an audit
-- of every reference's shape (SmartLS website v2, PR 2).
--
-- ── THE INDEX ───────────────────────────────────────────────────────────────
--
-- The public tracking page now matches a reference the way a person says it:
-- case, spaces and dashes ignored, and O read as 0, I and L read as 1 (the
-- Crockford rule; tracking_public.service `foldReference`). Both sides are
-- folded, so `sl-7z3k...` typed from a phone call finds `SL7Z3K...`. This index
-- is on exactly that expression, so the lookup stays an index probe.
--
-- Only references made of letters and digits are in it, and only those can be
-- tracked publicly: a dashed reference (`SLAS-OPS-2026-0142`, the old
-- sequential numbering) or a draft is never answered to a stranger, because a
-- sequence is a list anyone can walk.
--
-- ── THE AUDIT ───────────────────────────────────────────────────────────────
--
-- Read-only. Counts this schema's dossier references by shape and prints them
-- as a NOTICE in the deploy log, so "has every live reference come from the
-- random allocator?" is answered by the deploy itself. A sequential reference
-- found here is NOT rewritten: it is printed on documents a client holds, and
-- changing it is a decision for a person (the tracking page already refuses it).
-- ============================================================================

CREATE INDEX IF NOT EXISTS ix_dossier_ref_folded
  ON dossier ((translate(upper(ref), 'OIL', '011')))
  WHERE ref ~ '^[A-Za-z0-9]+$';

DO $$
DECLARE
  total integer;
  opaque integer;
  legacy integer;
  sequential integer;
  other integer;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE ref ~ '^[A-Z0-9]{2}[0-9A-HJKMNP-TV-Z]{12,}[A-Z0-9]{2}$' AND ref !~ '^[A-Z0-9]{2}[0-9]+[A-Z0-9]{2}$'),
         count(*) FILTER (WHERE ref ~ '^[A-Z0-9]{2}[0-9]{6,11}[A-Z0-9]{2}$'),
         count(*) FILTER (WHERE ref ~ '[-/]' AND ref ~ '(^|[-/])[0-9]{4}([-/]|$)' AND ref !~ '^DRAFT-'),
         count(*) FILTER (WHERE ref IS NULL OR ref ~ '^DRAFT-')
    INTO total, opaque, legacy, sequential, other
    FROM dossier;
  RAISE NOTICE 'dossier reference audit (%): % files, % random (current), % legacy random, % SEQUENTIAL, % draft or empty',
    current_schema(), total, opaque, legacy, sequential, other;
END $$;

-- DOWN
-- DROP INDEX IF EXISTS ix_dossier_ref_folded;
