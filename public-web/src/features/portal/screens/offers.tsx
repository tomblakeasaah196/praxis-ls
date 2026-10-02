/**
 * Quotations — every offer the team sent this client (tenant review, meeting
 * 6, PR 4 — item 4.1, owner decision G3).
 *
 * The portal used to show Sales PROPOSALS only, behind a tab of the quotes
 * page that appeared once one existed; the Commercial QUOTATIONS the team
 * prepares — including those priced from a request that came in by email —
 * never reached the client. This is the menu's "Quotations" line: both kinds,
 * as CARDS that say at a glance which offer is which (number, service, route,
 * total and currency, valid-until, status, the request it answers), newest
 * and waiting-for-you first, with All / Quotations / Proposals tabs.
 *
 * A quotation opens its own full page (quotation.tsx) and Back returns here;
 * a proposal opens the proposal sheet it always opened. Deep links:
 * `?proposal=<id>` (the proposal email and Home), `?tab=quotations|proposals`.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { portalQuotations, portalProposals, type QuotationCard, type ProposalSummary } from "@/lib/portal-api";
import { money, dateFmt } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { usePageChrome, PageHeader, useSummary } from "../shell/portal-shell";
import { Pill, IconDisc, SkeletonCards, EmptyState, ErrorCard, Seg, useLoad, type Tone } from "../ui/kit";
import { QuoteIcon, CheckCircleIcon, ChevronRightIcon, ArrowRightIcon } from "../ui/icons";
import { ProposalSheet } from "./proposals";
import { QuotesSwitch } from "./quotes-switch";

type Tab = "all" | "quotations" | "proposals";

export const OFFER_TONE: Record<string, Tone> = {
  SENT: "brand",
  ACCEPTED: "ok",
  CONVERTED: "ok",
  REJECTED: "mute",
  EXPIRED: "mute",
};

/** One list, both kinds: what a card needs, and how it sorts. */
type Offer =
  | { kind: "quotation"; id: string; waiting: boolean; at: string; q: QuotationCard }
  | { kind: "proposal"; id: string; waiting: boolean; at: string; p: ProposalSummary };

const today = () => new Date().toISOString().slice(0, 10);

export function QuotationsPage() {
  const { t } = useTranslation();
  usePageChrome(null);
  const lang = getLang();
  const summary = useSummary();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const quotes = useLoad(() => portalQuotations(lang), `quotations:${lang}`);
  const proposals = useLoad(portalProposals, "proposals");
  const [tab, setTab] = React.useState<Tab>(() => {
    const p = params.get("tab");
    return p === "quotations" || p === "proposals" ? p : "all";
  });
  const [proposal, setProposal] = React.useState<string | null>(null);

  // Deep links: "?proposal=<id>" opens it; "?tab=" picks the tab. Both are
  // arrivals, not locations, so they are dropped once read.
  React.useEffect(() => {
    let changed = false;
    const wanted = params.get("proposal");
    if (wanted) {
      setProposal(wanted);
      params.delete("proposal");
      changed = true;
    }
    if (params.get("tab")) {
      params.delete("tab");
      changed = true;
    }
    if (changed) setParams(params, { replace: true });
  }, [params, setParams]);

  const offers: Offer[] = React.useMemo(() => {
    const out: Offer[] = [
      ...(quotes.data || []).map((q) => ({ kind: "quotation" as const, id: q.quotation_id, waiting: q.waiting, at: q.sent_on, q })),
      ...(proposals.data || []).map((p) => ({
        kind: "proposal" as const,
        id: p.proposal_id,
        waiting: p.status === "SENT" && (!p.valid_until || p.valid_until >= today()),
        at: p.sent_on,
        p,
      })),
    ];
    return out.sort((a, b) => (a.waiting === b.waiting ? (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) : a.waiting ? -1 : 1));
  }, [quotes.data, proposals.data]);

  const shown = offers.filter((o) => tab === "all" || (tab === "quotations" ? o.kind === "quotation" : o.kind === "proposal"));
  const waitingQ = offers.filter((o) => o.kind === "quotation" && o.waiting).length;
  const waitingP = offers.filter((o) => o.kind === "proposal" && o.waiting).length;
  const loading = !quotes.data && !quotes.error && !proposals.data && !proposals.error;

  return (
    <div>
      <QuotesSwitch value="quotations" />
      <PageHeader title={t("portal.nav.quotations")} sub={t("portal.offer.sub")} />

      <div className="mb-4">
        <Seg<Tab>
          label={t("portal.nav.quotations")}
          value={tab}
          onChange={setTab}
          items={[
            { value: "all", label: t("portal.offer.tab.all"), count: waitingQ + waitingP },
            { value: "quotations", label: t("portal.offer.tab.quotations"), count: waitingQ },
            { value: "proposals", label: t("portal.offer.tab.proposals"), count: waitingP },
          ]}
        />
      </div>

      {/* One kind failing to load never hides the other. */}
      {quotes.error && !quotes.data ? <ErrorCard message={quotes.error} onRetry={quotes.reload} /> : null}
      {proposals.error && !proposals.data && tab !== "quotations" ? <ErrorCard message={proposals.error} onRetry={proposals.reload} /> : null}
      {loading ? <SkeletonCards count={3} /> : null}

      {!loading && shown.length === 0 && !(quotes.error && proposals.error) ? (
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
          {shown.map((o) =>
            o.kind === "quotation" ? (
              <QuotationCardView key={o.id} q={o.q} onOpen={() => navigate(`/portal/quotations/${encodeURIComponent(o.id)}`)} />
            ) : (
              <ProposalCardView key={o.id} p={o.p} waiting={o.waiting} onOpen={() => setProposal(o.id)} />
            ),
          )}
        </div>
      ) : null}

      <ProposalSheet
        id={proposal}
        onClose={() => setProposal(null)}
        onChanged={() => {
          proposals.reload();
          summary?.reload();
        }}
      />
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
          {q.waiting && q.valid_until ? <Pill plain>{t("portal.prop.validUntil", { date: dateFmt(q.valid_until) })}</Pill> : null}
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

function ProposalCardView({ p, waiting, onOpen }: { p: ProposalSummary; waiting: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const status = p.status === "SENT" && !waiting ? "EXPIRED" : p.status;
  const [from, to] = (p.route || "").split(" → ");
  return (
    <button type="button" className="pt-card pt-card-press flex w-full items-start gap-3 p-4 text-left" onClick={onOpen}>
      <IconDisc tone={OFFER_TONE[status] || "mute"}>{status === "ACCEPTED" ? <CheckCircleIcon /> : <QuoteIcon />}</IconDisc>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-[0.95rem] font-bold text-foreground">{p.title}</span>
          <span className="pt-num shrink-0 text-[0.95rem] font-bold text-foreground">{money(p.total, p.currency)}</span>
        </span>
        {p.route ? <Route from={from || null} to={to || null} /> : null}
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          <Pill tone={OFFER_TONE[status] || "mute"}>
            {status === "EXPIRED" ? t("portal.prop.expired") : t(`portal.prop.status.${status}`, { defaultValue: status })}
          </Pill>
          <Pill plain>{t("portal.prop.proposal")}</Pill>
          {p.doc_number ? (
            <Pill plain>
              <span className="pt-mono">{p.doc_number}</span>
            </Pill>
          ) : null}
          {waiting && p.valid_until ? <Pill plain>{t("portal.prop.validUntil", { date: dateFmt(p.valid_until) })}</Pill> : null}
        </span>
      </span>
      <ChevronRightIcon size={18} className="mt-3 shrink-0 text-muted-foreground" />
    </button>
  );
}
