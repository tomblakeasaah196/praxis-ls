/**
 * A client's KYC through the portal, on Client 360 › Documents (tenant review
 * of 29 Sep 2026, PR 1, items 1.1 and 1.2; owner decisions D1 and D2).
 *
 *   ClientSentFiles         every file the client sent through the portal that
 *                           is waiting for review or was sent back — who sent
 *                           it and when — with the same Accept / Send back the
 *                           Portal tab has (same endpoints, same MOD-29 grant).
 *                           Accepted files are simply documents on the tab.
 *   AcceptDocumentDialog    what Accept asks before it files a client's upload
 *                           as a VERIFIED document: the expiry and/or the
 *                           issuing authority, ONLY when the type requires
 *                           them (`clientPortal.acceptFieldsFor`, the rule the
 *                           API refuses an accept by). The number is the
 *                           system's, assigned on save, as on "Add document".
 *   RequestFromClientDialog "Request from client": the SAME types "Add
 *                           document" lists, each with where it stands for
 *                           this client — on file, already requested, missing,
 *                           required to activate — several at once, or "Other
 *                           — describe it". One portal request per type.
 */
import * as React from "react";
import { clientPortal } from "@shared";
import { tr, tv } from "@/lib/i18n";
import { tenant, tenantDownload } from "@/lib/api-client";
import { errMsg, useList, useResource } from "@/lib/use-resource";
import { dateFmt, todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Modal, Field } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/ui/date-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Pill, type Tone } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { usePrompt } from "@/components/ui/use-prompt";
import { useToast } from "@/components/ui/toast";
import type { DocumentType } from "@/lib/masterdata-api";
import type { StaffRequest } from "./client-portal-staff";

/* ── Accept: the fields a type is filed with ─────────────────────────── */

export type AcceptDocument = { issued_on?: string; expires_on?: string; issuing_authority?: string };

/**
 * Ask for what the type requires, then accept. `onAccept` receives the fields
 * (or `{}` for a type that asks nothing) and does the POST; the dialog stays
 * open on a refusal so the reviewer can correct a field rather than start over.
 */
