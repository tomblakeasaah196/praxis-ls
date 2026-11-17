/**
 * The call screens (calls audit PR-6; O4, F1–F6, F9, G2, G5).
 *
 * Solid surfaces that never block the app on a desktop, token colours, banners
 * in the flow, a static timer name, the recording notice and its processors on
 * the ring, Answer without recording, and a docked bar with its own controls.
 * Each screen is also run through axe.
 */
import type * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { IncomingRing } from "./incoming-ring";
import { CallOverlay } from "./call-overlay";
import { ActiveCallBar } from "./active-call-bar";
import { processorsSentence } from "./call-capabilities";

const PROCESSING = {
  recording_enabled: true,
  transcription: [
    { vendor: "groq", role: "first", name: "Groq", country: "United States" },
    { vendor: "gemini", role: "when_first_fails", name: "Google (Gemini)", country: "United States" },
  ],
  summary: [
    { vendor: "gemini", role: "first", name: "Google (Gemini)", country: "United States" },
    { vendor: "deepseek", role: "last_resort", name: "DeepSeek", country: "China" },
  ],
  network: [],
  relay_configured: true,
};

/** No glass (F1): no blur, no translucent grounds. */
function expectSolid(el: HTMLElement) {
  const html = el.outerHTML;
  expect(html).not.toMatch(/backdrop-blur|backdrop-filter/);
  expect(html).not.toMatch(/bg-\[rgb\(var\(--background\)\/0\.9\d\)\]|bg-card\/\d|bg-background\/\d/);
  expect(html).not.toMatch(/brand-blue|text-white/);
}

describe("the incoming call card", () => {
  const ring = (over = {}) => {
    const h = { onAccept: vi.fn(), onAcceptWithoutRecording: vi.fn(), onDecline: vi.fn() };
    const view = render(<IncomingRing name="Aïcha Ndongo" secondsLeft={48} recordingEnabled processing={PROCESSING} {...h} {...over} />);
    return { ...h, view };
  };

  it("is a solid card at the top right on a desktop, never a layer over the app", () => {
    const { view } = ring();
    const card = view.container.querySelector("[data-call-surface='ring']") as HTMLElement;
    expect(card.className).toMatch(/md:right-4/);
    expect(card.className).toMatch(/md:w-\[380px\]/);
    expect(card.className).not.toMatch(/(^|\s)inset-0(\s|$)/);
    expect(card.getAttribute("aria-modal")).toBe("false");
    expectSolid(card);
  });

  it("names the caller, how long it has rung, and that the call will be recorded, by whom (F6, G2)", () => {
    ring();
    expect(screen.getByRole("heading", { name: "Aïcha Ndongo" })).toBeInTheDocument();
    expect(screen.getByText(/ringing 0:12/)).toBeInTheDocument();
    expect(screen.getByText(/will be recorded and summarised/)).toBeInTheDocument();
    expect(screen.getByText(/Audio: Groq, or Google \(Gemini\) if Groq fails\./)).toBeInTheDocument();
    expect(screen.getByText(/Summary: Google \(Gemini\), or DeepSeek as a last resort\./)).toBeInTheDocument();
  });

  it("offers Answer without recording when the call would be recorded (G5)", async () => {
    const h = ring();
    await userEvent.click(screen.getByRole("button", { name: "Answer without recording" }));
    expect(h.onAcceptWithoutRecording).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(h.onAccept).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(h.onDecline).toHaveBeenCalled();
  });

  it("says nothing about recording, and offers no such choice, when nothing is recorded", () => {
    ring({ recordingEnabled: false });
    expect(screen.queryByText(/recorded/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Answer without recording" })).not.toBeInTheDocument();
  });

  it("uses the destructive and ok token pairs, with no pulsing (F2, F9)", () => {
    const { view } = ring();
    expect(screen.getByRole("button", { name: "Decline" }).className).toMatch(/bg-destructive/);
    expect(screen.getByRole("button", { name: "Answer" }).className).toMatch(/bg-ok/);
    expect(view.container.innerHTML).not.toMatch(/animate-pulse/);
  });

  it("an empty name never reads 'Incoming call from '", () => {
    ring({ name: null });
    expect(screen.getByRole("heading", { name: "Someone" })).toBeInTheDocument();
  });

  it("opens to a full solid screen on a phone", async () => {
    const { view } = ring();
    await userEvent.click(screen.getByRole("button", { name: "Full screen" }));
    const card = view.container.querySelector("[data-call-surface='ring']") as HTMLElement;
    expect(card.className).toMatch(/(^|\s)inset-0(\s|$)/);
    expect(card.getAttribute("aria-modal")).toBe("true");
  });

  it("passes axe", async () => {
    const { view } = ring();
    expect(await axe(view.container)).toHaveNoViolations();
  });
});

describe("the call screen", () => {
  const screenFor = (over = {}) => {
    const h = { onHangup: vi.fn(), onMute: vi.fn(), onMinimise: vi.fn(), onToggleNoise: vi.fn() };
    const view = render(
      <CallOverlay
        name="Bruno" phase="in_call" elapsedS={1745} warning muted={false}
        recordingEnabled processors="Audio: Groq." recordingLost={1}
        quality={{ state: "fair", rttMs: 200, jitterMs: 30, lossPct: 2 }}
        noise={{ enabled: true, status: "unavailable", reason: "wasm_load_failed" }}
        {...h} {...over}
      />,
    );
    return { ...h, view };
  };

  it("is a card at the bottom right on a desktop and solid everywhere (F1, F4)", () => {
    const { view } = screenFor();
    const s = view.container.querySelector("[data-call-surface='screen']") as HTMLElement;
    expect(s.className).toMatch(/md:bottom-4/);
    expect(s.className).toMatch(/md:w-\[380px\]/);
    expectSolid(s);
  });

  it("keeps every banner in the flow, none absolutely placed (F3)", () => {
    const { view } = screenFor();
    expect(view.container.innerHTML).not.toMatch(/absolute top-/);
    expect(screen.getByText("1 minute left")).toBeInTheDocument();
    expect(screen.getByText(/could not be uploaded/)).toBeInTheDocument();
    expect(screen.getByText(/is recorded and summarised/)).toBeInTheDocument();
  });

  it("names its timer once, not every second (F9)", () => {
    const { view } = screenFor();
    const timer = screen.getByRole("timer");
    expect(timer).toHaveAccessibleName("Call duration");
    expect(timer).toHaveTextContent("29:05");
    view.rerender(<CallOverlay name="Bruno" phase="in_call" elapsedS={1746} warning={false} muted={false} onHangup={() => {}} onMute={() => {}} />);
    expect(screen.getByRole("timer")).toHaveAccessibleName("Call duration");
  });

  it("minimises, mutes and hangs up; the noise switch is the house checkbox (F5)", async () => {
    const h = screenFor();
    await userEvent.click(screen.getByRole("button", { name: "Minimise call" }));
    expect(h.onMinimise).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(h.onMute).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "End call" }));
    expect(h.onHangup).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("checkbox", { name: "Yard noise filter" }));
    expect(h.onToggleNoise).toHaveBeenCalledWith(false);
    expect(screen.getByRole("button", { name: "End call" }).className).toMatch(/bg-destructive/);
  });

  it("passes axe", async () => {
    const { view } = screenFor();
    expect(await axe(view.container)).toHaveNoViolations();
  });
});

