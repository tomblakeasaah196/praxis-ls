/**
 * "Create quotation" on a costing — one click, priced directly (tenant review,
 * meeting 6, item 4.3, owner decision G1).
 *
 * The only road from a costing to a quotation used to be costing → margin
 * simulation → submit → approve → "Create quotation", and nobody in the meeting
 * took it. This prices the costing on the server with the margin simulator's
 * OWN rules, so a quotation priced here equals what the simulator would give
 * for the same costing at the same margin:
 *
 *   · débours pass through at cost — no margin, no VAT;
 *   · our services take the tenant's target margin (Settings › Commercial);
 *   · our own costs are not billed — they are the floor the services must
 *     cover, said in so many words, with a warning when they do not.
 *
 * The dialog shows exactly that before anything is written, lets the pricer
 * tie it to the client's quote request (the one that fits is pre-picked), and
 * opens the DRAFT. The workings are kept as a margin simulation behind the
 * scenes; nobody is walked through it.
 *
 * Offered on a costing that has been validated or approved (auditor default):
 * on any other the button is disabled and says why.
 */
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { quotation as shared } from "@shared";
import { Button } from "@/components/ui/button";
import { Modal, Field, Select } from "@/components/ui/modal";
import { DateField } from "@/components/ui/date-field";
import { Callout } from "@/components/ui/callout";
import { Pill } from "@/components/ui/pill";
import { Tooltip } from "@/components/ui/tooltip";
import { LoadingRow, ErrorState } from "@/components/ui/states";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useResource, errMsg } from "@/lib/use-resource";
import { useCanUseModule } from "@/lib/route-access";
import { amount, money, dateFmt } from "@/lib/format";
import { tr, tv } from "@/lib/i18n";
import { dictLabel } from "@/lib/dict-label";
import {
  quotationFromCostingPreview,
  createQuotationFromCosting,
  listQuotations,
  quotationHref,
  type FromCostingPreview,
} from "@/lib/quotation-api";

const NONE = "__none__";

/** Why the button is off, in the words the pricer needs. */
function notReadyReason(status: string): string {
  if (status === "DRAFT") return tr("Submit the costing for validation first — a quotation is created once it is validated or approved.");
  if (status === "SUBMITTED_FOR_VALIDATION") return tr("Waiting for its validator — a quotation is created once the costing is validated or approved.");
  if (status === "REJECTED") return tr("This costing was rejected. Correct it and send it through again.");
  return tr("A quotation is created from a validated or approved costing.");
}

export function CreateQuotationButton({
  costingId,
  status,
  dirty,
}: {
  costingId: string;
  status: string;
  /** Unsaved edits on the sheet: the quotation is priced from the SAVED costing. */
  dirty: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  // MOD-27 is the quotation's module: a pricer without it would get a 403.
  const canQuote = useCanUseModule("MOD-27");
  if (!canQuote) return null;
  const ready = shared.COSTING_QUOTABLE.includes(status);
  if (!ready) {
    const reason = notReadyReason(status);
    return (
      <Tooltip content={reason}>
        {/* A disabled button fires no pointer events; the span carries the
            tooltip and is reachable by Tab (tooltip.tsx). */}
        <span tabIndex={0} aria-label={`${tr("Create quotation")} — ${reason}`}>
          <Button variant="outline" disabled>
            {tr("Create quotation")}
          </Button>
        </span>
      </Tooltip>
    );
  }
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={dirty} title={dirty ? tr("Save the costing first — the quotation is priced from the saved sheet.") : undefined}>
        {tr("Create quotation")}
      </Button>
      {open && <CreateQuotationDialog costingId={costingId} onClose={() => setOpen(false)} />}
    </>
  );
}

