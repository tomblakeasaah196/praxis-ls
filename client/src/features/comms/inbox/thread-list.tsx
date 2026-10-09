/**
 * The conversation list — one row per conversation, not per message.
 *
 * ── WHY A ROW IS A CONVERSATION ─────────────────────────────────────────────
 *
 * Because that is the unit a person works in. "Have we answered Maersk about
 * the demurrage?" is a question about an exchange, not about a message, and a
 * list that shows nine rows for one exchange makes the operator do the
 * reconstruction the software should have done. `unread_count` and `is_starred`
 * on the row are the CALLER's, so this list looks different for two people
 * reading the same shared mailbox — as it must.
 *
 * ── SELECTION IS A SET, AND BULK ACTIONS REPORT THEIR FAILURES ──────────────
 *
 * Selecting forty conversations and archiving them is one request. The server
 * applies them one at a time and returns which failed, and this surfaces that
 * rather than showing a success toast over a partial result — an archive that
 * silently dropped two is worse than one that says which two.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { INDEX_ROW_OPEN } from "@/components/ui/index-row";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Pill } from "@/components/ui/pill";
import { EmptyState, LoadingRow } from "@/components/ui/states";
import { fmtRelative } from "@/lib/format";
import { tr } from "@/lib/i18n";
import type { BulkOp, MailFolder, Thread } from "@/lib/mail-api";

/** The star, as a button rather than an icon with a click handler on a span. */
function Star({
  on,
  onToggle,
  subject,
}: {
  on: boolean;
  onToggle: () => void;
  subject: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      // See the note on the row's checkbox: the list is one tab stop and `s`
      // is what reaches this from the keyboard.
      tabIndex={-1}
      aria-label={
        on ? `${tr("Unstar")} ${subject}` : `${tr("Star")} ${subject}`
      }
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "shrink-0 rounded p-0.5 text-base leading-none transition-colors",
        on
          ? "text-warning"
          : "text-muted-foreground/40 hover:text-muted-foreground",
      )}
    >
      {on ? "★" : "☆"}
    </button>
  );
}

/**
 * Who the conversation is with — everyone except our own mailbox.
 *
 * Showing the mailbox's own address in its own thread list is noise: the user
 * knows which mailbox they are reading. When we are genuinely the only
 * participant (a note to self, a bounce), fall back to showing it rather than
 * rendering an empty cell that looks like a bug.
 */
