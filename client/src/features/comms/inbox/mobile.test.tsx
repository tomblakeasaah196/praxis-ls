/**
 * The mail screen on a phone (tenant review, 27 Nov 2026).
 *
 * The owner's screenshot: the first conversation started three quarters of the
 * way down a phone, under a Compose button, a search form with its own button,
 * a mailbox picker and eight folder rows. These pin what replaced each piece,
 * so a later pass cannot quietly put a column of rows back above the list.
 *
 * jsdom has no `matchMedia`, and `useIsDesktop()` answers TRUE without one, so
 * every other test in this folder sees the desktop. The phone is stubbed here.
 */
import * as React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { FolderRail, type RailSelection } from "./folder-rail";
import { ThreadList, LONG_PRESS_MS } from "./thread-list";
import { VerdictBanner, VerdictIcon } from "./work/guardrails";
import { AssistToolbar } from "./work/assist";
import type { Folder, Mailbox, Thread } from "@/lib/mail-api";

// jsdom has no PointerEvent, so `fireEvent.pointerDown` would build a bare
// Event with no coordinates and the scroll-versus-hold test would pass on
// NaN. A MouseEvent carries clientX/clientY and button, which is all the row
// reads.
if (typeof window.PointerEvent === "undefined") {
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = class extends MouseEvent {};
}

const realMatchMedia = window.matchMedia;
function stubPhone() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
afterEach(() => {
  window.matchMedia = realMatchMedia;
  vi.useRealTimers();
});

const folder = (over: Partial<Folder> = {}): Folder => ({
  email_folder_id: "f1",
  email_connection_id: "c1",
  canonical: "INBOX",
  provider_path: "INBOX",
  display_name: "Inbox",
  is_syncable: true,
  total: 10,
  unread_count: 3,
  ...over,
});
const mailbox = (over: Partial<Mailbox> = {}): Mailbox =>
  ({
    email_connection_id: "c1",
    email_address: "billing@co.cm",
    provider: "imap_smtp",
    kind: "SHARED",
    status: "CONNECTED",
    ...over,
  }) as Mailbox;

const ALL = [
  folder(),
  folder({ email_folder_id: "f-s", canonical: "SENT", display_name: "Sent", unread_count: 0 }),
  folder({ email_folder_id: "f-a", canonical: "ARCHIVE", display_name: "Archive", unread_count: 0 }),
  folder({ email_folder_id: "f-j", canonical: "SPAM", display_name: "Junk", unread_count: 0 }),
  folder({ email_folder_id: "f-t", canonical: "TRASH", display_name: "Bin", unread_count: 0 }),
];

function CompactRail({
  mailboxes = [mailbox()],
  onChange,
}: {
  mailboxes?: Mailbox[];
  onChange?: (s: RailSelection) => void;
}) {
  const [sel, setSel] = React.useState<RailSelection>({ folder: "INBOX", stream: "HUMAN" });
  return (
    <FolderRail
      compact
      mailboxes={mailboxes}
      folders={ALL}
      selection={sel}
      onChange={(next) => {
        setSel(next);
        onChange?.(next);
      }}
      humanUnread={109}
      systemUnread={677}
      outboxWaiting={3}
    />
  );
}

