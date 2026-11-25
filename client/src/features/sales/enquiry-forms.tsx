/**
 * Contact enquiry — the Manage drawer (F9, doc/SALES_CRM_FEATURES.md#F9).
 *
 * The legacy has one drawer with a status dropdown and a notes box, and it
 * writes both with a single unguarded UPDATE. This one separates the three
 * things an operator actually does, because they are three different acts with
 * three different consequences:
 *
 *   - Classify and annotate      -> PATCH   (never touches status)
 *   - Reply                      -> POST /respond  (sends the email; the
 *                                  enquiry becomes RESPONDED only if it lands)
 *   - Raise Lead                 -> POST /triage   (finds or makes the company row, with a next step; does NOT
 *                                  mark it answered)
 *
 * OPENING THE DRAWER MARKS IT READ. The legacy does this too, and it is what
 * makes the "New (unread)" tile mean unread. It is fired once per open, is
 * idempotent server-side, and its failure is deliberately swallowed: an
 * operator reading a message must never see an error because a bookkeeping
 * write lost a race.
 *
 * REPLY ATTEMPTS ARE SHOWN, INCLUDING THE FAILED ONES. A PENDING row means the
 * send started and we never heard back — the honest answer to "did this go
 * out" is sometimes "we do not know", and hiding that would send the operator
 * to retry blind.
 */

import * as React from "react";
import { tr } from "@/lib/i18n";
import { tenant, tenantDownload, uploadFile } from "@/lib/api-client";
import { FilePicker, UploadList } from "@/components/ui/image-upload";
import { useUpload } from "@/lib/use-upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/pill";
import { cell, dateFmt } from "@/lib/format";
import { errMsg, type Row } from "@/lib/use-resource";
import { useCan, useCanMove } from "@/lib/route-access";
import { transitionActions } from "@praxis/shared";
import { AccessLink } from "@/components/ui/access-link";
import { Callout } from "@/components/ui/callout";
import { useDuplicateCheck } from "./lead-capture";

const ENQUIRY_TYPES = ["GENERAL_ENQUIRY", "PARTNERSHIP", "CAREERS", "MEDIA"];

const TYPE_LABEL: Record<string, string> = {
  GENERAL_ENQUIRY: "General enquiry",
  PARTNERSHIP: "Partnership",
  CAREERS: "Careers",
  MEDIA: "Media",
};

const NOTES_MAX = 5000;
const BODY_MAX = 20000;

/**
 * A sent reply, collapsed.
 *
 * Bodies are bounded at 20 000 characters server-side, and the history is
 * newest-first — so an unclamped list pushes the reply box, which is the thing
 * the operator came here to use, an arbitrary distance off screen. Collapsed by
 * default, expandable in place, and never truncated in the data: the full text
 * is in the DOM, only its height is capped.
 */
function ReplyBody({ text }: { text: string }) {
  const [open, setOpen] = React.useState(false);
  const long = text.length > 400;
  return (
    <div className="mt-1">
      <p
        className={`whitespace-pre-wrap text-xs text-foreground ${
          long && !open ? "line-clamp-4" : ""
        }`}
      >
        {text}
      </p>
      {long && (
        <button
          type="button"
          className="mt-1 text-xs font-medium text-primary-ink underline underline-offset-2"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Show less" : "Show full reply"}
        </button>
      )}
    </div>
  );
}

