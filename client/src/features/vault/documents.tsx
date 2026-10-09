/**
 * Vault — the document store: upload, browse, download.
 *
 * Split out of `features/vault/pages.tsx` in Phase 4 (audit F7).
 */

import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import * as React from "react";
import { useFocusRow } from "@/lib/use-focus-row";
import { tenant, uploadFile } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { errMsg, useListPaged, useRefresh, type Row } from "@/lib/use-resource";
import { useDebounced } from "@/lib/use-debounced";
import { Pagination } from "@/components/ui/pagination";
import { cell, dateFmt } from "@/lib/format";
import { StatusPill } from "@/components/ui/pill";
import { Chips } from "@/components/ui/chips";
import { downloadVaultDoc } from "@/lib/vault-file";
import { useUpload } from "@/lib/use-upload";
import { FilePicker, UploadList } from "@/components/ui/image-upload";
import {
  VaultPreviewDialog,
  type VaultPreviewDocument,
} from "@/components/vault-preview-dialog";

const FILE_CONTEXTS = [
  /* The product-wide spelling of an empty option, and NOT title-cased here.
     `entity-picker.tsx`, `department-select.tsx` and nine sales forms render
     the same string, one of them pinned by name in entity-picker.test.tsx, so
     retitling this copy alone would put two spellings of one option in the
     product. Its em dashes are a separate job of the same size: §3.18.
     @prose:keep product-wide empty-option label, swept with the other nine. */
  { value: "", label: "— none —" },
  { value: "OPS", label: "Operations" },
  { value: "OVH", label: "Overhead" },
];

