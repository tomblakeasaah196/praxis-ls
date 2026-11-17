/**
 * "Will the server accept this action?": what a screen asks before it draws a
 * write button.
 *
 * THE DIRECTION OF EVERY DOUBT IS PINNED HERE. A button hidden from someone who
 * could have used it is a bug nobody reports: the person assumes the product
 * cannot do the thing. So each case where the answer is not known (an API that
 * predates the field, a cached record from an older build, a shell that has not
 * resolved) must answer "offer it". The only thing that hides a button is a
 * server answer that says the grant is not held.
 */
import * as React from "react";
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { canDo, useCan } from "./route-access";
import { coerceNavAccess, type NavAccess } from "./nav-access";
import { ShellContext } from "@/app/layout/shell-context";
import { EMPTY_SHELL_PREFS } from "@/lib/preferences";

const user = (actions?: Record<string, string[]>, isCeo = false): NavAccess => ({
  modules: ["MOD-51"],
  groups: [],
  byGroup: {},
  isCeo,
  version: "v",
  ...(actions ? { actions } : {}),
});

describe("canDo", () => {
  it("allows an action the grant holds", () => {
    expect(canDo(user({ "MOD-51": ["create"] }), "MOD-51", "create")).toBe(true);
  });

  it("REFUSES ONE IT DOES NOT: read invoices, cannot create one", () => {
    expect(canDo(user({ "MOD-51": ["edit"] }), "MOD-51", "create")).toBe(false);
  });

  it("refuses every write on a module held read-only, which has no entry", () => {
    const readOnly = user({});
    for (const action of ["create", "edit", "delete", "approve"] as const)
      expect(canDo(readOnly, "MOD-51", action)).toBe(false);
  });

  it("does not let a grant on one module answer for another", () => {
    expect(canDo(user({ "MOD-05": ["create"] }), "MOD-51", "create")).toBe(false);
  });

  it("lets a CEO through with no grant rows, because rbac.js does", () => {
    expect(canDo(user({}, true), "MOD-51", "delete")).toBe(true);
  });

  it("OFFERS when the answer carries no `actions` at all: an older API", () => {
    // Absent is unknown, not nothing. Reading it as nothing would strip every
    // write button from every screen on the first paint after a deploy.
    expect(canDo(user(undefined), "MOD-51", "create")).toBe(true);
  });

  it("compares module keys case-insensitively", () => {
    expect(canDo(user({ "MOD-51": ["create"] }), "mod-51", "create")).toBe(true);
  });
});

describe("coerceNavAccess keeps `actions` honest", () => {
  it("carries the map through, upper-casing its keys", () => {
    const a = coerceNavAccess({ modules: ["MOD-51"], actions: { "mod-51": ["create"] } });
    expect(a.actions).toEqual({ "MOD-51": ["create"] });
  });

  it("leaves `actions` ABSENT when the response had none, so it stays unknown", () => {
    const a = coerceNavAccess({ modules: ["MOD-51"] });
    expect("actions" in a).toBe(false);
    expect(canDo(a, "MOD-51", "create")).toBe(true);
  });

  it("treats a malformed map as absent, and a malformed entry as nothing held", () => {
    expect("actions" in coerceNavAccess({ actions: ["create"] })).toBe(false);
    expect("actions" in coerceNavAccess({ actions: "all" })).toBe(false);
    const a = coerceNavAccess({ actions: { "MOD-51": "create", "MOD-05": ["create", 7] } });
    expect(a.actions).toEqual({ "MOD-05": ["create"] });
  });

  it("an empty map is an ANSWER: this role holds no write anywhere", () => {
    const a = coerceNavAccess({ modules: ["MOD-51"], actions: {} });
    expect(canDo(a, "MOD-51", "create")).toBe(false);
  });
});

describe("useCan", () => {
  const wrapper =
    (access: NavAccess, resolved = true) =>
    ({ children }: { children: React.ReactNode }) => (
      <ShellContext.Provider
        value={{
          access,
          ready: true,
          resolved,
          prefs: EMPTY_SHELL_PREFS,
          setPrefs: () => {},
          grantNotice: null,
          dismissGrantNotice: () => {},
        }}
      >
        {children}
      </ShellContext.Provider>
    );

  it("answers for the screen's module", () => {
    const { result } = renderHook(() => useCan("MOD-51"), {
      wrapper: wrapper(user({ "MOD-51": ["create"] })),
    });
    expect(result.current("create")).toBe(true);
    expect(result.current("delete")).toBe(false);
  });

  it("answers for another module when one button belongs elsewhere", () => {
    const { result } = renderHook(() => useCan("MOD-51"), {
      wrapper: wrapper(user({ "MOD-05": ["create"] })),
    });
    expect(result.current("create")).toBe(false);
    expect(result.current("create", "MOD-05")).toBe(true);
  });

  it("offers everything while access is unknown, as the links do", () => {
    const { result } = renderHook(() => useCan("MOD-51"), {
      wrapper: wrapper(user({}), false),
    });
    expect(result.current("create")).toBe(true);
  });

  it("offers everything outside the app shell, where nothing has answered", () => {
    const { result } = renderHook(() => useCan("MOD-51"));
    expect(result.current("create")).toBe(true);
  });
});
