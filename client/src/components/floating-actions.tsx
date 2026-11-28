/**
 * Floating action cluster — a primary FAB, bottom-right, that opens ONE plain
 * list card: the clock first, then Praxis AI (opens the copilot), Messages
 * (Smart Comms) and Help. The primary button carries the unread-messages badge.
 * The AI action only appears when the tenant's AI is enabled.
 *
 * WHAT IT IS NOT ANY MORE (owner's review, 28 Nov 2026: "too populated"). It
 * carried seven entries, each drawn as two floating shapes (a label pill and a
 * round button) with its own shadow and ring, on a blurred card: fourteen
 * elevated objects for seven destinations. Three of those destinations did not
 * belong here:
 *
 *   Notifications  the top bar's bell is the same screen with the same count;
 *                  the FAB's badge now counts messages alone, which is what
 *                  opening this menu can actually clear;
 *   Feedback       moved to the account menu (Send Feedback). The desktop rail
 *                  keeps it, from the shared quick-action list;
 *   Reload         moved to the account menu (Reload App), still the full
 *                  service-worker handover. Pull-to-refresh and the new-version
 *                  banner cover the daily cases.
 *
 * And the blur went with them, for a reason beyond weight: a backdrop blur on
 * an ancestor makes the browser refuse every tap on its own location button
 * (`<geolocation>`, Chromium 158: `intersection_occluded_or_distorted`), and
 * the clock's location card used to sit inside this card.
 *
 * TOUCH ONLY, as of Phase 5 (audit F9). The cluster is `md:hidden`; on desktop
 * the same list renders in `<IconRail>`'s tail.
 *
 * IT RENDERS ON EVERY TOUCH SCREEN, Smart Comms included. It used to be
 * suppressed there because it covered the composer's send control, with a
 * top-bar menu standing in; that menu is gone at every width, so suppressing it
 * here would leave a phone on `/comms` with no quick actions at all. It clears
 * the composer instead of hiding from it — see `--fab-floor` below.
 *
 * The audit's objection was not that a FAB is ugly. It is that this one sits at
 * `fixed bottom-24 right-5` — precisely where a list screen's last rows and its
 * pager are — and that being draggable was the workaround for that rather than a
 * feature. Worse, the dragged position PERSISTS: moving it out of the way on one
 * screen moved it into the way on every other one, permanently. On a phone the
 * trade is different and the pattern is right: the thumb is at the bottom right,
 * there is no chrome to spare, and there is nothing underneath at that moment
 * that a tap is competing with.
 *
 * Praxis AI opens the copilot via the `praxis:open-copilot` window event, so this
 * stays decoupled from the copilot component (which owns the panel). The action
 * list itself comes from `useQuickActions` so the two surfaces cannot drift.
 *
 * The cluster is draggable: press-and-drag the primary FAB to move it anywhere on
 * screen; the drop position is remembered (localStorage) across reloads. A small
 * move threshold distinguishes a drag from a click, so tapping still toggles the
 * menu. Anchored by the FAB's bottom edge so the actions still expand upward.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { ClockPunch } from "@/components/clock-punch";
import { useQuickActions } from "@/components/quick-actions";
import { cn } from "@/lib/cn";

type IP = React.SVGProps<SVGSVGElement>;
const s = (p: IP) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  width: 20,
  height: 20,
  "aria-hidden": true,
  ...p,
});
const BurstIcon = (p: IP) => (
  <svg {...s(p)} width={24} height={24}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
);
export function FloatingActions({
  badge = 0,
  messageBadge = 0,
}: {
  /** On the closed FAB. Unread messages: the one count this menu can clear. */
  badge?: number;
  /** Unread messages specifically — shown on the Messages row when open. */
  messageBadge?: number;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  // Draggable position (FAB top-left, viewport px). null → default bottom-right
  // anchor. Persisted so it stays where the user drops it.
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem("praxis.fab.pos");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const posRef = React.useRef(pos);
  posRef.current = pos;
  const draggedRef = React.useRef(false); // set during a drag so the click toggle is suppressed

  const startDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - rect.left,
      dy = e.clientY - rect.top;
    const sx = e.clientX,
      sy = e.clientY;
    const FAB = 56,
      PAD = 8;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved = true;
      draggedRef.current = true;
      setOpen(false);
      const x = Math.min(
        Math.max(PAD, ev.clientX - dx),
        window.innerWidth - FAB - PAD,
      );
      const y = Math.min(
        Math.max(PAD, ev.clientY - dy),
        window.innerHeight - FAB - PAD,
      );
      const p = { x, y };
      posRef.current = p;
      setPos(p);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved && posRef.current) {
        try {
          localStorage.setItem(
            "praxis.fab.pos",
            JSON.stringify(posRef.current),
          );
        } catch {
          /* ignore */
        }
      }
      setTimeout(() => {
        draggedRef.current = false;
      }, 0); // let the click that follows read it, then reset
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Anchor by the RIGHT + BOTTOM edge. The cluster is right-aligned (items-end),
  // so anchoring the left edge made the FAB drift sideways whenever the actions
  // expanded and widened the container; pinning the right edge keeps the FAB
  // exactly where it was dropped, and the actions still expand up-and-leftward.
  const containerStyle = React.useMemo<React.CSSProperties | undefined>(() => {
    if (!pos) return undefined;
    const FAB = 56,
      PAD = 8;
    const x = Math.min(Math.max(PAD, pos.x), window.innerWidth - FAB - PAD);
    const y = Math.min(Math.max(PAD, pos.y), window.innerHeight - FAB - PAD);
    return {
      left: "auto",
      top: "auto",
      right: window.innerWidth - (x + FAB),
      bottom: window.innerHeight - (y + FAB),
    };
  }, [pos]);

  /*
   * TAP TO OPEN, TAP OUTSIDE OR ESCAPE TO CLOSE. Nothing else.
   *
   * It used to open on hover and on focus as well as toggle on click. On a
   * touchscreen a single tap fires all three (the browser sends the
   * compatibility `mouseenter` and focuses the button before the `click`), so
   * the menu opened and the click shut it again: Playwright's tap measured it
   * staying closed. A component that only ever renders below `md` has no hover
   * to serve. `pointerdown` rather than `mousedown` for outside taps, because
   * on touch the compatibility mouse events come late or not at all.
   */
  React.useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = React.useCallback(() => setOpen(false), []);
  // Feedback is in the account menu on a phone (owner's decision, 28 Nov
  // 2026); the shared list still offers it to the desktop rail.
  const actions = useQuickActions(close).filter((a) => a.key !== "feedback");

  // Portal to <body> so position:fixed is viewport-relative. A transformed page
  // ancestor would otherwise become the containing block, so the drag math (which
  // uses viewport-relative pointer + rect coords) would land the FAB in the wrong
  // place and it would drift away from the cursor.
  return createPortal(
    <div
      ref={ref}
      style={containerStyle}
      /*
       * `md:hidden` is the Phase 5 change: on desktop this cluster covered the
       * bottom-right of every table, and dragging it was the workaround rather
       * than the fix. The icon rail's tail is the desktop home for the same
       * list — see `quick-actions.tsx`.
       *
       * `--fab-floor` IS WHAT PUT THIS BACK ON THE CHAT SCREEN. 6rem clears the
       * bottom nav, which is all there is to clear on a list screen. Smart
       * Comms is the one screen with a second bottom-docked control — the chat
       * composer, whose Send and mic buttons are in this exact corner — so the
       * composer publishes the height it needs kept clear and this takes the
       * larger of the two. Unset everywhere else, where `max()` falls through
       * to the 6rem the cluster has always used.
       */
      className="fixed bottom-[max(6rem,var(--fab-floor,0px))] right-5 z-50 flex flex-col items-end gap-3 md:hidden"
    >
      {open && (
        /*
         * ONE surface: a solid card, one shadow, rows inside it. No blur (see
         * the header), no shadow or ring per row.
         */
        <div
          id="quick-actions-menu"
          className="w-64 rounded-2xl border bg-card p-1.5 shadow-[var(--shadow-l)] animate-fade-in"
        >
          {/* The clock first and highlighted: it is the one thing every
              employee does here every day. Renders nothing for somebody who is
              not an employee, so its divider comes with it. */}
          <ClockPunch />
          {actions.map((a) => {
            const showBadge = a.key === "msg" && messageBadge > 0;
            return (
              <button
                key={a.key}
                type="button"
                onClick={a.onSelect}
                aria-label={showBadge ? `${a.label}, ${messageBadge} unread` : a.label}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:bg-accent"
              >
                <span aria-hidden className="text-muted-foreground">
                  <a.Icon />
                </span>
                <span className="flex-1">{a.label}</span>
                {showBadge && (
                  <span
                    aria-hidden
                    className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand-blue-deep px-1.5 text-[11px] font-bold leading-none text-white"
                  >
                    {messageBadge > 99 ? "99+" : messageBadge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <button
        onPointerDown={startDrag}
        onClick={() => {
          if (draggedRef.current) return;
          setOpen((o) => !o);
        }}
        aria-label="Quick actions (drag to move)"
        aria-expanded={open}
        aria-controls={open ? "quick-actions-menu" : undefined}
        className={cn(
          // `hover:scale-105` removed (F17). The rotation stays — it is not
          // decoration, it turns the burst into a close glyph and is the only
          // thing telling you the button's meaning has changed.
          "relative grid h-14 w-14 cursor-grab touch-none select-none place-items-center rounded-full bg-primary text-primary-foreground shadow-xl transition-transform duration-150 active:cursor-grabbing",
          open && "rotate-45",
        )}
      >
        <BurstIcon />
        {badge > 0 && !open && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-brand-blue-deep px-1 text-[10px] font-bold text-white ring-2 ring-background">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>
    </div>,
    document.body,
  );
}
