/**
 * Quotes — asking for a price, seeing where each request stands, and
 * answering the proposals the team sends back.
 *
 * Asking is a sheet of short steps, one decision per screen (meeting 6, PR 2):
 *
 *   1. WHAT — the six cards and the flow, the same component the public
 *      website draws (components/quote/quote-service-step, owner decision Q6),
 *      read from EVERY active service type the tenant has — an existing client
 *      may need one the tenant does not market. The request stores the
 *      service type itself; it used to store translated words and regex-parse
 *      them back (item 2.1).
 *   2. WHERE — the route for a moving service, with the Incoterms THAT service
 *      offers plus "Not sure" (owner decision Q3); the place and the duration
 *      for storage; nothing for a service with no movement.
 *   3. WHAT IT IS — the cargo and its weight ("≈ 25 T").
 *   4. DOCUMENTS — at least one is required, the commercial invoice the one
 *      recommended (owner decision Q4). Each file goes up the moment it is
 *      picked, with its preview and its percentage, so the request can never
 *      exist without its document.
 *
 * The typing stays optional three ways over (prefill + AI fill):
 *
 *   · "Describe it in your own words" — one line, and the steps come back
 *     filled, the service type included when exactly one fits;
 *   · "Same as last time" — their previous request, every field of it;
 *   · "Like PRX-…" — one of their shipments on the move, as the starting point.
 *
 * A sent request opens (a sheet on a phone, a panel on a desktop) with its
 * scope, its documents and "Add a document", its status as a timeline, and the
 * proposal that answered it (quote-request-detail.tsx, item 2.9).
 *
 * The route `/portal/quotes` and this page's shape stay as they are: PR 4
 * splits the portal menu into "Requests for Quotation" and "Quotations" and
 * moves the proposals tab.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  portalQuoteRequests,
  portalQuoteServices,
  portalCreateQuote,
  portalQuoteFill,
  portalProposals,
  portalStageQuoteDocument,
  type PortalQuoteRequest,
  type PortalPlace,
  type ProposalSummary,
  type ShipmentCard,
  type PlaceKind,
} from "@/lib/portal-api";
import { num } from "@/lib/format";
import { getLang } from "@/lib/i18n";
import {
  incotermToSend,
  serviceName,
  type QuoteCard,
  type QuoteService,
} from "@/lib/quote-scope";
import { useQuoteDocuments } from "@/lib/use-quote-documents";
import { EMPTY_PICK, QuoteServiceStep, pickedService, pickProblems, type ServicePick } from "@/components/quote/quote-service-step";
import { IncotermChoice } from "@/components/quote/incoterm-choice";
import { QuoteDocumentsStep } from "@/components/quote/quote-documents";
import { usePortal } from "../lib/portal-context";
import { usePageChrome, PageHeader, useSummary } from "../shell/portal-shell";
import { Sheet, Pill, IconDisc, SkeletonCards, EmptyState, ErrorCard, TextArea, StepDots, Seg, useLoad, useToast, errorText, Busy, type Load } from "../ui/kit";
import { QuoteIcon, PlusIcon, ArrowRightIcon, ChevronRightIcon, CheckIcon, RefreshIcon, SparkIcon, ShipIcon, CloseIcon, PinIcon, DocIcon } from "../ui/icons";
import { PlaceField, EMPTY_PLACE, placeValue, typedValue, pinExact, type PlaceValue } from "../ui/place-picker";
import { relDayTitle } from "../lib/when";
import { parseAmount } from "../lib/numbers";
import { ModeIcon } from "./shipment-parts";
import { ProposalRow, ProposalSheet } from "./proposals";
import { QuoteRequestSheet, STATUS_TONE } from "./quote-request-detail";
// The shared quote steps' copy lives outside the entry dictionary; see
// quote-steps-i18n.ts. Imported for the side effect.
import "@/components/quote/quote-steps-i18n";

/** The documents a portal request can be sent with (the server's own ceiling). */
const DOCS_MAX = 10;
const DOC_MAX_BYTES = 10 * 1024 * 1024;

/* ── the route step, per card ────────────────────────────────────────────── */

