/**
 * Meeting 6 (29 Sep 2026), register 3.7 / owner decision F6 — signing on a
 * computer without fingerprint or face.
 *
 *   · G1 phone first: with a passkey, the ceremony runs anyway and asks the
 *     browser to offer the phone (QR); with none, the sheet offers setting one
 *     up FROM the phone; the emailed code only when the phone is declined.
 *   · G2 the 5-minute window: after one confirmation, the next signatures on
 *     this session need no new prompt; the shell shows "Signing unlocked ·
 *     4:12 · End now", and End now closes it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/auth/auth-context", () => ({
  useAuth: () => ({ user: { email: "a@b.cm" } }),
}));

let windowState: Record<string, unknown> = { open: false };
type Options = { has_passkey: boolean; options: Record<string, unknown> | null };
const proofOptions = vi.fn(async (): Promise<Options> => ({ has_passkey: true, options: { challenge: "x", _challengeToken: "tok" } }));
const send = vi.fn(async () => ({ sent_to: "a***@b.cm" }));
const endWindow = vi.fn(async () => ({ open: false }));
vi.mock("@/lib/signing-proof", () => ({
  proofOptions: (...a: unknown[]) => proofOptions(...(a as [])),
  sendSigningCode: (...a: unknown[]) => send(...(a as [])),
  getSigningWindow: vi.fn(async () => windowState),
  endSigningWindow: (...a: unknown[]) => endWindow(...(a as [])),
}));

const assertion = vi.fn();
const register = vi.fn();
let platform = false;
vi.mock("@/lib/webauthn", () => ({
  biometricName: () => "Face ID",
  deviceLabel: () => "Chrome on Windows",
  isPasskeySupported: () => true,
  platformAuthenticatorAvailable: async () => platform,
  isPasskeyCancel: (e: { name?: string }) => e?.name === "NotAllowedError",
  passkeySigningAssertion: (...a: unknown[]) => assertion(...a),
  registerPasskey: (...a: unknown[]) => register(...a),
}));

import { useSigningProof } from "./use-signing-proof";
import { SigningWindowBadge } from "./signing-window-badge";
import * as signingWindow from "@/lib/signing-window";
import { ToastProvider } from "@/components/ui/toast";

function Harness({ onResult }: { onResult: (v: unknown) => void }) {
  const [confirmSign, ui] = useSigningProof();
  return (
    <>
      {ui}
      <button onClick={async () => onResult(await confirmSign({ entityRef: "costing:c-1", docType: "COSTING" }))}>
        Approve
      </button>
    </>
  );
}

const PASSKEY = { assertion: { id: "cred" }, challenge_token: "tok" };
const openFor = (ms: number) => ({
  open: true,
  window_id: "w-1",
  opened_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + ms).toISOString(),
  proof_method: "PASSKEY",
  signature_count: 1,
});

beforeEach(() => {
  windowState = { open: false };
  platform = false;
  proofOptions.mockClear();
  send.mockClear();
  endWindow.mockClear();
  assertion.mockReset().mockResolvedValue(PASSKEY);
  register.mockReset().mockResolvedValue({ credential_id: "cred" });
  signingWindow.clear();
});

describe("G1 — the phone first, on a computer without fingerprint or face", () => {
  it("with a passkey, runs the ceremony anyway and asks for the phone", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ passkey: PASSKEY }));
    expect(assertion).toHaveBeenCalledWith(expect.anything(), { preferPhone: true });
    expect(send).not.toHaveBeenCalled();
  });

  it("with no passkey, offers setting one up from the phone — the code is the secondary choice", async () => {
    proofOptions
      .mockResolvedValueOnce({ has_passkey: false, options: null })
      .mockResolvedValueOnce({ has_passkey: true, options: { challenge: "y", _challengeToken: "tok" } });
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("dialog", { name: "Sign with your phone" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Email me a code" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use my phone" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ passkey: PASSKEY }));
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ fromPhone: true }));
  });

  it("the phone declined: the emailed code, as the last resort", async () => {
    assertion.mockRejectedValueOnce(Object.assign(new Error("cancelled"), { name: "NotAllowedError" }));
    const user = userEvent.setup();
    render(<Harness onResult={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("dialog", { name: "Enter the code" })).toBeInTheDocument();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("on a computer WITH fingerprint, a cancel is a no — no code is sent", async () => {
    platform = true;
    assertion.mockRejectedValueOnce(Object.assign(new Error("cancelled"), { name: "NotAllowedError" }));
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(null));
    expect(assertion).toHaveBeenCalledWith(expect.anything(), { preferPhone: false });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("G2 — the 5-minute window", () => {
  it("after one confirmation, two more approvals need no new prompt", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);

    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith({ passkey: PASSKEY }));
    expect(assertion).toHaveBeenCalledTimes(1);

    // The first signature was written: the server now reports the window.
    windowState = openFor(4 * 60 * 1000 + 12 * 1000);
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith({ window: true }));
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(3));
    expect(onResult).toHaveBeenLastCalledWith({ window: true });

    // No new prompt of any kind for the second and third.
    expect(assertion).toHaveBeenCalledTimes(1);
    expect(proofOptions).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a window with only seconds left is not used — a proof is asked", async () => {
    windowState = openFor(3000);
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ passkey: PASSKEY }));
  });

  it("the badge reads Signing unlocked · 4:12 · End now, and End now closes it", async () => {
    windowState = openFor(4 * 60 * 1000 + 12 * 1000);
    await act(async () => {
      await signingWindow.refresh();
    });
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <SigningWindowBadge />
      </ToastProvider>,
    );
    expect(screen.getByText("Signing unlocked")).toBeInTheDocument();
    expect(screen.getByLabelText("Time left")).toHaveTextContent(/^4:1[12]$/);
    await user.click(screen.getByRole("button", { name: "End now" }));
    await waitFor(() => expect(screen.queryByText("Signing unlocked")).not.toBeInTheDocument());
    expect(endWindow).toHaveBeenCalledTimes(1);
  });
});