function UploadDocumentForm({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [docType, setDocType] = React.useState("");
  const [entityRef, setEntityRef] = React.useState("");
  const [fileContext, setFileContext] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  /**
   * Deferred (`autoStart: false`): the type, reference and context below are
   * typed AFTER the file is chosen and travel in the same request, so the
   * upload waits for Save. The preview and the compression do not wait — both
   * happen the moment the file is picked.
   *
   * `profile: "document"` is the conservative one: a vault scan is downscaled
   * and re-encoded but never tonally corrected, because it has to keep matching
   * the paper it came from. See lib/image-compress.ts.
   */
  const upload = useUpload<{ doc_id: string }>({
    profile: "document",
    autoStart: false,
    maxBytes: 25 * 1024 * 1024,
    send: (picked, ctx) =>
      uploadFile("/tenant/documents", picked, {
        fields: {
          doc_type: docType.trim() || undefined,
          entity_ref: entityRef.trim() || undefined,
          file_context: fileContext || undefined,
          original_name: picked.name,
        },
        onProgress: ctx.onProgress,
        signal: ctx.signal,
      }),
  });

  const item = upload.items[0] ?? null;
  const resetForm = upload.reset;

  React.useEffect(() => {
    if (!open) return;
    resetForm();
    setDocType("");
    setEntityRef("");
    setFileContext("");
    setError(null);
  }, [open, resetForm]);

  const canSubmit = !!item && item.state !== "error" && !busy;

  async function submit() {
    if (!item) return;
    setBusy(true);
    setError(null);
    try {
      const { ok } = await upload.start();
      if (!ok) {
        // The per-item card already names the failure; this keeps the form open
        // rather than closing over a document that never landed.
        setError("That upload did not go through. Try again.");
        return;
      }
      onSaved();
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
      title="Upload Document"
      description="Stored in the confidential vault with a SHA-256 fingerprint (max 25 MB)."
      size="lg"
    >
      <div className="space-y-4">
        <Field label={tr("File")} required>
          <FilePicker
            accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.docx,.xlsx"
            hint="PDF, image, text or Office file · up to 25 MB"
            onPick={(files) => void upload.pick(files)}
          />
        </Field>
        <UploadList
          items={upload.items}
          onRemove={upload.remove}
          onRetry={upload.retry}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Document Type")} hint="e.g. invoice, bill_of_lading">
            <Input
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              placeholder="invoice"
            />
          </Field>
          <Field label="File Context">
            <Select
              value={fileContext}
              onChange={(e) => setFileContext(e.target.value)}
            >
              {FILE_CONTEXTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={tr("Reference")}
            hint="Optional business key (entity_ref)"
            className="sm:col-span-2"
          >
            <Input
              value={entityRef}
              onChange={(e) => setEntityRef(e.target.value)}
              placeholder="DOSSIER-2026-0042"
            />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            Upload
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const DOC_FILTERS = [
  { value: "", label: "All" },
  { value: "VERIFIED", label: "Verified" },
  { value: "ARCHIVED", label: "Archived" },
];
const PAGE_SIZE = 25;

export function DocumentsPage() {
  const reload = useRefresh();
  const [page, setPage] = React.useState(0);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [filter, setFilter] = React.useState("");
  const [q, setQ] = React.useState("");
  const search = useDebounced(q, 300);
  React.useEffect(() => {
    setPage(0);
  }, [filter, search]);
  const { rows, error, total } = useListPaged<Row>("/documents", {
    page,
    pageSize: PAGE_SIZE,
    status: filter || undefined,
    q: search,
  });
  React.useEffect(() => {
    // Archiving the last row on the last page should land on the page before it.
    if (rows?.length === 0 && page > 0) setPage(page - 1);
  }, [rows, page]);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);
  // In-app preview — the same dialog the operations file's Documents tab uses,
  // so a document can be looked at from the vault register without downloading
  // it first. Null when nothing is open.
  const [preview, setPreview] = React.useState<VaultPreviewDocument | null>(
    null,
  );
  // `?focus=<doc_id>` — a ⌘K result or a link — opens that document's preview
  // once the register has loaded it (meeting 6, G5), then drops the param so a
  // closed preview stays closed on refresh.
  const { focusId, clear: clearFocus } = useFocusRow(rows);
  React.useEffect(() => {
    if (!focusId || !rows) return;
    const hit = rows.find((r) => String(r.doc_id) === focusId);
    // A document older than the register's first page is still opened: the
    // preview reads it by id, under the same MOD-64 grant the search used.
    setPreview(
      hit
        ? {
            doc_id: String(hit.doc_id),
            title: hit.original_name
              ? String(hit.original_name)
              : hit.doc_type
                ? String(hit.doc_type)
                : tr("Document"),
            filename:
              hit.original_name == null ? null : String(hit.original_name),
          }
        : { doc_id: focusId, title: tr("Document") },
    );
    clearFocus();
  }, [focusId, rows, clearFocus]);

  async function withRow(id: string, fn: () => Promise<unknown>) {
    setRowBusy(id);
    setRowError(null);
    try {
      await fn();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }
  const archive = (id: string) =>
    withRow(id, async () => {
      await tenant(`/documents/${id}`, { method: "DELETE" });
      reload();
    });
  const download = (r: {
    doc_id: string;
    doc_type?: string | null;
    entity_ref?: string | null;
  }) =>
    withRow(String(r.doc_id), () => {
      // A readable filename from what the row shows: type + reference, never a
      // bare UUID. A real Save-As (anchor click) rather than a pop-up tab —
      // the fetch is awaited first, so window.open after it gets pop-up
      // blocked and the button appears to do nothing.
      const base = [
        r.doc_type
          ? String(r.doc_type).toLowerCase().replace(/[^\w.-]+/g, "_")
          : "document",
        r.entity_ref
          ? String(r.entity_ref).replace(/[^\w.-]+/g, "_")
          : String(r.doc_id).slice(0, 8),
      ].join("-");
      return downloadVaultDoc(String(r.doc_id), `${base}.pdf`);
    });

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Vault & Compliance" to="/vault" />}
        title={tr("Documents")}
        description="Uploaded evidence, held with a tamper-evident fingerprint for each file."
        action={
          <Button onClick={() => setUploadOpen(true)}>Upload document</Button>
        }
      />
      <HubTabs />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Chips
          label="Filter documents by status"
          value={filter}
          options={DOC_FILTERS}
          onChange={setFilter}
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search type / reference…"
          className="max-w-xs"
        />
      </div>

      {rowError && (
        <div className="mb-3">
          <ErrorState message={rowError} />
        </div>
      )}

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filter || search.trim() ? "No documents match" : "No documents yet"}
          hint={
            filter || search.trim()
              ? "Try another filter or search."
              : "Upload a document to the vault."
          }
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>{tr("Type")}</TH>
                <TH>{tr("Reference")}</TH>
                <TH>Ver.</TH>
                <TH>{tr("Status")}</TH>
                <TH>Uploaded</TH>
                <TH>{tr("Actions")}</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => {
                const id = String(r.doc_id);
                const archived =
                  String(r.status ?? "").toUpperCase() === "ARCHIVED";
                return (
                  <TR key={id}>
                    <TD className="text-sm font-medium">{cell(r.doc_type)}</TD>
                    <TD className="text-sm">{cell(r.entity_ref)}</TD>
                    <TD className="num text-sm">{cell(r.version_no)}</TD>
                    <TD className="text-sm">
                      <StatusPill status={String(r.status ?? "—")} />
                    </TD>
                    <TD className="text-sm">{dateFmt(r.created_at)}</TD>
                    <TD>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={archived}
                          onClick={() =>
                            setPreview({
                              doc_id: id,
                              title: r.original_name
                                ? String(r.original_name)
                                : r.doc_type
                                  ? String(r.doc_type)
                                  : tr("Document"),
                              filename:
                                r.original_name == null
                                  ? null
                                  : String(r.original_name),
                            })
                          }
                        >
                          {tr("Preview")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          loading={rowBusy === id}
                          onClick={() =>
                            download({
                              doc_id: String(r.doc_id),
                              doc_type:
                                r.doc_type == null ? undefined : String(r.doc_type),
                              entity_ref:
                                r.entity_ref == null ? undefined : String(r.entity_ref),
                            })
                          }
                        >
                          Download
                        </Button>
                        {!archived && (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={rowBusy === id}
                            onClick={() => archive(id)}
                          >
                            Archive
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={setPage}
            className="flex-col items-start sm:flex-row sm:items-center"
          />
        </>
      )}

      <UploadDocumentForm
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSaved={() => {
          setPage(0);
          reload();
        }}
      />

      <VaultPreviewDialog
        document={preview}
        onClose={() => setPreview(null)}
      />
    </section>
  );
}

/* ═══════════════════════════════════ SIGNATURES ═══════════════════════════════════ */
