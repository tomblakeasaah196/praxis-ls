import * as React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { getLang } from "@/lib/i18n";
import { SelectCard } from "@/components/ui/select-card";
import type { IconComponent } from "@/components/ui/icon-tile";
import { BoxIcon, DocumentIcon, PlaneIcon, ShipIcon, TrainIcon, TruckIcon, WarehouseIcon } from "@/components/ui/icons";
import {
  CARD_ORDER,
  HINTERLAND_DIRECTIONS,
  TRANSPORT_CARDS,
  cardsOf,
  flowOptions,
  needsFlowStep,
  needsHinterlandDirection,
  otherServices,
  serviceName,
  servicesOn,
  type HinterlandDirection,
  type QuoteCard,
  type QuoteService,
} from "@/lib/quote-scope";
// The shared quote steps' copy lives outside the entry dictionary; see
// quote-steps-i18n.ts. Imported for the side effect.
import "@/components/quote/quote-steps-i18n";

/**
 * The first step of every quote request — the client portal's quote sheet and
 * the public website's quote form draw THIS component (tenant review, meeting
 * 6, PR 2, owner decisions Q1, Q2 and Q6).
 *
 *   1. The cards: Sea, Air, Rail, Road under a subtle "Transport" label, then
 *      Storage and Customs — each only when the tenant offers a service there.
 *      Below them, a small "Other services" link opens the services no card
 *      describes, so nothing the tenant sells is unreachable.
 *   2. The flow, when the card holds more than one service: Import, Export,
 *      End-to-End, Inland, Hinterland — only the flows that exist there. Two
 *      services sharing a card and a flow are shown by their names instead.
 *   3. For a hinterland transit, which way: into the hinterland or out of it.
 *
 * A RADIO GROUP at every level (see select-card.tsx for why): one tab stop,
 * arrow keys, and a reader that announces "2 of 6". The two variants differ only
 * in dress — the website's cards are `SelectCard`s with the services named
 * underneath; the portal's are compact chips in its own `pt-chip` style.
 *
 * `services` empty is the website's pre-launch state (nothing published yet):
 * every card is offered, the visitor types the service, and no service type is
 * sent. The portal always has services — it reads every active one.
 */

export type ServicePick = {
  card: QuoteCard | "";
  serviceTypeId: string;
  hinterland: HinterlandDirection | "";
};

export const EMPTY_PICK: ServicePick = { card: "", serviceTypeId: "", hinterland: "" };

const CARD_ICONS: Record<QuoteCard, IconComponent> = {
  SEA: ShipIcon,
  AIR: PlaneIcon,
  RAIL: TrainIcon,
  ROAD: TruckIcon,
  STORAGE: WarehouseIcon,
  CUSTOMS: DocumentIcon,
  OTHER: BoxIcon,
};

/** How many service names a website card lists before "+n more". */
const NAMES_ON_CARD = 3;

/**
 * Pick a card. A card with ONE service answers its own second question, so the
 * service is filled in; a card with several keeps the service only if it still
 * belongs there. The hinterland answer goes with the service it was for.
 */
export function pickCard(services: readonly QuoteService[], prev: ServicePick, card: QuoteCard): ServicePick {
  const on = servicesOn(services, card);
  if (on.length === 1) return { card, serviceTypeId: on[0].service_type_id, hinterland: on[0].service_type_id === prev.serviceTypeId ? prev.hinterland : "" };
  const keep = on.some((s) => s.service_type_id === prev.serviceTypeId);
  return keep ? { ...prev, card } : { card, serviceTypeId: "", hinterland: "" };
}

/** The service a pick names, if any. */
export const pickedService = (services: readonly QuoteService[], pick: ServicePick): QuoteService | null =>
  services.find((s) => s.service_type_id === pick.serviceTypeId) || null;

/** What step 1 will not let through — the same rules for both wizards. */
export function pickProblems(
  services: readonly QuoteService[],
  pick: ServicePick,
  t: (k: string) => string,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!services.length) {
    if (!pick.card) out.card = t("site.quote.errMode");
    return out;
  }
  const svc = pickedService(services, pick);
  if (!pick.card && !svc) out.card = t("site.quote.errMode");
  else if (!svc) out.service = t("site.quoteSteps.errFlow");
  else if (needsHinterlandDirection(svc) && !pick.hinterland) out.hinterland = t("site.quoteSteps.errHinterland");
  return out;
}

