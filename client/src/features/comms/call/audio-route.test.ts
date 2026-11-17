/**
 * Which sound control a device gets (audio-route.ts).
 *
 * None of this can be checked on a real phone from here, so the decisions are
 * pinned against the device lists each kind of browser hands out. The lists
 * are the documented shapes: Chrome for Android's fixed English communication
 * device names, an iPhone's single microphone, Chrome desktop's alias entries.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  audioControl, canSetSinkId, classifyInput, currentOutput, currentPhoneRoute, listAudioDevices,
  outputChoices, phoneRoutes, type AudioDevice,
} from "./audio-route";

const input = (deviceId: string, label: string): AudioDevice => ({ kind: "audioinput", deviceId, label });
const output = (deviceId: string, label: string): AudioDevice => ({ kind: "audiooutput", deviceId, label });

/** Chrome for Android, nothing plugged in. */
const ANDROID = [
  input("default", "Default"),
  input("spk", "Speakerphone"),
  input("ear", "Headset earpiece"),
  output("default", "Default"),
];
/** The same phone with a Bluetooth headset connected. */
const ANDROID_BT = [...ANDROID, input("bt", "Bluetooth headset")];
/** A wired headset takes the earpiece off Chrome's list. */
const ANDROID_WIRED = [input("default", "Default"), input("spk", "Speakerphone"), input("wired", "Wired headset")];
/** Safari on an iPhone: one microphone, no outputs listed. */
const IPHONE = [input("abc", "iPhone Microphone")];
/** Chrome on a Windows desktop with speakers and a USB headset. */
const DESKTOP = [
  input("default", "Default - Microphone (Realtek)"),
  input("mic1", "Microphone (Realtek)"),
  output("default", "Default - Speakers (Realtek)"),
  output("communications", "Communications - Speakers (Realtek)"),
  output("out1", "Speakers (Realtek)"),
  output("out2", "Headset (Jabra)"),
];
/** The same desktop with only its speakers: three entries, one device. */
const DESKTOP_ONE = DESKTOP.filter((d) => d.deviceId !== "out2");

const env = (over: Partial<{ canSetSink: boolean; micDeviceId: string | null; sinkId: string }> = {}) => ({
  canSetSink: true, micDeviceId: null, sinkId: "", ...over,
});

describe("classifyInput", () => {
  it("reads Chrome for Android's communication device names", () => {
    expect(classifyInput("Speakerphone")).toBe("speaker");
    expect(classifyInput("Headset earpiece")).toBe("earpiece");
    expect(classifyInput("Wired headset")).toBe("wired");
    expect(classifyInput("Bluetooth headset")).toBe("bluetooth");
    expect(classifyInput("USB audio")).toBe("usb");
  });

  it("the earpiece is not mistaken for a headset because of its name", () => {
    expect(classifyInput("Headset earpiece")).toBe("earpiece");
  });

  it("anything else, or no label at all, is nothing", () => {
    for (const label of ["iPhone Microphone", "Microphone (Realtek)", "Default", "", "AirPods"]) {
      expect(classifyInput(label)).toBeNull();
    }
  });
});

describe("the phone's Speaker / Earpiece switch", () => {
  it("is offered when both a speakerphone and an earpiece are listed", () => {
    expect(phoneRoutes(ANDROID)).toEqual([
      { route: "speaker", deviceId: "spk" },
      { route: "earpiece", deviceId: "ear" },
    ]);
  });

  it("never appears on an iPhone: there is no route to choose there", () => {
    expect(phoneRoutes(IPHONE)).toEqual([]);
    expect(audioControl(IPHONE, env({ canSetSink: false }))).toEqual({ kind: "none" });
    // Not even if a future Safari grows setSinkId: one microphone, no outputs.
    expect(audioControl(IPHONE, env())).toEqual({ kind: "none" });
  });

  it("never appears on a desktop", () => {
    expect(phoneRoutes(DESKTOP)).toEqual([]);
  });

  it("needs BOTH: a speakerphone alone (wired headset in) is no switch", () => {
    expect(phoneRoutes(ANDROID_WIRED)).toEqual([]);
    expect(phoneRoutes([input("ear", "Headset earpiece")])).toEqual([]);
    expect(audioControl(ANDROID_WIRED, env({ canSetSink: false }))).toEqual({ kind: "none" });
  });

  it("is not offered before the labels are known (no microphone permission yet)", () => {
    expect(phoneRoutes([input("a", ""), input("b", "")])).toEqual([]);
  });

  it("a connected headset joins as a third choice, so the person can go back to it", () => {
    expect(phoneRoutes(ANDROID_BT).map((r) => r.route)).toEqual(["speaker", "earpiece", "headset"]);
    expect(phoneRoutes(ANDROID_BT)[2].deviceId).toBe("bt");
  });

  it("several headsets: the one Chrome itself prefers (wired, then USB, then Bluetooth)", () => {
    const both = [...ANDROID_BT, input("usb", "USB audio")];
    expect(phoneRoutes(both).find((r) => r.route === "headset")?.deviceId).toBe("usb");
  });

  it("the alias entry is never taken for a route", () => {
    const odd = [input("default", "Speakerphone"), input("ear", "Headset earpiece")];
    expect(phoneRoutes(odd)).toEqual([]);
  });
});

