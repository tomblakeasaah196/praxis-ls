/**
 * The dialogs an action on a quotation opens (lean revamp §3.4): Send, Decline
 * with a reason, the views, the link, and the preview on a phone.
 *
 * Record Acceptance, Revise and Revoke are confirms, not dialogs: they live on
 * the editor page as `useConfirm()` calls that name what they do.
 */
import * as React from "react";
import { quotation as shared, type QuotationOutput } from "@shared";
import { tr, tv } from "@/lib/i18n";
import i18n from "i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Callout } from "@/components/ui/callout";
import { Segmented } from "@/components/ui/segmented";
import { EntityPicker } from "@/components/entity-picker";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { dateFmt, dateTimeFmt } from "@/lib/format";
import { tenant } from "@/lib/api-client";
import { errMsg, useResource } from "@/lib/use-resource";
import {
  declineQuotation,
  declineReasons,
  previewQuotation,
  quotationViews,
  sendQuotation,
  type Quotation,
  type SendResult,
} from "@/lib/quotation-api";
import { OUTPUT_OPTIONS } from "./quotation-words";
import { partyName, useCopy } from "./quotation-model";

/* ── Send ─────────────────────────────────────────────────────────────────── */

type Lang = "EN" | "FR";

/**
 * Send (§3.4): To (the company's contact by default), Cc, Subject, Message and
 * the output, with the PDF attached. The server issues it, opens the link until
 * the offer lapses, moves the request to Quoted and sets the follow-up.
 */
