/**
 * The left rail: the mailbox picker and the folders. Nothing else.
 *
 * ── ONE FLAT LIST ───────────────────────────────────────────────────────────
 *
 * This rail used to be five collapsible sections (Triage, Views, Not Sent Yet,
 * Folders, My Labels) holding sixteen rows, most of them filters wearing a
 * folder's clothes. The tenant review of 16 Nov 2026 was "managing mail should
 * be the simplest thing ever", and the question that settled it was theirs:
 * "these are filters, right? The most important thing is just the folders."
 *
 * So the rail holds PLACES and only places. Unread, Starred and With
 * Attachments are filters, and so are labels: they live behind the one Filter
 * control above the conversation list (`thread-filter.tsx`) and narrow whatever
 * folder is open.
 *
 * ── WHY NOTICES IS A ROW AND NOT A FILTER ───────────────────────────────────
 *
 * A logistics mailbox receives more machine mail than human mail: carrier
 * notices, backups, tracking updates, delivery reports. Inbox is the mail from
 * people and Notices is the rest, so a client's question is never three
 * screens down. Both are the server's INBOX folder split by `stream`; there is
 * no "Everything" row, because the two rows already are everything.
 *
 * ── DRAFTS IS THE COMPOSER'S OWN ────────────────────────────────────────────
 *
 * There is exactly one Drafts row and it lists `email_draft`, where a draft
 * written HERE lives. The mail server's canonical DRAFTS folder is not drawn:
 * we do no provider draft sync (Q11), so it is precisely where our drafts are
 * NOT, and offering both was two rows called Drafts with one of them empty.
 *
 * ── OUTBOX APPEARS ONLY WHILE SOMETHING IS IN IT ────────────────────────────
 *
 * It is where a scheduled send waits and where a refused one sits until
 * somebody notices. Empty, it is a row about nothing; holding mail, it shows
 * with its count, which is the one moment it needs to be seen.
 *
 * ── EVERY COUNT HERE IS THE CALLER'S OWN ────────────────────────────────────
 *
 * `unread_count` comes from `email_message_state` keyed on (message, user).
 * Marie and Paul both work billing@ and see different numbers from the same
 * messages. If a count in this rail ever matches for two different people
 * looking at the same shared mailbox, something has regressed to a column on
 * the message.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Pill } from "@/components/ui/pill";
import { Field, Select } from "@/components/ui/modal";
import { tr } from "@/lib/i18n";
import type { Folder, MailFolder, MailStream, Mailbox } from "@/lib/mail-api";

export type RailSelection = {
  connectionId?: string;
  folder: MailFolder;
  stream?: MailStream;
  /**
   * The Filter control's two axes (`thread-filter.tsx`). Neither is drawn by
   * the rail, and choosing a rail row clears both: a filter left on from the
   * last folder hides mail from somebody who has forgotten it is there.
   */
  label?: string;
  view?: "STARRED" | "UNREAD" | "ATTACHMENT";
  /**
   * The two lists that are not conversations: mail that has not gone anywhere.
   *
   * DRAFTS   The composer's own saved drafts (`email_draft`).
   * OUTBOX   The send queue: scheduled messages still cancellable, and sends
   *          the mail server refused.
   */
  pending?: "DRAFTS" | "OUTBOX";
};

/** The folders drawn under Drafts, in the order every mail client uses. */
const FOLDER_ORDER: MailFolder[] = ["SENT", "ARCHIVE", "SPAM", "TRASH"];

const FOLDER_LABEL: Record<MailFolder, string> = {
  INBOX: "Inbox",
  SENT: "Sent",
  DRAFTS: "Drafts",
  ARCHIVE: "Archive",
  SPAM: "Spam",
  TRASH: "Trash",
};

/** The canonical name, translated; anything else is the server's own text. */
function folderLabel(f: Folder): string {
  const canonical = FOLDER_LABEL[f.canonical as MailFolder];
  return canonical ? tr(canonical) : (f.display_name ?? f.provider_path);
}

function RailButton({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
        active
          ? "bg-primary/10 font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <span className="truncate">{children}</span>
      {count !== undefined && count > 0 && (
        <span className="num shrink-0 text-xs tabular-nums">{count}</span>
      )}
    </button>
  );
}

