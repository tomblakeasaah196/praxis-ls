import * as React from "react";
import { useTranslation } from "react-i18next";
import { useBranding } from "@/app/branding";
import i18n from "@/lib/i18n";
import { useDocumentMeta } from "@/lib/use-document-meta";

/**
 * The browser tab and description of a page, from the same Link Previews
 * wording (`site.share.*`) the server prints into the page's head and draws
 * on its share card (src/shared/http/public-head.js). One set of words, so
 * the tab, the WhatsApp card and the search result never disagree.
 *
 * ── THE WORDS ARRIVE AFTER THE PAGE ───────────────────────────────────────
 *
 * The shipped wording (`share-copy.ts`, two languages) is fetched by a dynamic
 * import once a page has mounted. In the entry dictionary it cost every
 * visitor 0.8 kB of first paint; as a static import of this hook it put the
 * quote page 1.3 kB over its route budget. A tab title is not first-paint
 * content: what a stranger reads first was already in the server's head, so
 * the tab keeps that title until the words land, then takes the same one.
 *
 */
export type SharePage =
  | "home" | "about" | "services" | "insights" | "track" | "quote"
  | "contact" | "careers" | "partners" | "trust" | "portfolio" | "verify";

let loaded = false;
let loading: Promise<void> | null = null;

/** Fetch and register the shipped Link Previews wording, once. `overwrite:
 *  false`, so a tenant's Wording, applied at boot, keeps its words. */
function loadShareCopy(): Promise<void> {
  if (!loading) {
    loading = import("@/lib/share-copy").then(({ en, fr }) => {
      i18n.addResourceBundle("en", "translation", { site: { share: en } }, true, false);
      i18n.addResourceBundle("fr", "translation", { site: { share: fr } }, true, false);
      loaded = true;
    });
  }
  return loading;
}

/** True once the shipped wording is registered; starts the fetch. */
function useShareCopyLoaded(): boolean {
  const [ready, setReady] = React.useState(loaded);
  React.useEffect(() => {
    if (ready) return undefined;
    let alive = true;
    loadShareCopy()
      .then(() => {
        if (alive) setReady(true);
      })
      .catch(() => {
        /* @silent:network: the tab keeps the title the server's head gave it */
      });
    return () => {
      alive = false;
    };
  }, [ready]);
  return ready;
}

/** The name every title carries: Link Previews' site name, which defaults to
 *  the brand name from Appearance. Safe before the wording has loaded: the
 *  default IS the brand name. */
export function useSiteName(): string {
  const { t } = useTranslation();
  const { branding } = useBranding();
  const brand = branding.name || "";
  return t("site.share.siteName", { name: brand, defaultValue: brand }).trim() || brand;
}

/** "Contact Us | Smart Logistics and Services"; a title that already names the
 *  site, or no title at all, is left as it is. */
export function withSiteName(title: string | null | undefined, siteName: string): string {
  const own = (title || "").trim();
  if (!own) return siteName;
  if (!siteName || own.toLowerCase().includes(siteName.toLowerCase())) return own;
  return `${own} | ${siteName}`;
}

/** A built-in page's tab title and description. */
export function useShareMeta(page: SharePage): void {
  const { t } = useTranslation();
  const ready = useShareCopyLoaded();
  const siteName = useSiteName();
  useDocumentMeta({
    title: ready ? withSiteName(t(`site.share.${page}Title`), siteName) : undefined,
    description: ready ? t(`site.share.${page}Description`) : undefined,
  });
}

/** A record's page (an article, a service, a vacancy): its own title, with the
 *  site's name after it. */
export function useRecordMeta(title: string | null | undefined, description?: string | null): void {
  const siteName = useSiteName();
  useDocumentMeta({
    title: title ? withSiteName(title, siteName) : undefined,
    description: description || undefined,
  });
}
