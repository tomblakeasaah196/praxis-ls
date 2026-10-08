/**
 * My Security (self-service) — a passkey for THIS device (first, because it is
 * the fastest and safest way in and the one the lock screen leads with), your
 * password, an authenticator app, and your Quick PIN (one per person, valid on
 * every device). Talks to the tenant auth routes: /auth/passkey/*,
 * /auth/change-password, /auth/2fa (+ /setup, /enable, /disable, /frequency),
 * /auth/pin.
 *
 * The authenticator card shows ONE state at a time (14401). It used to render
 * the enrolment form, a setup key, a raw `otpauth://` string the user was told
 * to "scan", and a permanent "Already enrolled?" code box with a Disable
 * button, all at once, to people who were not enrolled at all. Now: off is one
 * button; enrolling is a QR; on is one status row and how often it asks.
 *
 * Removing a passkey here is the ONE way a passkey leaves a device (owner
 * decision, 29 Sep 2026) — so it also tells the device's own passkey manager,
 * which then stops offering it.
 *
 * Adding a way in (a passkey, a PIN) on a session that is no longer fresh asks
 * for the password first — the server answers REAUTH_REQUIRED and `withReauth`
 * asks, once, in a branded dialog. Removing one asks for confirmation, and
 * names what will stop working.
 */
import { pageShell } from "@/lib/layout";
import { dateFmt, fmtRelative } from "@/lib/format";
import { tr, tv } from "@/lib/i18n";
import * as React from "react";
import { useAuth } from "@/app/auth/auth-context";
import { ApiError, tenantWithProgress } from "@/lib/api-client";
import { FilePicker } from "@/components/ui/image-upload";
import { UploadProgress } from "@/components/ui/upload-progress";
import { useUpload } from "@/lib/use-upload";
import { fileToDataUrl } from "@/lib/image-compress";
import { PIN_LENGTH } from "@/components/ui/pin-input";
import { cn } from "@/lib/cn";
import { useSearchParams } from "react-router-dom";
import {
  changePassword,
  getMfa,
  setupTotp,
  enableTotp,
  disableTotp,
  setMfaFrequency,
  getQuickPin,
  setQuickPin,
  removeQuickPin,
  type TotpSetup,
  type MfaStatus,
  type MfaFrequency,
  type QuickPinStatus,
} from "@/lib/security-api";
import {
  registerPasskey,
  listPasskeys,
  deletePasskey,
  biometricName,
  deviceLabel,
  isPasskeyCancel,
  isPasskeySupported,
  platformAuthenticatorAvailable,
  signalPasskeyGone,
  type PasskeyCredential,
} from "@/lib/webauthn";
import { passkeyDeviceStore } from "@/lib/passkey-devices";
import { lastSessionStore } from "@/lib/last-session";
import { quickPin } from "@praxis/shared";
import { useConfirm } from "@/components/ui/use-confirm";
import { usePrompt } from "@/components/ui/use-prompt";
import { FingerprintIcon } from "@/features/auth/sign-in-panel";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { OtpInput } from "@/components/ui/otp-input";
import { Segmented, type SegmentedOption } from "@/components/ui/segmented";
import { InfoHint } from "@/components/ui/info-hint";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import { SettingsCard, Field } from "@/components/settings/controls";

/**
 * How often the authenticator asks, as the owner chooses it (14401).
 *
 * `daily` and `monthly` are remembered PER DEVICE, server side: proving a code
 * on the laptop never stops the phone asking. Module scope so the enrolment
 * step and the enrolled card offer the identical three, and `as const` so the
 * value type stays `MfaFrequency` rather than widening to string.
 */
const MFA_EVERY: SegmentedOption<MfaFrequency>[] = [
  { value: "always", label: "Every Sign-In" },
  { value: "daily", label: "Daily" },
  { value: "monthly", label: "Monthly" },
];

type Msg = { kind: "ok" | "err"; text: string } | null;

function errText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "INVALID_2FA_CODE")
      return "That code isn't right — check your authenticator and retry.";
    return e.message;
  }
  return "Something went wrong. Try again.";
}

