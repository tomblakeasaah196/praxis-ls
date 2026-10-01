/**
 * useSigningProof — the signer's fingerprint or face, the way a bank approves a
 * transfer (owner decision, 28 Sep 2026).
 *
 * ── THE ONE CALL ────────────────────────────────────────────────────────────
 *
 *   const [confirmSign, signUi] = useSigningProof();
 *   const proof = await confirmSign({ entityRef: `costing:${id}`, docType: "COSTING" });
 *   if (!proof) return;                       // they backed out
 *   await api.setCostingStatus(id, "APPROVE", proof);
 *   …
 *   {signUi}
 *
 * ── WHAT THE PERSON SEES ────────────────────────────────────────────────────
 *
 *   Window open    → nothing at all. One confirmation covers the same
 *                    person's further signatures on this session for 5
 *                    minutes (meeting 6, F6) — the shell shows "Signing
 *                    unlocked · 4:12 · End now" (SigningWindowBadge).
 *   Has a passkey  → the OS prompt, straight away. No dialog of ours at all:
 *                    the fingerprint IS the confirmation. On a computer with
 *                    no fingerprint or face the ceremony runs ANYWAY, so the
 *                    browser offers "Use a phone or tablet" (QR, then the
 *                    phone's fingerprint) — the phone first (F6).
 *   No passkey yet → one sheet: "Sign with Face ID" · [Set up Face ID]; on a
 *                    computer without one, "Sign with your phone" · [Use my
 *                    phone], which sets the passkey up ON the phone by QR.
 *   Can't do it    → the six-digit code, emailed, entered in the same sheet —
 *                    only when the phone was declined or WebAuthn is absent.
 *
 * Short on purpose: the first tenant's complaint was reading paragraphs to do
 * routine work. One title, one line, one button that names the action.
 */
import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { OtpInput } from "@/components/ui/otp-input";
import { usePrompt } from "@/components/ui/use-prompt";
import { useAuth } from "@/app/auth/auth-context";
import { ApiError } from "@/lib/api-client";
import { tr } from "@/lib/i18n";
import {
  biometricName,
  isPasskeyCancel,
  isPasskeySupported,
  passkeySigningAssertion,
  platformAuthenticatorAvailable,
  registerPasskey,
  deviceLabel,
} from "@/lib/webauthn";
import {
  proofOptions,
  sendSigningCode,
  type SigningProof,
  type SigningTarget,
} from "@/lib/signing-proof";
import * as signingWindow from "@/lib/signing-window";

type Step = "setup" | "code" | null;

