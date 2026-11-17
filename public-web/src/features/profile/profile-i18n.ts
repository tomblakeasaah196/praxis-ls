import i18n from "@/lib/i18n";
import { en, fr } from "./profile-copy";

/**
 * Register the shared profile page's copy when its chunk loads: a module side
 * effect, so the words exist before the first paint, and `overwrite = false`
 * so a tenant's own wording still wins. The same pattern, for the same
 * reasons, as `features/verify/verify-i18n.ts`.
 */
i18n.addResourceBundle("en", "translation", { site: { profile: en } }, true, false);
i18n.addResourceBundle("fr", "translation", { site: { profile: fr } }, true, false);
