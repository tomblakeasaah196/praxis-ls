import i18n from "@/lib/i18n";
import { en, fr } from "./quote-engine-copy";

/**
 * Register the quote engine's questions when the "Your Terms" step loads (see
 * quote-steps-i18n.ts for the pattern): a module side effect, and
 * `overwrite = false` so a tenant's own words win whichever lands first.
 */
i18n.addResourceBundle("en", "translation", { site: { quoteEngine: en } }, true, false);
i18n.addResourceBundle("fr", "translation", { site: { quoteEngine: fr } }, true, false);
