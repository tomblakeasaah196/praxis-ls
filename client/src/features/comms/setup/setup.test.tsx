/**
 * Comms → Setup: two tabs, and who gets the second.
 *
 * The page had ten tabs until the tenant review of 16 Nov 2026 ("at most two
 * tabs for setup"). Two things are pinned here. The first is the count, so an
 * eleventh idea does not arrive as a third tab. The second is the gating that
 * was always the point: a non-administrator sees exactly one section and no
 * tab strip, because a strip with one item is noise and a tab that always
 * 403s teaches people to distrust the ones that work.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import * as React from "react";

const caps = vi.fn();
const mine = vi.fn(async () => []);

vi.mock("@/lib/mail-api", () => ({
  mailCapabilities: () => caps(),
  myMailboxes: () => mine(),
  sendAllowance: async () => null,
  allMailboxes: async () => [],
  listCatalogue: async () => [],
  listSendPoints: async () => [],
  listSenders: async () => [],
  autodiscover: async () => ({}),
  cpanelPreset: async () => ({}),
  connectImap: async () => ({}),
}));
vi.mock("../setup", () => ({ SystemEmailSection: () => <div>system email</div> }));
// Stubbed: this file is about which tabs are OFFERED, not what they render. The
// real page fetches on mount, which would only add act() noise to a gating test.
vi.mock("./my-mailbox", () => ({ MyMailboxTab: () => <h2>My mailbox</h2> }));
vi.mock("./mailboxes", () => ({ MailboxesTab: () => <div>mailbox inventory</div> }));
vi.mock("./send-points", () => ({ SendPointsSection: () => <div>sending addresses</div> }));

import { CommsSetupPage } from "./index";

// useResource is backed by react-query in the app; here it only has to resolve.
vi.mock("@/lib/use-resource", () => ({
  useResource: (fn: () => Promise<unknown>) => {
    const [data, setData] = React.useState<unknown>(null);
    const [loading, setLoading] = React.useState(true);
    React.useEffect(() => {
      let live = true;
      fn().then((d) => { if (live) { setData(d); setLoading(false); } }).catch(() => setLoading(false));
      return () => { live = false; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return { data, loading, error: null, reload: () => {} };
  },
  errMsg: (e: unknown) => String(e),
}));

beforeEach(() => {
  caps.mockReset();
  mine.mockReset().mockResolvedValue([]);
});

/** Every tab the page had before the review. None may come back as a tab. */
const REMOVED = [
  "Connections", "Follow-ups", "Secure Links", "Mailboxes", "Response Times",
  "Trust & Archives", "Send Points", "Senders & Channels", "Test Calls",
];

describe("tab gating", () => {
  test("an ordinary user sees their own mailbox, and no tab strip at all", async () => {
    caps.mockResolvedValue({ can_view: true, can_create: false, can_edit: false, can_administer: false, is_ceo: false });
    render(<CommsSetupPage />);
    await waitFor(() => expect(caps).toHaveBeenCalled());
    await screen.findByText("My mailbox");
    // One section is not a choice, so nothing is drawn to choose with.
    expect(screen.queryByRole("navigation", { name: /email setup sections/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Company Mail")).not.toBeInTheDocument();
  });

  test("AN ADMINISTRATOR GETS EXACTLY TWO TABS", async () => {
    caps.mockResolvedValue({ can_view: true, can_create: true, can_edit: true, can_administer: true, is_ceo: false });
    render(<CommsSetupPage />);
    // An admin-only label is the only thing whose presence proves the
    // capability answer arrived, so it is what the wait is on.
    await screen.findByText("Company Mail");
    const nav = screen.getByRole("navigation", { name: /email setup sections/i });
    const tabs = Array.from(nav.querySelectorAll("button")).map((b) => b.textContent);
    expect(tabs).toEqual(["My Mailbox", "Company Mail"]);
    for (const gone of REMOVED) {
      expect(screen.queryByRole("button", { name: gone })).not.toBeInTheDocument();
    }
  });

  test("Company Mail is ONE page: mailboxes, sending addresses and system email together", async () => {
    caps.mockResolvedValue({ can_view: true, can_create: true, can_edit: true, can_administer: true, is_ceo: false });
    render(<CommsSetupPage />);
    (await screen.findByRole("button", { name: "Company Mail" })).click();
    await screen.findByText("mailbox inventory");
    expect(screen.getByText("sending addresses")).toBeInTheDocument();
    expect(screen.getByText("system email")).toBeInTheDocument();
  });

  test("while capabilities are unknown, nothing admin-only is offered", () => {
    // Over-offering for a frame and then retracting is worse than a tab
    // appearing a moment later.
    caps.mockReturnValue(new Promise(() => {}));
    render(<CommsSetupPage />);
    expect(screen.queryByText("Company Mail")).not.toBeInTheDocument();
  });
});
