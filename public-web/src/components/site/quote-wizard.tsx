import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Honeypot, Input, Select, Textarea } from "@/components/ui/field";
import { PlaceInput } from "@/components/ui/place-input";
import { Stepper, type Step } from "@/components/ui/stepper";
import { cn } from "@/lib/cn";
import { ErrorState, SuccessState } from "@/components/state";
import { ArrowRightIcon } from "@/components/ui/icons";
import type { QuoteRequest } from "@/lib/intake-api";
import { sendQuoteRequest } from "@/lib/quote-intake";
import type { PlacePick } from "@/lib/places-api";
import { useIntake } from "@/lib/use-intake";
import { useWizardDraft } from "@/lib/use-wizard-draft";
import { getLang } from "@/lib/i18n";
import type { ServiceCard } from "@/lib/services-api";
import {
  asQuoteService,
  incotermToSend,
  INCOTERM_NOT_SURE,
  serviceName,
  type EnquiryShape,
  type QuoteCard,
  type QuoteService,
} from "@/lib/quote-scope";
import { useQuoteDocuments } from "@/lib/use-quote-documents";
import {
  EMPTY_PICK,
  QuoteServiceStep,
  pickedService,
  pickProblems,
  type ServicePick,
} from "@/components/quote/quote-service-step";
import { IncotermChoice } from "@/components/quote/incoterm-choice";
// The shared quote steps' copy lives outside the entry dictionary; see
// quote-steps-i18n.ts. Imported for the side effect.
import "@/components/quote/quote-steps-i18n";

/**
 * The documents step — the file picker, its previews and the compressor — is
 * the fourth of five steps and the heaviest, so it is not in the quote page's
 * own payload (`check-bundle.mjs` caps that at 16 kB). The wizard starts the
 * fetch as soon as it is on screen (`prefetchDocumentsStep` below), so by the
 * time a visitor has answered three steps the chunk is in, and the Suspense
 * fallback is what someone sees only if they get there faster than a request.
 */
const loadDocumentsStep = () => import("@/components/quote/quote-documents");
const QuoteDocumentsStep = React.lazy(() => loadDocumentsStep().then((m) => ({ default: m.QuoteDocumentsStep })));

/**
 * The website's quote desk, as five short questions instead of one wall of
 * fields: what you need, the route, the cargo, the documents, and where to
 * send the answer.
 *
 * ── ONE INTAKE MODEL (tenant review, meeting 6, PR 2) ──────────────────────
 *
 * The first step is the SAME component the client portal's quote sheet uses
 * (`components/quote/quote-service-step`, owner decision Q6): six cards — Sea,
 * Air, Rail, Road under a "Transport" label, then Storage and Customs — read
 * off the tenant's published services, then the flow (Import, Export,
 * End-to-End, Inland, Hinterland) when the card holds more than one, then
 * "into or out of the hinterland" for a hinterland transit. The request then
 * carries the SERVICE TYPE itself (`service_type_id`); it used to post only the
 * service's name and drop the id it knew (item 2.1).
 *
 * The Incoterm is chosen from the terms the SERVICE offers, plus "Not sure"
 * (owner decision Q3) — no list is written into this file any more.
 *
 * Documents are a step of their own and strongly encouraged — the commercial
 * invoice is what lets the desk price — but stay optional: a stranger may not
 * have one yet and must not be turned away (owner decision Q6). They travel in
 * the request itself, with a 0→100 % bar while they go up, and every one lands
 * in the desk's Attachments tab (item 2.7).
 *
 * What was NOT taken from the tenant's old site, and still is not: an
 * `onsubmit="return false;"` that made every `required` decorative (each step
 * validates before it advances, and the same rules gate the final submit), a
 * third-party geocoder (ours goes through our own endpoint and is stored), and
 * `alert()` (errors are inline and designed).
 *
 * ── THE PRE-LAUNCH STATE ───────────────────────────────────────────────────
 *
 * A tenant whose service profiles are still drafts has a live quote page and
 * nothing published. The six cards are then all offered, the visitor types the
 * service in words, no service type is sent, and no Incoterm is asked (there is
 * no service to read the terms from) — the request is filed "to be determined"
 * and the desk follows up.
 */

