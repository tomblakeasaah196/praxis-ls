/**
 * NewMessageDialog — the ONLY compose wrapper in the product (PR #268) —
 * integration-checked against the mailbox decisions it owns.
 *
 * The wrapper answers "from where": it fetches the mailboxes the caller can
 * work (their own and the shared ones they were given), refuses to compose with
 * none it can send from, hides the chooser when there is only one mailbox, and
 * preselects the default when there are several. The
 * Master Composer it hands the decision to is stubbed here — its own suite
 * lives in composer.test.tsx, and TipTap does not mount in jsdom anyway.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderScreen } from "@/test/screen-harness";
import type { Mailbox } from "@/lib/mail-api";

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  return apiClientMock();
});

/* The wrapper lazy-loads the composer; the test replaces it with a probe that
   records the decision the wrapper made (which connection, which mode). */
vi.mock("@/features/comms/inbox/composer/index", () => ({
  Composer: (props: {
    connectionId: string;
    kind?: string;
    initialTo?: string[];
    entityRef?: string | null;
  }) => (
    <div
      data-testid="composer"
      data-connection-id={props.connectionId}
      data-kind={props.kind ?? ""}
      data-to={(props.initialTo ?? []).join(",")}
      data-entity={props.entityRef ?? ""}
    />
  ),
}));

import { NewMessageDialog } from "./new-message";

const conn = (id: string, address: string, over: Partial<Mailbox> = {}): Mailbox => ({
  email_connection_id: id,
  email_address: address,
  provider: "imap_smtp",
  kind: "PERSONAL",
  status: "CONNECTED",
  is_default: false,
  access_role: "OWNER",
  health: { level: "ok", reason: "" },
  ...over,
} as Mailbox);

/** `myMailboxes`: the caller's own mailbox and every shared one they hold a grant on. */
const MINE = "/mail/mailboxes/mine";

