/**
 * One quote request, as its client reads it (tenant review, meeting 6, item
 * 2.9): what they asked for, the documents it carries, with "Add a document"
 * at any time (owner decision Q4), where it stands as a timeline, and the
 * quotation that answered it.
 *
 * A sheet on a phone and a wide panel on a desktop (`Sheet wide`). The owner,
 * the internal notes and who moved it stay with the team: the server sends
 * the stage and the day, nothing else.
 *
 * WHERE IT STANDS IS ITS STAGE (lean revamp §4.2), never the retiring
 * `status`, in the client's words: NEW "Received"; CONTACTED and MEETING
 * "Under review" (a meeting is the team's business, not a step the client
 * waits on); QUOTED "Quoted"; WON "Accepted"; LOST "Closed". Consecutive
 * stages that read the same are drawn once.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  portalAddQuoteDocument,
  portalDownloadQuoteDocument,
  portalQuoteRequest,
  type PortalQuoteDetail,
  type QuoteStage,
} from "@/lib/portal-api";
import { money, num } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import { serviceName } from "@/lib/quote-scope";
import { useQuoteDocuments } from "@/lib/use-quote-documents";
import { QuoteDocumentsStep } from "@/components/quote/quote-documents";
import { Sheet, Pill, SkeletonCards, ErrorCard, useLoad, useToast, errorText } from "../ui/kit";
import { ArrowRightIcon, ChevronRightIcon, DocIcon, DownloadIcon, QuoteIcon } from "../ui/icons";
import { dayLabel } from "../lib/when";
import { ModeIcon } from "./shipment-parts";
import type { Tone } from "../ui/kit";
// The shared quote steps' copy lives outside the entry dictionary; see
// quote-steps-i18n.ts. Imported for the side effect.
import "@/components/quote/quote-steps-i18n";

/** A request's stage as a colour: the list and the detail read the same. */
export const STAGE_TONE: Record<QuoteStage, Tone> = {
  NEW: "info",
  CONTACTED: "brand",
  MEETING: "brand",
  QUOTED: "ok",
  WON: "ok",
  LOST: "mute",
};

/** The dictionary key a stage reads as. An unknown value reads as Received. */
export const stageKey = (stage: string) => `portal.quote.stage.${stage in STAGE_TONE ? stage : "NEW"}`;

/** The timeline in the client's words: consecutive stages that read the same
 *  (CONTACTED then MEETING, both "Under review") are drawn once. */
export function stageSteps(timeline: PortalQuoteDetail["timeline"], say: (key: string) => string) {
  const out: { label: string; at: string }[] = [];
  for (const e of timeline) {
    const label = say(stageKey(e.stage));
    if (out.length && out[out.length - 1].label === label) continue;
    out.push({ label, at: e.at });
  }
  return out;
}

const DOCS_MAX = 10;
const DOC_MAX_BYTES = 10 * 1024 * 1024;

export function QuoteRequestSheet({
  id,
  onClose,
  onChanged,
  onOpenQuotation,
}: {
  id: string | null;
  onClose: () => void;
  onChanged: () => void;
  onOpenQuotation: (quotationId: string) => void;
}) {
  const { t } = useTranslation();
  const detail = useLoad(() => (id ? portalQuoteRequest(id) : Promise.resolve(null)), id ? `quote:${id}` : "none");
  const d = detail.data;
  return (
    <Sheet open={!!id} onClose={onClose} wide title={d ? t("portal.quote.detail.title", { ref: d.public_ref || "" }) : t("portal.quote.detail.loading")}>
      {detail.error && !d ? <ErrorCard message={detail.error} onRetry={detail.reload} /> : null}
      {!d && !detail.error ? <SkeletonCards count={3} /> : null}
      {d ? (
        <Detail
          d={d}
          onChanged={() => {
            detail.reload();
            onChanged();
          }}
          onOpenQuotation={onOpenQuotation}
        />
      ) : null}
    </Sheet>
  );
}

