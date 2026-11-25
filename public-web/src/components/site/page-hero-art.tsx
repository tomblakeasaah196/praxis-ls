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
