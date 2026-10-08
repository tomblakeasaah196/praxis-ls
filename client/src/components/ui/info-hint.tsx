/**
 * InfoHint, the ⓘ that holds the explanation a screen used to print.
 *
 * WHY THIS EXISTS. Tenant review, 8 Oct 2026: "there is a lot of supporting
 * text on pages and it is useless at first glance". The measurement behind
 * that complaint was 805 `hint=`, 485 `description=` and 790 `.micro`
 * paragraphs in client/src. Master data alone carried 390. Every one of them
 * is printed to every operator on every visit, including the thousandth visit,
 * to answer a question almost nobody is asking.
 *
 * So the explanation moves behind an icon and the screen keeps the label.
 * See doc/FRONTEND_GUIDE.md §3.17 for the four-step ladder (delete, fold into
 * the control, hide behind this, keep visible) and `npm run check:prose` for
 * the gate that holds it.
 *
 * WHY NOT `<Tooltip>`, WHICH ALREADY EXISTS. Radix Tooltip opens on hover and
 * focus and NEVER on touch. tooltip.tsx says so itself: "It does not appear on
 * touch at all, so anything a user MUST read to operate the screen belongs in a
 * `<Field hint>`". Praxis is an installable PWA whose operations people work on
 * tablets, so a tooltip here would hide the text from them permanently. This is
 * a Popover, which opens on tap, plus the hover and focus behaviour a desktop
 * user expects. One primitive, every input device.
 *
 * HIDDEN IS NOT DELETED. The text is always in the DOM in a visually hidden
 * span that the trigger points at with `aria-describedby`, so a screen reader
 * announces it when focus reaches the field whether or not the panel is open.
 * Hiding the visual noise must not cost a blind operator the explanation. That
 * is also why the panel never steals focus when it opens on hover.
 *
 * WHAT DOES NOT GO IN HERE. Anything the user must know BEFORE they act:
 * an irreversible choice, what a destructive action destroys, a legal or tax
 * consequence. Those are not hidden, they are RELOCATED to the moment they
 * matter, which is the lock on the control or the `useConfirm()` body at the
 * point of commit. Nobody should discover "this cannot be changed later" by
 * hovering. §3.17 calls this point-of-action disclosure.
 *
 * @example
 * <Field label={tr("Reference code")} about={tr("Closes this service's file references. Blank generates one.")}>
 *   <Input … />
 * </Field>
 *
 * @example  // standalone, next to a heading or a stat
 * <InfoHint label={tr("About credit available")}>
 *   {tr("The approved limit minus everything outstanding.")}
 * </InfoHint>
 */
import * as React from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import { cn } from "@/lib/cn";
import { InfoIcon } from "@/components/ui/icons";

/** Hover-open delay. Matches `TooltipProvider`'s 300ms so the two feel alike
 *  when they sit on the same toolbar, and long enough that a pointer crossing
 *  a row of fields does not strobe every icon it passes. */
const HOVER_OPEN_MS = 300;
/** Close delay. Gives the pointer time to travel the 6px gap from the icon into
 *  the panel without it closing underneath them. */
const HOVER_CLOSE_MS = 120;

