/**
 * Registers `site.partnersPage.*` (partners-copy.ts) as this chunk is evaluated, strictly
 * before anything in it renders. `overwrite: false`, so a tenant's copy
 * overlay, applied at boot, keeps its words.
 */
import i18n from "@/lib/i18n";
import { en, fr } from "./partners-copy";

i18n.addResourceBundle("en", "translation", { site: { partnersPage: en } }, true, false);
i18n.addResourceBundle("fr", "translation", { site: { partnersPage: fr } }, true, false);
