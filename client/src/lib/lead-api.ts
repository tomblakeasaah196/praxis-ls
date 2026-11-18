/**
 * Leads (MOD-20): the calls and the words the Lead 360 screens share
 * (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.2).
 *
 * One row per company. What it asks for is a REQUEST (`/quote-requests`), which
 * is also the deal; what happened is an ACTIVITY; what happens next is a dated
 * NEXT STEP. Every payload is validated by `@shared` lead / quoteRequest, the
 * same shapes the API parses with, so a form cannot accept what the route
 * refuses.
 */
import { lead as leadShape, quoteRequest } from "@shared";
import { tenant, tenantPaged } from "@/lib/api-client";
import { tr } from "@/lib/i18n";

/* ── shapes (src/modules/sales/lead, sales-360.service.js) ─────────────────── */

export type NextStep = {
  task_id: string;
  action: string;
  due_at: string | null;
  status?: string;
  assigned_to?: string | null;
  overdue?: boolean;
};

export type LeadRow = {
  lead_id: string;
  company_name: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  status: "OPEN" | "ARCHIVED" | string;
  is_client: boolean;
  client_id?: string | null;
  client_name?: string | null;
  owner_user_id?: string | null;
  owner_name?: string | null;
  source?: string | null;
  archived_reason?: string | null;
  next_step_action?: string | null;
  next_step_due_at?: string | null;
  next_step_overdue?: boolean;
  open_value?: number | string | null;
  open_currency?: string | null;
  open_requests?: number;
};

export type LeadTiles = {
  due_today: number;
  overdue: number;
  open_value: number | null;
  open_currency: string | null;
  money_visible: boolean;
};

export type LeadView = (typeof leadShape.VIEWS)[number];

export type LeadListQuery = {
  view?: LeadView | "";
  due?: "today" | "overdue" | "";
  has_value?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
};

export type LeadPage = { rows: LeadRow[]; total: number; tiles: LeadTiles | null };

export async function listLeads(query: LeadListQuery): Promise<LeadPage> {
  const p = new URLSearchParams();
  if (query.view) p.set("view", query.view);
  if (query.due) p.set("due", query.due);
  if (query.has_value) p.set("has_value", "true");
  if (query.q && query.q.trim()) p.set("q", query.q.trim());
  p.set("limit", String(query.limit ?? 50));
  p.set("offset", String(query.offset ?? 0));
  const res = await tenantPaged<LeadRow[]>(`/leads?${p.toString()}`);
  const tiles = (res.meta?.tiles as LeadTiles | undefined) ?? null;
  return { rows: res.data || [], total: res.total ?? (res.data || []).length, tiles };
}

export type Duplicate = {
  lead_id: string | null;
  client_id: string | null;
  company_name: string;
  is_client: boolean;
  status?: string | null;
  matched_on: ("email" | "phone" | "company")[];
  exact: boolean;
};

export async function findDuplicates(keys: { company_name?: string; email?: string; phone?: string }) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(keys)) if (v && v.trim()) p.set(k, v.trim());
  if (![...p.keys()].length) return { exact: [] as Duplicate[], similar: [] as Duplicate[] };
  return tenant<{ exact: Duplicate[]; similar: Duplicate[] }>(`/leads/duplicates?${p.toString()}`);
}

/** The company row of a client the duplicate check found without one. */
export const clientRow = (clientId: string) =>
  tenant<{ lead_id: string }>(`/leads/clients/${encodeURIComponent(clientId)}/row`, { method: "POST" });

export type ActivityItem = {
  type: "activity" | "meeting" | "mail" | "quotation" | "stage" | "profile_share";
  at: string;
  kind?: string | null;
  title?: string | null;
  body?: string | null;
  author_name?: string | null;
  quote_request_id?: string | null;
  count?: number;
  revoked?: boolean;
  ref: { type: string; id: string };
};

export type RequestCard = {
  quote_request_id: string;
  public_ref?: string | null;
  title?: string | null;
  stage: string;
  intake_channel?: string | null;
  service_name_en?: string | null;
  service_name_fr?: string | null;
  service_category?: string | null;
  incoterm?: string | null;
  origin_location?: string | null;
  destination_location?: string | null;
  estimated_weight?: number | string | null;
  estimated_value?: number | string | null;
  currency?: string | null;
  lost_reason_code?: string | null;
  lost_reason?: string | null;
  settled_at?: string | null;
  dossier_id?: string | null;
  dossier_ref?: string | null;
  created_at?: string;
  quotations?: number;
};

export type QuotationRow = {
  quotation_id: string;
  doc_number?: string | null;
  status: string;
  currency?: string | null;
  total_ttc: number | string | null;
  valid_until?: string | null;
  costing_id?: string | null;
  sent_at?: string | null;
  viewed_at?: string | null;
  quote_request_id?: string | null;
  request_ref?: string | null;
  request_title?: string | null;
  created_at?: string;
};

export type LeadRecord = LeadRow & {
  country?: string | null;
  address?: string | null;
  niu?: string | null;
  rccm?: string | null;
  entity_id?: string | null;
  entity_name?: string | null;
  client_type_hint?: string | null;
  payment_terms_days?: number | null;
  service_interest?: string | null;
  created_at?: string;
};

