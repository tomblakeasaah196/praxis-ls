import i18n from "@/lib/i18n";
import { en, fr } from "./verify-copy";

/**
 * Register the verification portal's copy when the verify chunk loads.
 *
 * The same pattern, and the same reasons, as `features/careers/careers-i18n.ts`
 * and `features/portal/portal-i18n.ts`.
 *
 * ── WHY THIS IS A SEPARATE FILE FROM THE DATA ─────────────────────────────
 *
 * `verify-copy.ts` is read as DATA by two build scripts, one of which evaluates
 * it and refuses a file carrying an import. So the import lives here and that
 * file stays a pair of object literals.
 *
 * ── WHY A MODULE SIDE EFFECT AND NOT A HOOK ───────────────────────────────
 *
 * This runs when the chunk is evaluated, which is strictly before React renders
 * anything the chunk exports. A `useEffect` would run AFTER the first paint, so
 * the portal would show raw dictionary keys for one frame — on the page where
 * somebody is deciding whether a document is genuine, which is the worst place
 * in the product to look broken for a frame.
 *
 * ── `overwrite = false` ───────────────────────────────────────────────────
 *
 * A tenant's own words arrive separately through `site-copy.ts`, which merges
 * them over the dictionary with `overwrite = true`. The two can land in either
 * order, and `false` here is what makes both orders agree: the tenant's
 * sentence beats ours and ours beats nothing, which is the rule the whole
 * copy model states. `true` would invert it for this one page, and only for
 * visitors who arrived at it first.
 *
 * No `emit("languageChanged")`: nothing is mounted yet when this runs.
 */
i18n.addResourceBundle("en", "translation", { site: { verify: en } }, true, false);
i18n.addResourceBundle("fr", "translation", { site: { verify: fr } }, true, false);
