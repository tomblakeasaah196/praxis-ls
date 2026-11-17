/**
 * Pieces every call surface shares (calls audit PR-6): the clock, the
 * recording notice, the quality line, the other side's microphone, the sound
 * control and the noise filter's honest status. Solid, token-coloured, in the
 * layout flow (F1, F2, F3).
 */
import { tr, tv } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { MicOffIcon } from "@/components/ui/icons";
import { Field } from "@/components/ui/modal";
import { NativeSelect } from "@/components/ui/select";
import { Segmented } from "@/components/ui/segmented";
import type { QualitySample } from "./call-engine";
import type { AudioState, PhoneRoute } from "./audio-route";

/**
 * The recording notice (decision row 5; F6). `future` is the ring's version:
 * the call WILL be recorded if answered normally. `detail` names who
 * processes the audio (G2).
 */
export function RecordingNotice({ future = false, detail = "", compact = false }: { future?: boolean; detail?: string; compact?: boolean }) {
  return (
    <div role="status" className={cn("flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground", compact && "py-1.5")}>
      <span aria-hidden className="mt-1 inline-block h-2 w-2 flex-none rounded-full bg-destructive" />
      <span className="min-w-0">
        <span className="block">
          {future
            ? tr("This call will be recorded and summarised: both parties are informed.")
            : tr("This call is recorded and summarised: both parties are informed.")}
        </span>
        {detail && <span className="mt-0.5 block text-muted-foreground">{detail}</span>}
      </span>
    </div>
  );
}

const QUALITY_DOT: Record<QualitySample["state"], string> = {
  good: "bg-ok",
  fair: "bg-warn",
  poor: "bg-bad",
};
const QUALITY_LABEL: Record<QualitySample["state"], string> = {
  good: "Good connection",
  fair: "Fair connection",
  poor: "Poor connection",
};

/** The link quality from getStats (§3.4): colour AND words, never colour alone. */
export function QualityLine({ quality }: { quality: QualitySample }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
      <span aria-hidden className={cn("inline-block h-2 w-2 rounded-full", QUALITY_DOT[quality.state])} />
      {tr(QUALITY_LABEL[quality.state])}
    </p>
  );
}

/**
 * The other side's microphone is muted (`call:mute`): the reason for the
 * silence, said in words beside an icon. Without it a muted colleague and a
 * dead line look the same.
 *
 * The live region is ALWAYS in the tree and only its content comes and goes,
 * which is what makes a screen reader announce the sentence when it appears.
 * Empty, it has no height, so it takes no room in the flow. `name` is left
 * out where the person's name is already the line above (the bar, the strip).
 *
 * It wraps and is never truncated: the sentence ends in "muted", and an
 * ellipsis there leaves a line that says nothing.
 */
export function PeerMutedLine({ muted, name, className }: { muted: boolean; name?: string | null; className?: string }) {
  return (
    <p aria-live="polite" data-call-peer-muted={muted ? "true" : "false"} className={cn("min-w-0 text-xs text-foreground", className)}>
      {muted && (
        <span className="mt-1 flex items-start gap-1.5">
          <MicOffIcon width={12} height={12} className="mt-0.5 flex-none" />
          <span className="min-w-0 break-words">
            {name ? tv("{{name}}'s microphone is muted", { name }) : tr("Their microphone is muted")}
          </span>
        </span>
      )}
    </p>
  );
}

const ROUTE_LABEL: Record<PhoneRoute, string> = {
  speaker: "Speaker",
  earpiece: "Earpiece",
  headset: "Headset",
};

/**
 * Where the call's sound plays (audio-route.ts). One control or none: a
 * Speaker / Earpiece switch on an Android phone, an output device chooser on
 * a desktop that has more than one. A change that did not take says so in a
 * line under the control, and the sound stays where it was.
 */
export function SoundControl({
  audio, onRoute, onOutput,
}: {
  audio: AudioState;
  onRoute?: (route: PhoneRoute) => void;
  onOutput?: (deviceId: string) => void;
}) {
  if (audio.kind === "none") return null;
  return (
    <div className="flex flex-col" data-call-sound={audio.kind}>
      {audio.kind === "route" ? (
        <Segmented
          label={tr("Call Sound")}
          value={audio.current}
          onChange={(route) => onRoute?.(route)}
          className="self-start"
          options={audio.routes.map((r) => ({
            value: r.route,
            label: tr(ROUTE_LABEL[r.route]),
            disabled: audio.busy,
          }))}
        />
      ) : (
        <Field label={tr("Sound Output")}>
          <NativeSelect
            value={audio.current}
            disabled={audio.busy}
            onChange={(e) => onOutput?.(e.target.value)}
          >
            {audio.outputs.map((o, i) => (
              <option key={o.deviceId || "default"} value={o.deviceId}>
                {o.deviceId === "" ? tr("System Default") : o.label || tv("Output {{n}}", { n: i })}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <p role="status" className="text-xs text-warn">
        {audio.failed && (
          <span className="mt-1 block">
            {tr("The sound could not be switched. It is still playing where it was.")}
          </span>
        )}
      </p>
    </div>
  );
}
