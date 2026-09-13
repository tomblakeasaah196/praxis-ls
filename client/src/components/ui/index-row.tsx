/**
 * IndexRow — one entry in the index rail of a master-detail (360) screen.
 *
 * WHY. Thirteen screens render a list on the left and a 360 on the right, and
 * every one of them marked the open record with the same hand-written string:
 *
 *     className={`… ${id === selId ? "bg-primary/10 text-foreground" : "hover:bg-muted"}`}
 *
 * A 10% tint of the accent is a ~4% luminance lift over `--card` in the dark
 * theme (`rgb(18 22 30)`). That is below the threshold at which a person
 * GLANCING at the screen sees a difference at all, which is the only threshold
 * that matters for "which record am I looking at?" — the question the reader
 * asks once per screen, pre-attentively, before they start reading. The report
 * that prompted this said it plainly: nothing on the split screen showed which
 * service type the right-hand pane belonged to.
 *
 * None of the thirteen carried `aria-current` either, so the state was not
 * merely faint, it was absent from the accessibility tree entirely. A screen
 * reader user had no way to hear which row was open.
 *
 * THE TREATMENT IS TWO SIGNALS, NOT ONE. A solid `--accent` ground (a real
 * surface step, not a wash) and a 3px `--primary` rail down the leading edge.
 * Ground alone is theme-fragile — it is one token step and tenants retune
 * surfaces. The rail is the tenant's own accent at full strength against a
 * neutral ground, so it survives any palette, and its SHAPE is what the eye
 * picks up at a glance rather than its colour, which is also what makes it
 * legible to the ~8% of this corridor's users with a colour-vision deficiency.
 *
 * IT IS HALF OF A PAIR. `<SplitPane activeKind>` draws the same rail down the
 * leading edge of the detail pane. Two rails of one colour and one width read
 * as one object — the row and the pane it opened — which is the whole point:
 * the bond is what answers "what is in the right pane", not the row marker on
 * its own.
 *
 * @example
 * <IndexRow
 *   selected={r.service_type_id === selId}
 *   onClick={() => setSelId(r.service_type_id)}
 *   className="flex-col gap-0.5"
 * >
 *   <span className="truncate font-medium">{r.name_en}</span>
 *   <span className="micro">{r.key}</span>
 * </IndexRow>
 *
 * BEST PRACTICE. Pass LAYOUT in `className` (`flex-col`, `items-center
 * justify-between`) and nothing else — ground, rail, padding and state belong
 * to the component, and a call site that re-states them is the thirteen-copy
 * problem starting again.
 */
import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * The open row's ground and rail COLOUR, for a rail that cannot be an
 * `<IndexRow>` — the inbox thread row carries a checkbox, a star and an open
 * button, so it is a `<li>` with three controls in it rather than one button.
 * Geometry (where the rail sits, how the row is padded) stays with the list,
 * because a flush bordered list and a rounded card list want different rails;
 * the SEMANTIC half — this is the open one — is shared so the two cannot drift
 * into two different meanings of "open".
 */
export const INDEX_ROW_OPEN =
  "bg-accent text-accent-foreground before:bg-primary";

/** The same, for a row that is not the open one. */
export const INDEX_ROW_IDLE = "before:bg-transparent hover:bg-muted";

export function IndexRow({
  selected,
  onClick,
  className,
  children,
  title,
  disabled,
}: {
  /** Is this the record the detail pane is showing? */
  selected: boolean;
  onClick?: () => void;
  /** LAYOUT ONLY — the selected/hover treatment is the component's. */
  className?: string;
  children: React.ReactNode;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      // `aria-current` and not `aria-selected`: these are buttons in a plain
      // container, not options in a `listbox`, and `aria-selected` on a role
      // that does not support it is dropped by the mapping (axe flags it).
      // "true" is the correct token here — the row is not a page, a step or a
      // location, it is the current item of a set.
      aria-current={selected ? "true" : undefined}
      className={cn(
        "relative flex w-full rounded-md py-2 pl-4 pr-3 text-left text-sm transition-colors",
        // The rail. A pseudo-element rather than a border so it does not move
        // the text by 3px when it appears, and inset-y-1 so it reads as a
        // marker ON the row rather than a divider BETWEEN rows.
        "before:absolute before:inset-y-1 before:left-1 before:w-[3px] before:rounded-full before:transition-colors before:content-['']",
        selected
          ? cn(INDEX_ROW_OPEN, "font-medium")
          : cn(INDEX_ROW_IDLE, "text-foreground"),
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}