function Detail({
  d,
  onChanged,
  onOpenQuotation,
}: {
  d: PortalQuoteDetail;
  onChanged: () => void;
  onOpenQuotation: (id: string) => void;
}) {
  const { t } = useTranslation();
  const lang = getLang();
  const toast = useToast();
  const [adding, setAdding] = React.useState(false);
  const docs = useQuoteDocuments({
    maxBytes: DOC_MAX_BYTES,
    maxFiles: DOCS_MAX,
    // Straight onto the request — it already exists, so nothing waits.
    upload: (file, onProgress, kind) =>
      portalAddQuoteDocument(d.quote_request_id, file, kind, onProgress).then((r) => ({ doc_id: r.id })),
    messages: {
      badType: t("portal.upload.badType"),
      tooBig: t("portal.upload.tooBig", { limit: "10 MB" }),
      tooMany: t("site.quoteSteps.docsTooMany"),
      totalTooBig: t("site.quoteSteps.docsTotalTooBig"),
      unreadable: t("portal.upload.unreadable"),
    },
  });
  // Once a file has gone up, the list above shows it: reload, and say so.
  const doneCount = docs.items.filter((x) => x.state === "done").length;
  const seen = React.useRef(0);
  React.useEffect(() => {
    if (doneCount > seen.current) {
      seen.current = doneCount;
      toast(t("portal.quote.detail.added"));
      onChanged();
    }
  }, [doneCount, onChanged, t, toast]);

  const svc = d.service;
  const route = d.origin_location || d.destination_location;
  const steps = stageSteps(d.timeline || [], (k) => t(k));

  async function download(attId: string, name: string | null) {
    try {
      await portalDownloadQuoteDocument(d.quote_request_id, attId, name || "document");
    } catch (e) {
      toast(errorText(e));
    }
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={STAGE_TONE[d.stage] || "mute"}>{t(stageKey(d.stage))}</Pill>
        {d.public_ref ? (
          <Pill plain>
            <span className="pt-mono">{d.public_ref}</span>
          </Pill>
        ) : null}
        <Pill plain>{dayLabel(d.created_at)}</Pill>
      </div>

      {/* ── what they asked for ── */}
      <section className="pt-card grid gap-3 p-4">
        <h3 className="pt-label !mb-0">{t("portal.quote.detail.scope")}</h3>
        <p className="flex items-center gap-2 text-[0.95rem] font-semibold text-foreground">
          <span className="text-primary-ink">
            <ModeIcon mode={svc ? svc.card : "OTHER"} size={20} />
          </span>
          {svc ? serviceName(svc, lang) : d.service_category || "—"}
          {d.hinterland_direction ? <Pill plain>{t(`site.quoteSteps.hinterland${d.hinterland_direction}`)}</Pill> : null}
        </p>
        {route ? (
          <p className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-foreground">
            {d.collection_location ? (
              <>
                <span className="truncate text-muted-foreground">{d.collection_location}</span>
                <ArrowRightIcon size={14} className="text-muted-foreground" />
              </>
            ) : null}
            <span className="truncate">{d.origin_location || "—"}</span>
            <ArrowRightIcon size={14} className="text-muted-foreground" />
            <span className="truncate">{d.destination_location || "—"}</span>
            {d.delivery_location ? (
              <>
                <ArrowRightIcon size={14} className="text-muted-foreground" />
                <span className="truncate text-muted-foreground">{d.delivery_location}</span>
              </>
            ) : null}
          </p>
        ) : d.warehouse_location ? (
          <p className="text-sm text-foreground">{d.warehouse_location}</p>
        ) : null}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {d.incoterm && d.incoterm !== "N/A" ? (
            <div>
              <dt className="text-xs text-muted-foreground">{t("portal.quote.incoterm")}</dt>
              <dd className="pt-mono">{d.incoterm === "TBD" ? t("portal.quote.detail.toBeDetermined") : d.incoterm}</dd>
            </div>
          ) : null}
          {d.estimated_weight ? (
            <div>
              <dt className="text-xs text-muted-foreground">{t("portal.quote.detail.weight")}</dt>
              <dd className="pt-num">
                {num(d.estimated_weight)} kg
                {Number(d.estimated_weight) >= 1000 ? <span className="text-muted-foreground"> · ≈ {num(Math.round(Number(d.estimated_weight) / 100) / 10)} T</span> : null}
              </dd>
            </div>
          ) : null}
        </dl>
        {d.cargo_description ? <p className="whitespace-pre-wrap text-sm text-foreground">{d.cargo_description}</p> : null}
      </section>

      {/* ── its documents ── */}
      <section className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="pt-label !mb-0">{t("portal.quote.detail.documents")}</h3>
          {!adding ? (
            <button type="button" className="pt-btn pt-btn-soft pt-btn-sm" onClick={() => setAdding(true)}>
              <DocIcon size={16} />
              {t("site.quoteSteps.docsAdd")}
            </button>
          ) : null}
        </div>
        {d.documents.length ? (
          <div className="pt-card pt-rows overflow-hidden">
            {d.documents.map((doc) => (
              <button key={doc.id} type="button" className="pt-row text-left" onClick={() => void download(doc.id, doc.name)}>
                <DocIcon size={20} className="text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{doc.name || t("portal.quote.detail.document")}</span>
                  <span className="block text-xs text-muted-foreground">
                    {doc.document_kind ? t(`site.quoteSteps.doc${doc.document_kind}`) : t("portal.quote.detail.document")} · {dayLabel(doc.created_at)}
                  </span>
                </span>
                <DownloadIcon size={18} className="text-muted-foreground" />
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("portal.quote.detail.noDocuments")}</p>
        )}
        {adding ? <QuoteDocumentsStep docs={docs} required={false} variant="portal" idPrefix={`pt-add-${d.quote_request_id}`} /> : null}
      </section>

      {/* ── where it stands ── */}
      <section className="grid gap-2">
        <h3 className="pt-label !mb-0">{t("portal.quote.detail.progress")}</h3>
        <ol className="grid gap-2">
          {steps.map((e, i) => (
            <li key={`${e.label}-${i}`} className="flex items-center gap-3 text-sm">
              <span
                aria-hidden="true"
                className={i === steps.length - 1 ? "h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--primary)]" : "h-2.5 w-2.5 shrink-0 rounded-full border border-[var(--pt-line-strong)]"}
              />
              <span className={i === steps.length - 1 ? "font-semibold text-foreground" : "text-muted-foreground"}>
                {e.label}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">{dayLabel(e.at)}</span>
            </li>
          ))}
        </ol>
      </section>

      <Answer d={d} onOpenQuotation={onOpenQuotation} />
    </div>
  );
}

/** The team's answer to the request: the quotation linked to it, or "waiting". */
function Answer({ d, onOpenQuotation }: { d: PortalQuoteDetail; onOpenQuotation: (id: string) => void }) {
  const { t } = useTranslation();
  const q = d.quotation;
  return (
    <section className="grid gap-2">
      <h3 className="pt-label !mb-0">{t("portal.quote.detail.answer")}</h3>
      {q ? (
        <button type="button" className="pt-card pt-card-press flex items-center gap-3 p-4 text-left" onClick={() => onOpenQuotation(q.quotation_id)}>
          <QuoteIcon size={22} className="text-primary-ink" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.95rem] font-semibold text-foreground">
              {t("portal.offer.quotation")} {q.doc_number || ""}
            </span>
            <span className="block text-xs text-muted-foreground">
              {t(`portal.offer.status.${q.status}`, { defaultValue: q.status })} · <span className="pt-num">{money(q.total, q.currency)}</span>
            </span>
          </span>
          <ChevronRightIcon size={18} className="text-muted-foreground" />
        </button>
      ) : (
        <p className="text-sm text-muted-foreground">{t("portal.quote.detail.waiting")}</p>
      )}
    </section>
  );
}
