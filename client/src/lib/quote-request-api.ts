/**
 * Quote requests — the calls and the words the desk's screens share (tenant
 * review, meeting 6, PR 2): the services a request can name, the client a
 * requester belongs to, a client's own requests, and a chat file filed on one.
 *
 * The WORDS live here too, because four screens draw them — the register, the
 * edit form, the request's 360 and the Client 360 — and §5 of the frontend
 * guide forbids a raw code on screen: a channel is "Client portal", never
 * PORTAL; a duration is "Less than 7 days", never LESS_THAN_7_DAYS.
 */
import { incoterms, quoteRequest, serviceScope, type QuoteDocumentKind, type QuoteFlow, type TransportMode } from "@shared";
import i18n from "i18next";
import { tenant } from "@/lib/api-client";
import { tr } from "@/lib/i18n";

/** A service as a request names it — the API's `/quote-requests/services`. */
export type QuoteServiceOption = {
  service_type_id: string;
  name_en: string;
  name_fr: string;
  card: TransportMode;
  flow: QuoteFlow | null;
  enquiry_shape: "ROUTE" | "STORAGE" | "NONE";
  incoterms: { code: string; name_en: string; name_fr: string; sea_only: boolean }[];
};

export type ClientMatch = {
  suggestion: { client_id: string; name: string; matched_on: "CONTACT_EMAIL" | "CLIENT_EMAIL" | "DOMAIN" } | null;
  candidates: { client_id: string; name: string; matched_on: string }[];
  domain: string | null;
  public_webmail: boolean;
};

export const quoteServices = () => tenant<QuoteServiceOption[]>("/quote-requests/services");

export const clientMatch = (email: string) =>
  tenant<ClientMatch>(`/quote-requests/client-match?email=${encodeURIComponent(email.trim())}`);

/** A client's requests — all, or only those still being worked (`open`). */
export async function clientQuoteRequests(clientId: string, opts: { open?: boolean } = {}) {
  const q = new URLSearchParams({ client_id: clientId, limit: "50" });
  if (opts.open) q.set("open", "1");
  const out = await tenant<{ rows: Record<string, unknown>[] } | { data: { rows: Record<string, unknown>[] } }>(
    `/quote-requests?${q.toString()}`,
  );
  return ("rows" in out ? out.rows : out?.data?.rows) || [];
}

/** "File on a quote request": the chat's file, linked to the request — not copied. */
export const fileChatAttachment = (requestId: string, chatAttachmentId: string, documentKind: QuoteDocumentKind | null) =>
  tenant(`/quote-requests/${encodeURIComponent(requestId)}/attachments/from-chat`, {
    method: "POST",
    body: { chat_attachment_id: chatAttachmentId, ...(documentKind ? { document_kind: documentKind } : {}) },
  });

/* ── the words ──────────────────────────────────────────────────────────── */

const lang = (): "en" | "fr" => (i18n.language?.startsWith("fr") ? "fr" : "en");

/** A service's name in the reader's language. */
export const serviceNameOf = (s: { name_en?: string | null; name_fr?: string | null } | null | undefined): string =>
  !s ? "" : (lang() === "fr" ? s.name_fr || s.name_en : s.name_en || s.name_fr) || "";

const CHANNEL: Record<string, string> = {
  MANUAL: "Keyed in",
  WEBSITE: "Website",
  PORTAL: "Client portal",
  EMAIL: "Email",
  REFERRAL: "Referral",
  CAMPAIGN: "Campaign",
};
/** "Client portal", never PORTAL. */
export const channelLabel = (c: string | null | undefined): string => (c ? tr(CHANNEL[c] || c) : "—");
export const CHANNELS = quoteRequest.INTAKE_CHANNELS;

const DURATION: Record<string, string> = {
  LESS_THAN_7_DAYS: "Less than 7 days",
  DAYS_7_TO_14: "7–14 days",
  DAYS_15_TO_30: "15–30 days",
  OVER_30_DAYS: "Over 30 days",
  UNKNOWN: "Not sure yet",
};
export const durationLabel = (d: string | null | undefined): string => (d ? tr(DURATION[d] || d) : "—");
export const DURATIONS = quoteRequest.WAREHOUSE_DURATIONS;

const CARD: Record<string, string> = {
  SEA: "Sea",
  AIR: "Air",
  RAIL: "Rail",
  ROAD: "Road",
  STORAGE: "Storage",
  CUSTOMS: "Customs",
  OTHER: "Other services",
};
export const cardLabel = (c: string | null | undefined): string => (c ? tr(CARD[c] || c) : "—");
export const CARDS = serviceScope.MODES;

const FLOW: Record<string, string> = {
  IMPORT: "Import",
  EXPORT: "Export",
  END_TO_END: "End-to-end",
  INLAND: "Inland",
  HINTERLAND: "Hinterland",
};
export const flowLabel = (f: string | null | undefined): string => (f ? tr(FLOW[f] || f) : "");

const HINTERLAND: Record<string, string> = { INTO: "Into the hinterland", OUT_OF: "Out of the hinterland" };
export const hinterlandLabel = (d: string | null | undefined): string => (d ? tr(HINTERLAND[d] || d) : "");

const DOC_KIND: Record<string, string> = {
  COMMERCIAL_INVOICE: "Commercial invoice",
  PROFORMA: "Proforma",
  PACKING_LIST: "Packing list",
  BL_AWB: "BL / AWB",
  CARGO_PHOTOS: "Photos of the goods",
  OTHER: "Other document",
};
export const documentKindLabel = (k: string | null | undefined): string => (k ? tr(DOC_KIND[k] || k) : "");
export const DOCUMENT_KINDS = quoteRequest.DOCUMENT_KINDS;

/** "FOB — Free On Board"; TBD reads "To be determined" (what the portal's "Not sure" stores). */
export const incotermLabel = (code: string | null | undefined): string =>
  !code ? "—" : code === incoterms.NOT_SURE ? tr("To be determined") : code === incoterms.NOT_APPLICABLE ? tr("Not applicable") : incoterms.label(code, lang());

/** Where a service sits: "Sea · Import", "Storage". */
export const placementLabel = (card: string | null | undefined, flow: string | null | undefined): string =>
  [cardLabel(card), flowLabel(flow)].filter((x) => x && x !== "—").join(" · ");
