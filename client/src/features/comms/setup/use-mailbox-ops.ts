/**
 * Test and Sync Now for a connected mailbox.
 *
 * A hook in a file of its own, apart from `mailboxes.tsx` which renders its
 * result, because a file that exports both a hook and components loses fast
 * refresh. Both setup tabs use it: My Mailbox on the caller's own address,
 * Company Mail on the shared ones.
 */
import * as React from "react";
import { reportActionError } from "@/lib/action-error";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";

/**
 * Test and sync, with the outcome as a line the caller draws beside the
 * mailbox. `failure` carries a classified SMTP code when the test produced
 * one, so the caller can render `<SmtpErrorGuide>` under it.
 */
export function useMailboxOps(onChanged: () => void) {
  const [busyId, setBusyId] = React.useState("");
  const [note, setNote] = React.useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [failure, setFailure] = React.useState<{ code?: string; message?: string } | null>(null);

  async function test(id: string) {
    setBusyId(id);
    setNote(null);
    setFailure(null);
    try {
      const r = await api.testConnection(id);
      setNote({ id, ok: r.ok, text: r.ok ? tr("Connection OK") : r.error || tr("failed") });
      if (!r.ok) setFailure({ code: r.code, message: r.error });
      onChanged();
    } catch (e) {
      reportActionError(e);
    } finally {
      setBusyId("");
    }
  }

  async function sync(id: string) {
    setBusyId(id);
    setNote(null);
    setFailure(null);
    try {
      const r = await api.syncConnection(id);
      setNote({
        id,
        ok: !r.error,
        text: r.error ? r.error : `${tr("Synced")}: ${r.inserted ?? 0} ${tr("new")}`,
      });
      onChanged();
    } catch (e) {
      reportActionError(e);
    } finally {
      setBusyId("");
    }
  }

  return { busyId, note, failure, test, sync };
}
