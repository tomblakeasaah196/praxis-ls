import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { getLang } from "@/lib/i18n";
import { pickText, type ServiceCard } from "@/lib/services-api";
import "@/components/quote/quote-steps-i18n";

/**
 * The quote wizard's first question when the tenant offers WEBSITE SERVICES
 * (SmartLS website v2, PR 3): which service, by the name the website gives it
 * ("Sea Freight", "Hinterland Transit"), never by the ERP's internal split into
 * import, export and end to end. The engine on the next step decides that.
 *
 * Grouped by the families the services page uses, so the visitor reads the same
 * map in both places. Each choice is a radio inside a label: keyboard and
 * screen-reader complete with no script of its own.
 */
export function WebsiteServiceStep({
  groups,
  value,
  onChange,
  error,
  idPrefix = "quote",
}: {
  groups: { key: string | null; name_en: string | null; name_fr: string | null; services: ServiceCard[] }[];
  value: string;
  onChange: (websiteServiceId: string) => void;
  error?: string;
  idPrefix?: string;
}) {
  const { t } = useTranslation();
  const lang = getLang();
  return (
    <fieldset>
      <legend className="field-label">{t("site.quote.service")}</legend>
      <div className="mt-2 space-y-5">
        {groups.map((g, gi) => {
          const label = lang === "fr" ? g.name_fr || g.name_en : g.name_en || g.name_fr;
          return (
            <div key={g.key || `group-${gi}`}>
              {label ? (
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2">
                {g.services.map((s) => {
                  const checked = value === s.service_type_id;
                  return (
                    <label
                      key={s.service_type_id}
                      className={cn(
                        "flex min-h-[44px] cursor-pointer flex-col justify-center rounded-[calc(var(--radius)-2px)] border px-3.5 py-2 text-sm",
                        "hover:border-[rgb(var(--ink)/0.25)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[rgb(var(--brand-orange))]",
                        checked && "border-[rgb(var(--brand-orange))] bg-[rgb(var(--brand-orange)/0.06)] shadow-[var(--pick-ring)]",
                      )}
                    >
                      <input
                        type="radio"
                        name={`${idPrefix}-website-service`}
                        checked={checked}
                        onChange={() => onChange(s.service_type_id)}
                        className="sr-only"
                      />
                      <span className={cn(checked && "font-semibold")}>{pickText(s, "name", lang)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-[rgb(var(--bad))]">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
