-- ============================================================================
-- 9134 — the hero's figure rail: a catalogue to drag from, not a row to accept
-- ============================================================================
--
-- The homepage hero grew a baseline rail of THREE figures
-- (`HERO_FIGURE_COUNT` in public-web/src/lib/site-api.ts). The band below it,
-- the proof strip, renders whatever the hero did not take — one ordered list,
-- two bands, so reordering in Settings › Website promotes and demotes rather
-- than duplicating a number inside one screenful.
--
-- 9085 seeded four figures, which is one more than the rail and leaves a tenant
-- nothing to choose BETWEEN. This brings the seeded set to eight — one per
-- metric in `site_content.metrics.js` — so the editor opens on a catalogue a
-- marketing person can drag into an order rather than a row they either accept
-- or rebuild from nothing.
--
-- ── IT NEVER OVERWRITES A TENANT'S OWN WORK ────────────────────────────────
--
-- Figures are content, and a tenant who has opened the editor has made
-- decisions this file has no business reversing. So every row below is APPENDED
-- and only when its metric is not already named in the block: a tenant running
-- 9085's four gains four more at the bottom of the list, in the proof strip,
-- where nothing they arranged moves. A tenant who deleted one does not get it
-- back. A tenant who wrote their own keeps theirs and their order.
--
-- That is also what makes it idempotent, which `scripts/db/check-migration-
-- idempotency.js` requires: the second run finds every key present and appends
-- nothing. The guard is a DO block rather than a WHERE on the UPDATE because
-- that script reads a DO block as the author's explicit catalog check and
-- cannot see a guard buried in a statement.
--
-- ── EVERY VALUE IS 0, AND THAT IS NOT A PLACEHOLDER BUG ────────────────────
--
-- `value` is the literal and `metric_key` binds it to a live query. Seeding a
-- literal would be this file inventing a figure for a company it knows nothing
-- about — the one thing WEB_BUILD_BRIEF N12 forbids outright. So the literal is
-- 0 and every row is bound, and `applyMetrics` in site_content.service.js DROPS
-- a bound figure that resolves to nothing rather than publishing the zero.
--
-- Three of these cannot answer on a fresh tenant and are expected not to:
-- `company.years_active` needs a founded year on Settings › Website › About,
-- `coverage.countries_count` needs a published corporate entity, and
-- `operations.avg_clearance_hours` needs Operations to mark the two clearance
-- stages on a milestone template. Each appears in the editor with its metric
-- named, so the path from "this is blank" to "this is live" is visible; none of
-- them appears on the public site until it is true.
--
-- ── THE LABELS ARE THE TENANT'S TO CHANGE ──────────────────────────────────
--
-- French is the required half in this schema and English is optional; both are
-- supplied so a bilingual site is correct before anybody edits anything. The
-- wording is deliberately plain and claim-free — "Pays couverts", not "Présence
-- mondiale" — because BRAND_GUIDELINES §6 rules out claims of scale, and
-- because a label a tenant has to soften is worse than one they have to
-- sharpen.
--
-- VERIFY
--   SELECT jsonb_array_length(content->'items') FROM site_block b
--     JOIN site_page p ON p.page_id = b.page_id
--    WHERE p.key = 'home' AND b.type = 'stat_counters';   -- expect 8 on a
--                                                         -- tenant still on 9085
--   -- run again: still 8.
--
-- DOWN
--   UPDATE site_block SET content = jsonb_set(
--            content, '{items}',
--            (SELECT jsonb_agg(i) FROM jsonb_array_elements(content->'items') i
--              WHERE i->>'metric_key' NOT IN ('company.years_active',
--                'coverage.countries_count','dossiers.tonnage_total',
--                'operations.avg_clearance_hours')))
--    WHERE type = 'stat_counters'
--      AND page_id = (SELECT page_id FROM site_page WHERE key = 'home');
-- ============================================================================

DO $do$
DECLARE
  v_block_id uuid;
  v_items    jsonb;
  v_new      jsonb;
  v_row      jsonb;
BEGIN
  SELECT b.block_id, COALESCE(b.content->'items', '[]'::jsonb)
    INTO v_block_id, v_items
    FROM site_block b
    JOIN site_page p ON p.page_id = b.page_id
   WHERE p.key = 'home' AND b.type = 'stat_counters'
   ORDER BY b.sort_order
   LIMIT 1;

  -- No home page, or no figures block on it: nothing to extend. A tenant who
  -- has not been through 9085 is not given one here — this file's job is the
  -- catalogue, not the page.
  IF v_block_id IS NULL THEN
    RETURN;
  END IF;

  v_new := '[]'::jsonb;

  FOR v_row IN
    SELECT * FROM jsonb_array_elements($seed$
    [
      {
        "label":    {"fr": "Années d’expérience",   "en": "Years of expertise"},
        "sublabel": {"fr": "Depuis notre création", "en": "Since we were founded"},
        "value": 0,
        "metric_key": "company.years_active"
      },
      {
        "label":    {"fr": "Pays couverts",          "en": "Countries covered"},
        "sublabel": {"fr": "Implantations et zones desservies",
                     "en": "Offices and areas served"},
        "value": 0,
        "metric_key": "coverage.countries_count"
      },
      {
        "label":    {"fr": "Tonnage traité",       "en": "Tonnage handled"},
        "sublabel": {"fr": "Cumul des dossiers",   "en": "Across all files"},
        "unit": "t",
        "value": 0,
        "metric_key": "dossiers.tonnage_total"
      },
      {
        "label":    {"fr": "Délai de dédouanement", "en": "Clearance time"},
        "sublabel": {"fr": "Moyenne constatée",     "en": "Measured average"},
        "unit": "h",
        "value": 0,
        "metric_key": "operations.avg_clearance_hours"
      }
    ]
    $seed$::jsonb)
  LOOP
    -- Append only what this block does not already name. `@>` on a one-key
    -- object is an index-friendly containment test and, more to the point,
    -- reads as the question being asked: is this metric already here?
    IF NOT EXISTS (
      SELECT 1
        FROM jsonb_array_elements(v_items) existing
       WHERE existing->>'metric_key' = v_row->>'metric_key'
    ) THEN
      v_new := v_new || jsonb_build_array(v_row);
    END IF;
  END LOOP;

  IF jsonb_array_length(v_new) > 0 THEN
    UPDATE site_block
       SET content = jsonb_set(content, '{items}', v_items || v_new)
     WHERE block_id = v_block_id;
  END IF;
END
$do$;
