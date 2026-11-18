import i18n from "@/lib/i18n";
import { en, fr } from "./quotation-copy";

/**
 * Register the public quotation page's copy when its chunk loads: a module
 * side effect, so the words exist before the first paint, and `overwrite =
 * false` so a tenant's own wording still wins. The same pattern, for the same
 * reasons, as `features/verify/verify-i18n.ts`.
 */
i18n.addResourceBundle("en", "translation", { site: { quotation: en } }, true, false);
i18n.addResourceBundle("fr", "translation", { site: { quotation: fr } }, true, false);
