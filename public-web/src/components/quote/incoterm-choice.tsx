import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { getLang } from "@/lib/i18n";
import type { QuoteService } from "@/lib/quote-scope";

/**
 * The delivery term, as the chosen service offers it (meeting 6, PR 2, owner
 * decision Q3) — shared by both quote wizards.
 *
 * The terms are the SERVICE's own list (`service_type.incoterms`, pre-filled
 * from the ICC 2020 rules: a sea service all eleven, an air, road or rail
 * service the seven any-mode terms), so FOB is never offered on an air waybill.
 * "Not sure" is always there and is the default: a client who does not know
 * the term is giving the desk a real answer, stored as "to be determined".
 * Each chip shows the code and, under it, the term's name in the reader's
 * language — a code alone is a guess for most people asking for a price.
 */
export function IncotermChoice({
  service,
  value,
  onChange,
  variant,
  idPrefix = "quote",
}: {
  service: QuoteService | null;
  /** The code, or "" for "Not sure". */
  value: string;
  onChange: (code: string) => void;
  variant: "site" | "portal";
  idPrefix?: string;
}) {
  const { t } = useTranslation();
  const lang = getLang();
  const terms = service ? service.incoterms : [];
  if (!terms.length) return null;

  const chip = (code: string, label: string, sub: string | null) => {
    const checked = value === code;
    return (
      <label
        key={code || "not-sure"}
        className={cn(
          "cursor-pointer",
          variant === "portal"
            ? "pt-chip pt-chip-radio !h-auto !min-h-[44px] flex-col !items-start !gap-0 !px-3.5 py-1.5"
            : cn(
                "inline-flex min-h-[44px] flex-col items-start justify-center rounded-[calc(var(--radius)-2px)] border px-3.5 py-1.5 text-sm",
                "hover:border-[rgb(var(--ink)/0.25)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[rgb(var(--brand-orange))]",
                checked && "border-[rgb(var(--brand-orange))] bg-[rgb(var(--brand-orange)/0.06)] shadow-[var(--pick-ring)]",
              ),
        )}
      >
        <input type="radio" name={`${idPrefix}-incoterm`} checked={checked} onChange={() => onChange(code)} className="sr-only" />
        <span className={cn(code && "font-mono", checked && "font-semibold")}>{label}</span>
        {sub ? <span className="text-[0.7rem] leading-tight text-muted-foreground">{sub}</span> : null}
      </label>
    );
  };

  return (
    <fieldset>
      <legend className={variant === "site" ? "field-label" : "pt-label"}>{t("site.quote.incoterm")}</legend>
      <p className="mb-2 text-sm text-muted-foreground">{t("site.quote.incotermHint")}</p>
      <div className="flex flex-wrap gap-2">
        {terms.map((i) => chip(i.code, i.code, lang === "fr" ? i.name_fr : i.name_en))}
        {chip("", t("site.quote.incotermNotSure"), null)}
      </div>
    </fieldset>
  );
}