export function FolderRail({
  mailboxes,
  folders,
  selection,
  onChange,
  humanUnread,
  systemUnread,
  outboxWaiting = 0,
}: {
  mailboxes: Mailbox[];
  folders: Folder[];
  selection: RailSelection;
  onChange: (next: RailSelection) => void;
  humanUnread: number;
  systemUnread: number;
  /** Messages in the Outbox that have not gone yet. */
  outboxWaiting?: number;
}) {
  /** A rail row is a place: going to one drops the filter and the other list. */
  const go = (patch: Partial<RailSelection>) =>
    onChange({
      ...selection,
      stream: undefined,
      pending: undefined,
      view: undefined,
      label: undefined,
      ...patch,
    });

  const canonical = FOLDER_ORDER.map((key) =>
    folders.find((f) => f.canonical === key),
  ).filter((f): f is Folder => Boolean(f));
  const synced = folders.some((f) => f.canonical);
  const inFolder = !selection.pending;

  return (
    <nav aria-label={tr("Mail folders")} className="space-y-0.5">
      {/* A person with one mailbox should not be asked to choose it, but the
          rail is still SCOPED to that mailbox whether or not the picker is
          drawn. There is no "all my mailboxes" option, because there is no such
          rail to draw: folders and their counts belong to one connection. */}
      {mailboxes.length > 1 && (
        <div className="pb-2">
          <Field label={tr("Mailbox")}>
            <Select
              value={selection.connectionId ?? mailboxes[0].email_connection_id}
              onChange={(e) => go({ connectionId: e.target.value, folder: "INBOX", stream: "HUMAN" })}
            >
              {mailboxes.map((m) => (
                <option key={m.email_connection_id} value={m.email_connection_id}>
                  {m.email_address}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      <RailButton
        active={inFolder && selection.folder === "INBOX" && selection.stream !== "SYSTEM"}
        onClick={() => go({ folder: "INBOX", stream: "HUMAN" })}
        count={humanUnread}
      >
        {tr("Inbox")}
      </RailButton>
      <RailButton
        active={inFolder && selection.folder === "INBOX" && selection.stream === "SYSTEM"}
        onClick={() => go({ folder: "INBOX", stream: "SYSTEM" })}
        count={systemUnread}
      >
        {tr("Notices")}
      </RailButton>
      <RailButton
        active={selection.pending === "DRAFTS"}
        onClick={() => go({ pending: "DRAFTS" })}
      >
        {tr("Drafts")}
      </RailButton>
      {(outboxWaiting > 0 || selection.pending === "OUTBOX") && (
        <RailButton
          active={selection.pending === "OUTBOX"}
          onClick={() => go({ pending: "OUTBOX" })}
          count={outboxWaiting}
        >
          {tr("Outbox")}
        </RailButton>
      )}
      {canonical.map((f) => (
        <RailButton
          key={f.email_folder_id}
          active={inFolder && selection.folder === f.canonical}
          onClick={() => go({ folder: f.canonical as MailFolder })}
          count={f.unread_count}
        >
          {folderLabel(f)}
        </RailButton>
      ))}

      {!synced && mailboxes.length > 0 && (
        // Not an error. Gated on knowing WHICH mailbox, because "this mailbox
        // has no folders" is a claim, and for the half-second before the
        // mailbox list arrives there is no mailbox to make it about.
        <p className="px-2.5 pt-2 text-xs text-muted-foreground">
          {tr("No folders yet: sync the mailbox to discover them.")}
        </p>
      )}

      {/* A folder the server refused is worth surfacing here rather than in a
          log: the user is looking at a list that is quietly incomplete. With
          the server's reason, per folder. */}
      {folders.some((f) => f.last_error) && (
        <div className="px-2.5 pt-3">
          <Pill tone="warn">{tr("Some folders did not sync")}</Pill>
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {folders
              .filter((f) => f.last_error)
              .map((f) => (
                <li key={f.email_folder_id} className="break-words">
                  <span className="font-medium text-foreground">{folderLabel(f)}</span>: {f.last_error}
                </li>
              ))}
          </ul>
        </div>
      )}
    </nav>
  );
}
