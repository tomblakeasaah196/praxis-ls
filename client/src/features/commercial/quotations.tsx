/**
 * Sales & CRM › Quotations, the list (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.4).
 *
 * Number, company, request, total (money-gated on the server), status, viewed,
 * valid until. Chips: All, Draft, Sent, Accepted, Declined, Expired. One
 * button, New Quotation, and a Templates button that opens the one templates
 * screen. Paged and searched on the server.
 *
 * A row opens the editor at /sales/quotations/<id>. An old `?focus=<id>` link
 * (a notification, an email, the AI) goes there too.
 */
import * as React from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Chips } from "@/components/ui/chips";
import { Pill } from "@/components/ui/pill";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/modal";
import { SearchSelect } from "@/components/ui/search-select";
import { AccessLink } from "@/components/ui/access-link";
import { ListPage } from "@/components/list-page";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import type { Column } from "@/components/data-list";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { useCan } from "@/lib/route-access";
import { tenant } from "@/lib/api-client";
import { dateFmt, money } from "@/lib/format";
import { useResource } from "@/lib/use-resource";
import { listQuotationPage, quotationHref, type QuotationListRow } from "@/lib/quotation-api";
import { stageLabel } from "@/lib/lead-api";
import { useStartQuotation } from "@/features/sales/new-quotation";
import { STATUS_CHIPS, statusLabel, statusTone } from "./quotation-words";

const QUOTATION_AI: AiAction[] = [
  { label: "Draft Sections", kind: "assist", describe: "Draft Your Needs and Our Solution from the latest discovery and the published Company Profile." },
  { label: "Quote a Costing", kind: "write", describe: "Create a draft quotation straight from a validated or approved costing, priced at the target margin." },
  { label: "Send or Accept", kind: "write", describe: "Send a quotation, or record that the client accepted it." },
];

const PAGE = 50;

export function QuotationsPage() {
  const [params] = useSearchParams();
  const focus = params.get("focus");
  // An old link (`?focus=<id>`) opens the editor, and replaces itself so Back skips it.
  if (focus) return <Navigate to={quotationHref(focus)} replace />;
  return <QuotationsList />;
}

function QuotationsList() {
  const navigate = useNavigate();
  const can = useCan("MOD-27");
  const [status, setStatus] = React.useState("");
  const [q, setQ] = React.useState("");
  const [term, setTerm] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [creating, setCreating] = React.useState(false);

  // The search reaches the server once typing pauses.
  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setTerm(q);
      setPage(0);
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const res = useResource(() => listQuotationPage({ status, q: term, offset: page * PAGE, limit: PAGE }), [status, term, page]);
  const data = res.data;
  const moneyVisible = data?.moneyVisible !== false;

  const columns: Column<QuotationListRow>[] = [
    {
      key: "doc_number",
      label: tr("Number"),
      className: "num font-medium",
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          {r.doc_number || tr("Draft")}
          {r.version > 1 ? <span className="text-xs text-muted-foreground">v{r.version}</span> : null}
        </span>
      ),
    },
    { key: "client_name", label: tr("Company"), render: (r) => r.client_name || r.lead_name || "—" },
    { key: "quote_request_ref", label: tr("Request"), render: (r) => r.quote_request_ref || r.quote_request_title || "—" },
    {
      key: "total_ttc",
      label: tr("Total"),
      className: "num text-right",
      render: (r) => (moneyVisible && r.total_ttc !== null && r.total_ttc !== undefined ? money(r.total_ttc, r.currency) : "—"),
    },
    { key: "status", label: tr("Status"), render: (r) => <Pill tone={statusTone(r.status)}>{statusLabel(r.status)}</Pill> },
    { key: "viewed_at", label: tr("Viewed"), render: (r) => (r.viewed_at ? dateFmt(r.viewed_at) : "—") },
    { key: "valid_until", label: tr("Valid Until"), render: (r) => (r.valid_until ? dateFmt(r.valid_until) : "—") },
  ];

  const filtered = Boolean(status || term);
  const newButton = can("create") ? <Button onClick={() => setCreating(true)}>{tr("New Quotation")}</Button> : null;

  return (
    <ListPage
      eyebrow={<HubCrumb area="Sales & CRM" to="/sales" />}
      title={tr("Quotations")}
      description={tr("One priced document per offer, printed as a Full Proposal or a Commercial Extract, sent with a link the client answers on.")}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <AccessLink to="/sales/quotations/templates" className="btn-surface inline-flex h-9 items-center rounded-lg px-3 text-[13px] no-underline">
            {tr("Templates")}
          </AccessLink>
          {newButton}
        </div>
      }
      tabs={<HubTabs />}
      toolbar={
        <div className="flex flex-wrap items-center gap-3">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Number, company or request")} aria-label={tr("Search quotations")} className="max-w-xs" />
          <Chips
            label={tr("Filter quotations by status")}
            value={status}
            options={STATUS_CHIPS.map((c) => ({ value: c.value, label: tr(c.label) }))}
            onChange={(v) => {
              setStatus(v);
              setPage(0);
            }}
          />
        </div>
      }
      columns={columns}
      rows={data ? data.rows : null}
      error={res.error}
      loading={res.loading && !data}
      rowKey={(r) => r.quotation_id}
      onRowClick={(r) => navigate(quotationHref(r.quotation_id))}
      empty={{ title: tr("No quotations yet"), action: newButton }}
      emptyFiltered={{
        title: tr("No quotations match"),
        action: (
          <Button
            variant="outline"
            onClick={() => {
              setStatus("");
              setQ("");
            }}
          >
            {tr("Clear Filters")}
          </Button>
        ),
      }}
      filtered={filtered}
      pagination={data ? { page, pageSize: PAGE, total: data.total, hasMore: (page + 1) * PAGE < data.total, onPageChange: setPage } : undefined}
    >
      <AiActions actions={QUOTATION_AI} />
      <NewQuotationDialog open={creating} onClose={() => setCreating(false)} />
    </ListPage>
  );
}

