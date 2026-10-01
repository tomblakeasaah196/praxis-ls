/**
 * What Accept asks before it files a client's portal upload as a VERIFIED
 * document (tenant review of 29 Sep 2026, PR 1, items 1.1 and 1.2): the
 * expiry and/or the issuing authority, ONLY when the type requires them
 * (`clientPortal.acceptFieldsFor`, the rule the API refuses an accept by). The
 * number is the system's, assigned on save, as on "Add document".
 */
import * as React from "react";
import { clientPortal } from "@shared";
import { tr, tv } from "@/lib/i18n";
import { errMsg } from "@/lib/use-resource";
import { todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Modal, Field } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { ErrorState } from "@/components/ui/states";
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
