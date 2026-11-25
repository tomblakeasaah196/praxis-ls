import {
  needsHinterlandDirection,
  servicesOn,
  type HinterlandDirection,
  type QuoteCard,
  type QuoteService,
} from "@/lib/quote-scope";

/*
 * The quote form's first-step pick (card, service, hinterland direction) and
 * its rules, shared by the portal's quote sheet and the website's wizard
 * (meeting 6, PR 2). Moved out of components/quote/quote-service-step.tsx
 * (website v2, PR 3) so the website can load that component lazily: its cards
 * are drawn there only for a payload with no website services.
 */

export type ServicePick = {
  card: QuoteCard | "";
  serviceTypeId: string;
  hinterland: HinterlandDirection | "";
};

export const EMPTY_PICK: ServicePick = { card: "", serviceTypeId: "", hinterland: "" };

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