/** The live region that carries the other side's microphone state. */
const peerRegion = (root: HTMLElement) => root.querySelector("[data-call-peer-muted]") as HTMLElement;

describe("the other person's microphone on the call screen", () => {
  const overlay = (over: Partial<React.ComponentProps<typeof CallOverlay>> = {}) => (
    <CallOverlay name="Amina" phase="in_call" elapsedS={12} warning={false} muted={false}
      onHangup={() => {}} onMute={() => {}} {...over} />
  );

  it("says so by name, under the line about my own microphone", () => {
    const view = render(overlay({ peerMuted: true }));
    const line = screen.getByText("Amina's microphone is muted");
    expect(line).toBeInTheDocument();
    const mine = screen.getByText("Your microphone is on");
    expect(mine.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(peerRegion(view.container).getAttribute("data-call-peer-muted")).toBe("true");
  });

  it("is a polite live region that is there BEFORE they mute, so the change is announced", () => {
    const view = render(overlay({ peerMuted: false }));
    const region = peerRegion(view.container);
    expect(region).not.toBeNull();
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region).toBeEmptyDOMElement();
    expect(screen.queryByText(/microphone is muted/)).not.toBeInTheDocument();

    view.rerender(overlay({ peerMuted: true }));
    // The same node gained the sentence: that is what a screen reader reads out.
    expect(peerRegion(view.container)).toBe(region);
    expect(region).toHaveTextContent("Amina's microphone is muted");

    view.rerender(overlay({ peerMuted: false }));
    expect(region).toBeEmptyDOMElement();
  });

  it("both microphones can be muted at once, and each line says whose", () => {
    render(overlay({ muted: true, peerMuted: true }));
    expect(screen.getByText("Your microphone is muted")).toBeInTheDocument();
    expect(screen.getByText("Amina's microphone is muted")).toBeInTheDocument();
  });

  it("with no name to give, it still says whose microphone it is", () => {
    render(overlay({ name: null, peerMuted: true }));
    expect(screen.getByText("Their microphone is muted")).toBeInTheDocument();
  });

  it("a long name wraps the sentence, it does not cut off the word that says what happened", () => {
    const view = render(overlay({ name: "Jean-Baptiste Emmanuel Nkoulou Mbarga Atangana", peerMuted: true }));
    expect(screen.getByText("Jean-Baptiste Emmanuel Nkoulou Mbarga Atangana's microphone is muted")).toBeInTheDocument();
    expect(peerRegion(view.container).outerHTML).not.toMatch(/truncate|line-clamp|text-ellipsis/);
  });

  it("is in the flow with the other banners, in token colours, and not shown before the call is up", () => {
    const view = render(overlay({ peerMuted: true }));
    expect(view.container.innerHTML).not.toMatch(/absolute top-/);
    expect(peerRegion(view.container).className).toMatch(/text-foreground/);
    expectSolid(view.container.firstElementChild as HTMLElement);
    view.rerender(overlay({ phase: "connecting", peerMuted: true }));
    expect(screen.queryByText(/microphone is muted/)).not.toBeInTheDocument();
  });

  it("reads in French too, with no elision to get wrong", async () => {
    const i18n = (await import("@/lib/i18n")).default;
    await i18n.changeLanguage("fr");
    try {
      const view = render(overlay({ peerMuted: true }));
      expect(screen.getByText("Amina a coupé son micro")).toBeInTheDocument();
      view.rerender(overlay({ name: null, peerMuted: true }));
      expect(screen.getByText("Son micro est coupé")).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("passes axe with the line showing", async () => {
    const view = render(overlay({ muted: true, peerMuted: true }));
    expect(await axe(view.container)).toHaveNoViolations();
  });
});

describe("where the call's sound plays", () => {
  const ROUTE = {
    kind: "route" as const,
    routes: [{ route: "speaker" as const, deviceId: "spk" }, { route: "earpiece" as const, deviceId: "ear" }],
    current: "speaker" as const,
    busy: false,
    failed: false,
  };
  const OUTPUT = {
    kind: "output" as const,
    outputs: [
      { deviceId: "", label: "" },
      { deviceId: "out1", label: "Speakers (Realtek)" },
      { deviceId: "out2", label: "" },
    ],
    current: "",
    busy: false,
    failed: false,
  };
  const overlay = (over: Partial<React.ComponentProps<typeof CallOverlay>> = {}) => (
    <CallOverlay name="Amina" phase="in_call" elapsedS={12} warning={false} muted={false}
      onHangup={() => {}} onMute={() => {}} {...over} />
  );

  it("a device with nothing to choose shows no control at all (an iPhone, most desktops)", () => {
    const view = render(overlay({ audio: { kind: "none", busy: false, failed: false } }));
    expect(view.container.querySelector("[data-call-sound]")).toBeNull();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    view.rerender(overlay({}));
    expect(view.container.querySelector("[data-call-sound]")).toBeNull();
  });

  it("the phone's switch names both routes, marks the one in use, and asks for the other", async () => {
    const onAudioRoute = vi.fn();
    render(overlay({ audio: ROUTE, onAudioRoute }));
    const group = screen.getByRole("radiogroup", { name: "Call Sound" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Speaker" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Earpiece" })).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("radio", { name: "Headset" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Earpiece" }));
    expect(onAudioRoute).toHaveBeenCalledWith("earpiece");
  });

  it("a connected headset is a third choice", () => {
    render(overlay({
      audio: { ...ROUTE, routes: [...ROUTE.routes, { route: "headset", deviceId: "bt" }], current: "headset" },
    }));
    expect(screen.getByRole("radio", { name: "Headset" })).toHaveAttribute("aria-checked", "true");
  });

  it("while a change is in flight the switch cannot be tapped again", async () => {
    const onAudioRoute = vi.fn();
    render(overlay({ audio: { ...ROUTE, busy: true }, onAudioRoute }));
    expect(screen.getByRole("radio", { name: "Earpiece" })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "Earpiece" }));
    expect(onAudioRoute).not.toHaveBeenCalled();
  });

  it("the desktop's chooser lists the system default and each device, and asks for the one picked", async () => {
    const onAudioOutput = vi.fn();
    render(overlay({ audio: OUTPUT, onAudioOutput }));
    const select = screen.getByRole("combobox", { name: "Sound Output" });
    expect(select).toHaveValue("");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "System Default", "Speakers (Realtek)", "Output 2",
    ]);
    await userEvent.selectOptions(select, "out1");
    expect(onAudioOutput).toHaveBeenCalledWith("out1");
  });

  it("a change that did not take says so calmly, in the flow, and never as an error dialog", () => {
    const view = render(overlay({ audio: { ...ROUTE, failed: true } }));
    const line = screen.getByText("The sound could not be switched. It is still playing where it was.");
    expect(line.closest("[role='status']")).not.toBeNull();
    expect(line.closest("[role='status']")!.className).toMatch(/text-warn/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    // The switch is still there and still on the route that is really in use.
    expect(screen.getByRole("radio", { name: "Speaker" })).toHaveAttribute("aria-checked", "true");
    expect(view.container.innerHTML).not.toMatch(/absolute top-/);
  });

  it("is only offered once the call is up", () => {
    render(overlay({ phase: "connecting", audio: ROUTE }));
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("reads in French", async () => {
    const i18n = (await import("@/lib/i18n")).default;
    await i18n.changeLanguage("fr");
    try {
      const view = render(overlay({ audio: { ...ROUTE, failed: true } }));
      expect(screen.getByRole("radiogroup", { name: "Son de l'appel" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Haut-parleur" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Écouteur" })).toBeInTheDocument();
      expect(screen.getByText("Le son n'a pas pu être changé. Il est toujours diffusé au même endroit.")).toBeInTheDocument();
      view.rerender(overlay({ audio: OUTPUT }));
      expect(screen.getByRole("combobox", { name: "Sortie audio" })).toBeInTheDocument();
      expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
        "Par défaut du système", "Speakers (Realtek)", "Sortie 2",
      ]);
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("passes axe as a switch and as a chooser", async () => {
    const view = render(overlay({ audio: { ...ROUTE, failed: true } }));
    expect(await axe(view.container)).toHaveNoViolations();
    view.rerender(overlay({ audio: OUTPUT }));
    expect(await axe(view.container)).toHaveNoViolations();
  });
});

describe("the other person's microphone on the docked bar", () => {
  const bar = (over: Partial<React.ComponentProps<typeof ActiveCallBar>> = {}) => (
    <ActiveCallBar name="Amina" phase="in_call" elapsedS={65} muted={false}
      onMute={() => {}} onHangup={() => {}} onExpand={() => {}} {...over} />
  );

  it("says their microphone is muted, under the name, outside the button that would swallow it", () => {
    const view = render(bar({ peerMuted: true }));
    const line = screen.getByText("Their microphone is muted");
    expect(line).toBeInTheDocument();
    expect(line.closest("button")).toBeNull();
    expect(peerRegion(view.container).getAttribute("aria-live")).toBe("polite");
  });

  it("gets a row of its own and is never cut short: the last word is the one that matters", () => {
    const view = render(bar({ peerMuted: true, onOpenConversation: () => {} }));
    const region = peerRegion(view.container);
    // A direct child of the bar, after the row of controls, not squeezed in beside them.
    const surface = view.container.querySelector("[data-call-surface='bar']") as HTMLElement;
    expect(region.parentElement).toBe(surface);
    expect(surface.lastElementChild).toBe(region);
    expect(region.querySelector("button")).toBeNull();
    expect(region.outerHTML).not.toMatch(/truncate|line-clamp|text-ellipsis/);
  });

  it("the live region is there before they mute, empty, and says nothing while the call is still connecting", () => {
    const view = render(bar({ peerMuted: false }));
    const region = peerRegion(view.container);
    expect(region).toBeEmptyDOMElement();
    view.rerender(bar({ peerMuted: true }));
    expect(peerRegion(view.container)).toBe(region);
    expect(region).toHaveTextContent("Their microphone is muted");
    view.rerender(bar({ phase: "connecting", peerMuted: true }));
    expect(region).toBeEmptyDOMElement();
  });

  it("stays solid and passes axe with the line showing", async () => {
    const view = render(bar({ peerMuted: true, muted: true }));
    expectSolid(view.container.firstElementChild as HTMLElement);
    expect(await axe(view.container)).toHaveNoViolations();
  });
});

describe("the docked in-call bar (F4)", () => {
  it("has the clock, mute, open conversation, expand and hang up", async () => {
    const h = { onMute: vi.fn(), onHangup: vi.fn(), onExpand: vi.fn(), onOpenConversation: vi.fn() };
    const view = render(<ActiveCallBar name="Bruno" phase="in_call" elapsedS={65} muted recordingEnabled {...h} />);
    expect(screen.getByText("1:05")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Unmute" }));
    await userEvent.click(screen.getByRole("button", { name: "Conversation" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Open the call" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "End call" }));
    expect(h.onMute).toHaveBeenCalled();
    expect(h.onOpenConversation).toHaveBeenCalled();
    expect(h.onExpand).toHaveBeenCalled();
    expect(h.onHangup).toHaveBeenCalled();
    expectSolid(view.container.firstElementChild as HTMLElement);
    expect(await axe(view.container)).toHaveNoViolations();
  });
});

describe("the processors sentence (G2)", () => {
  it("follows the pipeline's order and leaves out what is not configured", () => {
    expect(processorsSentence({ ...PROCESSING, summary: [PROCESSING.summary[0]] }))
      .toBe("Audio: Groq, or Google (Gemini) if Groq fails. Summary: Google (Gemini).");
    expect(processorsSentence(null)).toBe("");
  });
});
