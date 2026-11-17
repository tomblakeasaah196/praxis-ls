import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { TeamChatPage } from "./team-chat";

const fixture = vi.hoisted(() => ({
  channel: { group_id: "one", name: "Operations", kind: "DIRECT", unread: 0 } as Record<string, unknown>,
  /** What `GET /channels/:id` answers. `undefined` = the same record as the list. */
  detail: undefined as unknown,
  colleagues: [] as { user_id: string; full_name: string; email: string }[],
  created: [] as unknown[],
  messages: [{ message_id: "m1", body: "Hello" }],
  /**
   * The preview map the server attaches to a thread response. `undefined` is a
   * state of its own: it is what an older server (or a switched-off feature)
   * sends, and the bubbles must then render plain links rather than cards.
   */
  // Typed because the fixture is shared with the mock above and `undefined` alone
  // would make every assignment below a type error.
  links: undefined as undefined | Record<string, { state: string; title?: string }>,
  /** PR-6 (F10): what the calls UI may offer this person. */
  caps: { calls: true, can_dial: true, recording: false, settings_admin: false },
}));
vi.mock("@/app/auth/auth-context", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("@/lib/comms-socket", () => ({
  useCommsChannel: () => ({ setTyping: vi.fn() }),
  getCommsSocket: () => ({ connected: false, on: vi.fn(), off: vi.fn(), emit: vi.fn() }),
}));
vi.mock("@/lib/smartcomm-api", () => ({
  listChannels: () => [fixture.channel], listColleagues: () => fixture.colleagues,
  createChannel: async (body: unknown) => { fixture.created.push(body); return { group_id: "new" }; },
  getChannel: () => (fixture.detail === undefined ? fixture.channel : fixture.detail), getThread: () => ({ messages: fixture.messages, links: fixture.links }),
  markRead: () => Promise.resolve(),
  fetchCallCapabilities: async () => fixture.caps,
  fetchCallProcessing: async () => ({ recording_enabled: false, transcription: [], summary: [], network: [] }),
}));
vi.mock("@/lib/use-resource", () => ({
  useResource: (load: () => unknown) => ({ data: load(), loading: false, reload: vi.fn() }),
  errMsg: String,
}));
vi.mock("./chat/composer", () => ({ Composer: () => <div>Message composer</div> }));
vi.mock("./chat/forward-dialog", () => ({ ForwardDialog: () => null }));
// The thread reads the tenant's hero image for its backdrop; with no provider in
// this harness, a null branding falls back to the default static wash.
vi.mock("@/app/branding/branding-context", () => ({ useBranding: () => ({ branding: null }) }));
// No ToastProvider in this isolated render, so stub the hook.
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ success: () => {}, error: () => {}, info: () => {} }),
}));
/**
 * The bubble as a contract, not a rendering.
 *
 * It keeps the shape the tests above lean on — the message body is the bubble's
 * only text, so `getByText("Hello").parentElement` is still the scroll pane — and
 * adds the two things the page is responsible for: which row is open, and the
 * preview map handed down. `onPointerDown` is wired to the toggle so the parent's
 * ownership is exercised through the same event the real gesture uses, with the
 * bubble still bubbling it up to the scroller.
 */
vi.mock("./chat/message-bubble", () => ({
  MessageBubble: ({ message, revealed, onToggleReveal, links }: any) => (
    <div
      data-message-bubble
      data-revealed={revealed ? "true" : undefined}
      data-links={links ? Object.keys(links).join(",") : ""}
      onPointerDown={onToggleReveal}
    >
      {message.body}
    </div>
  ),
}));
const chat = () => <MemoryRouter initialEntries={["/comms?channel=one"]}><TeamChatPage /></MemoryRouter>;

beforeEach(async () => {
  (await import("./call/call-capabilities")).resetCallCapabilities();
  fixture.caps = { calls: true, can_dial: true, recording: false, settings_admin: false };
  localStorage.clear();
  fixture.channel = { group_id: "one", name: "Operations", kind: "DIRECT", unread: 0 };
  fixture.colleagues = [];
  fixture.detail = undefined;
  fixture.created = [];
  fixture.messages = [{ message_id: "m1", body: "Hello" }];
  fixture.links = undefined;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});

