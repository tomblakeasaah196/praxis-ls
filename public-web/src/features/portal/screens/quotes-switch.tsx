/**
 * The phone's two-way switch between "Requests" and "Quotations" (tenant
 * review, meeting 6, PR 4 — auditor default).
 *
 * The phone's bottom bar keeps five slots; adding a sixth would shrink every
 * label below what a thumb can read. So Requests for Quotation and Quotations
 * share ONE "Quotes" slot there, and this switch sits at the top of both pages
 * to move between them. On a desk the sidebar has both lines and the switch is
 * not drawn. The Quotations side carries how many offers wait for an answer.
 */
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Seg } from "../ui/kit";
import { useSummary } from "../shell/portal-shell";

export type QuotesSide = "requests" | "quotations";

/** Offers waiting for this client's answer: quotations and proposals. */
export function useWaitingOffers(): number {
  const summary = useSummary();
  const s = summary?.data;
  return (s?.quotations?.pending_count || 0) + (s?.proposals?.pending_count || 0);
}

export function QuotesSwitch({ value }: { value: QuotesSide }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const waiting = useWaitingOffers();
  return (
    <div className="mb-4 lg:hidden">
      <Seg<QuotesSide>
        label={t("portal.nav.quotes")}
        value={value}
        onChange={(v) => navigate(v === "requests" ? "/portal/requests" : "/portal/quotations")}
        items={[
          { value: "requests", label: t("portal.offer.switchRequests") },
          { value: "quotations", label: t("portal.offer.switchQuotations"), count: waiting },
        ]}
      />
    </div>
  );
}
