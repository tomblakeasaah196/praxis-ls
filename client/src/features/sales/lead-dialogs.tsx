/**
 * The Lead 360's write dialogs (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.2).
 *
 * THE LOOP. Done on a next step asks two things in one dialog, What happened?
 * and What's next?, and saves them in ONE write (`/next-step/done`), so the
 * activity and the new step land together or not at all. A company that owes a
 * next step cannot leave without one: the "nothing next" choice is offered only
 * when the API says the row owes none (a client with nothing open), and Archive
 * is the way out otherwise. The server holds the same rule (NEXT_STEP_REQUIRED).
 *
 * Every payload is parsed with the API's own `@shared` lead shapes first, so a
 * field the route refuses is named here, not learned from a 422.
 */
import * as React from "react";
import { lead as leadShape } from "@shared";
import { tr } from "@/lib/i18n";
import { errMsg } from "@/lib/use-resource";
import { useAuth } from "@/app/auth/auth-context";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select as NativeSelect } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Segmented } from "@/components/ui/segmented";
import { ErrorState } from "@/components/ui/states";
import { DateTimeField } from "@/components/ui/datetime-field";
import { SearchSelect } from "@/components/ui/search-select";
import { EntityPicker } from "@/components/entity-picker";
import { Pill } from "@/components/ui/pill";
import { useConfirm } from "@/components/ui/use-confirm";
import {
  ACTIVITY_KINDS,
  LOST_REASONS,
  activityKindLabel,
  archiveLead,
  completeNextStep,
  localMoment,
  logActivity,
  lostReasonLabel,
  makeClient,
  reopenLead,
  scheduleMeeting,
  setNextStep,
  tomorrowAtNine,
  updateLead,
  type LeadRecord,
  type NextStep,
  type RequestCard,
} from "@/lib/lead-api";
import { CLIENT_TYPE_LABEL } from "./lead-capture";

type Kind = (typeof ACTIVITY_KINDS)[number];
const KIND_OPTIONS = ACTIVITY_KINDS.map((k) => ({ value: k as Kind, label: activityKindLabel(k) }));

const firstError = (errors: Record<string, string[] | undefined>) =>
  Object.values(errors).find((v) => v && v.length)?.[0] || null;

/** A request as a picker names it: its reference, then its title. */
const requestText = (r: RequestCard) => [r.public_ref, r.title].filter(Boolean).join(" · ") || tr("Request");

function Footer({ onClose, onSave, busy, disabled, label }: { onClose: () => void; onSave: () => void; busy: boolean; disabled?: boolean; label: string }) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onClick={onClose}>
        {tr("Cancel")}
      </Button>
      <Button onClick={onSave} loading={busy} disabled={disabled || busy}>
        {label}
      </Button>
    </div>
  );
}

/** What and when: the two halves of a next step, as every dialog asks them. */
function StepFields({
  action,
  dueAt,
  onAction,
  onDue,
  disabled,
}: {
  action: string;
  dueAt: string;
  onAction: (v: string) => void;
  onDue: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={tr("Next Step")} required={!disabled}>
        <Input value={action} onChange={(e) => onAction(e.target.value)} disabled={disabled} />
      </Field>
      <Field label={tr("Due")} required={!disabled}>
        <DateTimeField value={dueAt} onChange={onDue} disabled={disabled} required={!disabled} />
      </Field>
    </div>
  );
}

/* ═══════════════════════════════ Done ═══════════════════════════════════ */

