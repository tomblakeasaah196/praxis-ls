/**
 * Accept / Send back for a client's portal upload — one hook, so the Portal
 * tab and Client 360 › Documents never review differently (tenant review of
 * 29 Sep 2026, PR 1, items 1.1 and 1.2).
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { tenant } from "@/lib/api-client";
import { errMsg } from "@/lib/use-resource";
import { usePrompt } from "@/components/ui/use-prompt";
import { useToast } from "@/components/ui/toast";
import type { StaffRequest } from "./client-portal-staff";
import { AcceptDocumentDialog, type AcceptDocument } from "./accept-document-dialog";

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
