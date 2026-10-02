/**
 * The 5-minute signing window, as the app knows it (meeting 6, F6).
 *
 * One store for the whole app, because the window is the SESSION's, not a
 * screen's: the costing that opened it and the cash request signed two
 * minutes later are different screens, and the "Signing unlocked · 4:12 ·
 * End now" badge lives in the shell. The server is the authority
 * (GET /signatures/proof/window); this only caches its answer and counts down.
 *
 * Never extended by use: the store holds the server's `expires_at` and the
 * badge counts down to it. Sign-out and the lock screen end the session, and
 * with it the window — `clear()` drops the local copy at the same moment.
 */
import * as React from "react";
import {
  endSigningWindow,
  getSigningWindow,
  type SigningWindowState,
} from "@/lib/signing-proof";

type Listener = () => void;

let state: SigningWindowState | null = null;
const listeners = new Set<Listener>();
let watchTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  for (const l of listeners) l();
}

function set(next: SigningWindowState | null) {
  state = next && next.open ? next : null;
  emit();
}

/** Milliseconds left, 0 when there is no open window. */
export function remainingMs(now = Date.now()): number {
  if (!state || !state.expires_at) return 0;
  return Math.max(0, new Date(state.expires_at).getTime() - now);
}

/**
 * Is there a window this signature can use? A small margin, so a request does
 * not leave with two seconds to spare and arrive after the server closed it.
 */
export function usable(marginMs = 5000): boolean {
  return remainingMs() > marginMs;
}

/** Ask the server. A failure is "no window" — the next signature then asks for a proof. */
export async function refresh(): Promise<SigningWindowState | null> {
  try {
    set(await getSigningWindow());
  } catch {
    // No answer means no window: the next signature asks for a proof.
    set(null);
  }
  return state;
}

/**
 * After a proof is handed to a signing request, the window opens when that
 * signature is written. Look a few times until it shows, then stop.
 */
export function watchForOpen(): void {
  if (watchTimer) clearTimeout(watchTimer);
  const delays = [1200, 2500, 5000, 10000];
  const step = (i: number) => {
    watchTimer = setTimeout(async () => {
      const w = await refresh();
      if (!w && i + 1 < delays.length) step(i + 1);
      else watchTimer = null;
    }, delays[i]);
  };
  step(0);
}

/** "End now". */
export async function end(): Promise<void> {
  try {
    await endSigningWindow();
  } finally {
    set(null);
  }
}

/** Sign-out / lock: the session is over, and the window with it. */
export function clear(): void {
  if (watchTimer) clearTimeout(watchTimer);
  watchTimer = null;
  set(null);
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The current window (or null), re-rendering when it changes. */
export function useSigningWindow(): SigningWindowState | null {
  return React.useSyncExternalStore(subscribe, () => state, () => null);
}
