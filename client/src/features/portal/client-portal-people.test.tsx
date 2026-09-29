/**
 * A client's portal, managed from the Client 360's Portal tab: who at the
 * client can sign in, the invitation each is waiting on, and their onboarding
 * checklist. Every write goes to the client-scoped routes (MOD-29), never to
 * the investor/auditor screen's.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/screen-harness";

const calls = vi.hoisted(() => [] as { path: string; method?: string; body?: unknown }[]);
const replies = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  const base = await apiClientMock();
  return {
    ...base,
    tenant: (path: string, opts?: { method?: string; body?: unknown }) => {
      calls.push({ path, method: opts?.method, body: opts?.body });
      const key = `${opts?.method ?? "GET"} ${path}`;
      if (replies.has(key)) return Promise.resolve(replies.get(key));
      return base.tenant(path);
    },
  };
});

import { ClientOnboarding, ClientPortalPeople } from "./client-portal-people";

const PEOPLE = "/portal/clients/c1/people";
const ama = {
  portal_access_id: "g-ama",
  email: "ama@acme.cm",
  client_id: "c1",
  access_scope: "ALL",
  is_client_admin: true,
  invited_by_email: null,
  created_at: "2026-09-01T09:00:00Z",
  expires_at: null,
  full_name: "Ama Owusu",
  last_login_at: "2026-09-20T09:00:00Z",
  sign_in: "ACTIVE",
  invited_at: null,
  invite_expires_at: null,
};
const kofi = {
  ...ama,
  portal_access_id: "g-kofi",
  email: "kofi@acme.cm",
  full_name: null,
  access_scope: "BILLING",
  is_client_admin: false,
  last_login_at: null,
  sign_in: "INVITE_EXPIRED",
};
const DEFAULTS = { access_scope: "OPERATIONS", first_is_admin: true };

const writes = () => calls.filter((c) => c.method === "POST");

beforeEach(() => {
  calls.length = 0;
  replies.clear();
});

describe("who can sign in", () => {
  it("lists each person with what they see, their role and where their invitation stands", async () => {
    renderScreen(<ClientPortalPeople clientId="c1" />, { routes: { [PEOPLE]: { members: [ama, kofi], defaults: DEFAULTS } } });
    expect(await screen.findByText("Ama Owusu")).toBeInTheDocument();
    expect(screen.getByText("ama@acme.cm")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    // The one who has never signed in says why, on the row.
    expect(screen.getByText("Invitation expired")).toBeInTheDocument();
    expect(screen.getByText("2 with access")).toBeInTheDocument();
  });

  it("offers the first invitation when nobody has access", async () => {
    renderScreen(<ClientPortalPeople clientId="c1" />, { routes: { [PEOPLE]: { members: [], defaults: DEFAULTS } } });
    expect(await screen.findByText("Nobody at this client can sign in yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite someone" })).toBeInTheDocument();
  });

  it("says the portal is off rather than showing an error, when the plan does not have it", async () => {
    renderScreen(<ClientPortalPeople clientId="c1" />, {
      routes: { [PEOPLE]: { __error: { status: 403, message: "off", code: "FEATURE_DISABLED" } } },
    });
    expect(await screen.findByText("The client portal is not switched on")).toBeInTheDocument();
  });
});

describe("inviting someone", () => {
  it("starts from the tenant's defaults, fills from a contact in one tap, and sends to the client's own route", async () => {
    const user = userEvent.setup();
    replies.set(`POST ${PEOPLE}`, { ...ama, email: "esi@acme.cm", invite: { sent: true, emailed: true } });
    renderScreen(
      <ClientPortalPeople clientId="c1" contacts={[{ name: "Esi Mensah", email: "esi@acme.cm" }, { name: "Ama Owusu", email: "ama@acme.cm" }]} />,
      { routes: { [PEOPLE]: { members: [], defaults: DEFAULTS } } },
    );
    await user.click(await screen.findByRole("button", { name: "Invite someone" }));
    const dialog = await screen.findByRole("dialog");

    // The tenant's default scope, and admin because this is the client's first person.
    expect(within(dialog).getByRole("radio", { name: "Shipments & documents" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /Portal admin/ })).toBeChecked();

    await user.click(within(dialog).getByRole("button", { name: "Esi Mensah" }));
    expect(within(dialog).getByDisplayValue("esi@acme.cm")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Send invitation" }));

    expect(writes()).toEqual([
      {
        path: PEOPLE,
        method: "POST",
        body: { email: "esi@acme.cm", full_name: "Esi Mensah", access_scope: "OPERATIONS", is_client_admin: true, expires_at: null, send_invite: true },
      },
    ]);
    expect(await screen.findByText("Invitation sent to esi@acme.cm.")).toBeInTheDocument();
  });

  it("does not suggest someone who already has access", async () => {
    const user = userEvent.setup();
    renderScreen(<ClientPortalPeople clientId="c1" contacts={[{ name: "Ama Owusu", email: "AMA@acme.cm" }]} />, {
      routes: { [PEOPLE]: { members: [ama], defaults: DEFAULTS } },
    });
    await user.click(await screen.findByRole("button", { name: "Invite" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("From this client's contacts")).toBeNull();
    // Not the client's first person: admin is not pre-ticked.
    expect(within(dialog).getByRole("checkbox", { name: /Portal admin/ })).not.toBeChecked();
  });

  it("says so when access was given but the email did not go", async () => {
    const user = userEvent.setup();
    replies.set(`POST ${PEOPLE}`, { ...ama, email: "esi@acme.cm", invite: { sent: true, emailed: false } });
    renderScreen(<ClientPortalPeople clientId="c1" />, { routes: { [PEOPLE]: { members: [], defaults: DEFAULTS } } });
    await user.click(await screen.findByRole("button", { name: "Invite someone" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: /Email/ }), "esi@acme.cm");
    await user.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByText(/has access, but the email could not be sent/)).toBeInTheDocument();
  });
});

describe("one person's sheet", () => {
  it("resends an invitation that expired", async () => {
    const user = userEvent.setup();
    replies.set(`POST ${PEOPLE}/g-kofi/invite`, { ...kofi, sign_in: "INVITED", invite: { sent: true, emailed: true } });
    renderScreen(<ClientPortalPeople clientId="c1" />, { routes: { [PEOPLE]: { members: [ama, kofi], defaults: DEFAULTS } } });
    await user.click(await screen.findByRole("button", { name: "Manage kofi@acme.cm" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/expired before they used it/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    expect(writes()).toEqual([{ path: `${PEOPLE}/g-kofi/invite`, method: "POST", body: undefined }]);
    expect(await screen.findByText("Invitation sent to kofi@acme.cm.")).toBeInTheDocument();
  });

  it("changes what they see, and only saves once something changed", async () => {
    const user = userEvent.setup();
    replies.set(`POST ${PEOPLE}/g-ama`, { ...ama, access_scope: "BILLING" });
    renderScreen(<ClientPortalPeople clientId="c1" />, { routes: { [PEOPLE]: { members: [ama], defaults: DEFAULTS } } });
    await user.click(await screen.findByRole("button", { name: "Manage Ama Owusu" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(within(dialog).getByRole("radio", { name: "Billing" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(writes()).toEqual([
      { path: `${PEOPLE}/g-ama`, method: "POST", body: { access_scope: "BILLING", is_client_admin: true, expires_at: null } },
    ]);
  });

  it("removes access only once confirmed", async () => {
    const user = userEvent.setup();
    replies.set(`POST ${PEOPLE}/g-ama/revoke`, { revoked: true, email: "ama@acme.cm" });
    renderScreen(<ClientPortalPeople clientId="c1" />, { routes: { [PEOPLE]: { members: [ama], defaults: DEFAULTS } } });
    await user.click(await screen.findByRole("button", { name: "Manage Ama Owusu" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove access" }));
    // The confirmation opens over the person's sheet: the newest dialog.
    const confirm = (await screen.findAllByRole("dialog")).at(-1)!;
    expect(within(confirm).getByText("Remove Ama Owusu's access?")).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Remove access" }));
    expect(writes()).toEqual([{ path: `${PEOPLE}/g-ama/revoke`, method: "POST", body: undefined }]);
    expect(await screen.findByText("Ama Owusu no longer has access.")).toBeInTheDocument();
  });
});

describe("the onboarding checklist", () => {
  const ONB = "/portal/clients/c1/onboarding";
  const steps = [
    { step_key: "KYC_DOCUMENTS", label_en: "KYC documents received", label_fr: "Documents KYC reçus", done: true, done_at: "2026-09-10T09:00:00Z" },
    { step_key: "FIRST_BOOKING", label_en: "First shipment booked", label_fr: "Première expédition réservée", done: false, done_at: null },
  ];

  it("shows progress and ticks a step through the client's own route", async () => {
    const user = userEvent.setup();
    replies.set(`POST ${ONB}/FIRST_BOOKING`, { ...steps[1], done: true });
    renderScreen(<ClientOnboarding clientId="c1" />, { routes: { [ONB]: { client_id: "c1", progress: 50, steps } } });
    expect(await screen.findByText("1 of 2 done")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Onboarding progress" })).toHaveAttribute("aria-valuenow", "50");

    const step = screen.getByRole("button", { name: /First shipment booked/ });
    expect(step).toHaveAttribute("aria-pressed", "false");
    await user.click(step);
    expect(writes()).toEqual([{ path: `${ONB}/FIRST_BOOKING`, method: "POST", body: undefined }]);
  });

  it("says where the steps come from when there are none", async () => {
    renderScreen(<ClientOnboarding clientId="c1" />, { routes: { [ONB]: { client_id: "c1", progress: 0, steps: [] } } });
    expect(await screen.findByText("No onboarding steps")).toBeInTheDocument();
  });
});