const WAREHOUSE_DURATIONS = [
  "LESS_THAN_7_DAYS",
  "DAYS_7_TO_14",
  "DAYS_15_TO_30",
  "OVER_30_DAYS",
  "UNKNOWN",
] as const;

/** The website's document ceilings — the intake's own (public_intake.service). */
const DOCS_MAX = 3;
const DOC_MAX_BYTES = 8 * 1024 * 1024;
const DOCS_TOTAL_BYTES = 12 * 1024 * 1024;
/** What the intake can sniff: PDF and the two image formats (no WebP there). */
const DOC_TYPES = ["application/pdf", "image/png", "image/jpeg"];

const EMAIL_RE = /.+@.+\..+/;
const DRAFT_KEY = "praxis.quote.draft";

type Draft = ServicePick & {
  /** Typed only on the pre-launch fallback, where there is no service to pick. */
  service_category: string;
  origin_location: string;
  destination_location: string;
  warehouse_location: string;
  warehouse_duration: string;
  /** A code, or "" for "Not sure". */
  incoterm: string;
  estimated_weight: string;
  project_cargo_flag: boolean;
  cargo_description: string;
  additional_notes: string;
  requester_name: string;
  requester_company: string;
  requester_email: string;
  requester_phone: string;
};

const EMPTY: Draft = {
  ...EMPTY_PICK,
  service_category: "",
  origin_location: "",
  destination_location: "",
  warehouse_location: "",
  warehouse_duration: "",
  incoterm: "",
  estimated_weight: "",
  project_cargo_flag: false,
  cargo_description: "",
  additional_notes: "",
  requester_name: "",
  requester_company: "",
  requester_email: "",
  requester_phone: "",
};

/** Which pair of route labels a card asks for — a port for sea, an airport for air, a place otherwise. */
function routeLabelKeys(card: QuoteCard | ""): { origin: string; destination: string } {
  if (card === "SEA") return { origin: "originPort", destination: "destinationPort" };
  if (card === "AIR") return { origin: "originAirport", destination: "destinationAirport" };
  return { origin: "originPlace", destination: "destinationPlace" };
}

const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });

