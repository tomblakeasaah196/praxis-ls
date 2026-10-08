/**
 * Settings › Commercial — the target margin a quotation priced from a costing
 * applies to its services (tenant review, meeting 6, PR 4, owner decision G1).
 *
 * "Create quotation" on a costing prices it in one click with the margin
 * simulator's rules: débours at cost, our own costs not billed, and SERVICES at
 * this margin — margin on the price, the simulator's definition (a service
 * costing 80 at 20 % is quoted 100).
 *
 * It starts at 0 % (14381): the auditor's default, so nothing is invented, and
 * every quotation shows the margin it was priced at. The form refuses exactly
 * what the API refuses — `@praxis/shared` quotation.commercialSettings.
 */
import * as React from "react";
import { quotation as shared } from "@shared";
import { pageShell } from "@/lib/layout";
import { tr, tv } from "@/lib/i18n";
import { tenant } from "@/lib/api-client";
import { putSetting } from "@/lib/mail-api";
import { errMsg, useResource } from "@/lib/use-resource";
import { PageHeader } from "@/components/data-list";
import { HubCrumb } from "@/components/tabbed-hub";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/modal";
import { Callout } from "@/components/ui/callout";
import { ErrorState } from "@/components/ui/states";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";

type QuotationSettings = { target_margin_percent: number };

async function readSettings(): Promise<QuotationSettings> {
  try {
    const row = await tenant<{ value: Partial<QuotationSettings> }>("/settings/commercial/quotation");
    const m = Number(row?.value?.target_margin_percent);
    return { target_margin_percent: Number.isFinite(m) ? m : 0 };
  } catch (e) {
    // A tenant provisioned before 14381 has no row yet: 0 %, as the server reads it.
    if ((e as { status?: number }).status === 404) return { target_margin_percent: 0 };
    throw e;
  }
}

export function CommercialSettingsPage() {
  const toast = useToast();
  const res = useResource(readSettings, []);
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (res.data) setText(String(res.data.target_margin_percent));
  }, [res.data]);

  const parsed = shared.commercialSettings.safeParse({ target_margin_percent: text.trim() === "" ? NaN : Number(text.replace(",", ".")) });
  const problem = parsed.success ? null : parsed.error.issues[0]?.message || tr("Enter the margin as a number.");
  const example = parsed.success ? Math.round((80 / (1 - parsed.data.target_margin_percent / 100)) * 100) / 100 : null;

  async function save() {
    if (!parsed.success) return;
    setBusy(true);
    setError(null);
    try {
      await putSetting("commercial", "quotation", parsed.data);
      toast.success(tr("Target margin saved"));
      res.reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={pageShell.reading}>
      <PageHeader
        eyebrow={<HubCrumb area="Settings" to="/settings" />}
        title={tr("Commercial")}
        description={tr("How a quotation is priced when it is created straight from a costing.")}
      />
      {res.error ? <ErrorState message={res.error} /> : null}
      {!res.data && !res.error ? <PageSkeleton /> : null}
      {res.data ? (
        <Panel title={tr("Target Margin")}>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {tr(
                "Applied to our services when \"Create quotation\" is pressed on a costing. Débours are always billed at cost. Our own costs are never billed: they are the floor the services must cover.",
              )}
            </p>
            <Field label={tr("Margin on the Price (%)")} error={problem || undefined} hint={tr("From 0 to below 100. The quotation always shows the margin it was priced at.")}>
              <Input
                inputMode="decimal"
                className="num w-32 text-right"
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-invalid={problem ? true : undefined}
              />
            </Field>
            {example !== null ? (
              <Callout tone="info" title={tr("For example:")}>
                {tv("a service that costs 80 is quoted {{price}}.", { price: example })}
              </Callout>
            ) : null}
            {error ? <ErrorState message={error} /> : null}
            <div className="flex justify-end">
              <Button onClick={() => void save()} loading={busy} disabled={!parsed.success}>
                {tr("Save")}
              </Button>
            </div>
          </div>
        </Panel>
      ) : null}
    </section>
  );
}
