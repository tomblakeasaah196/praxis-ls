/**
 * Company Profile API (Sales lean revamp PR 5, guide §3.6).
 *
 * The section shapes and their word limits come from `@shared`'s
 * `companyProfile`, the same definition the API validates with.
 */
import {
  tenant,
  tenantPaged,
  tenantWithProgress,
  download,
} from "@/lib/api-client";
import type { CompanyProfileSectionKey } from "@shared";

export type SectionKey = CompanyProfileSectionKey;
export type Words = Record<string, string>;
export type Lang = "EN" | "FR";

export type VersionSummary = {
  version_id: string;
  number: number;
  status: "DRAFT" | "PUBLISHED" | "SUPERSEDED";
  change_note: string | null;
  created_at: string;
  created_by_name: string | null;
  published_at: string | null;
  published_by_name: string | null;
};

export type Item = { id: string; on?: boolean; held?: boolean; kind?: "CERTIFICATION" | "MEMBERSHIP"; document_id?: string | null };

export type Structure = {
  on: boolean;
  show?: Record<string, boolean>;
  items?: Item[];
  figures?: Record<string, boolean>;
  story_ids?: string[];
  logo_ids?: string[];
};

export type Section = { key: SectionKey; structure: Structure; text_en: Words; text_fr: Words };
export type Dot = "complete" | "partial" | "empty";

export type Editor = {
  draft: VersionSummary | null;
  published: VersionSummary | null;
  versions: VersionSummary[];
  sections: Section[];
  completeness: Record<SectionKey, Dot>;
  cover_url: string | null;
  contact: {
    legal_name?: string | null;
    trading_name?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
  } | null;
  choices: {
    services: { id: string; name_en: string | null; name_fr: string | null; short_en: string | null; short_fr: string | null }[];
    stories: { id: string; title: string; client_name: string | null; published_at: string | null }[];
    logos: Logo[];
  };
  derived: {
    computed_at: string | null;
    fleet_count: number;
    fleet_composition: Record<string, number>;
    warehouse_capacity: number | string;
    warehouse_count: number;
    offices: number;
    gateways: string[];
    regions: string[];
    client_count: number;
  } | null;
};

export type Logo = { id: string; name: string; url: string | null; retired: boolean };

export type Saved = { draft: VersionSummary; section: Section; completeness: Record<SectionKey, Dot> };

export type Share = {
  share_id: string;
  recipient_name: string | null;
  recipient_email: string | null;
  lead_id: string | null;
  lead_name: string | null;
  language: Lang;
  pinned_version: number | null;
  expires_at: string;
  revoked_at: string | null;
  state: "ACTIVE" | "EXPIRED" | "REVOKED";
  created_at: string;
  created_by_name: string | null;
  first_opened_at: string | null;
  last_opened_at: string | null;
  open_count: number;
  downloaded_at: string | null;
};

export type ShareOpen = { open_id: string; kind: "VIEW" | "DOWNLOAD"; opened_at: string; agent_label: string | null };

export type Change = {
  section_key: SectionKey;
  field: string;
  language: Lang | null;
  before: unknown;
  after: unknown;
};

const BASE = "/company-profile";

/** `?a=1&b=2`, skipping empty values. */
function qs(params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export const getEditor = () => tenant<Editor>(BASE);

export const saveSection = (
  key: SectionKey,
  body: { structure?: Structure; text_en?: Words; text_fr?: Words },
) => tenant<Saved>(`${BASE}/draft/sections/${key}`, { method: "PATCH", body });

export const uploadCover = (dataUrl: string, onProgress: (p: number) => void) =>
  tenantWithProgress<{ cover_url: string; draft: VersionSummary }>(
    `${BASE}/draft/cover`,
    { data_url: dataUrl },
    onProgress,
  );

export const removeCover = () =>
  tenant<{ cover_url: null; draft: VersionSummary }>(`${BASE}/draft/cover`, { method: "DELETE" });

export const publish = (changeNote: string | null) =>
  tenant<VersionSummary>(`${BASE}/publish`, { method: "POST", body: { change_note: changeNote } });

export const versionDiff = (versionId: string) =>
  tenant<{ version: VersionSummary; previous: VersionSummary | null; changes: Change[] }>(
    `${BASE}/versions/${versionId}/diff`,
  );

export const preview = (lang: Lang, versionId?: string | null) =>
  tenant<{ html: string; version: VersionSummary }>(
    `${BASE}/preview${qs({ lang, version_id: versionId })}`,
  );

export const downloadPdf = (lang: Lang, version: VersionSummary | null) =>
  download(
    `/tenant${BASE}/pdf${qs({ lang, version_id: version?.version_id })}`,
    `company-profile-v${version ? version.number : ""}-${lang.toLowerCase()}.pdf`,
  );

export const refreshFigures = () => tenant<unknown>(`${BASE}/refresh`, { method: "POST" });

export const addLogo = (name: string, dataUrl: string, onProgress: (p: number) => void) =>
  tenantWithProgress<Logo>(`${BASE}/logos`, { name, data_url: dataUrl }, onProgress);

export const retireLogo = (id: string) =>
  tenant<{ id: string; retired: true }>(`${BASE}/logos/${id}/retire`, { method: "POST" });

export const listProfileShares = (offset: number, leadId?: string | null) =>
  tenantPaged<Share[]>(`${BASE}/shares${qs({ limit: 25, offset, lead_id: leadId })}`);

export const createProfileShare = (body: {
  lead_id?: string | null;
  recipient_name?: string | null;
  recipient_email?: string | null;
  language: Lang;
  expires_on: string;
  pin_version: boolean;
}) => tenant<{ share: Share; token: string; path: string }>(`${BASE}/shares`, { method: "POST", body });

export const revokeProfileShare = (id: string) => tenant<Share>(`${BASE}/shares/${id}/revoke`, { method: "POST" });

export const profileShareOpens = (id: string) =>
  tenant<{ share: Share; opens: ShareOpen[] }>(`${BASE}/shares/${id}/opens`);
