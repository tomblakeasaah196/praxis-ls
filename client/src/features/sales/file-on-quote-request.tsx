/**
 * "File on a quote request" — a photo or PDF a client sent in their portal
 * chat, put on one of that client's open requests (tenant review, meeting 6,
 * item 2.7).
 *
 * The file is LINKED, not copied: the request points at the same vault row the
 * conversation holds, so the scan the client sent and the scan the request
 * carries are provably one file. Only the client's own requests are offered —
 * the server refuses another client's file anyway — and only open ones, since
 * a closed or converted request takes no new documents.
 */
import * as React from "react";
import { tr, tv } from "@/lib/i18n";
import { Modal, Field, Select as NativeSelect } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingRow } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { errMsg, useResource } from "@/lib/use-resource";
import {
  DOCUMENT_KINDS,
  clientQuoteRequests,
  documentKindLabel,
  fileChatAttachment,
  serviceNameOf,
} from "@/lib/quote-request-api";
import type { QuoteDocumentKind } from "@shared";

export type ChatFile = { attachment_id: string; name: string | null; kind: "IMAGE" | "FILE" | "VOICE" };

export function FileOnQuoteRequestDialog({
  clientId,
  file,
  onClose,
}: {
  clientId: string;
  /** The chat attachment being filed; `null` keeps the dialog closed. */
  file: ChatFile | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const open = !!file;
  const requests = useResource(
    () => (open ? clientQuoteRequests(clientId, { open: true }) : Promise.resolve([])),
    [open, clientId],
  );
  const rows = React.useMemo(() => requests.data || [], [requests.data]);
  const [requestId, setRequestId] = React.useState("");
  const [kind, setKind] = React.useState<QuoteDocumentKind | "">("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setKind(file?.kind === "IMAGE" ? "CARGO_PHOTOS" : "");
  }, [open, file]);
  React.useEffect(() => {
    // The newest open request is the likeliest home; a single one needs no choice.
    if (open && rows.length && !rows.some((r) => String(r.quote_request_id) === requestId)) {
      setRequestId(String(rows[0].quote_request_id));
    }
  }, [open, rows, requestId]);

  async function submit() {
    if (!file || !requestId) return;
    setBusy(true);
    setError(null);
    try {
      await fileChatAttachment(requestId, file.attachment_id, kind || null);
      const r = rows.find((x) => String(x.quote_request_id) === requestId);
      toast.success(tv("Filed on {{ref}}.", { ref: String(r?.public_ref || "") }));
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tr("File on a quote request")}
      description={tr("The request will carry this file as one of its documents. It stays in the conversation too.")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!requestId}>
            {tr("File it")}
          </Button>
        </div>
      }
    >
      {error ? <ErrorState message={error} /> : null}
      {requests.error ? (
        <ErrorState message={requests.error} />
      ) : requests.loading && !requests.data ? (
        <LoadingRow label={tr("Loading quote requests…")} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {tr("This client has no open quote request. Create one from their Client 360 › Quote requests, then file the document on it.")}
        </p>
      ) : (
        <div className="grid gap-3">
          <Field label={tr("File")}>
            <p className="truncate text-sm text-foreground">{file?.name || tr("Document")}</p>
          </Field>
          <Field label={tr("Quote Request")} required>
            <NativeSelect value={requestId} onChange={(e) => setRequestId(e.target.value)}>
              {rows.map((r) => {
                const service = serviceNameOf({ name_en: r.service_name_en as string | null, name_fr: r.service_name_fr as string | null });
                return (
                  <option key={String(r.quote_request_id)} value={String(r.quote_request_id)}>
                    {String(r.public_ref || "")}
                    {service ? ` · ${service}` : ""}
                  </option>
                );
              })}
            </NativeSelect>
          </Field>
          <Field label={tr("What It Is")}>
            <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as QuoteDocumentKind | "")}>
              <option value="">{tr("Not specified")}</option>
              {DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {documentKindLabel(k)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
      )}
    </Modal>
  );
}
