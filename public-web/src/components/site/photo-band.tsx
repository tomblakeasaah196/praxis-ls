import * as React from "react";
import { PageContainer } from "@/components/site/page-shell";
import { SitePhoto } from "@/components/site/site-photo";
import { HERO_SCRIMS } from "@/components/site/hero-scrim";
import type { SiteImage } from "@/lib/brand-api";

/**
 * A dark photographic band: the "light pages with dark photographic bands"
 * look the owner chose (decision 12). Used for a page's hero, for a band in
 * the middle of a page and for the closing call to action.
 *
 * ── THE TEXT NEVER DEPENDS ON THE PHOTOGRAPH ──────────────────────────────
 *
 * The scrim is the hero's own, measured against the worst picture a tenant can
 * upload (a near-white one): stacked on a phone, split on a wide screen, with
 * the text always over the opaque part. So any photograph, or none, leaves the
 * words at the contrast `check:contrast` measures for `--hero-foreground` on
 * `--hero`. Without a photograph the band is the plain carbon plate.
 */
export function PhotoBand({
  image,
  priority = false,
  size = "band",
  children,
  labelledBy,
}: {
  image: SiteImage | null | undefined;
  priority?: boolean;
  /** `hero`: the page's first band, taller, under the header. */
  size?: "hero" | "band";
  children: React.ReactNode;
  labelledBy?: string;
}) {
  const has = Boolean(image && image.id);
  return (
    <section aria-labelledby={labelledBy} className="band-hero photo-band" data-size={size}>
      {has ? (
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
      ) : null}
      <PageContainer className="photo-band-body">{children}</PageContainer>
    </section>
  );
}
