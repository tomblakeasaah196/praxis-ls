/**
 * The one Filter control above the conversation list.
 *
 * Unread, Starred and With Attachments used to be four rows of the folder rail
 * under a "Views" header, and labels were a fifth section below the folders.
 * None of them is a place: each narrows a list. So they are one menu here, they
 * narrow the folder that is OPEN, and a single choice is on at a time.
 *
 * ── THE BUTTON SAYS WHAT IS ON ──────────────────────────────────────────────
 *
 * "Filter" when nothing is, the filter's own name when something is. A filter
 * that is on and not named is how somebody concludes mail has gone missing.
 * Changing folder clears it for the same reason (see `FolderRail`).
 *
 * VIP is not offered. The ◆ on the row stays, and `listThreads` still orders
 * VIP first, so the conversations are already at the top of the list they are
 * in; a lane of their own was a fourth filter for something the order does.
 */
import { cn } from "@/lib/cn";
import {
  DropdownMenu,
  DropdownRadioGroup,
  DropdownRadioItem,
  DropdownSeparator,
} from "@/components/ui/dropdown-menu";
import { FilterIcon } from "@/components/ui/icons";
import { tr } from "@/lib/i18n";
import type { Label } from "@/lib/mail-api";

export type ThreadFilterValue = {
  view?: "UNREAD" | "STARRED" | "ATTACHMENT";
  label?: string;
};

const VIEWS: { key: NonNullable<ThreadFilterValue["view"]>; label: string }[] = [
  { key: "UNREAD", label: "Unread" },
  { key: "STARRED", label: "Starred" },
  { key: "ATTACHMENT", label: "With Attachments" },
];

/** One string per choice, because a radio group has one value. */
const LABEL_PREFIX = "label:";
const encode = (v: ThreadFilterValue) =>
  v.view ? v.view : v.label ? `${LABEL_PREFIX}${v.label}` : "ALL";
const decode = (raw: string): ThreadFilterValue => {
  if (raw.startsWith(LABEL_PREFIX)) return { label: raw.slice(LABEL_PREFIX.length) };
  const view = VIEWS.find((v) => v.key === raw);
  return view ? { view: view.key } : {};
};

export function ThreadFilter({
  value,
  onChange,
  labels,
  className,
}: {
  value: ThreadFilterValue;
  onChange: (next: ThreadFilterValue) => void;
  /** The caller's own labels. An empty list draws no label group at all. */
  labels: Label[];
  className?: string;
}) {
  const active = value.view
    ? tr(VIEWS.find((v) => v.key === value.view)?.label || value.view)
    : value.label || null;

  return (
    <DropdownMenu
      label={tr("Filter conversations")}
      align="end"
      trigger={
        <button
          type="button"
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
            "hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border text-muted-foreground",
            className,
          )}
        >
          <FilterIcon width={14} height={14} />
          {active ? `${tr("Filter")}: ${active}` : tr("Filter")}
        </button>
      }
    >
      <DropdownRadioGroup value={encode(value)} onValueChange={(raw) => onChange(decode(raw))}>
        <DropdownRadioItem value="ALL">{tr("All Mail")}</DropdownRadioItem>
        {VIEWS.map((v) => (
          <DropdownRadioItem key={v.key} value={v.key}>
            {tr(v.label)}
          </DropdownRadioItem>
        ))}
        {labels.length > 0 && <DropdownSeparator />}
        {labels.map((l) => (
          <DropdownRadioItem key={l.email_label_id} value={`${LABEL_PREFIX}${l.name}`}>
            {l.name}
          </DropdownRadioItem>
        ))}
      </DropdownRadioGroup>
    </DropdownMenu>
  );
}
