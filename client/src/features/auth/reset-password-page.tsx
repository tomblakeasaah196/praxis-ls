/**
 * Reset-password page — the landing point for the emailed one-time link
 * (/reset-password?token=…). Public route (the user is, by definition, locked
 * out). Posts to the public /auth/reset-password endpoint; the token is
 * validated and the full password policy (length/complexity + breach check) is
 * enforced server-side, so we surface those errors inline. On success the
 * backend has already force-logged-out every session, so we just send the user
 * to sign in with their new password.
 */
import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, tenant } from "@/lib/api-client";
import { fetchLogin } from "@/lib/branding";
import { reportClientError } from "@/lib/error-reporting";
import { passwordMeetsPolicy, passwordRules } from "@/lib/password-policy";
import { useBranding } from "@/app/branding/branding-context";
import {
  LockIcon,
  EyeIcon,
  EyeOffIcon,
  ArrowRightIcon,
  CheckIcon,
} from "@/components/ui/icons";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();
  const { branding } = useBranding();
  const brandName = branding.name || "Praxis LS";

  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  // The shared statement of the policy (lib/password-policy.ts), not a local one: this page used to
  // check the length alone, so the sentence under the title promised five rules and the list
  // under the fields ticked two. The server keeps the last word (breach check, name in the email).
  const meetsPolicy = passwordMeetsPolicy(password);
  const matches = confirm.length > 0 && password === confirm;
  const canSubmit = !!token && meetsPolicy && matches && !busy;

  // The tenant's login photograph behind the card: the page opens from an emailed link, often on
  // a browser that has never seen the tenant, and a bare grey screen is its first impression.
  const [photo, setPhoto] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    fetchLogin()
      .then((cfg) => alive && setPhoto(cfg.backgroundUrl || null))
      .catch((err: unknown) => {
        // A read that failed where plain is acceptable (class D, doc/ERROR_HANDLING.md): the
        // scrim alone is enough for the person, and the failure is recorded for us.
        reportClientError({
          message: `login photograph unavailable: ${err instanceof Error ? err.message : String(err)}`,
          kind: "unhandledrejection",
          route: "/reset-password",
        });
      });
    return () => {
      alive = false;
    };
  }, []);

  function friendly(err: unknown): string {
    if (err instanceof ApiError) {
      if (err.code === "INVALID_RESET_TOKEN")
        return "This reset link is invalid or has expired. Request a new one from the sign-in screen.";
      if (err.code === "WEAK_PASSWORD" || err.code === "BREACHED_PASSWORD")
        return err.message;
      if (err.code === "RATE_LIMITED")
        return "Too many attempts. Please wait a few minutes and try again.";
      if (err.code === "ERROR")
        return "Can't reach the server. Check your connection.";
      return err.message;
    }
    return "Something went wrong. Please try again.";
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await tenant("/auth/reset-password", {
        method: "POST",
        body: { token, new_password: password },
        auth: false,
        retry: false,
      });
      setDone(true);
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="login-scrim"
      data-photo={photo ? "" : undefined}
      style={{
        position: "fixed",
        inset: 0,
        ...(photo ? { ["--login-photo" as string]: `url(${photo})` } : {}),
      }}
    >
      <div className="login-card">
        <p className="login-card-kicker">{brandName}</p>

        {!token ? (
          <>
            <h2 className="login-card-title">Reset link needed</h2>
            <p className="login-card-sub">
              This page opens from the link in your reset email.
            </p>
            <p className="login-note mt-5">
              We couldn't find a reset token in this link. Please open the most
              recent link from your email, or request a new one from the sign-in
              screen.
            </p>
            <button
              type="button"
              className="login-submit mt-5"
              onClick={() => navigate("/login")}
            >
              Back to sign in
            </button>
          </>
        ) : done ? (
          <>
            <h2 className="login-card-title">Password updated</h2>
            <p className="login-card-sub">You're all set</p>
            <p className="login-note mt-5">
              Your password has been changed and you've been signed out
              everywhere. Sign in with your new password to continue.
            </p>
            <button
              type="button"
              className="login-submit mt-5"
              onClick={() => navigate("/login")}
            >
              Go to sign in
              <ArrowRightIcon width={16} height={16} />
            </button>
          </>
        ) : (
          <>
            <h2 className="login-card-title">Choose a new password</h2>

            <form
              onSubmit={onSubmit}
              className="mt-5 flex flex-col gap-4"
              noValidate
            >
              <div className="flex flex-col gap-1.5">
                <label className="login-label" htmlFor="rp-pw">
                  New password
                </label>
                <div className="login-field">
                  <LockIcon width={17} height={17} />
                  <input
                    id="rp-pw"
                    type={showPw ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    aria-label={showPw ? "Hide password" : "Show password"}
                  >
                    {showPw ? (
                      <EyeOffIcon width={17} height={17} />
                    ) : (
                      <EyeIcon width={17} height={17} />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="login-label" htmlFor="rp-confirm">
                  Confirm password
                </label>
                <div className="login-field">
                  <LockIcon width={17} height={17} />
                  <input
                    id="rp-confirm"
                    type={showPw ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••••••"
                  />
                </div>
              </div>

              <ul
                className="flex flex-col gap-1"
                style={{ listStyle: "none", padding: 0, margin: 0 }}
              >
                {[
                  ...passwordRules(password).map((r) => ({
                    text: r.label,
                    ok: r.ok,
                  })),
                  { text: "Passwords match", ok: matches },
                ].map((r) => (
                  <li
                    key={r.text}
                    className="login-note flex items-center justify-center gap-2"
                    data-ok={r.ok}
                    style={{ opacity: r.ok ? 1 : 0.55 }}
                  >
                    <span
                      aria-hidden
                      className="grid h-3.5 w-3.5 place-items-center"
                    >
                      {r.ok ? <CheckIcon width={13} height={13} /> : "•"}
                    </span>
                    {r.text}
                    <span className="sr-only">
                      {r.ok ? " (met)" : " (not yet)"}
                    </span>
                  </li>
                ))}
              </ul>

              {error && <p className="login-error">{error}</p>}

              <button
                type="submit"
                className="login-submit"
                disabled={!canSubmit}
              >
                {busy ? "Updating…" : "Update password"}
                {!busy && <ArrowRightIcon width={16} height={16} />}
              </button>
              <button
                type="button"
                className="login-note"
                onClick={() => navigate("/login")}
              >
                ← Back to sign in
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
