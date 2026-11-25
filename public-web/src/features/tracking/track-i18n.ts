/**
 * Registers `site.trackPage.*` (track-copy.ts) as the tracking chunk is
 * evaluated, strictly before anything in it renders. `overwrite: false`, so a
 * tenant's copy overlay, applied at boot, keeps its words.
 */
import i18n from "@/lib/i18n";
import { en, fr } from "./track-copy";

i18n.addResourceBundle("en", "translation", { site: { trackPage: en } }, true, false);
i18n.addResourceBundle("fr", "translation", { site: { trackPage: fr } }, true, false);
