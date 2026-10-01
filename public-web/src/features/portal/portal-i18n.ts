import i18n from "@/lib/i18n";
import { en, fr } from "./portal-copy";
import { registerLabelKeys } from "@/lib/label-case";
import { LABEL_KEYS } from "./label-keys.generated";

/**
 * Register the portal's copy when the portal chunk loads.
 *
 * The same pattern, and the same reasons, as `features/careers/careers-i18n.ts`:
 * a module side effect runs when the chunk is evaluated, strictly before React
 * renders anything the chunk exports, so the first frame never shows a raw
 * key; and the data file stays import-free because `check:i18n` reads it as
 * data.
 *
 * `overwrite = false`: `portal.setPasswordTitle` stays in the entry dictionary
 * (the marketing page links to the set-password screen with it), and nothing
 * here should replace a key that is already registered.
 */
i18n.addResourceBundle("en", "translation", { portal: en }, true, false);
i18n.addResourceBundle("fr", "translation", { portal: fr }, true, false);

/* The portal chrome's LABEL keys (owner decision D5), in this chunk rather
   than the site's first paint — see scripts/gen/site-copy-case.js. */
registerLabelKeys(LABEL_KEYS);