function counterparties(t: Thread): string {
  const mine = String(t.mailbox_address || "").toLowerCase();
  // `Array.isArray`, not `|| []`. A non-array truthy value — which is exactly
  // what an uncast citext[] column sent — passes `|| []` and then throws on
  // `.filter`, and that one throw took down the whole Mailbox screen. The API
  // layer normalises this now; the guard stays because a row renderer should
  // never be the thing that costs somebody their workspace.
  const all = Array.isArray(t.participants) ? t.participants : [];
  const others = all.filter((p) => p !== mine);
  const list = others.length ? others : all;
  if (!list.length) return t.last_from || "—";
  const names = list.map((a) => a.split("@")[0]);
  return names.length <= 2
    ? names.join(", ")
    : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

/**
 * ── THE MARKERS, AS GLYPHS RATHER THAN WORDS ────────────────────────────────
 *
 * VIP and "has an attachment" were `<Pill>`s reading "VIP" and "Attachment" on
 * a fourth line of every row. "Attachment" is ~90px of a 380px list pane spent
 * saying what a paperclip says, on the rows most likely to also carry a long
 * subject — and the pane is resizable down to 280px.
 *
 * The glyphs are the SAME characters `folder-rail.tsx` draws on its saved
 * views, for the reason that file gives about the star: a marker and the lane
 * that collects it have to read as one feature or they are two. Each one keeps
 * a `title` and an `sr-only` word, so nothing is carried by the glyph alone.
 */
function RowMarks({ thread }: { thread: Thread }) {
  return (
    <>
      {thread.is_vip && (
        <span className="shrink-0 text-xs leading-none text-warning" title={tr("VIP")}>
          <span aria-hidden>◆</span>
          <span className="sr-only">{tr("VIP")}</span>
        </span>
      )}
      {thread.has_attachment && (
        <span
          className="shrink-0 text-xs leading-none text-muted-foreground"
          title={tr("Carries a file")}
        >
          <span aria-hidden>◫</span>
          <span className="sr-only">{tr("Carries a file")}</span>
        </span>
      )}
      {/* The classifier's reason on hover: a verdict a person cannot
          interrogate is one they will not trust. Kept as a word, because
          unlike the other two it is a CLAIM the product made about the
          conversation rather than a fact about it. */}
      {thread.stream === "SYSTEM" && (
        <span className="shrink-0" title={thread.stream_reason || undefined}>
          <Pill tone="mute">{tr("Notice")}</Pill>
        </span>
      )}
    </>
  );
}

export function ThreadRow({
  thread,
  selected,
  active,
  focused,
  onOpen,
  onSelect,
  onStar,
  onFocus,
}: {
  thread: Thread;
  selected: boolean;
  active: boolean;
  /** Does the list's roving tabindex rest on this row? See `ThreadList`. */
  focused: boolean;
  onOpen: () => void;
  onSelect: (on: boolean) => void;
  onStar: (on: boolean) => void;
  /** The row took focus by itself (a click, or Tab into the list). */
  onFocus: () => void;
}) {
  const unread = thread.unread_count > 0;
  const subject = thread.subject || tr("(no subject)");
  const ref = React.useRef<HTMLButtonElement>(null);

  /* Move the real DOM focus when the cursor lands here, and bring the row into
   * view. `block: "nearest"` rather than "center": holding ↓ through a
   * fifty-row list should scroll by a row at the edge, not jump the pane by
   * half a screen on every press. Guarded on `focused` so a row does not steal
   * focus from the reading pane or the search box on an ordinary re-render. */
  React.useEffect(() => {
    if (!focused) return;
    const el = ref.current;
    if (!el || el === document.activeElement) return;
    if (!el.closest("ul")?.contains(document.activeElement)) return;
    el.focus();
    el.scrollIntoView({ block: "nearest" });
  }, [focused]);

  return (
    <li>
      <div
        className={cn(
          // `py-row` is the density preference (lib/density.ts), not a number
          // chosen here. The mail list was the one list in the app ignoring it:
          // `py-2.5` plus FOUR stacked lines — who, subject, preview, and a row
          // of pills — measured ~100px, so a 1080p screen under three bars of
          // chrome held six of a fifty-row list. Two lines at the density the
          // reader already chose is 48 / 52 / 60px.
          // Below `sm` each row is a card: a rounded, bordered tile with a gap
          // between tiles, so the list reads as a set of conversations rather
          // than one long ruled table. From `sm` up it is the flush ruled row
          // it always was.
          "relative mx-2 my-1.5 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors sm:mx-0 sm:my-0 sm:rounded-none sm:border-x-0 sm:border-b sm:border-t-0 sm:bg-transparent sm:px-3 sm:py-row",
          // Flush list, so the rail sits on the row's very edge rather than
          // inset the way `<IndexRow>`'s does on a rounded one. The colour is
          // INDEX_ROW_OPEN either way — one meaning of "this is the open one".
          "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:transition-colors before:content-['']",
          // `hover:bg-muted/60` here compiled to nothing for the same reason the
          // open state did — see index-row.tsx. Dropped to the opacity-free
          // utility so the row actually has a hover state.
          active ? INDEX_ROW_OPEN : "before:bg-transparent hover:bg-muted",
        )}
      >
        {/* tabIndex -1 on both: the list is ONE tab stop (see `ThreadList`),
            and `x` and `s` reach these from the keyboard. Three focusables per
            row made a fifty-row list 150 presses deep. */}
        <Checkbox
          checked={selected}
          onCheckedChange={onSelect}
          tabIndex={-1}
          label={
            <span className="sr-only">
              {tr("Select")} {subject}
            </span>
          }
        />
        <Star
          on={thread.is_starred}
          onToggle={() => onStar(!thread.is_starred)}
          subject={subject}
        />
        <button
          ref={ref}
          type="button"
          onClick={onOpen}
          onFocus={onFocus}
          tabIndex={focused ? 0 : -1}
          className="min-w-0 flex-1 text-left focus-visible:outline-none"
          aria-current={active ? "true" : undefined}
          aria-keyshortcuts="Enter x s"
        >
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span
              className={cn(
                "min-w-0 truncate text-sm",
                unread
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {counterparties(thread)}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <RowMarks thread={thread} />
              <span className="num text-xs text-muted-foreground">
                {fmtRelative(thread.last_message_at)}
              </span>
            </span>
          </div>
          {/* Subject and preview on ONE line, the subject carrying the weight.
              They were two, and the preview is the line a reader skims past:
              it earns a share of a line, not a line of its own. */}
          {/* Below `sm` the subject and preview wrap onto their own lines inside
              the card: a long subject is truncated to the card, not pushed past
              the screen edge (the old `shrink-0` on it did exactly that). From
              `sm` the preview shares the subject's line, as before. */}
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            {thread.entity_ref && (
              <span className="shrink-0" title={thread.entity_ref}>
                <Pill tone="blue">{thread.entity_label || thread.entity_ref}</Pill>
              </span>
            )}
            <span
              className={cn(
                "min-w-0 max-w-full truncate text-sm",
                unread ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {subject}
            </span>
            {thread.message_count > 1 && (
              <span className="num shrink-0 text-xs text-muted-foreground">
                {thread.message_count}
              </span>
            )}
            {thread.preview && (
              <span className="block w-full min-w-0 truncate text-xs text-muted-foreground sm:inline sm:w-auto sm:flex-1">
                {thread.preview}
              </span>
            )}
          </div>
        </button>
      </div>
    </li>
  );
}

const BULK: { op: BulkOp; label: string; folder?: MailFolder }[] = [
  { op: "read", label: "Mark Read" },
  { op: "unread", label: "Mark Unread" },
  { op: "move", label: "Archive", folder: "ARCHIVE" },
  { op: "move", label: "Spam", folder: "SPAM" },
  { op: "move", label: "Trash", folder: "TRASH" },
];

/**
 * Permanent deletion, offered only where deletion is what the person means.
 *
 * Everywhere else "Trash" is the destructive verb and it is reversible. In
 * Trash and Spam it is not available — moving a conversation from Trash to
 * Trash is a no-op — and "delete it properly" is the only thing left to want.
 * Restricting it to those two also matches the server: `emptyFolder`'s
 * allow-list is TRASH and SPAM by name.
 */
const DELETABLE = new Set<MailFolder>(["TRASH", "SPAM"]);

export function ThreadList({
  threads,
  loading,
  error,
  activeId,
  selected,
  onSelectedChange,
  onOpen,
  onStar,
  onBulk,
  folder,
  onEmptyFolder,
  bulkBusy,
  bulkFailures,
  onLoadMore,
  hasMore,
  emptyHint,
}: {
  threads: Thread[];
  loading: boolean;
  error?: string | null;
  activeId?: string | null;
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  onOpen: (t: Thread) => void;
  onStar: (t: Thread, on: boolean) => void;
  onBulk: (op: BulkOp, folder?: MailFolder) => void;
  /** Which folder is being listed — decides whether deletion is offered. */
  folder?: MailFolder;
  /** Empty the whole of Trash or Spam. Absent = not offered. */
  onEmptyFolder?: () => void;
  bulkBusy: boolean;
  bulkFailures: { email_thread_id: string; error: string }[];
  onLoadMore: () => void;
  hasMore: boolean;
  emptyHint: string;
}) {
  const allSelected = threads.length > 0 && selected.size === threads.length;
  const toggleAll = (on: boolean) =>
    onSelectedChange(
      on ? new Set(threads.map((t) => t.email_thread_id)) : new Set(),
    );
  const toggleOne = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onSelectedChange(next);
  };

  /* ── THE KEYBOARD, AND WHY THE LIST IS ONE TAB STOP ───────────────────────
   *
   * There was no keyboard navigation at all. Every row carried three
   * focusables — the checkbox, the star and the row itself — so reaching the
   * bottom of a fifty-row list was a hundred and fifty presses of Tab, and
   * there was no way to move down the list, open a conversation or star one
   * without a pointer. A mail client is the screen people live in; it is the
   * last one that should be mouse-only by construction.
   *
   * This is the standard composite-widget pattern: ONE tab stop for the whole
   * list, and a roving `tabIndex` that moves the real DOM focus between rows.
   * Arrow keys are the ARIA requirement; `j` and `k` are here because every
   * mail client has had them for twenty years and the people who use them do
   * not read release notes to find out.
   *
   *   ↓ / j      next conversation          Enter / o   open it
   *   ↑ / k      previous conversation      x           select it
   *   Home / End first / last               s           star it
   *
   * `x` and `s` are what keeps the checkbox and the star operable after they
   * left the tab order, and `aria-keyshortcuts` on the row announces them, so
   * the tab-stop saving does not come out of a screen-reader user's pocket.
   *
   * The cursor is CLAMPED rather than stored by id: the list reloads under it
   * (the sync worker publishes `mail:new`), a folder change replaces every row,
   * and an index that outlived its row would move focus to whatever slid into
   * the slot. It also moves on `onFocus`, so clicking a row and then pressing ↓
   * continues from the row that was clicked.
   */
  const [cursor, setCursor] = React.useState(0);
  const at = threads.length === 0 ? -1 : Math.min(cursor, threads.length - 1);

  function onListKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    // Never swallow a key somebody is typing into a control inside the list —
    // the "Load older" button lives in it, and so will anything added later.
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const move = (to: number) => {
      e.preventDefault();
      setCursor(Math.max(0, Math.min(to, threads.length - 1)));
    };
    const row = at >= 0 ? threads[at] : null;
    switch (e.key) {
      case "ArrowDown":
      case "j":
        return move(at + 1);
      case "ArrowUp":
      case "k":
        return move(at - 1);
      case "Home":
        return move(0);
      case "End":
        return move(threads.length - 1);
      case "Enter":
      case "o":
        if (!row) return;
        e.preventDefault();
        return onOpen(row);
      case "x":
        if (!row) return;
        e.preventDefault();
        return toggleOne(row.email_thread_id, !selected.has(row.email_thread_id));
      case "s":
        if (!row) return;
        e.preventDefault();
        return onStar(row, !row.is_starred);
      default:
        return;
    }
  }

  return (
    /* `h-full` is the last link in the height chain (see inbox/index.tsx): the
       pane above has a definite height from `lg` up, so this fills it and the
       <ul> below scrolls itself. Below `lg` the pane is auto-height, where
       `height: 100%` resolves to `auto` and the page scrolls as before. */
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Checkbox
          checked={
            allSelected ? true : selected.size > 0 ? "indeterminate" : false
          }
          onCheckedChange={toggleAll}
          label={
            <span className="sr-only">{tr("Select all conversations")}</span>
          }
        />
        {selected.size > 0 ? (
          <>
            <span className="num text-xs text-muted-foreground">
              {selected.size} {tr("selected")}
            </span>
            {BULK
              // "Move to Trash" while reading Trash is a no-op dressed as an
              // action; the same for Spam.
              .filter((b) => !(b.op === "move" && b.folder === folder))
              .map((b) => (
                <Button
                  key={b.label}
                  size="sm"
                  variant="outline"
                  disabled={bulkBusy}
                  onClick={() => onBulk(b.op, b.folder)}
                >
                  {tr(b.label)}
                </Button>
              ))}
            {folder && DELETABLE.has(folder) && (
              <Button
                size="sm"
                variant="outline"
                disabled={bulkBusy}
                onClick={() => onBulk("delete")}
              >
                {tr("Delete for ever")}
              </Button>
            )}
          </>
        ) : (
          <>
            <span className="num text-xs text-muted-foreground">
              {threads.length}
              {hasMore ? "+" : ""}{" "}
              {threads.length === 1 ? tr("conversation") : tr("conversations")}
            </span>
            {/* The "Empty Trash" the product did not have — `thread.service`'s
                own words for the endpoint it shipped without a screen. */}
            {onEmptyFolder &&
              folder &&
              DELETABLE.has(folder) &&
              threads.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  disabled={bulkBusy}
                  onClick={onEmptyFolder}
                >
                  {folder === "TRASH" ? tr("Empty the bin") : tr("Empty spam")}
                </Button>
              )}
          </>
        )}
      </div>

      {/* A partial bulk result is stated, not swallowed. */}
      {bulkFailures.length > 0 && (
        <div
          role="status"
          className="border-b border-border bg-warning/10 px-3 py-2 text-xs text-foreground"
        >
          {bulkFailures.length}{" "}
          {bulkFailures.length === 1 ? tr("conversation") : tr("conversations")}{" "}
          {tr("could not be updated:")}{" "}
          {bulkFailures.map((f) => f.error).join("; ")}
        </div>
      )}

      {/* THE pane that scrolls. `min-h-0 flex-1` only resolves against a parent
          with a definite height, which is what the chain documented in
          inbox/index.tsx now provides and did not before. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <ul
        className="min-h-0 flex-1 overflow-y-auto"
        aria-label={tr("Conversations")}
        onKeyDown={onListKeyDown}
      >
        {threads.map((t, i) => (
          <ThreadRow
            key={t.email_thread_id}
            thread={t}
            selected={selected.has(t.email_thread_id)}
            active={activeId === t.email_thread_id}
            focused={i === at}
            onFocus={() => setCursor(i)}
            onOpen={() => onOpen(t)}
            onSelect={(on) => toggleOne(t.email_thread_id, on)}
            onStar={(on) => onStar(t, on)}
          />
        ))}
        {loading && <LoadingRow label={tr("Loading conversations…")} />}
        {!loading && !error && threads.length === 0 && (
          <li className="p-4">
            <EmptyState title={tr("Nothing here")} hint={emptyHint} />
          </li>
        )}
        {hasMore && !loading && (
          <li className="p-3 text-center">
            <Button size="sm" variant="outline" onClick={onLoadMore}>
              {tr("Load older")}
            </Button>
          </li>
        )}
      </ul>
    </div>
  );
}