/**
 * What the route step asks, and what each end may be — the same engine as the
 * desk's operations file, which asks an air file for an ORIGIN AIRPORT and a
 * sea file for a PORT OF LOADING, and asks both for a place of collection and
 * a place of delivery. `legs` offers the two doors either side of the main
 * leg: only sea and air have a "port" middle distinct from the doors.
 */
type EndSpec = { label: string; hint: string; kinds?: PlaceKind[]; doors: boolean };
type RouteSpec = { from: EndSpec; to: EndSpec; legs: boolean };

/** A port field offers ports — and terminals and dry ports, which are where a
 *  sea move genuinely starts or ends inland. */
const PORT_KINDS: PlaceKind[] = ["SEAPORT", "TERMINAL", "INLAND"];
const AIRPORT_KINDS: PlaceKind[] = ["AIRPORT"];
/** A door: any address, and the shared places a door is often described by. */
const DOOR_KINDS: PlaceKind[] = ["ADDRESS", "WAREHOUSE", "CITY", "INLAND", "TERMINAL", "BORDER_POST", "OTHER"];

function routeSpec(card: QuoteCard | ""): RouteSpec {
  if (card === "SEA") {
    return {
      from: { label: "portal.quote.route.pol", hint: "portal.quote.route.portHint", kinds: PORT_KINDS, doors: false },
      to: { label: "portal.quote.route.pod", hint: "portal.quote.route.portHint", kinds: PORT_KINDS, doors: false },
      legs: true,
    };
  }
  if (card === "AIR") {
    return {
      from: { label: "portal.quote.route.aol", hint: "portal.quote.route.airportHint", kinds: AIRPORT_KINDS, doors: false },
      to: { label: "portal.quote.route.aod", hint: "portal.quote.route.airportHint", kinds: AIRPORT_KINDS, doors: false },
      legs: true,
    };
  }
  return {
    from: { label: "portal.quote.from", hint: "portal.quote.route.placeHint", doors: true },
    to: { label: "portal.quote.to", hint: "portal.quote.route.placeHint", doors: true },
    legs: false,
  };
}

/** A request's stored end, back as a value: the place it was pinned to, or
 *  the words — or nothing. */
const endOf = (text: string | null | undefined, place: PortalPlace | null | undefined): PlaceValue =>
  place ? placeValue(place, text) : text ? typedValue(text) : EMPTY_PLACE;

/** Does a picked place still fit the field after the card changed? A Shanghai
 *  SEAPORT is no answer to "Origin airport". */
const fits = (v: PlaceValue, kinds?: PlaceKind[]) => !v.pick || !kinds || !v.kind || kinds.includes(v.kind as PlaceKind);

type Tab = "requests" | "proposals";

export function QuotesPage() {
  const { t } = useTranslation();
  usePageChrome(null);
  const summary = useSummary();
  const [params, setParams] = useSearchParams();
  const list = useLoad(portalQuoteRequests, "quotes");
  const offers = useLoad(portalProposals, "proposals");
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>(params.get("tab") === "proposals" ? "proposals" : "requests");
  const [proposal, setProposal] = React.useState<string | null>(null);
  const [request, setRequest] = React.useState<string | null>(null);

  // Deep links: "?new=1" from Home, "?tab=proposals" and "?proposal=<id>" from
  // Home's "waiting for your answer" and the email that announced it, and
  // "?request=<id>" for one request.
  React.useEffect(() => {
    let changed = false;
    if (params.get("new") === "1") {
      setOpen(true);
      params.delete("new");
      changed = true;
    }
    const wanted = params.get("proposal");
    if (wanted) {
      setTab("proposals");
      setProposal(wanted);
      params.delete("proposal");
      changed = true;
    }
    const req = params.get("request");
    if (req) {
      setRequest(req);
      params.delete("request");
      changed = true;
    }
    if (params.get("tab")) {
      params.delete("tab");
      changed = true;
    }
    if (changed) setParams(params, { replace: true });
  }, [params, setParams]);

  const pending = (offers.data || []).filter((p) => p.status === "SENT").length;

  return (
    <div>
      <PageHeader
        title={t("portal.nav.quotes")}
        action={
          <button type="button" className="pt-btn pt-btn-primary pt-btn-sm sm:!min-h-[44px] sm:!px-5 sm:!text-[0.9375rem]" onClick={() => setOpen(true)}>
            <PlusIcon size={18} />
            {t("portal.quote.new")}
          </button>
        }
      />

      {(offers.data || []).length ? (
        <div className="mb-4">
          <Seg<Tab>
            label={t("portal.nav.quotes")}
            value={tab}
            onChange={setTab}
            items={[
              { value: "requests", label: t("portal.quote.tab.requests") },
              { value: "proposals", label: t("portal.quote.tab.proposals"), count: pending },
            ]}
          />
        </div>
      ) : null}

      {tab === "proposals" && (offers.data || []).length ? (
        <ProposalsList items={offers.data || []} onOpen={(p) => setProposal(p.proposal_id)} />
      ) : (
        <RequestsList list={list} onNew={() => setOpen(true)} onOpen={(q) => setRequest(q.quote_request_id)} />
      )}

      <QuoteSheet open={open} onClose={() => setOpen(false)} onDone={list.reload} last={list.data?.[0] || null} ships={summary?.data?.shipments?.items || []} />
      <QuoteRequestSheet
        id={request}
        onClose={() => setRequest(null)}
        onChanged={list.reload}
        onOpenProposal={(id) => {
          setRequest(null);
          setProposal(id);
        }}
      />
      <ProposalSheet
        id={proposal}
        onClose={() => setProposal(null)}
        onChanged={() => {
          offers.reload();
          summary?.reload();
        }}
      />
    </div>
  );
}

