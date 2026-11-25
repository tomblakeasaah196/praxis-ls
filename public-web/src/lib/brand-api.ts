/**
 * The website's brand layer, read side (14660, doc/smartls-website/
 * ENGINEERING_GUIDE.md PR 4): photographs by slot, the published trust
 * documents and the legal facts of the published companies.
 *
 * Every failure is the empty answer, for the reason `site-api.getSitePage`
 * gives: a page that has no photograph, no policy or no Impressum facts yet
 * draws less, never an error plate on a marketing surface. A document a
 * visitor asked for by address is the exception: there, not-found is the true
 * answer and the page says so.
 */
import { publicGet } from "./api";
import type { Lang } from "./i18n";

import * as display from "@praxis/shared/text/display";

// The legal-name and phone display rules (packages/shared/text/display.js),
// WRAPPED rather than re-exported, so they share this module's chunk. Rollup
// links a re-export straight to the original module, which then became a chunk
// of its own, and its filename in the preload map alone pushed the first paint
// over budget.
export const legalNameWithForm = (name: string, form?: string | null) => display.legalNameWithForm(name, form);
export const phoneDisplay = (phone: string) => display.phoneDisplay(phone);
export const phoneHref = (phone: string) => display.phoneHref(phone);

/* ── photographs: in ./site-images, re-exported for the pages that read both ─*/

export {
  getSiteImages,
  __resetSiteImages,
  useSiteImages,
  imageSources,
  type SiteImage,
  type SiteImages,
} from "./site-images";

/* ── trust documents ────────────────────────────────────────────────────────*/

export type DocumentLang = "en" | "fr" | "de";

export type PublicDocumentCard = {
  key: string;
  kind: "POLICY" | "LEGAL";
  lang: DocumentLang;
  languages: DocumentLang[];
  title: string;
  summary: string | null;
  version_label: string | null;
  effective_on: string | null;
  published_at: string;
};

export type PublicDocument = {
  key: string;
  kind: "POLICY" | "LEGAL";
  lang: DocumentLang;
  languages: DocumentLang[];
  title: string;
  summary: string | null;
  body: string;
  version_label: string | null;
  effective_on: string | null;
  approved_by: string | null;
  published_at: string;
};

export const listPublicDocuments = (opts: { lang: Lang; signal?: AbortSignal }) =>
  publicGet<PublicDocumentCard[]>(`/public/site/documents?lang=${opts.lang}`, { signal: opts.signal })
    .then((r) => (Array.isArray(r) ? r : []))
    .catch((): PublicDocumentCard[] => []);

/** Rejects on not-found: the page that asked for one document by its address
 *  has to tell the reader it is not there. */
export const getPublicDocument = (key: string, lang: DocumentLang, signal?: AbortSignal) =>
  publicGet<PublicDocument>(
    `/public/site/documents/${encodeURIComponent(key)}?lang=${lang}`,
    { signal },
  );

export const documentPdfUrl = (key: string, lang: DocumentLang) =>
  `/api/tenant/public/site/documents/${encodeURIComponent(key)}/pdf?lang=${lang}`;

/* ── the legal facts ────────────────────────────────────────────────────────*/

export type LegalEntity = {
  id: string;
  legal_name: string;
  legal_form: string | null;
  country_code: string;
  country: string | null;
  address_lines: string[];
  representatives: { name: string; title: string | null }[];
  register: { kind: string; number: string; authority: string | null } | null;
  vat_id: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
};

export const getLegalEntities = (signal?: AbortSignal) =>
  publicGet<LegalEntity[]>("/public/site/legal", { signal })
    .then((r) => (Array.isArray(r) ? r : []))
    .catch((): LegalEntity[] => []);
