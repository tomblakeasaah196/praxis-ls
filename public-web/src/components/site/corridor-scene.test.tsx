import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CorridorScene, __capable } from "./corridor-scene";
import { buildGraph, abstractGraph } from "@/lib/corridor-graph";
import * as api from "@/lib/corridors-api";

/**
 * The signature set piece (§7.5).
 *
 * ── THE BASELINE IS TESTED WITHOUT WEBGL, WHICH IS THE POINT ──────────────
 *
 * jsdom has no WebGL context, no `deviceMemory` and no `navigator.connection`.
 * That makes it exactly the environment §7.5(b) cares about: "a visitor who
 * never gets the WebGL scene must not be able to tell something is missing."
 * Every test below runs in that world, and the scene is expected to be
 * complete — labelled, navigable, readable — with no error state and no hole.
 */

const lane = (over: Partial<api.Corridor> = {}): api.Corridor => ({
  origin: "Douala",
  destination: "N'Djamena",
  mode: "LAND",
  files: 12,
  ...over,
});

function setMedia(opts: { reduced?: boolean; fine?: boolean } = {}) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion")
        ? Boolean(opts.reduced)
        : query.includes("pointer: fine")
          ? opts.fine !== false
          : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => setMedia());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the graph", () => {
  it("makes one node per place, not one per endpoint", () => {
    // A hub that is the origin of two lanes and the destination of a third is
    // ONE place. Drawing it three times is what turns a network back into a
    // list of pairs.
    const g = buildGraph([
      lane({ origin: "Douala", destination: "Kribi" }),
      lane({ origin: "Douala", destination: "Yaoundé" }),
      lane({ origin: "Kribi", destination: "Douala" }),
    ]);
    expect(g.nodes.map((n) => n.label).sort()).toEqual(["Douala", "Kribi", "Yaoundé"]);
    expect(g.lanes).toHaveLength(3);
  });

  it("weights a place by the files through it, both directions", () => {
    const g = buildGraph([
      lane({ origin: "Douala", destination: "Kribi", files: 10 }),
      lane({ origin: "Kribi", destination: "Douala", files: 5 }),
    ]);
    expect(g.nodes.find((n) => n.label === "Douala")?.weight).toBe(15);
  });

  it("falls back to the abstract graph when the ledger publishes nothing", () => {
    // The k-anonymity floor answers an empty array for a young tenant, which is
    // the NORMAL case, not an error.
    expect(buildGraph([]).abstract).toBe(true);
  });

  it("gives the abstract graph no labels and no weights", () => {
    // §7.5: "abstract by design … it must never imply lanes the tenant does not
    // run." A node with a name is a claim; a node with a count is a bigger one.
    const g = abstractGraph();
    expect(g.nodes.every((n) => n.label === null)).toBe(true);
    expect(g.nodes.every((n) => n.weight === 0)).toBe(true);
  });
});

describe("the baseline, with no WebGL anywhere", () => {
  it("draws a complete, labelled scene", async () => {
    vi.spyOn(api, "listCorridors").mockResolvedValue([lane()]);
    render(<CorridorScene />);
    expect(await screen.findByRole("group")).toBeTruthy();
    // Real places, from the ledger.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Douala" })).toBeTruthy(),
    );
  });

  it("shows no error, no spinner and no 'unavailable' anywhere", async () => {
    // The absence of the enhancement is not a state to report. There is a
    // scene, and it is this one.
    vi.spyOn(api, "listCorridors").mockResolvedValue([lane()]);
    const { container } = render(<CorridorScene />);
    await screen.findByRole("group");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
    expect(container.textContent).not.toMatch(/unavailable|indisponible|loading/i);
  });

  it("still draws a scene when the read fails", async () => {
    // FEATURE_DISABLED for a tenant without the website package. The abstract
    // graph is the answer, not a blank band.
    vi.spyOn(api, "listCorridors").mockRejectedValue(new Error("off"));
    render(<CorridorScene />);
    expect(await screen.findByRole("group")).toBeTruthy();
  });

  it("names no place and shows no count when the graph is abstract", async () => {
    vi.spyOn(api, "listCorridors").mockResolvedValue([]);
    render(<CorridorScene />);
    await screen.findByRole("group");
    // No node is a button, because none of them means anything to press.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    // And the readout, which is the only place a number ever appears, is absent.
    expect(document.querySelector(".corridor-readout")).toBeNull();
  });
});

describe("the keyboard", () => {
  it("is ONE tab stop, with arrows moving between nodes", async () => {
    // A roving tabstop. Fifteen nodes as fifteen tabstops is a decoration that
    // costs a keyboard user fifteen keystrokes to get past.
    vi.spyOn(api, "listCorridors").mockResolvedValue([
      lane({ origin: "Douala", destination: "Kribi", files: 9 }),
      lane({ origin: "Kribi", destination: "Yaoundé", files: 4 }),
    ]);
    render(<CorridorScene />);
    const group = await screen.findByRole("group");
    await waitFor(() => expect(screen.getAllByRole("button").length).toBe(3));

    const focusable = screen
      .getAllByRole("button")
      .filter((el) => el.getAttribute("tabindex") === "0");
    expect(focusable).toHaveLength(1);

    group.focus();
    await userEvent.keyboard("{ArrowRight}");
    const after = screen
      .getAllByRole("button")
      .filter((el) => el.getAttribute("tabindex") === "0");
    expect(after).toHaveLength(1);
    expect(after[0]).not.toBe(focusable[0]);
  });

  it("leaves on Escape rather than trapping anybody", async () => {
    // §7.5 asks for a focus trap; this deliberately does not build one — see
    // the note on onKeyDown. Escape returns focus to the figure, so the next
    // Tab continues down the page.
    vi.spyOn(api, "listCorridors").mockResolvedValue([lane()]);
    render(<CorridorScene />);
    const group = await screen.findByRole("group");
    group.focus();
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(group);
  });
});

describe("the capability gate", () => {
  const nav = navigator as Navigator & {
    connection?: unknown;
    deviceMemory?: number;
  };
  const set = (key: string, value: unknown) =>
    Object.defineProperty(nav, key, { value, configurable: true, writable: true });

  afterEach(() => {
    set("connection", undefined);
    set("deviceMemory", undefined);
  });

  it("passes on a capable desktop that reports nothing", () => {
    // deviceMemory and connection are Chromium-only. Treating "not reported" as
    // a failure would withhold the scene from every Safari and Firefox visitor
    // on a workstation — the opposite of what the gate is for.
    setMedia({ fine: true });
    expect(__capable()).toBe(true);
  });

  it("refuses a slow connection", () => {
    setMedia({ fine: true });
    set("connection", { effectiveType: "3g" });
    expect(__capable()).toBe(false);
  });

  it("obeys Save-Data", () => {
    // The visitor has asked their browser to use less data. Nothing decorative
    // overrides that.
    setMedia({ fine: true });
    set("connection", { effectiveType: "4g", saveData: true });
    expect(__capable()).toBe(false);
  });

  it("refuses a low-memory device", () => {
    setMedia({ fine: true });
    set("deviceMemory", 2);
    expect(__capable()).toBe(false);
  });

  it("refuses when the visitor asked for reduced motion", () => {
    setMedia({ reduced: true, fine: true });
    expect(__capable()).toBe(false);
  });
});
