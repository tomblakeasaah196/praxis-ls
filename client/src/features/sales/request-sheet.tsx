/**
 * A request, which is also the deal (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.2,
 * owner decision D11): a sheet over the Lead 360, deep-linkable as
 * `/sales/leads/<lead>?request=<id>`.
 *
 * THE STAGE BAR. New, Contacted, Meeting, Quoted are clicked to move; Lost asks
 * why (Price, Timing, Competitor, No Response, Other, and a line) and then asks
 * to be sure; Won is never a click on the bar, because a win opens the
 * operations file: it comes from an accepted quotation, or Mark Won with a
 * confirm that says so. The API holds the same rules (`/stage`, `/mark-won`),
 * and a settled request (Won or Lost) reads only.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { errMsg, useResource } from "@/lib/use-resource";
import { money, dateFmt, cell } from "@/lib/format";
import { useCan } from "@/lib/route-access";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { ErrorState, LoadingRow } from "@/components/ui/states";
import { useConfirm } from "@/components/ui/use-confirm";
import { useToast } from "@/components/ui/toast";
import { AccessLink } from "@/components/ui/access-link";
import { channelLabel, incotermLabel, serviceNameOf } from "@/lib/quote-request-api";
import {
  LOST_REASONS,
  OPEN_STAGES,
  fetchRequest,
  lostReasonLabel,
  markWon,
  moveStage,
  stageLabel,
  type LeadRecord,
  type QuotationRow,
} from "@/lib/lead-api";
import { AttachmentsPanel, QuoteRequestForm } from "./quote-request-forms";
import { useStartQuotation } from "./new-quotation";

/* ═══════════════════════════════ the bar ════════════════════════════════ */

/**
 * New → Contacted → Meeting → Quoted → Won / Lost. Read-only once settled; Won
 * is a state the bar shows, never a button on it.
 */
export function StageBar({
  stage,
  onMove,
  onLost,
  disabled,
  canLose = true,
}: {
  stage: string;
  onMove: (to: string) => void;
  onLost: () => void;
  disabled?: boolean;
  /** Losing a deal ends it, so it takes `approve` (quoteRequestStage). */
  canLose?: boolean;
}) {
  const settled = stage === "WON" || stage === "LOST";
  const reached = OPEN_STAGES.indexOf(stage as (typeof OPEN_STAGES)[number]);
  return (
    <ol className="flex flex-wrap items-stretch gap-1" aria-label={tr("Stage")}>
      {OPEN_STAGES.map((s, i) => {
        const current = s === stage;
        const passed = settled || (reached >= 0 && i < reached);
        return (
          <li key={s} className="min-w-0 flex-1">
            <button
              type="button"
              aria-current={current ? "step" : undefined}
              disabled={disabled || settled || current}
              onClick={() => onMove(s)}
              className={cn(
                "h-9 w-full truncate rounded-md border px-2 text-sm font-medium transition-colors",
                current
                  ? "border-transparent bg-primary text-primary-foreground"
                  : passed
                    ? "bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-primary-ink"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                "disabled:cursor-default",
              )}
            >
              {stageLabel(s)}
            </button>
          </li>
        );
      })}
      <li className="min-w-0 flex-1">
        {stage === "WON" ? (
          <span aria-current="step" className="flex h-9 items-center justify-center rounded-md bg-[rgb(var(--ok))] px-2 text-sm font-medium text-background">
            {stageLabel("WON")}
          </span>
        ) : (
          <button
            type="button"
            aria-current={stage === "LOST" ? "step" : undefined}
            disabled={disabled || settled || !canLose}
            onClick={onLost}
            className={cn(
              "h-9 w-full truncate rounded-md border px-2 text-sm font-medium transition-colors",
              stage === "LOST"
                ? "border-transparent bg-[rgb(var(--bad))] text-background"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
              "disabled:cursor-default",
            )}
          >
            {stageLabel("LOST")}
          </button>
        )}
      </li>
    </ol>
  );
}

/* ═══════════════════════════════ Lost ═══════════════════════════════════ */

