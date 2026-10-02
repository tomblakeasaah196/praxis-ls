/**
 * The two figures of a VAT-inclusive rate, as one line (meeting 6, F4):
 * "72 700 TTC = 60 964 HT at 19,25 %".
 *
 * Shown at the currency's own minor units (XAF has none), from the stored
 * figures — the HT is not re-derived here, so the line says exactly what was
 * saved. The dialog's preview passes the HT it computed with the shared
 * `expenseRate.htFromTtc`, the same function the API stores with.
 */
import { currencies } from "@shared";
import { currentLocale, tv } from "./i18n";

function figure(n: number, currency: string | null | undefined): string {
  const d = currencies.decimalsFor(String(currency || "XAF"));
  return n.toLocaleString(currentLocale(), {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

export function vatBasisLine(
  ttc: number | string | null | undefined,
  ht: number | string | null | undefined,
  ratePercent: number | string | null | undefined,
  currency?: string | null,
): string | null {
  const t = Number(ttc);
  const h = Number(ht);
  const r = Number(ratePercent);
  if (ttc === null || ttc === undefined || ht === null || ht === undefined) return null;
  if (!Number.isFinite(t) || !Number.isFinite(h) || !Number.isFinite(r)) return null;
  return tv("{{ttc}} TTC = {{ht}} HT at {{rate}} %", {
    ttc: figure(t, currency),
    ht: figure(h, currency),
    rate: r.toLocaleString(currentLocale(), { maximumFractionDigits: 4 }),
  });
}