describe("the route in use", () => {
  const routes = phoneRoutes(ANDROID);
  const withBt = phoneRoutes(ANDROID_BT);

  it("is the device the microphone was opened on", () => {
    expect(currentPhoneRoute(routes, "ear")).toBe("earpiece");
    expect(currentPhoneRoute(routes, "spk")).toBe("speaker");
    expect(currentPhoneRoute(withBt, "bt")).toBe("headset");
  });

  it("a default microphone follows Chrome's rule: the loudspeaker, never the earpiece", () => {
    expect(currentPhoneRoute(routes, "default")).toBe("speaker");
    expect(currentPhoneRoute(routes, null)).toBe("speaker");
    expect(currentPhoneRoute(routes, "some-other-id")).toBe("speaker");
  });

  it("a default microphone with a headset connected is on the headset", () => {
    expect(currentPhoneRoute(withBt, "default")).toBe("headset");
  });

  it("is what the control reports", () => {
    expect(audioControl(ANDROID, env({ micDeviceId: "ear" }))).toEqual({
      kind: "route", routes, current: "earpiece",
    });
  });
});

describe("the desktop's output chooser", () => {
  it("lists the system default, then each real device once", () => {
    expect(outputChoices(DESKTOP)).toEqual([
      { deviceId: "", label: "" },
      { deviceId: "out1", label: "Speakers (Realtek)" },
      { deviceId: "out2", label: "Headset (Jabra)" },
    ]);
  });

  it("one real device is no choice, however many aliases the browser lists for it", () => {
    expect(DESKTOP_ONE.filter((d) => d.kind === "audiooutput")).toHaveLength(3);
    expect(outputChoices(DESKTOP_ONE)).toEqual([]);
    expect(audioControl(DESKTOP_ONE, env())).toEqual({ kind: "none" });
  });

  it("is offered only where setSinkId exists", () => {
    expect(audioControl(DESKTOP, env({ canSetSink: false }))).toEqual({ kind: "none" });
    expect(audioControl(DESKTOP, env()).kind).toBe("output");
  });

  it("a browser that lists no outputs gets no chooser", () => {
    expect(outputChoices(DESKTOP.filter((d) => d.kind !== "audiooutput"))).toEqual([]);
  });

  it("the same device listed twice is offered once", () => {
    const twice = [output("out1", "Speakers"), output("out1", "Speakers"), output("out2", "Headset")];
    expect(outputChoices(twice).map((o) => o.deviceId)).toEqual(["", "out1", "out2"]);
  });

  it("shows the element's device as selected, and the default for anything it does not list", () => {
    const outputs = outputChoices(DESKTOP);
    expect(currentOutput(outputs, "out2")).toBe("out2");
    expect(currentOutput(outputs, "")).toBe("");
    expect(currentOutput(outputs, "default")).toBe("");
    expect(currentOutput(outputs, "unplugged")).toBe("");
    expect(audioControl(DESKTOP, env({ sinkId: "out2" }))).toMatchObject({ kind: "output", current: "out2" });
  });
});

describe("one control, never two", () => {
  it("a phone that also has setSinkId and several outputs still gets the route switch only", () => {
    const phone = [...ANDROID, output("o1", "Speaker"), output("o2", "Earpiece")];
    expect(audioControl(phone, env()).kind).toBe("route");
  });

  it("no devices at all is no control", () => {
    expect(audioControl([], env())).toEqual({ kind: "none" });
  });
});

describe("the browser's side", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("canSetSinkId follows HTMLMediaElement.prototype.setSinkId", () => {
    const proto = HTMLMediaElement.prototype as { setSinkId?: unknown };
    const had = Object.prototype.hasOwnProperty.call(proto, "setSinkId");
    const before = proto.setSinkId;
    try {
      delete proto.setSinkId;
      expect(canSetSinkId()).toBe(false);
      proto.setSinkId = async () => {};
      expect(canSetSinkId()).toBe(true);
    } finally {
      if (had) proto.setSinkId = before;
      else delete proto.setSinkId;
    }
  });

  it("listAudioDevices returns the list, reduced to the fields that are read", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: {
        enumerateDevices: async () => [{ kind: "audioinput", deviceId: "spk", label: "Speakerphone", groupId: "g" }],
      },
    });
    expect(await listAudioDevices()).toEqual([{ kind: "audioinput", deviceId: "spk", label: "Speakerphone" }]);
  });

  it("a browser with no device list, or one that refuses it, gives an empty one", async () => {
    vi.stubGlobal("navigator", {});
    expect(await listAudioDevices()).toEqual([]);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        enumerateDevices: async () => {
          throw new Error("refused");
        },
      },
    });
    expect(await listAudioDevices()).toEqual([]);
  });
});
