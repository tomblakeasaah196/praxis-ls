-- ============================================================================
-- TENANT DB — 14310 A quote request stores the service type it asks for, who
-- it is for, and the documents it came with (tenant review, meeting 6, PR 2 —
-- A2, C, D, F).
--
-- ── service_type_id ────────────────────────────────────────────────────────
--
-- Until now a request carried only free text: `service_category` held the
-- website's service NAME in the visitor's language, the portal's translated
-- "<mode> · <direction>" words, or one of the desk's ten hard-coded keys. Every
-- door now sends the service type itself, and `service_category` stays as a
-- display copy the service writes from the service's name on every write — so
-- the CSV export, `lead.service_interest` and the AI keep reading what they
-- always read.
--
-- A PLAIN uuid, not REFERENCES service_type: quote_request exists before this
-- file and a constraint added to an existing table above 13791 aborts
-- provisioning a fresh tenant (tests/unit/migration-constraint-ordering.test.js
-- — the same reason 14220's place ids have none). The rule an FK would have
-- held is in the service instead: every write resolves the id to an ACTIVE
-- service type (website: active AND published) before it stores it, and a
-- service type is never deleted — Service types archives — so an id cannot be
-- left pointing at nothing by the application.
--
-- ── hinterland_direction ───────────────────────────────────────────────────
--
-- Owner decision Q2: hinterland transit (road or rail to Chad and the CAR) is
-- one service type that runs both ways. The request says which:
--   INTO     import transit — Douala → N'Djamena
--   OUT_OF   export transit — Bangui → Douala
-- NULL for every other flow. Held to those two values by the shared validator.
--
-- ── intake_channel: THE CHECK MOVES INTO THE VALIDATOR ─────────────────────
--
-- A request keyed in from an email is channel EMAIL, and the CHECK 10705 wrote
-- (WEBSITE, MANUAL, REFERRAL, CAMPAIGN, PORTAL) refuses it. Widening a CHECK on
-- an existing table above 13791 is the provisioning hazard above, so the
-- constraint is DROPPED and the vocabulary is enforced where every write
-- already passes: `@praxis/shared` quoteRequest.INTAKE_CHANNELS, read by the
-- desk's validator, and the two other doors, which set the channel themselves
-- (WEBSITE in public_intake, PORTAL in the portal) and never take it from the
-- body.
--
-- ── document_kind ON THE ATTACHMENT LINK ───────────────────────────────────
--
-- What a document sent with a request IS: a commercial invoice (the one that
-- lets the desk price — owner decision Q4), a proforma, a packing list, a BL /
-- AWB, photos of the goods, or something else. On the LINK rather than the
-- vault row: the same file can be a proforma to one request and a scan of
-- anything to another. Plain text, held by the shared DOCUMENT_KINDS; NULL on
-- every link made before this file.
--
-- ── THE BACKFILL ───────────────────────────────────────────────────────────
--
-- service_type_id, for the requests that already exist, in two passes, each
-- taking a row only when exactly ONE active service answers it (two answers is
-- a guess, and a guess is worse than NULL):
--
--   1. service_category equals a service's key, English name or French name
--      (case-insensitive) — the desk's keys and the website's names.
--   2. the portal's "<mode> · <direction>" words, in English or French
--      (public-web portal-copy: portal.mode.* and portal.quote.dir.*), read as
--      a card and a territory: "Fret maritime · Import" is the SEA service whose
--      territory is INTERNATIONAL_IMPORT. Storage and customs, which had no
--      direction worth the name, match on the card alone.
--
-- Everything else stays NULL — a request is still a request without one — and
-- the count is RAISEd as a NOTICE so the deploy log says how many.
--
-- Two more backfills, both for requests that came from the portal or are tied
-- to a client, and both only where the column is empty:
--   · requester_company = the client's name (the list showed "—", item 2.4);
--   · owner_user_id = the client's ACTIVE account manager, on requests still
--     open — a linked request takes its client's account manager as owner.
-- ============================================================================

ALTER TABLE quote_request
  ADD COLUMN IF NOT EXISTS service_type_id uuid;
ALTER TABLE quote_request
  ADD COLUMN IF NOT EXISTS hinterland_direction text;
ALTER TABLE quote_request_attachment
  ADD COLUMN IF NOT EXISTS document_kind text;

CREATE INDEX IF NOT EXISTS ix_quote_request_service_type
  ON quote_request (service_type_id) WHERE service_type_id IS NOT NULL;

ALTER TABLE quote_request
  DROP CONSTRAINT IF EXISTS quote_request_intake_channel_check;

-- ── 1. by key or name ───────────────────────────────────────────────────────
UPDATE quote_request q
   SET service_type_id = m.service_type_id
  FROM (
    SELECT q2.quote_request_id, min(st.service_type_id::text)::uuid AS service_type_id
      FROM quote_request q2
      JOIN service_type st
        ON st.is_active
       AND lower(btrim(q2.service_category)) IN (lower(st.key::text), lower(btrim(st.name_en)), lower(btrim(st.name_fr)))
     WHERE q2.service_type_id IS NULL
       AND q2.service_category IS NOT NULL
     GROUP BY q2.quote_request_id
    HAVING count(DISTINCT st.service_type_id) = 1
  ) m
 WHERE q.quote_request_id = m.quote_request_id
   AND q.service_type_id IS NULL;

-- ── 2. by the portal's words ────────────────────────────────────────────────
UPDATE quote_request q
   SET service_type_id = m.service_type_id
  FROM (
    WITH words(word, mode) AS (
      VALUES ('sea freight', 'SEA'), ('fret maritime', 'SEA'),
             ('air freight', 'AIR'), ('fret aérien', 'AIR'),
             ('road', 'ROAD'), ('route', 'ROAD'),
             ('rail', 'RAIL'),
             ('storage', 'STORAGE'), ('entreposage', 'STORAGE'),
             ('customs', 'CUSTOMS'), ('dédouanement', 'CUSTOMS')
    ),
    dirs(word, territory) AS (
      VALUES ('import', 'INTERNATIONAL_IMPORT'),
             ('export', 'INTERNATIONAL_EXPORT'),
             ('in-country', 'DOMESTIC_INLAND'),
             ('national', 'DOMESTIC_INLAND')
    ),
    parsed AS (
      SELECT q2.quote_request_id, w.mode, d.territory
        FROM quote_request q2
        JOIN words w ON lower(btrim(split_part(q2.service_category, '·', 1))) = w.word
        LEFT JOIN dirs d ON lower(btrim(split_part(q2.service_category, '·', 2))) = d.word
       WHERE q2.service_type_id IS NULL
         AND q2.service_category LIKE '%·%'
    )
    SELECT p.quote_request_id, min(st.service_type_id::text)::uuid AS service_type_id
      FROM parsed p
      JOIN service_type st
        ON st.is_active
       AND st.transport_mode = p.mode
       AND (p.mode IN ('STORAGE', 'CUSTOMS') OR st.territory = p.territory)
     GROUP BY p.quote_request_id
    HAVING count(DISTINCT st.service_type_id) = 1
  ) m
 WHERE q.quote_request_id = m.quote_request_id
   AND q.service_type_id IS NULL;

-- ── who asked: the company ──────────────────────────────────────────────────
UPDATE quote_request q
   SET requester_company = cm.name
  FROM client_master cm
 WHERE cm.client_id = q.client_id
   AND (q.requester_company IS NULL OR btrim(q.requester_company) = '');

-- ── who owns it: the client's account manager, on open requests ─────────────
UPDATE quote_request q
   SET owner_user_id = cm.relationship_manager_user_id
  FROM client_master cm
  JOIN app_user u ON u.user_id = cm.relationship_manager_user_id AND u.status = 'ACTIVE'
 WHERE cm.client_id = q.client_id
   AND q.owner_user_id IS NULL
   AND q.status NOT IN ('CONVERTED_TO_OPPORTUNITY', 'CLOSED_NO_ACTION');

DO $$
DECLARE
  unmatched integer;
  total integer;
BEGIN
  SELECT count(*) FILTER (WHERE service_type_id IS NULL), count(*)
    INTO unmatched, total
    FROM quote_request;
  RAISE NOTICE '14310: % of % quote request(s) matched no single service type and keep service_type_id NULL', unmatched, total;
END $$;

COMMENT ON COLUMN quote_request.service_type_id IS
  'The service type the request asks for (14310). Plain uuid, no FK (see 14310): every write resolves it to an active service type first. service_category is the display copy of its name.';
COMMENT ON COLUMN quote_request.hinterland_direction IS
  'For a hinterland-transit service only: INTO (import transit, e.g. Douala → N''Djamena) or OUT_OF (export transit, e.g. Bangui → Douala). Held by @praxis/shared serviceScope.HINTERLAND_DIRECTIONS.';
COMMENT ON COLUMN quote_request_attachment.document_kind IS
  'What the linked document is: COMMERCIAL_INVOICE | PROFORMA | PACKING_LIST | BL_AWB | CARGO_PHOTOS | OTHER (14310, @praxis/shared quoteRequest.DOCUMENT_KINDS). NULL on links made before it.';

-- ============================================================================
-- VERIFY
--   SELECT intake_channel, count(*) FILTER (WHERE service_type_id IS NULL) AS unmatched,
--          count(*) AS total
--     FROM quote_request GROUP BY intake_channel ORDER BY intake_channel;
--   SELECT service_category, count(*) FROM quote_request
--    WHERE service_type_id IS NULL GROUP BY 1 ORDER BY 2 DESC;   -- what did not match, and why
--   SELECT conname FROM pg_constraint
--    WHERE conname = 'quote_request_intake_channel_check';       -- expect 0 rows
--
-- DOWN
--   ALTER TABLE quote_request_attachment DROP COLUMN IF EXISTS document_kind;
--   DROP INDEX IF EXISTS ix_quote_request_service_type;
--   ALTER TABLE quote_request DROP COLUMN IF EXISTS hinterland_direction,
--                             DROP COLUMN IF EXISTS service_type_id;
--   -- Loses which service every request asked for. The intake-channel CHECK is
--   -- NOT restored: EMAIL rows written since would violate it. The requester
--   -- company and owner backfills are not reversed — both only filled blanks.
--   -- Revert quote_request.repo / service and the three intake paths first.
-- ============================================================================
