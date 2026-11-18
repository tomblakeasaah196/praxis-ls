/**
 * The quotation editor's plain helpers (lean revamp §3.4): the line shape the
 * editor holds and what it saves, copying a link, and the company a quotation
 * is for as the confirms name it. Kept out of the component files so each of
 * those exports components only.
 */
import { tr } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import type { Quotation, QuotationLine } from "@/lib/quotation-api";

export type QLine = {
  dictionary_item_id: string | null;
  label: string;
  qty: string;
  unit_price: string;
  is_disbursement: boolean;
  tax_code_id: string | null;
  container_type_ref_id?: string | null;
  client_heading?: string | null;
  client_heading_code?: string | null;
  client_heading_fr?: string | null;
  client_heading_en?: string | null;
};

export const qLineTotal = (l: { qty?: unknown; unit_price?: unknown }) => (Number(l.qty) || 0) * (Number(l.unit_price) || 0);

export const blankLine = (): QLine => ({
  dictionary_item_id: null,
  label: "",
  qty: "1",
  unit_price: "0",
  is_disbursement: false,
  tax_code_id: null,
});

/** A stored (or costing-priced) line as the editor holds it. */
export function toQLine(l: Partial<QuotationLine> & { label?: string | null }): QLine {
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    dictionary_item_id: str(l.dictionary_item_id),
    label: l.label ? String(l.label) : "",
    qty: l.qty != null ? String(l.qty) : "1",
    unit_price: l.unit_price != null ? String(l.unit_price) : "0",
    is_disbursement: l.is_disbursement === true,
    tax_code_id: str(l.tax_code_id),
    container_type_ref_id: str(l.container_type_ref_id),
    client_heading: str(l.client_heading),
    client_heading_code: str(l.client_heading_code),
    client_heading_fr: str(l.client_heading_fr),
    client_heading_en: str(l.client_heading_en),
  };
}

/** What PATCH /quotations/:id takes: blank lines dropped, débours never taxed. */
export function cleanLines(lines: QLine[]) {
  return lines
    .filter((l) => l.label.trim())
    .map((l) => ({
      dictionary_item_id: l.dictionary_item_id || null,
      label: l.label.trim(),
      qty: Number(l.qty) || 1,
      unit_price: Number(l.unit_price) || 0,
      is_disbursement: l.is_disbursement,
      tax_code_id: l.is_disbursement ? null : l.tax_code_id || null,
      container_type_ref_id: l.container_type_ref_id || null,
      client_heading: l.client_heading || null,
    }));
}

/** Copy a link, or say how to when the browser will not. */
export function useCopy() {
  const toast = useToast();
  return async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(tr("Link copied"));
    } catch {
      /* @silent:storage: a browser that refuses the clipboard still shows the link to select */
      toast.info(tr("Select the link and copy it"));
    }
  };
}

/** The company the quotation is for, as the confirms and the subject name it. */
export const partyName = (q: Pick<Quotation, "client_name" | "lead_name" | "lead">) =>
  q.client_name || q.lead_name || q.lead?.company_name || tr("the client");

