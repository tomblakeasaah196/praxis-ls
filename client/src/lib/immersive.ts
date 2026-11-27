/**
 * Immersive mode: a screen asks the shell to get out of the way on a phone.
 *
 * ── WHAT IT IS FOR ─────────────────────────────────────────────────────────
 *
 * An open conversation on a phone used to sit inside five layers of chrome:
 * the title bar, the Comms tab strip, the chat card's own border and padding,
 * the conversation header, and the bottom nav, with the floating cluster on
 * top of the composer's mic. Roughly 280px of a 800px screen was spent before
 * the first message. The owner's ask (27 Nov 2026) was the WhatsApp shape: a
 * conversation takes the whole screen, top to bottom, and its back arrow is
 * the way back to the shell.
 *
 * ── HOW ────────────────────────────────────────────────────────────────────
 *
 * The screen RAISES the flag with `useImmersive(true)` while it is showing,
 * and the chrome READS it with `useIsImmersive()` and hides itself BELOW `md`
 * only (`max-md:` classes, or not rendering a surface that is touch-only
 * anyway). Desktop never changes: the flag can be up on a 1440px screen and
 * nothing there reads it.
 *
 * The content is not portalled into an overlay. The shell hides its own
 * chrome, so <main> grows to the viewport and the screen's existing height
 * chain fills it. Dialogs, the call overlay, toasts and banners keep the
 * stacking they already had; an overlay would have had to win a z-index
 * argument with every one of them.
 *
 * A counter, not a boolean, so two screens raising it (a conversation inside a
 * hub that also raises it) cannot lower it for each other on unmount.
 */
import * as React from "react";

let raised = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const read = () => raised > 0;
const readServer = () => false;

/** Ask the shell to hide its chrome on a phone for as long as `active` holds. */
export function useImmersive(active: boolean): void {
  React.useEffect(() => {
    if (!active) return undefined;
    raised += 1;
    emit();
    return () => {
      raised = Math.max(0, raised - 1);
      emit();
    };
  }, [active]);
}

/** True while any screen has raised immersive mode. */
export function useIsImmersive(): boolean {
  return React.useSyncExternalStore(subscribe, read, readServer);
}

/**
 * Fit the shell to the VISIBLE viewport while immersive, so the composer sits
 * on top of the on-screen keyboard rather than under it.
 *
 * Mobile browsers resize the visual viewport for the keyboard and leave the
 * layout viewport alone (Chrome's default `interactive-widget=resizes-visual`,
 * and iOS Safari always). The shell is `height: 100%` of the layout viewport,
 * so without this the bottom of a full-screen conversation, which is the
 * composer being typed into, is behind the keyboard.
 *
 * Writes custom properties on <html>, read under `max-md:`: the visible
 * height and how far the browser has panned the visual viewport down to
 * reveal the focused field (the shell's root), and the bottom safe-area inset
 * to keep (a full-screen conversation's pane). Cleared on the way out, so
 * every other screen is exactly as it was.
 */
export function useImmersiveViewport(active: boolean): void {
  React.useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!active || !vv) return undefined;
    const root = document.documentElement;
    const apply = () => {
      root.style.setProperty("--immersive-h", `${Math.round(vv.height)}px`);
      root.style.setProperty(
        "--immersive-top",
        `${Math.max(0, Math.round(vv.offsetTop))}px`,
      );
      // The home-indicator inset belongs at the bottom of the SCREEN. With the
      // keyboard up the bottom is the keyboard, and iOS keeps reporting the
      // inset, which would leave a strip between the composer and the keys.
      const keyboardUp = window.innerHeight - vv.height > 120;
      root.style.setProperty(
        "--immersive-safe-bottom",
        keyboardUp ? "0px" : "env(safe-area-inset-bottom)",
      );
      // iOS scrolls the document itself to reveal a focused field, even with
      // `overflow: hidden` on <html>. The shell has already shrunk to fit, so
      // that scroll only pushes the header off the top.
      if (window.scrollY) window.scrollTo(0, 0);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      root.style.removeProperty("--immersive-h");
      root.style.removeProperty("--immersive-top");
      root.style.removeProperty("--immersive-safe-bottom");
    };
  }, [active]);
}
