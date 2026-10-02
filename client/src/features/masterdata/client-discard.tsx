/**
 * Discard a draft client (meeting 6, register 3.6).
 *
 * A DRAFT client with no history — no operations file, invoice, receipt,
 * journal line, quote request, proposal, quotation or portal activity — can
 * be deleted, with its own contacts, addresses, registrations, documents and
 * portal access, in one audited transaction. That is how a test client like
 * CINECAM leaves LIVE. Anything with history keeps "Deactivate": the control
 * says so and offers it instead.
 *
 * Shown only to someone holding the client master's `delete` right: the check
 * endpoint answers 403 to anyone else, and then nothing renders. The confirm
 * is destructive and names the outcome; it cannot be clicked away.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/use-confirm";
import { useToast } from "@/components/ui/toast";
import { useResource, errMsg } from "@/lib/use-resource";
import * as api from "@/lib/masterdata-api";

export function DiscardDraftClient({
  clientId,
  name,
  onDeactivate,
  onDiscarded,
}: {
  clientId: string;
  name: string;
  /** The "Deactivate instead" path, owned by the dossier's lifecycle buttons. */
  onDeactivate: () => void;
  onDiscarded?: () => void;
}) {
  const check = useResource(() => api.clientDiscardCheck(clientId), [clientId]);
  const [confirm, confirmDialog] = useConfirm();
  const [busy, setBusy] = React.useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  const c = check.data;
  // No `delete` right (403) or not a draft: nothing to offer here.
  if (!c || c.registration_status !== "DRAFT") return null;

  if (!c.can_discard) {
    const what = c.history.map((h) => `${h.count} ${tr(h.label)}`).join(", ");
    return (
      <Button
        size="sm"
        variant="outline"
        title={`${tr("This client already has")} ${what}. ${tr("A client with history is deactivated, not deleted.")}`}
        onClick={onDeactivate}
      >
        {tr("Deactivate instead")}
      </Button>
    );
  }

  async function discard() {
    const ok = await confirm({
      title: tr("Discard this draft client?"),
      body: (
        <>
          <p>
            “{name}” {tr("and its contacts, addresses, registrations, documents and portal access are deleted.")}
          </p>
          <p className="mt-2">
            {tr("It has no operations file, invoice, receipt, journal line, quote request, proposal, quotation or portal activity. A full copy is kept in the audit trail. This cannot be undone.")}
          </p>
        </>
      ),
      confirmLabel: tr("Discard draft client"),
      cancelLabel: tr("Keep it"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.discardClient(clientId);
      toast.success(tr("Draft client discarded"));
      onDiscarded?.();
      navigate("/master/clients", { replace: true });
    } catch (err) {
      // Refused under the lock (history arrived a moment ago): say why.
      toast.error(errMsg(err));
      check.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="destructive" loading={busy} onClick={discard}>
        {tr("Discard draft")}
      </Button>
      {confirmDialog}
    </>
  );
}
