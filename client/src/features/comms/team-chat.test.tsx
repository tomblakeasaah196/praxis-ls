import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TeamChatPage } from "./team-chat";

const fixture = vi.hoisted(() => ({
  channel: { group_id: "one", name: "Operations", kind: "DIRECT", unread: 0 } as Record<string, unknown>,
  messages: [{ message_id: "m1", body: "Hello" }],
  members: [
    { user_id: "u1", full_name: "Ama Mensah", email: "ama@smart.ls", member_role: "OWNER" },
    { user_id: "u2", full_name: "Kofi Boateng", email: "kofi@smart.ls", member_role: "MEMBER" },
  ],
  updateCalls: [] as [string, unknown][],
}));
vi.mock("@/app/auth/auth-context", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("@/lib/comms-socket", () => ({ useCommsChannel: () => ({ setTyping: vi.fn() }) }));
vi.mock("@/lib/smartcomm-api", () => ({
  listChannels: () => [fixture.channel], listColleagues: () => [],
  getChannel: () => fixture.channel, getThread: () => ({ messages: fixture.messages }),
  markRead: () => Promise.resolve(),
  listChannelMembers: () => fixture.members,
  updateChannel: (id: string, body: unknown) => {
    fixture.updateCalls.push([id, body]);
    return Promise.resolve(fixture.channel);
  },
}));
vi.mock("@/lib/use-resource", () => ({
  useResource: (load: () => unknown) => ({ data: load(), loading: false, reload: vi.fn() }),
  errMsg: String,
}));
vi.mock("./inbox/composer/new-message", () => ({ NewMessageDialog: () => null }));
vi.mock("./chat/composer", () => ({ Composer: () => <div>Message composer</div> }));
vi.mock("./chat/forward-dialog", () => ({ ForwardDialog: () => null }));
vi.mock("./chat/message-bubble", () => ({ MessageBubble: ({ message }: { message: { body: string } }) => <div>{message.body}</div> }));
const chat = () => <MemoryRouter initialEntries={["/comms?channel=one"]}><TeamChatPage /></MemoryRouter>;

beforeEach(() => {
  localStorage.clear();
  fixture.messages = [{ message_id: "m1", body: "Hello" }];
  fixture.channel = { group_id: "one", name: "Operations", kind: "DIRECT", unread: 0 };
  fixture.updateCalls = [];
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});

describe("chat containment and information panel", () => {
  it("defaults open and remembers a collapsed desktop pane on remount", () => {
    const view = render(chat());
    fireEvent.click(screen.getByRole("button", { name: "Hide info" }));
    expect(screen.getByRole("button", { name: "Show info" })).toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem("comms:info-open")).toBe("false");
    view.unmount();
    render(chat());
    expect(screen.getByRole("button", { name: "Show info" })).toHaveAttribute("aria-expanded", "false");
  });

  it("opens a right-edge dialog without replacing the thread, closes with Escape", async () => {
    render(chat());
    const composer = screen.getByText("Message composer");
    fireEvent.click(screen.getByRole("button", { name: "Info" }));
    expect(screen.getByRole("dialog", { name: "Conversation info" })).toHaveClass("right-0", "h-dvh");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Message composer")).toBe(composer);
    expect(localStorage.getItem("comms:info-open")).toBeNull();
  });

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

describe("conversation info: roster and description", () => {
  it("lists the members and the group description instead of placeholders", async () => {
    fixture.channel = {
      group_id: "one",
      name: "Ops taskforce - FMA",
      kind: "DEPARTMENT",
      topic: "Douala corridor standups",
      unread: 0,
    };
    render(chat());
    // The About text is the channel's own description, not a canned sentence.
    expect(await screen.findByText("Douala corridor standups")).toBeInTheDocument();
    // The roster comes from GET /channels/:id/members.
    expect(screen.getByText("Ama Mensah")).toBeInTheDocument();
    expect(screen.getByText("Kofi Boateng")).toBeInTheDocument();
    // …with a real count, not the old "—" dash.
    expect(screen.getByText("2")).toBeInTheDocument();
    // The owner's role is visible; plain members carry no chip.
    expect(screen.getByText("owner")).toBeInTheDocument();
    expect(screen.queryByText("member")).not.toBeInTheDocument();
  });

  it("saves a description written from the info pane", async () => {
    fixture.channel = { group_id: "one", name: "Ops taskforce", kind: "DEPARTMENT", unread: 0 };
    render(chat());
    fireEvent.click(await screen.findByRole("button", { name: "Add description" }));
    fireEvent.change(screen.getByPlaceholderText("What is this channel for?"), {
      target: { value: "Weekly standups" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(fixture.updateCalls).toEqual([["one", { topic: "Weekly standups" }]]),
    );
  });
});

describe("profile picture preview", () => {
  it("opens a modal with the uploaded photo large when an avatar is clicked", () => {
    fixture.channel = {
      group_id: "one",
      name: "JBS Praxis",
      kind: "DIRECT",
      partner_avatar_ref: "/media/jbs.png",
      unread: 0,
    };
    render(chat());
    fireEvent.click(screen.getAllByRole("button", { name: /View profile picture of/i })[0]);
    const dialog = screen.getByRole("dialog", { name: "JBS Praxis" });
    const img = within(dialog).getByRole("img", { name: "JBS Praxis" });
    expect(img).toHaveAttribute("src", "/media/jbs.png");
    // Large, not the 40px row chip.
    expect(img).toHaveClass("max-h-[60vh]");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the large initials chip and says so when no photo is uploaded", () => {
    render(chat());
    fireEvent.click(screen.getAllByRole("button", { name: /View profile picture of/i })[0]);
    const dialog = screen.getByRole("dialog", { name: "Operations" });
    expect(dialog).toBeInTheDocument();
    expect(
      screen.getByText("No profile photo uploaded yet — the initials chip is shown instead."),
    ).toBeInTheDocument();
  });
});
