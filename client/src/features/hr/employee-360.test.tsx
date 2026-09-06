/**
 * EDIT EMPLOYEE — the caret stays in the field you are typing in.
 *
 * WHAT THIS PINS, AND WHY IT IS WORTH A FILE
 *
 * The form was unusable and the cause was one line of nesting. `Section` — the
 * bordered fieldset that wraps all five groups of the form — was declared
 * INSIDE EditEmployeeForm's render body. A component declared there is a new
 * function object on every render, React reconciles by element type, and a
 * changed type is an unmount-and-remount rather than an update. So every
 * keystroke tore down the whole fieldset, destroyed the live <input> the caret
 * was in, and built a fresh one: you typed one character and focus was gone.
 *
 * Nothing else in the tree could have caught it. It is not a lint error (the
 * client has no eslint-plugin-react), it is not a type error, and it is not
 * visible in a render-once test — a screen that mounts, asserts its fields are
 * present and never types is green on a form nobody can fill in. It takes a
 * SECOND keystroke to see, because the first one still lands.
 *
 * Hence the assertions below: the DOM node survives typing (that is the defect,
 * stated exactly), and a whole word arrives (that is what the user reported).
 * Both fail on the old code; the second is the one whose failure message reads
 * like the bug report.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import * as api from "@/lib/hr-api";
import { EditEmployeeForm } from "./employee-360";

/** The minimum a saved record needs — `draftFrom` defaults every other column. */
const EMPLOYEE = {
  employee_id: "emp-1",
  full_name: "Elisha Godwin",
  status: "ACTIVE",
} as api.Employee;

function openForm() {
  return renderScreen(
    <EditEmployeeForm
      employee={EMPLOYEE}
      onClose={() => {}}
      onSaved={() => {}}
    />,
    { routes: { "/entities": [], "/employees": [] } },
  );
}

describe("Edit employee — typing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the caret in the field after a keystroke", async () => {
    const user = userEvent.setup();
    openForm();

    const input = await screen.findByRole("textbox", { name: /Full name/ });
    await user.click(input);
    expect(document.activeElement).toBe(input);

    await user.keyboard("s");

    // The defect, stated as precisely as it can be: with `Section` nested this
    // is a DIFFERENT element, and the one the caret was in has been thrown
    // away. Note it is ANY re-render that does it, not only a keystroke — with
    // the bug in place even the mount-time `/entities` response was enough, and
    // Radix's focus trap then parked the caret on the dialog's close button.
    // With Section at module scope no re-render can move it at all, which is
    // why every assertion here is deterministic rather than a race.
    expect(document.body.contains(input)).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it("accepts a whole word, not just its first letter", async () => {
    const user = userEvent.setup();
    openForm();

    const input = await screen.findByRole("textbox", { name: /Full name/ });
    await user.clear(input);
    await user.type(input, "Elisha Godwin");

    // On the old code this stopped at "E": every character after the first was
    // typed into <body>, because the input it was aimed at no longer existed.
    expect(screen.getByRole("textbox", { name: /Full name/ })).toHaveValue(
      "Elisha Godwin",
    );
  });

  it("holds focus in a field in a different section", async () => {
    const user = userEvent.setup();
    openForm();

    // "Place of birth" lives in Identity, "Place of work" in The engagement —
    // a second section, so this pins the remount rather than one lucky field.
    const input = await screen.findByRole("textbox", { name: /Place of work/ });
    await user.click(input);
    await user.type(input, "Douala");

    expect(document.activeElement).toBe(input);
    expect(input).toHaveValue("Douala");
  });
});
