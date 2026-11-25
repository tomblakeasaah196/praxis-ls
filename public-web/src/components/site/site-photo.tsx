import { getLang } from "@/lib/i18n";
import { imageSources, type SiteImage } from "@/lib/site-images";
import { cn } from "@/lib/cn";

/**
 * One photograph from a slot (Settings › Website › Photographs), served as AVIF
 * and WebP at the widths that were actually written, with the original as the
 * fallback. Renders nothing for an empty slot: the band around it is designed
 * to stand without its picture.
 *
 * `decorative` drops the alt text for a picture behind a headline that already
 * says what the band is about; a screen reader then hears the headline once
 * rather than a description of the background first.
 */
export function SitePhoto({
  image,
  sizes,
  className,
  priority = false,
  decorative = false,
}: {
  image: SiteImage | null | undefined;
  sizes: string;
  className?: string;
  /** The first band on a page: fetched eagerly, since it is the largest paint. */
  priority?: boolean;
  decorative?: boolean;
}) {
  const s = imageSources(image, getLang());
  if (!s) return null;
  return (
    <picture>
      {s.avif ? <source type="image/avif" srcSet={s.avif} sizes={sizes} /> : null}
      {s.webp ? <source type="image/webp" srcSet={s.webp} sizes={sizes} /> : null}
      <img
        src={s.src}
        alt={decorative ? "" : s.alt}
        aria-hidden={decorative || undefined}
        loading={priority ? "eager" : "lazy"}
        decoding={priority ? "sync" : "async"}
        // `fetchpriority` is the LCP lever for the first band; React 18 does
        // not know the camelCase prop, so it is passed as the attribute.
        {...(priority ? { fetchpriority: "high" } : {})}
        className={cn("h-full w-full object-cover", className)}
      />
    </picture>
  );
}