describe("NewMessageDialog", () => {
  it("WITH NO MAILBOX CONNECTED it says so, and names the screen that fixes it", async () => {
    renderScreen(<NewMessageDialog open onClose={() => {}} />, {
      routes: { [MINE]: [] },
    });
    expect(await screen.findByText("No mailbox connected")).toBeInTheDocument();
    expect(screen.getByText(/Connect your mailbox under Comms → Setup/)).toBeInTheDocument();
    expect(screen.queryByTestId("composer")).not.toBeInTheDocument();
  });

  it("WITH ONE CONNECTION it composes straight away — no chooser to stare at", async () => {
    renderScreen(<NewMessageDialog open onClose={() => {}} />, {
      routes: { [MINE]: [conn("c1", "ops@company.cm")] },
    });
    const composer = await screen.findByTestId("composer");
    expect(composer).toHaveAttribute("data-connection-id", "c1");
    expect(composer).toHaveAttribute("data-kind", "NEW");
    expect(screen.queryByLabelText("From Mailbox")).not.toBeInTheDocument();
  });

  it("WITH TWO CONNECTIONS it shows the chooser and picks the default first", async () => {
    renderScreen(<NewMessageDialog open onClose={() => {}} />, {
      routes: {
        [MINE]: [
          conn("c1", "ops@company.cm"),
          conn("c2", "ada@company.cm", { is_default: true }),
        ],
      },
    });
    const chooser = await screen.findByLabelText("From Mailbox");
    const options = within(chooser as HTMLElement).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "ops@company.cm",
      "ada@company.cm (default)",
    ]);
    expect((chooser as HTMLSelectElement).value).toBe("c2");
    // …and the composer opens on that default, not on an undecided state.
    const composer = await screen.findByTestId("composer");
    expect(composer).toHaveAttribute("data-connection-id", "c2");
  });

  it("PREFERS THE MAILBOX THE CALLER IS ALREADY IN, over the tenant default", async () => {
    // Reading admin@ and pressing Compose means writing from admin@. Taking the
    // mailbox on the screen behind this dialog to be a fact about reading only
    // is what made "it always sends from the default" true.
    renderScreen(
      <NewMessageDialog open onClose={() => {}} connectionId="c1" />,
      {
        routes: {
          [MINE]: [
            conn("c1", "ops@company.cm"),
            conn("c2", "ada@company.cm", { is_default: true }),
          ],
        },
      },
    );
    const composer = await screen.findByTestId("composer");
    expect(composer).toHaveAttribute("data-connection-id", "c1");
    expect((await screen.findByLabelText("From Mailbox") as HTMLSelectElement).value).toBe("c1");
  });

  it("a preference that is not connected falls back rather than seeding a dead mailbox", async () => {
    // The mailbox was disconnected while the screen was open. Seeding it would
    // put a value in the picker that is not one of its options, and open a
    // composer that cannot send.
    renderScreen(
      <NewMessageDialog open onClose={() => {}} connectionId="c-gone" />,
      {
        routes: {
          [MINE]: [
            conn("c1", "ops@company.cm"),
            conn("c2", "ada@company.cm", { is_default: true }),
          ],
        },
      },
    );
    expect(await screen.findByTestId("composer")).toHaveAttribute("data-connection-id", "c2");
  });

  it("a reopened draft keeps its own mailbox, whatever the caller is reading", async () => {
    renderScreen(
      <NewMessageDialog
        open
        onClose={() => {}}
        connectionId="c1"
        draft={{ email_draft_id: "d1", email_connection_id: "c2", kind: "NEW" } as never}
      />,
      {
        routes: {
          [MINE]: [
            conn("c1", "ops@company.cm"),
            conn("c2", "ada@company.cm"),
          ],
        },
      },
    );
    expect(await screen.findByTestId("composer")).toHaveAttribute("data-connection-id", "c2");
  });

  it("A SHARED MAILBOX the caller can send from is offered; a read-only one is not", async () => {
    renderScreen(<NewMessageDialog open onClose={() => {}} />, {
      routes: {
        [MINE]: [
          conn("c1", "ada@company.cm", { is_default: true }),
          conn("c2", "billing@company.cm", { kind: "SHARED", access_role: "AGENT" }),
          conn("c3", "board@company.cm", { kind: "SHARED", access_role: "VIEWER" }),
        ],
      },
    });
    const picker = await screen.findByLabelText("From Mailbox");
    const options = within(picker).getAllByRole("option").map((o) => o.textContent);
    expect(options.some((t) => t?.startsWith("billing@company.cm"))).toBe(true);
    expect(options.some((t) => t?.startsWith("board@company.cm"))).toBe(false);
  });

  it("A MAILBOX WHOSE SYNC FAILED still sends, and says why it did not sync", async () => {
    renderScreen(<NewMessageDialog open onClose={() => {}} />, {
      routes: {
        [MINE]: [conn("c1", "ada@company.cm", {
          status: "ERROR", last_error: "AADSTS70008: expired", last_failure_at: "2026-10-15T17:34:00Z",
        })],
      },
    });
    expect(await screen.findByTestId("composer")).toHaveAttribute("data-connection-id", "c1");
    expect(screen.getByText(/This mailbox did not sync at .*: AADSTS70008: expired/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry Sync" })).toBeInTheDocument();
    expect(screen.queryByText("No mailbox connected")).not.toBeInTheDocument();
  });

  it("hands prefill through to the composer untouched", async () => {
    renderScreen(
      <NewMessageDialog
        open
        onClose={() => {}}
        to={["client@maersk.cm"]}
        entityRef="transit_order:to-1"
      />,
      { routes: { [MINE]: [conn("c1", "ops@company.cm")] } },
    );
    const composer = await screen.findByTestId("composer");
    expect(composer).toHaveAttribute("data-to", "client@maersk.cm");
    expect(composer).toHaveAttribute("data-entity", "transit_order:to-1");
  });
});