function ProposalsList({ items, onOpen }: { items: ProposalSummary[]; onOpen: (p: ProposalSummary) => void }) {
  return (
    <div className="pt-card pt-rows overflow-hidden">
      {items.map((p) => (
        <ProposalRow key={p.proposal_id} p={p} onOpen={onOpen} />
      ))}
    </div>
  );
}

/** The card a request was filed under — from its service; OTHER for one filed before services were structured. */
export const cardOf = (q: Pick<PortalQuoteRequest, "service">): QuoteCard => (q.service ? q.service.card : "OTHER");

function RequestsList({ list, onNew, onOpen }: { list: Load<PortalQuoteRequest[]>; onNew: () => void; onOpen: (q: PortalQuoteRequest) => void }) {
  const { t } = useTranslation();
  const lang = getLang();
  return (
    <>
      {list.error && !list.data ? <ErrorCard message={list.error} onRetry={list.reload} /> : null}
      {!list.data && !list.error ? <SkeletonCards count={3} /> : null}
      {list.data ? (
        list.data.length ? (
          <div className="pt-card pt-rows overflow-hidden">
            {list.data.map((q) => (
              <button key={q.quote_request_id} type="button" className="pt-row text-left" onClick={() => onOpen(q)}>
                <IconDisc tone={STATUS_TONE[q.status] || "brand"}>
                  <ModeIcon mode={cardOf(q)} />
                </IconDisc>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.95rem] font-semibold text-foreground">
                    {q.service ? serviceName(q.service, lang) : q.service_category || t("portal.quote.request")}
                  </span>
                  {q.origin_location || q.destination_location ? (
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                      <span className="truncate">{q.origin_location || "—"}</span>
                      <ArrowRightIcon size={14} />
                      <span className="truncate">{q.destination_location || "—"}</span>
                    </span>
                  ) : q.warehouse_location ? (
                    <span className="mt-0.5 block truncate text-sm text-muted-foreground">{q.warehouse_location}</span>
                  ) : null}
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Pill tone={STATUS_TONE[q.status] || "mute"}>{t(`portal.quote.status.${q.status}`, { defaultValue: q.status })}</Pill>
                    {q.public_ref ? (
                      <Pill plain>
                        <span className="pt-mono">{q.public_ref}</span>
                      </Pill>
                    ) : null}
                    <Pill plain>{relDayTitle(q.created_at, 6)}</Pill>
                    {q.documents ? (
                      <Pill plain>
                        <DocIcon size={13} />
                        {t("portal.quote.docCount", { count: q.documents })}
                      </Pill>
                    ) : null}
                    {q.collection_location || q.delivery_location ? (
                      <Pill plain>
                        <PinIcon size={13} />
                        {q.collection_location && q.delivery_location
                          ? t("portal.quote.route.doorToDoor")
                          : q.collection_location
                            ? t("portal.quote.route.withCollection")
                            : t("portal.quote.route.withDelivery")}
                      </Pill>
                    ) : null}
                  </span>
                </span>
                <ChevronRightIcon size={18} className="text-muted-foreground" />
              </button>
            ))}
          </div>
        ) : (
          <div className="pt-card">
            <EmptyState
              icon={<QuoteIcon size={28} />}
              title={t("portal.quote.none")}
              action={
                <button type="button" className="pt-btn pt-btn-soft" onClick={onNew}>
                  <PlusIcon size={20} />
                  {t("portal.quote.request")}
                </button>
              }
            />
          </div>
        )
      ) : null}
    </>
  );
}

