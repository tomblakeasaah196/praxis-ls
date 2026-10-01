/**
 * The quote wizard's first step, as data — shared by the client portal's
 * quote sheet and the public website's quote form (tenant review, meeting 6,
 * PR 2, owner decisions Q1, Q2, Q3 and Q6).
 *
 * ── THE MODEL ───────────────────────────────────────────────────────────────
 *
 * A request names a SERVICE TYPE, and a client reaches it in two taps:
 *
 *   card   Sea · Air · Rail · Road (under a subtle "Transport" label), then
 *          Storage and Customs. Each shown only when the tenant offers at least
 *          one service there. A service none of the six describes (Project
 *          Cargo, Business Representation today) is listed under a small
 *          "Other services" link, so nothing the tenant creates is unreachable.
 *   flow   Import · Export · End-to-End · Inland · Hinterland — only the flows
 *          that exist under the picked card. A card holding a single service
 *          skips this step. When two services share one card AND one flow, the
 *          step shows their NAMES instead, so nothing collapses silently.
 *
 * Hinterland transit runs both ways, so it asks one more thing: into the
 * hinterland (import transit, Douala → N'Djamena) or out of it (export
 * transit, Bangui → Douala).
 *
 * Every card and flow comes FROM the tenant's service types — the API sends
 * each service's `card` (its `transport_mode`, 14300) and `flow` (from its
 * territory) — so a service type added in Service types appears here on its
 * own, with no code change. This file decides only the ORDER and grouping; the
 * same rules are `@praxis/shared` rules/service-scope.js on the server, which
 * this app does not import (its first-paint budget — see lib/site-theme.ts).
 *
 * Incoterms come the same way: each service carries the terms it offers,
 * with their names. The wizard offers exactly those, plus "Not sure".
 */

export type QuoteCard = "SEA" | "AIR" | "RAIL" | "ROAD" | "STORAGE" | "CUSTOMS" | "OTHER";
export type QuoteFlow = "IMPORT" | "EXPORT" | "END_TO_END" | "INLAND" | "HINTERLAND";
export type HinterlandDirection = "INTO" | "OUT_OF";
export type EnquiryShape = "ROUTE" | "STORAGE" | "NONE";

export type IncotermOption = {
  code: string;
  name_en: string;
  name_fr: string;
  sea_only: boolean;
};

/** A service as a quote wizard needs it — the shape both the portal and the website endpoints send. */
export type QuoteService = {
  service_type_id: string;
  name_en: string;
  name_fr: string;
  card: QuoteCard;
  flow: QuoteFlow | null;
  enquiry_shape: EnquiryShape;
  incoterms: IncotermOption[];
};

/** The cards in the order they are drawn. OTHER is not a card — it is the link below them. */
export const CARD_ORDER: readonly QuoteCard[] = ["SEA", "AIR", "RAIL", "ROAD", "STORAGE", "CUSTOMS"];
/** The four under the "Transport" label. */
export const TRANSPORT_CARDS: readonly QuoteCard[] = ["SEA", "AIR", "RAIL", "ROAD"];
export const FLOW_ORDER: readonly QuoteFlow[] = ["IMPORT", "EXPORT", "END_TO_END", "INLAND", "HINTERLAND"];
export const HINTERLAND_DIRECTIONS: readonly HinterlandDirection[] = ["INTO", "OUT_OF"];

/** What "Not sure" is stored as; the desk reads it as "To be determined". */
export const INCOTERM_NOT_SURE = "TBD";
/** What a service with no delivery term (storage, representation) sends. */
export const INCOTERM_NONE = "N/A";

export const servicesOn = (services: readonly QuoteService[], card: QuoteCard | null | ""): QuoteService[] =>
  card ? services.filter((s) => s.card === card) : [];

/** The cards this tenant offers at least one service on, in drawing order. */
export function cardsOf(services: readonly QuoteService[]): QuoteCard[] {
  const present = new Set(services.map((s) => s.card));
  return CARD_ORDER.filter((c) => present.has(c));
}

/** The services under "Other services" — the ones no card describes. */
export const otherServices = (services: readonly QuoteService[]): QuoteService[] => servicesOn(services, "OTHER");

