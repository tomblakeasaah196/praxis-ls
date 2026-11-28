/**
 * The clock-in dialog: what stands between a tap on Clock In and a punch that
 * could not be what the person meant (owner's decision, 28 Nov 2026).
 *
 * WHY A DIALOG AND NOT A CARD. The clock used to punch first and explain after,
 * in a card hung off the floating toolbar. On a phone that card was a dead end:
 * the browser's own "Use location" button refuses every tap inside a container
 * with a backdrop blur (Chromium reports `intersection_occluded_or_distorted`),
 * which the toolbar has; the written steps were hidden whenever that button was
 * offered; and Retry on a blocked site failed with the same reason and said
 * nothing. Nobody could get out of it. A centred dialog has no blurred ancestor,
 * so the browser's button works, and everything the person needs is on it.
 *
 * THREE STEPS, each shown only when it has something to ask:
 *
 *   location  location is not available: ask for it, or name the cause and
 *             show its fix. "Clock In Without Location" is always there, so
 *             nothing STOPS a punch; it is recorded as Location Not Verified.
 *   device    this browser is not on the person's register: name it, then the
 *             punch goes. The name comes from the only person who knows it.
 *   failed    the server refused the punch: the reason in words, and Try Again.
 *
 * Presentation only. The flow lives in `useClockState` (clock-punch.tsx).
 */
import * as React from "react";
import i18n from "@/lib/i18n";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/modal";
import { GeolocationAllow, type GeolocationOutcome } from "@/components/geolocation-allow";
import { deviceLocationSteps, geoRecoverySteps, supportsGeolocationElement } from "@/lib/geo-permission";
import { isStandalone } from "@/lib/pwa-install";

/** Why the location step is showing: never asked yet, or what the last reading failed with. */
export type LocationAsk = "prompt" | "denied" | "os_off" | "unavailable";

export type ClockInStep =
  /** `attempts` counts the person's own retries, so a retry that changes nothing still says so. */
  | { kind: "location"; cause: LocationAsk; attempts: number }
  | { kind: "device" }
  | { kind: "failed"; message: string };

const LOCATION_TITLE: Record<LocationAsk, string> = {
  prompt: "hr.allowLocation",
  denied: "hr.unblockLocation",
  os_off: "hr.turnOnLocation",
  unavailable: "hr.locationNotFound",
};

const LOCATION_LEAD: Record<LocationAsk, string> = {
  prompt: "hr.locationPrimerLead",
  denied: "hr.locationBlockedLead",
  os_off: "hr.locationDeviceOffLead",
  unavailable: "hr.locationUnavailableLead",
};

export function ClockInDialog({
  step,
  busy,
  onCancel,
  onRetryLocation,
  onWithoutLocation,
  onNameDevice,
  onTryAgain,
}: {
  step: ClockInStep | null;
  busy: boolean;
  onCancel: () => void;
  /** Ask the browser for location from this tap: the prompt, or a retry. */
  onRetryLocation: () => void;
  onWithoutLocation: () => void;
  onNameDevice: (label: string) => void;
  onTryAgain: () => void;
}) {
  /*
   * The last step shown, kept while the dialog animates closed, so its content
   * does not blank out under the person's eyes on the way out.
   */
  const [shown, setShown] = React.useState<ClockInStep | null>(step);
  React.useEffect(() => {
    if (step) setShown(step);
  }, [step]);
  const s = step || shown;

  /*
   * Whether the written steps are showing, held HERE because the footer reads
   * it too. While the browser's own button is the way through, it is the one
   * thing to press, and an orange Try Again beside it read as the main action
   * (it re-asks a blocked site, which fails at once). Try Again comes back with
   * the steps, which is when it means something: after a setting was changed.
   * A new cause starts closed again.
   */
  const native = s?.kind === "location" && s.cause === "denied" && supportsGeolocationElement();
  const locationKey = s?.kind === "location" ? s.cause : null;
  const [stepsOpen, setStepsOpen] = React.useState(false);
  React.useEffect(() => {
    setStepsOpen(false);
  }, [locationKey]);
  const offerTryAgain = !native || stepsOpen;

  return (
    <Dialog
      open={step !== null}
      onClose={onCancel}
      title={
        !s
          ? i18n.t("hr.clockInButton")
          : s.kind === "location"
            ? i18n.t(LOCATION_TITLE[s.cause])
            : s.kind === "device"
              ? i18n.t("hr.nameDeviceTitle")
              : i18n.t("hr.clockInButton")
      }
      description={s?.kind === "device" ? i18n.t("hr.nameDeviceAbout") : undefined}
      footer={
        s?.kind === "location" ? (
          <>
            <Button variant="outline" onClick={onWithoutLocation} disabled={busy}>
              {i18n.t("hr.clockInWithoutLocation")}
            </Button>
            {offerTryAgain && (
              <Button onClick={onRetryLocation} loading={busy}>
                {s.cause === "prompt" ? i18n.t("hr.allowLocation") : i18n.t("hr.tryAgain")}
              </Button>
            )}
          </>
        ) : s?.kind === "device" ? (
          <>
            <Button variant="outline" onClick={onCancel}>
              {i18n.t("common.cancel")}
            </Button>
            <Button type="submit" form="clock-in-device" loading={busy}>
              {i18n.t("hr.clockInButton")}
            </Button>
          </>
        ) : s?.kind === "failed" ? (
          <>
            <Button variant="outline" onClick={onCancel}>
              {i18n.t("common.cancel")}
            </Button>
            <Button onClick={onTryAgain} loading={busy}>
              {i18n.t("hr.tryAgain")}
            </Button>
          </>
        ) : null
      }
    >
      {/* Keyed by cause: a new cause is a new step, and the browser button's
          notes and the opened steps belong to the cause they were about. */}
      {s?.kind === "location" && (
        <LocationStep
          key={s.cause}
          step={s}
          native={native}
          stepsOpen={!native || stepsOpen}
          onOpenSteps={() => setStepsOpen(true)}
          onRetryLocation={onRetryLocation}
        />
      )}
      {s?.kind === "device" && <DeviceStep busy={busy} onNameDevice={onNameDevice} />}
      {s?.kind === "failed" && (
        <Callout tone="bad" title={i18n.t("hr.punchFailed")}>
          {s.message}
        </Callout>
      )}
    </Dialog>
  );
}