export function LostDialog({
  open,
  label,
  onClose,
  onLost,
}: {
  open: boolean;
  /** What is being lost, for the confirm's title: "SQ-2026-0042". */
  label: string;
  onClose: () => void;
  onLost: (code: string, reason: string) => Promise<void>;
}) {
  const [code, setCode] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  React.useEffect(() => {
    if (!open) return;
    setCode("");
    setReason("");
    setError(null);
  }, [open]);

  async function save() {
    if (!code) {
      setError(tr("Say why it was lost"));
      return;
    }
    const ok = await confirm({
      title: `${tr("Mark")} ${label} ${tr("Lost")}?`,
      body: `${lostReasonLabel(code)}${reason.trim() ? `: ${reason.trim()}` : ""}. ${tr("A lost request cannot be reopened.")}`,
      confirmLabel: tr("Mark Lost"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await onLost(code, reason.trim());
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tr("Lost")}
      description={label}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button variant="destructive" onClick={() => void save()} loading={busy} disabled={!code}>
            {tr("Mark Lost")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{tr("Why?")}</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={tr("Why?")}>
            {LOST_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={code === r}
                onClick={() => setCode(r)}
                className={cn(
                  "h-9 rounded-full border px-3 text-sm transition-colors",
                  code === r ? "border-transparent bg-primary text-primary-foreground" : "hover:bg-accent",
                )}
              >
                {lostReasonLabel(r)}
              </button>
            ))}
          </div>
        </fieldset>
        <Field label={tr("In One Line")}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
        {error ? <ErrorState message={error} /> : null}
      </div>
      {confirmDialog}
    </Dialog>
  );
}

/* ═══════════════════════════════ the sheet ══════════════════════════════ */

type RequestRow = Record<string, unknown> & {
  quote_request_id: string;
  stage?: string;
  public_ref?: string | null;
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="micro">{label}</dt>
      <dd className="truncate text-sm text-foreground">{children}</dd>
    </div>
  );
}

const ARRIVED_BY: Record<string, string> = { WEBSITE: "Website", PORTAL: "Portal" };