export function useSigningProof(): [
  (target: SigningTarget) => Promise<SigningProof | null>,
  React.ReactElement,
] {
  const { user } = useAuth();
  const [prompt, promptUi] = usePrompt();
  const [step, setStep] = React.useState<Step>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [code, setCode] = React.useState("");
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [canPasskey, setCanPasskey] = React.useState(true);
  // No fingerprint or face on THIS computer: the phone is the passkey (F6).
  const [onPhone, setOnPhone] = React.useState(false);
  const phone = React.useRef(false);
  const target = React.useRef<SigningTarget | null>(null);
  const settle = React.useRef<((p: SigningProof | null) => void) | null>(null);
  const bio = biometricName();

  const finish = React.useCallback((p: SigningProof | null) => {
    setStep(null);
    setBusy(false);
    setError(null);
    setCode("");
    const done = settle.current;
    settle.current = null;
    // A fresh proof opens this session's 5-minute window when its signature
    // is written; the badge picks it up from the server.
    if (p && ("passkey" in p || "otp_code" in p)) signingWindow.watchForOpen();
    done?.(p);
  }, []);

  /** Run the ceremony against fresh options. null = no passkey on the account. */
  const ceremony = React.useCallback(
    async (t: SigningTarget): Promise<SigningProof | null | "none"> => {
      const o = await proofOptions(t);
      if (!o.has_passkey || !o.options) return "none";
      const passkey = await passkeySigningAssertion(o.options, { preferPhone: phone.current });
      return { passkey };
    },
    [],
  );

  const startCode = React.useCallback(async () => {
    if (!target.current) return;
    setStep("code");
    setError(null);
    setBusy(true);
    try {
      const r = await sendSigningCode(target.current);
      setSentTo(r.sent_to || null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : tr("The code could not be sent."),
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const confirmSign = React.useCallback(
    async (t: SigningTarget): Promise<SigningProof | null> => {
      target.current = t;
      // F6: inside this session's 5-minute window, no proof is asked. The
      // server is asked when the app has no window on record (a reload).
      if (signingWindow.usable() || ((await signingWindow.refresh()) && signingWindow.usable())) {
        return { window: true };
      }
      const webauthn = isPasskeySupported();
      const platform =
        webauthn && (await platformAuthenticatorAvailable().catch(() => false));
      phone.current = webauthn && !platform;
      setCanPasskey(webauthn);
      setOnPhone(phone.current);
      return new Promise<SigningProof | null>((resolve) => {
        settle.current = resolve;
        void (async () => {
          // No WebAuthn at all: the code is the only way.
          if (!webauthn) {
            await startCode();
            return;
          }
          try {
            const r = await ceremony(t);
            if (r === "none") setStep("setup");
            else finish(r);
          } catch (e) {
            if (isPasskeyCancel(e)) {
              // On a computer with its own fingerprint, a cancel is the person
              // saying no. Without one, it is the phone declined or out of
              // reach — and the emailed code is exactly that last resort.
              if (phone.current) await startCode();
              else finish(null);
            } else {
              setError(e instanceof Error ? e.message : String(e));
              setStep("setup");
            }
          }
        })();
      });
    },
    [ceremony, finish, startCode],
  );

  async function setUp() {
    if (!target.current) return;
    setBusy(true);
    setError(null);
    try {
      const run = (pw: string | null) =>
        registerPasskey({
          email: user?.email,
          label: phone.current ? tr("Phone") : deviceLabel(),
          currentPassword: pw,
          // No fingerprint here: the passkey is made ON the phone, by QR (F6).
          fromPhone: phone.current,
        });
      try {
        await run(null);
      } catch (e) {
        if (!(e instanceof ApiError && e.code === "REAUTH_REQUIRED")) throw e;
        const pw = await prompt({
          title: tr("Confirm it's you"),
          label: tr("Password"),
          type: "password",
          confirmLabel: tr("Confirm"),
          trim: false,
          validate: (v) => (v ? null : tr("Enter your password.")),
        });
        if (pw === null) {
          setBusy(false);
          return;
        }
        await run(pw);
      }
      // Set up — now the one touch that signs.
      const r = await ceremony(target.current);
      if (r === "none")
        throw new Error(tr("The passkey was not saved. Try again."));
      finish(r);
    } catch (e) {
      if (isPasskeyCancel(e)) setBusy(false);
      else {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      }
    }
  }

  const ui = (
    <>
      <Dialog
        open={step === "setup"}
        onClose={() => finish(null)}
        title={onPhone ? tr("Sign with your phone") : `${tr("Sign with")} ${bio}`}
        description={
          onPhone
            ? tr("This computer has no fingerprint or face. Scan a QR code with your phone and confirm there — set it up once.")
            : tr("Set it up once. After that, signing is one touch.")
        }
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={null}
              onClick={() => void startCode()}
              disabled={busy}
            >
              {tr("Email me a code")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void setUp()}
              loading={busy}
              disabled={!canPasskey}
            >
              {onPhone ? tr("Use my phone") : `${tr("Set up")} ${bio}`}
            </Button>
          </>
        }
      >
        {error ? (
          <p className="text-sm text-bad">{error}</p>
        ) : (
          <span className="sr-only">{tr("Passkey setup")}</span>
        )}
      </Dialog>
      <Dialog
        open={step === "code"}
        onClose={() => finish(null)}
        title={tr("Enter the code")}
        description={
          sentTo
            ? `${tr("Sent to")} ${sentTo}`
            : tr("We emailed you a 6-digit code.")
        }
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={null}
              onClick={() => void startCode()}
              disabled={busy}
            >
              {tr("Resend")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={code.length !== 6}
              onClick={() => finish({ otp_code: code })}
            >
              {tr("Sign")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col items-center gap-3 py-2">
          <OtpInput
            value={code}
            onChange={setCode}
            onComplete={(v) => finish({ otp_code: v })}
          />
          {error && <p className="text-sm text-bad">{error}</p>}
        </div>
      </Dialog>
      {promptUi}
    </>
  );

  return [confirmSign, ui];
}
