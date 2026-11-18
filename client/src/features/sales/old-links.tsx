/**
 * Old Sales links that still open something (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md
 * §5.6). Emails, notifications, the AI and bookmarks carry these addresses, and
 * a link that lands on the Control Tower is indistinguishable from a dead one.
 *
 *   /sales/quote-requests/:id   the request opens on its company row:
 *                               /sales/leads/<lead>?request=<id>
 *   /sales/opportunities/:id    every opportunity became a request (14512 set
 *                               `converted_opportunity_id` on each), so the
 *                               link opens that request the same way
 *
 *   /sales/proposals/:id        every proposal became a quotation (14542 set
 *                               `source_proposal_id` on each): its editor
 *
 * All resolve with one read and replace themselves in the history, so Back
 * does not bounce through them.
 */
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { tr } from "@/lib/i18n";
import { useResource } from "@/lib/use-resource";
import { pageShell } from "@/lib/layout";
import { ErrorState, LoadingRow } from "@/components/ui/states";
import { fetchRequest, requestForOpportunity } from "@/lib/lead-api";
import { listQuotations, quotationHref } from "@/lib/quotation-api";

/** Where a request opens: its company's 360 with the request sheet on top. */
export function requestHref(leadId: string | null | undefined, requestId: string, keep?: URLSearchParams): string {
  if (!leadId) return "/sales/leads";
  const p = new URLSearchParams(keep);
  p.set("request", requestId);
  return `/sales/leads/${leadId}?${p.toString()}`;
}

type Found = { lead_id?: unknown; quote_request_id?: unknown } | null;

function Resolving({ kind, id }: { kind: "request" | "opportunity"; id: string }) {
  const [params] = useSearchParams();
  const res = useResource<Found>(
    () => (kind === "request" ? fetchRequest(id) : requestForOpportunity(id)) as Promise<Found>,
    [kind, id],
  );
  if (res.error) {
    return (
      <section className={pageShell.reading}>
        <ErrorState message={res.error} />
      </section>
    );
  }
  if (res.loading) return <LoadingRow label={tr("Opening…")} />;
  const row = res.data;
  if (!row || !row.quote_request_id) return <Navigate to="/sales/leads" replace />;
  const keep = new URLSearchParams(params);
  keep.delete("focus");
  return <Navigate to={requestHref(row.lead_id ? String(row.lead_id) : null, String(row.quote_request_id), keep)} replace />;
}

export function RequestLinkPage() {
  const { quoteRequestId = "" } = useParams();
  return <Resolving kind="request" id={quoteRequestId} />;
}

export function OpportunityLinkPage() {
  const { opportunityId = "" } = useParams();
  return <Resolving kind="opportunity" id={opportunityId} />;
}

/** An old proposal link: the quotation it became, else the Quotations list. */
export function ProposalLinkPage() {
  const { proposalId = "" } = useParams();
  const res = useResource(() => listQuotations({ source_proposal_id: proposalId }), [proposalId]);
  if (res.error) {
    return (
      <section className={pageShell.reading}>
        <ErrorState message={res.error} />
      </section>
    );
  }
  if (res.loading) return <LoadingRow label={tr("Opening…")} />;
  const row = (res.data || [])[0];
  return <Navigate to={row ? quotationHref(row.quotation_id) : "/sales/quotations"} replace />;
}
