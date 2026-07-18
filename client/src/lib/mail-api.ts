/**
 * Mail API (read-only) — per-purpose sender identities (Billing/Documents/
 * Notifications/Support) and the outbound send log. Each section sends from its
 * own verified identity; this surfaces what went out and its delivery state.
 */
import { tenant } from "./api-client";

export type Sender = {
  email_identity_id: string;
  purpose: string;
  from_address: string;
  from_name: string;
  reply_to?: string | null;
  smtp_host?: string | null;
  smtp_port?: number | null;
  is_active: boolean;
};
export type SentMail = {
  email_send_id: string;
  email_identity_id?: string | null;
  to_address: string;
  subject?: string | null;
  entity_ref?: string | null;
  status: string;
  provider_message_id?: string | null;
  error?: string | null;
  queued_at?: string | null;
  sent_at?: string | null;
  purpose?: string | null;
  from_address?: string | null;
  from_name?: string | null;
};

export const listSenders = () => tenant<Sender[]>("/mail/senders");
export const listSent = (identityId?: string) =>
  tenant<SentMail[]>(`/mail/sent${identityId ? `?identity_id=${identityId}` : ""}`);

export type InboundMail = {
  email_inbound_id: string;
  email_identity_id?: string | null;
  from_address: string;
  to_address?: string | null;
  subject?: string | null;
  body_preview?: string | null;
  entity_ref?: string | null;
  is_read?: boolean;
  received_at?: string | null;
  purpose?: string | null;
};
export const listInbox = (identityId?: string) =>
  tenant<InboundMail[]>(`/mail/inbox${identityId ? `?identity_id=${identityId}` : ""}`);

/* identity SMTP/from update, and messaging secrets via the settings store */
export const updateSender = (id: string, patch: Partial<Pick<Sender, "from_name" | "reply_to" | "smtp_host" | "smtp_port" | "is_active">>) =>
  tenant<Sender>(`/mail/senders/${id}`, { method: "PATCH", body: patch });
export const putSetting = (section: string, key: string, value: unknown) =>
  tenant<{ ok?: boolean }>(`/settings/${section}/${key}`, { method: "PUT", body: { value } });

export const upsertSender = (body: { purpose: string; from_address?: string; from_name?: string; reply_to?: string; smtp_host?: string; smtp_port?: number; is_active?: boolean }) =>
  tenant<Sender>("/mail/senders", { method: "POST", body });
