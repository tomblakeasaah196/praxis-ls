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

/** Every map the package exports: whatever is a frozen object of strings. */
const MAPS = Object.keys(transitionActions).filter(
  (k) => transitionActions[k] && typeof transitionActions[k] === "object",
);

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
  /** Every routes file that gates a lifecycle by target state. */
  function routeFiles(dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) routeFiles(full, out);
      else if (/\.routes\.js$/.test(name)) {
        const src = fs.readFileSync(full, "utf8");
        if (/requireTransitionPermission\(|requireLifecyclePermissionOnPatch\(/.test(src))
          out.push([path.relative(ROOT, full).split(path.sep).join("/"), src]);
      }
    }
    return out;
  }
  const FILES = routeFiles(path.join(ROOT, "src/modules"));

  it("finds the lifecycle routes it is meant to be reading", () => {
    // A walk that silently found nothing would pass every assertion below.
    expect(FILES.length).toBeGreaterThanOrEqual(20);
  });

  it.each(FILES)("%s", (_file, src) => {
    expect(src).toMatch(/transitionActions\.\w+/);
    // A literal `{ SUBMITTED: "edit", … }` in a routes file is the second list
    // this exists to prevent: the screen would be reading a different one.
    expect(src).not.toMatch(/_ACTION\s*=\s*\{/);
  });

  it("every map a routes file mounts is one the package exports", () => {
    for (const [, src] of FILES)
      for (const m of src.matchAll(/transitionActions\.(\w+)/g)) expect(MAPS).toContain(m[1]);
  });

  it("the screens read the same maps", () => {
    const SCREENS = {
      "client/src/features/hr/payroll.tsx": "payrollStatus",
      "client/src/features/procurement/purchase-orders.tsx": "purchaseOrderTransition",
      "client/src/features/procurement/purchase-requests.tsx": "purchaseRequestTransition",
      "client/src/features/fleet/work-orders.tsx": "workOrderStatus",
      "client/src/features/fleet/incidents.tsx": "incidentStatus",
      "client/src/features/fleet/dispatch.tsx": "dispatchStatus",
      "client/src/features/wms/equipment.tsx": "equipmentStatus",
      "client/src/features/wms/outbound.tsx": "outboundStatus",
      "client/src/features/hr/contracts.tsx": "contractStatus",
      "client/src/features/hr/vacancy.tsx": "vacancyStatus",
      "client/src/features/hr/trainings.tsx": "trainingStatus",
      "client/src/features/operations/operation-files.tsx": "operationsFileTransition",
      "client/src/features/operations/file-360.tsx": "operationsFileTransition",
    };
    for (const [file, map] of Object.entries(SCREENS))
      expect(read(file)).toContain(`transitionActions.${map}`);
  });
});