export function AcceptDocumentDialog({
  request,
  onClose,
  onAccept,
}: {
  request: StaffRequest | null;
  onClose: () => void;
  onAccept: (document: AcceptDocument) => Promise<void>;
}) {
  const filesAs = request?.files_as || null;
  const need = clientPortal.acceptFieldsFor(filesAs);
  const [doc, setDoc] = React.useState<AcceptDocument>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [tried, setTried] = React.useState(false);
  React.useEffect(() => {
    setDoc({});
    setError(null);
    setTried(false);
  }, [request]);
  if (!request) return null;

  const missing = clientPortal.missingAcceptFields(filesAs, doc);
  const set = (k: keyof AcceptDocument, v: string) => setDoc((d) => ({ ...d, [k]: v }));

  async function go() {
    setTried(true);
    if (missing.length) return;
    setBusy(true);
    setError(null);
    try {
      await onAccept(doc);
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const typeName = filesAs?.name || filesAs?.code || tr("Other");
  return (
    <Modal
      open
      onClose={onClose}
      title={tv("File as {{type}}", { type: typeName })}
      description={tr("Accepting files it on the Client 360 as verified by you, and updates what is required to activate the client.")}
      footer={
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button loading={busy} onClick={() => void go()}>
            {tr("Accept and file")}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={tr("Number")} hint={tr("Assigned automatically when the document is filed.")}>
          <Input value={tr("Assigned on save")} readOnly className="bg-muted text-muted-foreground" />
        </Field>
        {need.issued_on ? (
          <Field label={tr("Issued")} htmlFor="kyc-accept-issued">
            <DateField id="kyc-accept-issued" value={doc.issued_on || ""} onChange={(v) => set("issued_on", v)} max={todayISO()} />
          </Field>
        ) : null}
        {need.expires_on ? (
          <Field
            label={tr("Expires")}
            htmlFor="kyc-accept-expires"
            required
            error={tried && missing.includes("expires_on") ? tr("This document type is filed with its expiry date.") : undefined}
          >
            <DateField id="kyc-accept-expires" value={doc.expires_on || ""} onChange={(v) => set("expires_on", v)} required />
          </Field>
        ) : null}
        {need.issuing_authority ? (
          <Field
            label={tr("Issuing authority")}
            htmlFor="kyc-accept-authority"
            required
            className="sm:col-span-2"
            error={tried && missing.includes("issuing_authority") ? tr("This document type is filed with who issued it.") : undefined}
          >
            <Input
              id="kyc-accept-authority"
              value={doc.issuing_authority || ""}
              maxLength={200}
              placeholder={tr("Greffe du Tribunal de Commerce de Douala")}
              onChange={(e) => set("issuing_authority", e.target.value)}
            />
          </Field>
        ) : null}
      </div>
      {error ? <ErrorState message={error} /> : null}
    </Modal>
  );
}

/**
 * Accept / Send back / Cancel for one request, with the Accept dialog when the
 * type asks for fields. Shared by the Portal tab and Client 360 › Documents so
 * the two never review differently.
 */
export function useReviewRequest(onDone: () => void) {
  const toast = useToast();
  const [prompt, promptDialog] = usePrompt();
  const [accepting, setAccepting] = React.useState<StaffRequest | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const post = React.useCallback(
    async (r: StaffRequest, decision: "ACCEPT" | "REJECT", body: { note?: string | null; document?: AcceptDocument | null }) => {
      await tenant(`/portal/client-requests/${r.client_request_id}/review`, { method: "POST", body: { decision, ...body } });
      toast.success(
        decision === "ACCEPT"
          ? r.files_as
            ? tr("Accepted — filed on the Client 360.")
            : tr("Accepted — filed on the shipment.")
          : tr("Sent back to the client."),
      );
      onDone();
    },
    [onDone, toast],
  );

  async function accept(r: StaffRequest) {
    if (r.accept_fields?.asks) {
      setAccepting(r);
      return;
    }
    setBusy(r.client_request_id);
    try {
      await post(r, "ACCEPT", {});
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function sendBack(r: StaffRequest) {
    const note = await prompt({
      title: tr("Send this back to the client?"),
      description: tr("They see your reason on the request and can send a new file."),
      label: tr("What is wrong with it"),
      placeholder: tr("Page 2 is missing"),
      multiline: true,
      confirmLabel: tr("Send back"),
      validate: (v) => (v.trim() ? null : tr("Tell the client what to fix.")),
    });
    if (note === null) return;
    setBusy(r.client_request_id);
    try {
      await post(r, "REJECT", { note });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const dialogs = (
    <>
      <AcceptDocumentDialog
        request={accepting}
        onClose={() => setAccepting(null)}
        onAccept={(document) => (accepting ? post(accepting, "ACCEPT", { document }) : Promise.resolve())}
      />
      {promptDialog}
    </>
  );
  return { accept, sendBack, busy, dialogs };
}

/* ── what the client sent, on the 360 ───────────────────────────────── */

const SENT_TONE: Record<string, Tone> = { SUBMITTED: "blue", REJECTED: "bad" };
const SENT_LABEL: Record<string, string> = { SUBMITTED: "To review", REJECTED: "Sent back" };

const sentName = (r: StaffRequest) => r.title || r.doc_type_en || r.doc_type_fr || r.files_as?.name || tr("Document");

/**
 * Every file the client sent that is waiting for review or was sent back.
 * Nothing renders when there is none — the documents below are the list.
 */
export function ClientSentFiles({ clientId, onChanged }: { clientId: string; onChanged?: () => void }) {
  const { rows, error, reload } = useList<StaffRequest>(`/portal/client-requests?client_id=${encodeURIComponent(clientId)}`);
  const toast = useToast();
  const review = useReviewRequest(() => {
    reload();
    onChanged?.();
  });
  const sent = (rows || []).filter((r) => r.answer_doc_id && (r.status === "SUBMITTED" || r.status === "REJECTED"));

  async function open(r: StaffRequest) {
    try {
      await tenantDownload(`/portal/client-requests/${r.client_request_id}/file`, r.answer_doc_name || `${sentName(r)}.pdf`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  if (error) return <ErrorState message={error} />;
  if (!sent.length) return review.dialogs;
  return (
    <section className="space-y-2" aria-labelledby={`sent-${clientId}`}>
      <h5 id={`sent-${clientId}`} className="text-sm font-semibold text-foreground">
        {tr("Sent by the client through the portal")}
      </h5>
      <ul className="divide-y rounded-xl border bg-card">
        {sent.map((r) => (
          <li key={r.client_request_id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold text-foreground">{sentName(r)}</p>
                <Pill tone={SENT_TONE[r.status] || "mute"}>{tr(SENT_LABEL[r.status] || r.status)}</Pill>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {[
                  r.dossier_ref,
                  r.answered_at ? tv("Sent {{date}}", { date: dateFmt(r.answered_at) }) : null,
                  r.answered_by_name || r.answered_by_email
                    ? tv("by {{who}}", { who: r.answered_by_name || r.answered_by_email || "" })
                    : null,
                  r.files_as?.name && !r.dossier_id ? tv("Files as {{type}}", { type: r.files_as.name }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {r.status === "REJECTED" && r.review_note ? (
                <p className="mt-1 text-xs text-[rgb(var(--bad))]">{r.review_note}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void open(r)}>
                {tr("Open file")}
              </Button>
              {r.status === "SUBMITTED" ? (
                <>
                  <Button size="sm" variant="outline" loading={review.busy === r.client_request_id} onClick={() => void review.sendBack(r)}>
                    {tr("Send back")}
                  </Button>
                  <Button size="sm" loading={review.busy === r.client_request_id} onClick={() => void review.accept(r)}>
                    {tr("Accept")}
                  </Button>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {review.dialogs}
    </section>
  );
}

/* ── "Request from client" ──────────────────────────────────────────── */

type DocumentStatus = {
  activation_type_ids: string[];
  on_file: { document_type_id: string; expires_on: string | null; verification_status: string | null }[];
  requested: { document_type_id: string; status: string; created_at: string }[];
};

type Standing =
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

function StandingPill({ standing }: { standing: Standing }) {
  if (standing.kind === "requested") return <Pill tone="blue">{tv("Requested {{date}}", { date: dateFmt(standing.since) })}</Pill>;
  if (standing.kind === "on_file") {
    return (
      <Pill tone={standing.verified ? "ok" : "warn"}>
        {standing.until ? tv("On file · valid until {{date}}", { date: dateFmt(standing.until) }) : tr("On file")}
      </Pill>
    );
  }
  return standing.activation ? <Pill tone="bad">{tr("Required to activate")}</Pill> : <Pill tone="mute">{tr("Missing")}</Pill>;
}

export function RequestFromClientDialog({
  open,
  clientId,
  types,
  onClose,
  onSent,
}: {
  open: boolean;
  clientId: string;
  /** The Documents tab's own list — `listDocumentTypes("CLIENT")` — never a second one. */
  types: DocumentType[];
  onClose: () => void;
  onSent?: () => void;
}) {
  const toast = useToast();
  // Read only while the dialog is open: where each type stands moves with
  // every upload and request, so a copy from before it opened is not wanted.
  const status = useResource<DocumentStatus | null>(
    () => (open ? tenant<DocumentStatus>(`/portal/clients/${encodeURIComponent(clientId)}/document-status`) : Promise.resolve(null)),
    [clientId, open],
    { fresh: true },
  );
  const [q, setQ] = React.useState("");
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [other, setOther] = React.useState(false);
  const [otherText, setOtherText] = React.useState("");
  const [note, setNote] = React.useState("");
  const [dueOn, setDueOn] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setQ("");
    setPicked(new Set());
    setOther(false);
    setOtherText("");
    setNote("");
    setDueOn("");
    setError(null);
  }, [open]);

  if (!open) return null;
  const active = (Array.isArray(types) ? types : []).filter((t) => t.is_active !== false && t.code !== "OTHER");
  const shown = active.filter((t) => !q.trim() || `${t.name} ${t.code}`.toLowerCase().includes(q.trim().toLowerCase()));
  const items = [
    ...[...picked].map((document_type_id) => ({ document_type_id })),
    ...(other ? [{ other: otherText.trim() }] : []),
  ];
  const parsed = clientPortal.documentRequests.safeParse({ items, note, due_on: dueOn });

  function toggle(id: string, on: boolean) {
    setPicked((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function send() {
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || tr("Pick at least one document."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const made = await tenant<unknown[]>(`/portal/clients/${encodeURIComponent(clientId)}/document-requests`, {
        method: "POST",
        body: parsed.data,
      });
      const n = Array.isArray(made) ? made.length : items.length;
      toast.success(n === 1 ? tr("Requested — the client sees it in their portal.") : tv("{{n}} documents requested — the client sees them in their portal.", { n }));
      onSent?.();
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
      size="lg"
      title={tr("Request documents from the client")}
      description={tr("The client is asked in their portal and told by email and on their phone. Shipment documents are requested from the shipment.")}
      footer={
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button loading={busy} disabled={!items.length} onClick={() => void send()}>
            {items.length > 1 ? tv("Request {{n}} documents", { n: items.length }) : tr("Request document")}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <Field label={tr("Find a document type")} htmlFor="kyc-req-q">
          <Input id="kyc-req-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("RCCM, taxpayer card, attestation…")} />
        </Field>
        {status.error ? <ErrorState message={status.error} /> : null}
        <ul className="max-h-80 divide-y overflow-y-auto rounded-xl border bg-card" aria-label={tr("Client document types")}>
          {shown.map((t) => {
            const standing = standingOf(t.document_type_id, status.data);
            const blocked = standing.kind === "requested";
            return (
              <li key={t.document_type_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <Checkbox
                  checked={picked.has(t.document_type_id)}
                  onCheckedChange={(on) => toggle(t.document_type_id, on)}
                  disabled={blocked}
                  label={t.name}
                  hint={blocked ? tr("Already requested — the client has it on their list.") : undefined}
                />
                {status.loading ? null : <StandingPill standing={standing} />}
              </li>
            );
          })}
          {!shown.length ? <li className="px-3 py-4 text-sm text-muted-foreground">{tr("No document type matches.")}</li> : null}
        </ul>
        <div className="grid gap-2">
          <Checkbox checked={other} onCheckedChange={setOther} label={tr("Other — describe it")} hint={tr("A document with no type yet. It is filed under Other when you accept it.")} />
          {other ? (
            <Field label={tr("What you need")} htmlFor="kyc-req-other" required>
              <Input id="kyc-req-other" value={otherText} maxLength={200} onChange={(e) => setOtherText(e.target.value)} placeholder={tr("Lease of the warehouse")} />
            </Field>
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Due by (optional)")} htmlFor="kyc-req-due">
            <DateField id="kyc-req-due" value={dueOn} onChange={setDueOn} min={todayISO()} />
          </Field>
          <Field label={tr("Note to the client (optional)")} htmlFor="kyc-req-note" className="sm:col-span-2">
            <Textarea id="kyc-req-note" value={note} maxLength={2000} rows={3} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        {error ? <ErrorState message={error} /> : null}
      </div>
    </Modal>
  );
}