export function SendDialog({
  open,
  onClose,
  q,
  output,
  language,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  q: Quotation;
  output: QuotationOutput;
  language: Lang;
  onSent: (r: SendResult) => void;
}) {
  const [to, setTo] = React.useState("");
  const [cc, setCc] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [out, setOut] = React.useState<QuotationOutput>(output);
  const [lang, setLang] = React.useState<Lang>(language);
  const [entityId, setEntityId] = React.useState<string | null>(null);
  const [followUp, setFollowUp] = React.useState(true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<SendResult | null>(null);
  const copy = useCopy();

  React.useEffect(() => {
    if (!open) return;
    setOut(output);
    setLang(language);
    setCc((q.sent_cc || []).join(", "));
    setSubject(q.sent_subject || `${tr("Quotation")} ${q.doc_number || q.title || ""}`.trim());
    setMessage("");
    setEntityId(q.entity_id);
    setFollowUp(true);
    setErrors({});
    setDone(null);
    setTo(q.sent_to || "");
    // The company's contact by default: the row's own email.
    if (!q.sent_to && q.lead?.lead_id) {
      let live = true;
      tenant<{ email?: string | null }>(`/leads/${encodeURIComponent(q.lead.lead_id)}`)
        .then((l) => live && l?.email && setTo((t) => t || String(l.email)))
        .catch(() => live && setErrors((er) => ({ ...er, to: tr("The company's email could not be read. Type it.") })));
      return () => {
        live = false;
      };
    }
    return undefined;
    // Reset when the dialog OPENS only: the send refreshes `q`, and resetting on
    // that would wipe the result the sender is reading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const offered = q.languages && q.languages.length ? q.languages : (["EN", "FR"] as Lang[]);

  async function send() {
    const body = {
      to: to.trim(),
      cc: cc.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean),
      subject: subject.trim(),
      message: message.trim() || null,
      output: out,
      language: lang,
      entity_id: entityId,
      follow_up: followUp,
    };
    const parsed = shared.send.safeParse(body);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0] ?? "form")] ||= i.message;
      setErrors(errs);
      return;
    }
    if (!q.doc_number && !entityId) {
      setErrors({ entity_id: tr("Choose the entity that numbers it.") });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const r = await sendQuotation(q.quotation_id, parsed.data);
      setDone(r);
      onSent(r);
    } catch (e) {
      setErrors({ form: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Dialog open={open} onClose={onClose} title={tr("Quotation Sent")} footer={<Button onClick={onClose}>{tr("Done")}</Button>}>
        <div className="space-y-3">
          {done.mail.delivered ? (
            <Callout tone="ok" title={tv("Sent to {{to}}.", { to: done.mail.to })}>
              {done.mail.attached ? tr("The PDF is attached.") : tr("The PDF could not be attached; the link opens the same document.")}
            </Callout>
          ) : (
            <Callout tone="warn" title={tr("The email was not delivered.")}>
              {done.mail.reason || tr("Test data never leaves by email.")}
            </Callout>
          )}
          <Field label={tr("Link")}>
            <div className="flex gap-2">
              <Input readOnly value={done.link.url} onFocus={(e) => e.currentTarget.select()} />
              <Button variant="outline" onClick={() => void copy(done.link.url)}>
                {tr("Copy")}
              </Button>
            </div>
          </Field>
          {done.link.expires_at ? <p className="text-xs text-muted-foreground">{`${tr("Opens until")} ${dateFmt(done.link.expires_at)}`}</p> : null}
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={q.status === "SENT" ? tr("Send Again") : tr("Send Quotation")}
      description={tr("The PDF is attached and the email carries a link to read, download, accept or decline it.")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {tr("Cancel")}
          </Button>
          <Button onClick={() => void send()} loading={busy}>
            {tr("Send Quotation")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={tr("To")} required error={errors.to}>
          <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} autoComplete="off" />
        </Field>
        <Field label={tr("Cc")} error={errors.cc}>
          <Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="name@example.com, …" autoComplete="off" />
        </Field>
        <Field label={tr("Subject")} required error={errors.subject}>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label={tr("Message")} error={errors.message}>
          <Textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented label={tr("Output")} value={out} options={OUTPUT_OPTIONS.map((o) => ({ value: o.value, label: tr(o.label) }))} onChange={setOut} />
          {offered.length > 1 ? (
            <Segmented label={tr("PDF language")} value={lang} options={offered.map((l) => ({ value: l, label: l }))} onChange={(v) => setLang(v as Lang)} />
          ) : null}
        </div>
        {!q.doc_number && !q.entity_id ? (
          <Field label={tr("Entity")} required error={errors.entity_id}>
            <EntityPicker value={entityId} onChange={setEntityId} label={tr("Entity")} allowEmpty={false} />
          </Field>
        ) : null}
        <Checkbox checked={followUp} onCheckedChange={setFollowUp} label={tr("Follow Up in Three Working Days")} />
        {errors.form ? <ErrorState message={errors.form} /> : null}
      </div>
    </Dialog>
  );
}

/* ── Decline with a reason ────────────────────────────────────────────────── */

/** The client said no (§3.4): a reason from the same list the link offers, and a line. */
export function DeclineDialog({ open, onClose, q, onDone }: { open: boolean; onClose: () => void; q: Quotation; onDone: () => void }) {
  const reasons = useResource(declineReasons, []);
  const [code, setCode] = React.useState("");
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const fr = i18n.language?.startsWith("fr");

  React.useEffect(() => {
    if (!open) return;
    setCode("");
    setNote("");
    setErrors({});
  }, [open]);

  async function go() {
    const parsed = shared.decline.safeParse({ reason_code: code, note: note.trim() || null });
    if (!parsed.success) {
      setErrors({ reason_code: parsed.error.issues[0]?.message || tr("Choose a reason.") });
      return;
    }
    setBusy(true);
    try {
      await declineQuotation(q.quotation_id, parsed.data as { reason_code: string; note?: string | null });
      onDone();
    } catch (e) {
      setErrors({ form: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tv("Record {{company}} Declined", { company: partyName(q) })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {tr("Cancel")}
          </Button>
          <Button variant="destructive" onClick={() => void go()} loading={busy}>
            {tr("Record Decline")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {reasons.error ? <ErrorState message={reasons.error} /> : null}
        <Field label={tr("Reason")} required error={errors.reason_code}>
          <Select value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="">{tr("Choose a reason")}</option>
            {(reasons.data || []).map((r) => (
              <option key={r.reason_code} value={r.reason_code}>
                {fr ? r.label_fr : r.label_en}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tr("Note")}>
          <Input value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {errors.form ? <ErrorState message={errors.form} /> : null}
      </div>
    </Dialog>
  );
}

/* ── The views ────────────────────────────────────────────────────────────── */

const KIND_LABEL: Record<string, string> = { VIEW: "Opened", DOWNLOAD: "Downloaded" };

export function ViewsDialog({ open, onClose, q }: { open: boolean; onClose: () => void; q: Quotation }) {
  const views = useResource(() => (open ? quotationViews(q.quotation_id) : Promise.resolve(null)), [open, q.quotation_id]);
  return (
    <Dialog open={open} onClose={onClose} title={tr("Views")}>
      {views.error ? (
        <ErrorState message={views.error} />
      ) : !views.data ? (
        <LoadingRow />
      ) : views.data.length === 0 ? (
        <EmptyState title={tr("Not opened yet")} />
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {views.data.map((v, i) => (
            <li key={`${v.opened_at}-${i}`} className="flex flex-wrap items-center justify-between gap-2 p-2">
              <span>{tr(KIND_LABEL[v.kind] || "Opened")}</span>
              <span className="text-muted-foreground">{v.agent_label || ""}</span>
              <span className="num text-muted-foreground">{dateTimeFmt(v.opened_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/* ── The preview, as one HTML render ──────────────────────────────────────── */

/**
 * The one render (§3.4): the same HTML the public page shows and the PDF
 * prints, sandboxed with nothing allowed. `stamp` changes whenever the stored
 * quotation does, so a save refreshes it.
 */
export function PreviewFrame({ id, output, language, stamp, className }: { id: string; output: QuotationOutput; language: Lang; stamp: string; className?: string }) {
  const res = useResource(() => previewQuotation(id, output, language), [id, output, language, stamp]);
  if (res.error) return <ErrorState message={res.error} />;
  if (!res.data) return <LoadingRow label={tr("Rendering the preview…")} />;
  return <iframe title={tr("Quotation preview")} srcDoc={res.data.html} sandbox="" className={className ?? "h-[80vh] w-full rounded border bg-background"} />;
}

/** On a phone the preview is a button (§3.9): this is what it opens. */
export function PreviewDialog({ open, onClose, id, output, language, stamp }: { open: boolean; onClose: () => void; id: string; output: QuotationOutput; language: Lang; stamp: string }) {
  return (
    <Dialog open={open} onClose={onClose} title={tr("Preview")} size="wide">
      {open ? <PreviewFrame id={id} output={output} language={language} stamp={stamp} className="h-[75vh] w-full rounded border bg-background" /> : null}
    </Dialog>
  );
}
