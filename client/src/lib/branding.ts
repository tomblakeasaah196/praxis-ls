import { tenant } from "./api-client";

/** A partner/brand chip shown on the landing hero (e.g. sub-brands the tenant runs). */
export type BrandPill = {
  /** Short label, rendered small-caps (e.g. "Faitlyn Hair"). */
  label: string;
  /** Optional icon/avatar URL shown inside the pill. */
  iconUrl?: string | null;
};

export type Branding = {
  name: string | null;
  primary: string | null;
  primaryForeground: string | null;
  logoUrl: string | null;

  /**
   * Landing/hero content — all optional and white-label. Edited on the
   * Appearance screen, served by the public /branding endpoint so the marketing
   * entry point brands per tenant. Absent fields fall back to generic copy
   * derived from `name` (see landing-page.tsx), so an un-configured tenant still
   * gets a clean hero.
   */
  hero?: {
    /** Small eyebrow line above the headline. */
    eyebrow?: string | null;
    /** Big serif headline. */
    headline?: string | null;
    /** One-line supporting sentence under the headline. */
    subheadline?: string | null;
    /** Longer italic paragraph. */
    body?: string | null;
    /** Full-bleed background image URL (/media or hosted). */
    imageUrl?: string | null;
    /** Partner/sub-brand chips. */
    pills?: BrandPill[] | null;
  } | null;
};

/** Public — resolved by Host, no auth. Used to brand the login pre-auth. */
export const fetchBranding = () => tenant<Branding>("/branding", { auth: false });

/** Gated (MOD-70 edit). Upserts only the provided fields; returns the merged result. */
export const saveBranding = (patch: Partial<Branding>) =>
  tenant<Branding>("/branding", { method: "PUT", body: patch });

/** Gated (MOD-70 edit). Uploads a base64 image data URL to file storage; returns
 *  its public /media URL. Persist it with saveBranding() (logo or hero image). */
export const uploadImage = (dataUrl: string) =>
  tenant<{ logoUrl: string }>("/branding/logo", { method: "POST", body: { dataUrl } });

/** @deprecated alias kept for existing callers — use uploadImage. */
export const uploadLogo = uploadImage;
