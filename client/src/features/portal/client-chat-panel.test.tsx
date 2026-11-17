/**
 * The client chat's reply box (client portal PR 3) — the Smart Comms team
 * chat's pattern: a `+` with the tools rather than text links under the box,
 * Enter to send, a microphone while there is nothing to send, and a location
 * that is shown and named before it goes.
 *
 * The recorder itself needs a microphone, so it is stood in for by a button
 * that "records" a clip; everything after the recording is the real panel.
 *
 * And the conversation around the box, as a client's own Messages tab mounts it
 * (the panel with nothing but a client id): Chat's bubbles, the conversations as
 * tabs, and the account manager behind an info button (tenant review, 17 Nov
 * 2026).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/screen-harness";

type Call = { path: string; method?: string; body?: unknown };
const calls = vi.hoisted(() => [] as Call[]);
const uploads = vi.hoisted(() => [] as { path: string; name: string; type: string; fields?: Record<string, unknown> }[]);
const access = vi.hoisted(() => ({ smartComms: true }));

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  const base = await apiClientMock();
  return {
    ...base,
    tenant: (path: string, opts?: { method?: string; body?: unknown }) => {
      calls.push({ path, method: opts?.method, body: opts?.body });
      return base.tenant(path);
    },
    uploadFile: async (path: string, file: File, opts?: { fields?: Record<string, unknown> }) => {
      uploads.push({ path, name: file.name, type: file.type, fields: opts?.fields });
      return {};
    },
  };
});
vi.mock("@/lib/route-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/route-access")>("@/lib/route-access");
  return { ...actual, useCanUseModule: (key: string) => (key === "MOD-64" ? access.smartComms : true) };
});
vi.mock("@/features/comms/chat/voice-recorder", () => ({
  VoiceRecorder: ({ onRecorded, disabled }: { onRecorded: (r: unknown) => void; disabled?: boolean }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onRecorded({ blob: new Blob(["ogg"], { type: "audio/webm" }), durationMs: 4200.4, waveform: [], mimeType: "audio/webm;codecs=opus" })}
    >
      Record a voice note
    </button>
  ),
}));

// The conversation's backdrop is the tenant's hero image when their branding has
// one; with no provider in this harness, no branding is the default wash.
vi.mock("@/app/branding/branding-context", () => ({ useBranding: () => ({ branding: null }) }));

import { ClientChatPanel } from "./client-chat-panel";

const ROUTES = {
  "/portal/chat/threads": [],
  "/portal/chat/messages": { thread: "general", dossier_ref: null, has_more: false, messages: [] },
  "/smartcomm/quick-replies": [{ quick_reply_id: "q1", label: "Docs received", body: "Thank you, we have your documents." }],
};

const posts = () => calls.filter((c) => c.method === "POST" && c.path === "/portal/chat/messages");
const mount = () => renderScreen(<ClientChatPanel clientId="c1" />, { routes: ROUTES });

beforeEach(() => {
  calls.length = 0;
  uploads.length = 0;
  access.smartComms = true;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the client chat's reply box", () => {
  it("keeps its tools behind a + rather than text links under the box", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole("textbox");
    expect(screen.queryByText("Attach a photo or PDF")).toBeNull();
    expect(screen.queryByText("Paste a file")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Add to the reply" }));
    for (const tool of ["Photo or document", "Share a location", "Emoji", "Quick replies"]) {
      expect(await screen.findByRole("button", { name: tool })).toBeInTheDocument();
    }
  });

  it("offers quick replies only to people who hold Smart Comms", async () => {
    access.smartComms = false;
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Add to the reply" }));
    expect(await screen.findByRole("button", { name: "Share a location" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quick replies" })).toBeNull();
  });

  it("puts a quick reply in the box", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Add to the reply" }));
    await user.click(await screen.findByRole("button", { name: "Quick replies" }));
    await user.click(await screen.findByText("Docs received"));
    expect(screen.getByRole("textbox")).toHaveValue("Thank you, we have your documents.");
  });

  it("shows a microphone while there is nothing to send, and Send once there is", async () => {
    const user = userEvent.setup();
    mount();
    const box = await screen.findByRole("textbox");
    expect(screen.getByRole("button", { name: "Record a voice note" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull();

    await user.type(box, "Hello");
    expect(screen.getByRole("button", { name: /Send/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record a voice note" })).toBeNull();
  });

  it("sends with Enter, and Shift+Enter starts a new line", async () => {
    const user = userEvent.setup();
    mount();
    const box = await screen.findByRole("textbox");
    await user.type(box, "Line one{Shift>}{Enter}{/Shift}line two");
    expect(box).toHaveValue("Line one\nline two");
    expect(posts()).toEqual([]);

    await user.type(box, "{Enter}");
    expect(posts()).toEqual([
      { path: "/portal/chat/messages", method: "POST", body: { client_id: "c1", thread: "general", body: "Line one\nline two" } },
    ]);
    expect(box).toHaveValue("");
    // The cursor stays in the box for the next line.
    expect(box).toHaveFocus();
  });

  it("sends a voice note as soon as it is recorded", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Record a voice note" }));
    expect(uploads).toEqual([
      { path: "/tenant/portal/chat/messages", name: "voice-note.webm", type: "audio/webm;codecs=opus", fields: { client_id: "c1", thread: "general", duration_ms: 4200 } },
    ]);
  });

  it("shares a location, shown and named before it goes", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      geolocation: {
        getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 4.0435, longitude: 9.6966, accuracy: 12 } }),
      },
    });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Add to the reply" }));
    await user.click(await screen.findByRole("button", { name: "Share a location" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("4.04350, 9.69660")).toBeInTheDocument();
    expect(within(dialog).getByText("± 12 m")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Name of the Place/), "Warehouse B, gate 3");
    await user.click(within(dialog).getByRole("button", { name: /Send location/ }));

    expect(posts()).toEqual([
      {
        path: "/portal/chat/messages",
        method: "POST",
        body: { client_id: "c1", thread: "general", lat: 4.0435, lng: 9.6966, location_label: "Warehouse B, gate 3" },
      },
    ]);
  });

  it("says so when the browser will not tell where you are", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      geolocation: { getCurrentPosition: (_ok: unknown, fail: (e: { code: number }) => void) => fail({ code: 1 }) },
    });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Add to the reply" }));
    await user.click(await screen.findByRole("button", { name: "Share a location" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Location is blocked for this site");
    expect(within(dialog).getByRole("button", { name: /Send location/ })).toBeDisabled();
  });
});

const SHIP = "d1111111-1111-4111-8111-111111111111";
const TALK = {
  ...ROUTES,
  "/portal/chat/threads": [
    { dossier_id: null, dossier_ref: null, last_at: "2026-09-27T12:00:00Z", unread: 0 },
    { dossier_id: SHIP, dossier_ref: "PRX-1", last_at: "2026-09-28T12:00:00Z", unread: 2 },
  ],
  "/portal/chat/messages": {
    thread: "general", dossier_ref: null, has_more: false,
    messages: [
      {
        message_id: "m1", direction: "CLIENT", body: "Is it out of port?", created_at: "2026-09-28T12:00:00Z",
        author: { name: "Jean Mballa", email: "jean@acme.cm" }, seen: null, milestone: null, location: null, attachments: [],
      },
      {
        message_id: "m2", direction: "STAFF", body: "It left this morning.", created_at: "2026-09-28T12:05:00Z",
        author: { name: "Awa Ndiaye", email: null }, seen: true, milestone: null, location: null, attachments: [],
      },
    ],
  },
  "/portal/chat/read": {},
  "/clients/c1/account-manager": {
    client_id: "c1",
    manager: { user_id: "u-awa", name: "Awa Ndiaye", job_title: "Key account manager", email: null, employee_id: "e-awa", reachable: true },
  },
};
const talk = () => renderScreen(<ClientChatPanel clientId="c1" />, { routes: TALK });

describe("the client conversation, as a client's Messages tab shows it", () => {
  it("draws the messages in Chat's bubbles: the client's on one side, the team's on the other", async () => {
    talk();
    const theirs = (await screen.findByText("Is it out of port?")).closest(".msg-bubble");
    const ours = screen.getByText("It left this morning.").closest(".msg-bubble");
    expect(theirs).toHaveClass("msg-bubble--theirs");
    expect(ours).toHaveClass("msg-bubble--mine");
    // Who wrote each one is on the bubble, on both sides: the team is several people.
    expect(within(theirs as HTMLElement).getByText("Jean Mballa")).toBeInTheDocument();
    expect(within(ours as HTMLElement).getByText("Awa Ndiaye")).toBeInTheDocument();
    // On Chat's backdrop, in a pane that scrolls by itself.
    const pane = screen.getByRole("list").parentElement as HTMLElement;
    expect(pane).toHaveClass("chat-thread-bg", "min-h-0", "overflow-y-auto");
  });

  it("follows a new message by moving its own pane, never the page around it", async () => {
    const outer = vi.spyOn(Element.prototype, "scrollIntoView");
    talk();
    await screen.findByText("Is it out of port?");
    expect(outer).not.toHaveBeenCalled();
    outer.mockRestore();
  });

  it("has the conversations as tabs, and a reply goes to the one that is open", async () => {
    const user = userEvent.setup();
    talk();
    const tabs = await screen.findByRole("tablist", { name: "Conversation" });
    await waitFor(() => expect(within(tabs).getAllByRole("tab")).toHaveLength(2));
    expect(within(tabs).getByRole("tab", { name: /General/ })).toHaveAttribute("aria-selected", "true");
    expect(within(tabs).getByRole("tab", { name: /PRX-1/ })).toHaveTextContent("2");

    await user.click(within(tabs).getByRole("tab", { name: /PRX-1/ }));
    expect(within(tabs).getByRole("tab", { name: /PRX-1/ })).toHaveAttribute("aria-selected", "true");
    await user.type(screen.getByRole("textbox"), "On its way{Enter}");
    expect(posts()).toEqual([
      { path: "/portal/chat/messages", method: "POST", body: { client_id: "c1", thread: SHIP, body: "On its way" } },
    ]);
  });

  it("keeps the account manager behind the info button, closed until asked for", async () => {
    const user = userEvent.setup();
    talk();
    const info = await screen.findByRole("button", { name: "Conversation Info" });
    expect(info).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Account Manager")).toBeNull();
    expect(calls.some((c) => c.path.startsWith("/clients/c1/account-manager"))).toBe(false);

    await user.click(info);
    // With no room given beside the messages it is a sheet over them.
    const sheet = await screen.findByRole("dialog", { name: "Conversation Info" });
    expect(await within(sheet).findByText("Account Manager")).toBeInTheDocument();
    expect(await within(sheet).findByText("Key account manager")).toBeInTheDocument();
  });

  it("opens that panel beside the messages where the screen gives it the room", async () => {
    const user = userEvent.setup();
    renderScreen(<ClientChatPanel clientId="c1" infoBeside />, { routes: TALK });
    await user.click(await screen.findByRole("button", { name: "Conversation Info" }));
    const panel = screen.getByRole("complementary", { name: "Conversation Info" });
    expect(await within(panel).findByText("Account Manager")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("drops the hint from the message box once the box is clicked into, as Chat's does", async () => {
    talk();
    const box = await screen.findByRole("textbox");
    expect(box).toHaveAttribute("placeholder", "Reply to the client…");
    // The rule itself is CSS, which this harness does not apply: what is pinned
    // is that the box carries it, and Chat's round corners with it.
    expect(box).toHaveClass("focus:placeholder:text-transparent", "rounded-2xl");
  });
});
