/**
 * The client portal's settings for every client — the "Client portal" section
 * of ⚙ Settings on the Clients list: what a new invitation starts with, and
 * the onboarding checklist every client starts from.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/screen-harness";

const calls = vi.hoisted(() => [] as { path: string; method?: string; body?: unknown }[]);

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  const base = await apiClientMock();
  return {
    ...base,
    tenant: (path: string, opts?: { method?: string; body?: unknown }) => {
      calls.push({ path, method: opts?.method, body: opts?.body });
      return opts?.method === "POST" ? Promise.resolve({}) : base.tenant(path);
    },
  };
});

import { ClientPortalSettings } from "./client-portal-settings";

const SETTINGS = {
  invite_defaults: { access_scope: "ALL", first_is_admin: true },
  onboarding_steps: [
    { step_key: "COMPANY_PROFILE", label_en: "Company profile completed", label_fr: "Profil d'entreprise complété", sort_order: 10, is_active: true },
    { step_key: "KYC_DOCUMENTS", label_en: "KYC documents received", label_fr: "Documents KYC reçus", sort_order: 20, is_active: true },
    { step_key: "OLD_STEP", label_en: "Fax the mandate", label_fr: "Faxer le mandat", sort_order: 5, is_active: false },
  ],
};
const mount = () => renderScreen(<ClientPortalSettings />, { routes: { "/portal/settings": SETTINGS } });
const writes = () => calls.filter((c) => c.method === "POST");

beforeEach(() => {
  calls.length = 0;
});

describe("new invitations", () => {
  it("saves the default scope and the first-admin rule, only once changed", async () => {
    const user = userEvent.setup();
    mount();
    expect(await screen.findByRole("radio", { name: "Everything" })).toBeChecked();
    const block = screen.getByText("New invitations").closest("section")!;
    const save = within(block).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await user.click(within(block).getByRole("radio", { name: "Billing" }));
    await user.click(within(block).getByRole("checkbox", { name: /first portal user its admin/ }));
    await user.click(save);
    expect(writes()).toEqual([
      { path: "/portal/settings/invite-defaults", method: "POST", body: { access_scope: "BILLING", first_is_admin: false } },
    ]);
  });
});

describe("onboarding steps", () => {
  it("lists the active steps in order, and keeps the switched-off ones folded away", async () => {
    const user = userEvent.setup();
    mount();
    expect(await screen.findByText("Company profile completed")).toBeInTheDocument();
    expect(screen.queryByText("Fax the mandate")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Switched off (1)" }));
    expect(screen.getByText("Fax the mandate")).toBeInTheDocument();
    // The first cannot move up, the last cannot move down.
    expect(screen.getByRole("button", { name: "Move Company profile completed up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move KYC documents received down" })).toBeDisabled();
  });

  it("moves a step through the server, which renumbers the list", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Move KYC documents received up" }));
    expect(writes()).toEqual([
      { path: "/portal/settings/onboarding-steps/KYC_DOCUMENTS/move", method: "POST", body: { direction: "up" } },
    ]);
  });

  it("adds a step in both languages — the French falls back to the English when left empty", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Add a step" }));
    await user.type(screen.getByRole("textbox", { name: /In English/ }), "Customs mandate signed");
    await user.click(screen.getByRole("button", { name: "Add step" }));
    expect(writes()).toEqual([
      { path: "/portal/settings/onboarding-steps", method: "POST", body: { label_en: "Customs mandate signed", label_fr: null } },
    ]);
    expect(await screen.findByText("Step added — every client's checklist now has it.")).toBeInTheDocument();
  });

  it("switches a step back on", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Switched off (1)" }));
    await user.click(screen.getByRole("button", { name: "Switch on" }));
    expect(writes()).toEqual([
      { path: "/portal/settings/onboarding-steps/OLD_STEP", method: "POST", body: { is_active: true } },
    ]);
  });
});

describe("when the plan has no client portal", () => {
  it("says so instead of an error", async () => {
    renderScreen(<ClientPortalSettings />, {
      routes: { "/portal/settings": { __error: { status: 403, message: "off", code: "FEATURE_DISABLED" } } },
    });
    expect(await screen.findByText("The client portal is not switched on")).toBeInTheDocument();
  });
});