type StepKey = "service" | "route" | "cargo" | "documents";

function QuoteSheet({
  open,
  onClose,
  onDone,
  last,
  ships,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  last: PortalQuoteRequest | null;
  ships: ShipmentCard[];
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const portal = usePortal();
  const services = useLoad(() => (open ? portalQuoteServices() : Promise.resolve([] as QuoteService[])), open ? "quote-services" : "none");
  const list = React.useMemo(() => services.data || [], [services.data]);
  const [step, setStep] = React.useState(0);
  const [pick, setPick] = React.useState<ServicePick>(EMPTY_PICK);
  const [origin, setOrigin] = React.useState<PlaceValue>(EMPTY_PLACE);
  const [destination, setDestination] = React.useState<PlaceValue>(EMPTY_PLACE);
  // The doors either side of the main leg: null = not asked for.
  const [collection, setCollection] = React.useState<PlaceValue | null>(null);
  const [delivery, setDelivery] = React.useState<PlaceValue | null>(null);
  const [warehouse, setWarehouse] = React.useState("");
  const [incoterm, setIncoterm] = React.useState("");
  const [cargo, setCargo] = React.useState("");
  const [weight, setWeight] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showErrors, setShowErrors] = React.useState(false);
  const [describing, setDescribing] = React.useState(false);
  const [description, setDescription] = React.useState("");
  const [filling, setFilling] = React.useState(false);
  const [filled, setFilled] = React.useState(false);

  const docs = useQuoteDocuments({
    maxBytes: DOC_MAX_BYTES,
    maxFiles: DOCS_MAX,
    upload: (file, onProgress) => portalStageQuoteDocument(file, onProgress),
    messages: {
      badType: t("portal.upload.badType"),
      tooBig: t("portal.upload.tooBig", { limit: "10 MB" }),
      tooMany: t("site.quoteSteps.docsTooMany"),
      totalTooBig: t("site.quoteSteps.docsTotalTooBig"),
      unreadable: t("portal.upload.unreadable"),
    },
  });
  const resetDocs = docs.reset;

  React.useEffect(() => {
    if (!open) return;
    setStep(0);
    setPick(EMPTY_PICK);
    setOrigin(EMPTY_PLACE);
    setDestination(EMPTY_PLACE);
    setCollection(null);
    setDelivery(null);
    setWarehouse("");
    setIncoterm("");
    setCargo("");
    setWeight("");
    setError(null);
    setShowErrors(false);
    setDescribing(false);
    setDescription("");
    setFilled(false);
    resetDocs();
  }, [open, resetDocs]);

  const service = pickedService(list, pick);
  const shape = service ? service.enquiry_shape : "ROUTE";
  const card = pick.card;
  const spec = routeSpec(card);
  const kg = parseAmount(weight);

  /** The steps this request actually has: a service with no movement has no route to ask for. */
  const steps: StepKey[] = shape === "NONE" ? ["service", "cargo", "documents"] : ["service", "route", "cargo", "documents"];
  const at = Math.min(step, steps.length - 1);
  const key = steps[at];

  function problems(k: StepKey): Record<string, string> {
    if (k === "service") return pickProblems(list, pick, t);
    if (k === "route") {
      if (shape === "STORAGE") return warehouse.trim().length > 1 ? {} : { warehouse: t("site.quote.errWarehouse") };
      const out: Record<string, string> = {};
      if (origin.text.trim().length < 2) out.origin = t("site.quote.errOrigin");
      if (destination.text.trim().length < 2) out.destination = t("site.quote.errDestination");
      return out;
    }
    if (k === "cargo") return cargo.trim().length > 2 && (!weight || kg >= 0) ? {} : { cargo: t("portal.quote.errCargo") };
    if (!docs.count) return { documents: t("site.quoteSteps.errDocs") };
    if (!docs.settled) return { documents: t("site.quoteSteps.docsPreparing") };
    return {};
  }
  const shown = showErrors ? problems(key) : {};
  const canNext = Object.keys(problems(key)).length === 0;

  // A picked place that no longer answers the field's question once the card
  // changes goes back to being words, rather than telling the desk "Shanghai,
  // seaport" under "Origin airport".
  React.useEffect(() => {
    const s = routeSpec(card);
    setOrigin((cur) => (fits(cur, s.from.kinds) ? cur : typedValue(cur.text)));
    setDestination((cur) => (fits(cur, s.to.kinds) ? cur : typedValue(cur.text)));
  }, [card]);

  /**
   * Words that arrived without a pick — the AI fill, "Like PRX-…" — pinned when
   * the places the client can see hold exactly that place. Applied only if the
   * field still holds those words, so a pick they made meanwhile is never
   * overwritten by a late answer.
   */
  function pin(which: "origin" | "destination", text: string | null | undefined, c: QuoteCard | "") {
    const words = typedValue(String(text || "")).text;
    if (words.length < 2) return;
    const s = routeSpec(c);
    const set = which === "origin" ? setOrigin : setDestination;
    void pinExact(words, which === "origin" ? s.from.kinds : s.to.kinds).then((v) => {
      if (v) set((cur) => (cur.text === words && !cur.pick ? v : cur));
    });
  }

  /** The service a stored request named, as a pick — when it is still on offer. */
  function pickOf(serviceTypeId: string | null | undefined, hinterland: string | null | undefined): ServicePick | null {
    const svc = list.find((x) => x.service_type_id === serviceTypeId);
    if (!svc) return null;
    return { card: svc.card, serviceTypeId: svc.service_type_id, hinterland: hinterland === "INTO" || hinterland === "OUT_OF" ? hinterland : "" };
  }

  /** The last request, every field of it — the places it was pinned to included. */
  function sameAsLast() {
    if (!last) return;
    const p = pickOf(last.service_type_id, last.hinterland_direction);
    if (p) setPick(p);
    setOrigin(endOf(last.origin_location, last.origin_place));
    setDestination(endOf(last.destination_location, last.destination_place));
    setCollection(last.collection_location ? endOf(last.collection_location, last.collection_place) : null);
    setDelivery(last.delivery_location ? endOf(last.delivery_location, last.delivery_place) : null);
    if (last.warehouse_location) setWarehouse(last.warehouse_location);
    // "TBD" is what the server files for "Not sure", "N/A" for no term — not terms to offer back.
    if (last.incoterm && last.incoterm !== "TBD" && last.incoterm !== "N/A") setIncoterm(last.incoterm);
    if (last.cargo_description) setCargo(last.cargo_description);
    if (last.estimated_weight) setWeight(String(last.estimated_weight));
    setFilled(true);
  }

  /** One of their shipments as the starting point. */
  function like(s: ShipmentCard) {
    const c = list.some((x) => x.card === s.mode) ? (s.mode as QuoteCard) : card;
    if (c && c !== card) setPick({ card: c, serviceTypeId: list.filter((x) => x.card === c).length === 1 ? list.find((x) => x.card === c)!.service_type_id : "", hinterland: "" });
    setOrigin(typedValue(s.origin || ""));
    setDestination(typedValue(s.destination || ""));
    pin("origin", s.origin, c);
    pin("destination", s.destination, c);
    if (s.title) setCargo(s.title);
    setFilled(true);
  }

  async function fill() {
    const text = description.trim();
    if (text.length < 3) return;
    setFilling(true);
    setError(null);
    try {
      const { fields } = await portalQuoteFill(text);
      const p = pickOf(fields.service_type_id, fields.hinterland_direction);
      const c = p ? p.card : fields.mode && list.some((x) => x.card === fields.mode) ? fields.mode : card;
      if (p) setPick(p);
      else if (c && c !== card) setPick({ ...EMPTY_PICK, card: c });
      if (fields.origin) {
        setOrigin(typedValue(fields.origin));
        pin("origin", fields.origin, c);
      }
      if (fields.destination) {
        setDestination(typedValue(fields.destination));
        pin("destination", fields.destination, c);
      }
      if (fields.incoterm) setIncoterm(fields.incoterm);
      const what = [fields.containers, fields.cargo].filter(Boolean).join(" — ");
      if (what) setCargo(what.slice(0, 2000));
      if (fields.weight_kg) setWeight(String(fields.weight_kg));
      setFilled(true);
      setDescribing(false);
      toast(t("portal.quote.filled"));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setFilling(false);
    }
  }

  function next() {
    if (!canNext) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    if (at < steps.length - 1) setStep(at + 1);
    else void submit();
  }

  async function submit() {
    if (!service) return;
    setBusy(true);
    setError(null);
    try {
      // A door counts only where the card offers one, and only once it names a place.
      const door = (v: PlaceValue | null) => (spec.legs && v && v.text.trim() ? v : null);
      const from = door(collection);
      const to = door(delivery);
      const route =
        shape === "ROUTE"
          ? {
              origin_location: origin.text.trim(),
              destination_location: destination.text.trim(),
              ...(origin.pick ? { origin_place: origin.pick } : {}),
              ...(destination.pick ? { destination_place: destination.pick } : {}),
              ...(from ? { collection_location: from.text.trim(), ...(from.pick ? { collection_place: from.pick } : {}) } : {}),
              ...(to ? { delivery_location: to.text.trim(), ...(to.pick ? { delivery_place: to.pick } : {}) } : {}),
            }
          : shape === "STORAGE"
            ? { warehouse_location: warehouse.trim() }
            : {};
      await portalCreateQuote({
        service_type_id: service.service_type_id,
        ...(pick.hinterland ? { hinterland_direction: pick.hinterland } : {}),
        ...route,
        cargo_description: cargo.trim(),
        ...(weight && Number.isFinite(kg) ? { estimated_weight: kg } : {}),
        incoterm: incotermToSend(service, incoterm),
        documents: docs.items.filter((d) => d.state === "done" && d.docId).map((d) => ({ doc_id: d.docId as string, document_kind: d.kind })),
      });
      toast(t("portal.quote.sent"));
      onDone();
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const titles: Record<StepKey, string> = {
    service: t("portal.quote.step1"),
    route: shape === "STORAGE" ? t("portal.quote.stepStorage") : t("portal.quote.step2"),
    cargo: t("portal.quote.step3"),
    documents: t("portal.quote.stepDocs"),
  };
  const starters = portal.canOps ? ships.slice(0, 3) : [];
  const last_ = at === steps.length - 1;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={titles[key]}
      footer={
        <div className="flex items-center gap-3">
          {at > 0 ? (
            <button type="button" className="pt-btn pt-btn-ghost" onClick={() => setStep(at - 1)} disabled={busy}>
              {t("portal.common.back")}
            </button>
          ) : null}
          <button type="button" className="pt-btn pt-btn-primary flex-1" disabled={busy || (key === "documents" && docs.busy)} onClick={next}>
            <Busy busy={busy}>{last_ ? <CheckIcon size={20} /> : null}</Busy>
            {last_ ? t("portal.quote.send") : t("portal.common.next")}
            {!last_ ? <ChevronRightIcon size={20} /> : null}
          </button>
        </div>
      }
    >
      <div className="flex items-center justify-between gap-3">
        <StepDots count={steps.length} at={at} label={t("portal.pay.progress", { step: at + 1, total: steps.length })} />
        {filled ? (
          <Pill tone="brand">
            <SparkIcon size={13} />
            {t("portal.quote.filledPill")}
          </Pill>
        ) : null}
      </div>

      {key === "service" ? (
        <div className="mt-5">
          {/* ── the three ways not to type ── */}
          {describing ? (
            <div className="pt-card grid gap-3 p-4">
              <TextArea
                label={t("portal.quote.describe")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder={t("portal.quote.describeHint")}
                autoFocus
              />
              <button type="button" className="pt-btn pt-btn-primary" onClick={() => void fill()} disabled={filling || description.trim().length < 3}>
                <Busy busy={filling}>
                  <SparkIcon size={20} />
                </Busy>
                {filling ? t("portal.quote.filling") : t("portal.quote.fill")}
              </button>
            </div>
          ) : (
            <button type="button" className="pt-card pt-card-press flex w-full items-center gap-3 p-4 text-left" onClick={() => setDescribing(true)}>
              <IconDisc tone="brand" size={44}>
                <SparkIcon size={22} />
              </IconDisc>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.95rem] font-bold text-foreground">{t("portal.quote.describe")}</span>
                <span className="block truncate text-sm text-muted-foreground">{t("portal.quote.describeHint")}</span>
              </span>
              <ChevronRightIcon size={18} className="text-muted-foreground" />
            </button>
          )}

          {last || starters.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {last ? (
                <button type="button" className="pt-chip" onClick={sameAsLast}>
                  <RefreshIcon size={16} />
                  {t("portal.quote.sameAsLast")}
                </button>
              ) : null}
              {starters.map((s) => (
                <button key={s.dossier_id} type="button" className="pt-chip" onClick={() => like(s)}>
                  <ShipIcon size={16} />
                  {t("portal.quote.likeShipment", { ref: s.ref })}
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-6">
            {services.error && !services.data ? <ErrorCard message={services.error} onRetry={services.reload} /> : null}
            {!services.data && !services.error ? <SkeletonCards count={2} /> : null}
            {services.data ? (
              <QuoteServiceStep
                services={list}
                value={pick}
                onChange={(p) => {
                  if (p.serviceTypeId !== pick.serviceTypeId) setIncoterm("");
                  setPick(p);
                }}
                variant="portal"
                idPrefix="pt-quote"
                errors={shown}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {key === "route" && shape === "ROUTE" ? (
        <div className="mt-5 grid gap-6">
          <RouteLegs
            spec={spec}
            origin={origin}
            destination={destination}
            collection={collection}
            delivery={delivery}
            onOrigin={setOrigin}
            onDestination={setDestination}
            onCollection={setCollection}
            onDelivery={setDelivery}
          />
          {shown.origin || shown.destination ? (
            <p role="alert" className="text-sm text-[rgb(var(--bad))]">
              {shown.origin || shown.destination}
            </p>
          ) : null}
          <IncotermChoice service={service} value={incoterm} onChange={setIncoterm} variant="portal" idPrefix="pt-quote" />
        </div>
      ) : null}

      {key === "route" && shape === "STORAGE" ? (
        <div className="mt-5 grid gap-2">
          <label htmlFor="pt-q-warehouse" className="pt-label">
            {t("site.quote.warehouseLocation")}
          </label>
          <input id="pt-q-warehouse" className="pt-field" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} placeholder={t("site.quote.warehousePlaceholder")} />
          {shown.warehouse ? (
            <p role="alert" className="text-sm text-[rgb(var(--bad))]">
              {shown.warehouse}
            </p>
          ) : null}
        </div>
      ) : null}

      {key === "cargo" ? (
        <div className="mt-5 grid gap-4">
          <TextArea label={t("portal.quote.what")} value={cargo} onChange={(e) => setCargo(e.target.value)} rows={3} maxLength={2000} placeholder={t("portal.quote.whatHint")} />
          <div>
            <label htmlFor="pt-q-kg" className="pt-label">
              {t("portal.quote.weight")}
            </label>
            <div className="relative">
              <input id="pt-q-kg" className="pt-field pt-num pr-14" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^\d.,\s]/g, ""))} />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">kg</span>
            </div>
            {/* Tonnes with a capital T, as the meeting asked (item 2.10). */}
            {weight && Number.isFinite(kg) && kg >= 1000 ? <p className="pt-num mt-1.5 text-xs text-muted-foreground">≈ {num(Math.round(kg / 100) / 10)} T</p> : null}
          </div>
          {shown.cargo ? (
            <p role="alert" className="text-sm text-[rgb(var(--bad))]">
              {shown.cargo}
            </p>
          ) : null}
        </div>
      ) : null}

      {key === "documents" ? (
        <div className="mt-5">
          <QuoteDocumentsStep docs={docs} required variant="portal" idPrefix="pt-quote" error={shown.documents} />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 text-sm font-medium text-[rgb(var(--bad))]">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}

/**
 * The route, drawn the way the cargo travels it: the door we collect from,
 * the two ends of the main leg, the door we deliver to — joined by a rail.
 *
 * The two doors start as dashed "add" rows rather than as two more empty
 * fields: most requests are port to port, and four boxes where two are
 * optional reads as four questions. Adding one opens its search straight away;
 * closing that search with nothing chosen takes the door back off, so an
 * empty door never sits on the screen looking like a question left unanswered.
 */
function RouteLegs({
  spec,
  origin,
  destination,
  collection,
  delivery,
  onOrigin,
  onDestination,
  onCollection,
  onDelivery,
}: {
  spec: RouteSpec;
  origin: PlaceValue;
  destination: PlaceValue;
  collection: PlaceValue | null;
  delivery: PlaceValue | null;
  onOrigin: (v: PlaceValue) => void;
  onDestination: (v: PlaceValue) => void;
  onCollection: (v: PlaceValue | null) => void;
  onDelivery: (v: PlaceValue | null) => void;
}) {
  const { t } = useTranslation();
  // Which door was JUST added — its search opens on arrival. Only a door added
  // by a tap does; one restored by "Same as last time" arrives filled and shut.
  const [added, setAdded] = React.useState<"collection" | "delivery" | null>(null);

  function door(which: "collection" | "delivery", value: PlaceValue | null, set: (v: PlaceValue | null) => void, dash: { above?: boolean; below?: boolean }) {
    const label = t(`portal.quote.route.${which}`);
    const rail = { "data-dash-above": dash.above || undefined, "data-dash-below": dash.below || undefined };
    if (!value) {
      return (
        <li className="pt-leg" data-add {...rail}>
          <span className="pt-leg-dot" data-door aria-hidden="true" />
          <button
            type="button"
            className="pt-leg-add"
            onClick={() => {
              setAdded(which);
              set(EMPTY_PLACE);
            }}
          >
            <span className="pt-place-glyph">
              <PlusIcon size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-foreground">{t(`portal.quote.route.${which}Add`)}</span>
              <span className="block truncate text-xs text-muted-foreground">{t(`portal.quote.route.${which}AddHint`)}</span>
            </span>
          </button>
        </li>
      );
    }
    return (
      <li className="pt-leg" {...rail}>
        <span className="pt-leg-dot" data-door aria-hidden="true" />
        <PlaceField
          label={label}
          value={value}
          onChange={set}
          kinds={DOOR_KINDS}
          doors
          placeholder={t("portal.quote.route.doorHint")}
          autoOpen={added === which && !value.text}
          onDismissEmpty={() => set(null)}
          action={
            <button type="button" className="pt-icon-btn -my-2.5 -mr-2 text-muted-foreground" aria-label={t("portal.quote.route.remove", { place: label })} onClick={() => set(null)}>
              <CloseIcon size={18} />
            </button>
          }
        />
      </li>
    );
  }

  return (
    <ol className="pt-legs">
      {spec.legs ? door("collection", collection, onCollection, { below: true }) : null}
      <li className="pt-leg" data-dash-above={spec.legs || undefined}>
        <span className="pt-leg-dot" aria-hidden="true" />
        <PlaceField label={t(spec.from.label)} value={origin} onChange={onOrigin} kinds={spec.from.kinds} doors={spec.from.doors} placeholder={t(spec.from.hint)} />
      </li>
      <li className="pt-leg" data-dash-below={spec.legs || undefined}>
        <span className="pt-leg-dot" aria-hidden="true" />
        <PlaceField label={t(spec.to.label)} value={destination} onChange={onDestination} kinds={spec.to.kinds} doors={spec.to.doors} placeholder={t(spec.to.hint)} />
      </li>
      {spec.legs ? door("delivery", delivery, onDelivery, { above: true }) : null}
    </ol>
  );
}