export type LeadDossier = {
  lead: LeadRecord;
  next_step: NextStep | null;
  next_step_required: boolean;
  counts: { activity: number; requests: number; quotations: number };
  activity: ActivityItem[];
  requests: RequestCard[];
  quotations: QuotationRow[];
  kpis: { money_visible: boolean; open_requests?: number; open_value?: number | null };
  client: { client_id: string; name?: string | null } | null;
};

export const fetchDossier = (leadId: string) => tenant<LeadDossier>(`/leads/${encodeURIComponent(leadId)}/360`);

const post = <T = unknown>(path: string, body?: unknown, method = "POST") => tenant<T>(path, { method, body });
const at = (id: string) => `/leads/${encodeURIComponent(id)}`;

export const captureLead = (body: Record<string, unknown>) => post<LeadRecord>("/leads", body);
export const updateLead = (id: string, patch: Record<string, unknown>) => post<LeadRecord>(at(id), patch, "PATCH");
export const logActivity = (id: string, body: Record<string, unknown>) => post(`${at(id)}/activities`, body);
export const setNextStep = (id: string, step: Record<string, unknown>) => post(`${at(id)}/next-step`, step, "PUT");
export const completeNextStep = (id: string, body: Record<string, unknown>) => post(`${at(id)}/next-step/done`, body);
export const archiveLead = (id: string, body: Record<string, unknown>) => post(`${at(id)}/archive`, body);
export const reopenLead = (id: string, body: Record<string, unknown>) => post(`${at(id)}/reopen`, body);
export const makeClient = (id: string, body: Record<string, unknown>) => post(`${at(id)}/make-client`, body);

/* ── requests: the deal ─────────────────────────────────────────────────── */

const rq = (id: string) => `/quote-requests/${encodeURIComponent(id)}`;
export const fetchRequest = (id: string) => tenant<Record<string, unknown>>(rq(id));
export const moveStage = (id: string, body: Record<string, unknown>) => post(`${rq(id)}/stage`, body);
export const markWon = (id: string, body: Record<string, unknown> = {}) => post(`${rq(id)}/mark-won`, body);

/** The board's cards: one column's requests, newest first. */
export async function boardColumn(stage: string, q = "") {
  const p = new URLSearchParams({ stage, limit: "50", sort: "created_at" });
  if (q.trim()) p.set("q", q.trim());
  const out = await tenant<{ rows?: Record<string, unknown>[]; total?: number }>(`/quote-requests?${p.toString()}`);
  return { rows: out?.rows || [], total: out?.total ?? 0 };
}

/** Where an old opportunity's link lands: the request it became (14512). */
export async function requestForOpportunity(opportunityId: string) {
  const p = new URLSearchParams({ converted_opportunity_id: opportunityId, limit: "1" });
  const out = await tenant<{ rows?: Record<string, unknown>[] }>(`/quote-requests?${p.toString()}`);
  return (out?.rows || [])[0] || null;
}

/* ── meetings ───────────────────────────────────────────────────────────── */

export const scheduleMeeting = (body: Record<string, unknown>) => post<{ meeting_id: string }>("/meetings", body);

/* ── the words ──────────────────────────────────────────────────────────── */

export const STAGES = quoteRequest.STAGES;
export const OPEN_STAGES = quoteRequest.OPEN_STAGES;
export const LOST_REASONS = quoteRequest.LOST_REASONS;
export const ACTIVITY_KINDS = leadShape.ACTIVITY_KINDS;

const STAGE: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  MEETING: "Meeting",
  QUOTED: "Quoted",
  WON: "Won",
  LOST: "Lost",
};
export const stageLabel = (s: string | null | undefined) => (s ? tr(STAGE[s] || s) : "");

const LOST: Record<string, string> = {
  PRICE: "Price",
  TIMING: "Timing",
  COMPETITOR: "Competitor",
  NO_RESPONSE: "No Response",
  OTHER: "Other",
};
export const lostReasonLabel = (s: string | null | undefined) => (s ? tr(LOST[s] || s) : "");

const KIND: Record<string, string> = {
  CALL: "Call",
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  VISIT: "Visit",
  NOTE: "Note",
};
export const activityKindLabel = (s: string | null | undefined) => (s ? tr(KIND[s] || s) : "");

export const VIEW_LABEL: Record<LeadView, string> = {
  mine: "My Next Steps",
  open: "All Open",
  prospects: "Prospects",
  clients: "Clients",
  archived: "Archived",
};

/* ── dates ──────────────────────────────────────────────────────────────── */

const pad = (n: number) => String(n).padStart(2, "0");

/** A local wall-clock moment as `DateTimeField` stores it: `YYYY-MM-DDTHH:mm`. */
export function localMoment(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Tomorrow at 09:00, the default next step's date (§3.2). */
export function tomorrowAtNine(now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return localMoment(d);
}

/**
 * How urgent a next step is, for its colour: red when overdue, amber when due
 * today, nothing otherwise (§3.2).
 */
export function dueTone(dueAt: string | null | undefined, now = new Date()): "bad" | "warn" | null {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;
  if (due.getTime() < now.getTime()) return "bad";
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return due.getTime() <= end.getTime() ? "warn" : null;
}

/** A phone number as a `tel:` / WhatsApp target: digits and a leading plus. */
export const dialable = (phone: string) => phone.replace(/[^\d+]/g, "");
export const whatsappHref = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;