export function DoneDialog({
  open,
  lead,
  step,
  taskId,
  nextStepRequired,
  onClose,
  onSaved,
  onArchive,
}: {
  open: boolean;
  lead: LeadRecord;
  step: NextStep | null;
  /** The step completed from My Workspace (`?done=`), when that is how it opened. */
  taskId?: string | null;
  /** The API's reading: whether this row must keep a next step. */
  nextStepRequired: boolean;
  onClose: () => void;
  onSaved: () => void;
  onArchive: () => void;
}) {
  const [kind, setKind] = React.useState<Kind>("CALL");
  const [body, setBody] = React.useState("");
  const [action, setAction] = React.useState("");
  const [dueAt, setDueAt] = React.useState("");
  const [nothingNext, setNothingNext] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setKind("CALL");
    setBody("");
    setAction(leadShape.DEFAULT_NEXT_STEP_ACTION);
    setDueAt(tomorrowAtNine());
    setNothingNext(false);
    setError(null);
  }, [open]);

  async function save() {
    setError(null);
    const payload = {
      ...(taskId ? { task_id: taskId } : {}),
      activity: { kind, body: body.trim() || activityKindLabel(kind) },
      next_step: nothingNext ? null : { action: action.trim(), due_at: dueAt },
    };
    const parsed = leadShape.done.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || tr("Check the form"));
      return;
    }
    setBusy(true);
    try {
      await completeNextStep(lead.lead_id, parsed.data as Record<string, unknown>);
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const ready = nothingNext || (action.trim() !== "" && dueAt !== "");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tr("Done")}
      description={step ? step.action : undefined}
      footer={<Footer onClose={onClose} onSave={() => void save()} busy={busy} disabled={!ready} label={tr("Save")} />}
    >
      <div className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{tr("What Happened?")}</legend>
          <Segmented label={tr("What Happened?")} value={kind} options={KIND_OPTIONS} onChange={setKind} />
          <Input aria-label={tr("What happened, in one line")} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{tr("What's Next?")}</legend>
          <StepFields action={action} dueAt={dueAt} onAction={setAction} onDue={setDueAt} disabled={nothingNext} />
          {nextStepRequired ? (
            <Button variant="ghost" size="sm" onClick={onArchive}>
              {tr("Archive Instead")}
            </Button>
          ) : (
            <Checkbox checked={nothingNext} onCheckedChange={(v) => setNothingNext(v === true)} label={tr("Nothing next for now")} />
          )}
        </fieldset>
        {error ? <ErrorState message={error} /> : null}
      </div>
    </Dialog>
  );
}

/* ═══════════════════════════ Log Activity ═══════════════════════════════ */

