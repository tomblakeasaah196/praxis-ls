import * as React from "react";
import "./page-hero.css";

const HeroArt = React.lazy(() =>
  import("./page-hero-art").then((m) => ({ default: m.PageHeroArt })),
);

/**
 * The first band of a page that is not About, For Partners or Trust: the same
 * photograph and scrim, from the page's own slot in Settings › Website ›
 * Photographs, shorter than About's hero because these pages have work to do
 * below it (owner's review of staging, 25 Nov 2026: ten pages opened on a bare
 * black plate).
 *
 * The page keeps its own markup inside: its `<PageContainer>`, its pill, its
 * staged headline. `fallback` is what the band showed before (the lane field)
 * and is drawn only while the slot is empty, so an unfilled slot leaves the
 * page exactly as it was.
 *
 * The band runs under the header (`PageShell overlayHeader`), so it pads its
 * top by the header's measured height, like the homepage hero.
 *
 * ── THE PHOTOGRAPH ARRIVES AFTER THE PAGE ─────────────────────────────────
 *
 * The plate, the padding and the words are here and paint at once. The
 * picture is in page-hero-art.tsx, loaded lazily: it waits for the
 * photographs read anyway, and statically it brought the picture renderer
 * and the site read onto every route's first paint, putting Quote 2.3 kB over
 * its route budget (scripts/check-bundle.mjs).
 */
export function PageHero({
  slot,
  fallback,
  labelledBy,
  children,
}: {
  slot: string;
  fallback?: React.ReactNode;
  labelledBy?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={labelledBy} className="band-hero photo-band" data-size="page">
      <React.Suspense fallback={fallback}>
        <HeroArt slot={slot} fallback={fallback} />
      </React.Suspense>
      {children}
    </section>
  );
}