export function InfoHint({
  children,
  label,
  side = "top",
  align = "center",
  className,
  iconSize = 14,
  textId,
  hiddenText = true,
}: {
  /** The explanation. One or two short sentences. Keep interactive content out:
   *  a hover-opened panel is awkward to click into, and a user who needs to act
   *  wants the action on the page. */
  children: React.ReactNode;
  /**
   * Accessible name for the icon, e.g. "About reference code". Required and
   * never rendered: without it a screen reader announces "button" and the user
   * has no idea what it would explain. Name the FIELD, not the icon, so the
   * announcement reads as a question about something.
   */
  label: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
  iconSize?: number;
  /**
   * Id of a node the CALLER already renders holding this same text, as
   * `<Field about>` does. Given one, this component points the trigger at it
   * and renders no hidden copy of its own, so the sentence appears once in the
   * accessibility tree instead of twice. Omit it when InfoHint stands alone.
   */
  textId?: string;
  /**
   * Set false when the surrounding component ALREADY exposes this text to
   * assistive technology by another route, as `<Dialog>` does: Radix mints its
   * own id for `DialogDescription` and wires the dialog's `aria-describedby`
   * to it, so a hidden copy here would be the same sentence in the document
   * twice (and `getByText` would find two of it).
   */
  hiddenText?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  /* Opened by click or keyboard rather than by hover. A pointer leaving the
     icon must not close a panel the user deliberately pinned open. */
  const [pinned, setPinned] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const uid = React.useId();
  const ownTextId = `${uid}-hint`;
  const describedBy = hiddenText ? (textId ?? ownTextId) : undefined;

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  React.useEffect(() => clearTimer, []);

  /* Hover is a MOUSE affordance only. A touch "pointerenter" fires on tap and
     would race the click handler, opening and immediately reclosing the panel,
     so touch is left entirely to Radix's own click trigger. */
  const hoverOpen = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    clearTimer();
    timer.current = setTimeout(() => setOpen(true), HOVER_OPEN_MS);
  };
  const hoverClose = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || pinned) return;
    clearTimer();
    timer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
  };

  return (
    <>
      {/* Always present, regardless of the panel. This is what makes the text
          survive being hidden: the trigger's aria-describedby points here, so
          the explanation is announced on focus without anything being opened.
          Skipped when the caller already renders the text and lent us its id. */}
      {hiddenText && !textId ? (
        <span id={ownTextId} className="sr-only">
          {children}
        </span>
      ) : null}
      <RadixPopover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          setPinned(next);
          if (!next) clearTimer();
        }}
      >
        <RadixPopover.Trigger asChild>
          <button
            type="button"
            aria-label={label}
            aria-describedby={describedBy}
            onPointerEnter={hoverOpen}
            onPointerLeave={hoverClose}
            /*
             * FOCUS ALONE DOES NOT OPEN THIS, deliberately.
             *
             * It used to, which read well until this button landed inside a
             * Dialog. There it can be the first focusable element, so Radix's
             * open-autofocus put focus straight on it, the panel opened over
             * the first field of every dialog in the app, and the Escape that
             * should have closed the DIALOG closed the panel instead.
             * (:focus-visible does not separate the two: jsdom answers true
             * for programmatic focus, so the guard that looked right in a
             * browser was a no-op in the suite.)
             *
             * Nothing is lost. This is a <button>: Enter and Space open it, so
             * a keyboard user reaches the text in one keystroke, and a screen
             * reader already has it from the control's aria-describedby
             * without opening anything at all.
             */
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground",
              "align-[-0.125em] transition-colors hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              className,
            )}
          >
            <InfoIcon width={iconSize} height={iconSize} aria-hidden />
          </button>
        </RadixPopover.Trigger>
        <RadixPopover.Portal>
          <RadixPopover.Content
            side={side}
            align={align}
            sideOffset={6}
            collisionPadding={12}
            /* The panel is read-only text, and on hover-open the user never
               asked to leave the field they were in. Moving focus here would
               interrupt typing. Keyboard users still reach it: Escape closes,
               and the sr-only span above already carries the text. */
            onOpenAutoFocus={(e) => e.preventDefault()}
            /* And it does not take focus BACK on close. Radix returns focus to
               the trigger by default, which is right for a menu the user
               opened and wrong here: this panel closes when they click
               somewhere else, and that somewhere else is usually the field
               they want to type in. Returning focus to the ⓘ would empty the
               next keystrokes into nothing. */
            onCloseAutoFocus={(e) => e.preventDefault()}
            onPointerEnter={() => clearTimer()}
            onPointerLeave={hoverClose}
            aria-hidden
            className={cn(
              "z-50 max-w-[18rem] animate-fade-in rounded-lg border bg-popover px-3 py-2",
              "text-sm leading-snug text-popover-foreground shadow-[var(--shadow-l)]",
            )}
          >
            {children}
            <RadixPopover.Arrow className="fill-[var(--popover)]" />
          </RadixPopover.Content>
        </RadixPopover.Portal>
      </RadixPopover.Root>
    </>
  );
}