describe("the phone icon is offered only where it works (audit F10)", () => {
  it("shows when calls are on and this person may dial", async () => {
    render(chat());
    expect(await screen.findByRole("button", { name: "Start a voice call" })).toBeInTheDocument();
  });

  it("is absent when calls are off for the tenant or the person may not dial", async () => {
    fixture.caps = { calls: false, can_dial: false, recording: false, settings_admin: false };
    render(chat());
    await waitFor(() => expect(screen.getByText("Message composer")).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("button", { name: "Start a voice call" })).not.toBeInTheDocument();
  });
});

/**
 * THE PAGE IS TWO PANES (tenant clean-up, 17 Nov 2026).
 *
 * A third pane used to sit on the right, open by default, repeating the name,
 * the partner's status and the call button, and reachable from a ⋮ menu that
 * also repeated the call button. The list carried four filter pills and a
 * per-device appearance control, and New asked the same question twice. These
 * pin what replaced all of that, and that none of it has come back.
 */
describe("the chat page is a list and a conversation", () => {
  it("HAS NO INFO PANEL AND NO CONVERSATION MENU", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    render(chat());
    await screen.findByText("Message composer");
    expect(document.getElementById("chat-info-panel")).toBeNull();
    expect(screen.queryByText("Conversation info")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Conversation menu" })).not.toBeInTheDocument();
    // Nothing is remembered about a panel that no longer exists.
    expect(localStorage.getItem("comms:info-open")).toBeNull();
  });

  it("OFFERS ONE CALL BUTTON, not three", async () => {
    render(chat());
    expect(await screen.findAllByRole("button", { name: "Start a voice call" })).toHaveLength(1);
    expect(screen.queryByText("Start a voice call")).not.toBeInTheDocument();
  });

  it("THE HEADER DOES NOT WAIT ON A SECOND REQUEST to say who this is or to offer the call", async () => {
    // The list already holds the conversation. While `getChannel` is in
    // flight, or when it comes back with nothing, the header used to read
    // "Conversation" with no call button; the removed info panel had been
    // covering for it with a button of its own.
    fixture.detail = null;
    render(chat());
    await screen.findByText("Message composer");
    expect(screen.getAllByText("Operations").length).toBeGreaterThan(1); // the row AND the header
    expect(screen.queryByText("Conversation")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Start a voice call" })).toBeInTheDocument();
  });

  it("a group says how many people are in it, in the header", async () => {
    // The one fact the info panel held that the header did not.
    fixture.channel = { group_id: "one", name: "Ops Task Force", kind: "DEPARTMENT", unread: 0, member_count: 7 };
    render(chat());
    expect(await screen.findByText("7 members")).toBeInTheDocument();
  });

  it("A DIRECT CONVERSATION IS NAMED AFTER THE OTHER PERSON, in the list and in the header", async () => {
    // The stored name is what the person who STARTED the conversation saw. The
    // one who was messaged read their own name on it, with the other person's
    // name on every bubble underneath.
    fixture.channel = {
      group_id: "one", name: "JBS Praxis", kind: "DIRECT", unread: 0,
      partner_user_id: "them", partner_name: "Joel Efala",
    };
    render(chat());
    await screen.findByText("Message composer");
    expect(screen.getAllByText("Joel Efala").length).toBeGreaterThan(1); // the row AND the header
    expect(screen.queryByText("JBS Praxis")).not.toBeInTheDocument();
  });

  it("a group, and a direct conversation the server did not name the partner of, keep their stored name", async () => {
    fixture.channel = { group_id: "one", name: "Ops Task Force", kind: "DEPARTMENT", unread: 0, partner_name: "Nobody" };
    const { unmount } = render(chat());
    expect((await screen.findAllByText("Ops Task Force")).length).toBeGreaterThan(1);
    unmount();
    fixture.channel = { group_id: "one", name: "Joel Efala", kind: "DIRECT", unread: 0 };
    render(chat());
    expect((await screen.findAllByText("Joel Efala")).length).toBeGreaterThan(1);
  });

  it("THE LIST IS SEARCH AND NEW: no filter pills, no appearance control", async () => {
    render(chat());
    await screen.findByText("Message composer");
    expect(screen.getByPlaceholderText("Search conversations…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New conversation" })).toBeInTheDocument();
    for (const gone of ["All", "Unread", "In-house", "Groups"]) {
      expect(screen.queryByRole("button", { name: gone })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /appearance/i })).not.toBeInTheDocument();
  });
});

