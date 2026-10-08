/**
 * Quote request — write surfaces.
 *
 * Two modals:
 *   - QuoteRequestForm: create / edit. All logistics-scope fields. The
 *     `incoterm` field is required at the validator level (matches the
 *     legacy drawer's required mark). A converted or closed request
 *     cannot be edited — the service rejects it and the form just won't
 *     be openable from the list (the row hides the Edit button).
 *   - ConvertToOpportunityModal: opens a pipeline opportunity from a
 *     QUOTED request. The opportunity starts in NEW — staff move it
 *     through the pipeline from there.
 *
 * Plus AttachmentsPanel, which only appears once the request has been saved:
 * an attachment is linked to a row, and there is nothing to link it to while
 * the form is still a draft in the browser. The upload posts the file itself,
 * not a vault id — the server stores the bytes and writes the link in one
 * transaction, and deletes the stored object if that transaction rolls back,
 * so a failed upload leaves nothing behind on either side.
 */

import * as React from "react";
import { quoteRequest, emailDomain } from "@shared";
import { tr } from "@/lib/i18n";
import { tenant, tenantWithProgress } from "@/lib/api-client";
import { FilePicker } from "@/components/ui/image-upload";
import { UploadProgress } from "@/components/ui/upload-progress";
import { useUpload } from "@/lib/use-upload";
import { fileToDataUrl } from "@/lib/image-compress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal, Field, Select as NativeSelect } from "@/components/ui/modal";
import { Select, type SelectOption } from "@/components/ui/select";
import { SearchSelect } from "@/components/ui/search-select";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/states";
import { Pill } from "@/components/ui/pill";
import { VaultPreviewDialog, type VaultPreviewDocument } from "@/components/vault-preview-dialog";
import { errMsg, useResource, type Row } from "@/lib/use-resource";
import {
  CHANNELS,
  DURATIONS,
  cardLabel,
  channelLabel,
  clientMatch,
  documentKindLabel,
  durationLabel,
  flowLabel,
  hinterlandLabel,
  incotermLabel,
  quoteServices,
  serviceNameOf,
  type ClientMatch,
  type QuoteServiceOption,
} from "@/lib/quote-request-api";

/** The order the service picker groups by — the wizard's cards, then "Other services". */
const CARD_ORDER = ["SEA", "AIR", "RAIL", "ROAD", "STORAGE", "CUSTOMS", "OTHER"];

export type QuoteRequestInitial = {
  requester_name?: string | null;
  requester_company?: string | null;
  requester_email?: string | null;
  requester_phone?: string | null;
  cargo_description?: string | null;
  /** The client the request is for — "New quote request" on the Client 360, or a mail conversion's match. */
  client_id?: string | null;
  client_name?: string | null;
  intake_channel?: string | null;
};

/**
 * The services as the picker's options: grouped by card (Sea, Air, … then
 * Other services), each with its flow underneath — "a picker with a popover"
 * (meeting 6, item 2.1), over the tenant's own service types rather than the
 * ten keys this form used to hard-code.
 */
function serviceOptions(services: QuoteServiceOption[]): SelectOption[] {
  const order = (c: string) => (CARD_ORDER.indexOf(c) === -1 ? 99 : CARD_ORDER.indexOf(c));
  return [...services]
    .sort((a, b) => order(a.card) - order(b.card) || serviceNameOf(a).localeCompare(serviceNameOf(b)))
    .map((sv) => ({
      value: sv.service_type_id,
      label: serviceNameOf(sv),
      text: serviceNameOf(sv),
      hint: flowLabel(sv.flow) || undefined,
      group: cardLabel(sv.card),
    }));
}

const fieldError = (errors: Record<string, string[] | undefined>, k: string) =>
  errors[k] && errors[k]!.length ? errors[k]![0] : undefined;

