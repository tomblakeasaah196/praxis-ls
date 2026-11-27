/**
 * What happened to a message after its undo window closed.
 *
 * `POST /mail/send` only queues; the worker sends a few seconds after
 * `release_at`. The composer had no way to hear about that, so the toast sat on
 * "Sending…" forever even though the message had gone (27 Nov 2026). This asks.
 *
 * The outbox list carries a row while it is HELD, QUEUED, SENDING or FAILED and
 * drops it once it is SENT, so: absent means sent, FAILED means the worker gave
 * up and `last_error` says why, anything else means ask again. A request that
 * fails is simply asked again; the server stays the authority on the outcome.
 */
import * as React from "react";
import * as api from "@/lib/mail-api";

export type SendOutcome = { kind: "sent" } | { kind: "failed"; reason: string | null };

const POLL_MS = 3000;
/** About two minutes of asking. Past that the toast keeps its honest "Sending…". */
const MAX_POLLS = 40;

export function useSendOutcome(
  queued: { email_send_queue_id: string; release_at: string; undo_seconds: number } | null,
  active: boolean,
  onOutcome: (o: SendOutcome) => void,
) {
  const report = React.useRef(onOutcome);
  report.current = onOutcome;

  const id = queued?.email_send_queue_id ?? null;
  const releaseAt = queued?.release_at ?? null;
  const scheduled = queued ? queued.undo_seconds === 0 : true;

  React.useEffect(() => {
    if (!id || !releaseAt || !active || scheduled) return undefined;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;

    const ask = async () => {
      if (stopped) return;
      polls += 1;
      try {
        const rows = await api.listOutbox();
        if (stopped) return;
        const row = (rows || []).find((r) => r.email_send_queue_id === id);
        if (!row) { report.current({ kind: "sent" }); return; }
        if (row.status === "FAILED") { report.current({ kind: "failed", reason: row.last_error || null }); return; }
      } catch {
        /* @silent:network the next poll asks again; the toast still says "Sending…" */
      }
      if (polls < MAX_POLLS) timer = setTimeout(ask, POLL_MS);
    };

    // First ask just after the window closes, when the worker can have run.
    const wait = Math.max(0, new Date(releaseAt).getTime() - Date.now()) + 1500;
    timer = setTimeout(ask, wait);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [id, releaseAt, active, scheduled]);
}
