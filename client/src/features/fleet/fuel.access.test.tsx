/**
 * A WRITE BUTTON IS OFFERED ONLY TO A ROLE THAT HOLDS THE GRANT.
 *
 * One real screen, end to end: the fuel log, whose "Log fill" posts to
 * `POST /fuel`, guarded by `requirePermission("MOD-43", "create")`. Opening the
 * screen needs `view`. Until 17 Nov 2026 the button was drawn for both, and the
 * person without `create` found out on Save.
 *
 * The unit tests in `lib/route-access.actions.test.tsx` pin the predicate. This
 * pins that a screen is actually wired to it, with the right module and the
 * right action, because a `can()` that guards nothing passes every unit test.
 */
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { apiClientMock, authContextMock, renderScreen } from "@/test/screen-harness";
import { ShellContext } from "@/app/layout/shell-context";
import { EMPTY_SHELL_PREFS } from "@/lib/preferences";
import type { NavAccess } from "@/lib/nav-access";

// Hoisted above every import below, which is why the screen is imported after.
vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { FuelLogPage } from "./fuel";

function open(access: Partial<NavAccess>, resolved = true) {
  return renderScreen(
    <ShellContext.Provider
      value={{
        access: {
          modules: ["MOD-43"],
          groups: [],
          byGroup: {},
          isCeo: false,
          version: "v",
          ...access,
        },
        ready: true,
        resolved,
        prefs: EMPTY_SHELL_PREFS,
        setPrefs: () => {},
        grantNotice: null,
        dismissGrantNotice: () => {},
      }}
    >
      <FuelLogPage />
    </ShellContext.Provider>,
    { path: "/fleet/fuel" },
  );
}

const heading = () => screen.findByRole("heading", { level: 1 });
const logFill = () => screen.queryByRole("button", { name: "Log fill" });

describe("Fuel log: Log fill follows the create grant", () => {
  it("draws it for a role that may create", async () => {
    open({ actions: { "MOD-43": ["create"] } });
    await heading();
    expect(logFill()).toBeInTheDocument();
  });

  it("DOES NOT DRAW IT for a role that can only read the log", async () => {
    open({ actions: {} });
    await heading();
    expect(logFill()).not.toBeInTheDocument();
  });

  it("is not satisfied by another action on the same module", async () => {
    // `edit` lets someone correct a fill. It does not let them log one, because
    // the route asks for `create` and nothing else.
    open({ actions: { "MOD-43": ["edit"] } });
    await heading();
    expect(logFill()).not.toBeInTheDocument();
  });

  it("is not satisfied by `create` on a different module", async () => {
    open({ actions: { "MOD-41": ["create"] } });
    await heading();
    expect(logFill()).not.toBeInTheDocument();
  });

  it("draws it for the CEO, who holds everything", async () => {
    open({ isCeo: true, actions: {} });
    await heading();
    expect(logFill()).toBeInTheDocument();
  });

  it("draws it when the server did not say: an API that predates `actions`", async () => {
    open({});
    await heading();
    expect(logFill()).toBeInTheDocument();
  });

  it("draws it while access is still unknown", async () => {
    open({ actions: {} }, false);
    await heading();
    expect(logFill()).toBeInTheDocument();
  });
});