function Chip({
  variant,
  name,
  checked,
  onChange,
  children,
  hint,
}: {
  variant: "site" | "portal";
  name: string;
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <label
      className={cn(
        "cursor-pointer",
        variant === "portal"
          ? "pt-chip pt-chip-radio"
          : cn(
              "inline-flex min-h-[44px] items-center gap-2 rounded-[calc(var(--radius)-2px)] border px-3.5 py-2 text-sm",
              "hover:border-[rgb(var(--ink)/0.25)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[rgb(var(--brand-orange))]",
              checked && "border-[rgb(var(--brand-orange))] bg-[rgb(var(--brand-orange)/0.06)] font-semibold shadow-[var(--pick-ring)]",
            ),
        hint && "!h-auto flex-col !items-start !gap-0.5 py-2.5",
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="sr-only" />
      <span>{children}</span>
      {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function QuoteServiceStep({
  services,
  value,
  onChange,
  variant,
  idPrefix = "quote",
  errors = {},
}: {
  services: readonly QuoteService[];
  value: ServicePick;
  onChange: (next: ServicePick) => void;
  variant: "site" | "portal";
  idPrefix?: string;
  errors?: Record<string, string | undefined>;
}) {
  const { t } = useTranslation();
  const lang = getLang();
  const fallback = services.length === 0;
  const cards = fallback ? [...CARD_ORDER] : cardsOf(services);
  const transport = cards.filter((c) => TRANSPORT_CARDS.includes(c));
  const rest = cards.filter((c) => !TRANSPORT_CARDS.includes(c));
  const others = otherServices(services);
  const [showOthers, setShowOthers] = React.useState(value.card === "OTHER");
  const svc = pickedService(services, value);
  const flows = value.card && value.card !== "OTHER" && needsFlowStep(services, value.card) ? flowOptions(services, value.card) : [];

  const err = (k: string) =>
    errors[k] ? (
      <p role="alert" className="mt-2 text-sm text-[rgb(var(--bad))]">
        {errors[k]}
      </p>
    ) : null;

  /** The services under a website card — what the card covers, in the tenant's words. */
  function namesUnder(card: QuoteCard): React.ReactNode {
    const rows = servicesOn(services, card);
    const more = rows.length - NAMES_ON_CARD;
    return (
      <span className="block space-y-0.5">
        {rows.slice(0, NAMES_ON_CARD).map((s) => (
          <span key={s.service_type_id} className="block truncate">
            {serviceName(s, lang)}
          </span>
        ))}
        {more > 0 ? <span className="block opacity-70">{t("site.quote.modeMore", { count: more })}</span> : null}
      </span>
    );
  }

  function card(c: QuoteCard) {
    const Icon = CARD_ICONS[c];
    if (variant === "site") {
      return (
        <SelectCard
          key={c}
          name={`${idPrefix}-card`}
          value={c}
          checked={value.card === c}
          onChange={() => onChange(pickCard(services, value, c))}
          icon={Icon}
          title={t(`site.quote.mode${c}`)}
          description={fallback ? t(`site.quote.mode${c}Hint`) : namesUnder(c)}
        />
      );
    }
    return (
      <label key={c} className="pt-chip pt-chip-radio !h-auto cursor-pointer flex-col !gap-2 !px-2 !py-4">
        <input
          type="radio"
          name={`${idPrefix}-card`}
          checked={value.card === c}
          onChange={() => onChange(pickCard(services, value, c))}
          className="sr-only"
        />
        <span className="text-primary-ink">
          <Icon size={26} />
        </span>
        <span className="text-center text-[0.8rem] leading-tight">{t(`site.quote.mode${c}`)}</span>
      </label>
    );
  }

  const grid = variant === "site" ? "mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" : "mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4";

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className={variant === "site" ? "field-label" : "pt-label"}>{t("site.quote.mode")}</legend>
        {transport.length ? (
          <>
            {/* The subtle label owner decision Q1 asks for: the four movements
                read as one family, storage and customs as two of their own. */}
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("site.quoteSteps.transport")}</p>
            <div className={grid}>{transport.map(card)}</div>
          </>
        ) : null}
        {rest.length ? <div className={cn(grid, "mt-3")}>{rest.map(card)}</div> : null}
        {err("card")}
      </fieldset>

      {others.length ? (
        <div>
          <button
            type="button"
            className="text-sm font-medium text-primary-ink underline underline-offset-4"
            aria-expanded={showOthers}
            onClick={() => setShowOthers((v) => !v)}
          >
            {t("site.quoteSteps.otherServices")}
          </button>
          {showOthers ? (
            <fieldset className="mt-2">
              <legend className="sr-only">{t("site.quoteSteps.otherServices")}</legend>
              <p className="mb-2 text-sm text-muted-foreground">{t("site.quoteSteps.otherServicesHint")}</p>
              <div className="flex flex-wrap gap-2">
                {others.map((s) => (
                  <Chip
                    key={s.service_type_id}
                    variant={variant}
                    name={`${idPrefix}-other`}
                    checked={value.serviceTypeId === s.service_type_id}
                    onChange={() => onChange({ card: "OTHER", serviceTypeId: s.service_type_id, hinterland: "" })}
                  >
                    {serviceName(s, lang)}
                  </Chip>
                ))}
              </div>
            </fieldset>
          ) : null}
        </div>
      ) : null}

      {flows.length ? (
        <fieldset>
          <legend className={variant === "site" ? "field-label" : "pt-label"}>{t("site.quoteSteps.flow")}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {flows.map((o) => (
              <Chip
                key={o.key}
                variant={variant}
                name={`${idPrefix}-flow`}
                checked={value.serviceTypeId === o.service.service_type_id}
                onChange={() =>
                  onChange({
                    card: value.card,
                    serviceTypeId: o.service.service_type_id,
                    hinterland: o.service.service_type_id === value.serviceTypeId ? value.hinterland : "",
                  })
                }
              >
                {o.kind === "flow" ? t(`site.quoteSteps.flow${o.flow}`) : serviceName(o.service, lang)}
              </Chip>
            ))}
          </div>
          {err("service")}
        </fieldset>
      ) : (
        err("service")
      )}

      {needsHinterlandDirection(svc) ? (
        <fieldset>
          <legend className={variant === "site" ? "field-label" : "pt-label"}>{t("site.quoteSteps.hinterland")}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {HINTERLAND_DIRECTIONS.map((d) => (
              <Chip
                key={d}
                variant={variant}
                name={`${idPrefix}-hinterland`}
                checked={value.hinterland === d}
                onChange={() => onChange({ ...value, hinterland: d })}
                hint={t(`site.quoteSteps.hinterland${d}Hint`)}
              >
                {t(`site.quoteSteps.hinterland${d}`)}
              </Chip>
            ))}
          </div>
          {err("hinterland")}
        </fieldset>
      ) : null}
    </div>
  );
}
