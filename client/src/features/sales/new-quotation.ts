/**
 * New Quotation from a lead or a request (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md
 * §3.2, §3.4, §3.5): for a client OR a prospect. One click makes the DRAFT on
 * the server, which picks the template whose service types include the
 * request's (else the default), copies its words, prefills Your Needs from the
 * request and the latest discovery, and the editor opens on it.
 *
 * The draft is made by the button, never by visiting a URL, so a refresh or a
 * Back never makes a second one.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/components/ui/toast";
import { errMsg } from "@/lib/use-resource";
import { createQuotation, quotationHref } from "@/lib/quotation-api";

export type QuotationSeed = { leadId?: string | null; clientId?: string | null; requestId?: string | null };

/** The body POST /quotations takes for a seed: whichever of the company row, the client and the request are known. */
export const seedBody = (s: QuotationSeed) => ({
  lead_id: s.leadId || null,
  client_id: s.clientId || null,
  quote_request_id: s.requestId || null,
});

export function useStartQuotation(): { start: (seed: QuotationSeed) => Promise<void>; busy: boolean } {
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const start = React.useCallback(
    async (seed: QuotationSeed) => {
      setBusy(true);
      try {
        const q = await createQuotation(seedBody(seed));
        navigate(quotationHref(q.quotation_id));
      } catch (e) {
        toast.error(errMsg(e));
      } finally {
        setBusy(false);
      }
    },
    [navigate, toast],
  );
  return { start, busy };
}
