/**
 * One commercial quotation, opened (tenant review, meeting 6, PR 4 — G3/G4).
 *
 * Everything the client needs to decide, on one page, then back to the list:
 *
 *   · the service, the route, the Incoterm, how long the price holds and the
 *     payment terms on their account;
 *   · the lines EXACTLY as the PDF prints them — the server groups them with
 *     the QUOTATION template's own `groupLines`, in the document's own family
 *     order, so the screen and the download cannot disagree — and HT / VAT /
 *     TTC under them;
 *   · Download PDF, Accept and sign, Decline (with a reason), and "Ask about
 *     this quotation", which opens the chat with the quotation as a chip the
 *     team sees in the Client inbox, linking to it.
 *
 * Accepting is the proposal's flow, sheet for sheet (proposals.tsx SignSheet
 * and DeclineSheet against this document's endpoints): an emailed code bound to
 * the document's hash, then a stamp or a drawn mark. The plain confirmed
 * "Accept" appears only where the tenant has not switched e-signature on.
 * Turning an accepted quotation into an invoice stays the team's decision.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  portalQuotation,
  portalQuotationPdf,
  portalQuotationAccept,
  portalQuotationDecline,
  portalQuotationSignStart,
  portalQuotationSignResend,
  portalQuotationSignComplete,
  type QuotationDetail,
} from "@/lib/portal-api";
import { getLang } from "@/lib/i18n";
import { money, dateFmt } from "@/lib/format";
import { cn } from "@/lib/cn";
import { usePageChrome, useOpenChat, useSummary } from "../shell/portal-shell";
import { IconDisc, Pill, ErrorCard, Shimmer, SkeletonCards, useLoad, useToast, errorText, Busy, ConfirmSheet } from "../ui/kit";
import { QuoteIcon, CheckCircleIcon, DownloadIcon, CheckIcon, ChatIcon, ChevronLeftIcon, ArrowRightIcon, CloseIcon } from "../ui/icons";
import { SignSheet, DeclineSheet, SignedCard, type OfferAnswerApi } from "./proposals";
import { OFFER_TONE } from "./offers";

const QUOTATION_ANSWER: OfferAnswerApi = {
  signStart: portalQuotationSignStart,
  signResend: portalQuotationSignResend,
  signComplete: portalQuotationSignComplete,
  decline: portalQuotationDecline,
};

export function QuotationPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const lang = getLang();
  const navigate = useNavigate();
  const openChat = useOpenChat();
  const summary = useSummary();
  const toast = useToast();
  const detail = useLoad(() => portalQuotation(id, lang), `quotation:${id}:${lang}`);
  const d = detail.data;
  const q = d?.quotation;
  usePageChrome(q?.doc_number || t("portal.offer.quotation"), "/portal/quotations");

  const [downloading, setDownloading] = React.useState(false);
  const [signing, setSigning] = React.useState(false);
  const [declining, setDeclining] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [accepting, setAccepting] = React.useState(false);

  const answered = () => {
    detail.reload();
    summary?.reload();
  };

  async function pdf() {
    if (!q) return;
    setDownloading(true);
    try {
      await portalQuotationPdf(id, `${q.doc_number || "quotation"}.pdf`, lang);
    } catch (e) {
      toast(errorText(e), "bad");
    } finally {
      setDownloading(false);
    }
  }

  async function acceptPlain() {
    setAccepting(true);
    try {
      await portalQuotationAccept(id);
      toast(t("portal.offer.accepted"));
      setConfirming(false);
      answered();
    } catch (e) {
      toast(errorText(e), "bad");
    } finally {
      setAccepting(false);
    }
  }

  const ask = () => openChat({ general: true, about: { kind: "quotation", id, label: q?.doc_number || null } });

  if (detail.error && !d) return <ErrorCard message={detail.error} onRetry={detail.reload} />;
  if (!d || !q)
    return (
      <div className="grid gap-4" aria-hidden="true">
        <Shimmer className="h-48 rounded-[28px]" />
        <SkeletonCards count={2} />
      </div>
    );

  const open = q.status === "SENT";
  const tone = OFFER_TONE[q.status] || "mute";

  return (
    <div className="grid gap-6 pb-6">
      {/* On a desk there is no top bar: Back is drawn here. */}
      <div className="hidden lg:block">
        <button type="button" className="pt-btn pt-btn-ghost pt-btn-sm -ml-2" onClick={() => navigate("/portal/quotations")}>
          <ChevronLeftIcon size={18} />
          {t("portal.offer.back")}
        </button>
      </div>

      {/* ── the offer at a glance ── */}
      <section className="pt-card pt-hero-card p-5 sm:p-7">
        <div className="flex items-start gap-3">
          <IconDisc tone={tone} size={48}>
            {q.status === "ACCEPTED" || q.status === "CONVERTED" ? <CheckCircleIcon size={24} /> : <QuoteIcon size={24} />}
          </IconDisc>
          <div className="min-w-0 flex-1">
            <h1 className="pt-mono truncate text-[1.2rem] font-bold text-foreground sm:text-[1.5rem]">{q.doc_number || t("portal.offer.quotation")}</h1>
            <p className="truncate text-sm text-muted-foreground">{q.service || t("portal.offer.quotation")}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <Pill tone={tone}>{t(`portal.offer.status.${q.status}`, { defaultValue: q.status })}</Pill>
          {open && q.valid_until ? <Pill plain>{t("portal.prop.validUntil", { date: dateFmt(q.valid_until) })}</Pill> : null}
          {q.request?.public_ref ? (
            <Pill plain>
              {t("portal.offer.answers")} <span className="pt-mono">{q.request.public_ref}</span>
            </Pill>
          ) : null}
        </div>
        <p className="mt-4 text-sm font-semibold text-muted-foreground">{t("portal.offer.ttc")}</p>
        <p className="pt-display pt-num text-[2.2rem]">{money(q.totals.ttc, q.currency)}</p>
        {q.route ? (
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-sm font-semibold text-foreground">
            <span className="truncate">{q.route.from || "—"}</span>
            <ArrowRightIcon size={16} className="shrink-0 text-muted-foreground" />
            <span className="truncate">{q.route.to || "—"}</span>
          </p>
        ) : null}
        {d.signature ? <SignedCard sig={d.signature} /> : null}
        {q.status === "REJECTED" ? (
          <div className="mt-5 flex items-start gap-3 rounded-[18px] border border-[var(--pt-line)] p-4">
            <IconDisc tone="mute" size={40}>
              <CloseIcon size={20} />
            </IconDisc>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-foreground">{t("portal.offer.declinedTitle")}</p>
              {q.decline_reason ? <p className="text-sm text-muted-foreground">{q.decline_reason}</p> : null}
            </div>
          </div>
        ) : null}
      </section>

      {/* ── the answers ── */}
      <div className={cn("grid gap-2", open ? "grid-cols-[auto_1fr] sm:grid-cols-[auto_auto_1fr]" : "sm:grid-cols-2")}>
        {open ? (
          <button type="button" className="pt-btn pt-btn-ghost" onClick={() => setDeclining(true)}>
            {t("portal.prop.decline")}
          </button>
        ) : null}
        <button type="button" className={cn("pt-btn pt-btn-outline", open && "max-sm:order-last max-sm:col-span-2")} onClick={() => void pdf()} disabled={downloading}>
          <Busy busy={downloading}>
            <DownloadIcon size={20} />
          </Busy>
          {t("portal.offer.download")}
        </button>
        {open ? (
          <button type="button" className="pt-btn pt-btn-primary" onClick={() => (d.signing.available ? setSigning(true) : setConfirming(true))}>
            <CheckIcon size={20} />
            {d.signing.available ? t("portal.prop.acceptSign") : t("portal.prop.accept")}
          </button>
        ) : (
          <button type="button" className="pt-btn pt-btn-soft" onClick={ask}>
            <ChatIcon size={20} />
            {t("portal.offer.ask")}
          </button>
        )}
      </div>

      {/* ── every detail ── */}
      <section className="pt-card p-5 sm:p-6">
        <p className="pt-section-title">{t("portal.offer.details")}</p>
        <dl className="pt-rows mt-2">
          <Fact label={t("portal.offer.service")} value={q.service} />
          <Fact label={t("portal.offer.route")} value={q.route ? `${q.route.from || "—"} → ${q.route.to || "—"}` : null} />
          <Fact label={t("portal.offer.incoterm")} value={q.incoterm} mono />
          <Fact label={t("portal.offer.validUntil")} value={q.valid_until ? dateFmt(q.valid_until) : null} />
          <Fact
            label={t("portal.offer.paymentTerms")}
            value={q.payment_terms_days === null ? null : q.payment_terms_days === 0 ? t("portal.offer.onReceipt") : t("portal.offer.daysAfterInvoice", { days: q.payment_terms_days })}
          />
          <Fact label={t("portal.offer.request")} value={q.request?.public_ref || null} mono />
          <Fact label={t("portal.offer.file")} value={q.dossier_ref} mono />
        </dl>
      </section>

      {/* ── the price, as the PDF prints it ── */}
      <section className="pt-card p-5 sm:p-6">
        <p className="pt-section-title">{t("portal.offer.pricing")}</p>
        {q.lines.length ? (
          <ul className="pt-rows mt-2">
            {q.lines.map((l, i) => (
              <Line key={`${l.label}:${i}`} line={l} currency={q.currency} />
            ))}
          </ul>
        ) : null}
        <dl className="mt-3 grid gap-1 rounded-[16px] bg-[var(--pt-soft)] p-4">
          <Total label={t("portal.offer.ht")} value={money(q.totals.ht, q.currency)} />
          <Total label={t("portal.offer.vat")} value={money(q.totals.vat, q.currency)} />
          <Total label={t("portal.offer.ttc")} value={money(q.totals.ttc, q.currency)} strong />
        </dl>
      </section>

      {open ? (
        <button type="button" className="pt-btn pt-btn-soft pt-btn-block" onClick={ask}>
          <ChatIcon size={20} />
          {t("portal.offer.ask")}
        </button>
      ) : null}

      <SignSheet
        open={signing}
        api={QUOTATION_ANSWER}
        id={id}
        cards={d.signing.cards}
        title={q.doc_number || q.service || t("portal.offer.quotation")}
        agree={t("portal.offer.signAgree")}
        onClose={() => setSigning(false)}
        onDone={() => {
          setSigning(false);
          toast(t("portal.offer.accepted"));
          answered();
        }}
      />
      <DeclineSheet
        open={declining}
        api={QUOTATION_ANSWER}
        id={id}
        reasons={d.decline_reasons}
        sendLabel={t("portal.offer.declineSend")}
        onClose={() => setDeclining(false)}
        onDone={() => {
          setDeclining(false);
          toast(t("portal.offer.declined"));
          answered();
        }}
      />
      <ConfirmSheet
        open={confirming}
        title={t("portal.offer.acceptTitle")}
        body={t("portal.prop.acceptBody")}
        confirmLabel={t("portal.prop.accept")}
        busy={accepting}
        onConfirm={() => void acceptPlain()}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={cn("text-right text-sm font-semibold text-foreground", mono && "pt-mono")}>{value}</dd>
    </div>
  );
}

/** One printed line: a family's total, or a line the family leaves alone. */
function Line({ line, currency }: { line: QuotationDetail["quotation"]["lines"][number]; currency: string }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-start justify-between gap-4 py-2.5">
      <span className="min-w-0 text-sm text-foreground">
        {line.label}
        {line.is_disbursement ? (
          <span className="ml-2 align-middle">
            <Pill plain>{t("portal.offer.atCost")}</Pill>
          </span>
        ) : null}
      </span>
      <span className="pt-num shrink-0 text-sm font-semibold text-foreground">{money(line.amount, currency)}</span>
    </li>
  );
}

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-4", strong ? "pt-1 text-base font-bold text-foreground" : "text-sm text-muted-foreground")}>
      <dt>{label}</dt>
      <dd className="pt-num">{value}</dd>
    </div>
  );
}