export function ManageEnquiryModal({
  enquiry,
  onClose,
  onDone,
}: {
  enquiry: Row | null;
  onClose: () => void;
  onDone: () => void;
}) {
  // Reply, triage, close and reopen are all `edit` on the enquiry routes.
  const mayEdit = useCan("MOD-25")("edit");
  const mayMove = useCanMove("MOD-25", transitionActions.inboundIntakeTransition);
  const open = !!enquiry;
  const id = enquiry ? String(enquiry.contact_enquiry_id) : "";

  const [detail, setDetail] = React.useState<Row | null>(null);
  const [type, setType] = React.useState("GENERAL_ENQUIRY");
  const [notes, setNotes] = React.useState("");
  const [reply, setReply] = React.useState("");
  const [subject, setSubject] = React.useState("");
  /* Files on the reply (14623): picked, previewed and compressed now, uploaded
     on Send. Profile "document": a scan is never tonally corrected. */
  const upload = useUpload<{ doc_id: string }>({
    profile: "document",
    multiple: true,
    maxBytes: 15 * 1024 * 1024,
    autoStart: false,
    send: (file, ctx) =>
      uploadFile<{ doc_id: string }>(`/tenant/intake/enquiries/${enquiry ? String(enquiry.contact_enquiry_id) : ""}/reply-attachments`, file, {
        onProgress: ctx.onProgress,
        signal: ctx.signal,
      }),
  });
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!id) return;
    try {
      const out: any = await tenant(`/intake/enquiries/${id}`);
      const row = (out && !out.data && out.contact_enquiry_id ? out : out?.data) || out || null;
      setDetail(row);
      setType(String(row?.enquiry_type || "GENERAL_ENQUIRY"));
      setNotes(String(row?.internal_notes || ""));
      setSubject(`Re: ${row?.subject ? String(row.subject) : "your enquiry"}`);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [id]);

  React.useEffect(() => {
    if (!enquiry) return;
    setError(null);
    setNotice(null);
    setReply("");
    void load();
    // Mark read on open. Fire-and-forget by design — see the header. The list
    // is refreshed by whichever real action follows, or on close.
    if (String(enquiry.status) === "NEW") {
      void tenant(`/intake/enquiries/${String(enquiry.contact_enquiry_id)}/read`, {
        method: "POST",
        body: {},
      })
        .then(() => onDone())
        .catch(() => { /* a read receipt must never interrupt reading */ });
    }
  }, [enquiry, load, onDone]);

  const status = String(detail?.status || enquiry?.status || "NEW");
  const closed = status === "CLOSED";
  const responses = Array.isArray(detail?.responses) ? (detail!.responses as Row[]) : [];
  const alreadyLead = !!detail?.lead_id;
  // Raise Lead runs the capture's duplicate check (§3.3): the enquiry lands on
  // the company already on file, and the desk says which before the click.
  const dupes = useDuplicateCheck(
    {
      company_name: detail?.company_name ? String(detail.company_name) : "",
      email: detail?.email ? String(detail.email) : "",
      phone: detail?.phone ? String(detail.phone) : "",
    },
    !!enquiry && !!detail && !alreadyLead,
  );
  const match = dupes[0] || null;

  /** Returns whether the action succeeded — callers must not discard the
   *  operator's typing on a failure. */
  async function run(kind: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(ok);
      await load();
      onDone();
      return true;
    } catch (e) {
      setError(errMsg(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const saveDetails = () =>
    run(
      "save",
      () => tenant(`/intake/enquiries/${id}`, { method: "PATCH", body: { enquiry_type: type, internal_notes: notes } }),
      "Saved.",
    );

  /** The reply box is cleared ONLY on a successful send. A failed send is the
   *  case where the operator most needs their words back — SMTP refusing the
   *  recipient must not also delete what they wrote. */
  const sendReply = async () => {
    // Files go up first (14623), then the reply names them. A file that failed
    // to upload stops the send, so nobody receives a reply missing its rate sheet.
    const staged = upload.items.length ? await upload.start() : { ok: true as const, results: [] as { doc_id: string }[] };
    if (!staged.ok) {
      setError(tr("A file did not upload. Remove it or try again before sending."));
      return;
    }
    const docIds = upload.items.map((i) => (i.result as { doc_id?: string } | null)?.doc_id).filter(Boolean) as string[];
    const sent = await run(
      "reply",
      () => tenant(`/intake/enquiries/${id}/respond`, {
        method: "POST",
        body: { body: reply, subject, ...(docIds.length ? { attachment_doc_ids: docIds } : {}) },
      }),
      "Reply sent. The enquiry is now marked responded.",
    );
    if (sent) {
      setReply("");
      upload.reset();
    }
  };

  const triage = () =>
    run(
      "triage",
      () => tenant(`/intake/enquiries/${id}/triage`, { method: "POST", body: { to_lead: true } }),
      tr("Lead raised. The next step is on your desk."),
    );

  const move = (to: string, ok: string) =>
    run("move", () => tenant(`/intake/enquiries/${id}/transition`, { method: "POST", body: { to } }), ok);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Manage Enquiry"
      description="Classify it, answer it, route it into the funnel, or close it."
      headerRight={<StatusPill status={status} />}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex gap-2">
            {closed
              ? mayMove("READ") && (
                  <Button variant="outline" loading={busy === "move"} onClick={() => move("READ", "Reopened.")}>
                    Reopen
                  </Button>
                )
              : mayMove("CLOSED") && (
                  <Button variant="ghost" loading={busy === "move"} onClick={() => move("CLOSED", "Closed.")}>
                    Close enquiry
                  </Button>
                )}
          </div>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {error && <ErrorState message={error} />}
        {notice && (
          <p className="rounded-lg bg-[rgb(var(--ok)_/_0.08)] px-3 py-2 text-sm text-[rgb(var(--ok))]">{notice}</p>
        )}

        {/* The message as it was sent. Read-only: this is what the person
            wrote, and an editable copy of it is evidence nobody can trust. */}
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-sm font-semibold text-foreground">
            {cell(detail?.subject) === "—" ? "(no subject)" : cell(detail?.subject)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {[cell(detail?.name), cell(detail?.company_name), cell(detail?.email), cell(detail?.phone)]
              .filter((x) => x !== "—")
              .join(" · ") || "Anonymous"}
            {" · "}
            {dateFmt(detail?.created_at as string)}
          </p>
          <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">
            {cell(detail?.message) === "—" ? "(no message body)" : String(detail?.message)}
          </p>
          {/* Website v2, PR 2: the reference the visitor was given, where they
              wrote from, and whether the two emails left. */}
          {detail?.public_ref ? (
            <p className="mt-3 text-xs text-muted-foreground">
              <span className="font-mono font-semibold text-foreground">{String(detail.public_ref)}</span>
              {detail?.origin_page ? ` · ${String(detail.origin_page)}` : ""}
              {" · "}
              {detail?.inbox_notified_at ? tr("Emailed to the website inbox") : tr("Not emailed to the website inbox")}
            </p>
          ) : null}
          {detail?.mail_error ? (
            <p className="mt-1 text-xs text-[rgb(var(--bad))]">{String(detail.mail_error)}</p>
          ) : null}
          {Array.isArray(detail?.attachments) && (detail?.attachments as Row[]).length ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {(detail?.attachments as Row[]).map((a) => (
                <li key={String(a.doc_id)}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void tenantDownload(
                        `/intake/enquiries/${id}/attachments/${String(a.doc_id)}`,
                        String(a.original_name || "attachment"),
                      ).catch((e) => setError(errMsg(e)))
                    }
                  >
                    {String(a.original_name || "attachment")}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* Classification + notes. One PATCH, and it cannot move the status. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Enquiry Type">
            <Select value={type} onChange={(e) => setType(e.target.value)} disabled={closed}>
              {ENQUIRY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            {mayEdit && (
              <Button variant="outline" loading={busy === "save"} disabled={closed} onClick={saveDetails}>
                Save details
              </Button>
            )}
          </div>
        </div>

        <Field label="Internal Notes" hint={`Not sent to anyone. ${notes.length}/${NOTES_MAX}.`}>
          <Textarea
            rows={3}
            value={notes}
            maxLength={NOTES_MAX}
            disabled={closed}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What was decided, who is handling it…"
          />
        </Field>

        {/* Reply. The only thing that can make this enquiry RESPONDED. */}
        <div className="rounded-lg border p-3">
          <p className="mb-3 text-sm font-semibold text-foreground">Reply by email</p>
          {!detail?.email ? (
            <p className="text-sm text-muted-foreground">
              This enquiry was submitted without an email address, so there is nowhere to reply to. Record
              the outcome in the notes and close it.
            </p>
          ) : (
            <div className="space-y-3">
              <Field label={tr("To")}>
                <Input value={String(detail.email)} readOnly disabled />
              </Field>
              <Field label={tr("Subject")}>
                <Input value={subject} disabled={closed} onChange={(e) => setSubject(e.target.value)} />
              </Field>
              <Field label="Message" hint={`${reply.length}/${BODY_MAX}. Sent from the tenant's support address.`}>
                <Textarea
                  rows={6}
                  value={reply}
                  maxLength={BODY_MAX}
                  disabled={closed}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Write the reply that will be emailed to this person…"
                />
              </Field>
              {mayEdit && !closed && (
                <>
                  <FilePicker
                    accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.docx,.xlsx"
                    multiple
                    onPick={upload.pick}
                    label={tr("Attach Files")}
                  />
                  <UploadList items={upload.items} onRemove={upload.remove} onRetry={upload.retry} />
                </>
              )}
              {mayEdit && (
                <Button loading={busy === "reply" || upload.busy} disabled={closed || !reply.trim() || upload.busy} onClick={sendReply}>
                  Send reply
                </Button>
              )}
            </div>
          )}

          {responses.length > 0 && (
            <div className="mt-4 space-y-2 border-t pt-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Reply history
              </p>
              {responses.map((r) => {
                const st = String(r.send_status);
                const sentAt = dateFmt(String(r.sent_at || r.created_at));
                const toValue = String(cell(r.to_address));
                const errText = r.error == null ? null : String(r.error);

                return (
                  <div key={String(r.contact_enquiry_response_id)} className="rounded-md bg-muted/30 p-2">
                    <div className="flex items-center gap-2">
                      <StatusPill status={st} />
                      <span className="text-xs text-muted-foreground">
                        {sentAt} · {toValue}
                      </span>
                    </div>
                    <ReplyBody text={String(r.body)} />
                    {/* PENDING is shown, not hidden: the send started and we
                        never heard back. FAILED carries the transport's own
                        words, because "it didn't send" is not actionable. */}
                    {st === "PENDING" && (
                      <p className="mt-1 text-xs text-[rgb(var(--warn))]">
                        Sent, but the mail server never confirmed. Check the mail log before resending.
                      </p>
                    )}
                    {st === "FAILED" && errText && (
                      <p className="mt-1 text-xs text-[rgb(var(--bad))]">{errText}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Triage. Deliberately below the reply: routing an enquiry is not
            answering it, and the layout should not suggest otherwise. */}
        <div className="rounded-lg border p-3">
          <p className="mb-2 text-sm font-semibold text-foreground">{tr("Raise Lead")}</p>
          {alreadyLead ? (
            <AccessLink to={`/sales/leads/${String(detail?.lead_id)}`} className="text-sm text-primary-ink hover:underline">
              {tr("Open Lead")}
            </AccessLink>
          ) : (
            <>
              {match ? (
                <Callout tone="info" title={`${tr("Already here")}: ${match.company_name}`} className="mb-2">
                  {match.is_client ? tr("Client") : tr("Prospect")}
                </Callout>
              ) : null}
              {mayEdit ? (
                <Button variant="outline" loading={busy === "triage"} disabled={closed} onClick={triage}>
                  {match ? tr("Attach to This Company") : tr("Raise Lead")}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

/**
 * LOGGING AN ENQUIRY BY HAND.
 *
 * Enquiries arrive on their own — website form, email — so staff never had a
 * create surface, only the Manage drawer above. Mail conversion needs one: "turn
 * this email into an enquiry" opens a form, not a drawer for a record that does
 * not exist yet. Posts the same `POST /intake/enquiries` the website uses, with
 * `source` saying MAIL, under MOD-25 `create` like every other write here.
 */
export function EnquiryCreateForm({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Seed (mail conversion). */
  initial?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    company_name?: string | null;
    subject?: string | null;
    message?: string | null;
  } | null;
  onClose: () => void;
  /** Receives the created enquiry's id, so callers can link back to it. */
  onSaved: (id?: string | null) => void;
}) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [company, setCompany] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName(initial?.name || "");
    setEmail(initial?.email || "");
    setPhone(initial?.phone || "");
    setCompany(initial?.company_name || "");
    setSubject(initial?.subject || "");
    setMessage(initial?.message || "");
    setError(null);
  }, [open, initial]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const created = (await tenant("/intake/enquiries", {
        method: "POST",
        body: {
          name: name.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          company_name: company.trim() || undefined,
          subject: subject.trim() || undefined,
          message: message.trim() || undefined,
          source: "MAIL",
        },
      })) as Row | null;
      onSaved(created?.contact_enquiry_id ? String(created.contact_enquiry_id) : null);
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
      title={tr("Log an enquiry")}
      description={tr("Record an enquiry that arrived by another channel.")}
      size="lg"
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("Name")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={255} />
          </Field>
          <Field label={tr("Company")}>
            <Input value={company} onChange={(e) => setCompany(e.target.value)} maxLength={255} />
          </Field>
          <Field label={tr("Email")}>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} />
          </Field>
          <Field label={tr("Phone")}>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={255} />
          </Field>
          <Field label={tr("Subject")} className="sm:col-span-2">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={255} />
          </Field>
          <Field label={tr("Message")} className="sm:col-span-2">
            <Textarea
              className="min-h-[110px]"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={20000}
            />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{tr("Cancel")}</Button>
          <Button loading={busy} disabled={busy} onClick={submit}>{tr("Log enquiry")}</Button>
        </div>
      </div>
    </Modal>
  );
}
