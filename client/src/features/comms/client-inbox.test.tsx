/**
 * The Client inbox (Comms › Clients), laid out as Chat is (tenant review, 17
 * Nov 2026): ONE row per client with its latest message and its unread summed,
 * the open conversation beside it with General and each shipment as tabs, and
 * the account manager behind an info button that is closed until asked for.
 * Waiting / Mine / All still filter the list, and the address an alert links to
 * still opens that client on that tab.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/screen-harness";

const calls = vi.hoisted(() => [] as string[]);
const media = vi.hoisted(() => ({ desktop: true }));

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  const base = await apiClientMock();
  return {
    ...base,
    tenant: (path: string) => {
      calls.push(path);
      return base.tenant(path);
    },
  };
});

vi.mock("@/lib/use-media-query", async () => {
  const actual = await vi.importActual<typeof import("@/lib/use-media-query")>("@/lib/use-media-query");
  return { ...actual, useIsDesktop: () => media.desktop };
});
// The conversation's backdrop is the tenant's hero image when their branding has
// one; with no provider in this harness, no branding is the default wash.
vi.mock("@/app/branding/branding-context", () => ({ useBranding: () => ({ branding: null }) }));

import { ClientInboxPage } from "./client-inbox";
import { groupByClient, type InboxItem } from "./client-inbox-rows";

const SHIP = "d1111111-1111-4111-8111-111111111111";
const SHIP2 = "d2222222-2222-4222-8222-222222222222";
const AWA = { user_id: "u-awa", name: "Awa Ndiaye" };

/**
 * In the server's order: the conversations with unread client messages first,
 * then the rest, each by latest message. Acme has three conversations, and the
 * newest message in any of them is the team's own reply on PRX-2, which is NOT
 * one of the two still waiting.
 */
const ITEMS: InboxItem[] = [
  {
    client_id: "c1", client_name: "Acme Trading", thread: SHIP, dossier_id: SHIP, dossier_ref: "PRX-1",
    unread: 2, waiting_since: "2026-09-28T09:58:00Z",
    last: { direction: "CLIENT", preview: "Is it out of port?", kind: "TEXT", at: "2026-09-28T12:00:00Z" },
    manager: AWA, mine: true,
  },
  {
    client_id: "c1", client_name: "Acme Trading", thread: "general", dossier_id: null, dossier_ref: null,
    unread: 1, waiting_since: "2026-09-27T12:00:00Z",
    last: { direction: "CLIENT", preview: "And the invoice?", kind: "TEXT", at: "2026-09-27T12:00:00Z" },
    manager: AWA, mine: true,
  },
  {
    client_id: "c2", client_name: "Bois du Sud", thread: "general", dossier_id: null, dossier_ref: null,
    unread: 1, waiting_since: "2026-09-26T12:00:00Z",
    last: {
      direction: "CLIENT", preview: null, kind: "LOCATION", at: "2026-09-26T12:00:00Z",
      author: { name: "Jean Mballa", email: "jean@boisdusud.cm" },
    },
    manager: null, mine: false,
  },
  {
    client_id: "c1", client_name: "Acme Trading", thread: SHIP2, dossier_id: SHIP2, dossier_ref: "PRX-2",
    unread: 0, waiting_since: null,
    last: { direction: "STAFF", preview: "Delivered this morning", kind: "TEXT", at: "2026-09-29T12:00:00Z" },
    manager: AWA, mine: true,
  },
  {
    client_id: "c3", client_name: "Cargo Nord", thread: "general", dossier_id: null, dossier_ref: null,
    unread: 0, waiting_since: null,
    last: { direction: "STAFF", preview: "Thank you", kind: "TEXT", at: "2026-09-20T12:00:00Z" },
    manager: null, mine: true,
  },
];
// The server counts CONVERSATIONS. The screen lists clients, and counts those.
const INBOX = { filter: "all", counts: { all: 5, waiting: 3, mine: 4 }, items: ITEMS };

