/**
 * The two ways a person changes what a dictionary line costs.
 *
 *   SetRateModal          one series — the standard rate, or one carrier ×
 *                         container type cell. Used by Expense Rates AND by the
 *                         pencil on the Financial Dictionary overview, so the two
 *                         screens cannot drift into asking different questions
 *                         (meeting 5, 01:17:37 — "the same payload").
 *   ApplyToCarriersModal  one rate, written for every carrier of a kind at once,
 *                         with the exceptions unticked (meeting 5, 01:07:48 —
 *                         documentation fees are near-identical across lines).
 *
 * Both post to the rate endpoints, which are gated on Expense rates (MOD-10)
 * edit. A screen offers them only when the viewer holds that grant.
 *
 * VAT BASIS (meeting 6, F4). "Price includes VAT" is off by default. On, the
 * figure typed is TTC and the server stores TTC ÷ (1 + the line's VAT rate) as
 * the rate — the preview here uses the same shared division — so a costing
 * adds VAT once. It is not offered on a débours, which is always HT.
 *
 * CURRENCY. A rate is in the tenant's base currency unless someone says
 * otherwise (meeting 5, 01:11:19 — a currency on every line was noise). So the
 * base is shown as a fact, and another currency is one deliberate click away
 * rather than a free box that invites "CFA".
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { DateField } from "@/components/ui/date-field";
import { FormButtons } from "@/components/ui/form-buttons";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { CurrencySelect } from "@/components/currency-select";
import { useBaseCurrency } from "@/lib/use-base-currency";
import { errMsg, useResource } from "@/lib/use-resource";
import { vatBasisLine } from "@/lib/vat-basis";
import { expenseRate } from "@shared";
import { money, dateFmt, todayISO } from "@/lib/format";
import * as api from "@/lib/masterdata-api";

/**
 * The base currency as a statement, with "Other currency" behind a button.
 * `value === ""` means "the base currency"; the server fills it in, so a tenant
 * whose base is not XAF never gets XAF by accident.
 */
function RateCurrency({
  value,
  onChange,
}: {
  value: string;
  onChange: (code: string) => void;
}) {
  const base = useBaseCurrency();
  const [other, setOther] = React.useState(value !== "" && value !== base);
  if (!other)
    return (
      <div className="flex min-h-9 items-center justify-between gap-2">
        <span className="text-sm text-foreground">{base}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOther(true)}
        >
          {tr("Other currency")}
        </Button>
      </div>
    );
  return (
    <div className="flex items-center gap-2">
      <CurrencySelect
        value={value || base}
        onChange={onChange}
        allowEmpty={false}
        aria-label={tr("Currency")}
        className="flex-1"
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setOther(false);
          onChange("");
        }}
      >
        {tr("Use") + " " + base}
      </Button>
    </div>
  );
}

/**
 * "Price includes VAT" and what it will store, under the figure (F4).
 *
 * Nothing renders on a débours (always HT) — and on a line with no VAT rate
 * anywhere it says why the question is not asked rather than vanishing.
 */
