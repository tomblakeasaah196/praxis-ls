/**
 * New Quotation from a lead or a request (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md
 * §3.2): on a CLIENT row it opens today's quotation create flow with the client
 * and the request filled in. A prospect has no client to quote yet; prospect
 * quotations arrive with PR 4 and PR 6, so the button is not drawn for one.
 *
 * Read by `QuotationsPage` (`?new=1&client=&request=`), which opens its form
 * seeded and then drops the parameters, so Back and a refresh do not reopen it.
 */
export function newQuotationPath(clientId: string, requestId?: string | null): string {
  const p = new URLSearchParams({ new: "1", client: clientId });
  if (requestId) p.set("request", requestId);
  return `/sales/quotations?${p.toString()}`;
}
