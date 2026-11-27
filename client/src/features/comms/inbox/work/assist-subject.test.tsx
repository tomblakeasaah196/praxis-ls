/**
 * The assistant fills an EMPTY Subject field (27 Nov 2026).
 *
 * The owner's rule, in three parts: an empty field gets the subject the
 * assistant writes; a subject the operator typed (or a reply's "Re:") is never
 * touched and goes to the model as the brief; and a subject the assistant
 * wrote is replaced by the next draft until the operator edits it.
 */
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssistToolbar } from "./assist";

const { assistCompose, assistDraft } = vi.hoisted(() => ({
  assistCompose: vi.fn(),
  assistDraft: vi.fn(),
}));
vi.mock("@/lib/mail-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/mail-api")>()),
  assistCompose,
  assistDraft,
}));

/** The composer's half of the bargain, as a tiny harness: a Subject value,
 *  and the assistant's last-written subject. */
function Harness({ initialSubject = "" }: { initialSubject?: string }) {
  const [subject, setSubject] = React.useState(initialSubject);
  const [ai, setAi] = React.useState<string | null>(null);
  return (
    <>
      <input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <AssistToolbar
        threadId={null}
        getText={() => ""}
        setText={vi.fn()}
        getSubject={() => subject}
        subjectFill={{
          canFill: () => !subject.trim() || (ai !== null && subject === ai),
          fill: (s) => { setAi(s); setSubject(s); },
        }}
      />
    </>
  );
}

const reply = (subject_text: string | null) => ({
  draft_text: "Dear Sir,\n\nBody.",
  subject_text,
  language: "en",
});

beforeEach(() => {
  assistCompose.mockReset();
  assistDraft.mockReset();
});

describe("the subject the assistant writes", () => {
  it("FILLS AN EMPTY SUBJECT, and asks for one without sending a subject", async () => {
    assistCompose.mockResolvedValueOnce(reply("Request for a demurrage waiver"));
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Write It for Me" }));
    expect(assistCompose).toHaveBeenCalledWith(
      expect.objectContaining({ want_subject: true, subject: undefined }),
    );
    expect(await screen.findByDisplayValue("Request for a demurrage waiver")).toBeInTheDocument();
  });

  it("NEVER TOUCHES A SUBJECT THE OPERATOR TYPED: it goes as the brief", async () => {
    assistCompose.mockResolvedValueOnce(reply(null));
    render(<Harness initialSubject="Demurrage MSKU4567890" />);
    await userEvent.click(screen.getByRole("button", { name: "Write It for Me" }));
    expect(assistCompose).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "Demurrage MSKU4567890", want_subject: undefined }),
    );
    expect(screen.getByLabelText("Subject")).toHaveValue("Demurrage MSKU4567890");
  });

  it("a reply's 'Re:' subject is the operator's too", async () => {
    assistCompose.mockResolvedValueOnce(reply("Something else"));
    render(<Harness initialSubject="Re: ETA Douala" />);
    await userEvent.click(screen.getByRole("button", { name: "Write It for Me" }));
    expect(assistCompose).toHaveBeenCalledWith(expect.objectContaining({ want_subject: undefined }));
    expect(screen.getByLabelText("Subject")).toHaveValue("Re: ETA Douala");
  });

  it("REPLACES ITS OWN SUBJECT on the next draft, until the operator edits it", async () => {
    assistCompose
      .mockResolvedValueOnce(reply("First subject"))
      .mockResolvedValueOnce(reply("Second subject"))
      .mockResolvedValueOnce(reply("Third subject"));
    render(<Harness />);
    const write = () => userEvent.click(screen.getByRole("button", { name: /Write It for Me|Rewrite in This Tone/ }));

    await write();
    expect(await screen.findByDisplayValue("First subject")).toBeInTheDocument();

    // Untouched: the second draft brings a second subject, and the first is
    // not sent as if the operator had written it.
    await write();
    expect(assistCompose).toHaveBeenLastCalledWith(
      expect.objectContaining({ want_subject: true, subject: undefined }),
    );
    expect(await screen.findByDisplayValue("Second subject")).toBeInTheDocument();

    // Edited: now it is the operator's, and the third draft leaves it alone.
    await userEvent.type(screen.getByLabelText("Subject"), " for MSKU");
    await write();
    expect(assistCompose).toHaveBeenLastCalledWith(
      expect.objectContaining({ subject: "Second subject for MSKU", want_subject: undefined }),
    );
    expect(screen.getByLabelText("Subject")).toHaveValue("Second subject for MSKU");
  });

  it("a model that gave no subject leaves the empty field empty", async () => {
    assistCompose.mockResolvedValueOnce(reply(null));
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Write It for Me" }));
    await screen.findByRole("button", { name: /Write It for Me|Rewrite in This Tone/ });
    expect(screen.getByLabelText("Subject")).toHaveValue("");
  });
});
