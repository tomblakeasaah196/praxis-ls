/**
 * Quotations (MOD-27) — the calls the costing sheet and the quotation screens
 * share. Routes mirror src/modules/commercial/quotation.
 *
 * Meeting 6, PR 4 (owner decision G1): "Create quotation" on a costing prices
 * it on the server with the margin simulator's own rules — the client sends no
 * lines and no prices, only which request it answers and when it lapses
 * (`@praxis/shared` quotation.fromCosting).
 */
import { download, tenant, tenantPaged } from "./api-client";
import type {
  QuotationFromCosting,
  QuotationLanguage,
  QuotationOutput,
  QuotationSectionInput,
  QuotationSectionKey,
  QuotationSendInput,
  QuotationTemplateInput,
} from "@shared";

export type FromCostingLine = {
  dictionary_item_id: string | null;
  label: string;
  qty: number;
  unit_cost: number;
  unit_price: number;
  is_disbursement: boolean;
  tax_code_id: string | null;
  container_type_ref_id: string | null;
  client_heading: string | null;
  /** The catalogue's direction: REVENUE | DISBURSEMENT | … — null when unclassified. */
  cost_nature: string | null;
};

export type QuoteRequestOption = {
  quote_request_id: string;
  public_ref: string | null;
  /** The request's stage (NEW … LOST); the retired intake status is not sent. */
  stage: string;
  created_at: string;
  service_name_en: string | null;
  service_name_fr: string | null;
  /** A quotation already answers it. */
  answered: boolean;
};

export type FromCostingPreview = {
  costing: {
    costing_id: string;
    doc_number: string | null;
    dossier_id: string | null;
    dossier_ref: string | null;
    client_id: string | null;
    entity_id: string | null;
    currency: string;
    status: string;
  };
  target_margin_percent: number;
  lines: FromCostingLine[];
  own_costs: { label: string; qty: number; unit_cost: number; amount: number }[];
  /** The services billed against what we pay out of pocket (G1). */
  floor: { own_cost_total: number; service_total: number; covered: boolean; shortfall: number };
  totals: { total_ht: number; vat_total: number; total_ttc: number };
  /** Lines with no catalogue entry: priced as services, nature unknown. */
  unclassified: string[];
  quote_requests: QuoteRequestOption[];
  suggested_quote_request_id: string | null;
};

export type QuotationRow = {
  quotation_id: string;
  doc_number: string | null;
  status: string;
  client_id: string | null;
  client_name?: string | null;
  costing_id: string | null;
  quote_request_id: string | null;
  quote_request_ref?: string | null;
  currency: string;
  total_ht: number;
  total_ttc: number;
  margin_percent: number | null;
  created_from: string | null;
  own_cost_total: number | null;
  family_order: string[] | null;
  created_at: string;
};

export const quotationFromCostingPreview = (costingId: string) =>
  tenant<FromCostingPreview>(`/quotations/from-costing/${encodeURIComponent(costingId)}`);

export const createQuotationFromCosting = (costingId: string, body: QuotationFromCosting) =>
  tenant<QuotationRow & { floor: FromCostingPreview["floor"]; unclassified: string[] }>(
    `/quotations/from-costing/${encodeURIComponent(costingId)}`,
    { method: "POST", body },
  );

export const listQuotations = (q: { costing_id?: string; client_id?: string; quote_request_id?: string; status?: string; source_proposal_id?: string } = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
  const qs = p.toString();
  return tenant<QuotationRow[]>(`/quotations${qs ? `?${qs}` : ""}`);
};

/* ── the Quotations list (lean revamp §3.4) ───────────────────────────────── */

export type QuotationListRow = QuotationRow & {
  title: string | null;
  lead_id: string | null;
  lead_name: string | null;
  quote_request_title: string | null;
  valid_until: string | null;
  viewed_at: string | null;
  sent_at: string | null;
  version: number;
  /** Null when the reader may not see money (§3.4: the total is money-gated). */
  total_ttc: number;
};

export type QuotationPage = { rows: QuotationListRow[]; total: number; moneyVisible: boolean };

export async function listQuotationPage(q: { status?: string; q?: string; offset?: number; limit?: number }): Promise<QuotationPage> {
  const p = new URLSearchParams();
  if (q.status) p.set("status", q.status);
  if (q.q && q.q.trim()) p.set("q", q.q.trim());
  p.set("limit", String(q.limit ?? 50));
  p.set("offset", String(q.offset ?? 0));
  const res = await tenantPaged<QuotationListRow[]>(`/quotations?${p.toString()}`);
  const rows = res.data || [];
  return { rows, total: res.total ?? rows.length, moneyVisible: res.meta?.money_visible !== false };
}

/* ── one quotation: the editor (§3.4) ─────────────────────────────────────── */

export type QuotationLine = {
  quotation_line_id?: string;
  dictionary_item_id: string | null;
  label: string;
  qty: number | string;
  unit_price: number | string;
  is_disbursement: boolean;
  tax_code_id: string | null;
  container_type_ref_id?: string | null;
  client_heading?: string | null;
  client_heading_code?: string | null;
  client_heading_fr?: string | null;
  client_heading_en?: string | null;
};

export type QuotationSection = {
  section_key: QuotationSectionKey;
  enabled: boolean;
  body_en: string | null;
  body_fr: string | null;
  story_ids: string[];
};

export type QuotationView = {
  kind: "VIEW" | "DOWNLOAD" | string;
  via: string | null;
  opened_at: string;
  agent_label: string | null;
};

