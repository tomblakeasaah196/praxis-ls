/**
 * The clock-in dialog's location step, where the browser's own location button
 * lives (28 Nov 2026).
 *
 * A tenant's phone reported that tapping it "did nothing at all". The browser
 * refuses a tap on that element silently whenever it judges the element unsafe
 * to click, so the page has to notice and say so itself. jsdom has no such
 * element, so these drive it the way the browser does: by dispatching its
 * events on the tag.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { ClockInDialog, type ClockInStep } from "@/components/clock-in-dialog";
import { NO_ANSWER_MS } from "@/components/geolocation-allow";
import * as reporting from "@/lib/error-reporting";

vi.mock("@/lib/error-reporting", () => ({ reportClientError: vi.fn() }));

const blocked: ClockInStep = { kind: "location", cause: "denied", attempts: 0 };

function show(step: ClockInStep = blocked) {
  const onRetryLocation = vi.fn();
  render(
    <ClockInDialog
      step={step}
      busy={false}
      onCancel={vi.fn()}
      onRetryLocation={onRetryLocation}
      onWithoutLocation={vi.fn()}
      onNameDevice={vi.fn()}
      onTryAgain={vi.fn()}
    />,
  );
  const dialog = screen.getByRole("dialog");
  const button = dialog.querySelector("geolocation") as (HTMLElement & { isValid?: boolean; invalidReason?: string }) | null;
  return { dialog, button, onRetryLocation };
}

describe("where the browser has its own location button", () => {
  beforeEach(() => {
    (window as unknown as { HTMLGeolocationElement?: unknown }).HTMLGeolocationElement = class {};
  });
  afterEach(() => {
    delete (window as unknown as { HTMLGeolocationElement?: unknown }).HTMLGeolocationElement;
    vi.useRealTimers();
    vi.mocked(reporting.reportClientError).mockClear();
  });

  it("makes it the main action and keeps the settings steps one tap away", () => {
    const { dialog, button } = show();
    expect(button).not.toBeNull();
    expect(within(dialog).getByText(/Tap the location button below/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/Set Location to Allow|Site settings/)).toBeNull();
    // One thing to press: Try Again would only re-ask a blocked site.
    expect(within(dialog).queryByRole("button", { name: "Try Again" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Clock In Without Location" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Use Settings Instead" }));
    expect(within(dialog).getByText(/Come back here and (tap|click) Try Again/)).toBeInTheDocument();
    // With the steps open, Try Again means something again: after a setting changed.
    expect(within(dialog).getByRole("button", { name: "Try Again" })).toBeInTheDocument();
  });

  it("goes on to check location as soon as the browser grants it", () => {
    const { button, onRetryLocation } = show();
    fireEvent(button!, new Event("location"));
    expect(onRetryLocation).toHaveBeenCalledTimes(1);
  });

  it("a tap the browser refused because the button had only just appeared asks for a second tap", () => {
    const { dialog, button, onRetryLocation } = show();
    Object.assign(button!, { isValid: false, invalidReason: "intersection_changed" });
    fireEvent.click(button!);
    expect(within(dialog).getByText(/One moment\. Tap the location button again/)).toHaveAttribute("role", "status");
    expect(onRetryLocation).not.toHaveBeenCalled();
  });

  it("a tap that gets no answer at all says so, shows the steps, and reports why", () => {
    vi.useFakeTimers();
    const { dialog, button } = show();
    Object.assign(button!, { isValid: false, invalidReason: "style_invalid" });
    fireEvent.click(button!);
    act(() => {
      vi.advanceTimersByTime(NO_ANSWER_MS);
    });
    expect(within(dialog).getByText(/did not ask on this phone/)).toHaveAttribute("role", "status");
    expect(within(dialog).getByText(/Come back here and (tap|click) Try Again/)).toBeInTheDocument();
    expect(reporting.reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "diagnostic", message: expect.stringContaining("reason=style_invalid") }),
    );
  });

  it("an answer before the deadline cancels the no-answer note", () => {
    vi.useFakeTimers();
    const { dialog, button, onRetryLocation } = show();
    fireEvent.click(button!);
    fireEvent(button!, new Event("promptaction"));
    act(() => {
      vi.advanceTimersByTime(NO_ANSWER_MS);
    });
    expect(onRetryLocation).toHaveBeenCalledTimes(1);
    expect(within(dialog).queryByText(/did not ask on this phone/)).toBeNull();
    expect(reporting.reportClientError).not.toHaveBeenCalled();
  });

  it("a closed question says how to get it back", () => {
    const { dialog, button } = show();
    fireEvent(button!, new Event("promptdismiss"));
    expect(within(dialog).getByText(/The question was closed/)).toHaveAttribute("role", "status");
  });
});

describe("where it does not", () => {
  it("shows the settings steps straight away, with no button to try", () => {
    const { dialog, button } = show();
    expect(button).toBeNull();
    expect(within(dialog).getByText(/Come back here and (tap|click) Try Again/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Use Settings Instead" })).toBeNull();
  });
});
