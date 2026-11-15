/**
 * The page behind the emailed link, which is an invitation's first screen as well as a reset's.
 * It states the password policy ONCE, from lib/password-policy.ts: the sentence under the title
 * used to promise five rules while the list under the fields ticked two and the button gated on
 * the length alone, and the ticks sat on a line of their own above their words.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const api = vi.hoisted(() => ({ tenant: vi.fn() }));
vi.mock("@/lib/api-client", () => ({
  ApiError: class ApiError extends Error {
    code = "ERROR";
  },
  tenant: api.tenant,
}));
vi.mock("@/lib/branding", () => ({ fetchLogin: vi.fn() }));
vi.mock("@/lib/error-reporting", () => ({ reportClientError: vi.fn() }));
vi.mock("@/app/branding/branding-context", () => ({
  useBranding: () => ({ branding: { name: "Acme Freight", logoUrl: null } }),
}));

import { fetchLogin } from "@/lib/branding";
import { reportClientError } from "@/lib/error-reporting";
import { ResetPasswordPage } from "./reset-password-page";

const STRONG = "Correct-Horse-9-Battery";

function open(token = "tok") {
  return render(
    <MemoryRouter
      initialEntries={[`/reset-password${token ? `?token=${token}` : ""}`]}
    >
      <ResetPasswordPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.tenant.mockReset();
  vi.mocked(fetchLogin).mockReset();
  vi.mocked(reportClientError).mockReset();
  vi.mocked(fetchLogin).mockResolvedValue({ backgroundUrl: null } as never);
});

describe("ResetPasswordPage", () => {
  it("lists every rule of the shared policy, each with its tick beside its words, and the match", () => {
    open();
    for (const rule of [
      "At least 12 characters",
      "An uppercase and a lowercase letter",
      "A number",
      "A symbol",
      "Passwords match",
    ]) {
      const row = screen.getByText(rule).closest("li");
      expect(row).not.toBeNull();
      // A row is a flex line: the tick and the words side by side, not stacked.
      expect(row!.className).toContain("flex");
    }
  });

  it("keeps Update Password disabled until the whole policy is met and both fields match", async () => {
    const user = userEvent.setup();
    open();
    const submit = screen.getByRole("button", { name: /update password/i });
    expect(submit).toBeDisabled();

    // Twelve characters is no longer enough: no number, no symbol.
    await user.type(screen.getByLabelText("New password"), "abcdefghijkL");
    await user.type(screen.getByLabelText("Confirm password"), "abcdefghijkL");
    expect(submit).toBeDisabled();

    await user.clear(screen.getByLabelText("New password"));
    await user.clear(screen.getByLabelText("Confirm password"));
    await user.type(screen.getByLabelText("New password"), STRONG);
    expect(submit).toBeDisabled(); // met, but not yet confirmed
    await user.type(screen.getByLabelText("Confirm password"), STRONG);
    expect(submit).toBeEnabled();
  });

  it("sends the token and the new password, then says it is done", async () => {
    api.tenant.mockResolvedValue({});
    const user = userEvent.setup();
    open("abc123");
    await user.type(screen.getByLabelText("New password"), STRONG);
    await user.type(screen.getByLabelText("Confirm password"), STRONG);
    await user.click(screen.getByRole("button", { name: /update password/i }));

    await waitFor(() =>
      expect(screen.getByText("Password updated")).toBeInTheDocument(),
    );
    expect(api.tenant).toHaveBeenCalledWith(
      "/auth/reset-password",
      expect.objectContaining({
        method: "POST",
        body: { token: "abc123", new_password: STRONG },
      }),
    );
  });

  it("wears the tenant's login photograph, so the emailed link does not open on a bare grey screen", async () => {
    vi.mocked(fetchLogin).mockResolvedValue({
      backgroundUrl: "/media/tenant_acme/login/bg.webp",
    } as never);
    const { container } = open();
    const scrim = container.querySelector(".login-scrim") as HTMLElement;
    await waitFor(() => expect(scrim.hasAttribute("data-photo")).toBe(true));
    expect(scrim.style.getPropertyValue("--login-photo")).toBe(
      "url(/media/tenant_acme/login/bg.webp)",
    );
  });

  it("still opens, plain, when the read fails, and the failure is recorded rather than swallowed", async () => {
    vi.mocked(fetchLogin).mockRejectedValue(new Error("offline"));
    const { container } = open();
    expect(screen.getByText("Choose a new password")).toBeInTheDocument();
    await waitFor(() => expect(reportClientError).toHaveBeenCalledTimes(1));
    expect(vi.mocked(reportClientError).mock.calls[0][0].message).toContain(
      "login photograph unavailable: offline",
    );
    expect(
      container.querySelector(".login-scrim")!.hasAttribute("data-photo"),
    ).toBe(false);
  });
});
