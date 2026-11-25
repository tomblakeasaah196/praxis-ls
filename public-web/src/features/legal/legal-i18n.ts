/**
 * Registers `site.legal.*` (legal-copy.ts) as this chunk is evaluated, strictly
 * before anything in it renders. `overwrite: false`, so a tenant's copy
 * overlay, applied at boot, keeps its words.
 */
import i18n from "@/lib/i18n";
import { en, fr } from "./legal-copy";

i18n.addResourceBundle("en", "translation", { site: { legal: en } }, true, false);
i18n.addResourceBundle("fr", "translation", { site: { legal: fr } }, true, false);
