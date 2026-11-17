/**
 * The right that actually gates a shared mailbox.
 *
 * The Company Mail tab is offered on `can_administer`, which the server
 * answers with MOD-72 `can_update`. Creating a shared mailbox is `can_create`.
 * Those are two rights, and the create affordances were once gated on the
 * wrong one: a role with edit-but-not-create got a button that could only 403.
 * The seeded roles do not currently produce that combination; the permission
 * matrix is data a tenant edits, which is precisely why the button must follow
 * the right that gates the call rather than the one that gates the tab.
 *
 * This file used to hold a second half, about the Connections tab refusing a
 * second personal mailbox and handing what was typed across to this form. The
 * Connections tab is gone (16 Nov 2026) and with it the dead end: the only
 * "connect" a person is offered for themselves now is on My Mailbox, and only
 * while they have none.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/screen-harness";
import { MailboxesTab } from "./mailboxes";
import { CommsSetupPage } from "./index";

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  return apiClientMock();
});

beforeEach(() => vi.clearAllMocks());

const CREATE = /new shared mailbox/i;

/* ── The create affordance follows `create`, not `edit` ──────────────────── */

describe("who is offered the shared-mailbox form", () => {
  const inventory = {
    routes: {
      "/mail/mailboxes": [],
      "/mail/catalogue": [
        {
          catalogue_key: "BILLING",
          label_en: "Billing",
          suggested_local_part: "billing",
          configured: false,
          is_enabled: true,
          feeds: [],
        },
      ],
    },
  };

  it("offers it to somebody who holds create", async () => {
    renderScreen(<MailboxesTab canCreate />, inventory);
    expect((await screen.findAllByText(CREATE)).length).toBeGreaterThan(0);
    // The slot shortcuts are the same offer by another route; asserting they
    // ARE here is what gives the withholding test below its meaning.
    await screen.findByText(/not set up yet/i);
  });

  /* The button is the whole finding: it used to render for anyone who could
   * open the tab, and POST /mail/mailboxes/shared would then 403. */
  it("withholds it from somebody who may edit but not create", async () => {
    renderScreen(<MailboxesTab canCreate={false} />, inventory);
    // Wait for the inventory to settle so this is not merely an early render.
    await screen.findByText(/no mailboxes yet/i);
    expect(screen.queryByText(CREATE)).not.toBeInTheDocument();
  });

  /* The unfilled catalogue slots open the same modal and call the same
   * endpoint, so they are the same right — a second door to the same 403. */
  it("withholds the catalogue slots too", async () => {
    renderScreen(<MailboxesTab canCreate={false} />, inventory);
    await screen.findByText(/no mailboxes yet/i);
    expect(screen.queryByText(/not set up yet/i)).not.toBeInTheDocument();
  });

  /* End to end through the hub: `can_administer` opens the tab, `can_create`
   * decides the button. An administrator without create sees the inventory and
   * is not offered a control that cannot work. */
  it("the hub gates the tab and the button on different rights", async () => {
    renderScreen(<CommsSetupPage />, {
      routes: {
        "/mail/me": { can_view: true, can_create: false, can_edit: true, can_administer: true, is_ceo: false },
        "/mail/mailboxes": [],
        "/mail/catalogue": [],
        "/mail/mailboxes/mine": [],
      },
    });
    await userEvent.click(await screen.findByRole("button", { name: "Company Mail" }));
    await screen.findByText(/no mailboxes yet/i);
    expect(screen.queryByText(CREATE)).not.toBeInTheDocument();
  });
});
