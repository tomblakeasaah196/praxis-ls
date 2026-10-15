import type * as api from "@/lib/mail-api";

/**
 * A mailbox this person can write from.
 *
 * ERROR counts. A failed SYNC is a failure to read the server, and sending
 * goes out by its own road, so a mailbox whose last poll failed can almost
 * always still send; Outlook and Gmail both keep sending while their sync
 * struggles (owner decision, 15 Oct 2026). Refusing was worse than wrong: one
 * wobble at 17:36 read as "No mailbox connected" to somebody looking at their
 * connected mailbox. A read-only grant cannot send, so a VIEWER's shared
 * mailbox is left out rather than offered and refused at Send.
 */
export function canWriteFrom(m: Pick<api.Mailbox, "status" | "access_role">): boolean {
  return (m.status === "CONNECTED" || m.status === "ERROR") && m.access_role !== "VIEWER";
}
