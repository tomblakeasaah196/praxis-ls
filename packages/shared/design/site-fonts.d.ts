/** Types for the website's font registry. See site-fonts.js for why the public
 *  site's list is shorter than the ERP's. */
export type SiteFontRole = "display" | "body" | "mono";

export declare const SITE_FONT_IDS: string[];
export declare const SITE_FONT_ROLES: Record<SiteFontRole, string[]>;
export declare const SITE_FONT_DEFAULTS: Record<SiteFontRole, string>;
export declare function resolveSiteFont(role: SiteFontRole, id: string | null | undefined): string;
