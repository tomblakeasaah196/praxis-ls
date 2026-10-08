/**
 * Self-service security calls (MFA/TOTP + the Quick PIN) against the tenant
 * auth routes. Login-time PIN sign-in + MFA verify live in auth-context; this is
 * the signed-in management surface used by the My Security screen.
 */
import { tenant } from "./api-client";

/**
 * Change your own password. Needs the current one — a live session is not proof
 * enough on the server, deliberately. Distinct from the admin route
 * (`POST /users/:id/password`, behind the IAM grant) and from the mailed
 * recovery link (`/auth/forgot-password` → `/reset-password`), which is the
 * route for someone who can't sign in at all.
 */
export const changePassword = (currentPassword: string, newPassword: string) =>
  tenant<{ changed: boolean; sessions_signed_out: number }>(
    "/auth/change-password",
    {
      method: "POST",
      // Default 401-refresh-and-retry left ON: a form the user spent a minute
      // filling in is exactly when the access token expires, and the server
      // answers a WRONG current password with 403, never 401 — so the retry path
      // can only ever be about the session, not about the credential.
      body: { current_password: currentPassword, new_password: newPassword },
    },
  );

/**
 * The authenticator app.
 *
 * `qr_svg` is a ready-to-render SVG data URL, built by the SERVER: the card
 * shows the symbol and a camera reads it. `secret` and `otpauth_url` are still
 * here for the manual path (an authenticator on the same device, where there is
 * no second camera to point at the screen).
 */
export type MfaFrequency = "always" | "daily" | "monthly";
export type TotpSetup = { secret: string; otpauth_url: string; qr_svg: string };
export type MfaStatus = {
  is_2fa_enabled: boolean;
  mfa_frequency: MfaFrequency;
  recovery_codes_remaining: number;
};

export const getMfa = () => tenant<MfaStatus>("/auth/2fa");

/** Mints a secret. `currentPassword` answers REAUTH_REQUIRED on a stale session. */
export const setupTotp = (currentPassword?: string | null) =>
  tenant<TotpSetup>("/auth/2fa/setup", {
    method: "POST",
    body: currentPassword ? { current_password: currentPassword } : {},
  });

/** Proving one code turns it on. The ten recovery codes come back HERE and
 *  nowhere else, ever — there is no route that re-reads them. */
export const enableTotp = (code: string, frequency: MfaFrequency) =>
  tenant<{ is_2fa_enabled: boolean; mfa_frequency: MfaFrequency; recovery_codes: string[] }>(
    "/auth/2fa/enable",
    { method: "POST", body: { code, frequency } },
  );

export const setMfaFrequency = (frequency: MfaFrequency) =>
  tenant<{ is_2fa_enabled: boolean; mfa_frequency: MfaFrequency }>("/auth/2fa/frequency", {
    method: "PUT",
    body: { frequency },
  });

/**
 * Turn it off. No code: someone whose phone is gone cannot produce one, and
 * that is exactly who needs this. `currentPassword` answers REAUTH_REQUIRED on
 * a stale session, the same bar the Quick PIN and passkeys use.
 */
export const disableTotp = (currentPassword?: string | null) =>
  tenant<{ is_2fa_enabled: boolean }>("/auth/2fa/disable", {
    method: "POST",
    body: currentPassword ? { current_password: currentPassword } : {},
  });

/**
 * The Quick PIN — ONE per person, valid on any device (14230). There is no
 * device list: the PIN set here works on the phone, the laptop, anywhere.
 */
export type QuickPinStatus = {
  enabled: boolean;
  created_at: string | null;
  updated_at: string | null;
  last_used_at: string | null;
};
export const getQuickPin = () => tenant<QuickPinStatus>("/auth/pin");
/** Set or change it. `currentPassword` answers REAUTH_REQUIRED on a stale session. */
export const setQuickPin = (pin: string, currentPassword?: string | null) =>
  tenant<QuickPinStatus>("/auth/pin", {
    method: "PUT",
    body: { pin, ...(currentPassword ? { current_password: currentPassword } : {}) },
  });
export const removeQuickPin = () =>
  tenant<{ enabled: false }>("/auth/pin", { method: "DELETE" });