export function RequestSheet({
  requestId,
  lead,
  quotations,
  onClose,
  onChanged,
}: {
  requestId: string | null;
  lead: LeadRecord;
  quotations: QuotationRow[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const can = useCan("MOD-20");
  const canQuote = useCan("MOD-27");
  const quote = useStartQuotation();
  const toast = useToast();
  const res = useResource<RequestRow | null>(
    () => (requestId ? (fetchRequest(requestId) as Promise<RequestRow>) : Promise.resolve(null)),
    [requestId],
    { fresh: true },
  );
  const [lostOpen, setLostOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  React.useEffect(() => setError(null), [requestId]);

  const r = res.data;
  const stage = String(r?.stage || "NEW");
  const ref = String(r?.public_ref || r?.title || tr("Request"));
  const settled = stage === "WON" || stage === "LOST";
  const mine = quotations.filter((q) => q.quote_request_id === requestId);
  const costingId = mine.find((q) => q.costing_id)?.costing_id || null;

  const changed = () => {
    res.reload();
    onChanged();
  };

  async function move(to: string) {
    if (!r) return;
    setBusy(true);
    setError(null);
    try {
      await moveStage(r.quote_request_id, { stage: to });
      changed();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function won() {
    if (!r) return;
    const ok = await confirm({
      title: `${tr("Mark")} ${ref} ${tr("Won")}?`,
      body: `${tr("Opens operations file for")} ${lead.company_name}${lead.client_id ? "" : `, ${tr("and makes it a client")}`}.`,
      confirmLabel: tr("Mark Won"),
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await markWon(r.quote_request_id, {});
      toast.success(tr("Marked Won"));
      changed();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const service = r ? serviceNameOf({ name_en: r.service_name_en as string, name_fr: r.service_name_fr as string }) || cell(r.service_category) : "";
  const value = r?.estimated_value != null && r.estimated_value !== "" ? money(r.estimated_value, r.currency || "XAF") : "—";
  const route = r ? [r.origin_location, r.destination_location].filter(Boolean).join(" → ") : "";

  return (
    <Dialog
      open={!!requestId}
      onClose={onClose}
      placement="right"
      size="xl"
      title={ref}
      headerRight={
        r?.intake_channel && ARRIVED_BY[String(r.intake_channel)] ? <Pill tone="blue">{tr(ARRIVED_BY[String(r.intake_channel)])}</Pill> : undefined
      }
    >
      {res.error ? (
        <ErrorState message={res.error} />
      ) : !r ? (
        <LoadingRow label={tr("Loading…")} />
      ) : (
        <div className="space-y-5">
          <StageBar stage={stage} onMove={(s) => void move(s)} onLost={() => setLostOpen(true)} disabled={busy || !can("edit")} canLose={can("approve")} />
          {stage === "LOST" && r.lost_reason_code ? (
            <p className="text-sm text-muted-foreground">
              {lostReasonLabel(String(r.lost_reason_code))}
              {r.lost_reason ? `: ${String(r.lost_reason)}` : ""}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {/* Prefilled from this request, for a client or a prospect (PR 6). */}
            {r && !settled && canQuote("create") ? (
              <Button size="sm" loading={quote.busy} onClick={() => void quote.start({ leadId: lead.lead_id, clientId: lead.client_id || null, requestId: r.quote_request_id })}>
                {tr("New Quotation")}
              </Button>
            ) : null}
            {!settled && can("approve") ? (
              <Button variant="outline" size="sm" onClick={() => void won()} loading={busy}>
                {tr("Mark Won")}
              </Button>
            ) : null}
            {costingId ? (
              <AccessLink to={`/costing/costing/${costingId}`} className="btn-surface inline-flex h-9 items-center rounded-lg px-3 text-[13px] no-underline">
                {tr("Open Costing")}
              </AccessLink>
            ) : null}
            {r.dossier_id ? (
              <AccessLink to={`/operations/files/${String(r.dossier_id)}`} className="btn-surface inline-flex h-9 items-center rounded-lg px-3 text-[13px] no-underline">
                {tr("Open File")}
              </AccessLink>
            ) : null}
            {!settled && can("edit") ? (
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                {tr("Edit")}
              </Button>
            ) : null}
          </div>

          {error ? <ErrorState message={error} /> : null}

          <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            {r.title ? <Fact label={tr("Title")}>{cell(r.title)}</Fact> : null}
            <Fact label={tr("Service")}>{service || "—"}</Fact>
            <Fact label={tr("Incoterm")}>{r.incoterm ? incotermLabel(String(r.incoterm)) : "—"}</Fact>
            <Fact label={tr("Route")}>{route || "—"}</Fact>
            <Fact label={tr("Cargo")}>{cell(r.cargo_description)}</Fact>
            <Fact label={tr("Weight")}>{r.estimated_weight != null ? `${cell(r.estimated_weight)} kg` : "—"}</Fact>
            <Fact label={tr("Estimated Value")}>{value}</Fact>
            <Fact label={tr("Channel")}>{channelLabel(String(r.intake_channel || ""))}</Fact>
            <Fact label={tr("Reference")}>{cell(r.public_ref)}</Fact>
            <Fact label={tr("Received")}>{dateFmt(r.created_at)}</Fact>
          </dl>

          <AttachmentsPanel requestId={r.quote_request_id} />
        </div>
      )}

      <LostDialog
        open={lostOpen}
        label={ref}
        onClose={() => setLostOpen(false)}
        onLost={async (code, reason) => {
          if (!r) return;
          await moveStage(r.quote_request_id, { stage: "LOST", lost_reason_code: code, ...(reason ? { lost_reason: reason } : {}) });
          changed();
        }}
      />
      <QuoteRequestForm
        open={editing}
        editing={r}
        onClose={() => setEditing(false)}
        onSaved={() => changed()}
      />
      {confirmDialog}
    </Dialog>
  );
}
