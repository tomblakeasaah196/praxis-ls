/**
 * Where one document type stands for a client — on file, already requested,
 * missing, required to activate — the "Request from client" picker's second
 * column (tenant review of 29 Sep 2026, PR 1, item 1.3). Pure, so it is
 * tested on its own.
 */
import { todayISO } from "@/lib/format";

export type DocumentStatus = {
  activation_type_ids: string[];
  on_file: { document_type_id: string; expires_on: string | null; verification_status: string | null }[];
  requested: { document_type_id: string; status: string; created_at: string }[];
};

export type Standing =
  | { kind: "on_file"; until: string | null; verified: boolean }
  | { kind: "requested"; since: string }
  | { kind: "missing"; activation: boolean };

/** Where one type stands for this client — the picker's second column. */
export function standingOf(typeId: string, status: DocumentStatus | null, today = todayISO()): Standing {
  const list = <T,>(v: T[] | undefined | null): T[] => (Array.isArray(v) ? v : []);
  const req = list(status?.requested).find((r) => r.document_type_id === typeId);
  if (req) return { kind: "requested", since: req.created_at };
  const onFile = list(status?.on_file).find((d) => d.document_type_id === typeId);
  if (onFile && (!onFile.expires_on || onFile.expires_on >= today)) {
    return { kind: "on_file", until: onFile.expires_on, verified: onFile.verification_status === "VERIFIED" };
  }
  return { kind: "missing", activation: list(status?.activation_type_ids).includes(typeId) };
}
