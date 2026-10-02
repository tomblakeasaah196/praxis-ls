/**
 * Quotations (MOD-27) — the calls the costing sheet and the quotation screens
 * share. Routes mirror src/modules/commercial/quotation.
 *
 * Meeting 6, PR 4 (owner decision G1): "Create quotation" on a costing prices
 * it on the server with the margin simulator's own rules — the client sends no
 * lines and no prices, only which request it answers and when it lapses
 * (`@praxis/shared` quotation.fromCosting).
 */
import { tenant } from "./api-client";
import type { QuotationFromCosting } from "@shared";

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
  status: string;
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

export const listQuotations = (q: { costing_id?: string; client_id?: string; quote_request_id?: string; status?: string } = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
  const qs = p.toString();
  return tenant<QuotationRow[]>(`/quotations${qs ? `?${qs}` : ""}`);
};

/** Where a quotation opens in the staff app (Sales & CRM since meeting 6, G6). */
export const quotationHref = (id: string) => `/sales/quotations?focus=${encodeURIComponent(id)}`;
