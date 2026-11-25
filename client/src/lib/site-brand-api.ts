/**
 * Settings › Website: the photograph slots and the trust documents (14660,
 * doc/smartls-website/ENGINEERING_GUIDE.md PR 4).
 *
 * The payload shapes come from `@praxis/shared` (`siteBrand`), the same
 * schemas the API validates with, so a form here cannot accept a value the
 * server refuses.
 */
import { siteBrand } from "@praxis/shared";
import { download, tenant, tenantWithProgress } from "./api-client";

/* ── photograph slots ───────────────────────────────────────────────────────*/

export type ImageSlot = {
  key: string;
  page: "home" | "about" | "partners" | "trust" | "services";
  label: string;
  aspect: string;
  image_id: string | null;
  doc_id: string | null;
  variants: { widths: number[]; formats: string[] } | null;
  provenance: "owned" | "licensed" | "generated" | null;
  alt_en: string | null;
  alt_fr: string | null;
  updated_at: string | null;
};

export type ImageProvenance = "owned" | "licensed" | "generated";

export const IMAGE_LIMITS = siteBrand.SITE_IMAGE_LIMITS;

export const listImages = () => tenant<ImageSlot[]>("/site-brand/images");

export const saveImageAlt = (slot: string, body: { alt_en: string | null; alt_fr: string | null }) => {
  const parsed = siteBrand.imageAlt.parse(body);
  return tenant<unknown>(`/site-brand/images/${encodeURIComponent(slot)}`, { method: "PUT", body: parsed });
};

export const uploadImage = (
  slot: string,
  body: {
    provenance: ImageProvenance;
    data_url: string;
    original_name?: string;
    alt_en?: string | null;
    alt_fr?: string | null;
  },
  onProgress: (percent: number) => void,
) =>
  tenantWithProgress<{ doc_id: string; slot_key: string }>(
    `/site-brand/images/${encodeURIComponent(slot)}`,
    siteBrand.imageUpload.parse(body),
    onProgress,
  );

export const removeImage = (slot: string) =>
  tenant<unknown>(`/site-brand/images/${encodeURIComponent(slot)}/file`, { method: "DELETE" });

/* ── trust documents ────────────────────────────────────────────────────────*/

export type DocumentKind = "POLICY" | "LEGAL";
export type DocumentStatus = "DRAFT" | "PUBLISHED" | "CHANGED";
export type DocumentLang = "en" | "fr" | "de";

export type SiteDocument = {
  document_id: string;
  doc_key: string;
  kind: DocumentKind;
  sort_order: number;
  title_en: string | null;
  title_fr: string | null;
  title_de: string | null;
  summary_en: string | null;
  summary_fr: string | null;
  summary_de: string | null;
  body_en: string | null;
  body_fr: string | null;
  body_de: string | null;
  version_label: string | null;
  effective_on: string | null;
  approved_by: string | null;
  published_at: string | null;
  updated_at: string;
  status: DocumentStatus;
};

export type DocumentDraft = Partial<
  Pick<
    SiteDocument,
    | "doc_key" | "kind" | "sort_order"
    | "title_en" | "title_fr" | "title_de"
    | "summary_en" | "summary_fr" | "summary_de"
    | "body_en" | "body_fr" | "body_de"
    | "version_label" | "effective_on" | "approved_by"
  >
>;

/** The shared schema's verdict, field by field, before anything is sent. */
export function checkDocument(body: DocumentDraft, creating: boolean): Record<string, string> {
  const schema = creating ? siteBrand.documentCreate : siteBrand.documentUpdate;
  const parsed = schema.safeParse(body);
  if (parsed.success) return {};
  const out: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const k = String(issue.path[0] ?? "form");
    if (!out[k]) out[k] = issue.message;
  }
  return out;
}

export const listDocuments = () => tenant<SiteDocument[]>("/site-brand/documents");

export const createDocument = (body: DocumentDraft) =>
  tenant<SiteDocument>("/site-brand/documents", { method: "POST", body: siteBrand.documentCreate.parse(body) });

export const updateDocument = (id: string, body: DocumentDraft) =>
  tenant<SiteDocument>(`/site-brand/documents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: siteBrand.documentUpdate.parse(body),
  });

export const deleteDocument = (id: string) =>
  tenant<unknown>(`/site-brand/documents/${encodeURIComponent(id)}`, { method: "DELETE" });

export const publishDocument = (id: string, published: boolean) =>
  tenant<SiteDocument>(`/site-brand/documents/${encodeURIComponent(id)}/publish`, {
    method: "POST",
    body: siteBrand.documentPublish.parse({ published }),
  });

export const draftPrivacy = () =>
  tenant<SiteDocument>("/site-brand/documents/privacy-draft", { method: "POST" });

/** The DRAFT as a PDF, downloaded with the session's credentials (a plain
 *  link cannot carry them). Never stored: what the site serves is rendered
 *  from the published copy. */
export const downloadPreviewPdf = (doc: SiteDocument, lang: DocumentLang) =>
  download(
    `/tenant/site-brand/documents/${encodeURIComponent(doc.document_id)}/preview.pdf?lang=${lang}`,
    `${doc.doc_key}-draft-${lang}.pdf`,
  );

/** Where the published PDF is served to the public. */
export const publicPdfUrl = (key: string, lang: DocumentLang) =>
  `/api/tenant/public/site/documents/${encodeURIComponent(key)}/pdf?lang=${lang}`;