export function QuoteRequestForm({
  open,
  editing,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: Row | null;
  /** Seed for a NEW request (mail conversion, Client 360). Ignored when `editing` is set. */
  initial?: QuoteRequestInitial | null;
  onClose: () => void;
  /** Receives the created request's id on POST, so callers can link back to it. */
  onSaved: (id?: string | null) => void;
}) {
  const services = useResource(() => (open ? quoteServices() : Promise.resolve([] as QuoteServiceOption[])), [open]);
  const [requesterName, setRequesterName] = React.useState("");
  const [requesterCompany, setRequesterCompany] = React.useState("");
  const [requesterEmail, setRequesterEmail] = React.useState("");
  const [requesterPhone, setRequesterPhone] = React.useState("");
  const [intakeChannel, setIntakeChannel] = React.useState("MANUAL");
  const [clientId, setClientId] = React.useState("");
  const [clientName, setClientName] = React.useState("");
  const [serviceTypeId, setServiceTypeId] = React.useState("");
  const [hinterland, setHinterland] = React.useState("");
  const [origin, setOrigin] = React.useState("");
  // The doors either side of the main leg (14220) — where we collect and
  // where we deliver. Blank on a port-to-port request.
  const [collection, setCollection] = React.useState("");
  const [delivery, setDelivery] = React.useState("");
  const [destination, setDestination] = React.useState("");
  const [warehouseLocation, setWarehouseLocation] = React.useState("");
  const [warehouseDuration, setWarehouseDuration] = React.useState("");
  const [weight, setWeight] = React.useState("");
  const [projectCargo, setProjectCargo] = React.useState(false);
  const [cargo, setCargo] = React.useState("");
  // "To be determined", never a silent FOB (meeting 6, item 2.3).
  const [incoterm, setIncoterm] = React.useState("TBD");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string[] | undefined>>({});
  const [match, setMatch] = React.useState<ClientMatch | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const seed = (v: unknown, fb: unknown) =>
      v !== null && v !== undefined && v !== "" ? String(v) : fb !== null && fb !== undefined && fb !== "" ? String(fb) : "";
    setRequesterName(seed(editing?.requester_name, initial?.requester_name));
    setRequesterCompany(seed(editing?.requester_company, initial?.requester_company));
    setRequesterEmail(seed(editing?.requester_email, initial?.requester_email));
    setRequesterPhone(seed(editing?.requester_phone, initial?.requester_phone));
    setIntakeChannel(seed(editing?.intake_channel, initial?.intake_channel) || "MANUAL");
    setClientId(seed(editing?.client_id, initial?.client_id));
    setClientName(seed(editing?.client_name, initial?.client_name));
    setServiceTypeId(editing?.service_type_id ? String(editing.service_type_id) : "");
    setHinterland(editing?.hinterland_direction ? String(editing.hinterland_direction) : "");
    setOrigin(editing?.origin_location ? String(editing.origin_location) : "");
    setCollection(editing?.collection_location ? String(editing.collection_location) : "");
    setDelivery(editing?.delivery_location ? String(editing.delivery_location) : "");
    setDestination(editing?.destination_location ? String(editing.destination_location) : "");
    setWarehouseLocation(editing?.warehouse_location ? String(editing.warehouse_location) : "");
    setWarehouseDuration(editing?.warehouse_duration ? String(editing.warehouse_duration) : "");
    setWeight(editing?.estimated_weight != null ? String(editing.estimated_weight) : "");
    setProjectCargo(Boolean(editing?.project_cargo_flag));
    setCargo(seed(editing?.cargo_description, initial?.cargo_description));
    setIncoterm(editing?.incoterm ? String(editing.incoterm) : "TBD");
    setError(null);
    setErrors({});
    setMatch(null);
  }, [open, editing, initial]);

  const list = services.data || [];
  const service = list.find((x) => x.service_type_id === serviceTypeId) || null;
  // A request converted or closed keeps the client it had (shared rule).
  const relinkable = quoteRequest.canRelink(editing ? String(editing.status || "") : "RECEIVED");

  /**
   * The client a requester's address belongs to (owner decision Q5): an exact
   * contact first, then the company domain — never Gmail. Offered in one tap,
   * never applied by itself.
   */
  React.useEffect(() => {
    if (!open || clientId || !relinkable) return;
    const email = requesterEmail.trim();
    if (!emailDomain.domainOf(email)) {
      setMatch(null);
      return;
    }
    let live = true;
    const h = window.setTimeout(() => {
      clientMatch(email)
        .then((m) => live && setMatch(m))
        .catch(() => live && setMatch(null));
    }, 350);
    return () => {
      live = false;
      window.clearTimeout(h);
    };
  }, [open, clientId, requesterEmail, relinkable]);

  /** The terms the chosen service offers, "To be determined", and a legacy value kept as it is. */
  const termOptions = React.useMemo(() => {
    const codes = service ? service.incoterms.map((i) => i.code) : [];
    const out = ["TBD", ...codes];
    if (service && service.enquiry_shape !== "ROUTE") out.push("N/A");
    if (incoterm && !out.includes(incoterm)) out.push(incoterm);
    return out;
  }, [service, incoterm]);

  function pickService(id: string) {
    setServiceTypeId(id);
    const next = list.find((x) => x.service_type_id === id);
    if (!next || next.flow !== "HINTERLAND") setHinterland("");
    // A term the new service does not offer goes back to "to be determined".
    if (next && incoterm !== "TBD" && !next.incoterms.some((i) => i.code === incoterm)) setIncoterm(next.enquiry_shape === "ROUTE" ? "TBD" : "N/A");
  }

  async function save() {
    setBusy(true);
    setError(null);
    setErrors({});
    const payload: Record<string, unknown> = {
      requester_name: requesterName || undefined,
      requester_company: requesterCompany || undefined,
      requester_email: requesterEmail || undefined,
      requester_phone: requesterPhone || undefined,
      intake_channel: intakeChannel,
      ...(relinkable ? { client_id: clientId || null } : {}),
      service_type_id: serviceTypeId || (editing?.service_type_id ? null : undefined),
      hinterland_direction: service?.flow === "HINTERLAND" ? hinterland || null : null,
      origin_location: origin || undefined,
      destination_location: destination || undefined,
      collection_location: collection || undefined,
      delivery_location: delivery || undefined,
      warehouse_location: warehouseLocation || undefined,
      warehouse_duration: warehouseDuration || undefined,
      estimated_weight: weight ? Number(weight) : undefined,
      project_cargo_flag: projectCargo,
      cargo_description: cargo || undefined,
      incoterm,
    };
    // The API's own shape (@shared quoteRequest), so a field it refuses is
    // named here rather than learned from a 422 after Save.
    const parsed = (editing ? quoteRequest.staffUpdate : quoteRequest.staffCreate).safeParse(payload);
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>);
      setBusy(false);
      return;
    }
    try {
      let id: string | null = null;
      if (editing?.quote_request_id) {
        await tenant(`/quote-requests/${editing.quote_request_id}`, { method: "PATCH", body: payload });
        id = String(editing.quote_request_id);
      } else {
        const row = await tenant<{ quote_request_id?: string }>(`/quote-requests`, { method: "POST", body: payload });
        id = row?.quote_request_id || null;
      }
      onSaved(id);
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const suggestion = match?.suggestion || null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `${tr("Edit")} ${editing.public_ref || tr("request")}` : tr("Capture quote request")}
      description={tr("The logistics scope of a request for a quote, the service it asks for, and the client it is for.")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button onClick={save} loading={busy}>
            {editing ? tr("Save changes") : tr("Capture request")}
          </Button>
        </div>
      }
    >
      {error && <ErrorState message={error} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field
            label={tr("Client")}
            hint={relinkable ? tr("A request tied to a client appears in their portal, and their account manager owns it.") : tr("A converted or closed request keeps the client it had.")}
            error={fieldError(errors, "client_id")}
          >
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <SearchSelect
                  path="/clients"
                  label={tr("Client")}
                  value={clientName}
                  placeholder={tr("Search clients…")}
                  disabled={!relinkable}
                  getKey={(r) => String(r.client_id)}
                  getLabel={(r) => String(r.name || "")}
                  onSelect={(r) => {
                    setClientId(String(r.client_id));
                    setClientName(String(r.name || ""));
                    if (!requesterCompany) setRequesterCompany(String(r.name || ""));
                  }}
                />
              </div>
              {clientId && relinkable ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setClientId("");
                    setClientName("");
                  }}
                >
                  {tr("Unlink")}
                </Button>
              ) : null}
            </div>
            {!clientId && suggestion ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  {suggestion.matched_on === "DOMAIN" ? tr("Same company domain as") : tr("This address belongs to")}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setClientId(suggestion.client_id);
                    setClientName(suggestion.name);
                    if (!requesterCompany) setRequesterCompany(suggestion.name);
                  }}
                >
                  {`${tr("Link to")} ${suggestion.name}`}
                </Button>
              </div>
            ) : !clientId && match?.public_webmail ? (
              <p className="micro mt-1">{tr("A public webmail address — no client is suggested from its domain.")}</p>
            ) : null}
          </Field>
        </div>
        <Field label={tr("Requester Name")}>
          <Input value={requesterName} onChange={(e) => setRequesterName(e.target.value)} />
        </Field>
        <Field label={tr("Requester Company")}>
          <Input value={requesterCompany} onChange={(e) => setRequesterCompany(e.target.value)} />
        </Field>
        <Field label={tr("Email")} error={fieldError(errors, "requester_email")}>
          <Input type="email" value={requesterEmail} onChange={(e) => setRequesterEmail(e.target.value)} />
        </Field>
        <Field label={tr("Phone")}>
          <Input value={requesterPhone} onChange={(e) => setRequesterPhone(e.target.value)} />
        </Field>
        <Field label={tr("Intake Channel")} error={fieldError(errors, "intake_channel")}>
          <NativeSelect value={intakeChannel} onChange={(e) => setIntakeChannel(e.target.value)}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {channelLabel(c)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={tr("Service")} error={fieldError(errors, "service_type_id")}>
          <Select
            value={serviceTypeId}
            onValueChange={pickService}
            placeholder={services.loading ? tr("Loading…") : tr("Choose a service")}
            options={serviceOptions(list)}
            aria-label={tr("Service")}
          />
          {!serviceTypeId && editing?.service_category ? (
            <p className="micro mt-1">{`${tr("Filed as")} “${String(editing.service_category)}”`}</p>
          ) : null}
        </Field>
        {service?.flow === "HINTERLAND" ? (
          <Field label={tr("Hinterland Direction")} error={fieldError(errors, "hinterland_direction")}>
            <NativeSelect value={hinterland} onChange={(e) => setHinterland(e.target.value)}>
              <option value="">{tr("Not known yet")}</option>
              <option value="INTO">{hinterlandLabel("INTO")}</option>
              <option value="OUT_OF">{hinterlandLabel("OUT_OF")}</option>
            </NativeSelect>
          </Field>
        ) : null}
        <Field label={tr("Incoterm")} required error={fieldError(errors, "incoterm")} hint={service ? undefined : tr("Choose the service first — it decides which terms are offered.")}>
          <NativeSelect value={incoterm} onChange={(e) => setIncoterm(e.target.value)}>
            {termOptions.map((c) => (
              <option key={c} value={c}>
                {incotermLabel(c)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={tr("Origin")}>
          <Input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder={tr("City, Country")} />
        </Field>
        <Field label={tr("Destination")}>
          <Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder={tr("City, Country")} />
        </Field>
        <Field label={tr("Place of Collection")} hint={tr("Door to door: where we collect before the main leg.")}>
          <Input value={collection} onChange={(e) => setCollection(e.target.value)} placeholder={tr("Address, town or warehouse")} />
        </Field>
        <Field label={tr("Place of Delivery")} hint={tr("Door to door: where we deliver after the main leg.")}>
          <Input value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder={tr("Address, town or warehouse")} />
        </Field>
        <Field label={tr("Warehouse Location")}>
          <Input value={warehouseLocation} onChange={(e) => setWarehouseLocation(e.target.value)} />
        </Field>
        <Field label={tr("Warehouse Duration")}>
          <NativeSelect value={warehouseDuration} onChange={(e) => setWarehouseDuration(e.target.value)}>
            <option value="">{tr("Select…")}</option>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {durationLabel(d)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={tr("Estimated Weight (Kg)")} error={fieldError(errors, "estimated_weight")}>
          <Input type="number" step="0.01" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </Field>
        <Field label={tr("Project Cargo")}>
          <NativeSelect value={projectCargo ? "yes" : "no"} onChange={(e) => setProjectCargo(e.target.value === "yes")}>
            <option value="no">{tr("No")}</option>
            <option value="yes">{tr("Yes")}</option>
          </NativeSelect>
        </Field>
        <div className="sm:col-span-2">
          <Field label={tr("Cargo Description")} hint={tr("Up to 5000 characters.")} error={fieldError(errors, "cargo_description")}>
            <Textarea rows={3} value={cargo} onChange={(e) => setCargo(e.target.value)} />
          </Field>
        </div>
      </div>

      {editing ? <AttachmentsPanel requestId={String(editing.quote_request_id)} /> : null}
    </Modal>
  );
}

/** 10 MB, and the types the vault accepts for an enquiry attachment. Kept in
 *  step with service.ATTACHMENT_MAX_BYTES / ATTACHMENT_TYPES — the server is
 *  the enforcer; these exist so a 40 MB file is refused before it is read and
 *  base64-expanded in the browser. */
const ATTACH_MAX_BYTES = 10 * 1024 * 1024;
const ATTACH_ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";

export function AttachmentsPanel({ requestId }: { requestId: string }) {
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [pendingRemove, setPendingRemove] = React.useState<Row | null>(null);
  const [preview, setPreview] = React.useState<VaultPreviewDocument | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res: any = await tenant(`/quote-requests/${requestId}/attachments`);
      setRows(Array.isArray(res) ? res : res?.data || []);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [requestId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  /**
   * Through the upload engine. `kind` is read at send time rather than captured
   * at pick time: the engine re-reads `send` on each attempt, so a retry after
   * another attachment landed still classifies this one correctly.
   */
  const upload = useUpload({
    profile: "document",
    maxBytes: ATTACH_MAX_BYTES,
    send: async (file, ctx) =>
      tenantWithProgress(
        `/quote-requests/${requestId}/attachments`,
        {
          file: await fileToDataUrl(file),
          filename: file.name,
          kind: (rows || []).some((r) => String(r.kind) === "PRIMARY")
            ? "ADDITIONAL"
            : "PRIMARY",
        },
        ctx.onProgress,
      ),
    onAllComplete: () => {
      void load();
    },
  });

  const item = upload.items[0] ?? null;
  const uploading =
    item?.state === "uploading" || item?.state === "compressing";

  React.useEffect(() => {
    // The server's own message is what the operator needs — "this file says it
    // is a PDF but its contents are image/png" is actionable; "Something went
    // wrong" is not.
    if (item?.state === "error" && item.error) setError(item.error);
  }, [item?.state, item?.error]);

  async function remove(row: Row) {
    setBusy(true);
    setError(null);
    try {
      await tenant(`/quote-requests/${requestId}/attachments/${row.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
      setPendingRemove(null);
    }
  }

  return (
    <div className="mt-5 border-t pt-4">
      <div className="flex items-center justify-between">
        <p className="micro">{tr("Attachments")}</p>
        <div className="flex items-center gap-2">
          <FilePicker
            variant="inline"
            accept={ATTACH_ACCEPT}
            disabled={busy || uploading}
            trigger={
              <span className="inline-flex h-9 items-center rounded-lg border px-3 text-sm no-underline">
                {uploading ? "Uploading…" : "Attach a document"}
              </span>
            }
            onPick={(files) => {
              setError(null);
              void upload.pick(files);
            }}
          />
        </div>
      </div>

      {item && item.state !== "idle" && (
        <div className="mt-2 flex items-start gap-3">
          {item.previewUrl && (
            <img
              src={item.previewUrl}
              alt=""
              className="h-12 w-12 rounded border object-cover"
            />
          )}
          <UploadProgress
            className="flex-1"
            state={item.state}
            percent={item.percent}
            error={item.error}
          />
        </div>
      )}
      {error && <ErrorState message={error} />}

      {rows === null ? (
        <p className="mt-2 text-sm text-muted-foreground">{tr("Loading…")}</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing attached yet. PDF or image, up to 10 MB — a packing list, a photo of the cargo, a spec sheet.
        </p>
      ) : (
        <ul className="mt-2 divide-y">
          {rows.map((r) => (
            <li key={String(r.id)} className="flex items-center justify-between gap-2 py-2">
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-sm hover:text-primary-ink hover:underline"
                onClick={() =>
                  r.vault_id
                    ? setPreview({
                        doc_id: String(r.vault_id),
                        title: String(r.original_name || tr("Document")),
                        filename: r.original_name ? String(r.original_name) : null,
                      })
                    : undefined
                }
                disabled={!r.vault_id}
              >
                {String(r.original_name || tr("Document"))}
                {r.document_kind ? <Pill tone="mute" className="ml-2">{documentKindLabel(String(r.document_kind))}</Pill> : null}
                {String(r.kind) === "PRIMARY" ? <span className="micro ml-2">{tr("primary")}</span> : null}
              </button>
              <Button variant="ghost" onClick={() => setPendingRemove(r)}>
                Detach
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!pendingRemove}
        title="Detach this document?"
        body={`${String(pendingRemove?.original_name || "The document")} stays in the vault as a record of what the client sent — detaching only removes it from this request.`}
        confirmLabel="Detach document"
        busy={busy}
        onClose={() => setPendingRemove(null)}
        onConfirm={() => pendingRemove && void remove(pendingRemove)}
      />
      <VaultPreviewDialog document={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

export function ConvertToOpportunityModal({
  request,
  onClose,
  onDone,
}: {
  request: Row | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = React.useState("");
  const [estimatedValue, setEstimatedValue] = React.useState("");
  const [currency, setCurrency] = React.useState("XAF");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!request) return;
    setName(String(request.requester_company || request.requester_name || "Opportunity"));
    setEstimatedValue("");
    setCurrency("XAF");
    setError(null);
  }, [request]);

  async function convert() {
    if (!request) return;
    if (!name.trim()) {
      setError("Opportunity name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await tenant(`/quote-requests/${request.quote_request_id}/convert-to-opportunity`, {
        method: "POST",
        body: {
          opportunity: {
            name,
            estimated_value: estimatedValue ? Number(estimatedValue) : undefined,
            currency,
          },
        },
      });
      onDone();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!request}
      onClose={onClose}
      title="Open opportunity from request"
      description="Creates a tracked opportunity in the pipeline. The opportunity starts in NEW — staff move it from there."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={convert} loading={busy}>
            Open opportunity
          </Button>
        </div>
      }
    >
      {error && <ErrorState message={error} />}
      {request && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Request">
              <p className="font-mono text-sm text-foreground">
                {String(request.public_ref || request.quote_request_id || "—")}
              </p>
              <p className="text-xs text-muted-foreground">
                {String(request.requester_company || "")}
                {request.service_category ? ` · ${String(request.service_category)}` : ""}
                {request.incoterm ? ` · ${String(request.incoterm)}` : ""}
              </p>
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Opportunity Name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Field label="Estimated Value">
            <Input
              type="number"
              step="0.01"
              value={estimatedValue}
              onChange={(e) => setEstimatedValue(e.target.value)}
            />
          </Field>
          <Field label={tr("Currency")}>
            <Input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
            />
          </Field>
        </div>
      )}
    </Modal>
  );
}