import * as React from "react";
import { SitePhoto } from "@/components/site/site-photo";
import { HERO_SCRIMS } from "@/components/site/hero-scrim";
import { useSiteImages, type SiteImage } from "@/lib/site-images";

/** The photograph and the hero's own scrim, behind a band's content. */
export function PhotoArt({ image, priority }: { image: SiteImage | null | undefined; priority: boolean }) {
  return (
    <div className="photo-band-art" aria-hidden>
      <SitePhoto image={image} sizes="100vw" priority={priority} decorative />
      <div
        className="photo-band-scrim photo-band-scrim-stacked"
        style={{ backgroundImage: HERO_SCRIMS.css(HERO_SCRIMS.stacked) }}
      />
      <div
        className="photo-band-scrim photo-band-scrim-split"
        style={{ backgroundImage: HERO_SCRIMS.css(HERO_SCRIMS.split) }}
      />
    </div>
  );
}

/**
 * The photograph for one slot, or `fallback` while the slot is empty or the
 * answer has not arrived. Loaded by `<PageHero>` after the page itself (see
 * page-hero.tsx for why), so this module, the picture renderer and the
 * photographs read are never on a route's first paint.
 */
export function PageHeroArt({ slot, fallback = null }: { slot: string; fallback?: React.ReactNode }) {
  const image = useSiteImages()[slot];
  return image && image.id ? <PhotoArt image={image} priority /> : <>{fallback}</>;
}

/**
 * THE CAREERS PHOTO CARD (14720): the hero's colour and floor, laid the other
 * way up.
 *
 * A role's card carries its words at the FOOT (title, chips, dates, the apply
 * line) over a photograph the recruiter chose, so the scrim is held at the
 * floor from the bottom edge to just over half the card and falls away above
 * it, where only the picture is. Measured against the same worst case as the
 * hero (a blown-out, near-white photograph), so a role's words read whatever
 * was uploaded behind them. The card's `min-height` keeps the copy inside the
 * floored half; `careers-page.test.tsx` holds the stops to `SCRIM_FLOOR`.
 *
 * Here rather than in hero-scrim.ts beside its siblings because that module is
 * in the site's ENTRY bundle (the homepage hero). This module is already a
 * lazy chunk (`PageHero` loads it), so the careers card rides in it and adds
 * no file name to the entry's import map.
 */
export const SCRIM_CARD = {
  shape: "linear-gradient(0deg",
  stops: [
    { at: "0%", alpha: 0.95, over: true },
    { at: "62%", alpha: 0.88, over: true },
    { at: "100%", alpha: 0.2, over: false },
  ],
} as const;

/**
 * A role's careers photograph behind its card on the list (14720), loaded
 * lazily by `careers-page.tsx` from this same chunk: the words, the plate
 * colour and the layout paint at once, and the picture arrives a moment later
 * into a card that already reads without it. The role's own page uses
 * `PhotoArt` above, like every other page hero.
 */
export function CardArt({ image }: { image: SiteImage }) {
  return (
    <div className="photo-band-art" aria-hidden>
      <SitePhoto image={image} sizes="(min-width: 80em) 75vw, 100vw" decorative />
      <div className="photo-band-scrim" style={{ backgroundImage: HERO_SCRIMS.css(SCRIM_CARD) }} />
    </div>
  );
}
