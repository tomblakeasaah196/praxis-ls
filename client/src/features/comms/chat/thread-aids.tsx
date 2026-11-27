/**
 * What a long conversation needs on a phone, shared by team chat and the
 * client inbox: a divider where the day changes, and a way back to the latest
 * message after reading up.
 *
 * ── DAY DIVIDERS ────────────────────────────────────────────────────────────
 *
 * Every bubble carries its time but not its day, so a thread that ran across
 * a weekend read as one afternoon. The divider says "Today", "Yesterday", or
 * the date in the house day-first form (`dateFmt`: "24 Nov 2026"), once, where
 * the day turns over. Days are the reader's LOCAL calendar days.
 *
 * ── JUMP TO LATEST ──────────────────────────────────────────────────────────
 *
 * Both threads already refuse to yank a reader who has scrolled up back to
 * the bottom when a message lands, which is right, and which meant a message
 * arriving while you were reading back was simply invisible. The button
 * appears once the reader is off the bottom and counts what has arrived from
 * other people since, the WhatsApp shape. It also keeps the bottom pinned
 * when the pane shrinks (the on-screen keyboard opening), because a reader at
 * the latest message who taps the composer expects to still see it.
 */
import { tr, tv } from "@/lib/i18n";
import { ChevronIcon } from "@/components/ui/icons";
import { dayLabel } from "./thread-days";

/**
 * The divider. A `role="separator"` with the day as its name, so a screen
 * reader moving through the thread hears where the day changes.
 */
export function DayDivider({
  iso,
  as = "div",
}: {
  iso: string;
  as?: "div" | "li";
}) {
  const label = dayLabel(iso);
  const Tag = as;
  return (
    <Tag
      role="separator"
      aria-label={label}
      className="flex justify-center py-1"
    >
      <span className="rounded-full border border-border bg-card px-3 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm">
        {label}
      </span>
    </Tag>
  );
}

/**
 * The round button over the bottom-right of the thread. Render it straight
 * AFTER the scrolling pane: it hangs from a zero-height anchor at the pane's
 * bottom edge, so it never moves the messages and the pane's own layout is
 * untouched. A `relative` wrapper around the pane was tried first and is the
 * trap: it can shrink below the pane's padding when the pinned call summary
 * takes the room, and a positioned box that overflows paints over the card
 * beneath it and swallows its taps.
 */
export function JumpToLatest({
  show,
  unseen,
  onJump,
}: {
  show: boolean;
  unseen: number;
  onJump: () => void;
}) {
  if (!show) return null;
  const label =
    unseen === 1
      ? tr("1 new message, jump to the latest")
      : unseen
        ? tv("{{count}} new messages, jump to the latest", { count: unseen })
        : tr("Jump to the latest message");
  return (
    <div className="relative h-0 shrink-0">
      <button
        type="button"
        onClick={onJump}
        aria-label={label}
        title={label}
        data-jump-latest
        className="absolute bottom-3 right-3 z-[1] grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronIcon width={18} height={18} />
        {unseen > 0 && (
          <span className="chat-unread-dot absolute -top-1.5 -right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[9px] font-bold text-primary-foreground">
            {unseen > 99 ? "99+" : unseen}
          </span>
        )}
      </button>
    </div>
  );
}
