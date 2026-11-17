/**
 * The rows of the Client inbox (Comms › Clients): what the server lists, and
 * how it is folded into ONE row per client (tenant review, 17 Nov 2026).
 *
 * The server lists conversations, a client and one of its threads at a time. A
 * client with General and three shipments was four rows carrying the same
 * name; the list is now one row per client, like a row of the Chat list, and
 * the conversations are tabs once the client is open.
 */
import { tr, tv } from "@/lib/i18n";

/** One conversation, as the server lists it: a client and one of its threads. */
export type InboxItem = {
  client_id: string;
  client_name: string;
  thread: string;
  dossier_id: string | null;
  dossier_ref: string | null;
  unread: number;
  waiting_since: string | null;
  last: {
    direction: "CLIENT" | "STAFF";
    preview: string | null;
    kind: string;
    at: string;
    /** The colleague at the client who wrote it (a client message only). */
    author?: { name: string | null; email: string | null } | null;
  };
  manager: { user_id: string; name: string | null } | null;
  mine: boolean;
};

/** One row of the list: a client, with all its conversations folded into it. */
export type ClientRow = {
  client_id: string;
  client_name: string;
  /** Unread client messages across every conversation of this client. */
  unread: number;
  /** The latest message in any of them. */
  last: InboxItem["last"];
  manager: InboxItem["manager"];
  /** A client I look after, or one with a file I own. */
  mine: boolean;
  /** The conversation a press opens. See `groupByClient`. */
  opens: string;
};

/**
 * Fold the server's conversations into one row per client.
 *
 * The rows keep the server's order, which is the conversations with unread
 * client messages first and then the most recent: a client takes the place of
 * its FIRST conversation in that order, so a client with something waiting
 * still sorts above one without.
 *
 * `opens` is that first conversation, and it is deliberately not always the
 * one the preview came from. The preview is the client's latest message
 * anywhere; a press lands on the conversation that is waiting for an answer
 * when there is one. Where the team has since replied about another shipment,
 * the unanswered question is the reason the client is on the list, and landing
 * on the reply would leave it one tab away with nothing pointing at it but a
 * number.
 */
export function groupByClient(items: InboxItem[]): ClientRow[] {
  const rows = new Map<string, ClientRow>();
  for (const i of items) {
    const row = rows.get(i.client_id);
    if (!row) {
      rows.set(i.client_id, {
        client_id: i.client_id,
        client_name: i.client_name,
        unread: i.unread || 0,
        last: i.last,
        manager: i.manager,
        mine: i.mine,
        opens: i.thread,
      });
      continue;
    }
    row.unread += i.unread || 0;
    row.mine = row.mine || i.mine;
    if (!row.manager) row.manager = i.manager;
    if (new Date(i.last.at).getTime() > new Date(row.last.at).getTime()) row.last = i.last;
  }
  return [...rows.values()];
}

const KIND: Record<string, string> = {
  IMAGE: "Photo",
  FILE: "Document",
  VOICE: "Voice note",
  LOCATION: "Location",
  TEXT: "Message",
};

/** "Paul Atiock: can you quote…" / "Team: done". Who wrote it, then the line. */
export function lastLine(row: ClientRow): string {
  const what = row.last.preview || tr(KIND[row.last.kind] || KIND.TEXT);
  const who =
    row.last.direction === "CLIENT"
      ? (row.last.author && (row.last.author.name || row.last.author.email)) || tr("Client")
      : tr("Team");
  return `${who}: ${what}`;
}

/**
 * "now", "12m", "3h", "2d", then a day-first date ("11 Sep"): the clock on a
 * row of the Chat list. Short because it shares a line with the client's name,
 * and the name is what must not be cut.
 */
export function shortAgo(iso?: string | null): string {
  if (!iso) return "";
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return "";
  const mins = Math.floor((Date.now() - at) / 60000);
  if (mins < 1) return tr("now");
  if (mins < 60) return tv("{{n}}m", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return tv("{{n}}h", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return tv("{{n}}d", { n: days });
  // en-GB, never the workstation's locale: "11 Sep", not "Sep 11".
  return new Date(iso).toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}
