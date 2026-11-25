/**
 * Registers `site.trust.*` (trust-copy.ts) as this chunk is evaluated, strictly
 * before anything in it renders. `overwrite: false`, so a tenant's copy
 * overlay, applied at boot, keeps its words.
 */
import i18n from "@/lib/i18n";
import { en, fr } from "./trust-copy";

i18n.addResourceBundle("en", "translation", { site: { trust: en } }, true, false);
i18n.addResourceBundle("fr", "translation", { site: { trust: fr } }, true, false);
