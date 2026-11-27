/**
 * Sign As: how a message from a SHARED mailbox is signed, chosen per message.
 *
 * Every composer starts on the team signature, which names nobody. The sender
 * may switch THIS message to "Team + Me" (a "Sent by <name>" line). The choice
 * is drawn only for a shared mailbox, because a personal one is already signed
 * by its owner, and the server reads it only for a shared one.
 *
 * Mocks follow index.paste.test.tsx: TipTap does not mount in jsdom.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Composer from "./index";

const { saveDraft, uploadAttachment, draftAttachments, sendMessage } = vi.hoisted(() => ({
  saveDraft: vi.fn(),
  uploadAttachment: vi.fn(),
  draftAttachments: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("@/lib/mail-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mail-api")>()),
  saveDraft,
  uploadAttachment,
  draftAttachments,
  sendMessage,
  listCommands: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/use-resource", () => ({
  useResource: () => ({ data: [], loading: false, error: null }),
}));

vi.mock("./use-editor", () => ({
  useComposerEditor: () => ({
    getText: () => "Hello",
    getHTML: () => "<p>Hello</p>",
    isEmpty: false,
    commands: {
      setContent: vi.fn(),
      focus: vi.fn(),
    },
    chain: () => ({
      focus: () => ({
        deleteRange: () => ({ insertContent: () => ({ run: vi.fn() }) }),
        insertContent: () => ({ run: vi.fn() }),
      }),
    }),
    view: { dom: document.createElement("div") },
    on: vi.fn(),
    off: vi.fn(),
  }),
}));

vi.mock("./editor", () => ({
  EditorSurface: () => <div data-testid="editor-surface" />,
}));

vi.mock("./toolbar", () => ({
  ComposerToolbar: () => <div data-testid="composer-toolbar" />,
  FontNote: () => <div data-testid="font-note" />,
}));

vi.mock("./slash-menu", () => ({
  SlashMenu: () => null,
}));

vi.mock("./attachment-tray", () => ({
  MAIL_ATTACHMENT_ACCEPT:
    "application/pdf,image/*,.doc,.docx,.xls,.xlsx,text/plain,text/csv",
  AttachmentTray: () => null,
  AttachButton: () => <div data-testid="attach-button" />,
}));

vi.mock("./recipient-field", () => ({
  RecipientField: ({
    id,
    value,
    onChange,
  }: {
    id: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <input
      id={id}
      aria-label={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock("./use-from-mailbox", () => ({
  useFromMailbox: (initial: string) => React.useState(initial),
}));

vi.mock("./offline-queue", () => ({
  newIdempotencyKey: () => "mail-key-1",
  rememberSend: vi.fn(),
  forgetSend: vi.fn(),
}));

vi.mock("@/components/ui/use-confirm", () => ({
  useConfirm: () => [vi.fn().mockResolvedValue(false), null],
}));

vi.mock("../work/assist", () => ({ AssistToolbar: () => null }));
vi.mock("../work/guardrails", () => ({ GuardrailBar: () => null }));
vi.mock("../work/use-guardrails", () => ({
  useGuardrails: () => ({ warnings: [], blocks: [] }),
}));
vi.mock("../work/use-thread-lock", () => ({
  useThreadLock: () => ({ heldByOther: null }),
}));
vi.mock("../work/use-recipient-health", () => ({
  useRecipientHealth: () => ({ hard: [], soft: [] }),
}));
vi.mock("../work/schedule", () => ({ SchedulePicker: () => null }));
vi.mock("../work/schedule-payload", () => ({
  schedulePayload: () => ({}),
}));

const sentBody = () => sendMessage.mock.calls[0][0] as Record<string, unknown>;

describe("mail composer: Sign As", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveDraft.mockResolvedValue({ email_draft_id: "draft-1" });
    draftAttachments.mockResolvedValue({
      attachments: [], total_bytes: 0, limit_bytes: 25 * 1024 * 1024, offer_secure_link: false,
    });
    sendMessage.mockResolvedValue({
      email_send_queue_id: "q-1", status: "HELD", release_at: new Date().toISOString(), undo_seconds: 0, warnings: [],
    });
  });

  it("a personal mailbox shows no choice and sends none", async () => {
    render(<Composer connectionId="conn-1" mailboxKind="PERSONAL" initialTo={["client@acme.cm"]} />);
    expect(screen.queryByRole("radiogroup", { name: "Sign As" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sentBody().sign_as).toBeUndefined();
  });

  it("a shared mailbox starts on Team, and sends TEAM when left alone", async () => {
    render(<Composer connectionId="conn-1" mailboxKind="SHARED" initialTo={["client@acme.cm"]} />);
    const group = screen.getByRole("radiogroup", { name: "Sign As" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Team" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sentBody().sign_as).toBe("TEAM");
  });

  it("picking Team + Me signs this message with the sender's name", async () => {
    render(<Composer connectionId="conn-1" mailboxKind="SHARED" initialTo={["client@acme.cm"]} />);
    await userEvent.click(screen.getByRole("radio", { name: "Team + Me" }));
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sentBody().sign_as).toBe("TEAM_AND_ME");
  });

  it("the mailbox list, when passed, decides: a shared From shows the choice", () => {
    render(
      <Composer
        connectionId="conn-2"
        mailboxes={[
          { email_connection_id: "conn-1", email_address: "ada@acme.cm", kind: "PERSONAL", status: "CONNECTED" } as never,
          { email_connection_id: "conn-2", email_address: "info@acme.cm", kind: "SHARED", status: "CONNECTED" } as never,
        ]}
        initialTo={["client@acme.cm"]}
      />,
    );
    expect(screen.getByRole("radiogroup", { name: "Sign As" })).toBeInTheDocument();
  });
});