export function QuoteWizard({
  services: rows = [],
  /**
   * The service this form was opened FROM — a service page's own quote band.
   * The first step arrives already answered, and stays editable: somebody may
   * open the sea page and decide they want the air service.
   */
  preselect = null,
}: {
  services?: ServiceCard[];
  preselect?: ServiceCard | null;
}) {
  const { t } = useTranslation();
  const lang = getLang();
  const services = React.useMemo<QuoteService[]>(() => rows.map(asQuoteService), [rows]);
  const fallback = services.length === 0;
  const [f, setF, clearDraft] = useWizardDraft<Draft>(DRAFT_KEY, EMPTY);
  const [step, setStep] = React.useState(0);
  /** Whether the visitor has changed step yet — see `goTo`. */
  const [moved, setMoved] = React.useState(false);
  const [furthest, setFurthest] = React.useState(0);
  // Shown only after an attempt to advance: pointing at a field somebody has
  // not reached yet is nagging, not validating.
  const [showErrors, setShowErrors] = React.useState(false);
  const [originPick, setOriginPick] = React.useState<PlacePick | null>(null);
  const [destinationPick, setDestinationPick] = React.useState<PlacePick | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  const docs = useQuoteDocuments({
    maxBytes: DOC_MAX_BYTES,
    maxTotalBytes: DOCS_TOTAL_BYTES,
    maxFiles: DOCS_MAX,
    types: DOC_TYPES,
    messages: {
      badType: t("site.quote.fileType"),
      tooBig: t("site.quoteSteps.docsTooBig"),
      tooMany: t("site.quoteSteps.docsTooMany"),
      totalTooBig: t("site.quoteSteps.docsTotalTooBig"),
      unreadable: t("site.quoteSteps.docsUnreadable"),
    },
  });

  // Off the critical path, ahead of need — see `loadDocumentsStep`.
  React.useEffect(() => {
    void loadDocumentsStep();
  }, []);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((s) => ({ ...s, [k]: v }));

  const intake = useIntake<{ received: boolean; reference: string }>({
    send: (body, startedAt) => {
      const q = body as QuoteRequest;
      return sendQuoteRequest(q, startedAt, (pct) => docs.setAllProgress(pct));
    },
    onRateLimited: t("site.quote.limited"),
    onFailed: t("site.quote.err"),
  });

  const chosen = pickedService(services, f);

  /**
   * What this enquiry has to ask — the service's own answer (13774) where one
   * is chosen. On the pre-launch fallback the card is all there is: storage is
   * a place and a duration, anything else a route.
   */
  const shape: EnquiryShape = chosen ? chosen.enquiry_shape : f.card === "STORAGE" ? "STORAGE" : "ROUTE";
  const warehousing = shape === "STORAGE";
  /* No movement to describe, so no step to describe it in. */
  const noRoute = shape === "NONE";

  const preselectId = preselect?.service_type_id || "";
  React.useEffect(() => {
    if (!preselect || !preselectId) return;
    // Never over a draft in progress: somebody who half-filled this form and
    // came back through a different service page keeps what they chose.
    const svc = asQuoteService(preselect);
    setF((prev) => (prev.serviceTypeId || prev.card ? prev : { ...prev, card: svc.card, serviceTypeId: svc.service_type_id, hinterland: "" }));
    // `preselectId` only — the row object is rebuilt on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectId]);

  /**
   * The steps this enquiry actually has. BUILT, not a constant: a no-movement
   * service drops the route step, and everything downstream reads positions
   * out of THIS array — validation switches on a step KEY, never an index.
   */
  const STEPS: Step[] = [
    { key: "need", label: t("site.quote.stepNeed") },
    ...(noRoute ? [] : [{ key: "route", label: warehousing ? t("site.quote.stepStorage") : t("site.quote.stepRoute") }]),
    { key: "details", label: t("site.quote.stepDetails") },
    { key: "documents", label: t("site.quote.stepDocuments") },
    { key: "contact", label: t("site.quote.stepContact") },
  ];
  /* Clamped, because the list can shorten under somebody standing on its last
     step (switch to a no-movement service and the route step disappears). */
  const stepIndex = Math.min(step, STEPS.length - 1);
  const stepKey = STEPS[stepIndex].key;

  /**
   * What each step will not let through. One place, so the "next" button, the
   * step dots and the final submit all agree.
   */
  function problems(key: string): Record<string, string> {
    const out: Record<string, string> = {};
    if (key === "need") {
      Object.assign(out, pickProblems(services, f, t));
      if (fallback && !f.service_category.trim()) out.service_category = t("site.quote.errService");
    }
    if (key === "route") {
      if (warehousing) {
        if (f.warehouse_location.trim().length < 2) out.warehouse_location = t("site.quote.errWarehouse");
      } else {
        if (f.origin_location.trim().length < 2) out.origin_location = t("site.quote.errOrigin");
        if (f.destination_location.trim().length < 2) out.destination_location = t("site.quote.errDestination");
      }
    }
    if (key === "documents" && docs.busy) out.documents = t("site.quoteSteps.docsPreparing");
    if (key === "contact") {
      if (f.requester_name.trim().length < 2) out.requester_name = t("site.quote.errName");
      if (!EMAIL_RE.test(f.requester_email.trim())) out.requester_email = t("site.quote.errEmail");
    }
    return out;
  }

  const localErrors = showErrors ? problems(stepKey) : {};
  const err = (k: string) => localErrors[k] || intake.fields[k] || undefined;

  function goTo(index: number) {
    setStep(index);
    setShowErrors(false);
    // §8.3's step transition arms itself only once the visitor has MOVED, so
    // the first step paints at full opacity with no animation at all.
    setMoved(true);
    // Focus the new step's heading: a screen reader hears which question it
    // is on before being dropped into a field.
    window.requestAnimationFrame(() => headingRef.current?.focus());
  }

  function next() {
    if (Object.keys(problems(stepKey)).length > 0) {
      setShowErrors(true);
      return;
    }
    const to = Math.min(stepIndex + 1, STEPS.length - 1);
    setFurthest((v) => Math.max(v, to));
    goTo(to);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Every step, not just this one — the dots let somebody jump back and
    // leave an earlier one incomplete.
    for (let i = 0; i < STEPS.length; i += 1) {
      if (Object.keys(problems(STEPS[i].key)).length > 0) {
        goTo(i);
        setShowErrors(true);
        return;
      }
    }
    const weight = Number(f.estimated_weight);
    const kept = docs.items.filter((d) => d.state !== "error" && d.file);
    let documents: QuoteRequest["documents"];
    try {
      documents = kept.length
        ? await Promise.all(kept.map(async (d) => ({ data_url: await readAsDataUrl(d.file as File), filename: d.name, document_kind: d.kind })))
        : undefined;
    } catch {
      documents = undefined;
    }
    const body: QuoteRequest = {
      requester_name: f.requester_name.trim(),
      requester_company: f.requester_company.trim() || undefined,
      requester_email: f.requester_email.trim(),
      requester_phone: f.requester_phone.trim() || undefined,
      ...(chosen
        ? {
            service_type_id: chosen.service_type_id,
            service_category: serviceName(chosen, lang),
            ...(f.hinterland ? { hinterland_direction: f.hinterland } : {}),
          }
        : { service_category: f.service_category.trim() }),
      cargo_description: f.cargo_description.trim() || undefined,
      additional_notes: f.additional_notes.trim() || undefined,
      project_cargo_flag: f.project_cargo_flag,
      estimated_weight: Number.isFinite(weight) && weight > 0 ? weight : undefined,
      // The schema requires one. A service with no delivery term sends N/A,
      // "Not sure" — or the pre-launch form, which has no list to ask from —
      // sends TBD: both are answers, not blanks.
      incoterm: chosen ? incotermToSend(chosen, f.incoterm) : warehousing || noRoute ? "N/A" : INCOTERM_NOT_SURE,
      ...(noRoute
        ? {}
        : warehousing
          ? {
              warehouse_location: f.warehouse_location.trim(),
              warehouse_duration: (f.warehouse_duration as QuoteRequest["warehouse_duration"]) || undefined,
            }
          : {
              origin_location: f.origin_location.trim(),
              destination_location: f.destination_location.trim(),
              // Sent only while the text still matches what was picked — the
              // picker clears these the moment the input is edited.
              origin_place: originPick || undefined,
              destination_place: destinationPick || undefined,
            }),
      ...(documents ? { documents } : {}),
    };
    const r = await intake.submit(body);
    if (r) {
      if (documents) docs.setAllProgress(100, true);
      // A submitted draft that survives is a form that reappears pre-filled
      // and invites a duplicate.
      clearDraft();
      docs.reset();
      setOriginPick(null);
      setDestinationPick(null);
    }
  }

  if (intake.result) {
    return (
      <SuccessState
        title={t("site.quote.sent")}
        hint={
          intake.result.reference ? (
            <>
              {t("site.quote.reference")}{" "}
              <span className="num font-semibold text-foreground">{intake.result.reference}</span>
            </>
          ) : undefined
        }
      />
    );
  }

  const labels = routeLabelKeys(f.card);

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <Stepper
        steps={STEPS}
        current={stepIndex}
        furthest={Math.min(furthest, STEPS.length - 1)}
        onGoTo={goTo}
        label={t("site.quote.stepsLabel")}
        counter={t("site.quote.stepCounter", { step: stepIndex + 1, total: STEPS.length })}
      />

      {intake.error && <ErrorState message={intake.error} className="mt-2" />}

      {/* THE HEADING MOVES; THE FIELDS DO NOT. §8.3's rule is "never animate a
          field into place under a cursor", so the rise is confined to the
          heading and the panel below fades without a transform. */}
      <div key={`head-${stepKey}`} className={cn("text-center", moved && "step-head")}>
        <h3 ref={headingRef} tabIndex={-1} className="font-display text-h3 font-semibold tracking-tight outline-none">
          {STEPS[stepIndex].label}
        </h3>
        <p className="mx-auto mt-2 max-w-measure text-muted-foreground">{t(`site.quote.stepHint_${stepKey}`)}</p>
      </div>

      <div key={`panel-${stepKey}`} className={cn(moved && "step-panel")}>
        {stepKey === "need" && (
          <div className="space-y-4">
            <QuoteServiceStep
              services={services}
              value={f}
              onChange={(pick) => setF((prev) => ({ ...prev, ...pick, incoterm: pick.serviceTypeId === prev.serviceTypeId ? prev.incoterm : "" }))}
              variant="site"
              idPrefix="quote"
              errors={{ card: err("card") || err("mode"), service: err("service") || err("service_type_id"), hinterland: err("hinterland") || err("hinterland_direction") }}
            />
            {fallback ? (
              <Input
                label={t("site.quote.service")}
                required
                placeholder={t("site.quote.servicePlaceholder")}
                value={f.service_category}
                error={err("service_category")}
                onChange={(e) => set("service_category", e.target.value)}
              />
            ) : chosen ? (
              <p className="rounded-[calc(var(--radius)-2px)] border bg-[var(--secondary)] px-3 py-2.5 text-sm">
                <span className="text-muted-foreground">{t("site.quote.service")}: </span>
                <span className="font-medium">{serviceName(chosen, lang)}</span>
              </p>
            ) : null}
          </div>
        )}

        {stepKey === "route" && !warehousing && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <PlaceInput
                id="q-origin"
                label={t(`site.quote.${labels.origin}`)}
                required
                value={f.origin_location}
                onChange={(v) => set("origin_location", v)}
                onPick={setOriginPick}
                error={err("origin_location")}
                hint={t("site.quote.placeHint")}
                placeholder={t("site.quote.originPlaceholder")}
              />
              <PlaceInput
                id="q-destination"
                label={t(`site.quote.${labels.destination}`)}
                required
                value={f.destination_location}
                onChange={(v) => set("destination_location", v)}
                onPick={setDestinationPick}
                error={err("destination_location")}
                placeholder={t("site.quote.destinationPlaceholder")}
              />
            </div>
            <IncotermChoice service={chosen} value={f.incoterm} onChange={(code) => set("incoterm", code)} variant="site" idPrefix="quote" />
            {err("incoterm") ? (
              <p role="alert" className="text-sm text-[rgb(var(--bad))]">
                {err("incoterm")}
              </p>
            ) : null}
          </div>
        )}

        {stepKey === "route" && warehousing && (
          <div className="grid gap-4 sm:grid-cols-2">
            <PlaceInput
              id="q-warehouse"
              label={t("site.quote.warehouseLocation")}
              required
              value={f.warehouse_location}
              onChange={(v) => set("warehouse_location", v)}
              // Storage has no route, so nothing is geocoded here: the desk
              // needs the town, not a pin on a warehouse not yet chosen.
              onPick={() => undefined}
              error={err("warehouse_location")}
              placeholder={t("site.quote.warehousePlaceholder")}
            />
            <Select
              label={t("site.quote.warehouseDuration")}
              value={f.warehouse_duration}
              error={err("warehouse_duration")}
              onChange={(e) => set("warehouse_duration", e.target.value)}
              options={[
                { value: "", label: t("site.quote.durationPick") },
                ...WAREHOUSE_DURATIONS.map((d) => ({ value: d, label: t(`site.quote.duration${d}`) })),
              ]}
            />
          </div>
        )}

        {stepKey === "details" && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={t("site.quote.weight")}
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                hint={t("site.quote.weightHint")}
                value={f.estimated_weight}
                error={err("estimated_weight")}
                onChange={(e) => set("estimated_weight", e.target.value)}
              />
              <div className="flex items-end">
                <label className="flex cursor-pointer items-start gap-3 rounded-[calc(var(--radius)-2px)] border p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={f.project_cargo_flag}
                    onChange={(e) => set("project_cargo_flag", e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--brand-orange))]"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{t("site.quote.projectCargo")}</span>
                    <span className="block text-muted-foreground">{t("site.quote.projectCargoHint")}</span>
                  </span>
                </label>
              </div>
            </div>
            <Textarea
              label={t("site.quote.cargo")}
              hint={t("site.quote.cargoHint")}
              rows={4}
              maxLength={5000}
              value={f.cargo_description}
              error={err("cargo_description")}
              onChange={(e) => set("cargo_description", e.target.value)}
            />
          </div>
        )}

        {stepKey === "documents" && (
          <React.Suspense fallback={<p className="text-sm text-muted-foreground">{t("common.loading")}</p>}>
            <QuoteDocumentsStep docs={docs} required={false} variant="site" idPrefix="quote" error={err("documents")} />
          </React.Suspense>
        )}

        {stepKey === "contact" && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={t("site.quote.name")}
                required
                autoComplete="name"
                value={f.requester_name}
                error={err("requester_name")}
                onChange={(e) => set("requester_name", e.target.value)}
              />
              <Input
                label={t("site.quote.company")}
                autoComplete="organization"
                value={f.requester_company}
                error={err("requester_company")}
                onChange={(e) => set("requester_company", e.target.value)}
              />
              <Input
                label={t("site.quote.email")}
                type="email"
                required
                autoComplete="email"
                value={f.requester_email}
                error={err("requester_email")}
                onChange={(e) => set("requester_email", e.target.value)}
              />
              <Input
                label={t("site.quote.phone")}
                type="tel"
                autoComplete="tel"
                value={f.requester_phone}
                error={err("requester_phone")}
                onChange={(e) => set("requester_phone", e.target.value)}
              />
            </div>
            <Textarea
              label={t("site.quote.notes")}
              hint={t("site.quote.notesHint")}
              rows={3}
              maxLength={5000}
              value={f.additional_notes}
              error={err("additional_notes")}
              onChange={(e) => set("additional_notes", e.target.value)}
            />
          </div>
        )}
      </div>

      {/* OUTSIDE the animated panel: the honeypot must be present and inert for
          a scraper on every step. */}
      <Honeypot value={intake.honeypot} onChange={intake.setHoneypot} />

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p className="text-xs text-muted-foreground">{t("site.quote.privacy")}</p>
        <div className="flex items-center gap-2">
          {stepIndex > 0 && (
            <Button type="button" variant="outline" onClick={() => goTo(stepIndex - 1)}>
              {t("common.back")}
            </Button>
          )}
          {stepIndex < STEPS.length - 1 ? (
            <Button type="button" size="lg" onClick={next}>
              {t("site.quote.next")}
              <ArrowRightIcon size={16} className="ml-2" />
            </Button>
          ) : (
            <Button type="submit" size="lg" loading={intake.busy} disabled={intake.busy}>
              {intake.busy ? t("site.quote.sending") : t("site.quote.submit")}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
