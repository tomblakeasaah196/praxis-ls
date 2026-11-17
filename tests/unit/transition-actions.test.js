"use strict";

/**
 * ONE MAP FOR THE ROUTE AND THE SCREEN.
 *
 * A status route asks for a different grant per target state. The screen draws
 * one button per target state. If each kept its own list, the day they drift is
 * the day a clerk is shown Approve again, or an approver loses a button the
 * server would have accepted, and nothing fails.
 *
 * So the maps live in @praxis/shared and this pins the two properties that
 * matter: the routes MOUNT the shared object (not a copy of it), and the
 * fallback for an unlisted state is the strict end on both sides.
 */

const fs = require("fs");
const path = require("path");
const { transitionActions } = require("@praxis/shared");
const rbac = require("../../src/middleware/rbac");

const ROOT = path.resolve(__dirname, "../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const MAPS = ["payrollStatus", "purchaseOrderTransition", "purchaseOrderUnlock", "workOrderStatus"];

describe("transitionActions", () => {
  it("names only actions rbac.js knows", () => {
    for (const name of MAPS)
      for (const action of Object.values(transitionActions[name]))
        expect(Object.keys(rbac.ACTION_COLUMN)).toContain(action);
  });

  it("falls back to `approve`, the strict end, for a state it does not list", () => {
    expect(transitionActions.FALLBACK).toBe("approve");
    for (const name of MAPS)
      expect(transitionActions.actionFor(transitionActions[name], "A_STATE_ADDED_LATER")).toBe("approve");
    expect(transitionActions.actionFor(transitionActions.payrollStatus, undefined)).toBe("approve");
  });

  it("is not fooled by a key every object has", () => {
    // `map["constructor"]` is a function, and a truthy one. A lookup that took
    // it for an action would hand requirePermission something it rejects.
    expect(transitionActions.actionFor(transitionActions.payrollStatus, "constructor")).toBe("approve");
    expect(transitionActions.actionFor(transitionActions.payrollStatus, "toString")).toBe("approve");
  });

  it("cannot be edited by whoever imports it", () => {
    for (const name of MAPS) expect(Object.isFrozen(transitionActions[name])).toBe(true);
  });

  it("keeps the separation of duties each route was written with", () => {
    const a = transitionActions;
    // Payroll: computing and submitting is the clerk's work; deciding is not.
    expect(a.actionFor(a.payrollStatus, "SUBMITTED")).toBe("edit");
    expect(a.actionFor(a.payrollStatus, "APPROVED")).toBe("approve");
    expect(a.actionFor(a.payrollStatus, "DISBURSED")).toBe("approve");
    // Purchase orders: only APPROVED_LOCKED is a decision.
    expect(a.actionFor(a.purchaseOrderTransition, "ISSUED_LOCKED")).toBe("edit");
    expect(a.actionFor(a.purchaseOrderTransition, "APPROVED_LOCKED")).toBe("approve");
    expect(a.actionFor(a.purchaseOrderUnlock, "REQUEST_UNLOCK")).toBe("edit");
    expect(a.actionFor(a.purchaseOrderUnlock, "UNLOCK")).toBe("approve");
    // Work orders: advancing is edit, ending the record is approve.
    expect(a.actionFor(a.workOrderStatus, "IN_PROGRESS")).toBe("edit");
    expect(a.actionFor(a.workOrderStatus, "DONE")).toBe("approve");
  });
});

describe("the routes mount the shared map, not a copy", () => {
  const ROUTES = [
    ["src/modules/hr/payroll/payroll.routes.js", ["transitionActions.payrollStatus"]],
    [
      "src/modules/procurement/purchase_order/purchase_order.routes.js",
      ["transitionActions.purchaseOrderTransition", "transitionActions.purchaseOrderUnlock"],
    ],
    ["src/modules/fleet/work_order/work_order.routes.js", ["transitionActions.workOrderStatus"]],
  ];

  it.each(ROUTES)("%s", (file, refs) => {
    const src = read(file);
    for (const ref of refs) expect(src).toContain(ref);
    // A literal `{ SUBMITTED: "edit", … }` beside the import would be the
    // second list this file exists to prevent.
    expect(src).not.toMatch(/_ACTION\s*=\s*\{/);
  });

  it("the screens read the same maps", () => {
    expect(read("client/src/features/hr/payroll.tsx")).toContain("transitionActions.payrollStatus");
    expect(read("client/src/features/procurement/purchase-orders.tsx")).toContain(
      "transitionActions.purchaseOrderTransition",
    );
    expect(read("client/src/features/fleet/work-orders.tsx")).toContain("transitionActions.workOrderStatus");
  });
});
