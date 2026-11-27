/**
 * After the undo window: did it leave?
 *
 * 27 Nov 2026: the reply went out within seconds and appeared in the thread,
 * while the composer kept saying "Sending…" beside an Undo button forever. The
 * toast had no way out of `held`. These pin the way out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { UndoSendToast } from "./undo-toast";

const { listOutbox } = vi.hoisted(() => ({ listOutbox: vi.fn() }));
vi.mock("@/lib/mail-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mail-api")>()),
  listOutbox,
}));

import { useSendOutcome, type SendOutcome } from "./use-send-outcome";

const QUEUED = (over: Partial<{ release_at: string; undo_seconds: number }> = {}) => ({
  email_send_queue_id: "q-1",
  release_at: new Date(Date.now() + 10_000).toISOString(),
  undo_seconds: 10,
  ...over,
});

function Probe({ queued, active = true, onOutcome }: {
  queued: ReturnType<typeof QUEUED> | null;
  active?: boolean;
  onOutcome: (o: SendOutcome) => void;
}) {
  useSendOutcome(queued, active, onOutcome);
  return null;
}

const row = (status: string, last_error: string | null = null) => ({
  email_send_queue_id: "q-1", status, release_at: "", attempts: 1, last_error, payload: {}, created_at: "",
});

describe("useSendOutcome", () => {
  beforeEach(() => { vi.useFakeTimers(); listOutbox.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it("does not ask while the undo window is still open", async () => {
    listOutbox.mockResolvedValue([]);
    const onOutcome = vi.fn();
    render(<Probe queued={QUEUED()} onOutcome={onOutcome} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(9_000); });
    expect(listOutbox).not.toHaveBeenCalled();
    expect(onOutcome).not.toHaveBeenCalled();
  });

  it("A ROW THAT HAS LEFT THE OUTBOX IS SENT", async () => {
    listOutbox.mockResolvedValue([]);
    const onOutcome = vi.fn();
    render(<Probe queued={QUEUED()} onOutcome={onOutcome} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    expect(onOutcome).toHaveBeenCalledWith({ kind: "sent" });
  });

  it("keeps asking while the worker has not run yet, then reports", async () => {
    listOutbox
      .mockResolvedValueOnce([row("QUEUED")])
      .mockResolvedValueOnce([row("SENDING")])
      .mockResolvedValue([]);
    const onOutcome = vi.fn();
    render(<Probe queued={QUEUED()} onOutcome={onOutcome} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    expect(onOutcome).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(6_500); });
    expect(onOutcome).toHaveBeenCalledWith({ kind: "sent" });
    expect(listOutbox).toHaveBeenCalledTimes(3);
  });

  it("a FAILED row is reported with the server's reason", async () => {
    listOutbox.mockResolvedValue([row("FAILED", "550 mailbox unavailable")]);
    const onOutcome = vi.fn();
    render(<Probe queued={QUEUED()} onOutcome={onOutcome} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    expect(onOutcome).toHaveBeenCalledWith({ kind: "failed", reason: "550 mailbox unavailable" });
  });

  it("a failed request is asked again, not read as an outcome", async () => {
    listOutbox.mockRejectedValueOnce(new Error("offline")).mockResolvedValue([]);
    const onOutcome = vi.fn();
    render(<Probe queued={QUEUED()} onOutcome={onOutcome} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    expect(onOutcome).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_500); });
    expect(onOutcome).toHaveBeenCalledWith({ kind: "sent" });
  });

  it("a SCHEDULED message is not chased: it is going out later on purpose", async () => {
    listOutbox.mockResolvedValue([]);
    const onOutcome = vi.fn();
    render(<Probe queued={QUEUED({ undo_seconds: 0, release_at: new Date(Date.now() - 1000).toISOString() })} onOutcome={onOutcome} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(listOutbox).not.toHaveBeenCalled();
  });

  it("stops asking once the toast is no longer waiting (an Undo was pressed)", async () => {
    listOutbox.mockResolvedValue([]);
    const onOutcome = vi.fn();
    render(<Probe queued={QUEUED()} active={false} onOutcome={onOutcome} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(listOutbox).not.toHaveBeenCalled();
  });
});

describe("the toast's two new endings", () => {
  const past = () => new Date(Date.now() - 1000).toISOString();

  it("SENT says so, drops the Undo, and gets out of the way", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<UndoSendToast releaseAt={past()} state="sent" onUndo={vi.fn()} onDismiss={onDismiss} />);
    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(screen.getByText("It is in your Sent folder.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(4_000); });
    expect(onDismiss).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("FAILED says why and stays until read", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<UndoSendToast releaseAt={past()} state="failed" error="550 mailbox unavailable" onUndo={vi.fn()} onDismiss={onDismiss} />);
    expect(screen.getByText("Not sent")).toBeInTheDocument();
    expect(screen.getByText("550 mailbox unavailable")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(onDismiss).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
