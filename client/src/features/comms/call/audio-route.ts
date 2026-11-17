/**
 * Where the call's sound plays: which control this device can honestly offer.
 *
 * Pure on purpose. Everything here is a decision over a device list that the
 * browser hands us, and none of it can be checked on a real phone from a test
 * runner, so the decisions live apart from the code that acts on them
 * (call-engine.ts `switchMicrophone` and `setOutputDevice`) and are tested
 * with plain lists (audio-route.test.ts).
 *
 * Two controls, never both:
 *
 *   route   Android Chrome. A page cannot pick a phone's output route. What
 *           Chrome does offer is a list of COMMUNICATION INPUT devices, and
 *           the output route follows the one in use: opening the microphone
 *           as "Speakerphone" plays the call on the loudspeaker, as "Headset
 *           earpiece" on the earpiece. The labels are Chrome's own fixed
 *           English names (AudioManagerAndroid DEVICE_NAMES), not localised.
 *           Offered ONLY when both a speakerphone and an earpiece are listed,
 *           which is what keeps it off an iPhone (one "iPhone Microphone",
 *           no route to choose) and off every desktop.
 *
 *   output  Desktop. `HTMLMediaElement.setSinkId` exists and more than one
 *           real output device is listed.
 *
 * Anything else is "none", and the call screen shows no control at all.
 */

/** The fields of a MediaDeviceInfo this module reads. */
export type AudioDevice = {
  kind: string;
  deviceId: string;
  label: string;
};

/** A phone's routes. `headset` is a wired, USB or Bluetooth headset. */
export type PhoneRoute = "speaker" | "earpiece" | "headset";

export type PhoneRouteOption = { route: PhoneRoute; deviceId: string };

export type OutputOption = {
  /** "" is the system default, as `setSinkId("")` reads it. */
  deviceId: string;
  /** The device's own name; "" when the browser gave none. */
  label: string;
};

export type AudioControl =
  | { kind: "none" }
  | { kind: "route"; routes: PhoneRouteOption[]; current: PhoneRoute }
  | { kind: "output"; outputs: OutputOption[]; current: string };

/** The control with its live state: `busy` while a change is in flight,
 *  `failed` when the last one did not take and the sound stayed put. */
export type AudioState = AudioControl & { busy: boolean; failed: boolean };

/** Chrome's two alias entries: the same devices again, under another id. */
const ALIAS_IDS = new Set(["default", "communications"]);

type InputClass = "speaker" | "earpiece" | "wired" | "usb" | "bluetooth" | null;

/**
 * Which of Chrome for Android's communication devices an input label names.
 * "Headset earpiece" is the earpiece, so it is tested before any headset.
 */
export function classifyInput(label: string): InputClass {
  const l = String(label || "").toLowerCase();
  if (!l) return null;
  if (l.includes("speakerphone")) return "speaker";
  if (l.includes("earpiece")) return "earpiece";
  if (l.includes("wired headset")) return "wired";
  if (l.includes("usb audio")) return "usb";
  if (l.includes("bluetooth")) return "bluetooth";
  return null;
}

/** Chrome's own preference when several headsets are connected. */
const HEADSET_ORDER: InputClass[] = ["wired", "usb", "bluetooth"];

/**
 * The routes a phone offers, or none. Both a speakerphone and an earpiece
 * must be listed; a headset joins them as a third choice when one is
 * connected, so the person can go back to it after trying the loudspeaker.
 */
export function phoneRoutes(devices: readonly AudioDevice[]): PhoneRouteOption[] {
  const found = new Map<InputClass, string>();
  for (const d of devices) {
    if (d.kind !== "audioinput" || !d.deviceId || ALIAS_IDS.has(d.deviceId)) continue;
    const cls = classifyInput(d.label);
    if (cls && !found.has(cls)) found.set(cls, d.deviceId);
  }
  const speaker = found.get("speaker");
  const earpiece = found.get("earpiece");
  if (!speaker || !earpiece) return [];
  const routes: PhoneRouteOption[] = [
    { route: "speaker", deviceId: speaker },
    { route: "earpiece", deviceId: earpiece },
  ];
  const headset = HEADSET_ORDER.map((c) => found.get(c)).find(Boolean);
  if (headset) routes.push({ route: "headset", deviceId: headset });
  return routes;
}

/**
 * The route in use. A microphone opened as one of the listed devices says so
 * itself. One opened as the default follows Chrome's rule for the default
 * communication device: a connected headset first, otherwise the
 * loudspeaker (never the earpiece).
 */
export function currentPhoneRoute(
  routes: readonly PhoneRouteOption[],
  micDeviceId: string | null,
): PhoneRoute {
  const direct = micDeviceId ? routes.find((r) => r.deviceId === micDeviceId) : undefined;
  if (direct) return direct.route;
  return routes.some((r) => r.route === "headset") ? "headset" : "speaker";
}

/**
 * The output devices worth a chooser: the system default first, then each
 * real device once. Chrome's "default" and "communications" entries are
 * aliases of devices already in the list, so they are not counted and not
 * offered a second time. Fewer than two real devices is no choice: empty.
 */
export function outputChoices(devices: readonly AudioDevice[]): OutputOption[] {
  const real: OutputOption[] = [];
  const seen = new Set<string>();
  for (const d of devices) {
    if (d.kind !== "audiooutput" || !d.deviceId || ALIAS_IDS.has(d.deviceId)) continue;
    if (seen.has(d.deviceId)) continue;
    seen.add(d.deviceId);
    real.push({ deviceId: d.deviceId, label: String(d.label || "") });
  }
  if (real.length < 2) return [];
  return [{ deviceId: "", label: "" }, ...real];
}

/** The chooser's selected value for the element's sink id. */
export function currentOutput(outputs: readonly OutputOption[], sinkId: string): string {
  if (!sinkId || ALIAS_IDS.has(sinkId)) return "";
  return outputs.some((o) => o.deviceId === sinkId) ? sinkId : "";
}

/**
 * The one control this device gets. The phone's route wins when both would
 * qualify: on a phone the route is the thing a person means by "speaker",
 * and two controls for one sound would contradict each other.
 */
export function audioControl(
  devices: readonly AudioDevice[],
  env: { canSetSink: boolean; micDeviceId: string | null; sinkId: string },
): AudioControl {
  const routes = phoneRoutes(devices);
  if (routes.length) {
    return { kind: "route", routes, current: currentPhoneRoute(routes, env.micDeviceId) };
  }
  if (env.canSetSink) {
    const outputs = outputChoices(devices);
    if (outputs.length) return { kind: "output", outputs, current: currentOutput(outputs, env.sinkId) };
  }
  return { kind: "none" };
}

/** Can this browser send an audio element to a chosen output device? */
export function canSetSinkId(): boolean {
  if (typeof HTMLMediaElement === "undefined") return false;
  return typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId === "function";
}

/** The device list, or an empty one where the browser has none to give. */
export async function listAudioDevices(): Promise<AudioDevice[]> {
  if (typeof navigator === "undefined" || typeof navigator.mediaDevices?.enumerateDevices !== "function") {
    return [];
  }
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    return list.map((d) => ({ kind: d.kind, deviceId: d.deviceId, label: d.label }));
  } catch {
    /* @silent:parse — no device list is the same as an empty one: the call
       screen offers no sound control and the call is unaffected. */
    return [];
  }
}
