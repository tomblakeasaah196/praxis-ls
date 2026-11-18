/**
 * The quotation's price lines, on the editor page (lean revamp §3.4 "Left: the
 * price lines").
 *
 * Today's engine, moved out of the old modal unchanged in what it does:
 * dictionary items, débours (never taxed), a tax code per line, the families a
 * line prints under, the target-margin warning, and Import From Costing. VAT is
 * computed by the server from each line's tax code; the totals shown here are
 * the HT sum as typed and refresh from the server on save.
 *
 * Controlled: the page owns the lines and saves them, so the preview and the
 * Send button both know when what is on screen is not yet what is stored.
 */
import * as React from "react";
import { tr, tv } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/modal";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { Segmented } from "@/components/ui/segmented";
import { SearchSelect } from "@/components/ui/search-select";
import { ErrorState, LoadingRow } from "@/components/ui/states";
import { ClientFamilies, FamilyBulkBar, FamilyPicker } from "@/components/client-families";
import { customFamilies, moveLines, useFamilyRegistry, useLineSelection, useNewFamily } from "@/lib/client-families-state";
import { listSalesTaxCodes, type TaxCode } from "@/lib/masterdata-api";
import { dictLabel } from "@/lib/dict-label";
import { cell, money } from "@/lib/format";
import { errMsg, useResource } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";
import { quotationFromCostingPreview, type FromCostingPreview } from "@/lib/quotation-api";
import { blankLine, qLineTotal, type QLine } from "./quotation-model";

const taxCodeLabel = (c: TaxCode) => `${c.code}${c.rate_percent != null ? ` · ${c.rate_percent}%` : ""}`;

/** The tenant's target margin (Settings › Commercial); 0 % when unset, as the server reads it. */
async function readTargetMargin(): Promise<number> {
  try {
    const row = await tenant<{ value: { target_margin_percent?: number } }>("/settings/commercial/quotation");
    const m = Number(row?.value?.target_margin_percent);
    return Number.isFinite(m) ? m : 0;
  } catch (e) {
    // A tenant provisioned before 14381 has no row yet: 0 %, as the server reads it.
    if ((e as { status?: number }).status === 404) return 0;
    throw e;
  }
}

/**
 * The target-margin warning (§3.4 "A margin under target stays a warning, as
 * today"): the margin this quotation was priced at, against the tenant's
 * target, and, for one priced from a costing, whether the services cover what
 * the file costs us.
 */
export function MarginWarning({ marginPercent, ownCostTotal, servicesTotal, currency }: { marginPercent: number | null; ownCostTotal: number | null; servicesTotal: number; currency: string }) {
  const target = useResource(readTargetMargin, []);
  const t = target.data ?? 0;
  const under = marginPercent !== null && t > 0 && marginPercent < t;
  const short = ownCostTotal !== null && ownCostTotal > 0 && servicesTotal < ownCostTotal;
  if (!under && !short) return null;
  return (
    <div className="space-y-2">
      {under ? (
        <Callout tone="warn" title={tr("Margin under target.")}>
          {tv("Priced at {{margin}} % against a target of {{target}} %.", { margin: marginPercent ?? 0, target: t })}
        </Callout>
      ) : null}
      {short ? (
        <Callout tone="warn" title={tr("The services do not cover our own costs.")}>
          {tv("They bill {{services}} against {{own}} of own costs.", { services: money(servicesTotal, currency), own: money(ownCostTotal, currency) })}
        </Callout>
      ) : null}
    </div>
  );
}