const ROUTES = {
  "/portal/chat/inbox": INBOX,
  "/clients/c1/account-manager": { client_id: "c1", manager: { ...AWA, job_title: "Key account manager", email: null, employee_id: "e-awa", reachable: true } },
  "/clients/c2/account-manager": { client_id: "c2", manager: null },
  "/portal/chat/threads": [
    { dossier_id: null, dossier_ref: null, last_at: "2026-09-27T12:00:00Z", unread: 1 },
    { dossier_id: SHIP, dossier_ref: "PRX-1", last_at: "2026-09-28T12:00:00Z", unread: 2 },
    { dossier_id: SHIP2, dossier_ref: "PRX-2", last_at: "2026-09-29T12:00:00Z", unread: 0 },
  ],
  "/portal/chat/messages": {
    thread: SHIP, dossier_ref: "PRX-1", has_more: false,
    messages: [{
      message_id: "m1", direction: "CLIENT", body: "Is it out of port?", created_at: "2026-09-28T12:00:00Z",
      author: { name: null, email: "buyer@acme.cm" }, seen: null, milestone: null, location: null, attachments: [],
    }],
  },
  "/portal/chat/read": {},
};

const inboxReads = () => calls.filter((p) => p.startsWith("/portal/chat/inbox"));
/** The rows of the list: each is the one button that carries its client's name. */
const row = (name: RegExp) => screen.getByRole("button", { name });
const mount = (path?: string, routes: Record<string, unknown> = ROUTES) => renderScreen(<ClientInboxPage />, { routes, path });

beforeEach(() => {
  calls.length = 0;
  media.desktop = true;
});

describe("one row per client", () => {
  it("folds a client's conversations into one row: the latest message anywhere, the unread summed", () => {
    const rows = groupByClient(ITEMS);
    expect(rows.map((r) => r.client_name)).toEqual(["Acme Trading", "Bois du Sud", "Cargo Nord"]);
    const acme = rows[0];
    expect(acme.unread).toBe(3);
    expect(acme.last.preview).toBe("Delivered this morning");
    // A press lands on the conversation that is waiting, not on the reply.
    expect(acme.opens).toBe(SHIP);
    expect(rows[2]).toMatchObject({ unread: 0, mine: true, opens: "general" });
  });

  it("draws that row once, with who wrote the last message, when, and the unread", async () => {
    mount();
    await screen.findByRole("button", { name: /Acme Trading/ });
    // Three conversations, one row.
    expect(screen.getAllByRole("button", { name: /Acme Trading/ })).toHaveLength(1);
    expect(row(/Acme Trading/)).toHaveTextContent("Team: Delivered this morning");
    expect(row(/Acme Trading/)).toHaveTextContent("29 Sep");
    expect(within(row(/Acme Trading/)).getByText("3")).toBeInTheDocument();
    // A named colleague at the client is named, and a message with no words
    // says what was sent.
    expect(row(/Bois du Sud/)).toHaveTextContent("Jean Mballa: Location");
    expect(within(row(/Bois du Sud/)).getByText("1")).toBeInTheDocument();
  });
});

