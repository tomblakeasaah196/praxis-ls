/**
 * Quotations — the list (Sales & CRM since meeting 6, owner decision G6).
 *
 * Split out of `features/commercial/pages.tsx` in Phase 4 (audit F7). It lived
 * under Engage › Commercial, where nobody in the meeting could find it while
 * Proposals sat under Sales & CRM; it now sits after Proposals — Quote requests
 * → Proposals → Quotations, the order the work flows — and
 * `/commercial/quotations` redirects here.
 *
 * A quotation opens through the URL (`?focus=<id>`, `useRecordParam`), so the
 * costing sheet's "Create quotation", a notification and a search result all
 * land on the one they meant, and Back closes it.
 */

import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { useList, useRefresh, type Row } from "@/lib/use-resource";
import { useRecordParam } from "@/app/layout/nav-trail-context";
import { cell, dateFmt, money } from "@/lib/format";
import { Pill, StatusPill } from "@/components/ui/pill";
import { Chips } from "@/components/ui/chips";
import { QuotationForm } from "./quotation-forms";
import { QuotationDetail } from "./quotation-detail";

const QUOTATION_AI: AiAction[] = [
  {
    label: "Draft quotation",
    kind: "assist",
    describe:
      "Draft a quotation's lines from an opportunity, operations file or costing (human-reviewed before send).",
  },
  {
    label: "Quote a costing",
    kind: "write",
    describe:
      "Create a draft quotation straight from a validated or approved costing, priced at the target margin.",
  },
  {
    label: "Send / accept",
    kind: "write",
    describe:
      "Send, reject, expire or accept a quotation (accept can spin a final-invoice draft).",
  },
];

const QUOTE_FILTERS = [
  { value: "", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "SENT", label: "Sent" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "CONVERTED", label: "Converted" },
  { value: "REJECTED", label: "Rejected" },
  { value: "EXPIRED", label: "Expired" },
];

export function QuotationsPage() {
  const reload = useRefresh();
  const { rows, error } = useList("/quotations");
  const { rows: entities } = useList("/entities");
  const { rows: clients } = useList("/clients");
  const { rows: opportunities } = useList("/opportunities");
  const [filter, setFilter] = React.useState("");
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Row | null>(null);
  const { record: detail, open: openDetail, close: closeDetail } = useRecordParam(rows, (r) => String(r.quotation_id));

  const clientName = React.useMemo(
    () =>
      new Map(
        (clients || []).map((c) => [
          String(c.client_id),
          cell(c.name ?? c.legal_name),
        ]),
      ),
    [clients],
  );
  const filtered = React.useMemo(
    () => (rows || []).filter((r) => !filter || String(r.status) === filter),
    [rows, filter],
  );
  const gated = error && /feature|not enabled|disabled/i.test(error);

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Sales & CRM" to="/sales" />}
        title={tr("Quotations")}
        description={tr("Priced offers between opportunity and invoice — draft, send, accept.")}
        action={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            {tr("New quotation")}
          </Button>
        }
      />
      <HubTabs />

      <div className="mb-4">
        <Chips
          label="Filter quotations by status"
          value={filter}
          options={QUOTE_FILTERS}
          onChange={setFilter}
        />
      </div>

      {error ? (
        gated ? (
          <EmptyState
            title="Quotations aren't enabled for this tenant"
            hint="The commercial.quotation feature flag is off. Enable it in the developer dashboard to use quotations."
          />
        ) : (
          <ErrorState message={error} />
        )
      ) : rows === null ? (
        <SkeletonTable />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={rows.length ? "No quotations match" : "No quotations yet"}
          hint={
            rows.length
              ? "Try another filter."
              : "Draft your first quotation — or open a validated costing and press Create quotation."
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <button
              key={String(r.quotation_id)}
              type="button"
              onClick={() => openDetail(r)}
              className="lux-card flex w-full items-center gap-3 p-3 text-left transition-colors hover:border-primary/40"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {r.doc_number ? `№ ${cell(r.doc_number)}` : tr("Draft")}
                  </p>
                  <StatusPill status={String(r.status || "DRAFT")} />
                  {r.created_from === "COSTING" ? <Pill tone="blue">{tr("From costing")}</Pill> : null}
                  {r.quote_request_ref ? (
                    <Pill tone="mute">
                      {tr("Answers")} {cell(r.quote_request_ref)}
                    </Pill>
                  ) : null}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {r.client_name
                    ? cell(r.client_name)
                    : r.client_id
                      ? (clientName.get(String(r.client_id)) ?? tr("Client"))
                      : tr("No client")}{" "}
                  · {dateFmt(r.created_at)}
                </p>
              </div>
              <span className="num text-sm font-semibold text-foreground">
                {money(r.total_ttc ?? r.total_ht, r.currency)}
              </span>
            </button>
          ))}
        </div>
      )}

      <AiActions actions={QUOTATION_AI} />

      <QuotationForm
        open={formOpen}
        editing={editing}
        entities={entities}
        clients={clients}
        opportunities={opportunities}
        onClose={() => setFormOpen(false)}
        onSaved={reload}
      />
      <QuotationDetail
        quotation={detail}
        entities={entities}
        clientName={clientName}
        onClose={closeDetail}
        onChanged={reload}
        onEdit={(q) => {
          closeDetail();
          setEditing(q);
          setFormOpen(true);
        }}
      />
    </section>
  );
}
