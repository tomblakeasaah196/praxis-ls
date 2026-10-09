import { describe, it, expect, vi, afterEach } from "vitest";
import * as React from "react";
import { act, render } from "@testing-library/react";
import { ToastProvider, useToast } from "./kit";

/**
 * The toast auto-dismiss must not outlive the tree it updates.
 *
 * WHAT THIS PINS, and why it is not just hygiene. `ToastProvider` armed a 3.6s
 * `setTimeout` and never cancelled it. The timer then fired into a tree that
 * might be gone:
 *
 *   · under test, vitest tears jsdom down first, so the callback reaches
 *     React's dispatchSetState with no `window` and the whole run exits 1 on
 *     `ReferenceError: window is not defined` — with every test passing. It is
 *     intermittent, because it only happens when the suite finishes inside
 *     3.6s of the last toast, which is why a loaded CI runner saw it and a
 *     developer's machine did not;
 *   · in a browser, somebody who leaves the portal within 3.6s of a toast gets
 *     the quieter form: a setState into an unmounted component.
 *
 * A timing-dependent failure cannot be proved fixed by re-running it, so this
 * asserts the mechanism instead: the timer is armed on push, and cancelled on
 * unmount.
 */

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Pushes one toast as soon as it mounts. */
function PushOnMount() {
  const push = useToast();
  React.useEffect(() => push("Saved"), [push]);
  return null;
}

/** Hands the provider's `push` back to the test, so toasts can be staggered:
 *  two armed in the same tick expire in the same tick, which proves nothing. */
function CapturePush({ onReady }: { onReady: (p: (t: string) => void) => void }) {
  const push = useToast();
  React.useEffect(() => onReady(push), [push, onReady]);
  return null;
}

describe("the portal's toast auto-dismiss", () => {
  it("cancels its pending timer when the provider unmounts", () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");

    const view = render(
      <ToastProvider>
        <PushOnMount />
      </ToastProvider>,
    );

    // Armed, and not yet fired.
    expect(vi.getTimerCount()).toBe(1);

    act(() => void view.unmount());

    expect(clearSpy).toHaveBeenCalled();
    // Nothing left to fire into the tree that has just gone.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels only what is still pending, so a long session accumulates nothing", () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    let push!: (t: string) => void;

    const view = render(
      <ToastProvider>
        <CapturePush onReady={(p) => { push = p; }} />
      </ToastProvider>,
    );

    act(() => void push("Saved"));
    // Staggered: the second is armed 2s into the first one's 3.6s life.
    act(() => void vi.advanceTimersByTime(2000));
    act(() => void push("Sent"));
    expect(vi.getTimerCount()).toBe(2);

    // Past the FIRST dismiss only. The second has 2s left to run.
    act(() => void vi.advanceTimersByTime(1700));
    expect(vi.getTimerCount()).toBe(1);

    clearSpy.mockClear();
    act(() => void view.unmount());

    /* Exactly one: the still-pending timer. Not two, which would mean the
       fired id was kept for ever and every toast of a long session leaked an
       entry. Not zero, which is what the unfixed provider does — and is why
       this assertion, unlike a bare "nothing threw", actually fails without
       the fix. */
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
