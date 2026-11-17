/**
 * FOUR PEOPLE, ONE REQUEST, AND EACH SEES ONLY THEIR OWN STEP.
 *
 * A cash request is submitted by its requester (`edit`), given its visa by
 * finance (`validate`), approved or rejected by a manager (`approve`), paid by
 * the cashier (`disburse`) and justified by the requester again (`edit`). The
 * three decisions were split into three grants precisely so that they are
 * three people, and the row then showed all of them to everybody (access
 * audit, 17 Nov 2026).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ShellContext } from "@/app/layout/shell-context";
import { EMPTY_SHELL_PREFS } from "@/lib/preferences";
import type { CashRequest } from "@/lib/costing-api";
import { CashRequestActions } from "./cash-request-actions";

function buttons(status: string, actions: string[] | "ceo" | "unknown") {
  const { unmount } = render(
    <ShellContext.Provider
      value={{
        access: {
          modules: ["MOD-49"],
          groups: [],
          byGroup: {},
          isCeo: actions === "ceo",
          version: "v",
          ...(Array.isArray(actions) ? { actions: { "MOD-49": actions } } : {}),
        },
        ready: true,
        resolved: true,
        prefs: EMPTY_SHELL_PREFS,
        setPrefs: () => {},
        grantNotice: null,
        dismissGrantNotice: () => {},
      }}
    >
      <CashRequestActions
        request={{ cash_request_id: "cr-1", status } as unknown as CashRequest}
        busy={false}
        onTransition={() => {}}
        onDisburse={() => {}}
        onJustify={() => {}}
      />
    </ShellContext.Provider>,
  );
  const names = screen.queryAllByRole("button").map((b) => b.textContent?.trim() || "");
  unmount();
  return names;
}

describe("Cash request actions follow the grant each step needs", () => {
  it("the requester (`edit`) submits and justifies, and decides nothing", () => {
    expect(buttons("DRAFT", ["edit"])).toEqual(["Submit"]);
    expect(buttons("DISBURSED", ["edit"])).toEqual(["Justify"]);
    expect(buttons("SUBMITTED", ["edit"])).toEqual([]);
    expect(buttons("VALIDATED", ["edit"])).toEqual([]);
    expect(buttons("APPROVED", ["edit"])).toEqual([]);
  });

  it("FINANCE (`validate`) GIVES THE VISA AND IS NOT SHOWN APPROVE OR DISBURSE", () => {
    expect(buttons("SUBMITTED", ["validate"])).toEqual(["Validate"]);
    expect(buttons("VALIDATED", ["validate"])).toEqual([]);
    expect(buttons("APPROVED", ["validate"])).toEqual([]);
  });

  it("a manager (`approve`) approves and rejects, and does not validate or pay", () => {
    expect(buttons("SUBMITTED", ["approve"])).toEqual(["Reject"]);
    expect(buttons("VALIDATED", ["approve"])).toEqual(["Approve", "Reject"]);
    expect(buttons("APPROVED", ["approve"])).toEqual([]);
  });

  it("the cashier (`disburse`) pays, and decides nothing", () => {
    expect(buttons("APPROVED", ["disburse"])).toEqual(["Disburse"]);
    expect(buttons("PARTIALLY_DISBURSED", ["disburse"])).toEqual(["Pay instalment"]);
    expect(buttons("SUBMITTED", ["disburse"])).toEqual([]);
    expect(buttons("VALIDATED", ["disburse"])).toEqual([]);
  });

  it("a role that can only read is offered nothing at any step", () => {
    for (const st of ["DRAFT", "SUBMITTED", "VALIDATED", "APPROVED", "PARTIALLY_DISBURSED", "DISBURSED"])
      expect(buttons(st, [])).toEqual([]);
  });

  it("the CEO, and an answer with no `actions`, are offered every step", () => {
    for (const who of ["ceo", "unknown"] as const) {
      expect(buttons("DRAFT", who)).toEqual(["Submit"]);
      expect(buttons("SUBMITTED", who)).toEqual(["Validate", "Reject"]);
      expect(buttons("VALIDATED", who)).toEqual(["Approve", "Reject"]);
      expect(buttons("APPROVED", who)).toEqual(["Disburse"]);
      expect(buttons("DISBURSED", who)).toEqual(["Justify"]);
    }
  });
});