export function MySecurityPage() {
  const { user, patchUser } = useAuth();
  const toast = useToast();

  // --- Profile picture ---
  const [avatarMsg, setAvatarMsg] = React.useState<Msg>(null);

  /**
   * Through the upload engine. The "avatar" profile squares the image with an
   * attention crop — which lands on the face far more reliably than the centre
   * crop the CSS was doing — and runs the enhancement chain, because profile
   * photos are taken on phones in offices and are routinely under-exposed.
   */
  const avatar = useUpload<{ avatar_url: string }>({
    profile: "avatar",
    maxBytes: 1024 * 1024,
    send: async (file, ctx) =>
      tenantWithProgress<{ avatar_url: string }>(
        "/auth/avatar",
        { data_url: await fileToDataUrl(file) },
        ctx.onProgress,
      ),
    onAllComplete: ([res]) => {
      if (!res) return;
      patchUser({ avatar_url: res.avatar_url });
      setAvatarMsg({ kind: "ok", text: "Profile picture updated." });
    },
  });

  const avatarItem = avatar.items[0] ?? null;
  const avatarBusy =
    avatarItem?.state === "uploading" || avatarItem?.state === "compressing";

  React.useEffect(() => {
    if (avatarItem?.state === "error" && avatarItem.error) {
      setAvatarMsg({ kind: "err", text: avatarItem.error });
    }
  }, [avatarItem?.state, avatarItem?.error]);

  // --- Password ---
  //
  // The rules are the server's (shared/security/password-policy.js: 12 chars,
  // upper + lower + digit + symbol, then a breach check). They are mirrored here
  // as a live checklist rather than a single "password too weak" after the round
  // trip — the server stays the authority, this just stops the user guessing
  // which of five rules they missed. The breach check is NOT mirrored: it needs
  // the HIBP call, so it can only ever be reported by the server.
  const [currentPw, setCurrentPw] = React.useState("");
  const [newPw, setNewPw] = React.useState("");
  const [confirmPw, setConfirmPw] = React.useState("");
  const [pwBusy, setPwBusy] = React.useState(false);
  const [pwMsg, setPwMsg] = React.useState<Msg>(null);

  const pwRules = [
    { label: "At least 12 characters", ok: newPw.length >= 12 },
    {
      label: "An uppercase and a lowercase letter",
      ok: /[A-Z]/.test(newPw) && /[a-z]/.test(newPw),
    },
    { label: "A number", ok: /[0-9]/.test(newPw) },
    { label: "A symbol", ok: /[^A-Za-z0-9]/.test(newPw) },
  ];
  const pwMatches = newPw.length > 0 && newPw === confirmPw;
  const pwReady =
    pwRules.every((r) => r.ok) && pwMatches && currentPw.length > 0;

  async function onChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!pwReady) return;
    setPwBusy(true);
    setPwMsg(null);
    try {
      const { sessions_signed_out: signedOut } = await changePassword(
        currentPw,
        newPw,
      );
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      setPwMsg({
        kind: "ok",
        text: signedOut
          ? `Password changed. You're still signed in here; your other ${signedOut === 1 ? "session was" : `${signedOut} sessions were`} signed out.`
          : "Password changed. You're still signed in here.",
      });
    } catch (err) {
      setPwMsg({ kind: "err", text: errText(err) });
    } finally {
      setPwBusy(false);
    }
  }

  /* --- Authenticator app ---------------------------------------------------
   *
   * Three states, one at a time, because the card used to render all of them
   * at once: an enrolment form, a key, a raw `otpauth://` string the user was
   * told to "scan", and a permanent "Already enrolled?" box with a code field
   * and a Disable button, shown to people who were not enrolled at all.
   *
   *   idle    off   → one button.   on → one status row + how often it asks.
   *   setup         → the QR, a code field, and the frequency being chosen.
   *   codes         → the ten recovery codes, once, then gone.
   */
  type MfaStage = "idle" | "setup" | "codes";
  const [mfa, setMfa] = React.useState<MfaStatus | null>(null);
  const [mfaStage, setMfaStage] = React.useState<MfaStage>("idle");
  const [setup, setSetup] = React.useState<TotpSetup | null>(null);
  const [enrollCode, setEnrollCode] = React.useState("");
  const [enrollEvery, setEnrollEvery] = React.useState<MfaFrequency>("always");
  const [newCodes, setNewCodes] = React.useState<string[] | null>(null);
  const [showKey, setShowKey] = React.useState(false);
  const [mfaBusy, setMfaBusy] = React.useState(false);
  const [mfaMsg, setMfaMsg] = React.useState<Msg>(null);
  const mfaOn = !!mfa?.is_2fa_enabled;

  const loadMfa = React.useCallback(() => {
    getMfa()
      .then(setMfa)
      .catch(() =>
        setMfa({ is_2fa_enabled: false, mfa_frequency: "always", recovery_codes_remaining: 0 }),
      );
  }, []);
  React.useEffect(() => loadMfa(), [loadMfa]);

  async function beginSetup() {
    setMfaBusy(true);
    setMfaMsg(null);
    try {
      // Minting a second factor is a credential change: on a session that is no
      // longer fresh the server asks for the password first, in the same
      // branded dialog the passkey and the PIN use.
      const started = await withReauth((pw) => setupTotp(pw));
      if (!started) return;
      setSetup(started);
      setEnrollEvery(mfa?.mfa_frequency ?? "always");
      setShowKey(false);
      setEnrollCode("");
      setMfaStage("setup");
    } catch (e) {
      setMfaMsg({ kind: "err", text: errText(e) });
    } finally {
      setMfaBusy(false);
    }
  }

  async function enable(code: string) {
    setMfaBusy(true);
    setMfaMsg(null);
    try {
      const done = await enableTotp(code.trim(), enrollEvery);
      setSetup(null);
      setEnrollCode("");
      setMfa({
        is_2fa_enabled: true,
        mfa_frequency: done.mfa_frequency,
        recovery_codes_remaining: done.recovery_codes.length,
      });
      // The ONE moment these exist. No route re-reads them.
      setNewCodes(done.recovery_codes);
      setMfaStage("codes");
    } catch (e) {
      setMfaMsg({ kind: "err", text: errText(e) });
      setEnrollCode("");
    } finally {
      setMfaBusy(false);
    }
  }

  /**
   * Turning it off names what stops protecting the account, at the point of
   * commit rather than in a paragraph on the page nobody reads. No code is
   * asked for: someone whose phone is gone cannot produce one, and they are
   * exactly who reaches for this.
   */
  async function disable() {
    const sure = await confirm({
      title: "Turn off the authenticator?",
      body: "Your password alone will sign you in, and your recovery codes stop working.",
      confirmLabel: "Turn Off",
      destructive: true,
    });
    if (!sure) return;
    setMfaBusy(true);
    setMfaMsg(null);
    try {
      const done = await withReauth((pw) => disableTotp(pw), REAUTH_REMOVE);
      if (!done) return;
      setMfa({ is_2fa_enabled: false, mfa_frequency: "always", recovery_codes_remaining: 0 });
      setMfaStage("idle");
      setMfaMsg({ kind: "ok", text: "Authenticator turned off." });
    } catch (e) {
      setMfaMsg({ kind: "err", text: errText(e) });
    } finally {
      setMfaBusy(false);
    }
  }

  function cancelSetup() {
    setSetup(null);
    setEnrollCode("");
    setShowKey(false);
    setMfaStage("idle");
  }

  async function copyCodes(codes: string[]) {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      toast.success(tr("Recovery codes copied."));
    } catch {
      // Not a silent catch, so no taxonomy marker: the clipboard is the
      // browser's to refuse (permissions, an insecure origin, an old Safari),
      // and the user is told what to do instead. The codes are on screen.
      setMfaMsg({ kind: "err", text: "Could not copy. Select the codes and copy them." });
    }
  }

  function downloadCodes(codes: string[]) {
    // No date in the name: an ISO day here would be the one place a filename
    // disagrees with every other date a user reads, and these are not sorted.
    const blob = new Blob([`${codes.join("\n")}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "praxis-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  /** The codes leave the screen for good here, so this is the last honest
   *  moment to ask. One tap, and it prevents the lockout the codes exist for. */
  async function dismissCodes() {
    const saved = await confirm({
      title: "Saved your recovery codes?",
      body: "They are not shown again. Without them, a lost phone needs an administrator to reset your authenticator.",
      confirmLabel: "Yes, Saved",
      cancelLabel: "Not Yet",
    });
    if (!saved) return;
    setNewCodes(null);
    setMfaStage("idle");
    loadMfa();
  }

  /** How often it asks. Optimistic, because the control IS the state: a
   *  segment that waits for a round trip reads as broken. */
  async function changeEvery(next: MfaFrequency) {
    const previous = mfa;
    setMfa((m) => (m ? { ...m, mfa_frequency: next } : m));
    setMfaMsg(null);
    try {
      await setMfaFrequency(next);
    } catch (e) {
      setMfa(previous);
      setMfaMsg({ kind: "err", text: errText(e) });
    }
  }

  const [confirm, confirmDialog] = useConfirm();
  const [prompt, promptDialog] = usePrompt();
  const email = user?.email ?? "";
  const bio = biometricName();

  /**
   * Changing a way in on a session that is no longer fresh needs the password
   * (server: REAUTH_REQUIRED). One helper, so the passkey, the PIN and the
   * authenticator ask the same question the same way. Resolves null when the
   * person backs out.
   *
   * `why` names what the password is being asked FOR. It defaults to adding a
   * credential, which is what every caller did until the authenticator could
   * also be turned off here: telling somebody they are confirming a password
   * "to add a new way into your account" while they remove one is the kind of
   * small lie that teaches people to stop reading dialogs.
   */
  const REAUTH_ADD =
    "You signed in a while ago. Enter your password to add a new way into your account. It stops someone at an unattended desk from adding their own.";
  const REAUTH_REMOVE =
    "You signed in a while ago. Enter your password to remove a way into your account. It stops someone at an unattended desk from weakening it.";

  async function withReauth<T>(
    run: (currentPassword: string | null) => Promise<T>,
    why: string = REAUTH_ADD,
  ): Promise<T | null> {
    try {
      return await run(null);
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "REAUTH_REQUIRED")) throw e;
      const pw = await prompt({
        title: "Confirm it's you",
        description: why,
        label: "Current Password",
        type: "password",
        confirmLabel: "Confirm",
        trim: false,
        validate: (v) => (v ? null : "Enter your password."),
      });
      if (pw === null) return null;
      return run(pw);
    }
  }

  // --- Quick PIN — one per person, valid on every device ---
  const [pinStatus, setPinStatus] = React.useState<QuickPinStatus | null>(null);
  const [pin, setPin] = React.useState("");
  const [pin2, setPin2] = React.useState("");
  const [pinBusy, setPinBusy] = React.useState(false);
  const [pinMsg, setPinMsg] = React.useState<Msg>(null);
  const hasPin = !!pinStatus?.enabled;
  // The shared rule (@praxis/shared quickPin) — the same one the server applies,
  // shown as the user types rather than as a 422 after pressing the button.
  const pinWeak = pin.length === PIN_LENGTH ? quickPin.weakPinReason(pin) : null;
  const pinMismatch = pin2.length === PIN_LENGTH && pin !== pin2;
  const pinReady = pin.length === PIN_LENGTH && !pinWeak && pin === pin2;

  /** The account's PIN changed: the cached user and the device greeting follow. */
  const notePin = React.useCallback(
    (on: boolean) => {
      patchUser({ has_quick_pin: on });
      if (email) lastSessionStore.setQuickPin(email, on);
    },
    [patchUser, email],
  );

  const loadPin = React.useCallback(() => {
    getQuickPin()
      .then(setPinStatus)
      .catch(() => setPinStatus({ enabled: false, created_at: null, updated_at: null, last_used_at: null }));
  }, []);
  React.useEffect(() => loadPin(), [loadPin]);

  async function onSetPin(e: React.FormEvent) {
    e.preventDefault();
    if (!pinReady) return;
    setPinBusy(true);
    setPinMsg(null);
    try {
      const done = await withReauth((pw) => setQuickPin(pin, pw));
      if (!done) return;
      setPin("");
      setPin2("");
      setPinStatus(done);
      notePin(true);
      setPinMsg({
        kind: "ok",
        text: hasPin
          ? "Your Quick PIN was changed. The old one no longer works on any device."
          : "Quick PIN is set up. It signs you in on this device and every other one — your phone, your laptop, anywhere.",
      });
    } catch (err) {
      setPinMsg({ kind: "err", text: errText(err) });
    } finally {
      setPinBusy(false);
    }
  }
  async function onRemovePin() {
    const ok = await confirm({
      title: "Turn off your Quick PIN?",
      body: "It will stop signing you in on every device. Your passkeys and password still work, and you can set a new PIN any time.",
      confirmLabel: "Turn off Quick PIN",
      destructive: true,
    });
    if (!ok) return;
    try {
      await removeQuickPin();
      notePin(false);
      setPinMsg({ kind: "ok", text: "Quick PIN is off on every device." });
      loadPin();
    } catch (err) {
      setPinMsg({ kind: "err", text: errText(err) });
    }
  }

  // --- Passkey deep link ---
  // The dashboard nudge links here with ?highlight=passkey. Scroll to the card
  // and ring it, so arriving by link SHOWS the location.
  const [searchParams, setSearchParams] = useSearchParams();
  const passkeyCardRef = React.useRef<HTMLDivElement>(null);
  const [passkeyHighlit, setPasskeyHighlit] = React.useState(false);

  React.useEffect(() => {
    if (searchParams.get("highlight") !== "passkey") return;
    const el = passkeyCardRef.current;
    if (!el) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    setPasskeyHighlit(true);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("highlight");
      return next;
    }, { replace: true });
    const timer = window.setTimeout(() => setPasskeyHighlit(false), 2600);
    return () => window.clearTimeout(timer);
  }, [searchParams, setSearchParams]);

  // --- Passkey ---
  const [passkeys, setPasskeys] = React.useState<PasskeyCredential[] | null>(null);
  const [pkBusy, setPkBusy] = React.useState(false);
  const [pkMsg, setPkMsg] = React.useState<Msg>(null);
  const passkeySupported = typeof window !== "undefined" && isPasskeySupported();
  const [platformOk, setPlatformOk] = React.useState<boolean | null>(null);
  const [deviceVersion, bumpDevice] = React.useReducer((n: number) => n + 1, 0);
  const passkeyHere = React.useMemo(
    () => !!email && passkeyDeviceStore.get(email),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deviceVersion invalidates a localStorage read React cannot track.
    [email, deviceVersion],
  );

  React.useEffect(() => {
    let alive = true;
    void platformAuthenticatorAvailable().then((ok) => alive && setPlatformOk(ok));
    return () => {
      alive = false;
    };
  }, []);

  /**
   * The server is the truth about which passkeys exist. A credential this
   * device remembers but the account no longer holds (removed from another
   * session) is forgotten here, so the sign-in and lock screens stop leading
   * with it.
   */
  const loadPasskeys = React.useCallback(() => {
    listPasskeys()
      .then((list) => {
        setPasskeys(list);
        if (!email) return;
        const onServer = new Set(list.map((p) => p.credential_id));
        for (const id of passkeyDeviceStore.ids(email)) if (!onServer.has(id)) passkeyDeviceStore.forgetId(email, id);
        if (list.length === 0) passkeyDeviceStore.remove(email);
        bumpDevice();
      })
      .catch(() => setPasskeys([]));
  }, [email]);
  React.useEffect(() => loadPasskeys(), [loadPasskeys]);

  async function onRegisterPasskey() {
    setPkBusy(true);
    setPkMsg(null);
    try {
      const r = await withReauth((pw) => registerPasskey({ email, label: deviceLabel(), currentPassword: pw }));
      if (!r) return;
      setPkMsg({ kind: "ok", text: `Done — ${bio} now signs you in on this device.` });
      loadPasskeys();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "PASSKEY_ALREADY_ON_DEVICE") {
        setPkMsg({ kind: "ok", text: "This device already has a passkey for your account — you're all set." });
        bumpDevice();
      } else if (isPasskeyCancel(err)) {
        setPkMsg({ kind: "err", text: "Passkey setup was cancelled." });
      } else {
        setPkMsg({ kind: "err", text: errText(err) });
      }
    } finally {
      setPkBusy(false);
    }
  }
  async function onDeletePasskey(c: PasskeyCredential) {
    const here = passkeyDeviceStore.holds(email, c.credential_id);
    const name = c.label || "this passkey";
    const ok = await confirm({
      title: here ? "Remove this device's passkey?" : `Remove the passkey for "${name}"?`,
      body: here
        ? `${bio} will stop signing you in here. Your PIN and password still work, and you can set a passkey up again any time.`
        : "That device will no longer be able to sign you in with it. Do this for a device you've lost or no longer use.",
      confirmLabel: "Remove passkey",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deletePasskey(c.credential_id);
      passkeyDeviceStore.forgetId(email, c.credential_id);
      // The explicit removal is what takes a passkey off a device — tell this
      // device's passkey manager, so it stops offering it here. (A synced
      // passkey leaves every device on the same account; one that lives
      // elsewhere is simply not in this keychain, and nothing happens.)
      void signalPasskeyGone(c.credential_id);
      setPkMsg({ kind: "ok", text: "Passkey removed." });
      loadPasskeys();
    } catch (err) {
      setPkMsg({ kind: "err", text: errText(err) });
    }
  }

  const okCls =
    "rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm";
  const errCls =
    "rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive";

  return (
    <section className={pageShell.wide}>
      {confirmDialog}
      {promptDialog}
      <PageHeader
        eyebrow={<HubCrumb area="Security & Access" to="/security" />}
        title="My Security"
        description="How you get into your account: a passkey on this device, a Quick PIN, your password and an authenticator app."
      />
      <HubTabs />

      <div className="mt-2 flex flex-col gap-5">
        {/* Profile picture */}
        <SettingsCard
          title="Profile picture"
          desc="Shown on your account menu across the app."
        >
          <div className="flex items-center gap-4">
            {/* The preview is the picked file the moment it is chosen, falling
                back to the stored avatar. Before this the old picture stayed on
                screen through the whole upload with nothing to say otherwise. */}
            {avatarItem?.previewUrl || user?.avatar_url ? (
              <img
                src={avatarItem?.previewUrl || user?.avatar_url || ""}
                alt="Your avatar"
                className="h-16 w-16 rounded-xl object-cover"
              />
            ) : (
              <span className="grid h-16 w-16 place-items-center rounded-xl bg-primary text-xl font-bold text-primary-foreground">
                {(user?.display_name || user?.email || "?")
                  .charAt(0)
                  .toUpperCase()}
              </span>
            )}
            <div>
              <FilePicker
                variant="inline"
                accept="image/png,image/jpeg,image/webp,image/gif"
                disabled={avatarBusy}
                trigger={
                  <span className="inline-flex h-9 items-center rounded-lg border px-3 text-sm no-underline">
                    {avatarBusy ? "Uploading…" : "Change picture"}
                  </span>
                }
                onPick={(files) => {
                  setAvatarMsg(null);
                  void avatar.pick(files);
                }}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                PNG, JPG, WEBP or GIF, up to 1 MB.
              </p>
              {avatarItem && avatarItem.state !== "idle" && (
                <UploadProgress
                  className="mt-1 max-w-[220px]"
                  state={avatarItem.state}
                  percent={avatarItem.percent}
                  error={avatarItem.error}
                />
              )}
              {avatarMsg && (
                <p
                  className={`mt-1 text-xs ${avatarMsg.kind === "ok" ? "text-[rgb(var(--ok))]" : "text-[rgb(var(--bad))]"}`}
                >
                  {avatarMsg.text}
                </p>
              )}
            </div>
          </div>
        </SettingsCard>

        {/* Passkey — FIRST, because it is the fastest and safest way in and the
            one the lock screen leads with. `highlight=passkey` (the dashboard
            nudge's deep link) scrolls here and rings the card. */}
        <div
          ref={passkeyCardRef}
          className={cn(
            "rounded-2xl transition-shadow motion-reduce:transition-none",
            passkeyHighlit && "ring-2 ring-primary ring-offset-2 ring-offset-background",
          )}
        >
          <SettingsCard
            title={`Passkey — ${bio === "your passkey" ? "one-touch sign-in" : bio}`}
            desc="One touch signs you in, unlocks your session and signs documents. It belongs to this device alone — your laptop uses the laptop's, your phone uses the phone's — and it stays until you remove it here: signing out never removes it."
          >
            {!passkeySupported || platformOk === false ? (
              <p className="text-sm text-muted-foreground">
                This browser or device has no built-in fingerprint, face or Windows Hello sign-in it can use, so it can&apos;t hold a
                passkey. Use your Quick PIN or password here, and set a passkey up on your phone or laptop.
              </p>
            ) : passkeyHere ? (
              <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary-ink">
                  <FingerprintIcon width={24} height={24} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">This device signs you in with {bio}.</p>
                  <p className="text-xs text-muted-foreground">When your session locks, one touch unlocks it.</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary-ink">
                  <FingerprintIcon width={24} height={24} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    Set up {bio} on this device
                    <span className="status st-ok !py-0.5 !text-[9px]">recommended</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Your session locks every two hours. With a passkey, getting back in is a single touch.
                  </p>
                </div>
                <Button onClick={() => void onRegisterPasskey()} loading={pkBusy}>
                  Set up {bio === "your passkey" ? "a passkey" : bio}
                </Button>
              </div>
            )}

            <div className="mt-5 border-t pt-4">
              <p className="micro mb-2">Your passkeys</p>
              {passkeys === null ? (
                <p className="text-sm text-muted-foreground">{tr("Loading…")}</p>
              ) : passkeys.length === 0 ? (
                <p className="text-sm text-muted-foreground">No passkeys yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {passkeys.map((c) => {
                    const here = passkeyDeviceStore.holds(email, c.credential_id);
                    return (
                      <div key={c.credential_id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <FingerprintIcon width={18} height={18} className="shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                              <span className="truncate">{c.label || "Passkey"}</span>
                              {here && <span className="status st-ok !py-0.5 !text-[9px]">this device</span>}
                              {c.backed_up && <span className="status st-mute !py-0.5 !text-[9px]">synced</span>}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Added {dateFmt(c.created_at)}
                              {c.last_used_at ? ` · last used ${fmtRelative(c.last_used_at)}` : " · never used"}
                            </div>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => void onDeletePasskey(c)}>
                          Remove
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {pkMsg && (
              <p className={`mt-4 ${pkMsg.kind === "ok" ? okCls : errCls}`} role="status">
                {pkMsg.text}
              </p>
            )}
          </SettingsCard>
        </div>

        {/* Password */}
        <SettingsCard
          title={tr("Password")}
          desc="Change it here whenever you like — you'll need your current one. Your other sessions are signed out; this one stays."
        >
          <form onSubmit={onChangePassword} className="flex flex-col gap-3">
            {/* username hint: gives password managers the account to file the new
                credential under, since there's no email field on this form. */}
            <input
              type="hidden"
              name="username"
              autoComplete="username"
              value={user?.email ?? ""}
              readOnly
            />
            <div className="grid gap-3 lg:grid-cols-3">
              <Field label="Current Password">
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  placeholder="••••••••••••"
                />
              </Field>
              <Field label="New Password">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  placeholder="••••••••••••"
                />
              </Field>
              <Field label="Confirm New Password">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="••••••••••••"
                />
              </Field>
            </div>

            <ul className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-5">
              {pwRules.map((r) => (
                <li
                  key={r.label}
                  className={
                    r.ok && newPw ? "text-[rgb(var(--ok))]" : undefined
                  }
                >
                  <span aria-hidden>{r.ok && newPw ? "✓" : "•"}</span> {r.label}
                </li>
              ))}
            </ul>
            {confirmPw.length > 0 && !pwMatches && (
              <p className="text-xs text-[rgb(var(--bad))]">
                The two new passwords don&apos;t match.
              </p>
            )}

            <div>
              <Button type="submit" loading={pwBusy} disabled={!pwReady}>
                Change password
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Can&apos;t remember your current password? Sign out and use
                &ldquo;Forgot password&rdquo; on the sign-in screen — we&apos;ll
                email you a single-use link.
              </p>
            </div>
          </form>

          {pwMsg && (
            <p className={`mt-4 ${pwMsg.kind === "ok" ? okCls : errCls}`}>
              {pwMsg.text}
            </p>
          )}
        </SettingsCard>

        <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
          {/* The authenticator app */}
          <SettingsCard
            title="Authenticator App"
            action={
              <InfoHint label={tr("About the authenticator app")}>
                {tr(
                  "A phone app (Google Authenticator, Authy, 1Password and others) shows a 6-digit code that changes every 30 seconds. Scanning the square adds this account to it. After that, signing in asks for the code as well as your password, so a stolen password is not enough on its own.",
                )}
              </InfoHint>
            }
          >
            {mfa === null ? (
              <p className="text-sm text-muted-foreground">{tr("Loading…")}</p>
            ) : mfaStage === "codes" && newCodes ? (
              /* Shown ONCE. Nothing re-reads them, so the card says so at the
                 moment it matters and keeps the way out behind a confirm. */
              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium">
                  {tr("Save these. Each one signs you in once if you lose your phone.")}
                </p>
                <ul className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border p-3 font-mono text-sm">
                  {newCodes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => void copyCodes(newCodes)}>
                    {tr("Copy")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => downloadCodes(newCodes)}>
                    {tr("Download")}
                  </Button>
                  <Button size="sm" onClick={() => void dismissCodes()}>
                    {tr("Done")}
                  </Button>
                </div>
              </div>
            ) : mfaStage === "setup" && setup ? (
              <div className="flex flex-col items-center gap-4">
                {/* The QR, which is what "scan it" has always meant. The card
                    used to print the raw otpauth:// string instead, which no
                    authenticator app can read.

                    `bg-white` is deliberate and is NOT a white-labelling
                    violation: a QR is read by a camera looking for dark modules
                    on a light field, and inverting it for dark mode makes it
                    stop scanning on a good many readers. The padding carries
                    the quiet zone past the card's own surface colour. */}
                <img
                  src={setup.qr_svg}
                  alt={tr("Scan this with your authenticator app")}
                  width={196}
                  height={196}
                  className="rounded-lg bg-white p-3"
                />
                <OtpInput
                  value={enrollCode}
                  onChange={setEnrollCode}
                  onComplete={enable}
                  disabled={mfaBusy}
                />
                <div className="w-full">
                  {/* `Segmented`'s own `label` names the group for assistive
                      tech and is NOT rendered, so sighted users need this one:
                      three bare buttons reading "Daily / Monthly" next to a QR
                      do not say what they are the frequency OF. Under 24 chars,
                      so it is a caption and not prose the gate counts. */}
                  <p className="micro mb-1.5">{tr("Ask for a Code")}</p>
                  <Segmented
                    label={tr("How often a code is asked for")}
                    value={enrollEvery}
                    onChange={setEnrollEvery}
                    options={MFA_EVERY}
                  />
                </div>
                <div className="flex w-full items-center justify-between gap-2">
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline underline-offset-2"
                    onClick={() => setShowKey((v) => !v)}
                  >
                    {tr("No camera?")}
                  </button>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={cancelSetup}>
                      {tr("Cancel")}
                    </Button>
                    <Button
                      onClick={() => enable(enrollCode)}
                      loading={mfaBusy}
                      disabled={enrollCode.length < 6}
                    >
                      {tr("Turn On")}
                    </Button>
                  </div>
                </div>
                {showKey && (
                  <Input
                    readOnly
                    aria-label={tr("Setup key")}
                    value={setup.secret}
                    className="font-mono text-xs"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                )}
              </div>
            ) : mfaOn ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {tr("Authenticator")}
                      <Pill tone="ok" className="!py-0.5 !text-[9px]">
                        {tr("on")}
                      </Pill>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {mfa.recovery_codes_remaining === 1
                        ? tr("1 recovery code left")
                        : tv("{{n}} recovery codes left", { n: mfa.recovery_codes_remaining })}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => void disable()} disabled={mfaBusy}>
                    {tr("Turn Off")}
                  </Button>
                </div>
                <div>
                  <p className="micro mb-1.5">{tr("Ask for a Code")}</p>
                  <Segmented
                    label={tr("How often a code is asked for")}
                    value={mfa.mfa_frequency}
                    onChange={(v) => void changeEvery(v)}
                    options={MFA_EVERY}
                  />
                </div>
              </div>
            ) : (
              <Button onClick={() => void beginSetup()} loading={mfaBusy}>
                {tr("Set Up")}
              </Button>
            )}

            {mfaMsg && (
              <p className={`mt-4 ${mfaMsg.kind === "ok" ? okCls : errCls}`}>
                {mfaMsg.text}
              </p>
            )}
          </SettingsCard>

          {/* Quick PIN — one per person, every device */}
          <SettingsCard
            title="Quick PIN"
            desc="Four digits that sign you in on any device — your phone, your laptop, anywhere. Five wrong tries in a row switch it off everywhere. If you use an authenticator app, it still asks for its code after the PIN."
          >
            {pinStatus === null ? (
              <p className="text-sm text-muted-foreground">{tr("Loading…")}</p>
            ) : (
              <>
                {hasPin && (
                  <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        Your Quick PIN
                        <span className="status st-ok !py-0.5 !text-[9px]">on · every device</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {pinStatus.updated_at ? `Set ${dateFmt(pinStatus.updated_at)}` : "Set"}
                        {pinStatus.last_used_at ? ` · last used ${fmtRelative(pinStatus.last_used_at)}` : " · never used"}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => void onRemovePin()}>
                      Turn off
                    </Button>
                  </div>
                )}
                <form onSubmit={onSetPin} className="flex flex-col gap-3" noValidate>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={hasPin ? `New PIN (${PIN_LENGTH} digits)` : `PIN (${PIN_LENGTH} digits)`}>
                      <Input
                        type="password"
                        inputMode="numeric"
                        autoComplete="off"
                        value={pin}
                        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
                        placeholder="••••"
                        aria-invalid={!!pinWeak || undefined}
                      />
                    </Field>
                    <Field label="Confirm PIN">
                      <Input
                        type="password"
                        inputMode="numeric"
                        autoComplete="off"
                        value={pin2}
                        onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
                        placeholder="••••"
                        aria-invalid={pinMismatch || undefined}
                      />
                    </Field>
                  </div>
                  {pinWeak && <p className="text-xs text-[rgb(var(--bad))]">{pinWeak}</p>}
                  {!pinWeak && pinMismatch && <p className="text-xs text-[rgb(var(--bad))]">The two PINs don&apos;t match.</p>}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="submit" loading={pinBusy} disabled={!pinReady}>
                      {hasPin ? "Change Quick PIN" : "Set up Quick PIN"}
                    </Button>
                    {hasPin && (
                      <span className="text-xs text-muted-foreground">The old PIN stops working on every device.</span>
                    )}
                  </div>
                </form>
              </>
            )}

            {pinMsg && (
              <p className={`mt-4 ${pinMsg.kind === "ok" ? okCls : errCls}`} role="status">
                {pinMsg.text}
              </p>
            )}
          </SettingsCard>
        </div>

      </div>
    </section>
  );
}

export default MySecurityPage;
