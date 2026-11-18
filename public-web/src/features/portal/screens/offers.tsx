/**
 * Quotations: every offer the team sent this client (tenant review, meeting
 * 6, PR 4, item 4.1, owner decision G3; lean revamp §3.8).
 *
 * Since the lean revamp a quotation is the one priced document: every Sales
 * proposal became one (14542), so this lists quotations only, as CARDS that
 * say at a glance which offer is which (number, service, route, total and
 * currency, valid-until, status, the request it answers), waiting-for-you
 * first, then newest.
 *
 * A quotation opens its own full page (quotation.tsx) and Back returns here.
 * An old deep link (`?proposal=<id>` from a proposal email, `?tab=`) lands on
 * this list and the parameter is dropped: the offer it named is in it.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { portalQuotations, type QuotationCard } from "@/lib/portal-api";
import { money, dateFmt } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { usePageChrome, PageHeader } from "../shell/portal-shell";
import { Pill, IconDisc, SkeletonCards, EmptyState, ErrorCard, useLoad, type Tone } from "../ui/kit";
import { QuoteIcon, CheckCircleIcon, ChevronRightIcon, ArrowRightIcon } from "../ui/icons";
import { QuotesSwitch } from "./quotes-switch";

export const OFFER_TONE: Record<string, Tone> = {
  SENT: "brand",
  ACCEPTED: "ok",
  CONVERTED: "ok",
  REJECTED: "mute",
  EXPIRED: "mute",
};

export function QuotationsPage() {
  const { t } = useTranslation();
  usePageChrome(null);
  const lang = getLang();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const quotes = useLoad(() => portalQuotations(lang), `quotations:${lang}`);

  // Old arrivals ("?proposal=", "?tab=") are not locations: dropped once read.
  React.useEffect(() => {
    if (!params.has("proposal") && !params.has("tab")) return;
    params.delete("proposal");
    params.delete("tab");
    setParams(params, { replace: true });
  }, [params, setParams]);

  const shown = React.useMemo(
    () =>
      [...(quotes.data || [])].sort((a, b) =>
        a.waiting === b.waiting ? (a.sent_on < b.sent_on ? 1 : a.sent_on > b.sent_on ? -1 : 0) : a.waiting ? -1 : 1,
      ),
    [quotes.data],
  );
  const loading = !quotes.data && !quotes.error;

  return (
    <div>
      <QuotesSwitch value="quotations" />
      <PageHeader title={t("portal.nav.quotations")} sub={t("portal.offer.sub")} />

      {quotes.error && !quotes.data ? <ErrorCard message={quotes.error} onRetry={quotes.reload} /> : null}
      {loading ? <SkeletonCards count={3} /> : null}

      {quotes.data && shown.length === 0 ? (
        <div className="pt-card">
          <EmptyState
            icon={<QuoteIcon size={28} />}
            title={t("portal.offer.none")}
            hint={t("portal.offer.noneHint")}
            action={
              <button type="button" className="pt-btn pt-btn-soft" onClick={() => navigate("/portal/requests?new=1")}>
                {t("portal.quote.request")}
              </button>
            }
          />
        </div>
      ) : null}

      {shown.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {shown.map((q) => (
            <QuotationCardView key={q.quotation_id} q={q} onOpen={() => navigate(`/portal/quotations/${encodeURIComponent(q.quotation_id)}`)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** "Shanghai → Douala", or nothing. */
function Route({ from, to }: { from: string | null; to: string | null }) {
  if (!from && !to) return null;
  return (
    <span className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
      <span className="truncate">{from || "—"}</span>
      <ArrowRightIcon size={14} />
      <span className="truncate">{to || "—"}</span>
    </span>
  );
}

function QuotationCardView({ q, onOpen }: { q: QuotationCard; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="pt-card pt-card-press flex w-full items-start gap-3 p-4 text-left" onClick={onOpen}>
      <IconDisc tone={OFFER_TONE[q.status] || "mute"}>{q.status === "ACCEPTED" || q.status === "CONVERTED" ? <CheckCircleIcon /> : <QuoteIcon />}</IconDisc>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-[0.95rem] font-bold text-foreground">{q.service || t("portal.offer.quotation")}</span>
          <span className="pt-num shrink-0 text-[0.95rem] font-bold text-foreground">{money(q.total, q.currency)}</span>
        </span>
        {q.route ? <Route from={q.route.from} to={q.route.to} /> : null}
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          <Pill tone={OFFER_TONE[q.status] || "mute"}>{t(`portal.offer.status.${q.status}`, { defaultValue: q.status })}</Pill>
          <Pill plain>{t("portal.offer.quotation")}</Pill>
          {q.doc_number ? (
            <Pill plain>
              <span className="pt-mono">{q.doc_number}</span>
            </Pill>
          ) : null}
          {q.waiting && q.valid_until ? <Pill plain>{t("portal.answer.validUntil", { date: dateFmt(q.valid_until) })}</Pill> : null}
          {q.request?.public_ref ? (
            <Pill plain>
              {t("portal.offer.answers")} <span className="pt-mono">{q.request.public_ref}</span>
            </Pill>
          ) : null}
        </span>
      </span>
      <ChevronRightIcon size={18} className="mt-3 shrink-0 text-muted-foreground" />
    </button>
  );
}
