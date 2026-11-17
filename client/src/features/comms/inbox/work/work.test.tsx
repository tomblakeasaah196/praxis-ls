/**
 * THE COMPOSER'S ASSISTS AND GUARDRAILS — the rules that are only visible on
 * screen.
 *
 * The server enforces every one of these, and each is already tested there. So
 * this file is not about whether the rule holds; it is about whether an
 * operator can SEE it hold. A guardrail the interface hides is a guardrail the
 * interface will eventually route around.
 *
 *   1. §8.3 — a fenced draft still arrives, with the unsupported values NAMED,
 *             and the sources it was grounded in are stated.
 *   2. §8.8 — the one hard block asks for a reason and says, before the person
 *             types, that it is permanent.
 *
 * This file used to open with three more: the action cards (§7.3), the record
 * tabs and document filing (§7.6). Those panels left the reading pane with the
 * rest of the work rail on 16 Nov 2026, and their tests went with them. What
 * is left of the rail on screen, the link dialog and the summary, is asserted
 * in `../inbox.test.tsx`.
 */
// No `import * as React` — `jsx: "react-jsx"` means JSX needs no import, and
// `noUnusedLocals` fails the build on one. This file had it, and it shipped:
// vitest transpiles without typechecking, so a green test run says nothing
// about whether `tsc -b` (which `npm run build` runs first) will pass.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/screen-harness";
import { DraftProvenance } from "./assist";
import { GuardrailBar } from "./guardrails";
import { SchedulePicker } from "./schedule";
import { schedulePayload, type ScheduleChoice } from "./schedule-payload";
import type { AssistDraft, GuardrailResult } from "@/lib/mail-api";

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  return apiClientMock();
});

beforeEach(() => vi.clearAllMocks());

/* ── §8.3 · Draft provenance ──────────────────────────────────────────────── */

const draft = (over: Partial<AssistDraft> = {}): AssistDraft => ({
  draft_text: "Your invoice INV-2026-9999 is due.",
  language: "en",
  sources: [{ key: "invoice_status", label: "Invoices", module_key: "MOD-51", count: 2 }],
  withheld: [],
  fence: { ok: true, violations: [] },
  ...over,
});

describe("a draft arrives with its provenance", () => {
  it("names the modules it was grounded in", () => {
    renderScreen(<DraftProvenance draft={draft()} />);
    expect(screen.getByText("Invoices")).toBeInTheDocument();
  });

  it("NAMES what the record does not support, and does not hide the draft", () => {
    renderScreen(
      <DraftProvenance
        draft={draft({ fence: { ok: false, violations: ["INV-2026-9999"] }, needs_review: true })}
      />,
    );
    // A blank composer teaches people to stop using the feature. A marked one
    // teaches them what the assistant does not know.
    expect(screen.getByText(/INV-2026-9999/)).toBeInTheDocument();
    expect(screen.getByText(/Check these before you send/)).toBeInTheDocument();
  });

  it("says which sources were WITHHELD and why", () => {
    renderScreen(
      <DraftProvenance
        draft={draft({
          withheld: [{ key: "invoice_status", label: "Invoices", reason: "requires MOD-51 view" }],
        })}
      />,
    );
    // Silently thinner drafts for some users than others is the version of this
    // nobody can debug.
    expect(screen.getByText(/requires MOD-51 view/)).toBeInTheDocument();
  });

  it("says when a protected term had to be put back", () => {
    renderScreen(<DraftProvenance draft={draft({ protected_terms_restored: ["FOB"] })} />);
    expect(screen.getByText(/FOB/)).toBeInTheDocument();
  });
});

/* ── §8.8 · the block, and the permanence of the override ─────────────────── */

const blocked: GuardrailResult = {
  warnings: [{ code: "NO_SUBJECT", message: "This message has no subject." }],
  blocks: [{
    code: "FINANCIAL_TO_SUSPICIOUS",
    message: "A financial document to a domain that is not verified.",
  }],
};

describe("the pre-send bar", () => {
  it("shows the block and asks why", () => {
    renderScreen(
      <GuardrailBar result={blocked} overrideReason="" onOverrideChange={vi.fn()} />,
    );
    expect(screen.getByText(/This send is blocked/)).toBeInTheDocument();
    expect(screen.getByLabelText("Override reason")).toBeInTheDocument();
  });

  it("SAYS THE REASON IS PERMANENT BEFORE THE PERSON TYPES", () => {
    renderScreen(
      <GuardrailBar result={blocked} overrideReason="" onOverrideChange={vi.fn()} />,
    );
    // Someone writing a sentence that outlives them and the mailbox is entitled
    // to know that is what they are doing.
    expect(
      screen.getByText(/written to the permanent audit ledger with your name on it/),
    ).toBeInTheDocument();
  });

  it("nudges past 'ok' without blocking the field", async () => {
    const onChange = vi.fn();
    const { rerender } = renderScreen(
      <GuardrailBar result={blocked} overrideReason="ok" onOverrideChange={onChange} />,
    );
    expect(screen.getByText(/A sentence, please/)).toBeInTheDocument();
    rerender(
      <GuardrailBar
        result={blocked}
        overrideReason="Confirmed by phone with Thierry this morning."
        onOverrideChange={onChange}
      />,
    );
    await waitFor(() => expect(screen.queryByText(/A sentence, please/)).not.toBeInTheDocument());
  });

  it("a warning never asks for a reason", () => {
    renderScreen(
      <GuardrailBar
        result={{ warnings: blocked.warnings, blocks: [] }}
        overrideReason=""
        onOverrideChange={vi.fn()}
      />,
    );
    // The line stays sharp on purpose. A guardrail that blocks a dozen things
    // is one people learn to click through.
    expect(screen.getByText(/This message has no subject/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Override reason")).not.toBeInTheDocument();
  });

  it("renders nothing when there is nothing to say", () => {
    const { container } = renderScreen(
      <GuardrailBar result={{ warnings: [], blocks: [] }} overrideReason="" onOverrideChange={vi.fn()} />,
    );
    expect(within(container).queryByRole("status")).not.toBeInTheDocument();
  });
});

/* ── §9.3 · scheduling ────────────────────────────────────────────────────── */

describe("scheduled send offers two shapes and no third", () => {
  it("there is no 'best time to send'", async () => {
    renderScreen(<SchedulePicker value={{ kind: "NOW" }} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Send later" }));
    // Q32 removed the open-rate data that would be needed to know it. A button
    // here would be a hardcoded 10am wearing the word "optimal".
    expect(screen.queryByText(/best time/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Send at")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Their morning/ })).toBeInTheDocument();
  });

  it("it promises not to guess a timezone", async () => {
    renderScreen(<SchedulePicker value={{ kind: "NOW" }} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Send later" }));
    expect(screen.getByText(/We will not guess one/)).toBeInTheDocument();
  });

  it.each<[ScheduleChoice, Record<string, unknown>]>([
    [{ kind: "NOW" }, {}],
    [{ kind: "AT", iso: "2026-09-01T08:00:00.000Z" }, { send_at: "2026-09-01T08:00:00.000Z" }],
    [{ kind: "MORNING" }, { send_in_recipient_morning: true }],
  ])("the payload carries exactly one field, or neither", (choice, expected) => {
    // Scheduling and undo-send are the same mechanism; if both computed a
    // release time, a message scheduled for Tuesday would also be "undoable"
    // for twenty seconds and then not for six days.
    expect(schedulePayload(choice)).toEqual(expected);
  });
});