function CreateQuotationDialog({ costingId, onClose }: { costingId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const preview = useResource(() => quotationFromCostingPreview(costingId), [costingId]);
  const existing = useResource(() => listQuotations({ costing_id: costingId }), [costingId]);
  const [requestId, setRequestId] = React.useState<string | null>(null);
  const [validUntil, setValidUntil] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const p = preview.data;

  // Pre-pick the request the server suggests, once it arrives.
  React.useEffect(() => {
    if (p) setRequestId(p.suggested_quote_request_id || NONE);
  }, [p]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const q = await createQuotationFromCosting(costingId, {
        quote_request_id: requestId && requestId !== NONE ? requestId : null,
        valid_until: validUntil || null,
      });
      toast.success(tr("Draft quotation created"));
      onClose();
      navigate(quotationHref(q.quotation_id));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const drafts = (existing.data || []).filter((q) => q.status !== "REJECTED" && q.status !== "EXPIRED");

  return (
    <Modal
      open
      onClose={onClose}
      size="wide"
      title={tr("Create Quotation")}
      description={tr("Priced from this costing with the margin simulator's rules. It opens as a draft you can still adjust.")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {tr("Cancel")}
          </Button>
          <Button onClick={() => void create()} loading={busy} disabled={!p}>
            {tr("Create draft quotation")}
          </Button>
        </>
      }
    >
      {preview.error ? <ErrorState message={preview.error} /> : null}
      {!p && !preview.error ? <LoadingRow label={tr("Pricing the costing…")} /> : null}
      {p ? <PreviewBody p={p} requestId={requestId} onRequest={setRequestId} validUntil={validUntil} onValidUntil={setValidUntil} drafts={drafts} /> : null}
      {error ? <ErrorState message={error} /> : null}
    </Modal>
  );
}

function natureOf(l: FromCostingPreview["lines"][number]) {
  if (l.is_disbursement) return <Pill tone="mute">{tr("Débours — at cost")}</Pill>;
  if (!l.cost_nature) return <Pill tone="warn">{tr("Unclassified")}</Pill>;
  return <Pill tone="blue">{tr("Service")}</Pill>;
}

function PreviewBody({
  p,
  requestId,
  onRequest,
  validUntil,
  onValidUntil,
  drafts,
}: {
  p: FromCostingPreview;
  requestId: string | null;
  onRequest: (id: string) => void;
  validUntil: string;
  onValidUntil: (v: string) => void;
  drafts: { quotation_id: string; doc_number: string | null; status: string }[];
}) {
  const ccy = p.costing.currency || "XAF";
  return (
    <div className="space-y-4">
      {drafts.length > 0 && (
        <Callout tone="info" title={tr("Already quoted.")}>
          {tr("This costing already has a quotation:")}{" "}
          {drafts.map((q, i) => (
            <React.Fragment key={q.quotation_id}>
              {i > 0 ? ", " : ""}
              <Link className="font-semibold text-primary-ink underline" to={quotationHref(q.quotation_id)}>
                {q.doc_number || tr("Draft")}
              </Link>
            </React.Fragment>
          ))}
          . {tr("Creating another prices it again from today's settings.")}
        </Callout>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border p-3">
          <p className="micro">{tr("Margin applied to services")}</p>
          <p className="num text-lg font-semibold text-foreground">{p.target_margin_percent} %</p>
          <Link className="micro text-primary-ink underline" to="/settings/commercial">
            {tr("Change it in Settings › Commercial")}
          </Link>
        </div>
        <div className="rounded-lg border p-3">
          <p className="micro">{tr("Total (HT)")}</p>
          <p className="num text-lg font-semibold text-foreground">{money(p.totals.total_ht, ccy)}</p>
          <p className="micro num">
            {tr("TTC")} {money(p.totals.total_ttc, ccy)}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="micro">{tr("Own costs on this file")}</p>
          <p className="num text-lg font-semibold text-foreground">{money(p.floor.own_cost_total, ccy)}</p>
          <p className="micro">{tr("Not billed — the services must cover them.")}</p>
        </div>
      </div>

      {p.floor.own_cost_total > 0 &&
        (p.floor.covered ? (
          <Callout tone="ok" title={tr("Own costs covered.")}>
            {tv("The services billed ({{services}}) cover what this file costs us ({{own}}).", {
              services: money(p.floor.service_total, ccy),
              own: money(p.floor.own_cost_total, ccy),
            })}
          </Callout>
        ) : (
          <Callout tone="warn" title={tr("The services do not cover our own costs.")}>
            {tv("They bill {{services}} against {{own}} of own costs — short by {{short}}. Raise the margin or the service lines on the draft before sending it.", {
              services: money(p.floor.service_total, ccy),
              own: money(p.floor.own_cost_total, ccy),
              short: money(p.floor.shortfall, ccy),
            })}
          </Callout>
        ))}

      {p.unclassified.length > 0 && (
        <Callout tone="warn" title={tr("Not in the catalogue:")}>
          {p.unclassified.join(", ")}. {tr("Priced as services; check them on the draft.")}
        </Callout>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <THead>
            <TR>
              <TH>{tr("Line")}</TH>
              <TH>{tr("Nature")}</TH>
              <TH className="text-right">{tr("Qty")}</TH>
              <TH className="text-right">{tr("Unit cost")}</TH>
              <TH className="text-right">{tr("Unit price")}</TH>
              <TH className="text-right">{tr("Amount")}</TH>
            </TR>
          </THead>
          <TBody>
            {p.lines.map((l, i) => (
              <TR key={`${l.dictionary_item_id || l.label}-${i}`}>
                <TD className="text-sm text-foreground">{l.label}</TD>
                <TD>{natureOf(l)}</TD>
                <TD className="num text-right">{l.qty}</TD>
                <TD className="num text-right">{amount(l.unit_cost)}</TD>
                <TD className="num text-right">{amount(l.unit_price)}</TD>
                <TD className="num text-right">{amount(l.qty * l.unit_price)}</TD>
              </TR>
            ))}
            {p.own_costs.map((l, i) => (
              <TR key={`own-${i}`}>
                <TD className="text-sm text-muted-foreground">{l.label}</TD>
                <TD>
                  <Pill tone="orange">{tr("Own cost — not billed")}</Pill>
                </TD>
                <TD className="num text-right text-muted-foreground">{l.qty}</TD>
                <TD className="num text-right text-muted-foreground">{amount(l.unit_cost)}</TD>
                <TD className="num text-right text-muted-foreground">—</TD>
                <TD className="num text-right text-muted-foreground">—</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={tr("Answers the Quote Request")} hint={tr("The client sees this quotation on that request in their portal.")}>
          <Select value={requestId || NONE} onChange={(e) => onRequest(e.target.value)}>
            <option value={NONE}>{tr("— none —")}</option>
            {p.quote_requests.map((r) => (
              <option key={r.quote_request_id} value={r.quote_request_id}>
                {[r.public_ref || tr("Request"), dictLabel({ label_en: r.service_name_en, label_fr: r.service_name_fr }), dateFmt(r.created_at), r.answered ? tr("already answered") : null]
                  .filter(Boolean)
                  .join(" · ")}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr("Valid Until")} hint={tr("Optional — you can set it on the draft.")}>
          <DateField value={validUntil} onChange={onValidUntil} />
        </Field>
      </div>
    </div>
  );
}