export type Quotation = QuotationListRow & {
  entity_id: string | null;
  quote_model: "HT_ON_TOP" | "TTC";
  language: QuotationLanguage | null;
  default_output: QuotationOutput;
  template_id: string | null;
  supersedes_id: string | null;
  superseded_at: string | null;
  share_active: boolean;
  share_expires_at: string | null;
  share_revoked_at: string | null;
  sent_to: string | null;
  sent_cc: string[] | null;
  sent_subject: string | null;
  answered_at: string | null;
  answered_via: string | null;
  answered_by_name: string | null;
  answered_by_email: string | null;
  decline_reason: string | null;
  lines: QuotationLine[];
  sections: QuotationSection[];
  quote_request: { quote_request_id: string; public_ref: string | null; stage: string; title: string | null; lead_id: string | null } | null;
  costing: { costing_id: string; doc_number: string | null; status: string } | null;
  workings: { margin_simulation_id: string; target_margin_percent: number | null } | null;
  lead: { lead_id: string; company_name: string | null; client_id: string | null } | null;
  views: QuotationView[];
  open_revision_id: string | null;
  languages: ("EN" | "FR")[];
  updated_at: string | null;
};

const at = (id: string) => `/quotations/${encodeURIComponent(id)}`;
const post = <T,>(path: string, body: unknown, method: "POST" | "PATCH" = "POST") => tenant<T>(path, { method, body });

export const getQuotation = (id: string) => tenant<Quotation>(at(id));

export const createQuotation = (body: { lead_id?: string | null; client_id?: string | null; quote_request_id?: string | null; entity_id?: string | null }) =>
  post<Quotation>("/quotations", body);

export type QuotationPatch = {
  title?: string | null;
  language?: QuotationLanguage;
  default_output?: QuotationOutput;
  template_id?: string | null;
  currency?: string;
  quote_model?: "HT_ON_TOP" | "TTC";
  valid_until?: string | null;
  margin_percent?: number | null;
  costing_id?: string | null;
  quote_request_id?: string | null;
  entity_id?: string | null;
  family_order?: string[] | null;
  sections?: QuotationSectionInput[];
  lines?: Omit<QuotationLine, "quotation_line_id" | "client_heading_code" | "client_heading_fr" | "client_heading_en">[];
};
export const updateQuotation = (id: string, patch: QuotationPatch) => post<Quotation>(at(id), patch, "PATCH");

/** The one render (§3.4): the same HTML the link shows and the PDF prints. */
export const previewQuotation = (id: string, output: QuotationOutput, language: "EN" | "FR") =>
  tenant<{ html: string; language: string; output: QuotationOutput }>(`${at(id)}/preview?output=${output}&language=${language}`);

export const downloadQuotationPdf = (id: string, output: QuotationOutput, language: "EN" | "FR", name: string) =>
  download(`/tenant${at(id)}/pdf?output=${output}&language=${language}`, `${name}-${language.toLowerCase()}.pdf`);

export const quotationViews = (id: string) => tenant<QuotationView[]>(`${at(id)}/views`);

export type SendResult = {
  quotation: Quotation;
  link: { url: string; expires_at: string | null };
  mail: { delivered: boolean; suppressed: boolean; reason: string | null; attached: boolean; to: string; cc: string[] };
};
export const sendQuotation = (id: string, body: QuotationSendInput) => post<SendResult>(`${at(id)}/send`, body);

export const shareQuotation = (id: string) =>
  post<{ url: string; path: string; expires_at: string | null }>(`${at(id)}/share`, {});
export const revokeQuotationLink = (id: string) => post<Quotation>(`${at(id)}/share/revoke`, {});
export const reviseQuotation = (id: string) => post<Quotation>(`${at(id)}/revise`, {});
export const draftQuotationSections = (id: string, sections: ("needs" | "solution")[]) =>
  post<{ sections?: QuotationSection[] } & Record<string, unknown>>(`${at(id)}/draft-sections`, { sections });

export const recordAcceptance = (id: string, body: { by_name?: string | null; by_email?: string | null; convert?: boolean } = {}) =>
  post<{ quotation: Quotation; invoice_id: string | null }>(`${at(id)}/accept`, body);
export const declineQuotation = (id: string, body: { reason_code: string; note?: string | null }) =>
  post<Quotation>(`${at(id)}/decline`, body);
export const transitionQuotation = (id: string, to: "SENT" | "REJECTED" | "EXPIRED") => post<Quotation>(`${at(id)}/transition`, { to });
export const convertQuotation = (id: string) => post<{ quotation: Quotation; invoice_id: string }>(`${at(id)}/convert`, {});

export type DeclineReason = { reason_code: string; label_en: string; label_fr: string };
export const declineReasons = () => tenant<DeclineReason[]>("/quotations/decline-reasons");

/* ── templates: the leanest builder (§3.5) ────────────────────────────────── */

export type TemplateSection = { enabled: boolean; body_en?: string; body_fr?: string };
export type QuotationTemplate = {
  template_id: string;
  name: string;
  service_type_ids: string[];
  is_default: boolean;
  active: boolean;
  sections: Record<QuotationSectionKey, TemplateSection>;
};

export const listTemplates = () => tenant<QuotationTemplate[]>("/quotations/templates");
export const createTemplate = (body: QuotationTemplateInput) => post<QuotationTemplate>("/quotations/templates", body);
export const updateTemplate = (id: string, patch: Partial<QuotationTemplateInput> & { active?: boolean }) =>
  post<QuotationTemplate>(`/quotations/templates/${encodeURIComponent(id)}`, patch, "PATCH");
export const previewTemplate = (id: string, language: "EN" | "FR") =>
  tenant<{ html: string; language: string }>(`/quotations/templates/${encodeURIComponent(id)}/preview?language=${language}`);

/** Where a quotation opens in the staff app: its editor (§3.4). */
export const quotationHref = (id: string) => `/sales/quotations/${encodeURIComponent(id)}`;