describe("New is one dialog: pick people", () => {
  const people = () => {
    fixture.colleagues = [
      { user_id: "u1", full_name: "Awa Ndiaye", email: "awa@smartls.test" },
      { user_id: "u2", full_name: "Paul Mbarga", email: "paul@smartls.test" },
    ];
  };

  it("ASKS NOTHING FIRST: no in-house / group / email chooser, no type select", async () => {
    people();
    const user = userEvent.setup();
    render(chat());
    await user.click(screen.getByRole("button", { name: "New conversation" }));
    const dialog = await screen.findByRole("dialog", { name: "New Conversation" });
    expect(within(dialog).getByRole("checkbox", { name: /Awa Ndiaye/ })).toBeInTheDocument();
    expect(within(dialog).queryByText("Email")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("In-house message")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("one person is a direct message and needs no name", async () => {
    people();
    const user = userEvent.setup();
    render(chat());
    await user.click(screen.getByRole("button", { name: "New conversation" }));
    const dialog = await screen.findByRole("dialog", { name: "New Conversation" });
    await user.click(within(dialog).getByRole("checkbox", { name: /Awa Ndiaye/ }));
    expect(within(dialog).queryByLabelText(/Group Name/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Start chat" }));
    await waitFor(() => expect(fixture.created).toHaveLength(1));
    expect(fixture.created[0]).toEqual({ name: "Awa Ndiaye", kind: "DIRECT", member_ids: ["u1"] });
  });

  it("SEVERAL PEOPLE IS A GROUP, and a group must be named", async () => {
    people();
    const user = userEvent.setup();
    render(chat());
    await user.click(screen.getByRole("button", { name: "New conversation" }));
    const dialog = await screen.findByRole("dialog", { name: "New Conversation" });
    await user.click(within(dialog).getByRole("checkbox", { name: /Awa Ndiaye/ }));
    await user.click(within(dialog).getByRole("checkbox", { name: /Paul Mbarga/ }));
    // The name field arrives with the second tick, and nothing is sent without it.
    const start = within(dialog).getByRole("button", { name: "Start group" });
    expect(start).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Group Name/), "Douala corridor");
    await user.click(start);
    await waitFor(() => expect(fixture.created).toHaveLength(1));
    expect(fixture.created[0]).toEqual({ name: "Douala corridor", kind: "DEPARTMENT", member_ids: ["u1", "u2"] });
  });
});

describe("chat containment", () => {
  it("scrolls only the message pane, following new messages unless reading history", () => {
    const outerScroll = vi.spyOn(Element.prototype, "scrollIntoView");
    const view = render(chat());
    const pane = screen.getByText("Hello").parentElement!;
    expect(pane).toHaveClass("min-h-0", "overflow-y-auto");
    Object.defineProperties(pane, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { value: 200 } });
    fixture.messages = [...fixture.messages, { message_id: "m2", body: "New" }];
    view.rerender(chat());
    expect(pane.scrollTop).toBe(1000);
    pane.scrollTop = 100;
    fireEvent.scroll(pane);
    fixture.messages = [...fixture.messages, { message_id: "m3", body: "Later" }];
    view.rerender(chat());
    expect(pane.scrollTop).toBe(100);
    expect(outerScroll).not.toHaveBeenCalled();
    outerScroll.mockRestore();
  });
});

/**
 * Who owns the open reaction rail.
 *
 * The bubble decides what a tap MEANS (message-bubble.test); the page decides
 * which message is allowed to be open — one at a time, and no longer than it is
 * useful. These are parent-side properties, and they are invisible from inside a
 * single bubble: with each bubble keeping its own state, fifty rows can be open at
 * once, which is the original complaint wearing a new hat.
 */
describe("the revealed message, owned by the page", () => {
  const two = () => {
    fixture.messages = [
      { message_id: "m1", body: "Hello" },
      { message_id: "m2", body: "Second" },
    ];
  };
  const rows = () => Array.from(document.querySelectorAll("[data-message-bubble]"));
  const openRows = () => rows().filter((r) => r.getAttribute("data-revealed") === "true");

  it("opens the message that was touched, and only that one", () => {
    two();
    render(chat());
    fireEvent.pointerDown(screen.getByText("Hello"));
    expect(openRows().map((r) => r.textContent)).toEqual(["Hello"]);
    fireEvent.pointerDown(screen.getByText("Second"));
    // Moving the open rail is the whole point of one-at-a-time: the first row must
    // close as the second opens, not linger.
    expect(openRows().map((r) => r.textContent)).toEqual(["Second"]);
  });

  it("closes the same message when it is touched again", () => {
    render(chat());
    fireEvent.pointerDown(screen.getByText("Hello"));
    expect(openRows()).toHaveLength(1);
    fireEvent.pointerDown(screen.getByText("Hello"));
    expect(openRows()).toHaveLength(0);
  });

  it("a touch on the thread background closes it, but a touch on a row does not", () => {
    two();
    render(chat());
    const pane = screen.getByText("Hello").parentElement!;
    fireEvent.pointerDown(screen.getByText("Hello"));
    expect(openRows()).toHaveLength(1);
    // The load-bearing half: the pointer event from a bubble reaches this handler
    // too, because events bubble. An ancestor that cleared unconditionally would
    // cancel the child in the same tick and the rail would never appear — a bug
    // invisible to any test that only checks the background.
    fireEvent.pointerDown(screen.getByText("Hello"));
    fireEvent.pointerDown(pane);
    expect(openRows()).toHaveLength(0);
  });

  it("Escape closes it", () => {
    render(chat());
    fireEvent.pointerDown(screen.getByText("Hello"));
    expect(openRows()).toHaveLength(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(openRows()).toHaveLength(0);
  });

  it("hands the cached previews down, and hands nothing down when the server sent none", () => {
    fixture.links = { "https://maersk.com/vessel/1": { state: "OK", title: "Vessel tracking" } };
    render(chat());
    expect(rows()[0]).toHaveAttribute("data-links", "https://maersk.com/vessel/1");
  });

  it("an old server with no previews still renders the thread", () => {
    render(chat());
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(rows()[0]).toHaveAttribute("data-links", "");
  });

  it("switching threads closes it, because the open row is gone", () => {
    /**
     * Navigation, not a new router. `initialEntries` is read once at mount, so
     * re-rendering with a different one changes nothing and would leave this test
     * passing for the wrong reason; a real link keeps TeamChatPage mounted and
     * moves only the query, which is what picking another channel in the sidebar
     * actually does.
     */
    const GoToSecondThread = () => {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate("/comms?channel=two")}>
          other thread
        </button>
      );
    };
    render(
      <MemoryRouter initialEntries={["/comms?channel=one"]}>
        <GoToSecondThread />
        <TeamChatPage />
      </MemoryRouter>,
    );
    fireEvent.pointerDown(screen.getByText("Hello"));
    expect(openRows()).toHaveLength(1);
    fireEvent.click(screen.getByText("other thread"));
    // The other thread is mocked to carry the same message id, which is exactly
    // why this test matters: without the reset on `channelId`, that id would
    // still be "the open one" in a thread the reader never touched.
    expect(openRows()).toHaveLength(0);
  });
});