/**
 * One chip of the flow step. Usually a FLOW ("Import") naming the one service
 * behind it; when two services share a card and a flow — or a service names no
 * flow at all — each is its own chip, labelled with its name.
 */
export type FlowOption =
  | { key: string; kind: "flow"; flow: QuoteFlow; service: QuoteService }
  | { key: string; kind: "service"; flow: QuoteFlow | null; service: QuoteService };

export function flowOptions(services: readonly QuoteService[], card: QuoteCard | null | ""): FlowOption[] {
  const on = servicesOn(services, card);
  const out: FlowOption[] = [];
  for (const flow of FLOW_ORDER) {
    const group = on.filter((s) => s.flow === flow);
    if (group.length === 1) out.push({ key: `flow:${flow}`, kind: "flow", flow, service: group[0] });
    else for (const s of group) out.push({ key: `svc:${s.service_type_id}`, kind: "service", flow, service: s });
  }
  for (const s of on.filter((x) => !x.flow)) out.push({ key: `svc:${s.service_type_id}`, kind: "service", flow: null, service: s });
  return out;
}

/** True when the picked card needs a second tap — it holds more than one service. */
export const needsFlowStep = (services: readonly QuoteService[], card: QuoteCard | null | ""): boolean =>
  servicesOn(services, card).length > 1;

/** True when the picked service needs "into or out of the hinterland". */
export const needsHinterlandDirection = (service: QuoteService | null | undefined): boolean =>
  !!service && service.flow === "HINTERLAND";

/** A service's name in the reader's language. */
export const serviceName = (s: Pick<QuoteService, "name_en" | "name_fr"> | null | undefined, lang: string): string =>
  !s ? "" : (lang === "fr" ? s.name_fr || s.name_en : s.name_en || s.name_fr) || "";

/** A term's name in the reader's language: "FOB — Free On Board". */
export const incotermLabel = (i: IncotermOption, lang: string): string =>
  `${i.code} — ${lang === "fr" ? i.name_fr : i.name_en}`;

/**
 * The Incoterm a request carries when the step that asks for one is not
 * shown, or was answered "Not sure": none for a service with no delivery term,
 * "to be determined" otherwise.
 */
export function incotermToSend(service: QuoteService | null | undefined, picked: string | null | undefined): string {
  if (service && (service.enquiry_shape !== "ROUTE" || !service.incoterms.length)) return INCOTERM_NONE;
  if (!picked) return INCOTERM_NOT_SURE;
  if (service && !service.incoterms.some((i) => i.code === picked)) return INCOTERM_NOT_SURE;
  return picked;
}

/**
 * What a document sent with a request IS (owner decision Q4) — the commercial
 * invoice first and recommended: it is what lets the team price.
 */
export const DOCUMENT_KINDS = [
  "COMMERCIAL_INVOICE",
  "PROFORMA",
  "PACKING_LIST",
  "BL_AWB",
  "CARGO_PHOTOS",
  "OTHER",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** The glyph vocabulary's word for each card (`mode` on a public service row). */
const CARD_OF_MODE: Record<string, QuoteCard> = {
  SEA: "SEA",
  AIR: "AIR",
  RAIL: "RAIL",
  ROAD: "ROAD",
  WAREHOUSE: "STORAGE",
  STORAGE: "STORAGE",
  CUSTOMS: "CUSTOMS",
};

/**
 * A public service row as the wizard reads it. A payload cached from before
 * the card existed (14300) still lands on the right card through its `mode`,
 * with no Incoterms to offer — the wizard then asks nothing and sends "to be
 * determined", which the desk follows up.
 */
export function asQuoteService(s: {
  service_type_id: string;
  name_en: string;
  name_fr: string;
  enquiry_shape?: EnquiryShape | null;
  card?: QuoteCard | null;
  flow?: QuoteFlow | null;
  incoterms?: IncotermOption[] | null;
  mode?: string | null;
}): QuoteService {
  return {
    service_type_id: s.service_type_id,
    name_en: s.name_en,
    name_fr: s.name_fr,
    card: s.card || CARD_OF_MODE[String(s.mode || "")] || "OTHER",
    flow: s.flow ?? null,
    enquiry_shape: s.enquiry_shape || "ROUTE",
    incoterms: s.incoterms || [],
  };
}