export function LinesEditor({
  lines,
  onChange,
  currency,
  readOnly,
  familyOrder,
  onFamilyOrder,
}: {
  lines: QLine[];
  onChange: (next: QLine[] | ((prev: QLine[]) => QLine[])) => void;
  currency: string;
  readOnly: boolean;
  familyOrder: string[] | null;
  onFamilyOrder: (order: string[] | null) => void;
}) {
  const [lineView, setLineView] = React.useState<"lines" | "families">("lines");
  const selection = useLineSelection(lines.length);
  const registry = useFamilyRegistry();
  const [askFamily, askFamilyDialog] = useNewFamily();
  const [taxCodes, setTaxCodes] = React.useState<TaxCode[]>([]);
  const [taxCodesDegraded, setTaxCodesDegraded] = React.useState(false);

  React.useEffect(() => {
    if (readOnly) return;
    let live = true;
    listSalesTaxCodes()
      .then((r) => {
        if (!live) return;
        setTaxCodes(r.codes);
        setTaxCodesDegraded(r.degraded);
      })
      .catch(() => {
        // Degraded read (class E): the note under the lines says the picker is partial.
        if (!live) return;
        setTaxCodes([]);
        setTaxCodesDegraded(true);
      });
    return () => {
      live = false;
    };
  }, [readOnly]);

  const setLine = (i: number, patch: Partial<QLine>) => onChange((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const total = lines.reduce((a, l) => a + qLineTotal(l), 0);
  const ccy = currency || "XAF";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label={tr("Line view")}
          value={lineView}
          onChange={(v) => setLineView(v as "lines" | "families")}
          options={[
            { value: "lines", label: tr("Line Items") },
            { value: "families", label: tr("By Family") },
          ]}
        />
        {!readOnly && lineView === "lines" ? (
          <Button size="sm" variant="ghost" onClick={() => onChange((l) => [...l, blankLine()])}>
            {tr("Add Line")}
          </Button>
        ) : null}
      </div>
      {askFamilyDialog}
      {lineView === "families" ? (
        <ClientFamilies
          lines={lines.map((l) => ({ ...l, qty: Number(l.qty) || 0, amount: qLineTotal(l) }))}
          currency={ccy}
          readOnly={readOnly}
          selection={readOnly ? undefined : selection}
          order={familyOrder}
          onOrder={readOnly ? undefined : onFamilyOrder}
          onHeading={(index, heading) => onChange((rs) => moveLines(rs, [index], heading))}
          onHeadingMany={(indices, heading) => onChange((rs) => moveLines(rs, indices, heading))}
        />
      ) : null}
      {lineView === "lines" && !readOnly ? (
        <FamilyBulkBar
          count={selection.selected.size}
          registry={registry}
          customs={customFamilies(lines, registry)}
          onNew={askFamily}
          onClear={selection.clear}
          onMove={(heading) => {
            onChange((rs) => moveLines(rs, selection.selected, heading));
            selection.clear();
          }}
        />
      ) : null}
      {lineView === "lines" && readOnly ? (
        <div className="rounded-lg border">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>{tr("Item")}</span>
            <span className="w-12 text-right">{tr("Qty")}</span>
            <span className="w-24 text-right">{tr("Unit")}</span>
            <span className="w-28 text-right">{tr("Total")}</span>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-1.5 text-sm">
              <span>
                {cell(l.label)}
                {l.is_disbursement ? <span className="ml-1 text-xs text-muted-foreground">({tr("débours")})</span> : null}
              </span>
              <span className="num w-12 text-right">{cell(l.qty)}</span>
              <span className="num w-24 text-right">{money(l.unit_price, ccy)}</span>
              <span className="num w-28 text-right">{money(qLineTotal(l), ccy)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {lineView === "lines" && !readOnly
        ? lines.map((l, i) => (
            <div key={i} className="rounded-lg border border-border/60 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <Checkbox
                  checked={selection.selected.has(i)}
                  onCheckedChange={() => selection.toggle(i)}
                  label={<span className="sr-only">{`${tr("Tick")} ${l.label || tr("line")} ${i + 1}`}</span>}
                />
                <div className="min-w-[10rem] flex-1">
                  <SearchSelect
                    path="/financial-dictionary"
                    value={l.label || null}
                    placeholder={tr("Pick from the dictionary or type a description")}
                    getLabel={(r) => `${cell(r.code)} · ${cell(r.label_fr ?? r.label_en)}`}
                    getKey={(r) => String(r.dictionary_item_id)}
                    onSelect={(r) =>
                      setLine(i, {
                        dictionary_item_id: String(r.dictionary_item_id),
                        label: dictLabel({
                          label_en: r.label_en == null ? null : String(r.label_en),
                          label_fr: r.label_fr == null ? null : String(r.label_fr),
                          code: r.code == null ? null : String(r.code),
                        }),
                        client_heading: null,
                        client_heading_code: r.client_heading_code == null ? null : String(r.client_heading_code),
                        client_heading_fr: r.client_heading_fr == null ? null : String(r.client_heading_fr),
                        client_heading_en: r.client_heading_en == null ? null : String(r.client_heading_en),
                        unit_price: r.default_price != null ? String(r.default_price) : l.unit_price,
                        is_disbursement: r.is_disbursement === true,
                      })
                    }
                    allowFreeText
                    onFreeText={(t) => setLine(i, { label: t, dictionary_item_id: null })}
                  />
                </div>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  aria-label={tr("Quantity")}
                  className="num w-16 text-right"
                  value={l.qty}
                  onChange={(e) => setLine(i, { qty: e.target.value })}
                />
                <Input
                  type="number"
                  min="0"
                  step="1"
                  aria-label={tr("Unit Price")}
                  className="num w-28 text-right"
                  value={l.unit_price}
                  onChange={(e) => setLine(i, { unit_price: e.target.value })}
                />
                <span className="num w-28 text-right text-sm text-muted-foreground">{money(qLineTotal(l), ccy)}</span>
                <Button size="sm" variant="ghost" aria-label={`${tr("Remove line")} ${i + 1}`} onClick={() => onChange((rs) => rs.filter((_, idx) => idx !== i))}>
                  ✕
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 pl-1">
                <Checkbox
                  checked={l.is_disbursement}
                  onCheckedChange={(v) => setLine(i, { is_disbursement: v, tax_code_id: v ? null : l.tax_code_id })}
                  label={<span className="text-xs text-muted-foreground">{tr("Débours")}</span>}
                />
                <div className="flex min-w-[14rem] items-center gap-1">
                  <span className="text-xs text-muted-foreground">{tr("Family")}</span>
                  <FamilyPicker
                    line={l}
                    index={i}
                    registry={registry}
                    customs={customFamilies(lines, registry)}
                    onNew={askFamily}
                    onPick={(heading) => setLine(i, { client_heading: heading })}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">{tr("Tax")}</span>
                  <Select
                    value={l.tax_code_id ?? ""}
                    disabled={l.is_disbursement}
                    aria-label={`${tr("Tax code")} ${i + 1}`}
                    onChange={(e) => setLine(i, { tax_code_id: e.target.value || null })}
                    className="h-8 py-0 text-xs"
                  >
                    <option value="">{l.is_disbursement ? tr("Untaxed") : tr("No VAT")}</option>
                    {taxCodes.map((c) => (
                      <option key={c.tax_code_id} value={c.tax_code_id}>
                        {taxCodeLabel(c)}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            </div>
          ))
        : null}
      {taxCodesDegraded && !readOnly ? (
        <p className="text-right text-xs text-warn-ink">{tr("Some VAT codes could not load; the picker is partial.")}</p>
      ) : null}
      <div className="flex justify-end text-sm font-semibold">
        <span>
          {tr("Total (HT)")}: <span className="num">{money(total, ccy)}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * Import From Costing (§3.4): a validated or approved costing, priced on the
 * server with the margin simulator's rules exactly as the costing sheet's
 * Create Quotation does, replaces the lines. Nothing is written until the
 * page saves them.
 */
export function ImportCostingDialog({
  open,
  onClose,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (p: FromCostingPreview) => void;
}) {
  const [costingId, setCostingId] = React.useState<string | null>(null);
  const [label, setLabel] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<FromCostingPreview | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setCostingId(null);
    setLabel(null);
    setPreview(null);
    setError(null);
  }, [open]);

  React.useEffect(() => {
    if (!costingId) return;
    let live = true;
    setBusy(true);
    setPreview(null);
    setError(null);
    quotationFromCostingPreview(costingId)
      .then((p) => live && setPreview(p))
      .catch((e) => live && setError(errMsg(e)))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [costingId]);

  const ccy = preview?.costing.currency || "XAF";
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tr("Import From Costing")}
      description={tr("The costing is priced with the margin simulator's rules and its lines replace the ones on this quotation.")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button disabled={!preview} onClick={() => preview && onImport(preview)}>
            {tr("Replace Lines")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={tr("Costing")}>
          <SearchSelect
            path="/costings"
            value={label}
            placeholder={tr("Search costings")}
            getLabel={(r) => [cell(r.doc_number), cell(r.client_name ?? r.dossier_ref)].filter((x) => x !== "—").join(" · ")}
            getKey={(r) => String(r.costing_id)}
            onSelect={(r) => {
              setCostingId(String(r.costing_id));
              setLabel(String(r.doc_number || r.costing_id));
            }}
          />
        </Field>
        {busy ? <LoadingRow label={tr("Pricing the costing…")} /> : null}
        {error ? <ErrorState message={error} /> : null}
        {preview ? (
          <div className="rounded-lg border p-3 text-sm">
            <p>
              {tv("{{count}} lines at a {{margin}} % margin.", { count: preview.lines.length, margin: preview.target_margin_percent })}
            </p>
            <p className="num font-semibold">
              {tr("Total (HT)")}: {money(preview.totals.total_ht, ccy)}
            </p>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