describe("Waiting, Mine and All", () => {
  it("opens on Waiting, and each filter counts the clients it lists", async () => {
    mount();
    await screen.findByRole("button", { name: /Acme Trading/ });
    expect(screen.getByRole("radio", { name: /Waiting/ })).toBeChecked();
    // Cargo Nord has nothing unread, so it is not waiting.
    expect(screen.queryByRole("button", { name: /Cargo Nord/ })).toBeNull();
    // Clients, not the server's count of conversations (3 / 4 / 5).
    expect(screen.getByRole("radio", { name: /Waiting/ })).toHaveTextContent("2");
    expect(screen.getByRole("radio", { name: /Mine/ })).toHaveTextContent("2");
    expect(screen.getByRole("radio", { name: /All/ })).toHaveTextContent("3");
  });

  it("filters the rows it already has: one read serves all three", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("button", { name: /Acme Trading/ });
    await user.click(screen.getByRole("radio", { name: /Mine/ }));
    expect(screen.getByRole("button", { name: /Cargo Nord/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Bois du Sud/ })).toBeNull();
    // The same row under every filter: still the latest message anywhere.
    expect(row(/Acme Trading/)).toHaveTextContent("Team: Delivered this morning");
    await user.click(screen.getByRole("radio", { name: /All/ }));
    expect(screen.getByRole("button", { name: /Bois du Sud/ })).toBeInTheDocument();
    expect(inboxReads()).toEqual(["/portal/chat/inbox?filter=all"]);
  });

  it("says so when nothing is waiting", async () => {
    mount(undefined, { ...ROUTES, "/portal/chat/inbox": { filter: "all", counts: { all: 0, waiting: 0, mine: 0 }, items: [] } });
    expect(await screen.findByText("Nothing waiting: every client has an answer")).toBeInTheDocument();
    expect(screen.getByText("Pick a conversation to start.")).toBeInTheDocument();
  });

  it("says when the list stops short of everything", async () => {
    mount(undefined, { ...ROUTES, "/portal/chat/inbox": { ...INBOX, truncated: true } });
    expect(await screen.findByText(/Showing the most recent conversations/)).toBeInTheDocument();
  });
});

describe("the open conversation", () => {
  it("opens beside the list on the conversation that is waiting, and reads it", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: /Acme Trading/ }));

    expect(await screen.findByRole("heading", { name: "Acme Trading" })).toBeInTheDocument();
    // The row is marked as the open one.
    expect(row(/Acme Trading.*Delivered/)).toHaveAttribute("aria-current", "true");
    // The client's own message is on screen, and reading it is their "seen" tick.
    expect(await screen.findByText("Is it out of port?")).toBeInTheDocument();
    expect(calls).toContain(`/portal/chat/messages?client_id=c1&thread=${SHIP}`);
    await waitFor(() => expect(calls).toContain("/portal/chat/read"));
    // Chat's message box, not a form under a card.
    expect(screen.getByRole("textbox", { name: "Reply to the client…" })).toBeInTheDocument();
  });

  it("has General and each shipment as tabs, with what is unread in each", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: /Acme Trading/ }));

    const tabs = await screen.findByRole("tablist", { name: "Conversation" });
    await waitFor(() => expect(within(tabs).getAllByRole("tab")).toHaveLength(3));
    expect(within(tabs).getByRole("tab", { name: /PRX-1/ })).toHaveAttribute("aria-selected", "true");
    expect(within(tabs).getByRole("tab", { name: /PRX-1/ })).toHaveTextContent("2");
    expect(within(tabs).getByRole("tab", { name: /General/ })).toHaveTextContent("1");
    expect(within(tabs).getByRole("tab", { name: /PRX-2/ })).toHaveAttribute("aria-selected", "false");

    await user.click(within(tabs).getByRole("tab", { name: /General/ }));
    await waitFor(() => expect(calls).toContain("/portal/chat/messages?client_id=c1&thread=general"));
    expect(within(tabs).getByRole("tab", { name: /General/ })).toHaveAttribute("aria-selected", "true");
  });

  it("is reachable along the tabs from the keyboard", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: /Acme Trading/ }));
    const tabs = await screen.findByRole("tablist", { name: "Conversation" });
    await waitFor(() => expect(within(tabs).getAllByRole("tab")).toHaveLength(3));

    within(tabs).getByRole("tab", { name: /PRX-1/ }).focus();
    await user.keyboard("{ArrowRight}");
    expect(within(tabs).getByRole("tab", { name: /PRX-2/ })).toHaveFocus();
    // Arrowing along does not open (and so does not mark read) each one passed.
    expect(calls).not.toContain(`/portal/chat/messages?client_id=c1&thread=${SHIP2}`);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(calls).toContain(`/portal/chat/messages?client_id=c1&thread=${SHIP2}`));
  });

  it("closes from the header's Back, which is how a phone returns to the list", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: /Acme Trading/ }));
    await screen.findByRole("heading", { name: "Acme Trading" });
    await user.click(screen.getByRole("button", { name: "Back to clients" }));
    expect(screen.queryByRole("heading", { name: "Acme Trading" })).toBeNull();
    expect(screen.getByText("Pick a conversation to start.")).toBeInTheDocument();
  });
});