/** What the last tap on the browser's own button came to, in words. */
const NATIVE_NOTE: Record<Exclude<GeolocationOutcome, "granted" | "answered">, string> = {
  "not-ready": "hr.locationButtonNotReady",
  dismissed: "hr.locationButtonDismissed",
  "no-answer": "hr.locationButtonNoAnswer",
};

function LocationStep({
  step,
  native,
  stepsOpen,
  onOpenSteps,
  onRetryLocation,
}: {
  step: Extract<ClockInStep, { kind: "location" }>;
  /** The browser has its own location button, and the site is blocked. */
  native: boolean;
  stepsOpen: boolean;
  onOpenSteps: () => void;
  onRetryLocation: () => void;
}) {
  /*
   * The browser's own button, where it exists, is THE way through: one tap puts
   * the browser's question back even after a block, which no page can do any
   * other way (no page may open the browser's settings). So it is the main
   * action, large, and the written steps wait behind "Use Settings Instead".
   * They come forward by themselves when a tap gets no answer: a button that
   * might not work on some phone is never the only way through.
   */
  const [note, setNote] = React.useState<keyof typeof NATIVE_NOTE | null>(null);
  const steps = React.useMemo(
    () =>
      step.cause === "denied"
        ? geoRecoverySteps(undefined, { standalone: isStandalone() })
        : step.cause === "os_off" || step.cause === "unavailable"
          ? deviceLocationSteps()
          : [],
    [step.cause],
  );
  const onOutcome = React.useCallback(
    (o: GeolocationOutcome) => {
      if (o === "granted" || o === "answered") {
        setNote(null);
        onRetryLocation();
        return;
      }
      setNote(o);
      if (o === "no-answer") onOpenSteps();
    },
    [onRetryLocation, onOpenSteps],
  );
  return (
    <div className="space-y-4">
      <Callout tone={step.cause === "prompt" ? "info" : "warn"} title={i18n.t(LOCATION_LEAD[step.cause])}>
        {step.cause === "prompt"
          ? i18n.t("hr.locationPrimerBody")
          : native
            ? i18n.t("hr.locationTapButtonBody")
            : i18n.t("hr.locationFixBody")}
      </Callout>
      {/* Wrapped: the browser lays its own element out and ignores the
          spacing rule above, so the wrapper carries the gap and the centring. */}
      {native && (
        <div className="flex justify-center pt-1">
          <GeolocationAllow onOutcome={onOutcome} />
        </div>
      )}
      {note && (
        <p role="status" className="text-sm font-medium text-warn">
          {i18n.t(NATIVE_NOTE[note])}
        </p>
      )}
      {steps.length > 0 &&
        (stepsOpen ? (
          <ol className="list-decimal space-y-1 pl-5 text-sm text-foreground">
            {steps.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        ) : (
          <button
            type="button"
            onClick={onOpenSteps}
            className="text-sm font-semibold text-primary-ink underline-offset-2 hover:underline"
          >
            {i18n.t("hr.useSettingsInstead")}
          </button>
        ))}
      {/* A retry that found the same problem says so. The old card went back
          to exactly how it looked, which read as a button that did nothing. */}
      {step.attempts > 0 && (
        <p role="status" className="text-sm font-medium text-warn">
          {i18n.t("hr.stillNotWorking")}
        </p>
      )}
    </div>
  );
}

function DeviceStep({ busy, onNameDevice }: { busy: boolean; onNameDevice: (label: string) => void }) {
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const label = value.trim();
    if (!label) {
      setError(i18n.t("hr.deviceNameRequired"));
      return;
    }
    onNameDevice(label);
  }
  return (
    <form id="clock-in-device" onSubmit={submit} noValidate>
      <Field label={i18n.t("hr.deviceNameLabel")} htmlFor="clock-in-device-name" error={error || undefined} required>
        <Input
          id="clock-in-device-name"
          // The dialog opened on the person's own tap, for this one field.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={value}
          onChange={(ev) => {
            setValue(ev.target.value);
            if (error) setError(null);
          }}
          maxLength={80}
          placeholder={i18n.t("hr.deviceNamePlaceholder")}
          autoComplete="off"
        />
      </Field>
    </form>
  );
}
