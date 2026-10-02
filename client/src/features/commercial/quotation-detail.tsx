/**
 * Commercial — the read/act drawer for a single quotation.
 *
 * Split from `quotation-forms.tsx` in Phase 4 (audit F7: no file over 400
 * lines). Separate from the editor for the same reason as Sales' proposal
 * drawer: writing a quotation and driving its lifecycle (send, accept, convert
 * to a dossier) are different jobs opened at different moments.
 */

import * as React from "react";
import { tr } from "@/lib/i18n";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Modal, Field } from "@/components/ui/modal";
import { LoadingRow, ErrorState } from "@/components/ui/states";
import { errMsg, type Row } from "@/lib/use-resource";
import { cell, dateFmt, money } from "@/lib/format";
import { StatusPill } from "@/components/ui/pill";
import { SearchSelect } from "@/components/ui/search-select";
import { DocButton } from "@/components/doc-button";
import { Link } from "react-router-dom";
import { Pill } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { Segmented } from "@/components/ui/segmented";
import { ClientFamilies } from "@/components/client-families";
import { entityLabelOf, entityText, qLineTotal } from "./quotation-forms";

export function QuotationDetail({
  quotation,
  entities,
  clientName,
  onClose,
  onChanged,
  onEdit,
}: {
  quotation: Row | null;
  entities: Row[] | null;
  clientName: Map<string, string>;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (q: Row) => void;
}) {
  const open = !!quotation;
  const [data, setData] = React.useState<Row | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [action, setAction] = React.useState<null | "send" | "accept">(null);
  const [entityId, setEntityId] = React.useState("");
  const [convert, setConvert] = React.useState(false);
  // The lines as stored, or as the client reads them (G2).
  const [lineView, setLineView] = React.useState<"lines" | "families">("lines");

  React.useEffect(() => {
    if (!quotation) return;
    let live = true;
    setData(null);
    setError(null);
    setAction(null);
    setEntityId("");
    setConvert(false);
    tenant<Row>(`/quotations/${String(quotation.quotation_id)}`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [quotation]);

  const status = data ? String(data.status) : "";
  const lines = (data?.lines as Row[] | undefined) || [];
  const id = quotation ? String(quotation.quotation_id) : "";

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      onClose();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  }
  const transitionTo = (to: string, entity?: string) =>
    run(() =>
      tenant(`/quotations/${id}/transition`, {
        method: "POST",
        body: { to, entity_id: entity },
      }),
    );
  const doAccept = () =>
    run(() =>
      tenant(`/quotations/${id}/accept`, { method: "POST", body: { convert } }),
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        quotation && quotation.doc_number
          ? `Quotation ${cell(quotation.doc_number)}`
          : "Quotation (draft)"
      }
      description="Review, then move it through its lifecycle."
      size="xl"
    >
      <div className="space-y-4">
        {error && <ErrorState message={error} />}
        {data === null && !error ? (
          <LoadingRow label="Loading quotation…" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill status={status || "DRAFT"} />
              {data?.client_id ? (
                <span className="text-xs text-muted-foreground">
                  {clientName.get(String(data.client_id)) ?? "Client"}
                </span>
              ) : null}
              {data?.valid_until ? (
                <span className="text-xs text-muted-foreground">
                  valid until {dateFmt(data.valid_until)}
                </span>
              ) : null}
              <span className="ml-auto">
                <DocButton
                  docType="QUOTATION"
                  id={id}
                  title={
                    quotation?.doc_number
                      ? String(quotation.doc_number)
                      : "Quotation"
                  }
                />
              </span>
            </div>

            <Provenance data={data} />

            {lines.length > 0 && (
              <Segmented
                label={tr("Line view")}
                value={lineView}
                onChange={(v) => setLineView(v as "lines" | "families")}
                options={[
                  { value: "lines", label: tr("Line items") },
                  { value: "families", label: tr("By family (as printed)") },
                ]}
              />
            )}
            {lines.length > 0 && lineView === "families" && (
              <ClientFamilies
                lines={lines.map((l) => ({
                  label: String(l.label ?? ""),
                  qty: Number(l.qty) || 0,
                  amount: qLineTotal(l),
                  is_disbursement: l.is_disbursement === true,
                  client_heading: (l.client_heading as string | null) ?? null,
                  client_heading_code: (l.client_heading_code as string | null) ?? null,
                  client_heading_fr: (l.client_heading_fr as string | null) ?? null,
                  client_heading_en: (l.client_heading_en as string | null) ?? null,
                }))}
                currency={String(data?.currency || "XAF")}
                readOnly
                order={Array.isArray(data?.family_order) ? (data?.family_order as string[]) : null}
                onHeading={() => undefined}
              />
            )}
            {lines.length > 0 && lineView === "lines" && (
              <div className="rounded-lg border">
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span>{tr("Item")}</span>
                  <span className="w-12 text-right">{tr("Qty")}</span>
                  <span className="w-24 text-right">{tr("Unit")}</span>
                  <span className="w-28 text-right">{tr("Total")}</span>
                </div>
                {lines.map((l) => (
                  <div
                    key={String(l.quotation_line_id)}
                    className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-1.5 text-sm"
                  >
                    <span>
                      {cell(l.label)}
                      {l.is_disbursement ? (
                        <span className="ml-1 text-xs text-muted-foreground">
                          (débours)
                        </span>
                      ) : null}
                    </span>
                    <span className="w-12 text-right">{cell(l.qty)}</span>
                    <span className="w-24 text-right">
                      {money(l.unit_price, data?.currency)}
                    </span>
                    <span className="w-28 text-right">
                      {money(qLineTotal(l), data?.currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-col items-end gap-0.5 text-sm">
              <span className="text-muted-foreground">
                Total HT: {money(data?.total_ht, data?.currency)}
              </span>
              <span className="font-semibold">
                Total TTC: {money(data?.total_ttc, data?.currency)}
              </span>
            </div>

            {action === "send" && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <Field
                  label={tr("Entity")}
                  hint="Numbers the quotation on send"
                  required
                >
                  <SearchSelect
                    path="/entities"
                    value={entityLabelOf(entities, entityId)}
                    placeholder={tr("Search entities…")}
                    getLabel={entityText}
                    getKey={(en) => String(en.entity_id)}
                    onSelect={(en) => setEntityId(String(en.entity_id))}
                  />
                </Field>
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAction(null)}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    loading={busy}
                    disabled={!entityId}
                    onClick={() => transitionTo("SENT", entityId)}
                  >
                    Confirm send
                  </Button>
                </div>
              </div>
            )}
            {action === "accept" && (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={convert}
                    onChange={(e) => setConvert(e.target.checked)}
                  />
                  Convert to a final-invoice draft
                </label>
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAction(null)}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" loading={busy} onClick={doAccept}>
                    Confirm accept
                  </Button>
                </div>
              </div>
            )}

            {!action && (
              <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
                <Button variant="outline" onClick={onClose}>
                  Close
                </Button>
                {status === "DRAFT" && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => onEdit(data ?? (quotation as Row))}
                    >
                      Edit
                    </Button>
                    {data?.entity_id ? (
                      <Button
                        loading={busy}
                        onClick={() => transitionTo("SENT")}
                      >
                        Send
                      </Button>
                    ) : (
                      <Button onClick={() => setAction("send")}>Send…</Button>
                    )}
                  </>
                )}
                {status === "ACCEPTED" && (
                  // G4: a client's acceptance never converts on its own —
                  // turning it into an invoice draft is the team's step.
                  <Button
                    loading={busy}
                    onClick={() =>
                      run(() => tenant(`/quotations/${id}/convert`, { method: "POST", body: {} }))
                    }
                  >
                    {tr("Create invoice draft")}
                  </Button>
                )}
                {status === "SENT" && (
                  <>
                    <Button
                      variant="ghost"
                      loading={busy}
                      onClick={() => transitionTo("EXPIRED")}
                    >
                      Expire
                    </Button>
                    <Button
                      variant="ghost"
                      loading={busy}
                      onClick={() => transitionTo("REJECTED")}
                    >
                      Reject
                    </Button>
                    <Button onClick={() => setAction("accept")}>Accept…</Button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * Where this quotation came from and what happened to it (meeting 6, PR 4):
 * the request it answers, the costing it was priced from and the margin it
 * was priced at, the workings behind its prices, and the client's own answer.
 */
function Provenance({ data }: { data: Row | null }) {
  if (!data) return null;
  const request = data.quote_request as { quote_request_id: string; public_ref: string | null; status: string } | null;
  const costing = data.costing as { costing_id: string; doc_number: string | null } | null;
  const workings = data.workings as { margin_simulation_id: string; target_margin_percent: number | null } | null;
  const ccy = String(data.currency || "XAF");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {request ? (
          <Link className="text-primary-ink underline" to={`/sales/quote-requests/${request.quote_request_id}`}>
            {tr("Answers")} {request.public_ref || tr("a quote request")}
          </Link>
        ) : (
          <span className="text-muted-foreground">{tr("Not linked to a quote request")}</span>
        )}
        {costing ? (
          <Link className="text-primary-ink underline" to={`/costing/costing/${costing.costing_id}`}>
            {tr("Priced from costing")} {costing.doc_number || ""}
          </Link>
        ) : null}
        {data.margin_percent != null ? (
          <Pill tone="blue">
            {tr("Margin applied")} {cell(data.margin_percent)} %
          </Pill>
        ) : null}
        {workings ? (
          <Link className="text-primary-ink underline" to={`/commercial/margin-simulation?focus=${workings.margin_simulation_id}`}>
            {tr("See the workings")}
          </Link>
        ) : null}
      </div>
      {data.created_from === "COSTING" && Number(data.own_cost_total) > 0 ? (
        <p className="micro">
          {tr("Own costs on this file:")} {money(data.own_cost_total, ccy)} — {tr("not billed; the services must cover them.")}
        </p>
      ) : null}
      {data.answered_via === "PORTAL" && data.status === "ACCEPTED" ? (
        <Callout tone="ok" title={tr("Accepted in the portal.")}>
          {[cell(data.answered_by_name), cell(data.answered_by_email), dateFmt(data.answered_at)].filter((x) => x && x !== "—").join(" · ")}
        </Callout>
      ) : null}
      {data.status === "REJECTED" && data.decline_reason ? (
        <Callout tone="warn" title={tr("Declined by the client:")}>
          {String(data.decline_reason)}
          {data.answered_by_name ? ` — ${String(data.answered_by_name)}` : ""}
        </Callout>
      ) : null}
    </div>
  );
}