export function LogActivityDialog({
  open,
  lead,
  requests,
  onClose,
  onSaved,
}: {
  open: boolean;
  lead: LeadRecord;
  requests: RequestCard[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [kind, setKind] = React.useState<Kind>("CALL");
  const [body, setBody] = React.useState("");
  const [requestId, setRequestId] = React.useState("");
  const [occurredAt, setOccurredAt] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setKind("CALL");
    setBody("");
    setRequestId("");
    setOccurredAt(localMoment(new Date()));
    setError(null);
  }, [open]);

  async function save() {
    const parsed = leadShape.activity.safeParse({
      kind,
      body: body.trim(),
      occurred_at: occurredAt || undefined,
      quote_request_id: requestId || undefined,
    });
    if (!parsed.success) {
      setError(firstError(parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>) || tr("Check the form"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await logActivity(lead.lead_id, parsed.data as Record<string, unknown>);
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tr("Log Activity")}
      footer={<Footer onClose={onClose} onSave={() => void save()} busy={busy} disabled={!body.trim()} label={tr("Log Activity")} />}
    >
      <div className="space-y-4">
        <Segmented label={tr("Kind")} value={kind} options={KIND_OPTIONS} onChange={setKind} />
        <Field label={tr("What Happened")} required>
          <Input value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("When")}>
            <DateTimeField value={occurredAt} onChange={setOccurredAt} />
          </Field>
          {requests.length ? (
            <Field label={tr("Request")}>
              <NativeSelect value={requestId} onChange={(e) => setRequestId(e.target.value)}>
                <option value="">{tr("The company in general")}</option>
                {requests.map((r) => (
                  <option key={r.quote_request_id} value={r.quote_request_id}>
                    {requestText(r)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
        </div>
        {error ? <ErrorState message={error} /> : null}
      </div>
    </Dialog>
  );
}

/* ═══════════════════════════ Next Step ══════════════════════════════════ */

/** Change the next step without logging anything: the card's Change. */
export function NextStepDialog({
  open,
  lead,
  step,
  onClose,
  onSaved,
}: {
  open: boolean;
  lead: LeadRecord;
  step: NextStep | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [action, setAction] = React.useState("");
  const [dueAt, setDueAt] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setAction(step?.action || leadShape.DEFAULT_NEXT_STEP_ACTION);
    setDueAt(step?.due_at ? localMoment(new Date(step.due_at)) : tomorrowAtNine());
    setError(null);
  }, [open, step]);

  async function save() {
    const parsed = leadShape.nextStep.safeParse({ action: action.trim(), due_at: dueAt });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || tr("Check the form"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setNextStep(lead.lead_id, parsed.data as Record<string, unknown>);
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tr("Next Step")}
      footer={<Footer onClose={onClose} onSave={() => void save()} busy={busy} disabled={!action.trim() || !dueAt} label={tr("Save")} />}
    >
      <StepFields action={action} dueAt={dueAt} onAction={setAction} onDue={setDueAt} />
      {error ? <ErrorState message={error} /> : null}
    </Dialog>
  );
}

/* ═══════════════════════════ Archive / Reopen ═══════════════════════════ */

export function ArchiveDialog({
  open,
  lead,
  openRequests,
  onClose,
  onSaved,
}: {
  open: boolean;
  lead: LeadRecord;
  openRequests: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = React.useState<string>("NO_RESPONSE");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  React.useEffect(() => {
    if (!open) return;
    setCode("NO_RESPONSE");
    setReason("");
    setError(null);
  }, [open]);

  async function save() {
    const parsed = leadShape.archive.safeParse({ reason: reason.trim() || lostReasonLabel(code), reason_code: code });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || tr("Check the form"));
      return;
    }
    const ok = await confirm({
      title: `${tr("Archive")} ${lead.company_name}?`,
      body:
        openRequests > 0
          ? `${openRequests} ${tr(openRequests === 1 ? "open request is marked Lost" : "open requests are marked Lost")} (${lostReasonLabel(code)}), ${tr("and its next step is cancelled.")}`
          : tr("Its next step is cancelled. You can reopen it later."),
      confirmLabel: tr("Archive Company"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await archiveLead(lead.lead_id, parsed.data as Record<string, unknown>);
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tr("Archive")}
      description={lead.company_name}
      footer={<Footer onClose={onClose} onSave={() => void save()} busy={busy} label={tr("Archive")} />}
    >
      <div className="space-y-4">
        <Field label={tr("Reason")} required>
          <NativeSelect value={code} onChange={(e) => setCode(e.target.value)}>
            {LOST_REASONS.map((r) => (
              <option key={r} value={r}>
                {lostReasonLabel(r)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={tr("In One Line")}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
        {error ? <ErrorState message={error} /> : null}
      </div>
      {confirmDialog}
    </Dialog>
  );
}

export function ReopenDialog({ open, lead, onClose, onSaved }: { open: boolean; lead: LeadRecord; onClose: () => void; onSaved: () => void }) {
  const [action, setAction] = React.useState("");
  const [dueAt, setDueAt] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setAction(leadShape.DEFAULT_NEXT_STEP_ACTION);
    setDueAt(tomorrowAtNine());
    setError(null);
  }, [open]);

  async function save() {
    const parsed = leadShape.reopen.safeParse({ next_step: { action: action.trim(), due_at: dueAt } });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || tr("Check the form"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reopenLead(lead.lead_id, parsed.data as Record<string, unknown>);
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tr("Reopen")}
      description={lead.company_name}
      footer={<Footer onClose={onClose} onSave={() => void save()} busy={busy} disabled={!action.trim() || !dueAt} label={tr("Reopen")} />}
    >
      <StepFields action={action} dueAt={dueAt} onAction={setAction} onDue={setDueAt} />
      {error ? <ErrorState message={error} /> : null}
    </Dialog>
  );
}

/* ═══════════════════════════ Make Client ════════════════════════════════ */

export function MakeClientDialog({ open, lead, onClose, onSaved }: { open: boolean; lead: LeadRecord; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = React.useState("");
  const [clientType, setClientType] = React.useState("");
  const [terms, setTerms] = React.useState("");
  const [entityId, setEntityId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName(lead.company_name || "");
    setClientType(lead.client_type_hint || "");
    setTerms(lead.payment_terms_days != null ? String(lead.payment_terms_days) : "");
    setEntityId(lead.entity_id || null);
    setError(null);
  }, [open, lead]);

  async function save() {
    const parsed = leadShape.makeClient.safeParse({
      client: {
        name: name.trim() || undefined,
        legal_name: name.trim() || undefined,
        client_type: clientType || undefined,
        payment_terms_days: terms.trim() === "" ? undefined : Number(terms),
        entity_id: entityId || undefined,
      },
    });
    if (!parsed.success) {
      const f = parsed.error.issues[0];
      setError(f?.path.includes("client_type") ? tr("Choose the client type") : f?.path.includes("payment_terms_days") ? tr("Give the payment terms in days") : f?.message || tr("Check the form"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await makeClient(lead.lead_id, parsed.data as Record<string, unknown>);
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tr("Make Client")}
      footer={<Footer onClose={onClose} onSave={() => void save()} busy={busy} disabled={!clientType || terms.trim() === ""} label={tr("Make Client")} />}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={tr("Legal Name")} required className="sm:col-span-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={tr("Client Type")} required>
          <NativeSelect value={clientType} onChange={(e) => setClientType(e.target.value)}>
            <option value="">{tr("Choose…")}</option>
            {leadShape.CLIENT_TYPES.map((c) => (
              <option key={c} value={c}>
                {tr(CLIENT_TYPE_LABEL[c] || c)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={tr("Payment Terms")} required>
          <Input type="number" inputMode="numeric" min={0} max={365} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder={tr("Days")} />
        </Field>
        <Field label={tr("Corporate Entity")} className="sm:col-span-2">
          <EntityPicker value={entityId} onChange={setEntityId} label={tr("Corporate Entity")} />
        </Field>
      </div>
      {error ? <ErrorState message={error} /> : null}
    </Dialog>
  );
}

/* ═══════════════════════════ Schedule Meeting ═══════════════════════════ */

const DURATIONS = [15, 30, 45, 60, 90, 120];

/**
 * Schedule Meeting (§3.2): subject, when, how long, where, who from the staff,
 * and optionally the request it is about. The API writes the meeting AND a
 * calendar event with a reminder, so it lands in My Workspace › Calendar; a
 * request named here moves to Meeting.
 */
export function ScheduleMeetingDialog({
  open,
  lead,
  requests,
  initialRequestId,
  onClose,
  onSaved,
}: {
  open: boolean;
  lead: LeadRecord;
  requests: RequestCard[];
  initialRequestId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [subject, setSubject] = React.useState("");
  const [when, setWhen] = React.useState("");
  const [duration, setDuration] = React.useState("60");
  const [location, setLocation] = React.useState("");
  const [requestId, setRequestId] = React.useState("");
  const [attendees, setAttendees] = React.useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setSubject(`${tr("Meeting with")} ${lead.company_name}`);
    setWhen(tomorrowAtNine());
    setDuration("60");
    setLocation("");
    setRequestId(initialRequestId || "");
    setAttendees(user?.user_id ? [{ id: user.user_id, name: user.display_name || user.email || tr("Me") }] : []);
    setError(null);
  }, [open, lead, initialRequestId, user]);

  async function save() {
    if (!subject.trim() || !when) return;
    setBusy(true);
    setError(null);
    try {
      await scheduleMeeting({
        subject: subject.trim(),
        lead_id: lead.lead_id,
        ...(lead.client_id ? { client_id: lead.client_id } : {}),
        quote_request_id: requestId || null,
        scheduled_at: new Date(when).toISOString(),
        duration_minutes: Number(duration),
        location: location.trim() || null,
        attendee_user_ids: attendees.map((a) => a.id),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const openRequests = requests.filter((r) => r.stage !== "WON" && r.stage !== "LOST");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tr("Schedule Meeting")}
      size="lg"
      footer={<Footer onClose={onClose} onSave={() => void save()} busy={busy} disabled={!subject.trim() || !when} label={tr("Schedule Meeting")} />}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={tr("Subject")} required className="sm:col-span-2">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} />
        </Field>
        <Field label={tr("When")} required>
          <DateTimeField value={when} onChange={setWhen} required />
        </Field>
        <Field label={tr("Duration")}>
          <NativeSelect value={duration} onChange={(e) => setDuration(e.target.value)}>
            {DURATIONS.map((m) => (
              <option key={m} value={String(m)}>
                {m < 60 ? `${m} min` : `${m / 60} h`}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={tr("Location")}>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} />
        </Field>
        {openRequests.length ? (
          <Field label={tr("Request")}>
            <NativeSelect value={requestId} onChange={(e) => setRequestId(e.target.value)}>
              <option value="">{tr("The company in general")}</option>
              {openRequests.map((r) => (
                <option key={r.quote_request_id} value={r.quote_request_id}>
                  {requestText(r)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
        <Field label={tr("Attendees")} className="sm:col-span-2">
          <div className="space-y-2">
            <SearchSelect
              path="/users"
              label={tr("Attendees")}
              value={null}
              placeholder={tr("Add a colleague")}
              getKey={(u) => String(u.user_id)}
              getLabel={(u) => String(u.full_name || u.email || "")}
              filter={(u) => !attendees.some((a) => a.id === String(u.user_id))}
              onSelect={(u) =>
                setAttendees((list) =>
                  list.length >= 20 ? list : [...list, { id: String(u.user_id), name: String(u.full_name || u.email || "") }],
                )
              }
            />
            {attendees.length ? (
              <ul className="flex flex-wrap gap-2">
                {attendees.map((a) => (
                  <li key={a.id}>
                    <Pill tone="mute">
                      {a.name}
                      <button
                        type="button"
                        className="ml-1 text-muted-foreground hover:text-foreground"
                        aria-label={`${tr("Remove")} ${a.name}`}
                        onClick={() => setAttendees((list) => list.filter((x) => x.id !== a.id))}
                      >
                        ×
                      </button>
                    </Pill>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </Field>
      </div>
      {error ? <ErrorState message={error} /> : null}
    </Dialog>
  );
}

/* ═══════════════════════════ Edit ═══════════════════════════════════════ */

const EDIT_FIELDS = ["company_name", "contact_name", "email", "phone", "country", "address", "niu", "rccm"] as const;
type EditKey = (typeof EDIT_FIELDS)[number];
const EDIT_LABEL: Record<EditKey, string> = {
  company_name: "Company or Person",
  contact_name: "Contact Person",
  email: "Email",
  phone: "Phone",
  country: "Country",
  address: "Address",
  niu: "NIU",
  rccm: "RCCM",
};

/** The full company form ("More Details", after capture). */
export function EditLeadDialog({ open, lead, onClose, onSaved }: { open: boolean; lead: LeadRecord; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = React.useState<Record<EditKey, string>>({} as Record<EditKey, string>);
  const [clientType, setClientType] = React.useState("");
  const [terms, setTerms] = React.useState("");
  const [entityId, setEntityId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string[] | undefined>>({});
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const v = {} as Record<EditKey, string>;
    for (const k of EDIT_FIELDS) v[k] = lead[k] != null ? String(lead[k]) : "";
    setValues(v);
    setClientType(lead.client_type_hint || "");
    setTerms(lead.payment_terms_days != null ? String(lead.payment_terms_days) : "");
    setEntityId(lead.entity_id || null);
    setErrors({});
    setError(null);
  }, [open, lead]);

  async function save() {
    const patch: Record<string, unknown> = {};
    for (const k of EDIT_FIELDS) {
      const now = values[k]?.trim() ?? "";
      const was = lead[k] != null ? String(lead[k]) : "";
      if (now !== was) patch[k] = now === "" ? (k === "company_name" ? now : null) : now;
    }
    if ((clientType || "") !== (lead.client_type_hint || "")) patch.client_type_hint = clientType || null;
    const t = terms.trim() === "" ? null : Number(terms);
    if (t !== (lead.payment_terms_days ?? null)) patch.payment_terms_days = t;
    if ((entityId || null) !== (lead.entity_id || null)) patch.entity_id = entityId;
    const parsed = leadShape.update.safeParse(patch);
    if (!parsed.success) {
      setErrors(parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>);
      return;
    }
    if (!Object.keys(patch).length) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateLead(lead.lead_id, parsed.data as Record<string, unknown>);
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tr("Edit Company")}
      size="lg"
      footer={<Footer onClose={onClose} onSave={() => void save()} busy={busy} disabled={!values.company_name?.trim()} label={tr("Save")} />}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {EDIT_FIELDS.map((k) => (
          <Field key={k} label={k === "niu" || k === "rccm" ? EDIT_LABEL[k] : tr(EDIT_LABEL[k])} required={k === "company_name"} error={errors[k]?.[0]}>
            <Input value={values[k] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} />
          </Field>
        ))}
        <Field label={tr("Client Type")}>
          <NativeSelect value={clientType} onChange={(e) => setClientType(e.target.value)}>
            <option value="">{tr("Not known yet")}</option>
            {leadShape.CLIENT_TYPES.map((c) => (
              <option key={c} value={c}>
                {tr(CLIENT_TYPE_LABEL[c] || c)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={tr("Payment Terms")} error={errors.payment_terms_days?.[0]}>
          <Input type="number" inputMode="numeric" min={0} max={365} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder={tr("Days")} />
        </Field>
        <Field label={tr("Corporate Entity")} className="sm:col-span-2">
          <EntityPicker value={entityId} onChange={setEntityId} label={tr("Corporate Entity")} />
        </Field>
      </div>
      {error ? <ErrorState message={error} /> : null}
    </Dialog>
  );
}
