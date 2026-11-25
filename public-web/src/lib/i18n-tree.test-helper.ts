import { en as baseEn, fr as baseFr } from "./i18n-dict";
import {
  en as careersEn,
  fr as careersFr,
} from "@/features/careers/careers-copy";
import {
  en as portalEn,
  fr as portalFr,
} from "@/features/portal/portal-copy";
import {
  en as quoteStepsEn,
  fr as quoteStepsFr,
} from "@/components/quote/quote-steps-copy";
import {
  en as profileEn,
  fr as profileFr,
} from "@/features/profile/profile-copy";
import {
  en as quotationEn,
  fr as quotationFr,
} from "@/features/quotation/quotation-copy";
import {
  en as trackPageEn,
  fr as trackPageFr,
} from "@/features/tracking/track-copy";
import {
  en as corridorEn,
  fr as corridorFr,
} from "@/components/site/corridor-copy";
import {
  en as brandEn,
  fr as brandFr,
} from "@/components/site/brand-copy";
import {
  en as aboutPageEn,
  fr as aboutPageFr,
} from "@/features/about/about-copy";
import {
  en as partnersPageEn,
  fr as partnersPageFr,
} from "@/features/partners/partners-copy";
import {
  en as trustEn,
  fr as trustFr,
} from "@/features/trust/trust-copy";
import {
  en as legalEn,
  fr as legalFr,
} from "@/features/legal/legal-copy";

/**
 * The whole translation tree as it exists AT RUNTIME — for tests only.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * `i18n-dict.ts` stopped being the whole dictionary in 13792. `site.careers.*`
 * (~80 keys, reachable only from `/careers`) moved into the careers chunk so
 * that a visitor reading the home page no longer downloads it — the split
 * `check-bundle.mjs` names as the lever to reach for before raising the
 * first-paint budget.
 *
 * The two gates that assert things about "the dictionary" — parity across
 * languages, and that every `t()` call in the source resolves — are about the
 * tree i18next actually holds, which is the union. Reading `i18n-dict.ts` alone
 * would make them report the careers page as ~80 dangling calls; special-casing
 * those keys would make them blind to a real one.
 *
 * ── IT MUST NEVER BE IMPORTED BY APP CODE ─────────────────────────────────
 *
 * Doing so would statically pull the careers copy back into whatever chunk did
 * the importing, which for anything in `lib/` means the entry — undoing the
 * split. That is not merely a convention: `check:bundle` measures the entry's
 * gzipped size against a budget it currently fills 99% of, so an app import of
 * this file reddens a gate rather than passing quietly.
 *
 * A new feature dictionary goes in BOTH here and `FEATURE_DICTS` in
 * `scripts/check-i18n.mjs` — same list, two consumers, and a missing entry
 * shows up as dangling keys in whichever one was forgotten.
 */
export const en = {
  ...baseEn,
  site: { ...baseEn.site, careers: careersEn, quoteSteps: quoteStepsEn, profile: profileEn, quotation: quotationEn, trackPage: trackPageEn, corridor: corridorEn, brand: brandEn, aboutPage: aboutPageEn, partnersPage: partnersPageEn, trust: trustEn, legal: legalEn },
  portal: { ...baseEn.portal, ...portalEn },
};

export const fr = {
  ...baseFr,
  site: { ...baseFr.site, careers: careersFr, quoteSteps: quoteStepsFr, profile: profileFr, quotation: quotationFr, trackPage: trackPageFr, corridor: corridorFr, brand: brandFr, aboutPage: aboutPageFr, partnersPage: partnersPageFr, trust: trustFr, legal: legalFr },
  portal: { ...baseFr.portal, ...portalFr },
};
