/**
 * The website's photographs by slot (14660): one request per visit, shared by
 * every band that asks.
 *
 * Its own module, apart from `brand-api.ts`, because every page's hero reads
 * it (owner's review of staging, 25 Nov 2026) and the routes are budgeted on
 * what they add to the first paint: the hero needs this, not the trust
 * documents, the Impressum facts or the display rules that live beside them.
 */
import * as React from "react";
import { publicGet } from "./api";
import { mediaSrcSet, mediaUrl, type MediaVariants } from "./site-api";
import type { Lang } from "./i18n";

export type SiteImage = {
  id: string;
  variants: MediaVariants;
  alt: { en: string | null; fr: string | null };
};

export type SiteImages = Record<string, SiteImage>;

let imagesPromise: Promise<SiteImages> | null = null;

/** One request per visit, shared by every band that asks: the homepage and the
 *  About page each draw several slots, and they are one document's worth. */
export function getSiteImages(): Promise<SiteImages> {
  if (!imagesPromise) {
    imagesPromise = publicGet<SiteImages>("/public/site/images")
      .then((r) => (r && typeof r === "object" ? r : {}))
      .catch(() => ({}));
  }
  return imagesPromise;
}

/** Test seam: forget the cached answer. */
export function __resetSiteImages() {
  imagesPromise = null;
}

export function useSiteImages(): SiteImages {
  const [images, setImages] = React.useState<SiteImages>({});
  React.useEffect(() => {
    let alive = true;
    void getSiteImages().then((r) => alive && setImages(r));
    return () => {
      alive = false;
    };
  }, []);
  return images;
}

/** What a `<picture>` needs for one slot, or null when the slot is empty. */
export function imageSources(image: SiteImage | null | undefined, lang: Lang) {
  if (!image || !image.id) return null;
  return {
    src: mediaUrl(image.id) as string,
    avif: mediaSrcSet(image.id, image.variants, "avif"),
    webp: mediaSrcSet(image.id, image.variants, "webp"),
    alt: (lang === "fr" ? image.alt.fr || image.alt.en : image.alt.en || image.alt.fr) || "",
  };
}