type RequestOption = { quote_request_id: string; public_ref: string | null; title: string | null; stage: string };

/**
 * New Quotation from the list (§3.4): pick a company and, if it has one open,
 * the request it answers. A costing is quoted from its own sheet, as today.
 */
function NewQuotationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { start, busy } = useStartQuotation();
  const [lead, setLead] = React.useState<{ id: string; name: string; clientId: string | null } | null>(null);
  const [requestId, setRequestId] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setLead(null);
    setRequestId("");
  }, [open]);

  const requests = useResource<RequestOption[]>(
    async () => {
      if (!lead) return [];
      const p = new URLSearchParams({ lead_id: lead.id, open: "1", limit: "20" });
      const out = await tenant<{ rows?: RequestOption[] }>(`/quote-requests?${p.toString()}`);
      return out?.rows || [];
    },
    [lead?.id],
  );
  React.useEffect(() => {
    const rows = requests.data || [];
    setRequestId(rows.length === 1 ? rows[0].quote_request_id : "");
  }, [requests.data]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tr("New Quotation")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {tr("Cancel")}
          </Button>
          <Button disabled={!lead} loading={busy} onClick={() => lead && void start({ leadId: lead.id, clientId: lead.clientId, requestId: requestId || null })}>
            {tr("Create Draft")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={tr("Company")} required>
          <SearchSelect
            path="/leads?view=open"
            value={lead?.name || null}
            placeholder={tr("Search companies")}
            getLabel={(r) => String(r.company_name || "")}
            getKey={(r) => String(r.lead_id)}
            onSelect={(r) => setLead({ id: String(r.lead_id), name: String(r.company_name || ""), clientId: r.client_id ? String(r.client_id) : null })}
          />
        </Field>
        <Field label={tr("Request")}>
          <Select value={requestId} disabled={!lead} onChange={(e) => setRequestId(e.target.value)}>
            <option value="">{tr("None")}</option>
            {(requests.data || []).map((r) => (
              <option key={r.quote_request_id} value={r.quote_request_id}>
                {[r.public_ref || r.title || "", stageLabel(r.stage)].filter(Boolean).join(" · ")}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-xs">
          <AccessLink to="/costing/costing" className="text-primary-ink underline">
            {tr("Start From a Costing")}
          </AccessLink>
        </p>
      </div>
    </Dialog>
  );
}
