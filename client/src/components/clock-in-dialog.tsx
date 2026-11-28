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
import { GeolocationAllow } from "@/components/geolocation-allow";
import { deviceLocationSteps, geoRecoverySteps, supportsGeolocationElement } from "@/lib/geo-permission";

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
            <Button onClick={onRetryLocation} loading={busy}>
              {s.cause === "prompt" ? i18n.t("hr.allowLocation") : i18n.t("hr.tryAgain")}
            </Button>
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
      {s?.kind === "location" && <LocationStep step={s} onRetryLocation={onRetryLocation} />}
      {s?.kind === "device" && <DeviceStep busy={busy} onNameDevice={onNameDevice} />}
      {s?.kind === "failed" && (
        <Callout tone="bad" title={i18n.t("hr.punchFailed")}>
          {s.message}
        </Callout>
      )}
    </Dialog>
  );
}

function LocationStep({
  step,
  onRetryLocation,
}: {
  step: Extract<ClockInStep, { kind: "location" }>;
  onRetryLocation: () => void;
}) {
  /*
   * The browser's own button, where it exists: the one way back from a blocked
   * site that does not go through settings. It works here and did not in the
   * old card, because nothing above it in this dialog blurs what is behind it.
   * The written steps stay beside it whatever: a button that might not work is
   * never the only way through.
   */
  const native = step.cause === "denied" && supportsGeolocationElement();
  const steps = React.useMemo(
    () =>
      step.cause === "denied"
        ? geoRecoverySteps()
        : step.cause === "os_off" || step.cause === "unavailable"
          ? deviceLocationSteps()
          : [],
    [step.cause],
  );
  return (
    <div className="space-y-3">
      <Callout tone={step.cause === "prompt" ? "info" : "warn"} title={i18n.t(LOCATION_LEAD[step.cause])}>
        {step.cause === "prompt" ? i18n.t("hr.locationPrimerBody") : i18n.t("hr.locationFixBody")}
      </Callout>
      {native && (
        <div className="flex justify-center py-1">
          <GeolocationAllow onSettled={onRetryLocation} />
        </div>
      )}
      {steps.length > 0 && (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-foreground">
          {steps.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      )}
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