describe("the folders on a phone", () => {
  it("ARE ONE DROPDOWN, not a column of rows, with the counts in the options", () => {
    render(<CompactRail />);
    const nav = screen.getByRole("navigation", { name: "Mail folders" });
    expect(within(nav).queryAllByRole("button")).toHaveLength(0);
    const picker = screen.getByLabelText("Folder") as HTMLSelectElement;
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Inbox · 109",
      "Notices · 677",
      "Drafts",
      "Outbox · 3",
      "Sent",
      "Archive",
      "Spam",
      "Trash",
    ]);
    expect(picker.value).toBe("INBOX:HUMAN");
  });

  it("goes where the dropdown says, and drops the filter on the way", async () => {
    const onChange = vi.fn();
    render(<CompactRail onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText("Folder"), "INBOX:SYSTEM");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ folder: "INBOX", stream: "SYSTEM", view: undefined, label: undefined }),
    );
    await userEvent.selectOptions(screen.getByLabelText("Folder"), "pending:DRAFTS");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ pending: "DRAFTS" }));
  });

  it("puts the mailbox beside the folder only when there is more than one", () => {
    const { unmount } = render(<CompactRail />);
    expect(screen.queryByLabelText("Mailbox")).toBeNull();
    unmount();
    render(
      <CompactRail
        mailboxes={[mailbox(), mailbox({ email_connection_id: "c2", email_address: "ops@co.cm" })]}
      />,
    );
    const box = screen.getByLabelText("Mailbox");
    // Same row as the folder: both are children of one flex line.
    expect(box.parentElement).toBe(screen.getByLabelText("Folder").parentElement);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <CompactRail
        mailboxes={[mailbox(), mailbox({ email_connection_id: "c2", email_address: "ops@co.cm" })]}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

const thread = (over: Partial<Thread> = {}): Thread => ({
  email_thread_id: "t1",
  email_connection_id: "c1",
  thread_key: "<root>",
  subject: "Demurrage on MSKU1234567",
  participants: ["client@maersk.cm", "billing@co.cm"],
  message_count: 3,
  has_attachment: false,
  stream: "HUMAN",
  is_vip: false,
  entity_ref: null,
  last_message_at: new Date().toISOString(),
  mailbox_address: "billing@co.cm",
  unread_count: 2,
  is_starred: false,
  preview: "Please confirm the charges.",
  last_from: "client@maersk.cm",
  ...over,
});

function List({ onOpen }: { onOpen: (t: Thread) => void }) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  return (
    <ThreadList
      threads={[thread(), thread({ email_thread_id: "t2", subject: "Bill of lading" })]}
      loading={false}
      activeId={null}
      selected={selected}
      onSelectedChange={setSelected}
      onOpen={onOpen}
      onStar={vi.fn()}
      onBulk={vi.fn()}
      bulkBusy={false}
      bulkFailures={[]}
      onLoadMore={vi.fn()}
      hasMore={false}
      emptyHint="Empty."
    />
  );
}

const rowButton = (subject: string) =>
  screen.getByText(subject).closest("button") as HTMLButtonElement;

describe("selecting conversations on a phone", () => {
  it("HIDES THE ROW CHECKBOXES until something is selected, but keeps them for a screen reader", () => {
    stubPhone();
    render(<List onOpen={vi.fn()} />);
    const box = screen.getByRole("checkbox", { name: /Select Demurrage/ });
    expect(box.closest(".sr-only")).not.toBeNull();
  });

  it("A LONG PRESS SELECTS rather than opens, and then a tap toggles", () => {
    stubPhone();
    vi.useFakeTimers();
    const onOpen = vi.fn();
    render(<List onOpen={onOpen} />);
    const row = rowButton("Demurrage on MSKU1234567");

    fireEvent.pointerDown(row, { button: 0, clientX: 10, clientY: 10 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS + 10); });
    fireEvent.pointerUp(row);
    fireEvent.click(row);

    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    // The checkboxes are drawn now that the list is in selection mode.
    expect(screen.getByRole("checkbox", { name: /Select Demurrage/ }).closest(".sr-only")).toBeNull();

    // A plain tap on another row adds it, rather than opening it.
    fireEvent.click(rowButton("Bill of lading"));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  it("a press that MOVES is a scroll, not a hold", () => {
    stubPhone();
    vi.useFakeTimers();
    const onOpen = vi.fn();
    render(<List onOpen={onOpen} />);
    const row = rowButton("Demurrage on MSKU1234567");
    fireEvent.pointerDown(row, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(row, { clientX: 10, clientY: 60 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS + 10); });
    expect(screen.queryByText("1 selected")).toBeNull();
  });

  it("a short tap still opens the conversation", () => {
    stubPhone();
    const onOpen = vi.fn();
    render(<List onOpen={onOpen} />);
    fireEvent.click(rowButton("Bill of lading"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ email_thread_id: "t2" }));
  });

  it("on a desktop, the checkboxes are always there and a press does nothing special", () => {
    render(<List onOpen={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: /Select Demurrage/ }).closest(".sr-only")).toBeNull();
  });
});

describe("the sender check", () => {
  it("PRINTS NOTHING for an unverified sender: the icon carries it", () => {
    const { container } = render(<VerdictBanner verdict="UNVERIFIED" />);
    expect(container).toBeEmptyDOMElement();
    render(<VerdictIcon verdict="UNVERIFIED" />);
    expect(screen.getByRole("img", { name: "Not Verified" })).toHaveAttribute(
      "title",
      expect.stringContaining("normal for a first contact"),
    );
  });

  it("stays LOUD for a lookalike domain", () => {
    render(<VerdictBanner verdict="LIKELY_IMPERSONATION" />);
    expect(screen.getByText("Likely Impersonation")).toBeInTheDocument();
    expect(screen.getByText(/confirm it by phone/)).toBeInTheDocument();
  });
});

describe("the composer's AI panel", () => {
  const panel = (threadId: string | null = "t1") =>
    render(
      <AssistToolbar
        threadId={threadId}
        getText={() => "Bonjour, merci pour votre message."}
        setText={vi.fn()}
      />,
    );

  it("leads with the tone and Draft a Reply, and puts every other verb on one row of chips", () => {
    panel();
    expect(screen.getByRole("button", { name: "Draft a Reply" })).toBeInTheDocument();
    const chips = within(screen.getByRole("group", { name: "More ways to write" }));
    for (const name of ["Rewrite in This Tone", "Brief…", "Fix Grammar", "Shorten", "Expand", "Translate"]) {
      expect(chips.getByRole("button", { name })).toBeInTheDocument();
    }
    // Two languages behind ONE chip.
    expect(screen.queryByRole("button", { name: "En français" })).toBeNull();
    // The disclaimer sentence under the panel is gone.
    expect(screen.queryByText(/Nothing is sent, and nothing is written/)).toBeNull();
  });

  it("offers both translations from the one chip", async () => {
    panel();
    await userEvent.click(screen.getByRole("button", { name: "Translate" }));
    expect(screen.getByRole("menuitem", { name: "En français" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "In English" })).toBeInTheDocument();
  });

  it("on a new message, writing is the first row's job", () => {
    panel(null);
    expect(screen.queryByRole("button", { name: "Draft a Reply" })).toBeNull();
    expect(screen.getByRole("button", { name: "Rewrite in This Tone" })).toBeInTheDocument();
  });
});
