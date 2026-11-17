/**
 * Company Mail → Signatures: one layout and one motto.
 *
 * This section was a list of eight templates, each with its own buttons. The
 * tenant asked what they were all for (17 Nov 2026), and two things on that
 * screen were worth keeping: choosing the company's layout, and writing its
 * motto. These pin the shape that replaced the list, and the one thing the
 * dropdown must never do, which is offer the per-department copies as if they
 * were layouts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/screen-harness";
import type { SignatureTemplate } from "@/lib/mail-api";

const list = vi.fn();
const update = vi.fn();
const getMotto = vi.fn();
const saveMotto = vi.fn();

vi.mock("@/lib/mail-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/mail-api")>()),
  listSignatureTemplates: () => list(),
  updateSignatureTemplate: (id: string, patch: unknown) => update(id, patch),
  getSignatureMotto: (id: string) => getMotto(id),
  saveSignatureMotto: (id: string, body: unknown) => saveMotto(id, body),
}));
vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  return apiClientMock();
});

import { TemplatesTab } from "./templates-tab";
import { companyLayouts } from "./layouts";

const tpl = (over: Partial<SignatureTemplate>): SignatureTemplate => ({
  signature_template_id: "t",
  key: "k",
  name: "Template",
  layout: {},
  copy_en: {},
  copy_fr: {},
  scope_kind: "TENANT",
  scope_value: null,
  is_default: false,
  is_system: true,
  is_active: true,
  ...over,
});

/** The eight rows a tenant is seeded with. */
const SEEDED: SignatureTemplate[] = [
  tpl({ signature_template_id: "t-card", key: "signature_card", name: "Signature card", is_default: true, copy_en: { motto: "Moving cargo. Moving Africa." } }),
  tpl({ signature_template_id: "t-classic", key: "smartls_classic", name: "Smart LS Classic" }),
  tpl({ signature_template_id: "t-compact", key: "compact", name: "Compact" }),
  tpl({ signature_template_id: "t-formal", key: "formal_legal", name: "Formal / legal", scope_kind: "DEPARTMENT", scope_value: "Finance", is_default: true }),
  ...["operations", "sales", "hr", "support"].map((d) =>
    tpl({ signature_template_id: `t-${d}`, key: `smartls_classic_${d}`, name: `Classic — ${d}`, scope_kind: "DEPARTMENT", scope_value: d, is_default: true }),
  ),
];

beforeEach(() => {
  vi.clearAllMocks();
  list.mockResolvedValue(SEEDED);
  update.mockResolvedValue({});
  getMotto.mockResolvedValue({ en: "Moving cargo. Moving Africa.", fr: "" });
  saveMotto.mockResolvedValue({});
});

describe("the company's signature is one layout and one motto", () => {
  it("IS ONE DROPDOWN, NOT A LIST OF TEMPLATES", async () => {
    renderScreen(<TemplatesTab />);
    const layout = (await screen.findByLabelText("Layout")) as HTMLSelectElement;
    // The one in force is the one selected.
    expect(layout.value).toBe("t-card");
    // Nothing of the old list: no per-template rows, pills or buttons.
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText(/built in/i)).toBeNull();
    expect(screen.queryByText(/Department default pointing at/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /make default/i })).toBeNull();
    expect(screen.getAllByRole("button", { name: /motto/i })).toHaveLength(1);
  });

  it("OFFERS LAYOUTS, never the per-department copies of one", async () => {
    renderScreen(<TemplatesTab />);
    const layout = await screen.findByLabelText("Layout");
    const offered = within(layout).getAllByRole("option").map((o) => o.textContent);
    // Formal / legal is a different layout, so a company may choose it. The
    // four "Classic — <department>" rows all draw the classic card.
    expect(offered).toEqual(["Signature card", "Smart LS Classic", "Compact", "Formal / legal"]);
    expect(companyLayouts(SEEDED).some((t) => t.key.startsWith("smartls_classic_"))).toBe(false);
  });

  it("shows the company's motto on the screen, with one way to change it", async () => {
    renderScreen(<TemplatesTab />);
    expect(await screen.findByText("Moving cargo. Moving Africa.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit Motto" }));
    // It edits the motto of the layout in force, which is the company's.
    await screen.findByRole("dialog", { name: "Motto" });
    expect(getMotto).toHaveBeenCalledWith("t-card");
  });

  it("ASKS BEFORE CHANGING EVERYONE'S SIGNATURE, then makes it the company default", async () => {
    renderScreen(<TemplatesTab />);
    await userEvent.selectOptions(await screen.findByLabelText("Layout"), "t-compact");
    // Nothing is written until the person has read what it does.
    expect(update).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/Compact/);
    expect(dialog).toHaveTextContent(/Everyone's signature changes/);
    await userEvent.click(within(dialog).getByRole("button", { name: "Use this layout" }));
    expect(update).toHaveBeenCalledWith("t-compact", { is_default: true });
  });

  it("changes nothing when the person backs out", async () => {
    renderScreen(<TemplatesTab />);
    await userEvent.selectOptions(await screen.findByLabelText("Layout"), "t-compact");
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep the current one" }));
    expect(update).not.toHaveBeenCalled();
  });
});
