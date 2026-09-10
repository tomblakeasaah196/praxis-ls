import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  useScrollScrub,
  usePointerLight,
  useProximity,
  motionReduced,
} from "@/lib/motion";

/**
 * The motion primitives, held to the two promises that make them safe to put
 * on every page: they honour reduced motion by rendering the SETTLED state, and
 * they never drive animation through React.
 *
 * The second is not a style preference. A scroll scrub that calls setState
 * re-renders its subtree sixty times a second, and on the mid-range Android
 * this app exists for that is the difference between a page that glides and one
 * that stutters. It is also invisible in review and invisible in a screenshot,
 * which is exactly the kind of thing worth a test.
 */

type MediaState = { reduce: boolean; fine: boolean };

const setMedia = ({ reduce, fine }: MediaState) =>
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("reduce") ? reduce : q.includes("pointer: fine") ? fine : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));

/** rAF runs synchronously so a test can assert the written value without
 *  waiting a frame — the hooks batch through it deliberately. */
beforeEach(() => {
  setMedia({ reduce: false, fine: true });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => vi.unstubAllGlobals());

/** Attach a hook's ref to a real element, since every one of them is a no-op
 *  without one. */
function mount<T extends HTMLElement>(
  use: () => React.RefObject<T>,
  el: HTMLElement = document.createElement("div"),
) {
  document.body.appendChild(el);
  const view = renderHook(() => {
    const ref = use();
    (ref as { current: HTMLElement | null }).current = el;
    return ref;
  });
  // A second render so the effect runs with the ref populated — the same
  // sequence React produces in a real tree, where the ref is attached during
  // commit and before effects fire.
  act(() => view.rerender());
  return { el, view };
}

describe("useScrollScrub", () => {
  it("renders the settled state under reduced motion, and attaches nothing", () => {
    setMedia({ reduce: true, fine: true });
    const addSpy = vi.spyOn(window, "addEventListener");
    const { el } = mount(() => useScrollScrub<HTMLDivElement>({ prop: "--p" }));

    expect(el.style.getPropertyValue("--p")).toBe("1");
    // Somebody who asked for less motion has not asked for a cheaper listener
    // that still moves things — there must be no scroll subscription at all.
    expect(addSpy.mock.calls.filter(([type]) => type === "scroll")).toHaveLength(0);
  });

  it("writes progress to a custom property rather than to React state", () => {
    let renders = 0;
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.getBoundingClientRect = () =>
      ({ top: 0, height: 500, bottom: 500, left: 0, right: 0, width: 100 }) as DOMRect;

    const view = renderHook(() => {
      renders += 1;
      const ref = useScrollScrub<HTMLDivElement>({ prop: "--p" });
      (ref as { current: HTMLElement | null }).current = el;
      return ref;
    });
    act(() => view.rerender());
    const rendersAfterMount = renders;

    act(() => {
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("scroll"));
    });

    // The property moved; the component did not re-render. That is the whole
    // contract.
    expect(el.style.getPropertyValue("--p")).not.toBe("");
    expect(renders).toBe(rendersAfterMount);
  });

  it("removes its listener and its property when the last subscriber leaves", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { el, view } = mount(() => useScrollScrub<HTMLDivElement>({ prop: "--p" }));
    act(() => view.unmount());

    expect(el.style.getPropertyValue("--p")).toBe("");
    expect(removeSpy.mock.calls.some(([type]) => type === "scroll")).toBe(true);
  });
});

describe("usePointerLight", () => {
  it("writes --lx/--ly from the pointer inside the element", () => {
    const el = document.createElement("div");
    el.getBoundingClientRect = () =>
      ({ top: 0, left: 0, width: 200, height: 100, bottom: 100, right: 200 }) as DOMRect;
    mount(() => usePointerLight<HTMLDivElement>(), el);

    act(() => {
      const ev = new Event("pointermove") as PointerEvent;
      Object.defineProperty(ev, "clientX", { value: 50 });
      Object.defineProperty(ev, "clientY", { value: 25 });
      window.dispatchEvent(ev);
    });

    expect(Number(el.style.getPropertyValue("--lx"))).toBeCloseTo(0.25, 2);
    expect(Number(el.style.getPropertyValue("--ly"))).toBeCloseTo(0.25, 2);
  });

  it("does nothing on a coarse pointer", () => {
    // A touch device has no hover and no cursor to follow; useTilt is the
    // equivalent there. Listening anyway would burn a frame budget on every
    // scroll-drag for an effect nobody can see.
    setMedia({ reduce: false, fine: false });
    const addSpy = vi.spyOn(window, "addEventListener");
    mount(() => usePointerLight<HTMLDivElement>());
    expect(addSpy.mock.calls.filter(([t]) => t === "pointermove")).toHaveLength(0);
  });

  it("does nothing under reduced motion", () => {
    setMedia({ reduce: true, fine: true });
    const addSpy = vi.spyOn(window, "addEventListener");
    mount(() => usePointerLight<HTMLDivElement>());
    expect(addSpy.mock.calls.filter(([t]) => t === "pointermove")).toHaveLength(0);
  });
});

describe("useProximity", () => {
  it("measures to the nearest EDGE, not to the centre", () => {
    // A wide card measured from its centre reports "far" while the pointer is
    // sitting on its corner, which is the bug this distance function exists to
    // avoid.
    const el = document.createElement("div");
    el.getBoundingClientRect = () =>
      ({ top: 0, left: 0, width: 600, height: 40, bottom: 40, right: 600 }) as DOMRect;
    mount(() => useProximity<HTMLDivElement>({ radius: 100 }), el);

    act(() => {
      const ev = new Event("pointermove") as PointerEvent;
      // Just outside the right edge: 10px away from the edge, 310px from centre.
      Object.defineProperty(ev, "clientX", { value: 610 });
      Object.defineProperty(ev, "clientY", { value: 20 });
      window.dispatchEvent(ev);
    });

    // 10px inside a 100px radius reads as very near. Centre-distance would have
    // reported 0.
    expect(Number(el.style.getPropertyValue("--near"))).toBeCloseTo(0.9, 2);
  });
});

describe("motionReduced", () => {
  it("reports the platform preference", () => {
    setMedia({ reduce: true, fine: true });
    expect(motionReduced()).toBe(true);
    setMedia({ reduce: false, fine: true });
    expect(motionReduced()).toBe(false);
  });
});
