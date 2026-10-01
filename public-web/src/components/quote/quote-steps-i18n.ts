import i18n from "@/lib/i18n";
import { en, fr } from "./quote-steps-copy";

/**
 * Register the shared quote steps' copy when a chunk that shows them loads —
 * the website's quote wizard or the client portal. The same pattern, and the
 * same reasons, as `features/careers/careers-i18n.ts`: a module side effect,
 * so it runs before anything in the chunk renders, and `overwrite = false`, so
 * a tenant's own words (merged by `site-copy.ts` with `overwrite = true`) win
 * whichever lands first.
 *
 * Every module that reads `site.quoteSteps.*` imports this file, so no screen
 * depends on another having loaded first.
 */
i18n.addResourceBundle("en", "translation", { site: { quoteSteps: en } }, true, false);
i18n.addResourceBundle("fr", "translation", { site: { quoteSteps: fr } }, true, false);