function PriceIncludesVat({
  itemId,
  rate,
  currency,
  checked,
  onChange,
}: {
  itemId: string;
  rate: string;
  currency: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const basis = useResource(() => api.getVatBasis(itemId), [itemId]);
  const b = basis.data;
  // A débours (or a basis not yet known) never offers the question, and a
  // stale tick from an earlier answer is dropped rather than sent.
  React.useEffect(() => {
    if (checked && b && !b.offered) onChange(false);
  }, [b, checked, onChange]);
  if (!b || b.is_disbursement) return null;
  if (!b.offered)
    return (
      <p className="micro">
        {tr("No VAT rate is set up for this line, so the rate is entered HT.")}
      </p>
    );
  const ttc = Number(rate);
  const ht =
    checked && rate !== "" && Number.isFinite(ttc)
      ? expenseRate.htFromTtc(ttc, b.vat_rate_percent ?? 0)
      : null;
  return (
    <div className="space-y-1 sm:col-span-2">
      <Checkbox
        checked={checked}
        onCheckedChange={onChange}
        label={tr("Price includes VAT")}
      />
      {checked && (
        <p className="micro num" aria-live="polite">
          {ht !== null
            ? vatBasisLine(ttc, ht, b.vat_rate_percent, currency)
            : tr("Type the price including VAT; the HT figure is stored.")}
        </p>
      )}
    </div>
  );
}

export function SetRateModal({
  itemId,
  providerLabel,
  providerId,
  containerTypeId,
  containerTypeLabel,
  current,
  title,
  onClose,
  onSaved,
}: {
  itemId: string;
  providerLabel: string;
  providerId: string | null;
  containerTypeId: string | null;
  containerTypeLabel: string | null;
  current: api.RatePoint | null;
  /** Overrides the default "Set rate — <scope>" heading. */
  title?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const base = useBaseCurrency();
  // A VAT-inclusive series is re-entered the way it was typed: TTC, ticked.
  const wasTtc = current?.price_includes_vat === true && current.rate_ttc != null;
  const [rate, setRate] = React.useState(
    current ? String(wasTtc ? current.rate_ttc : current.rate) : "",
  );
  const [inclVat, setInclVat] = React.useState(wasTtc);
  // Keep a non-base currency the series already uses; otherwise the base.
  const [curr, setCurr] = React.useState(
    current?.currency && current.currency !== base ? current.currency : "",
  );
  const [from, setFrom] = React.useState(todayISO());
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.supersedeDictRate(itemId, {
        rate: Number(rate),
        currency: curr || undefined,
        effective_from: from,
        rate_provider_id: providerId,
        container_type_ref_id: containerTypeId,
        note: note || undefined,
        price_includes_vat: inclVat || undefined,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={
        title ||
        `Set rate: ${providerLabel}${containerTypeLabel ? " · " + containerTypeLabel : ""}`
      }
      description="Rates are superseded, never edited in place: the prior rate expires the day before this one opens, so history stays intact."
    >
      <form className="space-y-4" onSubmit={submit}>
        {current && (
          <Callout tone="info" title={tr("Current rate")}>
            {money(current.rate, current.currency || base)} since{" "}
            {dateFmt(current.effective_from)}
            {wasTtc && (
              <span className="block micro num">
                {vatBasisLine(
                  current.rate_ttc,
                  current.rate,
                  current.vat_rate_percent,
                  current.currency || base,
                )}
              </span>
            )}
          </Callout>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Rate")} required>
            <Input
              type="number"
              min="0"
              step="0.01"
              className="num text-right"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </Field>
          <Field label={tr("Currency")}>
            <RateCurrency value={curr} onChange={setCurr} />
          </Field>
          <PriceIncludesVat
            itemId={itemId}
            rate={rate}
            currency={curr || base}
            checked={inclVat}
            onChange={setInclVat}
          />
          <Field label={tr("Effective from")} required>
            <DateField value={from} onChange={setFrom} />
          </Field>
          <Field label={tr("Note")}>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={tr("Optional")}
            />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={rate === "" || !from || busy}
          onCancel={onClose}
          saveLabel="Save rate"
        />
      </form>
    </Modal>
  );
}

/**
 * "Apply to all" — the carriers of one tab, every one ticked, the person
 * unticks the exceptions. All or nothing on the server: if one carrier already
 * has a rate starting on or after the chosen day, NOTHING is saved and the
 * message names that carrier, because a tariff applied to four lines of six is
 * worse than a clear refusal.
 */
export function ApplyToCarriersModal({
  itemId,
  kindLabel,
  providers,
  containerTypes = [],
  onClose,
  onSaved,
}: {
  itemId: string;
  /** "sea carriers", "hauliers"… — says which list this is. */
  kindLabel: string;
  providers: api.RateProvider[];
  /** Non-empty when the item is priced per box: the rate is for ONE type. */
  containerTypes?: api.DictRef[];
  onClose: () => void;
  onSaved: (applied: number) => void;
}) {
  const [picked, setPicked] = React.useState<Set<string>>(
    () => new Set(providers.map((p) => p.rate_provider_id)),
  );
  const base = useBaseCurrency();
  const [rate, setRate] = React.useState("");
  const [curr, setCurr] = React.useState("");
  const [inclVat, setInclVat] = React.useState(false);
  const [from, setFrom] = React.useState(todayISO());
  const [note, setNote] = React.useState("");
  const [typeId, setTypeId] = React.useState(containerTypes[0]?.ref_id ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const perBox = containerTypes.length > 0;

  const all = picked.size === providers.length;
  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.applyDictRateToProviders(itemId, {
        rate: Number(rate),
        currency: curr || undefined,
        effective_from: from,
        container_type_ref_id: perBox ? typeId : null,
        rate_provider_ids: [...picked],
        note: note || undefined,
        price_includes_vat: inclVat || undefined,
      });
      onSaved(res.applied);
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Apply one rate to ${kindLabel}`}
      description="Every carrier below is ticked. Untick the ones that charge differently; each ticked carrier's current rate closes the day before this one starts."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          {perBox && (
            <Field label={tr("Container type")} required>
              <Select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                {containerTypes.map((ct) => (
                  <option key={ct.ref_id} value={ct.ref_id}>
                    {(ct.name_en || ct.name_fr) + " · " + ct.code}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={tr("Rate")} required>
            <Input
              type="number"
              min="0"
              step="0.01"
              className="num text-right"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </Field>
          <Field label={tr("Currency")}>
            <RateCurrency value={curr} onChange={setCurr} />
          </Field>
          <PriceIncludesVat
            itemId={itemId}
            rate={rate}
            currency={curr || base}
            checked={inclVat}
            onChange={setInclVat}
          />
          <Field label={tr("Effective from")} required>
            <DateField value={from} onChange={setFrom} />
          </Field>
          <Field label={tr("Note")}>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={tr("Optional")}
            />
          </Field>
        </div>

        <fieldset className="space-y-2">
          <legend className="sr-only">{tr("Carriers")}</legend>
          <div className="flex items-center justify-between gap-3 border-b pb-1">
            <Checkbox
              checked={all ? true : picked.size === 0 ? false : "indeterminate"}
              onCheckedChange={(on) =>
                setPicked(
                  on ? new Set(providers.map((p) => p.rate_provider_id)) : new Set(),
                )
              }
              label={<span className="text-sm font-semibold">{tr("All")}</span>}
            />
            <span className="micro">
              {picked.size}/{providers.length} {tr("selected")}
            </span>
          </div>
          <div className="max-h-[40vh] space-y-1 overflow-auto pr-1">
            {providers.map((p) => (
              <Checkbox
                key={p.rate_provider_id}
                checked={picked.has(p.rate_provider_id)}
                onCheckedChange={(on) => toggle(p.rate_provider_id, on)}
                label={
                  <span className="text-sm">
                    {p.name}
                    {p.carrier_code ? (
                      <span className="ml-1.5 micro">{p.carrier_code}</span>
                    ) : null}
                  </span>
                }
              />
            ))}
          </div>
        </fieldset>

        {error && <ErrorState message={error} />}
        <FormButtons
          busy={busy}
          disabled={rate === "" || !from || picked.size === 0 || (perBox && !typeId) || busy}
          onCancel={onClose}
          saveLabel={`Apply to ${picked.size} carrier${picked.size === 1 ? "" : "s"}`}
        />
      </form>
    </Modal>
  );
}