describe("the info panel", () => {
  it("is closed until asked for, then holds the account manager beside the messages", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: /Acme Trading/ }));

    const info = await screen.findByRole("button", { name: "Conversation Info" });
    expect(info).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("complementary", { name: "Conversation Info" })).toBeNull();
    expect(screen.queryByText("Account Manager")).toBeNull();
    // Closed means not read either: nothing is fetched for a panel nobody opened.
    expect(calls.some((p) => p.startsWith("/clients/c1/account-manager"))).toBe(false);

    await user.click(info);
    expect(info).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("complementary", { name: "Conversation Info" });
    expect(await within(panel).findByText("Account Manager")).toBeInTheDocument();
    expect(await within(panel).findByText("Key account manager")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Change" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Remove" })).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Hide" }));
    expect(screen.queryByRole("complementary", { name: "Conversation Info" })).toBeNull();
    expect(info).toHaveAttribute("aria-expanded", "false");
  });

  it("stays as it was left when another client is opened", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: /Acme Trading/ }));
    await user.click(await screen.findByRole("button", { name: "Conversation Info" }));
    await user.click(screen.getByRole("button", { name: /Bois du Sud/ }));

    expect(await screen.findByRole("heading", { name: "Bois du Sud" })).toBeInTheDocument();
    const panel = screen.getByRole("complementary", { name: "Conversation Info" });
    expect(await within(panel).findByText("Nobody yet")).toBeInTheDocument();
  });

  it("opens as a sheet over the conversation on a phone", async () => {
    media.desktop = false;
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: /Acme Trading/ }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(await screen.findByRole("button", { name: "Conversation Info" }));
    const sheet = await screen.findByRole("dialog", { name: "Conversation Info" });
    expect(await within(sheet).findByText("Account Manager")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Conversation Info" })).toBeNull();
  });
});

describe("the address an alert links to", () => {
  it("opens that client on that tab, with every client listed", async () => {
    mount("/comms/clients?client=c1&thread=general");
    expect(await screen.findByRole("heading", { name: "Acme Trading" })).toBeInTheDocument();
    expect(calls).toContain("/portal/chat/messages?client_id=c1&thread=general");
    const tabs = screen.getByRole("tablist", { name: "Conversation" });
    await waitFor(() => expect(within(tabs).getAllByRole("tab")).toHaveLength(3));
    expect(within(tabs).getByRole("tab", { name: /General/ })).toHaveAttribute("aria-selected", "true");
    // A link to one conversation shows All, so its row is in the list whatever
    // is or is not waiting.
    expect(screen.getByRole("radio", { name: /All/ })).toBeChecked();
    expect(row(/Acme Trading.*Delivered/)).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: /Cargo Nord/ })).toBeInTheDocument();
  });

  it("opens a shipment's tab when the link names the shipment", async () => {
    mount(`/comms/clients?client=c1&thread=${SHIP2}`);
    expect(await screen.findByRole("heading", { name: "Acme Trading" })).toBeInTheDocument();
    expect(calls).toContain(`/portal/chat/messages?client_id=c1&thread=${SHIP2}`);
    const tabs = screen.getByRole("tablist", { name: "Conversation" });
    await waitFor(() => expect(within(tabs).getByRole("tab", { name: /PRX-2/ })).toHaveAttribute("aria-selected", "true"));
  });

  it("opens General when the link names only the client", async () => {
    mount("/comms/clients?client=c2");
    expect(await screen.findByRole("heading", { name: "Bois du Sud" })).toBeInTheDocument();
    expect(calls).toContain("/portal/chat/messages?client_id=c2&thread=general");
  });

  it("leaves the filter alone when a row is pressed under Waiting", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: /Bois du Sud/ }));
    await screen.findByRole("heading", { name: "Bois du Sud" });
    expect(screen.getByRole("radio", { name: /Waiting/ })).toBeChecked();
  });
});
